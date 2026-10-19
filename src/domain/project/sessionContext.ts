/**
 * `get_session_context`'s payload (plan §7.3, D29, D36, D37, D46, D48; contract rules C2, C4, C5, B2): the bounded
 * bootstrap an agent reads before a task. Pure: the workspace graph, the change log and the session records in;
 * the payload out. The tool only gathers its inputs.
 *
 * **Scope (D37)**, first that finds something: `keys` → `paths` (nodes whose sources cite them, D48) → `task` (a
 * name match over node keys and labels, then a keyword pass over every node's text — label, sublabel, details and
 * project fields, C6 — capped per object, C4) → the open tab's focus (the selection). `retrieval_mode` says which
 * one answered, and `degraded_reason` why it fell back (C2).
 *
 * **Budget (D29).** Its own, not Ask AI's: default 3,000 characters, at most 8,000 (D58). Sections fill in priority
 * order — warnings, project, architecture, decisions, open questions, in-progress items, annotations, recent changes,
 * recent rejections, pages — and each reports how many items it dropped. When scope resolution finds little or the
 * budget is tiny, the requested keys still come back, truncated to fit, rather than an empty bootstrap (C5).
 */
import { nodeFieldLines } from "@/domain/canvas/diagram";
import type { AgentChangeRecord, AgentSessionRecord } from "@/ai/changes/agentState";
import { questionTerms } from "@/search/ranking";
import { nodesCitingPaths } from "./impact";
import { annotationsOn, decisionView, decisionsOf, implementationPlan, openQuestionsOf, resolveProject, warningsFor, type ProjectRef } from "./knowledge";
import { addressesOf, ancestorsOf, resolve, type GraphNode, type WorkspaceGraph } from "./workspaceGraph";

/** D58: the session-context budget, defined once. */
export const SESSION_CONTEXT_BUDGET = { default: 3_000, max: 8_000, min: 1_000 } as const;
/** C4: keyword hits counted per object, so one large node can't win on volume. */
export const KEYWORD_HITS_PER_OBJECT = 3;
const MAX_SCOPE = 12;

export type RetrievalMode = "keys" | "paths" | "task" | "focus" | "none";

export interface SessionContextInput {
  task?: string;
  paths?: readonly string[];
  keys?: readonly string[];
  budget?: number;
  project?: string;
  /** Element ids the open tab has selected (the focus fallback). */
  focus?: readonly string[];
  /** Accepted, rejected and expired change records of the workspace, any order. */
  records: readonly AgentChangeRecord[];
  sessions: readonly AgentSessionRecord[];
  /** The calling session (its own record isn't "the previous session"). */
  session?: string;
  /** Pages an in-scope node links to: element id → `{ id, title }` (page previews it is connected to). */
  linkedPages?: (nodeIds: readonly string[]) => { id: string; title: string }[];
  /** B2: stop when this fires. */
  signal?: AbortSignal;
}

export class SessionContextAborted extends Error {
  constructor() {
    super("The request was cancelled.");
    this.name = "SessionContextAborted";
  }
}

interface Section<T> {
  items: T[];
  dropped: number;
}

export interface SessionContext {
  retrieval_mode: RetrievalMode;
  degraded_reason?: string;
  budget: number;
  chars: number;
  truncated: boolean;
  project?: { key: string; label: string; style?: string; focus?: string; lastNext?: string[]; lastSummary?: string } | { missing: string };
  warnings: Section<ReturnType<typeof warningsFor>[number]>;
  architecture: Section<{ key?: string; id: string; label: string; kind?: string; canvasId: string; within: string[] }>;
  decisions: Section<ReturnType<typeof decisionView>>;
  openQuestions: Section<{ key: string; kind: string; label: string; severity?: string }>;
  inProgress: Section<{ key: string; label: string; status: string; next?: boolean }>;
  annotations: Section<{ key: string; label: string; intent?: string; on: string[] }>;
  recentChanges: Section<{ id: string; title: string; agent?: string; at: number; reason?: string }>;
  recentRejections: Section<{ title: string; tool: string; at: number; reason?: string }>;
  pages: Section<{ id: string; title: string }>;
}

const nodeText = (n: GraphNode) => [n.label, n.key ?? "", ...nodeFieldLines({ customData: { acuteNode: { ...n.semantics, ...n.project } } })].join(" ").toLowerCase();

/** The architecture nodes a task names: by key or label first, else by keyword (each object's hits capped, C4). */
function taskScope(g: WorkspaceGraph, task: string): GraphNode[] {
  const t = task.toLowerCase();
  const arch = g.nodes.filter((n) => !isKnowledge(n));
  const named = arch.filter((n) => (n.key && t.includes(n.key.toLowerCase())) || (n.label.length > 2 && t.includes(n.label.toLowerCase())));
  if (named.length) return named.slice(0, MAX_SCOPE);
  const terms = questionTerms(task);
  if (!terms.length) return [];
  const scored = g.nodes
    .map((n) => {
      const text = nodeText(n);
      const hits = terms.reduce((sum, term) => sum + Math.min(KEYWORD_HITS_PER_OBJECT, text.split(term).length - 1), 0);
      return { n, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  // Knowledge nodes found by keyword stand in for what they concern.
  const out: GraphNode[] = [];
  for (const { n } of scored) {
    const targets = isKnowledge(n) ? (n.project?.refs ?? []).map((r) => resolve(g, r)).filter((x): x is GraphNode => x?.what === "node") : [n];
    for (const x of targets) if (!out.includes(x)) out.push(x);
    if (out.length >= MAX_SCOPE) break;
  }
  return out;
}

const KNOWLEDGE = new Set(["project", "decision", "constraint", "finding", "open_question", "risk", "milestone", "progress_item", "annotation"]);
const isKnowledge = (n: GraphNode) => !!n.kind && KNOWLEDGE.has(n.kind);

function resolveScope(g: WorkspaceGraph, input: SessionContextInput): { scope: GraphNode[]; mode: RetrievalMode; degraded?: string } {
  const tried: string[] = [];
  if (input.keys?.length) {
    const found = input.keys.map((k) => resolve(g, k)).filter((x): x is GraphNode => x?.what === "node");
    if (found.length) return { scope: found.slice(0, MAX_SCOPE), mode: "keys" };
    tried.push("none of the keys resolved");
  }
  if (input.paths?.length) {
    const found = nodesCitingPaths(g, input.paths);
    if (found.length) return { scope: found.slice(0, MAX_SCOPE), mode: "paths", ...(tried.length ? { degraded: tried.join("; ") } : {}) };
    tried.push("no node cites those paths");
  }
  if (input.task?.trim()) {
    const found = taskScope(g, input.task);
    if (found.length) return { scope: found, mode: "task", ...(tried.length ? { degraded: tried.join("; ") } : {}) };
    tried.push("nothing matched the task");
  }
  const focus = (input.focus ?? []).map((id) => resolve(g, id)).filter((x): x is GraphNode => x?.what === "node");
  if (focus.length) return { scope: focus.slice(0, MAX_SCOPE), mode: "focus", ...(tried.length ? { degraded: tried.join("; ") } : {}) };
  if (input.focus !== undefined || tried.length) tried.push(input.focus === undefined ? "no open tab to take focus from" : "nothing is selected in the open tab");
  return { scope: [], mode: "none", degraded: tried.join("; ") || "no task, paths, keys or focus given" };
}

/** Fills `section` from `items` while the running total stays within `room`; returns the new total. */
function fill<T>(items: readonly T[], used: number, room: number): { section: Section<T>; used: number } {
  const kept: T[] = [];
  let total = used;
  for (const item of items) {
    const size = JSON.stringify(item).length + 1;
    if (total + size > room) break;
    kept.push(item);
    total += size;
  }
  return { section: { items: kept, dropped: items.length - kept.length }, used: total };
}

export function sessionContext(g: WorkspaceGraph, input: SessionContextInput): SessionContext {
  const check = () => {
    if (input.signal?.aborted) throw new SessionContextAborted();
  };
  check();
  const budget = Math.max(SESSION_CONTEXT_BUDGET.min, Math.min(SESSION_CONTEXT_BUDGET.max, Math.round(input.budget ?? SESSION_CONTEXT_BUDGET.default)));
  const { scope, mode, degraded } = resolveScope(g, input);
  check();
  const resolution = resolveProject(g, input.project);
  const project: ProjectRef | undefined = resolution.ok ? resolution.project : undefined;
  const scopeRefs = scope.flatMap(addressesOf);
  const scopeSet = new Set(scopeRefs);

  const previous = [...input.sessions].filter((s) => s.id !== input.session && (s.next?.length || s.summary)).sort((a, b) => (b.lastWriteAt ?? b.startedAt) - (a.lastWriteAt ?? a.startedAt))[0];
  const projectInfo = project
    ? {
        key: project.key,
        label: project.label,
        ...(project.style ? { style: project.style } : {}),
        ...(project.focus ? { focus: project.focus } : {}),
        ...(previous?.next?.length ? { lastNext: previous.next } : {}),
        ...(previous?.summary ? { lastSummary: previous.summary } : {}),
      }
    : { missing: resolution.ok ? "" : resolution.message };

  const warnings = warningsFor(g, scopeRefs);
  const architecture = scope.map((n) => ({
    ...(n.key ? { key: n.key } : {}),
    id: n.id,
    label: n.label,
    ...(n.kind ? { kind: n.kind } : {}),
    canvasId: n.canvasId,
    within: ancestorsOf(g, n, 4).map((a) => (a.what === "node" ? a.label : a.title)),
  }));
  check();
  const decisions = project ? (scope.length ? decisionsOf(g, project).filter((d) => (d.project?.refs ?? []).some((r) => scopeSet.has(r)) || warnings.some((w) => w.key === d.ref)) : decisionsOf(g, project)).map(decisionView) : [];
  const questions = project
    ? openQuestionsOf(g, project, ["risk"])
        .filter((q) => !scope.length || (q.project?.refs ?? []).some((r) => scopeSet.has(r)) || !q.project?.refs?.length)
        .map((q) => ({ key: q.ref, kind: q.kind!, label: q.label, ...(q.project?.severity ? { severity: q.project.severity } : {}) }))
    : [];
  const plan = project ? implementationPlan(g, project) : { milestones: [], unassigned: [] };
  const inProgress = [...plan.milestones.flatMap((m) => m.items), ...plan.unassigned]
    .filter((i) => i.status === "in_progress" || i.status === "blocked" || i.next)
    .map((i) => ({ key: i.key, label: i.label, status: i.status, ...(i.next ? { next: true } : {}) }));
  const annotations = scope.flatMap((n) => annotationsOn(g, n).map((a) => ({ key: a.ref, label: a.label, ...(a.project?.intent ? { intent: a.project.intent } : {}), on: [n.ref] })));
  const touchedHere = (r: AgentChangeRecord) => !scope.length || r.touched.some((t) => scopeSet.has(t.elementId) || (t.key && scopeSet.has(t.key)));
  const newest = [...input.records].sort((a, b) => b.at - a.at);
  const recentChanges = newest
    .filter((r) => r.outcome === "accepted" && touchedHere(r))
    .slice(0, 10)
    .map((r) => ({ id: r.id, title: r.title, ...(r.agent ? { agent: r.agent } : {}), at: r.at, ...(r.reason ? { reason: r.reason } : {}) }));
  const recentRejections = newest
    .filter((r) => r.outcome === "rejected")
    .slice(0, 10)
    .map((r) => ({ title: r.title, tool: r.tool, at: r.at, ...(r.rejectReason ? { reason: r.rejectReason } : {}) }));
  const pages = input.linkedPages ? input.linkedPages(scope.map((n) => n.id)) : [];
  check();

  // C5: a scope from explicit keys always makes it back, at least as a truncated list.
  const fixedSize = JSON.stringify({ retrieval_mode: mode, degraded_reason: degraded, budget, chars: 0, truncated: true, project: projectInfo }).length + 300;
  let used = fixedSize;
  const out = {} as Pick<SessionContext, "warnings" | "architecture" | "decisions" | "openQuestions" | "inProgress" | "annotations" | "recentChanges" | "recentRejections" | "pages">;
  const order = [
    ["warnings", warnings],
    ["architecture", architecture],
    ["decisions", decisions],
    ["openQuestions", questions],
    ["inProgress", inProgress],
    ["annotations", annotations],
    ["recentChanges", recentChanges],
    ["recentRejections", recentRejections],
    ["pages", pages],
  ] as const;
  for (const [name, items] of order) {
    const r = fill(items as readonly unknown[], used, budget);
    (out as Record<string, Section<unknown>>)[name] = r.section;
    used = r.used;
  }
  if (mode === "keys" && !out.architecture.items.length && architecture.length) {
    out.architecture = { items: [{ id: architecture[0]!.id, label: architecture[0]!.label.slice(0, 80), canvasId: architecture[0]!.canvasId, within: [] }], dropped: architecture.length - 1 };
  }
  const dropped = Object.values(out).reduce((n, s) => n + s.dropped, 0);
  const payload: SessionContext = {
    retrieval_mode: mode,
    ...(degraded ? { degraded_reason: degraded } : {}),
    budget,
    chars: 0,
    truncated: dropped > 0,
    project: projectInfo,
    ...out,
  };
  // The estimate above is close, not exact: trim from the lowest-priority section until the payload fits for certain.
  const size = () => JSON.stringify({ ...payload, chars: budget }).length;
  for (let i = order.length - 1; i >= 0 && size() > budget; ) {
    const s = (payload as unknown as Record<string, Section<unknown>>)[order[i]![0]]!;
    if (!s.items.length) {
      i--;
      continue;
    }
    s.items.pop();
    s.dropped++;
    payload.truncated = true;
  }
  if (size() > budget && payload.project && "key" in payload.project) {
    const { lastNext: _n, lastSummary: _s, focus: _f, ...rest } = payload.project;
    payload.project = rest;
    payload.truncated = true;
  }
  payload.chars = JSON.stringify(payload).length;
  return payload;
}
