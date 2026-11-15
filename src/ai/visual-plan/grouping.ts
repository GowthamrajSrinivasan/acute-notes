/**
 * Organisation rules (organisation-layout plan §3.0, §3.2): the switch between today's grouping and layout ("v1") and
 * the knowledge-notes one ("v2": frame order by links, sub-groups inside a frame), and the sub-group rule validation
 * applies in v2. Pure; nothing here is wired: the integrator derives the option from `noteModel` (distil → v2).
 */
import type { VisualNode, VisualPlan } from "./types";

/** "v1": today's behaviour, byte for byte. "v2": frame order by links, one level of sub-groups inside a frame. */
export type Organisation = "v1" | "v2";

export interface OrganisationOptions {
  organisation: Organisation;
}

export const DEFAULT_ORGANISATION: Organisation = "v1";

/** A sub-group needs at least this many members; one card needs no box of its own. */
export const MIN_SUBGROUP_MEMBERS = 2;

/** True for a group node. */
const isGroup = (n: VisualNode | undefined): n is Extract<VisualNode, { type: "group" }> => n?.type === "group";

/**
 * The top-level group (section) a node belongs to: its parent group, or that group's own parent when it is a
 * sub-group. Undefined for a loose node. Walks `parent` (bounded, so a cycle can't hang it).
 */
export function topLevelGroupOf(plan: Pick<VisualPlan, "nodes">, id: string): string | undefined {
  const byId = new Map(plan.nodes.map((n) => [n.id, n] as const));
  let at = byId.get(id)?.parent;
  let top: string | undefined;
  for (let hops = 0; at && hops <= plan.nodes.length; hops++) {
    const node = byId.get(at);
    if (!isGroup(node)) break;
    top = node.id;
    at = node.parent;
  }
  return top;
}

/** Sub-groups of a plan (groups whose parent is a top-level group), by section: section id → sub-group ids, in plan order. */
export function subGroupsOf(plan: Pick<VisualPlan, "nodes">): Map<string, string[]> {
  const byId = new Map(plan.nodes.map((n) => [n.id, n] as const));
  const out = new Map<string, string[]>();
  for (const n of plan.nodes) {
    if (!isGroup(n) || !n.parent) continue;
    const parent = byId.get(n.parent);
    if (!isGroup(parent) || parent.parent) continue;
    (out.get(parent.id) ?? out.set(parent.id, []).get(parent.id)!).push(n.id);
  }
  return out;
}

export interface SubGroupResult {
  nodes: VisualNode[];
  /** What changed, for validation's warnings (never a loss: every card stays, in its section). */
  warnings: string[];
}

/**
 * The sub-group rule (§3.2), for `sanitizeGroups` to call in v2. Depth stays at 2: a group nested deeper is flattened
 * into its sub-group (its members move up to it, the group goes). A sub-group with fewer than `MIN_SUBGROUP_MEMBERS`
 * members is dissolved into its section. Sub-groups count against `maxGroups` with sections: past the cap, the last
 * sub-groups in plan order are dissolved. Every card is kept; only group nodes are removed.
 *
 * In v1 validation flattens nesting exactly as today and never calls this.
 */
export function normalizeSubGroups(nodes: readonly VisualNode[], options: { maxGroups?: number } = {}): SubGroupResult {
  const warnings: string[] = [];
  let out = nodes.map((n) => ({ ...n }) as VisualNode);
  const byId = () => new Map(out.map((n) => [n.id, n] as const));
  const depthOf = (id: string, map: Map<string, VisualNode>): number => {
    let d = 0;
    let at = map.get(id)?.parent;
    for (let hops = 0; at && hops <= out.length; hops++) {
      if (!isGroup(map.get(at))) break;
      d += 1;
      at = map.get(at)!.parent;
    }
    return d;
  };

  // 1. Flatten anything deeper than a sub-group into its sub-group (depth 0: section, 1: sub-group, 2+: too deep).
  for (;;) {
    const map = byId();
    const deep = out.find((n) => isGroup(n) && depthOf(n.id, map) >= 2);
    if (!deep) break;
    const into = deep.parent!;
    out = out.filter((n) => n.id !== deep.id).map((n) => (n.parent === deep.id ? ({ ...n, parent: into } as VisualNode) : n));
    warnings.push(`group "${deep.id}" was nested more than one level deep, so its contents joined "${into}"`);
  }

  // 2. Dissolve sub-groups that are too small; then 3. those past the group cap (last first).
  const dissolve = (sub: VisualNode, why: string) => {
    const into = sub.parent;
    out = out.filter((n) => n.id !== sub.id).map((n) => (n.parent === sub.id ? ({ ...n, parent: into } as VisualNode) : n));
    warnings.push(`sub-group "${sub.id}" ${why}, so its cards joined "${into}"`);
  };
  const isSub = (n: VisualNode) => isGroup(n) && !!n.parent && isGroup(byId().get(n.parent));
  for (const sub of out.filter(isSub)) {
    const members = out.filter((n) => n.parent === sub.id && n.type !== "group").length;
    if (members < MIN_SUBGROUP_MEMBERS) dissolve(sub, members ? "has a single card" : "has no cards");
  }
  if (options.maxGroups !== undefined) {
    const subs = out.filter(isSub);
    let over = out.filter(isGroup).length - options.maxGroups;
    for (const sub of [...subs].reverse()) {
      if (over <= 0) break;
      dissolve(sub, `is past the ${options.maxGroups}-group cap`);
      over -= 1;
    }
  }
  return { nodes: out, warnings };
}

/**
 * Sub-groups as the raw plan had them, put back on a validated plan, then `normalizeSubGroups`. A bridge for organisation v2 until
 * validation keeps sub-groups itself (`sanitizeGroups` calling `normalizeSubGroups`, an integrator request): today it makes every nested
 * group top-level. Only a group whose raw parent is a live top-level group of the validated plan is re-attached; once validation keeps
 * them, this changes nothing.
 */
export function restoreSubGroups(raw: unknown, plan: VisualPlan, options: { maxGroups?: number } = {}): VisualPlan {
  const rawNodes = typeof raw === "object" && raw !== null && Array.isArray((raw as { nodes?: unknown }).nodes) ? ((raw as { nodes: unknown[] }).nodes as unknown[]) : [];
  const rawParent = new Map<string, string>();
  for (const n of rawNodes) {
    const node = n as { id?: unknown; type?: unknown; parent?: unknown } | null;
    if (node && node.type === "group" && typeof node.id === "string" && typeof node.parent === "string") rawParent.set(node.id, node.parent);
  }
  if (!rawParent.size) return plan;
  const byId = new Map(plan.nodes.map((n) => [n.id, n] as const));
  const topLevel = (id: string) => byId.get(id)?.type === "group" && !byId.get(id)!.parent;
  let changed = false;
  const nodes = plan.nodes.map((n): VisualNode => {
    const parent = n.type === "group" && !n.parent ? rawParent.get(n.id) : undefined;
    if (!parent || parent === n.id || !topLevel(parent)) return n;
    changed = true;
    return { ...n, parent } as VisualNode;
  });
  return changed ? { ...plan, nodes: normalizeSubGroups(nodes, options).nodes } : plan;
}
