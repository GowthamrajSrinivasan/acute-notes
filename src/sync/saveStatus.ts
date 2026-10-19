/**
 * Tiny global "local save" status store, readable from any component through
 * `useSyncExternalStore` without coupling the header to the canvas session.
 */
export type SaveStatus = "idle" | "saving" | "saved" | "error";

let status: SaveStatus = "idle";
const listeners = new Set<() => void>();

export const saveStatusStore = {
  get: (): SaveStatus => status,
  set(next: SaveStatus) {
    if (next === status) return;
    status = next;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
