# OpenUI on the canvas: build and switch-on instructions (2026-11-16)

**Status: PENDING.** Not started; waiting for the go-ahead to build.

**Goal (user, 2026-11-16):** cards on the canvas itself render through OpenUI. Phases 4–5 are parked.

**Why it doesn't happen today.**
- OpenUI renders only on the dev demo page and in the Notes view.
- On the canvas, every card is a `rich-block` drawn by `RichBlockHost`:
  - **While not being edited:** `InactiveView`, which is `BlockPreview` in Compact or `EditorViewPreview` in Editor.
  - **While being edited:** a BlockNote editor.
- `OPENUI_CONFIG.noteRender` (`src/config/openui.ts`) exists, but **nothing reads it**.
- `OpenUiCardRenderer` is never mounted on the canvas.

## The approach (recommended)

**OpenUI becomes a third way to draw a card while it isn't being edited.** Content, editing and persistence don't
change.

- **Reading.** A card that isn't being edited draws as an OpenUI card (IdeaCard, citation chips, Needs review
  callout, mini table). The Lang is **built in code from the card's existing content and citations**, as the Notes
  view does with `noteLang` (`src/components/openui/notes/notesModel.ts:207`). No model call, no new stored field,
  and nothing changes in the saved document.
- **Editing.** Double-click opens the BlockNote editor exactly as today; Escape returns to the OpenUI view. Yjs,
  undo, export and the fidelity pipeline are untouched, because the stored content stays `RichContent`.
- **Switching it on.** The header already has **View: Compact | Editor** (`BlockDisplay` in `src/state/uiPrefs.ts`).
  Add a third choice, **Cards**, shown only when the build flag is on.

**Rejected for now:**
- **Storing OpenUI Lang on the block** (audit §7 step 4). It needs a new domain field, a migration and an editing
  story, and the decisions above park that work.
- **Generating Lang with a model at Visualize time** (audit Option C). That means paid calls and a new output path.
  Both can come later on top of this.

## Build steps

Each step is offline and needs no AI calls. Tests are listed per step.

1. **Flag.** In `src/config/openui.ts`, add `isOpenUiCanvasEnabled()`, reading `NEXT_PUBLIC_OPENUI_CANVAS === "on"`
   (literal env access, like `isOpenUiNotesEnabled`). Then either retire `OPENUI_CONFIG.noteRender` or make it read
   this flag. `src/config` is fingerprinted by the closed MCP gate, so note that `-Verify` must be rerun later.
2. **Display mode.** Extend `BlockDisplay` with `"cards"` (`src/state/uiPrefs.ts`). The header View toggle shows
   **Cards** only when the flag is on. If the flag is off and a stored preference says `cards`, fall back to Compact.
   - **Test:** the preference round-trips, and the flag-off fallback works.
3. **Lang builder for one card.**
   - Move `noteLang` and the `Note` shaping it needs (`title`, `body`, `detail`, `cites`, `needsReview`, `table`)
     out of `notesModel.ts` into a shared module, e.g. `src/ai/openui/cardLang.ts`.
   - Add `cardLangOf(content: RichContent, knowledge?: { cites; review })`.
   - The Notes view and the canvas then use one builder.
   - **Test:** the same input gives the same Lang as the Notes view does today (no regression in `notesModel.test.ts`).
4. **Citations and review without breaking the provenance guard.**
   - `components/blocks/**` must not read reconciliation fields.
   - Get cites and review status from the knowledge objects (`useKnowledgeObjects`, as `NotesView` does), passed
     down through `hostPropsFor` (`src/components/blocks/hostProps.ts`) as plain data.
   - `src/domain/provenanceGuard.test.ts` must stay green with no new allowlist entry, or with a reasoned one.
5. **Render.** In `InactiveView.tsx`, `display === "cards"` renders `OpenUiCardRenderer` with `cardLangOf(...)`.
   - Lazy-load it, like `EditorViewPreview`, so OpenUI stays out of the main bundle when it's off.
   - Fall back to `BlockPreview` when the Lang doesn't parse (`onError`), when the card is a code, table-only, image
     or page block, or when the content is empty.
   - **Interactions inside the card.** Citation chip expand works. **Open in source** goes through the existing
     `openSourceOn` (the host is the canvas card, so there's no Notes-view detour).
   - Pointer events must not start a canvas drag when a chip is clicked; stop propagation as `RichBlockHost` does for
     links.
6. **Size.** An OpenUI card can be taller than the BlockNote preview.
   - Use the existing auto-height path (`style.autoHeight`; the resize handling in `ExcalidrawCanvas.tsx` around
     :384–:396) to grow the element to fit.
   - Size changes from rendering must **not** create undo steps or count as user edits (no fingerprint change; it
     isn't a content change).
   - **Test:** switching Compact ↔ Cards changes no document and adds no history entry.
7. **Which cards.** Start with AI-created cards that cite a source (Visualize and pins). Manual cards keep the
   current view unless a later decision extends it.
8. **Tests.**
   - Unit tests for steps 2–5.
   - A no-AI local e2e, `e2e/local/openuiCanvas.local.spec.ts`:
     - Visualize with the scripted distiller (as `notesStudy.local.spec.ts` does);
     - switch View → Cards, and check cards render as OpenUI with their citation chips;
     - a chip expands its passage, and Open in source opens the Source tab;
     - double-click edits in BlockNote, and Escape returns to the OpenUI view;
     - switching back to Compact leaves documents and undo history unchanged;
     - no console errors;
     - screenshots for review.
   - Run alongside `openuiNotesFlow`, `stage1Gate` and `updateOwnPassage` to show updates and review are unaffected.

## Switching it on (once built)

1. **Locally:** add `NEXT_PUBLIC_OPENUI_CANVAS=on` to `.env.development` or your `.env.local`, then restart the dev
   server (`npx next dev -H 127.0.0.1`). `NEXT_PUBLIC_*` values are inlined at build time, so a page reload isn't
   enough.
2. **In the app:** header **View → Cards**. Compact or Editor switches back at any time; nothing is stored
   differently.
3. **Production** stays off until separately approved. `apphosting.yaml` has no such variable, and adding one is a
   deployment change that needs approval.

## What this does not do (on purpose)

- No new stored format, no model calls, and no change to editing or collaboration.
- No Phase 4–5 behaviour: promotion tracking stays at P0, and P1+ stays parked.
- Cards still look like the Notes view's cards. Richer AI-composed layouts (decision, timeline, comparison on the
  canvas) would need Lang from the model, which is the later Option C.

## Parked by this decision

- **OpenUI Phases 4–5**, including promotion P1+.
  - P0 fixes are done and stay.
  - Decisions 1–3 (placement defaults, before/after view, auto-accept guard) are done and stay.
- **The guarded manual run with one OpenRouter Generate call** (approved 2026-11-16) was **paused before the call; no
  spend.** OpenRouter (`google/gemini-2.5-flash`, "This session only") is connected in the integrator's Playwright
  browser but isn't primary. Copilot is still primary.
