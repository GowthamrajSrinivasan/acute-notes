"use client";

/**
 * Blocks an accepted change set added that are dense (see `ai/density`), per
 * canvas, in reading order, and the one the user is looking at while walking
 * through them (`DenseBlocks`). Held in memory only, like the AI markers: a
 * hint, never document state, and a reload clears it.
 */
import { useSyncExternalStore } from "react";
import type { DensityFinding } from "@/ai/density/density";

export interface DenseEntry {
  /** The block's canvas element. */
  id: string;
  /** Why it is dense, shown as is. */
  reason: string;
  /** What makes it dense: a table or checklist can also be split with no AI ("Split locally"). */
  cause: DensityFinding["cause"];
}

export interface DenseState {
  entries: readonly DenseEntry[];
  /** The entry being shown in the walk-through; null when not walking. */
  current: string | null;
}

const EMPTY: DenseState = { entries: [], current: null };
const byCanvas = new Map<string, DenseState>();
const listeners = new Set<() => void>();

function update(canvasId: string, next: DenseState) {
  if (next.entries.length) byCanvas.set(canvasId, next);
  else byCanvas.delete(canvasId);
  for (const l of listeners) l();
}

export const denseBlocks = {
  /** Adds `entries` (a change set's dense blocks, in reading order) after the canvas's earlier ones. */
  add(canvasId: string, entries: readonly DenseEntry[]): void {
    if (!entries.length) return;
    const state = byCanvas.get(canvasId) ?? EMPTY;
    const fresh = new Map(entries.map((e) => [e.id, e] as const));
    update(canvasId, { ...state, entries: [...state.entries.filter((e) => !fresh.has(e.id)), ...fresh.values()] });
  },
  /** The user has seen it: no longer pointed out. Walking moves on to the next one. */
  dismiss(canvasId: string, id: string): void {
    const state = byCanvas.get(canvasId);
    if (!state) return;
    const i = state.entries.findIndex((e) => e.id === id);
    if (i < 0) return;
    const entries = state.entries.filter((e) => e.id !== id);
    const current = state.current === id ? (entries[Math.min(i, entries.length - 1)]?.id ?? null) : state.current;
    update(canvasId, { entries, current });
  },
  /** The user has seen them all: none pointed out any more, and the walk-through ends. */
  dismissAll(canvasId: string): void {
    if (byCanvas.has(canvasId)) update(canvasId, { entries: [], current: null });
  },
  /** Shows `id` in the walk-through (null stops walking; the badges stay). */
  show(canvasId: string, id: string | null): void {
    const state = byCanvas.get(canvasId);
    if (!state || state.current === id || (id !== null && !state.entries.some((e) => e.id === id))) return;
    update(canvasId, { ...state, current: id });
  },
  get: (canvasId: string): DenseState => byCanvas.get(canvasId) ?? EMPTY,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** For tests: forgets everything. */
  reset(): void {
    byCanvas.clear();
    for (const l of listeners) l();
  },
};

export function useDenseBlocks(canvasId: string): DenseState {
  return useSyncExternalStore(
    denseBlocks.subscribe,
    () => denseBlocks.get(canvasId),
    () => EMPTY,
  );
}
