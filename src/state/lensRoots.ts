"use client";

/**
 * The open canvas's Lens roots (plan §5.3: interactive frames no other frame on it drills into), published by the
 * canvas (`LensPanelHost`) so the Navigator, which lives outside the canvas tree, can list them as "Lens" rows.
 */
import { useSyncExternalStore } from "react";

export interface LensRootsState {
  canvasId: string | null;
  roots: readonly { frameId: string; title: string; level: number }[];
}

const EMPTY: LensRootsState = { canvasId: null, roots: [] };
let state: LensRootsState = EMPTY;
const listeners = new Set<() => void>();

export const lensRoots = {
  get: (): LensRootsState => state,
  /** Replaces the roots for `canvasId`; a no-op when nothing changed. */
  set(canvasId: string, roots: LensRootsState["roots"]): void {
    if (state.canvasId === canvasId && JSON.stringify(state.roots) === JSON.stringify(roots)) return;
    state = { canvasId, roots };
    for (const l of listeners) l();
  },
  /** Clears them when `canvasId`'s canvas unmounts (a newer canvas may already have published its own). */
  clear(canvasId: string): void {
    if (state.canvasId !== canvasId) return;
    state = EMPTY;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useLensRoots(): LensRootsState {
  return useSyncExternalStore(lensRoots.subscribe, lensRoots.get, () => EMPTY);
}
