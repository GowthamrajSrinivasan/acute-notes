/**
 * Accepting parts of a merged change set (F43's mapping session) on the live
 * canvas: the review bar's "Accept all" and "Accept section", and a session
 * the user switched to auto-accept. The chosen parts are written as one undo
 * step (`acceptParts`), each part's content version is recorded (F37), and
 * whatever is left stays under review.
 */
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { describeChanges, describeDropped, type ChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { getOperationLog } from "@/ai/changes/operations";
import type { PartDecision } from "@/ai/changes/parts";
import { withDecisions, type ConflictDecision } from "@/ai/reconcile/conflicts";
import { APP_SESSION, getPendingChanges, slotOf } from "@/ai/changes/pendingChanges";
import { afterAccept } from "@/ai/changes/staleTarget";
import { recordPartlyAppliedSource } from "@/ai/content/sources";
import { saveSourceOutcomes } from "@/ai/content/sourceReview";
import type { DocumentHome } from "@/domain/types";
import type { CanvasHistory } from "@/history/canvasHistory";
import { getPersistence } from "@/persistence";
import { recordAccepted, recordSettled } from "@/state/agentLog";
import { agentSync, framesTouched } from "@/state/agentSync";
import type { SceneElement } from "@/domain/canvas/adapter";
import { linkGeneratedLevel } from "@/components/lens/lensGenerate";
import { aiMarkers } from "./aiMarkersStore";
import { commitPartsOnCanvas, commitSetOnCanvas } from "./commitOnCanvas";
import { flagDenseBlocks } from "./flagDense";
import { nothingAppliedMessage, unappliedKeys } from "./unapplied";

type History = Pick<CanvasHistory<ExcalidrawElement>, "record">;

/**
 * Agent Sync (Lens Phase 4): an agent's accepted change leaves its frames "unseen" until viewed in Lens (the canvas
 * `Δ`). An agent's set is one from a producer session of its own (an MCP connection's, a mapping session's, D40);
 * in-app AI and the user's reverts propose in the app's session.
 */
function markAgentFrames(home: DocumentHome, set: ChangeSet, before: readonly ExcalidrawElement[], after: readonly ExcalidrawElement[]) {
  if (!set.session || set.session === APP_SESSION) return;
  agentSync.markUnseen(home.canvasId, framesTouched(before as unknown as readonly SceneElement[], after as unknown as readonly SceneElement[]));
}

export interface PartsAccepted {
  stepId: number | null;
  applied: ProposedChange[];
  /** "Added 2 sections · 9 blocks." */
  message: string;
  dropped: string | null;
  /** Whether part of the set is still under review. */
  more: boolean;
  /** How many of the added blocks are dense (`flagDenseBlocks`). */
  dense: number;
}

/**
 * Writes the named parts (all when null) of a merged set under review — the one of `mergeKey` when given, else the
 * selected one — and logs it (Agent State, D31); null when there is none.
 */
export function acceptPendingParts(
  api: ExcalidrawImperativeAPI,
  home: DocumentHome,
  history: History,
  keys: readonly string[] | null,
  decisions: ReadonlyMap<string, PartDecision> = new Map(),
  mergeKey?: string,
): PartsAccepted | null {
  const pending = getPendingChanges();
  const set = mergeKey ? pending.inSlot(home.canvasId, slotOf({ mergeKey })) : pending.get(home.canvasId);
  if (!set?.parts) return null;
  const before = api.getSceneElementsIncludingDeleted();
  // The shared, idempotent commit (Stage 4a): parts already written are never written again.
  const result = commitPartsOnCanvas(api, home, history, set, keys ? new Set(keys) : null, decisions);
  if (!result) {
    pending.settle(home.canvasId, set.operationId);
    return null;
  }
  pending.replace(home.canvasId, set.operationId, result.rest);
  if (result.applied.length) {
    const after = api.getSceneElementsIncludingDeleted();
    recordAccepted(home, set, before, after, result.rest ? "partial" : "applied");
    markAgentFrames(home, set, before, after);
  }
  // Each accepted section's content version (F37) exists only now — with the cards it left unapplied as they were.
  const unapplied = unappliedKeys(result.dropped);
  for (const part of result.accepted) {
    if (!part.contentSource) continue;
    void recordPartlyAppliedSource(getPersistence().contentSources, home, part.contentSource, unapplied).catch((err: unknown) =>
      console.error("[acute-notes] Failed to record the content source", err),
    );
  }
  if (result.stepId !== null) {
    getOperationLog().record({
      operationId: set.operationId,
      canvasId: home.canvasId,
      description: `${set.title}: ${describeChanges(result.applied)}`,
      stepId: result.stepId,
      acceptedAt: Date.now(),
    });
  }
  aiMarkers.mark(home.canvasId, result.created.values());
  const dense = flagDenseBlocks(api, home.canvasId, result.created.values());
  void linkGeneratedLevel(api, home, set, result.created);
  const added = result.applied.some((c) => c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page");
  return {
    stepId: result.stepId,
    applied: result.applied,
    message: result.applied.length ? `${added ? "Added" : "Applied"} ${describeChanges(result.applied)}.` : nothingAppliedMessage(result.dropped),
    dropped: describeDropped(result.dropped),
    more: result.rest !== null,
    dense,
  };
}

export interface SetAccepted {
  stepId: number | null;
  applied: ProposedChange[];
  dropped: string | null;
  dense: number;
  /** When nothing was applied, what to tell the user (`nothingAppliedMessage`); null otherwise. */
  nothingApplied: string | null;
  /**
   * Stale-target protection: how many updates were withheld because their block changed since they were proposed (or a
   * "Use proposed" whose block changed again). They wait under review for Keep mine / Use proposed; 0 when none.
   */
  waiting: number;
  /** Stale-target decisions answered "Keep mine" in this accept (nothing written for them). */
  kept: number;
}

/**
 * Writes the set under review `operationId` (a merged set: all its parts) as one undo step, records its content
 * version (F37), its operation and its change-log entry (D31), and marks what it added. Its clean changes plus each
 * decided conflict's change are written; undecided conflicts are left alone. Null when no such set is waiting.
 */
export function acceptPendingSet(
  api: ExcalidrawImperativeAPI,
  home: DocumentHome,
  history: History,
  operationId: string,
  decisions: ReadonlyMap<string, ConflictDecision> = new Map(),
): SetAccepted | null {
  const pending = getPendingChanges();
  const set = pending.list(home.canvasId).find((s) => s.operationId === operationId);
  if (!set) return null;
  if (set.parts) {
    const done = acceptPendingParts(api, home, history, null, decisions, set.mergeKey);
    return done && { stepId: done.stepId, applied: done.applied, dropped: done.dropped, dense: done.dense, nothingApplied: done.applied.length ? null : done.message, waiting: 0, kept: 0 };
  }
  const effective = withDecisions(set, decisions);
  const before = api.getSceneElementsIncludingDeleted();
  // The shared, idempotent commit (Stage 4a): an operation already committed (a repeated event, a restored proposal) writes nothing.
  // Stage 3 offers answered "Leave as is": the user already decided those exact pairs (Stage 4, §12.9 decision 5).
  const leftAsIs = (set.conflicts ?? []).flatMap((c) => (c.impact && decisions.get(c.target) === "keep" ? [{ target: c.target, from: c.impact.from }] : []));
  // Stale-target protection (`staleTarget.ts`): the commit compares every update's baseline with its block as it is now, in
  // the same task as the write. Blocks that still match are written as one undo step; blocks changed since the proposal are
  // withheld and, with stale-target decisions not yet made, stay under review for Keep mine / Use proposed — never dropped.
  const result = commitSetOnCanvas(api, home, history, effective, { leftAsIs });
  const undecidedConflicts = (set.conflicts ?? []).filter((c) => !decisions.has(c.target));
  const { waiting, kept, rest } = result ? afterAccept(set, decisions, result.stale, result.applied.length > 0) : { waiting: [], kept: 0, rest: null };
  if (rest) pending.replace(home.canvasId, set.operationId, rest);
  else pending.settle(home.canvasId, set.operationId);
  if (!result) return null;
  // Nothing written: no content version is recorded, so the next update from this content offers it all again.
  if (!result.applied.length) {
    // Only "Keep mine" on changed blocks: the decision is logged, so the agent sees its update was declined for the user's edit.
    if (kept && !waiting.length) recordSettled(home, set, "rejected", "Kept the user's edit: the block changed after the update was proposed.");
    return {
      stepId: null,
      applied: [],
      dropped: describeDropped(result.dropped),
      dense: 0,
      nothingApplied: waiting.length ? waitingMessage(waiting.length, false) : kept ? (kept === 1 ? "Kept your edit." : "Kept your edits.") : nothingAppliedMessage(result.dropped),
      waiting: waiting.length,
      kept,
    };
  }
  // Conflicts left undecided stay as they were: the change was applied only in part.
  const undecided = undecidedConflicts.length > 0 || waiting.length > 0;
  const after = api.getSceneElementsIncludingDeleted();
  recordAccepted(home, set, before, after, undecided ? "conflicts" : "applied");
  markAgentFrames(home, set, before, after);
  // The content version this set came from (F37) exists only once accepted. A card the accept left as it was (a patch
  // skipped as stale, a conflict left undecided) keeps the previous version's node, so the next update offers it again.
  if (set.contentSource) {
    void recordPartlyAppliedSource(getPersistence().contentSources, home, set.contentSource, unappliedKeys(result.dropped, [...undecidedConflicts, ...result.stale])).catch((err: unknown) =>
      console.error("[acute-notes] Failed to record the content source", err),
    );
    // Distil (knowledge-notes-plan §5.1, U3): what the run made of each passage, kept beside the version for the Source tab and the queue.
    if (set.knowledge?.units) {
      void saveSourceOutcomes(getPersistence().meta, set.contentSource.sourceId, set.contentSource.version, set.knowledge.units).catch((err: unknown) =>
        console.error("[acute-notes] Failed to record the source's outcomes", err),
      );
    }
  }
  if (result.stepId !== null) {
    getOperationLog().record({
      operationId: set.operationId,
      canvasId: home.canvasId,
      description: `${set.title}: ${describeChanges(result.applied)}`,
      stepId: result.stepId,
      acceptedAt: Date.now(),
    });
  }
  // Point out what was added (as the "Show AI additions" preference says).
  aiMarkers.mark(home.canvasId, result.created.values());
  const dense = flagDenseBlocks(api, home.canvasId, result.created.values());
  // A level Lens generated (Phase 5): its parent node is linked to it now that the frame exists.
  void linkGeneratedLevel(api, home, set, result.created);
  return { stepId: result.stepId, applied: result.applied, dropped: describeDropped(result.dropped), dense, nothingApplied: null, waiting: waiting.length, kept };
}

/** What the user is told when an accept withheld blocks that changed since the proposal (they wait for Keep mine / Use proposed). */
export function waitingMessage(n: number, wroteOthers: boolean): string {
  const which = n === 1 ? "1 block was" : `${n} blocks were`;
  return `${wroteOthers ? "The other changes were applied. " : "Nothing was applied yet: "}${which} edited since the update was proposed — choose Keep mine or Use proposed.`;
}
