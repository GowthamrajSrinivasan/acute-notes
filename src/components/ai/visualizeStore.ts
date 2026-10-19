"use client";

/**
 * Opens the Visualize dialog (F31) from anywhere: the global `⋮` menu, the
 * selection action menu (pre-filled with the selection's content), or the
 * large-paste hint (pre-filled with what was just pasted). Mirrors `aiPanel`'s
 * plain external-store pattern.
 */
import { useSyncExternalStore } from "react";

export interface OpenVisualizeOptions {
  /** Pre-filled content; empty for the global "Visualize content…" entry point. */
  text?: string;
  /** What the content is, for the dialog's own display ("Selection", "Pasted text"). */
  label?: string;
  /** "Update from new content" (F39): reconcile this content source instead of starting a new one. */
  updateSourceId?: string;
  /** "Update from ChatGPT chats": open on "Merge into existing notes" with these notes chosen and the shared-chats panel open. */
  mergeSourceId?: string;
  /** Run at once with `text`, without showing the form (G3 "Use this option": the text is the source with the option chosen). */
  autoRun?: { title: string };
  /** With `updateSourceId`: analyse the unchanged text again with AI ("Re-visualise with AI"). */
  regenerate?: readonly string[];
}

interface VisualizeDialogState {
  open: boolean;
  text: string;
  label?: string;
  updateSourceId?: string;
  mergeSourceId?: string;
  autoRun?: { title: string };
  regenerate?: readonly string[];
  /** Bumped on every open request, so opening the same way twice in a row is still noticed. */
  seq: number;
}

let state: VisualizeDialogState = { open: false, text: "", seq: 0 };
const listeners = new Set<() => void>();
function set(next: VisualizeDialogState) {
  state = next;
  for (const l of listeners) l();
}

export const visualizeDialog = {
  get: (): VisualizeDialogState => state,
  open(options: OpenVisualizeOptions = {}): void {
    set({ open: true, text: options.text ?? "", label: options.label, updateSourceId: options.updateSourceId, mergeSourceId: options.mergeSourceId, autoRun: options.autoRun, regenerate: options.regenerate, seq: state.seq + 1 });
  },
  close(): void {
    if (state.open) set({ ...state, open: false });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useVisualizeDialog(): VisualizeDialogState {
  return useSyncExternalStore(visualizeDialog.subscribe, visualizeDialog.get, () => state);
}
