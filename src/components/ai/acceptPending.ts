/**
 * Accepting parts of a merged change set (F43's mapping session) on the live
 * canvas: the review bar's "Accept all" and "Accept section", and a session
 * the user switched to auto-accept. The chosen parts are written as one undo
 * step (`acceptParts`), each part's content version is recorded (F37), and
 * whatever is left stays under review.
 */
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { acceptChangeSet } from "@/ai/changes/accept";
import { describeChanges, describeDropped, type ChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { getOperationLog } from "@/ai/changes/operations";
import { acceptParts, type PartDecision } from "@/ai/changes/parts";
import { withDecisions, type ConflictDecision } from "@/ai/reconcile/conflicts";
import { APP_SESSION, getPendingChanges, slotOf } from "@/ai/changes/pendingChanges";
import { recordAcceptedSource } from "@/ai/content/sources";
import { changeSetCanvas } from "@/components/canvas/changeSetWriter";
import type { DocumentHome } from "@/domain/types";
import type { CanvasHistory } from "@/history/canvasHistory";
import { getPersistence } from "@/persistence";
import { recordAccepted } from "@/state/agentLog";
import { agentSync, framesTouched } from "@/state/agentSync";
import type { SceneElement } from "@/domain/canvas/adapter";
import { linkGeneratedLevel } from "@/components/lens/lensGenerate";
import { aiMarkers } from "./aiMarkersStore";
import { flagDenseBlocks } from "./flagDense";

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
  const result = acceptParts(set, keys ? new Set(keys) : null, decisions, () => changeSetCanvas(api, home), history);
  pending.replace(home.canvasId, set.operationId, result.rest);
  if (result.applied.length) {
    const after = api.getSceneElementsIncludingDeleted();
    recordAccepted(home, set, before, after, result.rest ? "partial" : "applied");
    markAgentFrames(home, set, before, after);
  }
  // Each accepted section's content version (F37) exists only now.
  for (const part of result.accepted) {
    if (!part.contentSource) continue;
    void recordAcceptedSource(getPersistence().contentSources, home, part.contentSource).catch((err: unknown) =>
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
    message: result.applied.length ? `${added ? "Added" : "Applied"} ${describeChanges(result.applied)}.` : "Nothing was written: every change referred to a deleted object.",
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
    return done && { stepId: done.stepId, applied: done.applied, dropped: done.dropped, dense: done.dense };
  }
  const effective = withDecisions(set, decisions);
  const before = api.getSceneElementsIncludingDeleted();
  const result = acceptChangeSet(effective, changeSetCanvas(api, home), history);
  pending.settle(home.canvasId, set.operationId);
  if (!result.applied.length) return { stepId: null, applied: [], dropped: describeDropped(result.dropped), dense: 0 };
  // Conflicts left undecided stay as they were: the change was applied only in part.
  const undecided = (set.conflicts ?? []).some((c) => !decisions.has(c.target));
  const after = api.getSceneElementsIncludingDeleted();
  recordAccepted(home, set, before, after, undecided ? "conflicts" : "applied");
  markAgentFrames(home, set, before, after);
  // The content version this set came from (F37) exists only once accepted.
  if (set.contentSource) {
    void recordAcceptedSource(getPersistence().contentSources, home, set.contentSource).catch((err: unknown) =>
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
  // Point out what was added (as the "Show AI additions" preference says).
  aiMarkers.mark(home.canvasId, result.created.values());
  const dense = flagDenseBlocks(api, home.canvasId, result.created.values());
  // A level Lens generated (Phase 5): its parent node is linked to it now that the frame exists.
  void linkGeneratedLevel(api, home, set, result.created);
  return { stepId: result.stepId, applied: result.applied, dropped: describeDropped(result.dropped), dense };
}
