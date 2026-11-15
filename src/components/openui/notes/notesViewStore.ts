"use client";

/**
 * Notes/Canvas switching (`.ai/docs/openui-integration-plan.md` Phase 2): which view each canvas shows. A view mode,
 * not a canvas primitive — in memory only, never document state. `focus` asks the open Notes view to scroll to a note
 * (cross-note navigation), bumped so the same note can be asked for twice.
 */
import { useSyncExternalStore } from "react";

export interface NotesViewState {
  open: boolean;
  focus: { noteId: string; seq: number } | null;
}

const CLOSED: NotesViewState = { open: false, focus: null };
const byCanvas = new Map<string, NotesViewState>();
const listeners = new Set<() => void>();
let seq = 0;

function set(canvasId: string, patch: Partial<NotesViewState>): void {
  byCanvas.set(canvasId, { ...(byCanvas.get(canvasId) ?? CLOSED), ...patch });
  for (const l of listeners) l();
}

export const notesView = {
  get: (canvasId: string): NotesViewState => byCanvas.get(canvasId) ?? CLOSED,
  open: (canvasId: string, noteId?: string) => set(canvasId, { open: true, focus: noteId ? { noteId, seq: ++seq } : null }),
  close: (canvasId: string) => set(canvasId, { open: false, focus: null }),
  toggle: (canvasId: string) => (notesView.get(canvasId).open ? notesView.close(canvasId) : notesView.open(canvasId)),
  focus: (canvasId: string, noteId: string) => set(canvasId, { focus: { noteId, seq: ++seq } }),
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useNotesView(canvasId: string): NotesViewState {
  return useSyncExternalStore(notesView.subscribe, () => notesView.get(canvasId), () => CLOSED);
}
