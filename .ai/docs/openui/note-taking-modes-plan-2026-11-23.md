# Note-taking modes per canvas, and MCP clients that compose OpenUI cards themselves (2026-11-23)

**Status: PLAN, nothing built.** Direction from the product owner, 2026-11-23. Builds on the Cards view
([openui-canvas-rendering-plan-2026-11-16.md](./openui-canvas-rendering-plan-2026-11-16.md), committed `005e8b8`) and the
per-card modes direction ([openui-card-modes-plan-2026-11-17.md](./openui-card-modes-plan-2026-11-17.md)). Everything in "Facts
checked in the code" was read on today's working tree; everything else is proposed.

## 1. What was asked

1. A **note-taking mode at canvas level**, with two values:
   - **Manual** (people type): the canvas defaults to View → Cards and to the distil note model, so ordinary Visualize cards
     cite their source and draw as OpenUI cards.
   - **AI-managed** (AI drives the edits): the canvas prefers OpenUI layouts for everything it can, and native Excalidraw
     shapes only where no OpenUI layout exists yet.
2. **The mode is a default, never a restriction.** In AI-managed mode a person can still draw, type and edit any element by
   hand; in Manual mode AI layouts can still be asked for. The mode only decides what happens when nobody said otherwise.
3. **MCP clients compose the cards.** Over MCP, the client (ChatGPT, Claude) writes the OpenUI layout itself and sends it,
   so the canvas makes **no model call** and spends none of the user's AI credit. The canvas validates, reviews and stores.

## 2. Principles (apply to every step)

| # | Principle | Where it comes from |
|---|---|---|
| P1 | **Mode = default, not a cage.** Every manual action works in every mode; every AI action is available in every mode. The mode sets defaults for View, note model, and what Visualize/updates/MCP produce when the caller doesn't say. | The owner's instruction, 2026-11-23 |
| P2 | **Rich text underneath, always.** An OpenUI card stores its rich text as the source of truth plus a layout field. Search, export, Notes view, Study, citations, the update engine and `get_block` keep working on the text. A broken layout falls back to the plain view. | card-modes plan §"What makes it work" 3 |
| P3 | **The canvas never spends AI credit on an MCP write.** Any tool that would call a model is guarded the way `import_content` is (workspace opt-in). The new layout tools make no model call at all. | `ingestTools.ts` guard; owner's ask |
| P4 | **Every MCP write is reviewed.** New tools go through `proposeChangeSet`: `status: "proposed"`, Accept is one undo step, auto-accept only in a session the user switched to it (D44). | `writeTools.ts` header |
| P5 | **Provenance is checked, never trusted.** Citation ids a client sends are accepted only if they resolve to real passages of a content source the workspace holds; `components/blocks/**` and OpenUI keep reading provenance only through the published store. | `provenanceGuard.test.ts`, `CanvasCardsPublisher` |
| P6 | **Mode flags are descriptive on objects.** `AIMetadata` is descriptive only (PRD §5.1); a per-card layout mode is a new field, not an `AIMetadata` field, and goes through the knowledge-notes integrator lane (`domain/types.ts`). | card-modes plan "Constraints" |

## 3. Facts checked in the code (2026-11-23)

- **What decides native vs OpenUI today.** Two independent things: (a) the outline model's **section kind** chooses node
  types (`sectionKinds.ts`: flow/hierarchy/decision → shapes + text; comparison/metrics → table (+chart); cards/supporting/
  notes → text); (b) the header **View** (`uiPrefs.ts`, default `compact`) draws a *text* block as an OpenUI card only when
  View = Cards **and** the block cites a source (`CanvasCardsPublisher.tsx:45`), which only distil runs produce
  (`FIDELITY_CONFIG.noteModel: "preserve"`, choice `opt-in`, `fidelity.ts:69-70`).
- **OpenUI library today** (`src/ai/openui/library.tsx`): `IdeaCard`, `CitationChip`, `SourceLink`, `Callout`,
  `ComparisonTable`. The Lang is built by `noteLang` (`cardLang.ts`) — `root = IdeaCard(title, body, null, [cites], detail,
  [extras])`. There is **no stored layout field**; Lang is derived from the card's text at render time.
- **MCP write tools** (`writeTools.ts`): `create_block`, `create_page`, `create_table`, `create_todo`, `create_connection`,
  `move_object`, `update_block`, `render_visual_plan`, `delete_object`. All propose through `proposeChangeSet`.
  `render_visual_plan` already lets a client send a whole plan that the canvas lays out **with no model call** — the same
  pattern this plan extends to OpenUI layouts.
- **Spend guard pattern**: `import_content` (`ingestTools.ts`) is the only tool that spends credit; it's off per workspace
  until "Allow AI imports" is ticked. `McpAccess` (`bridge/access.ts`) holds per-workspace `workspaces` / `readOnly`.
- **Remote profile** (`remoteProfile.ts`): `restricted` by default with a read-only allowlist; the finalized allowlist and the
  revert/delete safety tests are still open (in-progress list). Any change under `src/mcp/**` invalidates the MCP launch check.
- **Canvas-level settings**: `CanvasDocument` (`domain/types.ts:50`) has `id, workspaceId, title, viewport, createdAt,
  updatedAt` — no settings bag yet. `uiPrefs` are per device, not per canvas.
- **Distil gate**: distil as the default is release gate **R1** (knowledge-notes plan §9, S2.6). G1 passes 7/7 live
  (2026-11-17); G2, G8, G9 and the golden-set review are open. The card-modes plan records the owner may ship it earlier
  behind a flag by explicit decision.

## 4. Design

### 4.1 Canvas mode

- New field on `CanvasDocument`: `noteMode?: "manual" | "ai"` (absent = `manual`, so existing canvases change nothing).
  Set when a canvas is created (a picker on New canvas, remembered as the device's last choice) and changeable any time
  from the canvas header (⋮ → Note-taking mode). Changing it rewrites no object.
- What the mode defaults (P1 — defaults only):

| Default | Manual | AI-managed |
|---|---|---|
| View (`blockDisplay`) when the canvas has no stored view | Cards | Cards |
| Visualize note model when the dialog isn't told | distil (needs decision D1) | distil |
| Visualize section rendering | as today (kind → native nodes) | OpenUI layout where one exists for the kind (step 6), else native |
| Double-click on an AI-layout card | editor (converts to editable, warns) | "Ask AI to change" / "Switch to editable" |
| MCP `create_block` / `update_block` | as today | as today (they still work; a client wanting a layout uses the new tools) |
| New card drawn by hand | editable text block | editable text block — **unchanged** |

- Nothing is disabled by the mode. The toolbar, text editor, tables, shapes and connections are identical in both modes.

### 4.2 Per-card layout (the stored field)

- New domain field on text blocks: `layout?: { format: "openui-lang"; version: 1; lang: string; hash: string }`, beside the
  rich content. `hash` is the fingerprint of the rich text the layout was composed from. When the text changes (any editor,
  update engine, MCP `update_block`) and the hash no longer matches, the card renders the **derived** Lang (`cardLangOf`)
  instead of the stored one — the layout is stale, not wrong, and a small "layout out of date" chip offers "Ask AI to
  refresh" (paid, asked first) or "Remove layout".
- Rendering order in Cards view: stored layout (if hash matches and parses) → derived Lang (if the card cites a source, as
  today, or — new — in AI mode for any text block) → Compact.
- Export, search, Notes view, Study, `get_block`, the update engine: unchanged, they read the rich text (P2).

### 4.3 MCP: the client composes, the canvas validates

New write tools (all through `proposeChangeSet`, all free of model calls):

| Tool | Input | What the canvas does |
|---|---|---|
| `create_layout_card` | `{ title, markdown, lang, cites?: string[], canvasId? }` | Parses `lang` against the OpenUI library (reject on parse error, with the errors); checks size limits (`TEXT_LIMITS`, a Lang byte cap); checks `cites` resolve to real passage ids of a content source in this workspace; checks the layout and the text agree (every string literal in the Lang occurs in the markdown or the cited passages — a cheap containment check, no model); places the block as `create_block` does; stores text + layout + hash; proposes. |
| `update_layout_card` | `{ objectId, markdown?, lang?, cites?, expectedHash? }` | Same checks; `expectedHash` is the card's current content hash the client read — mismatch refuses with `canvasChanged`, so a client never overwrites an edit it hasn't seen. Keeps the card's own provenance and reconciliation link (like `update_block`). |
| `get_layout_grammar` (read) or an MCP **resource** `acute://openui/grammar` | — | The library's components, their arguments, one worked example per layout, and the limits. So any client can compose without guessing. |

- The tool descriptions stay under 1,024 characters (ChatGPT connector limit); the grammar goes in the schema `describe`s
  and the resource.
- `get_block` gains `layout` in its output (the stored Lang and whether it is current), so a client reads before patching.
- Updates name their target directly, so the canvas's `match_statements` decision call isn't made for MCP layout updates.
- Remote profile: `create_layout_card` / `update_layout_card` are **write** tools, excluded from `restricted` like every
  other write; `get_layout_grammar` may join the read allowlist.

### 4.4 Where the canvas's own AI still runs (and is still paid)

- In-app Visualize, distil, "Ask AI to change" on a layout card, "Ask AI to refresh" a stale layout. These are the user's
  in-app actions, under the existing AI settings and spend summary.
- `import_content` over MCP, as today, behind "Allow AI imports".
- **Not** for MCP layout tools: they never call a model.

## 5. Steps

| Step | Lane / files | Builds | Needs |
|---|---|---|---|
| 1. Decisions D1–D4 (below) | owner | — | your answers |
| 2. Canvas mode field + header switch + New-canvas picker | domain (integrator lane: `domain/types.ts`), `uiPrefs.ts`, canvas header | `noteMode`, defaults table §4.1 rows 1–2; tests: default is manual, switching rewrites nothing, View default per mode | D1 for the distil default |
| 3. Stored layout field + render order + staleness | domain (integrator lane), `cardLang.ts`, `CanvasOpenUiCard.tsx`, `canvasCardsStore.ts` | §4.2; tests: hash match/mismatch, parse-fail fallback, export unchanged, provenance guard green | — |
| 4. Layout validator (shared, no model) | `src/ai/openui/layoutCheck.ts` (new) | parse, size caps, cite resolution, text/layout agreement | — |
| 5. MCP tools + grammar resource + `get_block.layout` | `src/mcp/tools/layoutTools.ts` (new), `readTools.ts`, `resources/` | §4.3; tests like `publishedTools.test.ts` / `tools.test.ts`; revert/delete safety for layout cards | invalidates the MCP launch check → rerun `Verify` after; D3 |
| 6. OpenUI layouts for more kinds | `library.tsx`, Visualize render path | one kind first (timeline/flow, D4), AI mode uses it; then comparison, decision | its own paid test runs, approved first |
| 7. Double-click paths per mode | `CanvasOpenUiCard.tsx` | "Ask AI to change" (paid, asked first) / "Switch to editable" (warn: visual structure lost) | — |
| 8. Live check | e2e local (scripted distiller, mock MCP client) then one approved paid run | a client composes 3 cards and 2 updates; no `callStats` model call recorded for them | your approval for the paid part |

Steps 2–5 are offline and free (unit + local e2e). 6 and 8's paid part each need approval.

## 6. Decisions needed

| # | Question | Recommendation |
|---|---|---|
| D1 | Distil as the Visualize default (R1) before G2/G8/G9 close? | **Yes, development only**, behind the existing `.env.development` flags; production keeps `preserve` until R1. The multi-turn test doc then needs its exact-wording checks changed to meaning checks. |
| D2 | Mode per canvas only, or also a workspace default for new canvases? | Per canvas, with the device remembering the last picked mode. A workspace default can come later. |
| D3 | Text/layout agreement check: containment only, or also require every citation to appear in the Lang? | Containment only; a layout may legitimately show fewer cites than the text carries. |
| D4 | First additional OpenUI layout for AI mode? | Flow/timeline: it's the most common native-shape section today and the one Test 2 showed is hardest to update in place. |
| D5 | Should Manual mode also render *uncited* text blocks as OpenUI cards (derived Lang)? | No — keep today's "cites a source" rule in Manual; in AI mode render all text blocks as cards. |
| D6 | Gating of MCP tools | Everything is manageable over MCP. The intelligent-UI tools (`create_layout_card`, `update_layout_card`, the grammar resource) sit behind one workspace-level access switch ("Allow intelligent UI over MCP"), on the same pattern as "Allow AI imports" and **free for now** — a future paid-tier or rate limit attaches to that switch without changing the tools (compare Notion's hosted MCP: free to connect, the client's own AI pays, advanced tools gated by plan). |

### Approvals (product owner, 2026-11-23)

D1–D5 approved as recommended; D6 added from the same instruction. Step 2 authorized; Steps 2–5 may proceed sequentially
offline with verification after each; Step 5 must rerun the MCP launch verification (including revert/delete safety checks);
no remote MCP launch, Step 6, its paid tests or the paid part of Step 8 are authorized. Conditions: P1 non-negotiable; changing
mode rewrites no objects, layouts, provenance or study history; canvases without `noteMode` keep working; domain fields go
through the knowledge-notes integrator lane; production unchanged, distil never activated globally. **D3 wording rule:** containment
is a structural check, not proof the layout is faithful; the review flow stays mandatory and no message may describe a passed
validation as confirmation that the layout represents every claim in the text.

## 6a. Step 2 build status (2026-11-23, uncommitted)

**Built:**
- `CanvasDocument.noteMode?: "manual" | "ai"` (`domain/types.ts`) and `domain/noteMode.ts` (`noteModeOf`, labels; absent =
  manual). **Integrator-lane change:** one optional field on `CanvasDocument`, no `AIMetadata` change.
- `workspaces/hierarchy.ts`: `createCanvas(…, noteMode?)` (the default is left off the document) and `setCanvasNoteMode`,
  which writes **only** `canvases.put` (tested with a write-recording store: no scene, block, page, meta/study write).
- Device prefs (`state/uiPrefs.ts`): View default = Cards while `NEXT_PUBLIC_OPENUI_CANVAS=on` (development only), Compact
  otherwise; a stored View always wins. `newCanvasNoteMode` remembers the last mode picked (D2).
- Visualize: "Distil into key ideas" starts **ticked** while the Cards flag is on (`defaultNoteModelTicked`); it can be
  unticked every run; `FIDELITY_CONFIG.noteModel` stays `preserve` (D1, production unchanged).
- UI: ⋮ → "Note-taking mode (default only)" with Manual / AI-managed, current one marked; the workspace menu's New canvas
  shows the remembered mode, plus "New canvas: <other mode>". Switching keeps the canvas open.
- Export/import carry `noteMode`; a missing or unknown value imports as manual.
- No change under `src/mcp/**` (the MCP launch check is not invalidated by Step 2).

**In AI-managed mode nothing renders differently yet** — that starts at Step 3 (derived cards for every text block) and
Step 6 (OpenUI layouts per kind). Today the mode is stored, shown, remembered and exported.

**Verified:** unit — new `workspaces/noteMode.test.ts` (5), `components/shell/noteModeMenu.test.ts` (2), additions to
`uiPrefs.test.ts` (3), `noteModelOption.test.ts` (1), `workspaceBundle.test.ts` (1); full suite 3,959 passed, 0 failed;
`tsc` and ESLint clean. Local e2e — new `e2e/local/noteMode.local.spec.ts` 6/6 (legacy canvas reads Manual, View defaults to
Cards, switch survives reload with an identical scene and undo step, hand editing works in AI mode, new canvas gets the
remembered mode, distil ticked and untickable, no console errors). `openuiCanvas.local.spec.ts` updated: it asserted the old
unticked default.

**Full local e2e (2026-11-23):** 251 tests, first run 21 failed with 2 workers; 17 still failed with 1 worker. To separate
cause, the same 17 were rerun with the two new defaults switched back (View Compact, distil unticked) and then restored:
**16 failed the same way**. So the new defaults caused **2** failures, both fixed and passing (24/24 with `noteMode`):
- `knowledgeNotes` "preserve canvases look exactly as before": the dialog's ticked box overrode the page's `setNoteModel`;
  the spec's `visualize` helper now unticks it so the page's setting decides.
- `openuiCanvas` step 1 asserted View starts on Compact; it now clicks Compact before the Compact → Cards comparison.

The other 15 fail without the new defaults too (not caused by Step 2): Escape not closing dialogs/menus/the editor under
Playwright (`askAI`, `canvasExport`, `routeProbe`, `contentSource`; known since 2026-11-17); `outline_document` no longer
called for one-part notes (`choices`, `visualizeSmoke` ×2; the 2026-11-22 performance change); `stage1Gate` 4c (known);
`mcpRemoveRevert` ×5, `commitIndex`, `followUpReplies`, `studyChangedCard`, `conversations`, `askAICoverage`. **Caveat:**
the Visualize specs among them (`choices`, `visualizeSmoke`, `followUpReplies`, `commitIndex`) already fail for another
reason, so a second failure from the distil default could be hidden behind it until those are fixed.

**Side effect to know:** in development every Visualize now distils unless unticked, including the manual multi-turn tests
(`visualize-multi-turn-update-tests-2026-11-22.md`) and the paid `e2e/ai` specs that drive the dialog. Untick the box to
run them as before.

## 6b. Step 3 build status (2026-11-23, uncommitted)

**Built:**
- `DocumentRecord.layout?: CardLayout` (`{ format: "openui-lang", version: 1, lang, contentHash, writtenAt }`) and
  `CARD_LAYOUT_LANG_MAX` (16,000) in `domain/types.ts` — **integrator-lane field**; not `AIMetadata`.
- `ai/openui/cardLayout.ts` (pure): `cardContentHash` (hash of the card's title, plain text and table — formatting-only
  edits don't make a layout stale), `layoutFor`, `layoutStateOf` (none / current / stale), `cardRenderPlan` (the draw order).
- Draw order in Cards view: current stored layout → card derived from the text → Compact; a Lang that doesn't parse falls
  through. Which blocks qualify (`RichBlockHost`): a source-citing card (as before), any block with a stored layout (every
  mode, P1), and **framed** text blocks on an AI-managed canvas. Frameless text stays as written (decided in the build: a
  one-line frameless box clipped the card; the plan's "every text block" now reads "every framed text block").
- Stale layout: drawn from the new text with a "Layout out of date" chip and **Remove layout** (`DocumentStore.setLayout`,
  which changes only the layout). "Ask AI to refresh" is not built (Step 7, paid, asked first).
- The canvas's mode reaches blocks through `canvasCardsStore` (`setNoteMode`, `useCanvasNoteMode`); leaving the Cards view
  keeps it (`clearCards`), closing the canvas resets it.
- Export/import carry `layout`; a malformed one (wrong format, empty, over the cap) is dropped on import, not failed. A
  canvas copy keeps it (the Lang names no block id). MCP output is unchanged (no serializer spreads a record).
- Dev hook `__acuteDev.setCardLayout(documentId, lang | null)` for tests; Step 5's tools will write the same field after review.

**Verified:** unit — `cardLayout.test.ts` (10), `canvasCards.test.tsx` (+5: stored drawn, stale + Remove, broken layout
falls back, AI vs manual, store keeps the mode), `documentStore.test.ts` (+2), `workspaceBundle.test.ts` (+1); full suite
3,995 passed (provenance guard included); `tsc`/ESLint clean on changed files. Local e2e — new `cardLayout.local.spec.ts`
5/5 (manual: uncited stays Compact; AI: framed block is a card, frameless stays plain, documents unchanged; stored layout
draws in manual and survives reload; text edit → stale chip; Remove layout clears only the layout; no console errors), and
`openuiCanvas`, `knowledgeNotes`, `notesStudy`, `openuiNotesFlow`, `noteMode` — 44/44 together. Screenshots checked.

**Known limitation (not new, now more visible):** Cards view never resizes a block (2026-11-17 decision: no overlap, no
stored-size change), so a hand-made card sized for its Compact look shows its title and a clipped first line as an
IdeaCard. On AI-managed canvases this affects every framed block. Options for later: size layout cards when Step 5's tool
creates them; or an opt-in "fit cards" action that resizes (one undo step).

## 6c. Step 4 build status (2026-11-23, uncommitted)

**Built:** `src/ai/openui/layoutCheck.ts` — `checkLayout({ lang, card?, passages?, objects? })`, `checkLayoutStructure(lang)`,
`layoutReviewLines(check)`; deterministic, no model call.
- **Errors (refuse):** empty or over limits (16,000 chars, 120 statements, 200 components, 8,000 chars of text); doesn't
  parse (library errors, unresolved references, truncated, no root); **not static** — an allow-list: outside string
  literals the only calls are the card library's components, so `Query`, `Mutation`, `Action`, `OpenUrl`, builtins like
  `Each`, unknown components and any `$state` are refused; a citation that isn't a passage the card may cite (or any
  citation when the card has no source); a number not in the card's text or a **cited** passage; a NoteLink to an object
  not on the canvas (when the caller passes the canvas's ids).
- **Notes (to the review, never refusing):** a phrase mostly in words the card's text and cited passages don't use;
  statements nothing draws. Chip and link captions (`CitationChip`/`SourceLink`/`NoteLink` labels) aren't compared.
- **D3 wording:** `layoutReviewLines` says "Layout structure checked … this check doesn't compare meaning"; a test pins
  that no line says verified/faithful/accurate/correct/confirmed.
- **Drawing:** `cardRenderPlan` draws a stored layout only while it passes `checkLayoutStructure` (a layout from an import
  or an older build is never drawn unchecked); the `setCardLayout` dev hook refuses Lang that fails it.
- Found while building: the card library already has `Timeline`, `TimelineEvent`, `FlowDiagram`, `DecisionCard`,
  `QuizCard` and `Flashcard` (OpenUI Phase 3), so Step 6 starts from existing components rather than new ones.

**Verified:** `layoutCheck.test.ts` (14) + `cardLayout.test.ts` (10) green; each refusal's message checked by hand to come
from the rule it names; `tsc`/ESLint clean on changed files. Local e2e `openuiCanvas`, `noteMode`, `cardLayout` 15/15, twice.

**Two flaky local specs found and fixed (not caused by Step 4 — shown by removing Step 4 from the render path: still
failing 2/2):** `openuiCanvas` step 4 compared every box across Cards → Compact, but the card edited in step 3 grows in
BlockNote and Compact re-fits it (timing decides whether it had grown); it now exempts that card, as the same test's next
assertion already did. `noteMode` compared element versions after a reload, where a frameless block's re-measure bumps its
version at the same size; it now compares id, type, position and size after the reload (exact versions are still compared
in-session). Observation: `resizeElement` bumps the version even when the size is unchanged.

Unit timing failures seen once under load (`layoutDReuse`, `updateOwnPassage`, `citationUpdate`, `meaning.eval`,
`repoMap` < 150 ms) all pass alone (95/95).

## 6d. Step 5 build status (2026-11-23, uncommitted)

**Built:**
- **MCP tools** (`src/mcp/tools/layoutTools.ts`): `get_layout_grammar` (read), `create_layout_card`, `update_layout_card`.
  No model call anywhere. React/OpenUI stay out of `src/mcp`: the app passes the check and grammar in
  (`LayoutToolOptions`, loaded lazily in `McpBridgeHost`).
  - **Gate (D6):** off per workspace until ⋮ → MCP access → **"Allow intelligent UI"** (`state/mcpIntelligentUi.ts`,
    device-local like "Allow AI imports"); free. `ToolPolicy.entitlement("intelligent_ui")` is checked first, so a plan
    limit attaches later without changing a tool (returns `entitlement_required`; nothing sets it in this build).
  - **create_layout_card:** Markdown (the card's text) + Lang; renders the card through the same path as `create_block`,
    runs `checkLayout` against the exact content that will be stored, refuses with every problem or proposes one text
    card carrying `layout`, its box at least `layoutCardHeight` tall. Citations need `sourceId` — a content source **on the
    open canvas** — and only its latest version's unit ids pass.
  - **update_layout_card:** aimed at one text card by object id: new text, new layout, both, or `removeLayout`. Same
    stale-target protection as `update_block` (`expectedFingerprint`; an edit before Accept asks Keep mine / Use
    proposed), plus `expectedContentHash` from `get_block`, which refuses at once when the card changed since it was read.
    A text-only update warns that the old layout will show as out of date.
  - `get_block` gives a text card's `contentHash` and its `layout` (`lang`, `current`).
  - Never auto-accepted (not in `AUTO_ACCEPT_TOOLS`); read-only workspaces refuse the writes at call time, as every
    write tool does; `availableTools` lists the writes only while writes are allowed.
  - **Remote:** served to remote sessions, filtered by the profile. `restricted` (the default) doesn't list them — the
    audited allowlist is unchanged. Adding `get_layout_grammar`/`create_layout_card` to it is a launch decision (open).
- **Change sets (integrator lane, `ai/changes/changeSet.ts`):** optional `layout: { lang }` on `create_block`, and
  `layout: { lang } | null` on `update_block` (schema capped at 16,000 chars, strict).
- **Writer (`changeSetWriter.ts`, `richBlocks.ts`):** a created text card stores its layout stamped with the written
  content's hash. `update_block` is copy-on-write, so: new layout → stamped for the new content; `null` → none; absent →
  the old layout carried over (stale once the text differs — this also covers the update engine's own updates). Undo
  points the block back at the old document, so the old layout returns with no extra step.
- **Sizing:** a block with a stored layout keeps its box in every view (no auto-height fit in Compact), so Cards never
  clips it; the editor still grows it while editing.
- `cardRenderPlan` takes the structure check as `drawable` from its caller (no stored layout is drawn without one), so
  the writer hashes cards without loading OpenUI into the main bundle.
- Grammar (`ai/openui/layoutGrammar.ts`): the library's own prompt (syntax + signatures, ~5k chars), the canvas's rules
  and limits, one example per layout (IdeaCard, Timeline, FlowDiagram, DecisionCard, ComparisonTable); every example
  passes the check; it says passing means nothing mechanical was found, not that a layout is right.

**Verified:** `layoutTools.test.ts` 14 (real MCP client: listing, read-only refusal, restricted remote hides them, never
auto-accepted, gate off, entitlement refusal, grammar, create proposes a checked card, refusals propose nothing, citations
only from a source on the open canvas, update aimed at one card with baseline, removeLayout, text-only warning, stale /
non-text / empty / contradictory refusals, get_block hash + layout); `changeSetWriter.layout.test.ts` 5; all `src/mcp`
355/355; the launch gate's unit suites 158/158; local e2e `layoutCard.local.spec.ts` 5/5 (in-app proposal path, MCP
access off: review, Accept, drawn from its layout, box kept across views, undo, remove + undo restores the layout,
text-only update → stale chip; screenshots checked). `tsc`/ESLint clean on changed files.

**MCP launch check: NOT rerun — blocked.** `-Check` (2026-11-23): gate CLOSED — the record was already stale (last
`-Verify` 2026-11-15) and **:3000 listens on `::`**; `-Verify` refuses unless the dev server runs loopback-only
(`npx next dev -H 127.0.0.1`), because its specs switch MCP access on. Restarting the shared dev server needs the owner.
**Disclosure:** this lane's full local e2e runs during Step 2 included those gate specs (`mcpConflict`,
`chatgptRehearsal`, `mcpRestricted`, `exposure`, `mcpRemoveRevert`, `staleTarget`) while :3000 listened on all
interfaces — throwaway Playwright profiles, test data, short-lived tokens, but against the gate's loopback rule. They are
kept out of runs until the server is loopback-only. The `full` profile also needs `mcpRemoveRevert`, which fails on
today's tree before this work (5 tests in the 2026-11-23 baseline).

**MCP launch check rerun — passed (2026-11-24).** The owner restarted the dev server loopback-only (127.0.0.1:3000,
confirmed before running). `-Verify` (restricted): 13 e2e passed, gate unit suites 158/158; gate record written,
fingerprint `e6bf60c8…5522e`; `-Check`: gate (restricted) **open**. This verifies the restricted profile only — the
layout tools are not on its allow-list, so remote restricted sessions don't see them. The `full` profile stays closed
(`mcpRemoveRevert` pre-existing failures). Nothing was launched: `-Start` still needs the owner's explicit
authorization. Any further edit to fingerprinted code (`src/mcp`, `src/ai/changes`, `src/app/api`, `src/config`, …)
makes the record stale again.

## 6e. Step 6 build status (2026-11-24, uncommitted; offline — no paid run)

Owner: "go ahead with Step 6" (2026-11-24). Built and verified offline with locally answered AI calls; **the paid test runs
Step 6 lists were not run** (they still need their own approval).

**Built — flow sections (D4) as one FlowDiagram card on an AI-managed canvas:**
- `ai/visual-plan/flowCards.ts` (new, pure): a `flow` section whose steps are a plain linear chain (2–12 step shapes, one
  chain or no links, no labelled link, no architecture semantics, each explanation linked from one step only, nothing
  linking in or out) becomes ONE text node (`role: "flow-card"`, key `<section> § flow-card#0`): the steps as a numbered
  list, each with its explanation under it. Anything else stays native — nothing a FlowDiagram can't show is dropped.
  Other members (analysis, notes, pages) stay as they are.
- `ai/openui/flowLayout.ts` (new, pure): the card's Markdown ↔ `FlowDiagram` Lang, built in code (never by a model);
  `flowOfContent` reads the steps back from the card's text (checked through the real Markdown parser).
- Renderer: a flow-card node is created with its `FlowDiagram` layout (`mapNode.ts`), 720 px wide (`measure.ts`).
- Visualize: `canvasNoteMode: "ai"` (from the open canvas, via the dialog → ingest) collapses flow sections; the stored plan is
  the collapsed one. Distil: ideas, reviews and flags on collapsed nodes move to the card (`visualize/flowRun.ts`), so no
  citation is lost, and the card's FlowDiagram shows them as chips. "Keep as text" is judged on the plan before collapsing.
  Manual mode, MCP `import_content` and production (Cards flag off → mode reads manual) are unchanged.
- `FlowDiagram` gained an appended optional `citations` prop (positional props only ever appended).
- Drawing: a flow card whose text changed (an update, a hand edit) is redrawn as a flow from its text now — no "Layout out
  of date" chip while the text is still a flow; otherwise Step 3's behaviour (derived card + chip).
- **Update engine hook (cross-lane — `ai/reconcile/update.ts`, please review):** after the next plan is built, sections that
  were a flow card in the stored plan are collapsed again (`collapseFlowsLike`), so the update changes the card in place
  instead of removing it and adding shapes. Inert unless the stored plan has a flow card: every other source updates
  exactly as before. A section that is no longer a plain flow goes native (the review shows the swap).

**Decided here — confirmed by the owner 2026-11-24 ("confirming that comparison and decision sections stay native"):**
- Comparison stays a native table block: it is already structured and cell-editable; a `ComparisonTable` layout on a text
  card would lose cell editing for no visual gain.
- Decision stays native: `DecisionCard` models one question with weighed options, while decision sections are several
  decisions each with a proposal — mapping one onto the other would invent structure the content doesn't have.
- Timeline: no section kind produces dated events today; FlowDiagram covers sequences. Revisit if the outline gets a
  `timeline` kind.

**Verified (offline, free):** unit — `flowLayout.test.ts` (7, real Markdown parser), `flowCards.test.ts` (13: collapse rules,
branch/labelled/cycle/out-link/explained-analysis stay native, update re-collapse), `flowCardsRun.test.ts` (5: scripted
model; AI mode → one card, no shapes or links; Manual → native as before; update changes the card in place, a second
identical update proposes nothing; a source without a card updates as before; distil ideas move to the card; the card's
FlowDiagram shows its units as chips); full unit suite 4,089 passed, 0 failed (`provenanceGuard` first caught `sourceUnits`
named in `flowRun.ts`; the chips now come from the run's own `cites` map, so the guard is unchanged). Local e2e — new `flowCards.local.spec.ts` 3/3 (AI calls
answered by the spec: Visualize on an AI-managed canvas → one FlowDiagram card, steps in order, detail on click; Update from
new content → same card, new detail, no stale chip, no shapes; no console errors; screenshots checked) and 34/34 nearby
specs (layoutCard, cardLayout, noteMode, openuiCanvas, sectionUpdates, visualize). No gate spec was run. MCP launch gate:
still open (`-Check` 2026-11-24 — no fingerprinted path changed).

**Known limits:** the card's box is sized from its text (so Compact never clips), which leaves empty space under the
FlowDiagram in Cards view, and the FlowDiagram's own border sits inside the card's frame. A flow's step details show on
click, not all at once.

## 6f. Step 7 build status (2026-11-24, uncommitted; offline — no paid run)

Owner: "go ahead with Step 7" (2026-11-24). Built and verified with every AI call answered locally; no real model was called.

**Built — opening a layout card asks first:**
- Applies to a text card the Cards view draws from a **current, non-flow** stored layout (a flow card is redrawn from its
  text, so editing loses nothing; a stale layout has nothing left to lose). Intercepted where the editor renders
  (`RichBlockHost.tsx`), so every way of opening (double-click, click on a selected card, Enter) asks the same way.
- **AI-managed canvas:** "This card is drawn from a layout." → **Ask AI to change…** / **Switch to editable** (warns: editing
  leaves the layout out of date, its visual structure is lost until refreshed or removed; undo brings it back) / Cancel.
  No editor opens until "Switch to editable". Each opening asks again.
- **Manual canvas:** the editor opens, with a warning strip and "Ask AI to change instead" (P1: both paths in both modes).
- **Ask AI to change…** (`LayoutCardGuard.tsx`): an instruction box that says, before anything runs, "Uses your AI
  provider (one request). Nothing changes until you accept it in the review." One click = one request
  (`compose_card_layout`, `ai/openui/layoutTask.ts`: the layout grammar + the card's Markdown, its current layout and the
  citations it may use; one-request policy, no repair). The reply's Markdown + Lang are checked against the card
  (`checkLayout`: numbers, citations, structure); a failing reply is **not proposed** and the problems are listed; a passing
  one is proposed as one `update_block` (text and layout together; stale-target baseline stamped by the pending store), with
  any flagged wording listed. Wording never says the layout was verified (D3).
- **"Layout out of date" chip:** adds **Ask AI to refresh** → "Refresh with AI? One request; you review it first." → Refresh
  proposes a layout redone for the card's current text (same checks, same review).
- AI mode Off: no Ask AI buttons (Switch to editable / Remove layout remain).
- Fix found while testing: the chooser fills the card's box and never resizes it — resizing an active block under the
  chooser left Excalidraw's embeddable container with `pointer-events: none` (its buttons became unclickable).

**Verified (offline, free):** unit — `layoutAI.test.ts` (8, mock model: one request; passing reply proposed not applied;
text+layout together; number not in text refused; unknown citation refused, known one accepted; no layout / no provider →
failed, nothing proposed; refresh sends the stale layout); `canvasCards.test.tsx` updated (chip: Ask AI to refresh only
confirms, Remove layout as before); full unit suite 4,097 passed, 0 failed. Local e2e — new `layoutAsk.local.spec.ts` 7/7
(AI calls answered by the spec: chooser on double-click, no editor until "Switch to editable"; Cancel; refused reply →
"Not proposed", no review, one request; passing reply → review, unchanged until Accept, Accept draws it, undo restores;
Manual → editor + warning; stale → Ask AI to refresh asks first, proposes, Accept makes the layout current; no console
errors; screenshots checked); nearby specs 16/16 (layoutCard, openuiCanvas) and 18/19 → 6/6 on rerun (`noteMode` reload
race seen before). MCP launch gate: still open (`-Check` 2026-11-24).

**Known limits:** the review row describes a layout-only change as "no visible text change" — the proposed drawing can't be
previewed before Accept (the same for MCP `update_layout_card`, Step 5); a layout preview in the review is the natural next
piece. The real-model quality of `compose_card_layout` replies is untested (needs the paid run).

## 6g. Layout preview, owner decisions and the live runs (2026-11-24, uncommitted)

Owner (2026-11-24): "proceed with all 3" — approve the paid runs (Step 6 and `compose_card_layout` quality), add a layout
preview to the review, and confirm comparison/decision stay native (recorded in §6e).

**Layout preview in the review (built offline):** a clean `update_block` that sets, changes or removes a card's layout now
says so ("…; changes its layout" / "adds a layout" / "removes its layout") and has **Preview layout**: the card's layout now
and as proposed, drawn side by side (`LayoutPreview.tsx`, lazy — OpenUI loads only when opened), with the D3 line "The canvas
checked this layout's structure, not its meaning: check it says what the card says before you accept." A new text card
created with a layout (MCP `create_layout_card`, Visualize flow cards) is listed as "New card drawn from a layout" with its
preview. Covers the MCP tools, Ask AI and Visualize alike. Tests: `layoutReviewRows.test.ts` (4); local e2e — the preview
checked in `layoutAsk` (now vs proposed) and `flowCards` (the new flow card's three steps).

**Live runs** (`e2e/ai/layoutModes.spec.ts`, AICredits, `openai/gpt-oss-120b` + `google/gemini-2.5-flash-lite`, distil on as
the AI-managed default; evidence: `.ai/docs/openui/live-runs/2026-11-24-layout-modes/run1`–`run3` — replies, report.json, screenshots). Estimated spend at 0.15/0.60
USD per M tokens: run 1 ≈ $0.007, run 2 ≈ $0.013, run 3 (Step 7 only) ≈ $0.003 — about **$0.023** in all (the provider's
bill is the real figure).

- **Run 1 — Step 6 found a real gap.** The outline made the release steps a `flow` section, linear, but the model also
  linked its two analysis notes to the first step (`relates_to`); the collapse refused any link touching a step, so the flow
  stayed native. **Fixed:** an unlabelled link between a step and another node is kept and now ends at the card (deduped);
  labelled links, branches and cycles still keep a section native (`flowCards.ts`, tests updated). The spec was split into
  two groups so a Step 6 finding no longer stops Step 7.
- **Run 2 — Step 6 works on a real model:** one FlowDiagram card, 5 steps in order, citing u4–u8 (distil chips); the review
  listed it for preview. **Update from new content** ("two"→"three" reviewers, 30→45 minutes) changed the **same card in
  place** (no step shapes). Step 7: table and callout proposed and drawn; the **timeline was refused** — "Day 1" for "day
  one" failed the number check. **Fixed:** small numbers written as words (zero–twenty, first–tenth) count as the digit;
  a missing number is reported once. Prompt tightened: a request about how the card looks changes only the layout.
- **Run 3 — Step 7, 4/4 proposed, one request each, every accepted layout draws:** timeline (faithful, text unchanged),
  comparison table (faithful, text unchanged — run 2 had rewritten the text into a Markdown table), refresh of the edited
  onboarding card (timeline redone with month 2 / month 3; current after Accept, no chip), callout (layout faithful, but the
  model still **added an invented summary sentence** to the card's text — visible as a text change in the review).

**Open findings (not fixed):**
1. Real-model update of the flow section: besides the card update, the review held "+4 new · −2 removed", and the new
   analysis cards were placed outside the section's frame. Not yet attributed (analysis cards are redone when a section is
   regenerated; placement is the update engine's). Next: replay run 2's saved replies offline (free) with and without the
   collapse to see whether the flow card contributes.
2. Distil fidelity (another lane): a source line broken right after "10:00" ("…at 10:00\non Tuesday") produced a card line
   "From the source: 00". Repro in run 2's `A1-visualize-replies.json`; for the knowledge-notes lane.
3. "Ask AI to change" may still alter the card's text when the instruction mentions a summary; the review shows it, but the
   prompt alone doesn't prevent it. Option: a "layout only" toggle that keeps the Markdown and refuses a reply that changes it.

## 6h. Replay of the update churn, and "Layout only" (2026-11-24, uncommitted)

Owner: "yes, use paid run if needed" — do the offline replay of finding 1 and add the layout-only setting (finding 3).

**Replay (free):** `e2e/local/flowReplay.local.spec.ts` serves run 2's saved replies back to the real app (13/13 prompts
matched exactly in both modes) and records every proposed change with its stable key, plus where each object of the section
ends up. Evidence: `live-runs/2026-11-24-layout-modes/replay/`. A dev-only `__acuteDev.pending()` hook
(`ExcalidrawCanvas.tsx`) reads the set under review.

| Same section, same replies | AI-managed (flow card) | Manual (native shapes) |
|---|---|---|
| Update review | +4 new · −2 removed · ~1 updated | +7 new · −5 removed · ~3 updated · 4 need your input · 22 crossings |
| Steps | the card is updated in place | all 5 step shapes removed and added again |

- **The churn is not the flow card's — the card reduces it.** Cause: the model's structural keys change between replies
  (`shape#0…4` on the first run, `step#1…5` on the update; analysis notes `text#5/6` → `text#7/8`), and the update engine
  matches by key, so the same content reads as a removal plus an addition. The flow card's key is derived from its section,
  so it survives. For the update-engine lane: key stability across regenerations (`reconcile/keys.ts` ordinal fallback).
- **Placement is worse on the AI-managed canvas.** New members of a section are placed below its lowest member; there that
  is the flow card, whose box is sized for its text (tall), and the next frame sits right below — so the placement went
  *across*, past frame 2, and frame 1 grew to x=3,594 over frame 2. Manual kept everything inside its frame. The weakness is
  the update engine's (`placeAdds` → reflow may grow a frame across another frame); the tall flow card triggers it. Options:
  (a) in the update engine, a section's adds stay in its own column — grow the frame downward and push the frames below
  (`makeRoomForFrame` exists for that); (b) size flow cards closer to their drawing (but Compact view would then clip the
  card's text). Recommendation: (a). **Fixed 2026-11-24 on the owner's go-ahead — see §6i.**

**Layout only (built):** the "Ask AI to change" box has **Layout only — keep the card's text**, ticked by default; "Ask AI to
refresh" is always layout only. The request says the text is fixed and asks for the layout alone; the code keeps the card's
text whatever the reply says, checks the layout against that text, and when the reply did rewrite the text the proposal says
"The AI also suggested changing the card's text; that was left out (layout only), so only the layout is proposed." Unticked,
text and layout are proposed together as before. Tests: `layoutAI.test.ts` +4 (12), `layoutAsk.local.spec.ts` +1 (8).

**Run 4 (Step 7 only, layout only on), AICredits ≈ $0.003:** 4/4 proposed, one request each, the model returned only the
layout every time, **the card's text was kept in all four**, every accepted layout draws; the callout used the card's own
words (run 2/3 had invented a summary sentence). Evidence: `live-runs/2026-11-24-layout-modes/run4-layout-only/`. Total live
spend for the day ≈ $0.026 (estimate; the provider's bill is the real figure).

Verified: full unit suite 4,108 passed, 0 failed; local layout specs 16/16. MCP launch gate: fingerprint unchanged; `-Check`
reports CLOSED only because the dev server on :3000 stopped during the session — restart it loopback-only to reopen.

## 6i. Update placement fix (2026-11-24, uncommitted; update-engine lane, owner's go-ahead)

Owner: "yes, fix the placement in the update engine".

**Cause (from the replay):** an update places each group of new objects in turn, and the objects it has just placed become
walls for the next group. A group joining a section's frame with nothing to anchor it went below the frame's lowest
*existing* member — the slot the previous group had just taken — so neither push was possible and reflow fell back to free
space anywhere (x≈2,600); `update_frame` then grew the frame across its neighbour.

**Fix (three parts):**
1. `reconcile/update.ts` `placeAdds`: a group joining a frame with no anchor goes below the frame's lowest member, counting
   the objects this update has already placed in it.
2. `renderer/reflow.ts` + `RenderContext.within`: when the content joins a frame, a candidate that would make the frame grow
   over something it doesn't cover now (a neighbouring frame, a loose object) is dropped while another candidate exists
   (`growsOver`). Growing into empty space is still allowed — a new last step to the right of a flow widens its frame as before.
3. `placeAdds`: a group anchored beside an object whose result would still grow its frame over another frame is placed again
   below the frame's lowest member (existing or new).

**Verified:** the replay (`flowReplay.local.spec.ts`, now asserting every object of the section is inside its frame and no two
frames overlap) — AI-managed: frame 1 ends at x=1,117 (was 3,594), all four new cards below the flow card inside it,
"Overview" pushed down; Manual: identical coordinates to before. `reflow.test.ts` +2 (`growsOver`, `within` unchanged when
nothing is grown over). Unit suite 4,110 passed, 0 failed; renderer/reconcile/visualize/merge 903/903. Local e2e: 45 passed,
2 failed, 11 skipped across 14 update/placement specs — the 2 failures (`choices`: expects `outline_document`;
`followUpReplies` Test 1: expects one update, gets none) fail identically with the fix backed out (checked), so they predate
it (`outline_document` skipped since the 2026-11-22 performance change). MCP launch gate open (dev server restarted
loopback-only, `npx next dev -H 127.0.0.1`).

## 6j. Production readiness: Step 8, distil default, flow card look (2026-11-24, committed 2026-11-25; owner's go-ahead)

Owner asked (2026-11-24) for items 1, 3 and 4 of the production-readiness list, and approved the paid part of Step 8 "when
needed".

- **Distil default decoupled from the Cards flag (D1).** `defaultNoteModelTicked` (`components/ai/noteModelOption.ts`, R1
  lane's file) now also needs a development build (`NODE_ENV === "development"`): turning `NEXT_PUBLIC_OPENUI_CANVAS` on in
  production or the desktop app leaves "Distil into key ideas" unticked, so production keeps `preserve` until R1. Test
  updated (`noteModelOption.test.ts`).
- **Flow card look.** Boxes were sized from the card's text (one line per step and detail: ~290 px for a 5-step flow);
  `renderer/measure.ts` `flowCardSize` now measures the FlowDiagram as drawn (steps packed into rows at up to 720 px,
  room for one step's detail, the chips row): the replay's flow card went ~290 → ~130 px and its frame shrank with it.
  `globals.css` flattens a FlowDiagram into its block like an idea card (no second border; detail scrolls; chips at the
  bottom). Same for a layout that is just a **Callout** (tone as a left stripe). `create_layout_card` (MCP) places a
  FlowDiagram card at its flow's width and sizes FlowDiagram/Callout cards as drawn (`layoutBoxHeight`); other layouts keep
  the text-based room. Tests: `measure.test.ts` (+4), `layoutTools.test.ts` (+1), `flowCardsRun.test.ts` (box assertion).
- **Step 8, local** (`e2e/local/mcpLayoutNoSpend.local.spec.ts`, free): the SDK's MCP client, with an AI provider connected
  (fake key, every AI request answered and counted, provider hosts counted and aborted), on an AI-managed canvas: grammar,
  3 cards (IdeaCard, FlowDiagram, Callout), 2 updates (layout-only with get_block's contentHash; text + layout), each
  accepted → **0 `/api/ai` requests, 0 model calls in `callStats`**; "Allow intelligent UI" off → refused; a control test
  proves both counters see an in-app "Ask AI to change" request. 7/7.
- **Step 8, paid** (`e2e/ai/mcpLayoutClient.spec.ts`, guarded by `MCP_CLIENT_RUN_APPROVED_BY`): the **Claude Code CLI**
  (signed-in subscription; empty working folder, `--strict-mcp-config`) as the client, the spec accepting each proposal.
  Result: 12 turns, 62 s, CLI-reported cost $0.73 (API-price equivalent; billed to the subscription), tool calls grammar → 3×
  `create_layout_card` → `list_blocks` → 2× `get_block` → 2× `update_layout_card`, **no layout refused**; final layouts: a
  warning Callout (retry policy, text kept), a 5-step FlowDiagram with Monitor added, an info Callout; **0 in-app AI
  requests, 0 model calls, 0 console errors**. Evidence: `live-runs/2026-11-24-step8-mcp-client/` (report, client stream,
  screenshots). The token never left `test-results/` and MCP access was switched off after.
- **Checks:** unit 4,134 passed (one run had `canvasCards.test.tsx` time out under full-suite load; passes alone and on
  rerun — flaky, not a failure of this change); 34 local e2e across the layout/flow/card specs; tsc + eslint clean. MCP
  launch gate re-verified on loopback (restricted: 13 e2e, 158/158; fingerprint `2e60fc96…`).
- **Known limits left:** an update never resizes a card (an IdeaCard changed to a Callout keeps its taller box); the
  trailing arrow after the last step of a wrapped row; flow details show on click only.

## 7. Out of scope here

- Any production flag flip; `apphosting.yaml` changes need separate approval.
- Real ChatGPT access (not authorized) and the open MCP items (restricted allowlist, revert/delete tests) — step 5 adds to
  those tests but doesn't close them.
- Clients doing the distilling themselves for in-app Visualize (that stays in-app AI).

## 8. Risks

- **Layout quality depends on the client's model.** Validation + fallback to plain text (P2) bounds the damage; the review
  bar shows the card before anything lands.
- **Stale layouts** after text edits by the update engine: handled by the hash (§4.2); the chip makes it visible.
- **Lang byte caps** must be chosen so a card can't carry a huge payload into the scene; reuse `TEXT_LIMITS` scale.
- **Two sources of truth** if someone edits the layout and not the text: impossible by design — only the tools write
  `layout`, and the editor only writes text.
