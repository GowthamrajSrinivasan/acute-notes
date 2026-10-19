/**
 * AI operations accepted in this session (F19/F25), per canvas: which history
 * step holds each one (so "Undo" can tell whether it is still the latest
 * step), and a short description for the current-context resource's
 * `recentChanges`. In memory only; provenance on the objects themselves is
 * what persists.
 */

export interface AcceptedOperation {
  operationId: string;
  canvasId: string;
  /** "Summary: 1 block", "Visualize: 3 objects · 2 connections". */
  description: string;
  /** The canvas history step holding it. */
  stepId: number;
  acceptedAt: number;
}

const MAX_PER_CANVAS = 20;

export class OperationLog {
  private readonly byCanvas = new Map<string, AcceptedOperation[]>();

  record(op: AcceptedOperation): void {
    const list = (this.byCanvas.get(op.canvasId) ?? []).filter((o) => o.operationId !== op.operationId || o.stepId !== op.stepId);
    list.push(op);
    this.byCanvas.set(op.canvasId, list.slice(-MAX_PER_CANVAS));
  }

  /** The latest acceptance of an operation on a canvas (an operation can be accepted more than once, e.g. Insert twice). */
  find(canvasId: string, operationId: string): AcceptedOperation | undefined {
    return this.byCanvas.get(canvasId)?.findLast((o) => o.operationId === operationId);
  }

  /** Newest first. */
  recent(canvasId: string, limit: number): AcceptedOperation[] {
    return (this.byCanvas.get(canvasId) ?? []).slice(-limit).reverse();
  }
}

let instance: OperationLog | null = null;

export function getOperationLog(): OperationLog {
  instance ??= new OperationLog();
  return instance;
}
