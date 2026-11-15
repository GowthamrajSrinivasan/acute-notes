"use client";

/**
 * What an OpenUI card may ask of the app around it (`.ai/docs/openui-integration-plan.md` Phases 2–3). Cards never import
 * canvas, store or AI code: the host that renders them (the Notes view, the dev demo, a test) provides only the
 * capabilities it has, and every component degrades to a static rendering when one is absent. Nothing here calls a model.
 *
 * - `unitText`: a cited source unit's passage, for expandable citations (Phase 2 "expandable sources").
 * - `openSource`: show the passages in the Source tab / on the canvas.
 * - `pin`: promotion into an editable canvas block (Phase 2), or "Show on canvas" for a note already there.
 * - `navigate` / `noteTitle`: cross-note navigation (Phase 3 `NoteLink`).
 * - `recordStudy`: study answers for the device-local study history (study-mode plan Phase 3).
 */
import { createContext, useContext, type ReactNode } from "react";

export interface NotesPinAction {
  /** Button text, e.g. "Pin to canvas" or "Show on canvas". */
  label: string;
  /** True once done (a pinned note shows "On canvas"). */
  done?: boolean;
  run(): void;
}

export interface NotesHost {
  /** The note this card belongs to (the canvas object id, or a generated note's key). */
  noteId?: string;
  unitText?(unit: string): string | undefined;
  openSource?(units: readonly string[]): void;
  pin?: NotesPinAction;
  navigate?(noteId: string): void;
  noteTitle?(noteId: string): string | undefined;
  /**
   * Study history (study-mode plan Phase 3): a QuizCard reports its first pick per mount, a Flashcard the reader's own
   * "Got it" / "Missed it" grade after the reveal. Absent (the static demo, a read-only host): nothing is reported and
   * a Flashcard shows no grade buttons.
   */
  recordStudy?(r: { kind: "quiz" | "flashcard"; correct: boolean }): void;
}

const NotesHostContext = createContext<NotesHost>({});

export function NotesHostProvider({ value, children }: { value: NotesHost; children: ReactNode }) {
  return <NotesHostContext.Provider value={value}>{children}</NotesHostContext.Provider>;
}

/** The capabilities of the host rendering this card; `{}` outside any host. */
export function useNotesHost(): NotesHost {
  return useContext(NotesHostContext);
}
