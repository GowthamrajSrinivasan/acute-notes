/**
 * OpenUI generative-UI note cards (`.ai/docs/open-intelligent-ui-audit.md`, `.ai/docs/openui-integration-plan.md`).
 *
 * Phase 1 (`OPENUI_CONFIG`): **off by default, and inert when off.** Nothing in `src/ai/visualize/**` or
 * `src/components/blocks/**` reads it; cards on the canvas keep rendering through `RichBlockHost` + BlockNote.
 *
 * Phase 2–3 (`isOpenUiNotesEnabled`): the Notes view — a reading view over the canvas's cards, rendered with the OpenUI
 * library, with promotion of generated notes into ordinary canvas blocks (`create_block`). A build switch like
 * `isTopicMergeEnabled`: on in development while it's validated, off unless `NEXT_PUBLIC_OPENUI_NOTES` is exactly "on".
 * It changes nothing on the canvas itself; the view only reads the canvas, and writes only when the user pins a note.
 */
export interface OpenUiConfig {
  /** Developer setting only, like `FIDELITY_CONFIG.noteModel` was before its own gate. */
  enabled: boolean;
  /** Which path renders an AI-authored card's body. `blocknote` is today's behaviour, always available. */
  noteRender: "blocknote" | "openui";
}

export const OPENUI_CONFIG: OpenUiConfig = {
  enabled: false,
  noteRender: "blocknote",
};

/** Read on every call so tests can stub the env. The literal `process.env.NEXT_PUBLIC_OPENUI_NOTES` must stay as-is for Next.js to inline it. */
export function isOpenUiNotesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OPENUI_NOTES === "on";
}
