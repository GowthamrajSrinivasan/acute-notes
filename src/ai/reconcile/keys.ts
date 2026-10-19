/**
 * Stable node keys (F37, PRD §13.15.19): the identity a later run matches
 * nodes by. Always structural — a unit key plus the node's own key (or its
 * role/type ordinal) — never wording and never array position alone.
 *
 * - AI-tier plans are generated one analysis unit at a time; `mergeUnitPlans`
 *   namespaces every node's key with its unit (`<unit> § <node key>`) and
 *   prefixes plan-local ids per unit so units can't collide.
 * - `ensureStableKeys` gives any node still without a key (e.g. an MCP plan)
 *   the same kind of structural fallback, and makes keys unique, so every
 *   rendered object can be matched later.
 */
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";

export const UNIT_SEPARATOR = " § ";

/** The analysis unit a namespaced key belongs to; null for keys that aren't (local-tier plans). */
export function unitOfKey(stableKey: string): string | null {
  const i = stableKey.indexOf(UNIT_SEPARATOR);
  return i < 0 ? null : stableKey.slice(0, i);
}

const STRUCTURAL_KEY = /^(.*)#[a-z]+\d+(?: ~\d+)?$/;

/**
 * The heading-path prefix a local-tier `stableKey` was scoped under (its
 * enclosing section), or null when the key has no path (lead-in content, or
 * an AI-tier key namespaced by analysis unit — `unitOfKey`). Used only during
 * reconciliation (F38) to route newly *added* content to the existing object
 * for its section, never at first-run Visualize time: a section only counts
 * once it is itself matched to an existing object, which no node is on a
 * first run (see `update.ts`).
 */
export function parentSectionPath(stableKey: string): string | null {
  if (unitOfKey(stableKey)) return null;
  const path = STRUCTURAL_KEY.exec(stableKey)?.[1];
  return path ? path : null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Unique keys within one list: repeats get " ~2", " ~3", … */
function uniquer(): (key: string) => string {
  const seen = new Map<string, number>();
  return (key) => {
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return n > 1 ? `${key} ~${n}` : key;
  };
}

/** Role/type ordinal fallback: the 1st "cause", 2nd "cause", 1st "shape", … */
function ordinalKeyer(): (node: { role?: unknown; type?: unknown }) => string {
  const counts = new Map<string, number>();
  return (node) => {
    const label = typeof node.role === "string" && node.role ? node.role : typeof node.type === "string" ? node.type : "node";
    const n = counts.get(label) ?? 0;
    counts.set(label, n + 1);
    return `${label}#${n}`;
  };
}

export interface UnitReply {
  unitKey: string;
  /** One raw (not yet validated) `generate_visual_plan` reply. */
  raw: unknown;
}

/**
 * Merges one raw reply per analysis unit into a single raw plan for
 * `validateVisualPlan`. Entries stay untrusted: only ids and keys are
 * rewritten here, and relationships follow their nodes' new ids. `idPrefix`
 * keeps ids distinct from nodes reused from an earlier version (F38).
 */
export function mergeUnitPlans(template: string, replies: readonly UnitReply[], idPrefix = ""): unknown {
  const nodes: unknown[] = [];
  const relationships: unknown[] = [];
  let metadata: unknown;
  replies.forEach(({ unitKey, raw }, i) => {
    if (!isObject(raw)) return; // unusable; validateVisualPlan reports a plan with no nodes
    const ids = new Map<string, string>();
    const unique = uniquer();
    const fallback = ordinalKeyer();
    for (const node of Array.isArray(raw.nodes) ? raw.nodes : []) {
      if (!isObject(node) || typeof node.id !== "string") {
        nodes.push(node);
        continue;
      }
      const id = `${idPrefix}u${i}_${node.id}`;
      ids.set(node.id, id);
      const own = typeof node.stableKey === "string" && node.stableKey.trim() ? node.stableKey.trim() : fallback(node);
      nodes.push({ ...node, id, stableKey: unique(`${unitKey}${UNIT_SEPARATOR}${own}`) });
    }
    for (const rel of Array.isArray(raw.relationships) ? raw.relationships : []) {
      if (!isObject(rel)) {
        relationships.push(rel);
        continue;
      }
      // Endpoints follow their nodes; an unknown one is left as is, so validateVisualPlan reports it rather than it vanishing here.
      const from = typeof rel.from === "string" ? (ids.get(rel.from) ?? rel.from) : rel.from;
      const to = typeof rel.to === "string" ? (ids.get(rel.to) ?? rel.to) : rel.to;
      relationships.push({ ...rel, from, to });
    }
    if (!metadata && isObject(raw.metadata)) metadata = raw.metadata;
  });
  return { version: 1, template, nodes, relationships, ...(metadata ? { metadata } : {}) };
}

/** Every node with a unique, structural `stableKey` (existing keys kept; missing ones get a role/type ordinal). */
export function ensureStableKeys(plan: VisualPlan): VisualPlan {
  const unique = uniquer();
  const fallback = ordinalKeyer();
  const nodes = plan.nodes.map((n): VisualNode => ({ ...n, stableKey: unique(n.stableKey?.trim() || fallback(n)) }));
  return { ...plan, nodes };
}
