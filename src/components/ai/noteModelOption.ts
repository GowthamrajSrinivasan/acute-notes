/**
 * The note model choice in the Visualize dialog (knowledge-notes-plan WP2.8, §6.3, OD2), by
 * `FIDELITY_CONFIG.noteModelChoice`:
 * - `hidden`: no control; a run uses `FIDELITY_CONFIG.noteModel` exactly as before.
 * - `opt-in` (early access before R1, approved by the user 2026-11-17): "Distil into key ideas (early access)", unticked
 *   by default. Ticked runs that one Visualize with `distil`; unticked passes nothing, so the run uses
 *   `FIDELITY_CONFIG.noteModel` (`preserve`, today's notes, unless a developer setting changed it).
 * - `default` (from R1): a new Visualize distils, and "Keep full detail" runs that one Visualize with `preserve`.
 * The choice travels with the run, never by changing the global `FIDELITY_CONFIG.noteModel`.
 */
import type { NoteModel } from "@/ai/fidelity/contracts";
import { FIDELITY_CONFIG, type FidelityConfig } from "@/config/fidelity";

export const KEEP_FULL_DETAIL_LABEL = "Keep full detail";
export const KEEP_FULL_DETAIL_HELP = "Notes keep the source's wording nearly word for word. Use it for specs, legal text and the like.";
export const DISTIL_OPT_IN_LABEL = "Distil into key ideas (early access)";
export const DISTIL_OPT_IN_HELP =
  "Short notes in AI's own words, each citing the passage it comes from. Early access: more notes may be marked Needs review.";

type ChoiceConfig = Pick<FidelityConfig, "noteModelChoice">;

/** Whether the dialog shows a note model control at all. */
export function showsNoteModelChoice(config: ChoiceConfig = FIDELITY_CONFIG): boolean {
  return config.noteModelChoice !== "hidden";
}

/** The control's label and help line, or null when hidden. Its box, when ticked, picks the non-default model. */
export function noteModelControl(config: ChoiceConfig = FIDELITY_CONFIG): { label: string; help: string } | null {
  if (config.noteModelChoice === "opt-in") return { label: DISTIL_OPT_IN_LABEL, help: DISTIL_OPT_IN_HELP };
  if (config.noteModelChoice === "default") return { label: KEEP_FULL_DETAIL_LABEL, help: KEEP_FULL_DETAIL_HELP };
  return null;
}

/**
 * The note model a new Visualize run is started with. Hidden: `undefined`, so the run uses `FIDELITY_CONFIG.noteModel`.
 * Opt-in: `distil` when ticked, else `undefined` (the configured model). Default: `preserve` when ticked ("Keep full detail"), else `distil`.
 */
export function runNoteModel(ticked: boolean, config: ChoiceConfig = FIDELITY_CONFIG): NoteModel | undefined {
  if (config.noteModelChoice === "opt-in") return ticked ? "distil" : undefined;
  if (config.noteModelChoice === "default") return ticked ? "preserve" : "distil";
  return undefined;
}
