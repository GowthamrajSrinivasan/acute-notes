/**
 * Accepting a change set (F19): resolve it against the canvas as it is now,
 * then write what is left as one history step. The canvas writer is injected,
 * so the transaction rules are testable without a renderer.
 */
import type { Box, ChangeSet, ConflictItem, DroppedChange, ProposedChange } from "./changeSet";
import type { PatchTarget } from "./claimPatch";
import { resolveChangeSet } from "./changeSet";
import type { LiveShape } from "./staleTarget";

export interface ChangeSetCanvas {
  /** Geometry of a live object; undefined when it is missing or deleted. */
  boxOf(id: string): Box | undefined;
  /**
   * A block's or page's content as it is now, for checking claim-level patches (`patch_block`) before they are
   * written. Without it, every patch is rejected: a patch is never applied to content it wasn't checked against.
   */
  contentOf?(id: string): PatchTarget | null | undefined;
  /**
   * A shape as it is now (its label's fingerprint and its kind), for checking an `update_shape`'s baseline before it is
   * written (`staleTarget.ts`). Without it, a baselined `update_shape` is never written blind: it asks Keep mine / Use proposed.
   */
  shapeOf?(id: string): LiveShape | null | undefined;
  /**
   * Writes the changes to the scene, with the change set's provenance on every
   * created object. Returns the ids of the created objects by change key.
   */
  write(set: ChangeSet, changes: readonly ProposedChange[]): Map<string, string>;
}

/** The history's transaction boundary (see `CanvasHistory.record`). */
export interface TransactionHistory {
  record(mutate: () => void): number | null;
}

export interface AcceptResult {
  /** The history step holding the whole change set (null when nothing was written). */
  stepId: number | null;
  /** Created object ids by change key. */
  created: Map<string, string>;
  applied: ProposedChange[];
  dropped: DroppedChange[];
  /**
   * `update_block`s / `update_shape`s withheld because their target changed since they were proposed (`staleTarget.ts`): never written by
   * this accept; the caller keeps them under review as Keep mine / Use proposed decisions.
   */
  stale: ConflictItem[];
}

export function acceptChangeSet(set: ChangeSet, canvas: ChangeSetCanvas, history: TransactionHistory): AcceptResult {
  // Resolved and written in one synchronous task: the baselines are compared with the very content the write replaces.
  const { changes, dropped, stale } = resolveChangeSet(
    set,
    (id) => canvas.boxOf(id) !== undefined,
    (id) => canvas.contentOf?.(id) ?? null,
    (id) => canvas.shapeOf?.(id) ?? null,
  );
  let created = new Map<string, string>();
  const stepId = changes.length ? history.record(() => (created = canvas.write(set, changes))) : null;
  return { stepId, created, applied: changes, dropped, stale };
}
