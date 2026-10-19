/**
 * The content-step source for the canvas history. The implementation lives
 * with the block editor (it needs Yjs/BlockNote) and registers itself when
 * the editor bundle loads; until then there are no content steps.
 */
import type { DocStep, DocStepSource } from "./canvasHistory";

let source: DocStepSource | null = null;
const listeners = new Set<() => void>();
let unsubscribeSource: (() => void) | null = null;

export function registerDocStepSource(next: DocStepSource): void {
  unsubscribeSource?.();
  source = next;
  unsubscribeSource = next.onPending(() => {
    for (const l of listeners) l();
  });
}

/** A stable proxy the history can hold before the real source exists. */
export const docStepSource: DocStepSource = {
  take: (): DocStep[] => source?.take() ?? [],
  hasPending: () => source?.hasPending() ?? false,
  onPending(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
