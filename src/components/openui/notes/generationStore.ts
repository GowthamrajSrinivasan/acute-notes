"use client";

/**
 * Generated notes per canvas (`generate_openui_notes`), outside any component: a run keeps streaming into it while the
 * Notes view is closed or remounts (a hot reload, switching back from the canvas), and its cards — preview only, never
 * document state — stay until the next run or a reload. Pinned cards remember the canvas object they became.
 */
import { useSyncExternalStore } from "react";
import type { SourceUnit } from "@/ai/fidelity/contracts";
import type { NotesCheck } from "@/ai/openui/notesCheck";
import type { GeneratedCard } from "@/ai/openui/notesTask";

export interface GenSource {
  sourceId: string;
  version: number;
  units: Map<string, string>;
  /** The version's units in order, for the prompt's annotations and the free check. */
  list: SourceUnit[];
}

export type Generation =
  | { status: "idle" }
  | { status: "running" | "done"; blocks: string[]; cards: Map<string, GeneratedCard>; source: GenSource; dropped?: number; /** The free fidelity check, once done. */ check?: NotesCheck }
  | { status: "error"; message: string };

export interface GenerationState {
  gen: Generation;
  /** Generated card key → the canvas object it was pinned as. */
  pinned: ReadonlyMap<string, string>;
  run: number;
}

const IDLE: GenerationState = { gen: { status: "idle" }, pinned: new Map(), run: 0 };
const byCanvas = new Map<string, GenerationState>();
const aborts = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function set(canvasId: string, patch: Partial<GenerationState>): void {
  byCanvas.set(canvasId, { ...(byCanvas.get(canvasId) ?? IDLE), ...patch });
  for (const l of listeners) l();
}

export const generations = {
  get: (canvasId: string): GenerationState => byCanvas.get(canvasId) ?? IDLE,
  /** Starts a run (cancelling one still going); returns its signal and a guard telling whether it's still the current run. */
  start(canvasId: string): { signal: AbortSignal; current: () => boolean } {
    aborts.get(canvasId)?.abort();
    const controller = new AbortController();
    aborts.set(canvasId, controller);
    const run = generations.get(canvasId).run + 1;
    set(canvasId, { run, pinned: new Map() });
    return { signal: controller.signal, current: () => !controller.signal.aborted && generations.get(canvasId).run === run };
  },
  setGen: (canvasId: string, gen: Generation) => set(canvasId, { gen }),
  pin: (canvasId: string, key: string, objectId: string) => set(canvasId, { pinned: new Map(generations.get(canvasId).pinned).set(key, objectId) }),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useGeneration(canvasId: string): GenerationState {
  return useSyncExternalStore(generations.subscribe, () => generations.get(canvasId), () => IDLE);
}
