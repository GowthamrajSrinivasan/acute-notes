"use client";

/**
 * The large-paste hint (F31, PRD §6.4): after a paste is inserted as an
 * ordinary rich text block — never delayed, never auto-run — a small,
 * dismissible, non-modal "✨ Visualize this?" appears near it when the paste
 * was large or already had clear structure. One at a time: a new paste
 * replaces whatever hint was showing.
 */
import { useSyncExternalStore } from "react";

export interface VisualizeHintState {
  elementId: string;
  text: string;
}

let state: VisualizeHintState | null = null;
const listeners = new Set<() => void>();
function set(next: VisualizeHintState | null) {
  state = next;
  for (const l of listeners) l();
}

export const visualizeHint = {
  get: (): VisualizeHintState | null => state,
  show(elementId: string, text: string): void {
    set({ elementId, text });
  },
  dismiss(): void {
    if (state) set(null);
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useVisualizeHint(): VisualizeHintState | null {
  return useSyncExternalStore(visualizeHint.subscribe, visualizeHint.get, () => null);
}
