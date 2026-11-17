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
 *
 * Canvas cards (`isOpenUiCanvasEnabled`, `.ai/docs/openui/openui-canvas-rendering-plan-2026-11-16.md`): a third block
 * View, "Cards", in which a source-citing AI card that isn't being edited is drawn as an OpenUI card. The Lang is built in
 * code from the card's stored content (`ai/openui/cardLang.ts`): no model call, no new stored field, editing unchanged.
 * Off unless `NEXT_PUBLIC_OPENUI_CANVAS` is exactly "on". This replaces Phase 1's never-read `OPENUI_CONFIG.noteRender`.
 */
export interface OpenUiConfig {
  /** Developer setting only, like `FIDELITY_CONFIG.noteModel` was before its own gate. */
  enabled: boolean;
}

export const OPENUI_CONFIG: OpenUiConfig = {
  enabled: false,
};

/** Read on every call so tests can stub the env. The literal `process.env.NEXT_PUBLIC_OPENUI_NOTES` must stay as-is for Next.js to inline it. */
export function isOpenUiNotesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OPENUI_NOTES === "on";
}

/** Whether the header's View toggle offers "Cards" (OpenUI-rendered canvas cards). Literal env access, inlined at build. */
export function isOpenUiCanvasEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OPENUI_CANVAS === "on";
}
