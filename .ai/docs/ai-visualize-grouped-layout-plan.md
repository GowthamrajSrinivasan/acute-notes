# F42 — Grouped, Linked Visualize Layouts: Implementation Plan

**Status:** Phases 1, 2 and 3 done (2026-09-27): frames, content-fit cards, the outline → section-kinds pipeline, local ASCII trees, and frames in "Update from new content". **Phase 4 (dense content) started 2026-09-27:** 4.1–4.4 done (4.2's prompt not yet tried on a real model); wider columns for moderately dense tables are split out as 4.5. The user ranks Visualize result quality above any new feature.

**Decisions (2026-09-27, from the user):**
- Sections are **native Excalidraw frames**.
- Each frame also gets its section title as **XL (36 px) text centred at the top inside the frame**. The frame's own name label is kept too.
- **No fixed-size containers:** blocks are sized from their content, and AI-created cards then follow their real content height (`BlockStyle.autoHeight`) until the user resizes one.
- **A section's members read left to right:** one row while it fits (1,500 px), else a 2-column (≤ 4 members) or 3-column matrix.
- **Sections themselves:** up to 3 share one row, 4 make a 2 × 2 grid, more fill 3 columns (masonry, ≤ 2,600 px).
**Tracker entry:** `ai-phase-implementation-plan.md` → F42.
**Standing constraint:** no git commits, pushes or PRs. Changes stay uncommitted.

## 1. Problem

When a long, mixed answer (headings, lists, tables, ASCII diagrams) is Visualized, the result is one tall column of cards. Several problems show up together:

- nothing is grouped;
- nothing is linked;
- parallel options (Free / Pro / Lifetime) become separate cards instead of one table;
- an ASCII tree becomes a code block instead of a diagram.

The reference input is the ChatGPT answer about Acute pricing (Free / Pro / Lifetime-BYOK, the "AI actions" cost table, the business-model tree, and the "instrument from day one" field list). This plan adds it as a fixture (see §6).

## 2. Root causes (verified in code)

| # | Cause | Where |
|---|-------|-------|
| R1 | **Structured markdown skips the AI entirely.** `assessStructure` counts headings, tables and code as 1.0 explicit, lists as 0.7, and sectioned prose as 0.6. A ChatGPT-style answer easily clears `SUFFICIENT_CONFIDENCE = 0.6`, so the local planner's plan is used as is. | `ai/content/localPlanner.ts:22,47-90`, `ai/visualize/visualize.ts:60` |
| R2 | **The local planner always stacks vertically.** Anything other than tables-only or a single short numbered list becomes `action_plan`, which uses the `document-stack` layout: a single column. | `localPlanner.ts:653-673`, `renderer/layout.ts:299` |
| R3 | **One template for the whole document.** `select_template` picks one of 8 templates from a 3,000-char excerpt, and every section is forced into it. Mixed content has no good fit. | `visualize.ts:68`, `visualize/tasks.ts:116-129` |
| R4 | **No grouping primitive.** `VisualPlan` has no group, frame or container node. Frames and groups exist in the scene (`groupIds`, `frameId`), and reflow already moves them as units. Nothing in the plan or the change set can create one. | `visual-plan/types.ts`, `domain/types.ts:157`, `components/canvas/renderPlanContext.ts:40-45` |
| R5 | **Sections can't link to each other.** Each analysis unit (section) is sent to the model on its own, so a relationship can never cross sections. Template-specific `allowedRelationTypes` then drop more edges. | `visualize.ts:73-81`, `validate.ts:127` |
| R6 | **No table-first rule.** Nothing tells the model that parallel entities sharing attributes should be one table. Only 3 of 8 templates even allow `table`. | `visualize/tasks.ts:139-155`, `visual-plan/templates.ts` |
| R7 | **ASCII diagrams stay as code.** A fenced block of box-drawing characters becomes a `code` node verbatim. | `localPlanner.ts:749` |

## 3. Target result for the reference input

- **One frame per top-level section**, titled with the section heading: "Recommended model", "Why monthly, not lifetime", "AI actions", "Business model", "Instrument from day one", and so on.
- **Inside each frame, an arrangement that fits its content:**
  - Free / Pro / Top-ups / Lifetime → **one comparison table**, one column per plan, one row per attribute (price, AI allowance, features, billing, future features).
  - "AI actions" → the source table as a table block, plus the "7 / 10 remaining" line as a short callout-style text.
  - Business-model ASCII tree → **shapes + arrows** laid out as a top-down tree.
  - User A / B / C → a row of three small cards.
  - Tracked fields → a compact list or table, not a code block.
- **Frames packed in a reading-order grid** (2–3 columns, wrapping), not one row and not one column.
- **A few meaningful arrows between frames:** "Recommended model" → "Lifetime / BYOK" (`relates_to`, "alternative"), and "Instrument" → "Pro allowance" (`supports`). Never arrows just for proximity.

## 4. Design

### 4.1 Plan schema: `group` node + group-aware relationships (fixes R4, R5)

In `visual-plan/types.ts` and `schema.ts`:

```ts
| { type: "group"; content: { label: string; arrangement: GroupArrangement } }

type GroupArrangement = "stack" | "row" | "grid" | "chain" | "tree" | "compare" | "radial";

// on nodeCommon:
parent?: string; // id of a "group" node
```

- **Groups are never nested** (Excalidraw frames can't nest). A group's own `parent` is dropped by validation.
- Membership is stored as a **flat `parent` reference**, not nested `children`. This keeps per-node lenient validation, `mergeUnitPlans` id rewriting and F38 stable-key matching exactly as they work today.
- Relationships may use a group id as either endpoint. That is how section-to-section links are expressed.
- Each `arrangement` maps onto an existing layout primitive: `stack`→`column`, `row`→`row`, `chain`→`flow`, `tree`→`layerGraph` top-down, `compare`→`row` top-aligned, `radial`→`radial`. `grid` is new (§4.3).

Validation rules (`validate.ts`, all lenient, like the rest of F29):

- A `parent` that points at a missing or non-group node is removed, and the node becomes top-level (warning).
- Nesting deeper than 2 levels is flattened to depth 2. Cycles are broken.
- An empty group is dropped, and its relationships are re-pointed at nothing, i.e. dropped.
- Groups count toward a separate limit (`MAX_GROUPS = 20`), not toward `MAX_PLAN_NODES`.
- A plan with no groups validates and renders **exactly as today**. This is the backward-compatibility guarantee for MCP and existing tests.

### 4.2 New template `sectioned` (fixes R3, R6)

Add a 9th template to `VISUAL_TEMPLATE_REGISTRY`:

- **allowedNodeTypes:** every type except `image`, plus `group`.
- **allowedRelationTypes:** all of them.
- **layout:** `grouped-grid`.

Each group carries its own arrangement, so one plan can mix a comparison, a tree and a stack. The 8 existing templates stay as they are for short, single-shape content. `select_template` gets `sectioned` in its list with the description "long or mixed content with several sections of different kinds". Its selection is also forced when the content has ≥ 3 analysis units (see §4.5).

### 4.3 Layout: recursive, then grid-pack (fixes R2)

In `renderer/layout.ts`:

1. **Lay out groups bottom-up, deepest first.** Lay out each group's children with its arrangement's primitive. The group's box is the children's bounds plus padding (`GROUP_PAD = 32`) plus a title band (`GROUP_TITLE_H = 40`). A laid-out group is then treated as one sized node by its parent.
2. **Keep the existing `explained_by` hanging logic**, applied within the group that contains the parent node.
3. **Pack the top-level items with a new `grouped-grid` strategy.**
   - Items are placed in reading order into columns.
   - The column count is picked from total area: 1 for ≤ 2 items, 2 for ≤ 6, else 3. Target max width ≈ 2,400 px.
   - Each item goes to the currently shortest column (masonry), which keeps order roughly left→right, top→bottom and heights balanced.
4. `measure.ts` doesn't measure groups. Their size comes from step 1.

The layout stays pure and deterministic, so the same plan always gives the same positions. `place.ts` and `reflow.ts` still receive one bounding box for the whole plan.

### 4.4 Change set + writer: native frames (fixes R4)

- Add a change kind to `ai/changes/changeSet.ts`: `{ kind: "create_frame"; key; title; box; children: string[] /* created keys */; stableNodeKey? }`, with a matching zod schema.
- In `components/canvas/changeSetWriter.ts`, create frames **after** the objects. Use an Excalidraw `frame` skeleton with `name: title`, then set `frameId` on every child. Blocks, pages and shapes are all ordinary Excalidraw elements (`createBlockElement`, `createPagePreviewElement`, skeleton shapes), so this works for every node type.
- Frames are already treated as rigid units by F41 reflow (`renderPlanContext.ts:40`), so later insertions move a whole section together at no extra cost.
- `connect` targeting a frame binds the arrow to the frame element.
- `ChangeSetReview.tsx` should list frames as "N sections" rather than one row per frame.

**Why frames and not `groupIds` plus a background rectangle:** frames are titled, native, selectable as a unit, and already understood by reflow. Plain groups have no visible boundary or label.

### 4.5 AI pipeline (fixes R3, R5, R6)

- **Automatic section groups.** In `reconcile/keys.ts` → `mergeUnitPlans`, when the template is `sectioned`, wrap each unit's reply in a `group` node:
  - `label` = the unit's heading;
  - `arrangement` = the arrangement the model gave for its top-level nodes, else `stack`;
  - `stableKey` = `<unit> § group#0`.
  - Any node without a `parent` gets the unit group as parent.

  So grouping is guaranteed even if the model never emits a group. The model may still emit sub-groups, e.g. the tree inside "Business model".
- **`generate_visual_plan` prompt for `sectioned`** (`visualize/tasks.ts`) adds a `STRUCTURE_RULES` block:
  - Parallel entities (plans, tiers, options, personas, providers) that share ≥ 2 attributes → **one `table`**, one column per entity and one row per attribute. Never one card per entity.
  - A markdown table in the content → a `table` node with the same rows and columns.
  - A box-drawing or ASCII diagram (`├ └ │ ┌ ─ →`) → `shape` nodes plus relationships, inside a group with arrangement `tree` (hierarchy) or `chain` (sequence).
  - A sequence of steps → arrangement `chain` with `depends_on` edges.
  - A one-line emphasis or quote → short `text`, never its own section.
  - Set the section's `arrangement` (return it as `"arrangement"` in the reply envelope).
  - Only add relationships that the content states or clearly implies.
- **New cheap task `link_sections`**, run after all units return and only for `sectioned` plans with ≥ 2 groups:
  - Input: each group's id, label and a ≤ 300-char summary (first text node).
  - Output: `{ relationships: [{from, to, type, label}] }` between group ids, capped at `groupCount + 2`.
  - Prefers the decision model, like `select_template`.
  - A failure is ignored (the plan just has no cross-section links). It never fails Visualize.
- **Template choice.** In `visualize.ts`, ≥ 3 analysis units with no forced template → `sectioned`, skipping `select_template`. Otherwise the current behavior is kept.

### 4.6 Local tier (fixes R1, R2, R7)

- **Groups without AI.** `planLocally.document()` emits a `group` per H1/H2 section: arrangement `stack`, children = that section's blocks, template `sectioned`. The no-AI and no-provider path therefore still gets framed sections in a grid.
- **Hand long mixed docs to the AI.** In `assessStructure`, report `sufficient: false` when an AI provider is configured and the doc has ≥ 3 sections and ≥ 2 of these signals:
  - sibling sections that are each mostly a list (parallel entities → table candidate);
  - an ASCII-diagram code block;
  - ≥ 40% list content.

  `visualize.ts` already falls back to the local plan when no provider is configured (`NoProviderConfiguredError(!!local.plan)`), so nothing regresses offline.
- **ASCII-tree conversion (Phase 3).** A deterministic parser for simple box-drawing trees (`├──`, `└──`, `│`, `┌──┴──┐`) → shapes + `relates_to` edges, arrangement `tree`. Anything it can't parse confidently stays a `code` node.

### 4.7 Reconciliation (F37–F39) impact

- Group nodes get structural stable keys (`<unit> § group#0`), and frames carry `acuteMeta` like other objects, so "Update from new content" can match them.
- A frame's title change → a new `update_frame { target, title, stableNodeKey }` change kind.
- A membership change (a node moved to another section) → `children` diff on `update_frame`.
- `update.ts`'s `groupAnchor` already places a new unit's nodes next to their matched neighbours. It should place the new unit's frame instead.
- **Until Phase 3, reconciliation treats frames as opaque.** Children still reconcile normally, and a frame whose children all disappear is proposed for removal. This must be stated in the review UI so users aren't surprised.

## 5. Phases

Each phase ends with `npm run typecheck && npm run lint && npm run test` green.

### Phase 1: grouping end to end (local tier)
- [x] `group` node, `parent`, group-endpoint relationships: types, schema, lenient validation — `visual-plan/{types,schema,validate}.ts`, tests in `visual-plan/groups.test.ts`
- [x] `sectioned` template + `grouped-grid` layout id. It is hidden from `select_template` and the dialog's picker (`unitTemplates()`) until Phase 2's prompt exists.
- [x] Recursive group layout, in-section matrix and masonry packing, plus the centred document title — `renderer/layout.ts`, tests in `layout.test.ts` ("sections (F42)")
- [x] Content-based sizes with no `BLOCK_SIZE` floors (`renderer/measure.ts`), plus card auto-height (`BlockStyle.autoHeight`, `RichBlockHost`, `globals.css`, cleared on a manual resize in `ExcalidrawCanvas.tsx`)
- [x] `create_frame` change kind + zod schema + writer: a frame after its members, `frameId` on members and their labels, only the set's provenance (never a content-source link)
- [x] `render.ts`: each group → `create_frame` + an XL centred title block keyed with the group's `stableKey`
- [x] Local planner emits section groups. They are keyed like the heading they replace, and a deeper heading titles its blocks.
- [x] Review UI shows sections (ghost outline, "Section: …" row, "N sections" summary)
- [x] Manual check in the app with the "Database migration plan" note: 3 frames, XL titles, one compact checklist card
- [x] Reconciliation compares plans flat (`ungroup`): a section is its title object. Section titles are hidden from the model's "current representation" (`withoutUnitSections`) so p-ids stay stable.
- [x] AI tier: `groupByUnit` frames each analysis unit (from Phase 2)
- [x] Prompt: links between steps go from the earlier step to the later one (the upward arrows in the user's screenshot)

### Phase 2 (revised 2026-09-27): outline first, then sections by kind

This revision takes the useful parts of a ChatGPT review of the exported canvas. The main one: **source headings are hints, not the final structure**. Facts about the same entities, scattered across several sections, must end up in one comparison. Each section was generated on its own, so that couldn't happen, and a per-section `link_sections` call can't fix it. What was built instead:

- [x] **Routing** (`localPlanner.ts` `aiRecommended`). A structured document of ≥ 1,500 chars with ≥ 3 headings, or one with an ASCII diagram, goes to AI instead of the local plan. With no provider, or if AI fails, it falls back to the local plan with a note, never an error (`visualize.ts` `recover`). A short note stays local, with no AI call.
- [x] **`outline_document` task** (`visualize/outline.ts`). The whole document is read in one call, each part capped to fit a 24k-char budget. The reply groups parts into semantic sections by meaning (merging parts about the same concept). For each section it gives a short label, a **kind**, a **prominence** (primary / supporting), links between sections, and a one-line summary. Sections are built from whole parts, never split, so updates stay per section.
- [x] **`validateOutline` is lenient and loses nothing.** An unknown kind becomes `notes`, and unknown or repeated parts are ignored. A part the outline forgot gets its own section, with a warning.
- [x] **Section-kind registry** (`visual-plan/sectionKinds.ts`), which is code the model picks from and never invents. The kinds are comparison, hierarchy, flow, cards, decision, metrics, supporting and notes. Each has an arrangement, the node types it uses, and prompt rules. For example, a comparison is ONE table with an entity per column, and a cell is left empty when the content is silent, never a guessed ✓. A hierarchy is shapes, never an ASCII drawing. A decision is a prominent chain plus one "Why" note.
- [x] **Per-section generation**: `generate_visual_plan` takes an optional `section` (label + kind) and uses that kind's rules instead of a template's.
- [x] **Assembly** (`visualize/outlined.ts`, `groups.ts` `wrapSections`):
  - primary sections first, each group in the outline's own order;
  - kind and prominence stored on each group (`role`, `importance`);
  - section links drawn as arrows between frames;
  - the summary shown as a centred subtitle under the document title.
- [x] **Fallbacks.** An outline failure falls back to per-unit analysis with a note. `select_template` and the dialog still don't offer `sectioned`.
- [x] **Update, per section** (`update.ts` `updateOutlined`). Nothing changed → no model call. An edited part → only its section is regenerated, with its current representation, and no outline call. Parts added or removed → the document is outlined again, and unchanged sections still match their objects by key. Section links are first-run only: `ungroup` drops them, so updates never draw arrows between title objects.
- [x] **Local tier.** A short numbered list inside a section becomes a chain of connected shapes, and a section that is only steps is a `chain`. Fixed a bug where a mostly-list document with several sections became a whole-document `flow` and dropped the other sections.
- [x] **Tests**: `visualize/outlined.test.ts` (outline validation, the outlined run, routing and fallbacks, updates), plus additions to `groups.test.ts` and `localPlanner.test.ts`.
- [x] **Manual check in the app** with the user's ChatGPT pricing answer on the real Copilot connection (claude-sonnet-5). Result: 6 sections, 29 objects, 19 connections.
  - a decision chain with "Why";
  - ONE Free / Pro / Lifetime table merged from three places in the source, using only its own values and empty cells elsewhere;
  - the ASCII business-model tree redrawn as shapes;
  - an "AI actions" table;
  - a "Who each model is for" section of 3 cards.

- [x] **Frame labels (2026-09-27, the user's request).** The label above a frame no longer repeats the XL title inside it. It says position and kind: "1 · Comparison", "2 · Structure", "3 · Decision"; local-tier sections are "1 · Section" (`sectionKinds.ts` `frameName`).
- [x] **Row packing for sections** (`layout.ts` `packRows`) replaces masonry. With masonry, two wide frames forced one tall column: the pricing demo's 6 frames were stacked vertically. Rows keep reading order: up to 3 per row (4 → 2 × 2), wrapping before 3,400 px.
- [x] **Tree layers ordered under their parents** (barycentre sort in `layerGraph`), so tree arrows no longer cross the whole frame.
- [x] **One failed section no longer sinks the outline** (`outlined.ts` `generateSection`). Its own text is shown in its frame, with a warning, and every other section is kept. In an update, a failed section stays an error so the user can retry.
- [x] **AI e2e spec `e2e/ai/sections.spec.ts`** (fixture `e2e/ai/fixtures/pricingAnswer.md`): a short note stays local with framed sections; the long answer is outlined into ≥ 3 labelled frames with a table; an update regenerates only the changed section. It passed in demo mode against Gemini, and the existing 25 AI specs still pass.

Not taken, and why:
- **ASCII diagram blocks.** Native shapes are editable and connectable.
- **Free restructuring.** Merging is allowed, but coverage is enforced and inventing content is forbidden.
- **The overview page with links to child pages.** It's a separate product feature, for later.

### Phase 3: diagrams + updates
- [x] **Deterministic ASCII-tree parser in the local tier (2026-09-27)** — `src/ai/content/asciiTree/` (`detectAsciiTree`, `parseAsciiTree`, `treePlanParts`, `convertAsciiTree`; indented `├── └── │ |-- +--` trees incl. `tree`/`npm ls` output, and top-down box trees `┌──┴──┐` / `+--+--+` with labels or boxes below; tables, arrow flows, charts and other art are rejected). Wired in: content that is one tree drawing (optionally under a heading) → `asciiTreePlan.ts` `planAsciiTree` (a `decision_tree` plan, no model call); a tree block inside a section → its labels as shapes linked parent → child in that section, which lays out as a `tree` (`localPlanner.ts`); `assessStructure` no longer sends a readable tree to AI (other ASCII art still goes; a long document still goes for regrouping). Tests: `asciiTree/*.test.ts` (55), `localPlanner.test.ts`, `e2e/local/sectionUpdates.local.spec.ts` (a tree section → 5 shapes, 4 arrows, one frame, top-down).
- [x] **Frames in "Update from new content" (2026-09-27).** Sections are still compared flat, by their title objects; which section a node is in is recovered in `reconcile/sections.ts` `sectionOfNode` (the grouped plan's `parent` links on the local tier; the `<section> § group#0` key namespace on the AI tier; an explanation is in its concept's section). In `update.ts` `placeAdds`:
  - a new object of a section already on the canvas joins that section's frame: a new `update_frame` change (`{ target, add: created keys, section }`), placed by the usual rules, or below the frame's lowest member when nothing else anchors it;
  - a new section is placed as one group, re-grouped (`sectionPlan`) so the renderer frames it with its XL title like a first run; its frame is numbered after the sections already there.
  - Writer (`changeSetWriter.ts`): `update_frame` makes the new objects (and their labels) members of the frame, placed before it in element order (`inFrameOrder`); every frame that got a member or had a member moved to make room (F41) grows — never shrinks — to fit its members with the renderer's 40 px padding (`growFrame`). This also fixes members pushed out of their frame by reflow.
  - Review: "Put the new object in the section “Risks”"; `update_frame` isn't counted as a created object.
  - Tests: `reconcile/update.test.ts` (a new paragraph → `update_frame` to its frame; a new section → one `create_frame` holding its title and body, numbered after the existing ones), `e2e/local/sectionUpdates.local.spec.ts` (in the app: the mitigation is a member of the Risks frame, inside its grown box; Timeline arrives in "4 · Section" with its title; no frames overlap).

### Phase 2 fixes (2026-09-27): a failed section no longer degrades the canvas
Found from a real run on `pending-work-master-plan.md`: the canvas showed one "Notes" page with the raw document and a heading made of a table's column names.
- [x] **A failed section falls back to its own structure.** When `generate_visual_plan` fails for a section, `outlined.ts` `sectionFallbackReply` runs the local tier on that section's text: tables, checklists, code and text, with its section headings as subheadings (groups flattened with `ungroup`, spans dropped). Only content the local tier can't plan becomes one note, and a long note is a page titled with the section's label, not "Notes".
- [x] **Merged sections have a size cap.** `validateOutline` splits a merged section over `MAX_SECTION_CHARS` (= `MAX_UNIT_CHARS`, 12,000) back into one section per unit. Each keeps the model's kind and prominence, is labelled with its own heading, and a link to the merged section attaches to its first part.
- [x] **Failures are shown.** `VisualizeResult.notices`: plain-language lines for a failed outline, failed sections and an AI failure that fell back to the local plan. `VisualizeDialog` shows them in a closable toast after proposing. The technical `warnings` are unchanged.
- [ ] **Still open:** the outline's section labels aren't checked (a label copied from a table row passes). The user's second bad result ("Added 2 objects", no frames) was not reproduced: every in-app Visualize path gives about 50 objects in frames for that document, and the entry point the user used is still to be confirmed.
- Tests: `outlined.test.ts` (a failed section shows its tree as shapes, with a notice; a failed section keeps its table and checklist; an oversized merged section is split, with its links following).

### Phase 4 (added 2026-09-27, user): dense content
**Problem.** A block can hold far more text than it shows well. The reference case is the Wave 1b table in `pending-work-master-plan.md`: its Item cells are 1–3k characters of prose, the renderer caps every column at 220 px (`measure.ts` `TABLE_MAX_COLUMN`), and the block is about 13,000 px tall. The same happens to checklists whose items are paragraphs, and to walls of text.

**Approach (agreed with the user).** After blocks land on the canvas, point out the dense ones and walk the user through them one by one. For each, the user can trigger a second, opt-in call that splits the content into a more visual form. A text-count limit is enough to flag for now.

- [x] **4.1 Detect and point out (2026-09-27).**
  - `src/ai/density/density.ts` `assessDensity(blockType, content)`: pure, over rich content, so it applies to any block whatever made it. Dense when a table cell is over `DENSE_CELL_CHARS` (300), a table over `DENSE_TABLE_CHARS` (2,000) in all, a checklist item over 300, or a text block's prose over `DENSE_TEXT_CHARS` (1,200). Pages and code are never dense. The finding carries a user-facing reason ("A table cell holds 1,840 characters").
  - After Accept (`ChangeSetReview` accept, and `acceptPendingParts` for sections and auto-accept): `flagDenseBlocks` checks the rich blocks the set created and records them in reading order (`denseBlocksStore`, in memory per canvas, like the AI markers).
  - The "Added …" notice says "N blocks have too much content to read well" with **Review ›**. `DenseBlocks.tsx` puts an amber **Dense** badge on the bottom-left corner of each, and a bar walks through them: "Dense block 2 of 8 · reason", with ‹ / Next › / Dismiss / Done. Each block is selected and zoomed to (fit to 80% of the viewport). Clicking a badge starts the walk at that block. A new proposal ends the walk (the badges stay). Undone blocks lose their badge and are skipped.
  - Checked in the app (AI requests blocked in the test browser, so the local tier ran): `pending-work-master-plan.md` → 5 sections, 44 blocks, 8 flagged (3 tables, 3 checklists, 2 text blocks).
  - Tests: `density.test.ts` (7), `denseBlocks.test.ts` (4: reading order, only the set's own rich blocks, the walk and dismiss).
- [x] **4.2 "Visualize better" for one block (2026-09-28).**
  - The walk-through bar has **Visualize better** (with AI on). It sends only that block's Markdown to the model: one `generate_visual_plan` call as a "cards" section named like the block (its title, else its first heading, else "Details", never a table's header row), with the new `dense: { reason }` input. That input adds the splitting rules (`tasks.ts` `denseRules`): a table's rows as cards (short name as title, the row's short values in bold labels, the gist in 1–3 sentences, the rest of a long cell on a linked page), ordered items linked `flows_to`, a paragraph checklist as a short todo with linked detail, prose as key-point cards; every fact kept and nothing added, cards under about 400 characters.
  - `src/ai/density/visualizeBetter.ts`: the reply becomes one frame of pieces (numbered after the canvas's frames, e.g. "6 · Overview"; a heading repeating the block's title is dropped), placed to the right of the block, plus a `remove` of the block. `src/ai/reconcile/split.ts` `splitLinkOf` reads the block's link into the `split` record and a key prefix (`<block key> ⊃ `), so the pieces are 4.3's split pieces. A piece split again stays a piece of the original node. A block with no link is split into plain new objects. A reply with fewer than two pieces changes nothing ("The AI couldn't split this block into smaller parts").
  - While it runs, the bar says "Splitting this block…" with Cancel. Failures use Visualize's own messages (with AI Settings where it helps) and offer Try again. The result is an ordinary proposal in the review bar, and one undo step once accepted.
  - Checked in the app, with the test browser answering only the dense prompt with a canned plan (no model was called): the Wave 1b table → "+5 new · −1 removed · 3 links changed"; accepted as 3 cards in a chain, a linked page, and one titled frame; the table's badge gone; the pieces carry the source link ("Update from new content" is offered on a card); and "Update from new content" with the same text says "Nothing changed", so the table isn't brought back.
  - Tests: `visualizeBetter.test.ts` (4: only the block is sent, with the dense rules; the proposal's frame, removal, links, keys, placement and number; no link → plain objects; nothing to split → nothing changed).
  - **Still open:** try the prompt on a real model (needs the user's go-ahead for AI spend) and tune `denseRules` from what comes back. The new frame sits beside the section frame the block was in, not inside it (Excalidraw frames don't nest).
- Original 4.2 scope, for reference. In the walk-through bar: one `generate_visual_plan`-style call with only that block's content and instructions to split it (rows → cards, steps → flow, key facts pulled out). The result is a normal proposal: remove the block and add a frame with the new pieces, reviewed in the review bar, one undo step. Opt-in per block (AI spend). **How it plugs into 4.3:** the proposal is a change set with `split: { sourceId, version, of, fingerprint }` taken from the block's reconciliation link (`of` = its `stableNodeKey`, `fingerprint` = its `contentFingerprint`), no `contentSource`, a `remove` of the block, and create changes whose `stableNodeKey`s are `<of> ⊃ piece#<n>`. The writer then stamps each piece as described in 4.3. A block with no reconciliation link (an MCP block) is split as plain new objects. Also needs a writer check in the app (the split stamping has no unit test: it needs Excalidraw).
- [x] **4.3 Reconciliation keeps the split (2026-09-27).**
  - Pieces carry `splitOf` (the split node's key) and `splitFingerprint` (its fingerprint when split) in their AI metadata, next to the usual link to the block's content source and version. `normalizeAIMetadata` keeps them only for reconciliation, `reconciliationOf` returns them as `splitOf`, and `existingObjects` passes them on. `provenanceGuard.test.ts` covers both fields.
  - Change sets have an optional `split` record (never with `contentSource` or `parts`). The writer stamps it on every created object instead of a content-source link, so accepting a split records no new content version.
  - `reconcile`: a node with pieces on the canvas and no object of its own goes to `ReconciliationPlan.splits`, not `items`: it is never added back, and its pieces are neither updated nor removed. Its `changed` flag is set when the source says something new about it in this update (compared with the previous version and with the split fingerprint). A split node the source dropped → its pieces are removed like any object whose node is gone (an opted-out piece stays). Pieces also stay beside a copy of the original block.
  - `updateFromNewContent` returns `notices`: "The source changed a block you split, and the split was kept. To show the new content instead, delete the pieces and update again." The dialog shows them in a toast, also when nothing else changed.
  - Tests: `classify.test.ts` (+5), `update.test.ts` (+3: unchanged keeps the split with no change set; a changed split is kept and reported while the rest is still proposed; a dropped split block's pieces are removed), `provenance.test.ts` (+1), `changeSet.test.ts` (+2).
  - **By design, not done:** replacing a split with the source's new content is not offered in review. The user deletes the pieces and updates again, and the block comes back (and is flagged dense again).
- [x] **4.4 "Split locally" (2026-09-28).**
  - `src/ai/density/splitLocally.ts`: a deterministic split of a dense block's rich content, offered in the walk-through for tables and checklists (not for prose, which needs a model):
    - a table: one card per row. The title is the lead of the row's first wordy cell (a cell over `SHORT_CELL_CHARS`, 60): its leading bold text, else its first sentence. A title over 48 characters is shortened at its first clause boundary (" (", ", ", " — ", ": ", "; "), and the body then keeps the whole text so nothing is lost. Titles are plain text (no emphasis or Markdown escapes). The short cells are a bold-labelled meta line ("**Order:** 1 · **Size:** M"; blanks and "—" left out). A leading status on the wordy cell ("✅ **Done 2026-09-27 (tracker F31).**", "Not started.") moves to the meta line as "**Status:** …", and the title comes from what follows it. Other wordy cells are labelled lines in the body. A card over `CARD_MAX_CHARS` (500) keeps its gist (whole sentences up to 300 characters, then "…"), and its full text goes on a page titled like the card, linked `explained_by`;
    - a checklist: short items stay a checklist (consecutive ones together), and each item over 300 characters becomes a card (status on its meta line, same title and page rules);
    - the block's other content (an intro, notes) stays as text in order; a heading repeating the block's title is dropped.
  - `visualizeBetter.ts` `proposeSplit` is now shared: it validates, frames, places and proposes pieces from either path, with the block's removal and the `split` record, so 4.3 applies to local splits too. Provenance: "Created by AI · Split locally" (`task: "split_locally"`).
  - Walk-through: **Split locally** shows for dense tables and checklists, with or without AI. It shares Visualize better's running and error states ("This block has nothing to split without AI" when it can't).
  - Checked in the app with no model call: L4's 17-row table → "+20 new · −1 removed · 2 links"; accepted as titled cards such as "Styled template picker" with "**From:** F31 · **Status:** ✅ Done 2026-09-27 (tracker F31)"; Undo brings the table and its badge back.
  - Tests: `splitLocally.test.ts` (13: lead, status and title rules; cards, meta lines, blanks, gist and linked page; other content kept; checklists; prose → nothing; the proposal via `proposeSplit`).
  - **Known limits:** a status in the middle of a lead ("Class and ER diagrams ✅ done 2026-09-27") stays in the title; a shortened title's words repeat at the start of its body; a checklist with long items interleaves small checklists and cards, in the source's order.
- [ ] **4.5 Wider columns for moderately dense tables (S).** Tables that aren't split get width allocated to the wordy column instead of the flat 220 px estimate. This needs `columnWidths` set in `mapNode` (it is never set today, so BlockNote sizes columns itself) and `measure.ts` to match. It changes every Visualize table, so it needs its own layout check.
- Original 4.4 scope, for reference. A no-AI button next to "Visualize better": the deterministic transform of a dense table into one card per row. The card title is the long cell's lead (bold text or first sentence), the short columns become a meta line (`#1 · M`, a leading status like "✅ Done 2026-09-27"), the body is the first sentences, and the full text goes on a page. Moderately dense tables also get width allocated to the wordy column instead of the flat 220 px cap.
- **Not now:** flagging pasted text items (the Visualize hint already covers large pastes), and tuning the limits. They are constants, to be tuned after real use.

### Known limits of what is built
- A frame's size comes from estimated block sizes. When a card fits to a shorter real height, the frame keeps some empty space at the bottom. Frames don't refit yet.
- A new section's frame is placed by free-space search near the source, so it can land beside the document title rather than in the row of sections. A frame whose section was removed is removed with its members; a renamed section keeps its frame (its title object is updated).
- Arrows between frames can cross other frames on a busy canvas. There is no routing around frames yet.
- An outline can't split one source section across two semantic sections (by design, so updates work per section).
- The local tier (no AI) still can't merge scattered facts into one table. Only the AI path does.
- Dense blocks are only pointed out (Phase 4.1). Splitting them is 4.2 and 4.4. The walk-through bar can cover the bottom of a tall block it zoomed to.
- Seen in the Phase 4.1 check: a table that starts a unit split at `MAX_UNIT_CHARS` (the P1 section's second part) can end up as raw `| … |` text inside a text block, and a card can overlap the next block in its section (the frame refit limit above). Not yet investigated.

## 6. Test fixture

Add the reference ChatGPT answer as `PRICING_MODEL_ANSWER` in `ai/visual-plan/fixtures.ts`, together with a hand-written "golden" `sectioned` plan for it. That plan is the MockProvider reply in contract tests and the layout snapshot input.

## 7. Open decisions

1. **Frames vs. soft groups.** Recommended: native frames (§4.4). A frame clips children that are dragged outside it. If that feels wrong in use, switch to a titled background rectangle + `groupIds`. The layout and schema don't change either way.
2. **Offline behavior.** Recommended: local tier still produces frames and a grid, but no tables-from-lists and no cross-section links. Those need the AI.
3. **Grid width.** Recommended: target ~2,400 px, max 3 columns. Adjust after seeing real output.
