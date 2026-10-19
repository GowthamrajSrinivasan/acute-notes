/**
 * Agent State (plan: .ai/docs/acute-lens-plan.md §3.7, D28, D30–D32, D44, D46, D61): the change log and session
 * records about the canvas, kept apart from it. History about the canvas, never a fact source (D2): nothing here is
 * read to decide what is true.
 *
 * Pure and renderer-agnostic: the browser service (`state/agentLog.ts`) and a hosted server later (D41) both build
 * records with these functions and store them as plain JSON.
 *
 * - **The inverse is a scene diff.** A change set is written in one scene update, so the before-state is exactly
 *   "every element that write added, and every element it changed, as it was". Diffing the scene before and after
 *   the write captures labels, bound arrows, a frame that grew and a composite shape's outline along with the
 *   objects the changes name, which a per-change-kind inverse would have to know about one by one.
 * - **Revert is an ordinary change set** (D30, D43): `remove` for what the change added, `restore` for what it
 *   changed, newest first, and a conflict (F39) for any element changed since, never overwritten silently.
 */
import { redactSecrets } from "@/ai/context/redact";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getNodeLens } from "@/domain/canvas/diagram";
import { MAX_ARGS_CHARS, MAX_CHANGES, MAX_SNAPSHOT_CHARS, type ChangeSet, type ConflictItem, type ProposedChange, type StoredElementSnapshot } from "./changeSet";

/** D58: every Agent State limit, defined once. */
export const AGENT_STATE_LIMITS = {
  /** A record keeps its inverse (stays revertible) while it is among the newest `records`, or younger than `days`. */
  records: 500,
  days: 30,
  /** Past twice those bounds a record goes altogether (between them it is listed but no longer revertible). */
  listFactor: 2,
  /** `args`, at most (D46). */
  argsChars: MAX_ARGS_CHARS,
  /** One record's inverse, as JSON, at most; a larger one isn't kept (the record is then not revertible). */
  inverseChars: 2_000_000,
} as const;

const DAY_MS = 86_400_000;

export type ChangeOutcome = "accepted" | "rejected" | "expired";

export interface TouchedElement {
  elementId: string;
  /** The node's Lens key (D13), when it has one. */
  key?: string;
  op: "create" | "update" | "remove";
  /** The element's version right after the change: a later version means it was edited since (D30). */
  afterVersion?: number;
}

export type InverseChange =
  /** Undo a create. */
  | { op: "remove"; elementId: string }
  /** Undo an update or a removal: the element as it was, through the `restore` change kind (D43). */
  | { op: "restore"; element: StoredElementSnapshot };

export interface AgentChangeRecord {
  id: string;
  workspaceId: string;
  canvasId: string;
  /** `ChangeSet.operationId`: links to `metadata.ai.operationId` on the objects it created. */
  operationId: string;
  /** The MCP client's name as the client reports it (D32, D61); absent for in-app AI. Never trusted for anything. */
  agent?: string;
  /** D61: reserved for per-client tokens; unset today. */
  credentialId?: string;
  session?: string;
  /** The tool (or in-app task) that produced the set. */
  tool: string;
  at: number;
  outcome: ChangeOutcome;
  /** D46: a bounded, redacted summary of the tool input. */
  args?: string;
  result?: "applied" | "partial" | "conflicts" | "refused";
  title: string;
  reason?: string;
  /** Why the user rejected it, when they said (D46: one optional line). */
  rejectReason?: string;
  touched: TouchedElement[];
  /** D30: enough to propose the undo as a change set. Empty for rejected and expired proposals, and once dropped. */
  inverse: InverseChange[];
  /** Whether `inverse` can still be proposed (false once retention dropped it, or when it was too large to keep). */
  revertible: boolean;
  /** The record id of an accepted revert of this change. */
  revertedBy?: string;
  /** For a revert: the records it reverted. */
  reverts?: string[];
}

export interface AgentSessionRecord {
  /** The MCP session id (or a repo-map session id). */
  id: string;
  workspaceId: string;
  agent?: string;
  /** D61: reserved, unset today. */
  credentialId?: string;
  project?: string;
  startedAt: number;
  lastWriteAt?: number;
  endedAt?: number;
  /** From `sync_session` (D38, Phase 7B). */
  summary?: string;
  changed?: { path: string; what: string }[];
  next?: string[];
  /** Its change records. */
  changeIds: string[];
  /** D46: calls and characters returned, per tool. Nothing is limited or metered. */
  usage?: Record<string, { calls: number; chars: number }>;
}

// ---------------------------------------------------------------------------
// The inverse: a diff of the scene around one write
// ---------------------------------------------------------------------------

type El = Pick<SceneElement, "id" | "isDeleted" | "customData"> & { version?: number };

/** A plain, JSON-safe copy of an element (what a restore puts back). */
export function snapshotOf(el: object): StoredElementSnapshot {
  return JSON.parse(JSON.stringify(el)) as StoredElementSnapshot;
}

export interface SceneDiff {
  touched: TouchedElement[];
  inverse: InverseChange[];
}

/**
 * What one write did to the scene: elements it added (undone by removing them) and elements it changed or deleted
 * (undone by restoring them as they were). `before` and `after` include deleted elements.
 */
export function diffScenes(before: readonly El[], after: readonly El[]): SceneDiff {
  const was = new Map(before.map((e) => [e.id, e] as const));
  const touched: TouchedElement[] = [];
  const inverse: InverseChange[] = [];
  for (const el of after) {
    const prev = was.get(el.id);
    const key = getNodeLens(el)?.key ?? (prev ? getNodeLens(prev)?.key : undefined);
    const base = { elementId: el.id, ...(key ? { key } : {}), ...(el.version !== undefined ? { afterVersion: el.version } : {}) };
    if (!prev) {
      if (el.isDeleted) continue;
      touched.push({ ...base, op: "create" });
      inverse.push({ op: "remove", elementId: el.id });
    } else if (prev !== el && prev.version !== el.version) {
      touched.push({ ...base, op: el.isDeleted && !prev.isDeleted ? "remove" : "update" });
      inverse.push({ op: "restore", element: snapshotOf(prev) });
    }
  }
  return { touched, inverse };
}

/** Caps an inverse (D30: "snapshots are capped per record"): one too large isn't kept, and the change isn't revertible. */
export function boundedInverse(inverse: readonly InverseChange[]): { inverse: InverseChange[]; revertible: boolean } {
  const tooBig = inverse.some((i) => i.op === "restore" && JSON.stringify(i.element).length > MAX_SNAPSHOT_CHARS) || JSON.stringify(inverse).length > AGENT_STATE_LIMITS.inverseChars;
  return tooBig ? { inverse: [], revertible: false } : { inverse: [...inverse], revertible: inverse.length > 0 };
}

/** D46: a tool input as a bounded, redacted one-line summary. */
export function summarizeArgs(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  let text: string;
  try {
    text = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    return undefined;
  }
  if (!text) return undefined;
  const clean = redactSecrets(text).replace(/\s+/g, " ");
  return clean.length > AGENT_STATE_LIMITS.argsChars ? `${clean.slice(0, AGENT_STATE_LIMITS.argsChars - 1)}…` : clean;
}

/** The tool (or task) a set came from, for the record. */
export function toolOf(set: Pick<ChangeSet, "metadata">): string {
  return set.metadata.task ?? set.metadata.createdBy;
}

/** A record for a change set's outcome. Rejected and expired proposals keep no inverse (D46). */
export function changeRecord(input: {
  id: string;
  workspaceId: string;
  canvasId: string;
  set: ChangeSet;
  at: number;
  outcome: ChangeOutcome;
  diff?: SceneDiff;
  result?: AgentChangeRecord["result"];
  rejectReason?: string;
}): AgentChangeRecord {
  const { set } = input;
  const accepted = input.outcome === "accepted";
  const { inverse, revertible } = accepted && input.diff ? boundedInverse(input.diff.inverse) : { inverse: [], revertible: false };
  const reason = input.rejectReason?.replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    canvasId: input.canvasId,
    operationId: set.operationId,
    ...(set.agent ? { agent: set.agent } : {}),
    ...(set.session ? { session: set.session } : {}),
    tool: toolOf(set),
    at: input.at,
    outcome: input.outcome,
    ...(set.args ? { args: set.args } : {}),
    ...(input.result ? { result: input.result } : {}),
    title: set.title,
    ...(set.reason ? { reason: set.reason } : {}),
    ...(reason ? { rejectReason: reason } : {}),
    touched: accepted ? (input.diff?.touched ?? []) : [],
    inverse,
    revertible,
    ...(set.reverts?.length ? { reverts: [...set.reverts] } : {}),
  };
}

// ---------------------------------------------------------------------------
// Retention (D31, D58)
// ---------------------------------------------------------------------------

/**
 * Bounds one workspace's records: the newest `records` or those younger than `days` (whichever keeps more) stay
 * revertible; older ones lose their inverse first (still listed), and past `listFactor` times those bounds they go.
 */
export function retain(records: readonly AgentChangeRecord[], now: number): { keep: AgentChangeRecord[]; drop: string[]; stripped: string[] } {
  const { records: n, days, listFactor } = AGENT_STATE_LIMITS;
  const newest = [...records].sort((a, b) => b.at - a.at);
  const keep: AgentChangeRecord[] = [];
  const drop: string[] = [];
  const stripped: string[] = [];
  newest.forEach((r, i) => {
    const age = now - r.at;
    if (i < n || age < days * DAY_MS) keep.push(r);
    else if (i < n * listFactor || age < days * listFactor * DAY_MS) {
      if (r.inverse.length || r.revertible) {
        stripped.push(r.id);
        keep.push({ ...r, inverse: [], revertible: false });
      } else keep.push(r);
    } else drop.push(r.id);
  });
  return { keep, drop, stripped };
}

// ---------------------------------------------------------------------------
// Revert (D30)
// ---------------------------------------------------------------------------

export interface RevertPlan {
  changes: ProposedChange[];
  conflicts: ConflictItem[];
  /** Records left out, with why. */
  skipped: { id: string; why: "not_accepted" | "not_revertible" | "already_reverted" }[];
}

type LiveEl = Pick<SceneElement, "id" | "isDeleted"> & { version?: number; text?: string; originalText?: string; containerId?: string | null };

/**
 * The changes that undo `records` against the scene as it is now. Per element, the oldest record's inverse wins
 * (that is the state before all of them); an element whose version moved past the newest record's `afterVersion`
 * was edited since and becomes a conflict instead. A removal of something already gone is dropped (nothing to undo).
 */
export function planRevert(records: readonly AgentChangeRecord[], scene: readonly LiveEl[]): RevertPlan {
  const skipped: RevertPlan["skipped"] = [];
  const usable = records.filter((r) => {
    if (r.outcome !== "accepted") skipped.push({ id: r.id, why: "not_accepted" });
    else if (r.revertedBy) skipped.push({ id: r.id, why: "already_reverted" });
    else if (!r.revertible || !r.inverse.length) skipped.push({ id: r.id, why: "not_revertible" });
    else return true;
    return false;
  });
  const oldestFirst = [...usable].sort((a, b) => a.at - b.at);
  const inverseFor = new Map<string, InverseChange>();
  const lastVersion = new Map<string, number>();
  /** What the newest of these changes did to each element: a removal leaves it out of a live scene on purpose. */
  const lastOp = new Map<string, TouchedElement["op"]>();
  for (const r of oldestFirst) {
    for (const inv of r.inverse) {
      const id = inv.op === "remove" ? inv.elementId : inv.element.id;
      if (!inverseFor.has(id)) inverseFor.set(id, inv);
    }
    for (const t of r.touched) {
      if (t.afterVersion !== undefined) lastVersion.set(t.elementId, t.afterVersion);
      lastOp.set(t.elementId, t.op);
    }
  }
  const live = new Map(scene.map((e) => [e.id, e] as const));
  const labels = new Map(scene.flatMap((e) => (!e.isDeleted && e.containerId ? [[e.containerId, (e.originalText ?? e.text ?? "").trim()] as const] : [])));
  const changes: ProposedChange[] = [];
  const conflicts: ConflictItem[] = [];
  for (const [id, inv] of inverseFor) {
    const now = live.get(id);
    const since = lastVersion.get(id);
    // Edited since: a later version; or gone from a scene that lists only live elements although these changes left
    // it in place (someone deleted it afterwards). Never overwritten either way (D30).
    const deletedSince = (!now || now.isDeleted) && inv.op === "restore" && lastOp.get(id) !== "remove" && (!now || (since !== undefined && (now.version ?? 0) > since));
    const edited = deletedSince || (!!now && !now.isDeleted && since !== undefined && (now.version ?? 0) > since);
    let change: ProposedChange | null;
    if (inv.op === "remove") change = now && !now.isDeleted ? { kind: "remove", target: id } : null;
    else change = { kind: "restore", target: id, element: inv.element };
    if (!change) continue;
    if (edited) {
      const name = labels.get(id) || (now?.originalText ?? now?.text)?.trim() || undefined;
      conflicts.push({ target: id, apply: change as ConflictItem["apply"], ...(name ? { name } : {}) });
    } else changes.push(change);
  }
  return { changes: changes.slice(0, MAX_CHANGES), conflicts: withBoundLabels(conflicts, live, inverseFor).slice(0, MAX_CHANGES), skipped };
}

/**
 * One card for a shape and its bound label (a hand move bumps both): a label whose container is in conflict too is
 * decided with it. Removing the container removes its label anyway, so that label's own removal is dropped; a
 * restore travels in the container's `alsoApply`.
 */
function withBoundLabels(conflicts: ConflictItem[], live: ReadonlyMap<string, LiveEl>, inverseFor: ReadonlyMap<string, InverseChange>): ConflictItem[] {
  const byTarget = new Map(conflicts.map((c) => [c.target, c] as const));
  const containerOf = (id: string): string | undefined => {
    const now = live.get(id)?.containerId;
    if (now) return now;
    const inv = inverseFor.get(id);
    const before = inv?.op === "restore" ? (inv.element as { containerId?: unknown }).containerId : undefined;
    return typeof before === "string" ? before : undefined;
  };
  const folded = new Set<string>();
  for (const c of conflicts) {
    const containerId = containerOf(c.target);
    const host = containerId ? byTarget.get(containerId) : undefined;
    if (!host || folded.has(host.target)) continue;
    if (host.apply.kind === "remove" && c.apply.kind === "remove") folded.add(c.target);
    else if (host.apply.kind === "restore") {
      host.alsoApply = [...(host.alsoApply ?? []), c.apply as Extract<ProposedChange, { kind: "restore" | "remove" }>];
      folded.add(c.target);
    }
  }
  return conflicts.filter((c) => !folded.has(c.target));
}

// ---------------------------------------------------------------------------
// Auto-accept (D44)
// ---------------------------------------------------------------------------

/**
 * Whether a set may be auto-accepted for a session the user switched it on for (D44): never one that removes or
 * restores anything, adds or turns a node into a `constraint`, or sets `enforce` (those bind later agents through
 * warnings, D36), and never one with conflicts.
 */
export function autoAcceptable(set: Pick<ChangeSet, "changes" | "conflicts">): boolean {
  if (set.conflicts?.length) return false;
  return set.changes.every((c) => {
    if (c.kind === "remove" || c.kind === "restore") return false;
    if (c.kind === "create_shape" && (c.semantics?.kind === "constraint" || c.project?.kind === "constraint" || c.project?.enforce === true)) return false;
    if (c.kind === "update_node" && (c.semantics.kind === "constraint" || c.semantics.enforce === true)) return false;
    return true;
  });
}
