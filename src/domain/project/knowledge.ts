/**
 * Project knowledge read from the workspace graph (plan §3.6, D33–D39, D45, D53): projects and their scope, decisions
 * with their annotations, open questions, the implementation plan, and the **warnings** — the "decision firewall"
 * (D36) with documented deviations (D45). Pure; what the Phase 7B tools and resources return.
 *
 * - **Scope (D39).** A project-knowledge node belongs to the project whose key is in its `project` field; a `project`
 *   node is its own project. A workspace may hold several; a call that doesn't name one gets the only one, and is
 *   refused with a clear message when there are several.
 * - **Warnings (D36).** A warning is a constraint (not proposed, not superseded), or an accepted decision with
 *   `enforce: true`, whose `refs` include a node in scope or one of its ancestors. Superseded decisions — by status, or
 *   named in an accepted decision's `supersedes` — never warn.
 * - **Deviations (D45).** An accepted decision that `deviatesFrom` a warning's decision, and whose `refs` include an
 *   in-scope node or ancestor, is attached to that warning ("allowed here by …"); elsewhere the warning stands as is.
 */
import type { NodeProject } from "@/domain/canvas/nodeProject";
import { addressesOf, ancestorsOf, resolve, type GraphNode, type WorkspaceGraph } from "./workspaceGraph";

export interface ProjectRef {
  key: string;
  label: string;
  canvasId: string;
  elementId: string;
  style?: NodeProject["style"];
  focus?: string;
}

const kindOf = (n: GraphNode) => n.kind;

/** Every `project` node in the workspace. A project node needs a key to scope anything (D39). */
export function listProjects(g: WorkspaceGraph): ProjectRef[] {
  return g.nodes
    .filter((n) => kindOf(n) === "project")
    .map((n) => ({ key: n.ref, label: n.label, canvasId: n.canvasId, elementId: n.id, ...(n.project?.style ? { style: n.project.style } : {}), ...(n.project?.focus ? { focus: n.project.focus } : {}) }));
}

export type ProjectResolution = { ok: true; project: ProjectRef } | { ok: false; reason: "none" | "several" | "unknown"; message: string; projects: ProjectRef[] };

/** The project a call means: the one named, else the workspace's only one (D39). */
export function resolveProject(g: WorkspaceGraph, wanted?: string): ProjectResolution {
  const projects = listProjects(g);
  if (wanted) {
    const target = resolve(g, wanted);
    const p = projects.find((x) => x.key === wanted || x.elementId === wanted || (target && x.elementId === target.id) || x.label.toLowerCase() === wanted.toLowerCase());
    return p ? { ok: true, project: p } : { ok: false, reason: "unknown", message: `No project "${wanted}" in this workspace. list_projects lists them.`, projects };
  }
  if (projects.length === 1) return { ok: true, project: projects[0]! };
  if (!projects.length) return { ok: false, reason: "none", message: "This workspace has no project yet. Ask the user, then run the initialize_project prompt (or create_project).", projects };
  return { ok: false, reason: "several", message: `This workspace has ${projects.length} projects (${projects.map((p) => p.key).join(", ")}); pass \`project\`.`, projects };
}

/** The project-knowledge nodes of a project (the project node itself excluded). */
export function projectMembers(g: WorkspaceGraph, project: ProjectRef): GraphNode[] {
  const addrs = new Set([project.key, project.elementId]);
  return g.nodes.filter((n) => n.id !== project.elementId && n.project?.project && addrs.has(n.project.project));
}

const isDecision = (n: GraphNode) => kindOf(n) === "decision" || kindOf(n) === "constraint";

/** Decisions this graph has retired: superseded by status, or named in an accepted decision's `supersedes`. */
function retired(g: WorkspaceGraph): Set<string> {
  const out = new Set<string>();
  for (const n of g.nodes) {
    if (!isDecision(n)) continue;
    if (n.project?.status === "superseded") for (const a of addressesOf(n)) out.add(a);
    if (n.project?.status !== "proposed") for (const s of n.project?.supersedes ?? []) {
      const t = resolve(g, s);
      for (const a of t ? addressesOf(t) : [s]) out.add(a);
    }
  }
  return out;
}

/** Whether a decision node raises warnings at all (D36). */
export function isBinding(n: GraphNode, retiredSet?: ReadonlySet<string>): boolean {
  if (!isDecision(n)) return false;
  if (retiredSet && addressesOf(n).some((a) => retiredSet.has(a))) return false;
  const status = n.project?.status;
  if (kindOf(n) === "constraint") return status !== "proposed" && status !== "superseded";
  return status === "accepted" && n.project?.enforce === true;
}

export interface Warning {
  /** The constraint's or decision's ref. */
  key: string;
  kind: "constraint" | "decision";
  /** One line: its label. */
  statement: string;
  reason?: string;
  /** The in-scope addresses (or ancestors) its `refs` hit. */
  appliesTo: string[];
  /** A documented exception covering this scope (D45). */
  deviation?: { key: string; statement: string; reason?: string };
}

/** Every address in scope: the scope's targets and, for each, its ancestors (D36's "or its ancestors"). */
export function scopeAddresses(g: WorkspaceGraph, scope: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of scope) {
    const t = resolve(g, s);
    if (!t) {
      out.add(s);
      continue;
    }
    for (const a of addressesOf(t)) out.add(a);
    for (const anc of ancestorsOf(g, t)) for (const a of addressesOf(anc)) out.add(a);
  }
  return out;
}

/** The warnings for a scope (D36), with deviations attached where they apply (D45). Empty scope: none. */
export function warningsFor(g: WorkspaceGraph, scope: readonly string[]): Warning[] {
  if (!scope.length) return [];
  const addrs = scopeAddresses(g, scope);
  const gone = retired(g);
  const out: Warning[] = [];
  for (const n of g.nodes) {
    if (!isBinding(n, gone)) continue;
    const hits = (n.project?.refs ?? []).filter((r) => addrs.has(r));
    if (!hits.length) continue;
    const mine = new Set(addressesOf(n));
    const deviation = g.nodes.find(
      (d) => isDecision(d) && d.project?.status === "accepted" && d.project.deviatesFrom?.some((x) => mine.has(x)) && (d.project.refs ?? []).some((r) => addrs.has(r)),
    );
    out.push({
      key: n.ref,
      kind: kindOf(n) === "constraint" ? "constraint" : "decision",
      statement: n.label,
      ...(n.project?.reason ? { reason: n.project.reason } : {}),
      appliesTo: hits,
      ...(deviation ? { deviation: { key: deviation.ref, statement: deviation.label, ...(deviation.project?.reason ? { reason: deviation.project.reason } : {}) } } : {}),
    });
  }
  return out;
}

/** Annotations (D35) bound to a node through `refs`. */
export function annotationsOn(g: WorkspaceGraph, target: GraphNode): GraphNode[] {
  const addrs = new Set(addressesOf(target));
  return g.nodes.filter((n) => kindOf(n) === "annotation" && n.project?.refs?.some((r) => addrs.has(r)));
}

/** A decision's chosen option, options, and the derived rejected ones (D34). */
export function decisionView(n: GraphNode) {
  const p = n.project ?? {};
  const options = p.options ?? [];
  return {
    key: n.ref,
    id: n.id,
    kind: kindOf(n) as "decision" | "constraint",
    statement: n.label,
    status: p.status ?? "proposed",
    ...(p.reason ? { reason: p.reason } : {}),
    ...(options.length ? { options } : {}),
    ...(p.chosen ? { chosen: p.chosen, rejected: options.filter((o) => o.label !== p.chosen).map((o) => o.label) } : {}),
    ...(p.enforce ? { enforce: true } : {}),
    refs: p.refs ?? [],
    ...(p.supersedes?.length ? { supersedes: p.supersedes } : {}),
    ...(p.deviatesFrom?.length ? { deviatesFrom: p.deviatesFrom } : {}),
    canvasId: n.canvasId,
  };
}

/**
 * Decisions and constraints of a project, newest first (by scene order: later is newer), optionally only those whose
 * `refs` hit `about` (an address) or its ancestors.
 */
export function decisionsOf(g: WorkspaceGraph, project: ProjectRef, about?: string): GraphNode[] {
  const all = projectMembers(g, project).filter(isDecision).reverse();
  if (!about) return all;
  const addrs = scopeAddresses(g, [about]);
  return all.filter((n) => (n.project?.refs ?? []).some((r) => addrs.has(r)));
}

/** Open questions (and, when asked, risks and unvalidated findings) of a project. */
export function openQuestionsOf(g: WorkspaceGraph, project: ProjectRef, include: readonly ("risk" | "finding")[] = []): GraphNode[] {
  return projectMembers(g, project).filter((n) => {
    const k = kindOf(n);
    if (k === "open_question") return n.project?.status !== "answered";
    if (k === "risk") return include.includes("risk");
    if (k === "finding") return include.includes("finding") && n.project?.stage !== "validated";
    return false;
  });
}

export interface PlanMilestone {
  key: string;
  label: string;
  order?: number;
  items: { key: string; label: string; status: string; order?: number; next?: boolean }[];
}

/** Milestones in order, each with its progress items (those whose `refs` name it) in order; loose items last (D33). */
export function implementationPlan(g: WorkspaceGraph, project: ProjectRef): { milestones: PlanMilestone[]; unassigned: PlanMilestone["items"] } {
  const members = projectMembers(g, project);
  const byOrder = (a: GraphNode, b: GraphNode) => (a.project?.order ?? Infinity) - (b.project?.order ?? Infinity);
  const item = (n: GraphNode) => ({ key: n.ref, label: n.label, status: n.project?.status ?? "not_started", ...(n.project?.order !== undefined ? { order: n.project.order } : {}), ...(n.project?.next ? { next: true } : {}) });
  const items = members.filter((n) => kindOf(n) === "progress_item");
  const placed = new Set<string>();
  const milestones = members
    .filter((n) => kindOf(n) === "milestone")
    .sort(byOrder)
    .map((m) => {
      const addrs = new Set(addressesOf(m));
      const mine = items.filter((i) => !placed.has(i.id) && i.project?.refs?.some((r) => addrs.has(r))).sort(byOrder);
      for (const i of mine) placed.add(i.id);
      return { key: m.ref, label: m.label, ...(m.project?.order !== undefined ? { order: m.project.order } : {}), items: mine.map(item) };
    });
  return { milestones, unassigned: items.filter((i) => !placed.has(i.id)).sort(byOrder).map(item) };
}
