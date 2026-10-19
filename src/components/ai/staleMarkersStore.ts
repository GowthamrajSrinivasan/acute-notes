"use client";

/**
 * Objects a repo map (F43) marks as stale: they cite a repo path the IDE
 * agent reported as changed (`get_map_status` with `changedPaths`). Shown as
 * a quiet marker (`StaleMarkers`) until the section is re-sent or the user
 * dismisses it. Per canvas: a hint, never document state. Kept across reloads
 * in the device-local meta store once `restore` was called (never in the
 * document, Yjs or exports) — for `STALE_MARKER_DAYS` at most: a hint nobody
 * acted on for that long is dropped rather than shown forever (content
 * fidelity Wave D).
 */
import { useSyncExternalStore } from "react";
import type { MetaRepository } from "@/persistence/repositories/types";

const EMPTY: ReadonlySet<string> = new Set();
const byCanvas = new Map<string, ReadonlySet<string>>();
/**
 * Lens's lighter "may be affected" ring (Agent Sync, plan §8.2): the stale objects' ancestors, from the same status
 * call. Memory only: it is re-derived by the agent's next `get_map_status`.
 */
const affectedByCanvas = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();
/** Canvases whose saved markers were loaded (or are loading). */
const restored = new Set<string>();
let storage: Pick<MetaRepository, "get" | "set" | "delete"> | null = null;

export const staleMetaKey = (canvasId: string) => `repoMap.stale.${canvasId}`;

/** Saved markers older than this are dropped when the canvas loads. */
export const STALE_MARKER_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What is saved: the ids and when (an array alone is the older format, kept as is). */
interface SavedStale {
  ids: string[];
  savedAt: number;
}

/** The saved ids still worth showing at `now`: all of an older-format array, none past the age limit. */
export function liveSavedIds(saved: unknown, now: number): string[] {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((id): id is string => typeof id === "string") : []);
  if (Array.isArray(saved)) return strings(saved);
  if (typeof saved !== "object" || saved === null) return [];
  const { ids, savedAt } = saved as Partial<SavedStale>;
  if (typeof savedAt !== "number" || now - savedAt > STALE_MARKER_DAYS * DAY_MS) return [];
  return strings(ids);
}

function update(canvasId: string, next: ReadonlySet<string>, save = true) {
  if (next.size) byCanvas.set(canvasId, next);
  else byCanvas.delete(canvasId);
  for (const l of listeners) l();
  if (save && storage) {
    const write = next.size ? storage.set(staleMetaKey(canvasId), { ids: [...next], savedAt: Date.now() } satisfies SavedStale) : storage.delete(staleMetaKey(canvasId));
    void write.catch((err: unknown) => console.error("[acute-notes] Failed to save stale markers", err));
  }
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

function setAffected(canvasId: string, next: ReadonlySet<string>) {
  if (sameSet(next, affectedByCanvas.get(canvasId) ?? EMPTY)) return;
  if (next.size) affectedByCanvas.set(canvasId, next);
  else affectedByCanvas.delete(canvasId);
  for (const l of listeners) l();
}

export const staleMarkers = {
  /** Keeps markers in `store` from now on, and loads the canvas's saved ones (once per canvas). */
  async restore(canvasId: string, store: Pick<MetaRepository, "get" | "set" | "delete">): Promise<void> {
    storage = store;
    if (restored.has(canvasId)) return;
    restored.add(canvasId);
    const saved = await store.get<unknown>(staleMetaKey(canvasId));
    // Markers set meanwhile (a status call) are newer than what was saved: they are saved instead.
    const current = byCanvas.get(canvasId);
    if (current) return update(canvasId, current);
    const ids = liveSavedIds(saved, Date.now());
    if (ids.length) update(canvasId, new Set(ids), false);
    // Past the age limit: forgotten on this device too.
    else if (saved !== undefined && saved !== null) void store.delete(staleMetaKey(canvasId)).catch(() => undefined);
  },
  /** The canvas's stale objects are now exactly these; `affected` (their ancestors), when given, likewise. */
  set(canvasId: string, elementIds: Iterable<string>, affected?: Iterable<string>): void {
    if (affected) setAffected(canvasId, new Set(affected));
    const next = new Set(elementIds);
    const current = byCanvas.get(canvasId) ?? EMPTY;
    if (sameSet(next, current)) return;
    update(canvasId, next);
  },
  /** Re-sent or dismissed: no longer stale, nor "may be affected". */
  clear(canvasId: string, elementIds: Iterable<string>): void {
    const ids = [...elementIds];
    const affected = affectedByCanvas.get(canvasId);
    if (affected && ids.some((id) => affected.has(id))) setAffected(canvasId, new Set([...affected].filter((id) => !ids.includes(id))));
    const current = byCanvas.get(canvasId);
    if (!current) return;
    const next = new Set(current);
    for (const id of ids) next.delete(id);
    if (next.size !== current.size) update(canvasId, next);
  },
  get: (canvasId: string): ReadonlySet<string> => byCanvas.get(canvasId) ?? EMPTY,
  /** The stale objects' ancestors, which may be affected (Lens's lighter ring). */
  affected: (canvasId: string): ReadonlySet<string> => affectedByCanvas.get(canvasId) ?? EMPTY,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** For tests: forgets everything (in memory only). */
  reset(): void {
    byCanvas.clear();
    affectedByCanvas.clear();
    restored.clear();
    storage = null;
  },
};

export function useStaleMarkers(canvasId: string): ReadonlySet<string> {
  return useSyncExternalStore(
    staleMarkers.subscribe,
    () => staleMarkers.get(canvasId),
    () => EMPTY,
  );
}

export function useAffectedMarkers(canvasId: string): ReadonlySet<string> {
  return useSyncExternalStore(
    staleMarkers.subscribe,
    () => staleMarkers.affected(canvasId),
    () => EMPTY,
  );
}
