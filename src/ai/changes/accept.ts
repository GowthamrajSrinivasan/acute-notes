/**
 * Accepting a change set (F19): resolve it against the canvas as it is now,
 * then write what is left as one history step. The canvas writer is injected,
 * so the transaction rules are testable without a renderer.
 */
import type { Box, ChangeSet, DroppedChange, ProposedChange } from "./changeSet";
import { resolveChangeSet } from "./changeSet";

export interface ChangeSetCanvas {
  /** Geometry of a live object; undefined when it is missing or deleted. */
  boxOf(id: string): Box | undefined;
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
}

export function acceptChangeSet(set: ChangeSet, canvas: ChangeSetCanvas, history: TransactionHistory): AcceptResult {
  const { changes, dropped } = resolveChangeSet(set, (id) => canvas.boxOf(id) !== undefined);
  let created = new Map<string, string>();
  const stepId = changes.length ? history.record(() => (created = canvas.write(set, changes))) : null;
  return { stepId, created, applied: changes, dropped };
}
