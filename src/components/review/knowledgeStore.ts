"use client";

/**
 * The review UI's state per canvas (knowledge-notes-plan §5.1, §5.3): which side-panel tab shows (Properties or Source,
 * OD1), the passages the Source tab opens on (a chip click, a queue step), the cards outlined on the canvas for a
 * selected passage (two-way highlighting), the cards the user chose Edit on (saving one resolves its review), and a
 * revision bumped whenever an object's review or a source's passage resolutions change, so readers re-read them.
 * In memory only: none of it is document state.
 */
import { useSyncExternalStore } from "react";
import type { UnitId } from "@/ai/fidelity/contracts";

export interface KnowledgeUI {
  tab: "properties" | "source";
  /** What the Source tab opens on: an object's version and the passages to highlight (absent: the selected card's citations). */
  focus: { objectId?: string; units: UnitId[] } | null;
  /** Objects outlined on the canvas: the cards citing the passage selected in the Source tab. */
  outlined: readonly string[];
  /** Cards the user chose Edit on in the review queue: saving one resolves its review as "edited". */
  editing: readonly string[];
  /** Objects showing a source chip (the indicator budget: their "added" dot gives way, `AIChangeMarkers`). */
  chips: ReadonlySet<string>;
  /** The review bar's "Added …" notice is showing at the bottom: it carries "Review N" then (one bottom bar). */
  notice: boolean;
  /** How many items "Review N" has now (published by the queue's bar, read by the notice). */
  queue: number;
  /** Bumped to start walking the queue (the notice's "Review N ›"). */
  walk: number;
  revision: number;
}

const INITIAL: KnowledgeUI = { tab: "properties", focus: null, outlined: [], editing: [], chips: new Set(), notice: false, queue: 0, walk: 0, revision: 0 };
const byCanvas = new Map<string, KnowledgeUI>();
const listeners = new Set<() => void>();

function set(canvasId: string, patch: Partial<KnowledgeUI>): void {
  byCanvas.set(canvasId, { ...(byCanvas.get(canvasId) ?? INITIAL), ...patch });
  for (const l of listeners) l();
}

export const knowledgeUI = {
  get: (canvasId: string): KnowledgeUI => byCanvas.get(canvasId) ?? INITIAL,
  /** Opens the Source tab, on `units` of `objectId` when given. */
  openSource(canvasId: string, focus: KnowledgeUI["focus"] = null): void {
    set(canvasId, { tab: "source", focus });
  },
  showProperties(canvasId: string): void {
    set(canvasId, { tab: "properties", focus: null, outlined: [] });
  },
  outline(canvasId: string, objectIds: readonly string[]): void {
    set(canvasId, { outlined: [...objectIds] });
  },
  startEditing(canvasId: string, objectId: string): void {
    const editing = knowledgeUI.get(canvasId).editing;
    if (!editing.includes(objectId)) set(canvasId, { editing: [...editing, objectId] });
  },
  stopEditing(canvasId: string, objectId: string): void {
    set(canvasId, { editing: knowledgeUI.get(canvasId).editing.filter((id) => id !== objectId) });
  },
  /** The objects showing a chip now (emits only when the set changed). */
  setChips(canvasId: string, ids: readonly string[]): void {
    const had = knowledgeUI.get(canvasId).chips;
    if (had.size === ids.length && ids.every((id) => had.has(id))) return;
    set(canvasId, { chips: new Set(ids) });
  },
  setNotice(canvasId: string, notice: boolean): void {
    if (knowledgeUI.get(canvasId).notice !== notice) set(canvasId, { notice });
  },
  setQueue(canvasId: string, queue: number): void {
    if (knowledgeUI.get(canvasId).queue !== queue) set(canvasId, { queue });
  },
  /** Starts walking "Review N" (from the notice). */
  startWalk(canvasId: string): void {
    set(canvasId, { walk: knowledgeUI.get(canvasId).walk + 1 });
  },
  /** An object's review or a source's passage resolutions changed: readers re-read them. */
  changed(canvasId: string): void {
    set(canvasId, { revision: knowledgeUI.get(canvasId).revision + 1 });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Tests. */
  reset(): void {
    byCanvas.clear();
  },
};

export function useKnowledgeUI(canvasId: string): KnowledgeUI {
  return useSyncExternalStore(
    knowledgeUI.subscribe,
    () => knowledgeUI.get(canvasId),
    () => INITIAL,
  );
}
