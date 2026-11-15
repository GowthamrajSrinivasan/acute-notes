/**
 * "Keep full detail" in the Visualize dialog (knowledge-notes-plan WP2.8, §6.3, OD2): **hidden until R1**
 * (`FIDELITY_CONFIG.showNoteModelChoice`). Once shown, a new Visualize distils by default, and "Keep full detail" runs
 * that one Visualize with `preserve` (notes close to the source's own wording). The choice travels with the run, never by
 * changing the global `FIDELITY_CONFIG.noteModel`.
 */
import type { NoteModel } from "@/ai/fidelity/contracts";
import { FIDELITY_CONFIG, type FidelityConfig } from "@/config/fidelity";

export const KEEP_FULL_DETAIL_LABEL = "Keep full detail";
export const KEEP_FULL_DETAIL_HELP = "Notes keep the source's wording nearly word for word. Use it for specs, legal text and the like.";

/** Whether the dialog shows the choice (hidden until R1). */
export function showsNoteModelChoice(config: Pick<FidelityConfig, "showNoteModelChoice"> = FIDELITY_CONFIG): boolean {
  return config.showNoteModelChoice;
}

/**
 * The note model a new Visualize run is started with. Hidden: `undefined`, so the run uses `FIDELITY_CONFIG.noteModel`
 * exactly as before. Shown: `distil`, or `preserve` with "Keep full detail" ticked.
 */
export function runNoteModel(keepFullDetail: boolean, config: Pick<FidelityConfig, "showNoteModelChoice"> = FIDELITY_CONFIG): NoteModel | undefined {
  if (!showsNoteModelChoice(config)) return undefined;
  return keepFullDetail ? "preserve" : "distil";
}
