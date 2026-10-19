"use client";

/**
 * Objects an accepted AI change set added, still pointed out on the canvas
 * (`AIChangeMarkers`), per canvas. Held in memory only: a marker is a
 * transient hint, never document state, and a reload clears it.
 *
 * How long a marker lasts follows the `aiChangeMarkers` preference: "timed"
 * clears the set's markers after `TIMED_MARKER_MS`, "until_clicked" keeps
 * each until its dot is clicked, "off" never marks anything.
 */
import { useSyncExternalStore } from "react";
import { getUiPref } from "@/state/uiPrefs";

export const TIMED_MARKER_MS = 5_000;

const EMPTY: ReadonlySet<string> = new Set();
const byCanvas = new Map<string, ReadonlySet<string>>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function update(canvasId: string, next: ReadonlySet<string>) {
  if (next.size) byCanvas.set(canvasId, next);
  else byCanvas.delete(canvasId);
  emit();
}

export const aiMarkers = {
  /** Points out `elementIds`, the objects a change set just added, as the preference says. */
  mark(canvasId: string, elementIds: Iterable<string>): void {
    const mode = getUiPref("aiChangeMarkers");
    const ids = [...elementIds];
    if (mode === "off" || !ids.length) return;
    update(canvasId, new Set([...(byCanvas.get(canvasId) ?? []), ...ids]));
    if (mode === "timed") setTimeout(() => aiMarkers.dismiss(canvasId, ids), TIMED_MARKER_MS);
  },
  dismiss(canvasId: string, elementIds: Iterable<string>): void {
    const current = byCanvas.get(canvasId);
    if (!current) return;
    const next = new Set(current);
    for (const id of elementIds) next.delete(id);
    if (next.size !== current.size) update(canvasId, next);
  },
  /** Clears every canvas's markers (e.g. when they are switched off). */
  clearAll(): void {
    if (!byCanvas.size) return;
    byCanvas.clear();
    emit();
  },
  get: (canvasId: string): ReadonlySet<string> => byCanvas.get(canvasId) ?? EMPTY,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useAIMarkers(canvasId: string): ReadonlySet<string> {
  return useSyncExternalStore(
    aiMarkers.subscribe,
    () => aiMarkers.get(canvasId),
    () => EMPTY,
  );
}
