/**
 * Background persistence work that must finish before storage is replaced
 * wholesale (workspace import): e.g. a canvas session flushing on unmount.
 */
const pending = new Set<Promise<unknown>>();

export function trackPendingWork(work: Promise<unknown>): void {
  const tracked = work.catch((err: unknown) => console.error("[acute-notes] Background save failed", err));
  pending.add(tracked);
  void tracked.finally(() => pending.delete(tracked));
}

/** Resolves once all tracked work (including work started meanwhile) has settled. */
export async function settlePendingWork(): Promise<void> {
  while (pending.size) await Promise.all([...pending]);
}
