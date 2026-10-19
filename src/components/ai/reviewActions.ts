/**
 * The review bar's actions for sets waiting on the open canvas, by operation id, for review surfaces outside the bar
 * (Lens's Changes drawer, Agent Sync, plan §8.2): the same accept path (`acceptPendingSet`, which logs the record,
 * D31) and the same reject (settled and logged with the user's reason, D46). Registered by the open canvas.
 */
export interface ReviewActions {
  canvasId: string;
  /** Writes the set's clean changes as one undo step (undecided conflicts are left alone); false when it's gone. */
  accept(operationId: string): boolean;
  /** Drops the set without writing anything; logged as rejected. */
  reject(operationId: string, reason?: string): void;
}

let current: ReviewActions | null = null;

export function registerReviewActions(actions: ReviewActions): () => void {
  current = actions;
  return () => {
    if (current === actions) current = null;
  };
}

/** The open canvas's review actions, when it's `canvasId`. */
export function getReviewActions(canvasId: string): ReviewActions | null {
  return current?.canvasId === canvasId ? current : null;
}
