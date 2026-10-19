/**
 * Proposed state on a Lens level (plan §8.2, D3): what the change sets waiting for review would do to this level,
 * kept apart from its nodes and edges — Lens draws it over the current graph, never merged into it. Pure, like
 * `lensView`.
 *
 * - **Added** (`+ NEW`): an object a set creates inside this level's frame (its box centre in the frame), or adds to
 *   it (`update_frame`), with the links it draws between this level's nodes and the added ones.
 * - **Changed** (`~ changed`): a node a set updates, moves, relabels, restores or relinks; a conflict on it (the
 *   user's input is needed) counts too. An edge a set updates.
 * - **Removed** (`− removed`): a node or an edge a set removes.
 *
 * A new section (`create_frame`) is a new level, not part of this one: its cards are left out here.
 */
import type { ChangeSet, ChangeTarget, ProposedChange } from "@/ai/changes/changeSet";
import type { NodeKind } from "@/domain/canvas/diagram";
import { deriveTitle } from "@/domain/content/richContent";
import type { LensLevelView } from "./lensView";

type Box = LensLevelView["box"];

export interface LensGhostNode {
  /** The change's key in its set (unique per set). */
  key: string;
  label: string;
  box: Box;
  kind?: NodeKind;
  operationId: string;
}

export interface LensGhostEdge {
  key: string;
  /** Each end: an existing node's id, or an added ghost's key. */
  from: string;
  to: string;
  label?: string;
  operationId: string;
}

export interface LensPendingView {
  added: LensGhostNode[];
  addedEdges: LensGhostEdge[];
  /** Node key → what changes ("label", "fields", "moved", "conflict", …), in order, each once. */
  changed: ReadonlyMap<string, string[]>;
  /** Node keys. */
  removed: ReadonlySet<string>;
  changedEdges: ReadonlySet<string>;
  removedEdges: ReadonlySet<string>;
  /** The sets that touch this level, in the order given, with how many of their changes do. */
  sets: { operationId: string; title: string; count: number }[];
  /** Everything above, counted once per ghost: what a `3Δ` says. */
  count: number;
}

const WHAT: Partial<Record<ProposedChange["kind"], string>> = {
  update_shape: "label",
  update_block: "content",
  update_node: "fields",
  move: "moved",
  set_lens: "zoom-in link",
  restore: "restored",
  group_objects: "grouped",
};

const centreIn = (b: Box, frame: Box) => {
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  return x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height;
};

function ghostLabel(c: Extract<ProposedChange, { kind: "create_shape" | "create_block" | "create_page" }>): string {
  if (c.kind === "create_shape") return c.label || c.shape;
  if (c.kind === "create_page") return c.title;
  return deriveTitle(c.content, "Note");
}

/** The pending state of `view`'s level from `sets` (the ones waiting on its canvas); undefined when none touch it. */
export function lensPending(view: Pick<LensLevelView, "frame" | "box" | "nodes" | "edges" | "source">, sets: readonly ChangeSet[]): LensPendingView | undefined {
  if (view.source) return undefined;
  const keyOfNode = new Map(view.nodes.map((n) => [n.id, n.key] as const));
  const edgeIds = new Set(view.edges.map((e) => e.id));
  const added: LensGhostNode[] = [];
  const addedEdges: LensGhostEdge[] = [];
  const changed = new Map<string, string[]>();
  const removed = new Set<string>();
  const changedEdges = new Set<string>();
  const removedEdges = new Set<string>();
  const perSet: LensPendingView["sets"] = [];
  const note = (key: string, what: string) => {
    const list = changed.get(key) ?? [];
    if (!list.includes(what)) changed.set(key, [...list, what]);
  };

  for (const set of sets) {
    let count = 0;
    // Objects created inside a new section belong to that section's level, not this one.
    const inNewSection = new Set(set.changes.flatMap((c) => (c.kind === "create_frame" ? c.children : [])));
    const joining = new Set(set.changes.flatMap((c) => (c.kind === "update_frame" && c.target === view.frame.frameId ? c.add : [])));
    const ghostKeys = new Set<string>();
    for (const c of set.changes) {
      if (c.kind === "create_shape" || c.kind === "create_block" || c.kind === "create_page") {
        if (inNewSection.has(c.key)) continue;
        if (!joining.has(c.key) && !centreIn(c.box, view.box)) continue;
        const kind = c.kind === "create_page" ? undefined : c.semantics?.kind;
        added.push({ key: `${set.operationId}:${c.key}`, label: ghostLabel(c), box: c.box, ...(kind ? { kind } : {}), operationId: set.operationId });
        ghostKeys.add(c.key);
        count++;
      } else if (c.kind === "remove") {
        const key = keyOfNode.get(c.target);
        if (key !== undefined) removed.add(key);
        else if (edgeIds.has(c.target)) removedEdges.add(c.target);
        else continue;
        count++;
      } else if (c.kind === "update_connection") {
        if (!edgeIds.has(c.target)) continue;
        changedEdges.add(c.target);
        count++;
      } else if (c.kind === "group_objects") {
        const hits = c.targets.filter((t) => keyOfNode.has(t));
        hits.forEach((t) => note(keyOfNode.get(t)!, "grouped"));
        if (hits.length) count++;
      } else if ("target" in c && WHAT[c.kind]) {
        const key = keyOfNode.get(c.target);
        if (key === undefined) continue;
        note(key, WHAT[c.kind]!);
        count++;
      }
    }
    // Links drawn between this level's nodes and its added ghosts (ends elsewhere aren't drawn here).
    const end = (t: ChangeTarget): string | undefined =>
      "existing" in t ? (keyOfNode.has(t.existing) ? t.existing : undefined) : ghostKeys.has(t.created) ? `${set.operationId}:${t.created}` : undefined;
    for (const c of set.changes) {
      if (c.kind !== "connect") continue;
      const from = end(c.from);
      const to = end(c.to);
      if (!from || !to) continue;
      addedEdges.push({ key: `${set.operationId}:${c.key}`, from, to, ...(c.label ? { label: c.label } : {}), operationId: set.operationId });
      count++;
    }
    for (const conflict of set.conflicts ?? []) {
      const key = keyOfNode.get(conflict.target);
      if (key === undefined) continue;
      note(key, "conflict");
      count++;
    }
    if (count) perSet.push({ operationId: set.operationId, title: set.title, count });
  }
  if (!perSet.length) return undefined;
  const count = added.length + addedEdges.length + changed.size + removed.size + changedEdges.size + removedEdges.size;
  return { added, addedEdges, changed, removed, changedEdges, removedEdges, sets: perSet, count };
}

type FrameEl = { id: string; type: string; frameId?: string | null; isDeleted?: boolean; containerId?: string | null; x: number; y: number; width: number; height: number };

/**
 * For the canvas frame chip's `Δ` (plan §5.3): how many pending changes touch each frame — an object in it changed or
 * removed, an object created inside it or added to it. A bound label counts as its container.
 */
export function pendingFrames(sets: readonly ChangeSet[], elements: readonly FrameEl[]): Map<string, number> {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e] as const));
  const frames = live.filter((e) => e.type === "frame");
  const frameOf = (id: string): string | undefined => {
    const el = byId.get(id);
    const host = el?.containerId ? byId.get(el.containerId) : el;
    return host?.type === "frame" ? host.id : (host?.frameId ?? undefined);
  };
  const counts = new Map<string, number>();
  const bump = (frameId: string | undefined) => frameId && counts.set(frameId, (counts.get(frameId) ?? 0) + 1);
  for (const set of sets) {
    const inNewSection = new Set(set.changes.flatMap((c) => (c.kind === "create_frame" ? c.children : [])));
    const joined = new Map(set.changes.flatMap((c) => (c.kind === "update_frame" ? c.add.map((k) => [k, c.target] as const) : [])));
    for (const c of set.changes) {
      if (c.kind === "create_shape" || c.kind === "create_block" || c.kind === "create_page") {
        if (inNewSection.has(c.key)) continue;
        bump(joined.get(c.key) ?? frames.find((f) => centreIn(c.box, f))?.id);
      } else if (c.kind === "update_frame") {
        if (!c.add.length) bump(c.target);
      } else if (c.kind === "group_objects") {
        bump(c.targets.map(frameOf).find(Boolean));
      } else if ("target" in c) bump(frameOf(c.target));
    }
    for (const conflict of set.conflicts ?? []) bump(frameOf(conflict.target));
  }
  return counts;
}
