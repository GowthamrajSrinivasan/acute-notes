/**
 * Note-taking mode per canvas (note-taking-modes plan §4.1, 2026-11-23). The mode is a default, never a restriction (P1):
 * it sets what the canvas does when nobody said otherwise (the View, the Visualize note model, which rendering a layout
 * gets), and it never disables a manual or an AI action. Canvases without the field are `manual`.
 */
import type { CanvasDocument, NoteMode } from "./types";

export const NOTE_MODES: readonly NoteMode[] = ["manual", "ai"];

export const DEFAULT_NOTE_MODE: NoteMode = "manual";

export const NOTE_MODE_LABELS: Readonly<Record<NoteMode, { label: string; help: string }>> = {
  manual: { label: "Manual notes", help: "You type and draw; AI helps when asked. Cards still cite their sources." },
  ai: { label: "AI-managed notes", help: "AI composes and updates the cards; you can still edit anything by hand." },
};

export function isNoteMode(value: unknown): value is NoteMode {
  return value === "manual" || value === "ai";
}

/** The canvas's mode, `manual` when it has none (canvases from before the field). */
export function noteModeOf(canvas: Pick<CanvasDocument, "noteMode"> | null | undefined): NoteMode {
  return canvas?.noteMode ?? DEFAULT_NOTE_MODE;
}
