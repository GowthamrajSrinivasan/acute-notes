# Content Fidelity Plan — Visualize without losing information

Status: **Final, Revision 2** (2026-09-29). Steps 0, 1, 2 and 4a are done. Revision 2 (below) re-orders the rest: fidelity alone gave us transcription, not analysis. Waves A–D done and checked live (2026-09-29/30); **Wave E done, local only (no live run)** (2026-10-01: phase 1 sequence diagrams, phase 2 pie/gantt import, causal map, charts, annotated text); **Wave F2 and F3 done** (2026-10-01, with Wave E phase 2); remaining: F1 (multi-run measurement) and the 5-person study. Scope: first-time generation (`visualizeContent`, "Visualize better"). Update/reconcile (F38) is out of scope until generation is fixed.

**Revision 3 (2026-10-19, draft):** [Knowledge Notes Plan](./knowledge-notes-plan.md) replaces "Visualize, do not
summarize", the "own words" rules and the 70% word-coverage measure with distilled cards that cite stable source units,
plus a source panel. The rest of this plan stands.

Architecture diagrams: [current](./content-fidelity-current.html) · [proposed](./content-fidelity-proposed.html) (Archify sources in [diagrams/](./diagrams/); edit the JSON and re-run `archify deliver` to iterate).

---

## Progress (2026-09-29)

| Step | Status | Where |
|---|---|---|
| Remove `select_template` (every document without a forced template is outlined, even one section; a failed outline gives one "notes" section per part) | **Done** | `visualize.ts`, `outlined.ts`, `tasks.ts` |
| **0 — Structure recovery** (new): bold-line titles → headings, tab-separated lines → tables, title lines in heading-less documents → headings | **Done** | `src/ai/content/structure.ts` |
| 1 — Prompt rewrite (`FIDELITY_RULE`, detail channel per section kind, dense rules, no 60-node cap in prompt) | **Done** | `tasks.ts`, `sectionKinds.ts` |
| 2 — Validator converts, splits, renames, salvages, folds overflow; `losses` list | **Done** | `validate.ts`, `repair.ts`, `fidelity/information.ts` |
| 4a — Safety net (deterministic, per section): uncovered sentences / list items / table rows / code attached verbatim; `VisualizeResult.coverage` | **Done** | `src/ai/fidelity/safetyNet.ts`, `outlined.ts` |
| Fix: replies with prose before/after the JSON ("I will visualize … ```json") were rejected as invalid — the cause of "The AI's plan wasn't valid" | **Done** | `runtime.ts` `parseJsonReply` |
| Fidelity score (units / key terms / words, skipped list) + live e2e demo with screenshots | **Done** | `e2e/fidelityScore.ts`, `e2e/ai/fidelity.spec.ts` |
| 3 — Information ledger in the same call (reduces duplication: the model places facts itself instead of the net attaching them) | Moved to R2 Wave B | — |
| 4b — Coverage line + "what was added / skipped" in the review UI | **Review-bar version done** (coverage %, AI-placed %, key terms kept/missed, per-section details, targeted "Regenerate", switches in `src/config/fidelity.ts`). Still moves to R2 Wave A (fallback notice) and Wave C (coverage line on the canvas) | `CoverageRow.tsx`, `fidelity/report.ts`, `fidelity/regenerate.ts` |
| **Revision 2 — Analysis over preserved content** (A: honest fallback · B: analysis layer + ledger · C: signaling & review on canvas · D: scale & indicators · E: representation gaps · F: measure understanding) | **Wave A done** · Wave B next | see "Revision 2" |

Live results (Gemini `gemini-3.1-flash-lite`, 2026-09-29): cheat sheet 51 → **97**/100, hand-off note 68 → **95**/100
(model's plan alone: 72 and 60 — the safety net supplies the rest). Reports: `.ai/docs/fidelity-runs/`.

Step 0 came from the sample documents (`src/ai/fidelity/__fixtures__/`): both arrived at the model as one or two
unstructured blobs (no `#` headings, tab tables), so the outline could not separate sections and the model condensed
10k-character inputs. After recovery the cheat sheet is 8 sections with 7 tables and the hand-off note 5 sections.

Decisions taken: level-2 wording keeps source wording; sectioned plans hold 60 nodes per section and 300 overall,
with overflow folded into "More from this section" pages; the coverage line never blocks Accept.

---

## Revision 2 (2026-09-29): Analysis over preserved content

### Why the plan changes

Steps 0–4a stopped the loss of content, but users now see the source **cut into cards with no analysis**. A pasted
decision table ("Decision | My proposal", D1–D6) came back as a table card, a "Notes" page and its header line drawn
as a title: the content was split, not understood. There are three causes:

1. **Silent no-AI fallback.** When a section's `generate_visual_plan` fails, `sectionFallbackReply`
   ([outlined.ts](../../src/ai/visualize/outlined.ts)) plans it with the local tier (`planLocally`): tables become
   table cards, text over 2,000 characters becomes a "Notes" page. The reason goes to `warnings`, which the UI never
   shows. To the user this looks like "the AI did a bad job", when the AI did nothing.
2. **The safety net outweighs the model.** The model's own plans covered only 72% and 60% of the two samples. The net
   fills the gap with one verbatim "Also in the source" card, which in the hand-off run is the largest object on the
   canvas: bigger than anything the model analysed.
3. **The prompt and the score reward copying.** `FIDELITY_RULE` asks for detail "in the content's own words", and the
   fidelity score counts preserved words. Nothing asks for, or measures, analysis. The model transcribes.

A UX review against the multimedia-learning research (same day, from code, product docs and ICP notes, not new
renders) found the same pattern at a larger scale. The *principles* match the research (no decoration,
chunking, labels inside diagrams), but the *execution* falls short in **signaling**, **large results**, **review
split-attention** and **on-canvas indicators**. Revision 2 folds both findings into one ordered plan.

### Revised principle

> **Analyse on top. Preserve underneath. Signal what matters.**

Every section has two layers, and **both** are required:

| Layer | Written by | Contains | Where |
|---|---|---|---|
| **Analysis** (level 1) | The model, in its own words | Takeaway, structure, relationships, what's decided / open / recommended, trade-offs | Main shapes and cards: what you see at a glance |
| **Source** (levels 2–3) | The source, lightly edited | Every fact, number, condition, example | Linked detail cards and pages, one step away |

Fidelity is still checked (invariants 1–4 in §1 still hold), but a plan that only restates the source is now a
**failed** plan, not a passing one.

### Review findings: still current vs. already changed

The review read the code before or while Steps 0–4a landed. Status now:

| Finding | Status |
|---|---|
| Plans capped at 60 nodes; extra items cut, oversized nodes dropped | **Fixed** by Step 2: overflow folds into pages, oversized nodes split, 300 per sectioned plan |
| Template picked from a 3,000-char excerpt with one-line descriptions | **Changed**: `select_template` removed; every document is outlined |
| Local tier copies prose word for word, and the source stays beside it, so text is duplicated | **Current, and now worse**: the safety net adds a second verbatim copy (cause 2 above) |
| All 10 relation types draw identical arrows; the type shows only in Properties | Current |
| Flow steps not numbered; one orange accent on every title; importance changes size only 0.85×–1.2× | Current |
| Takeaway line (≤ 15 words) only on outlined documents | Partly fixed: every document is outlined now, but the takeaway isn't guaranteed per section |
| Review reasons live in the bottom bar, away from the changes (split attention) | Current |
| No "keep as text" outcome; fewer than 3 nodes only warns | Current |
| No overview zoom level, no block collapse; long flows never wrap; 44/79 arrows cross frames in the ICP run | Current (Wave 1b #6 planned) |
| Indicators uncapped: green dot per object, "Dense" pill per block, amber for both stale and dense, two bottom bars can overlap | Current |
| No sequence diagrams (Mermaid sequence/gantt/pie rejected), no charts, causal maps only 3 fixed columns, no annotated text | Current |
| Nothing measures understanding | Current |

### Waves (ordered by user impact for the effort)

#### Wave A: Be honest about what ran *(S, first)*

**Progress (2026-09-29): done**, all items including A1–A3. Checked live the same day (see "Live check" below).

- **Root cause of the screenshot** (a pasted reply with a decision table, split into cards): not a failed AI call.
  The local tier judged the reply "sufficient" (tables count as explicit structure, and it was under 1,500
  characters / 3 headings), so Visualize **never called AI** and said nothing. Fixed in `assessStructure`: content
  with ≥ 200 characters of prose, tables or plain lists (`ANALYSABLE_MIN_CHARS`) is `aiRecommended`; checklists,
  code, images, Mermaid, ASCII trees and short notes stay local.
- **Structure-only notice, persistent:** `ChangeSet.analysis` (`fidelity/analysis.ts`) says `mode` (ai /
  structure), `reason` (structured · local_only · no_provider · ai_failed), the `cause`, a failed outline, and each
  fallen-back section with its key and cause. `AnalysisRow.tsx` shows it in the review bar for as long as the
  proposal is open, with "Why", **Analyse with AI** / **Retry with AI** (`retryWithAI`, reruns with `forceAI`) and
  **Retry N sections** (the existing `regenerateSections`). A reused section keeps its failure across a Regenerate
  of other sections. The toast stays as well.
- **Causes logged** (`console.warn`) and carried as `kind: message` (`failureCause`). No live data yet on which
  cause dominates; that needs a real run.
- **Table header fixes** (`structure.ts`): a header that starts with a tab (empty corner cell) was read as an
  indented code block, and a header one cell short of its rows merged each proposal into the Decision column. Both
  are now recovered as one table with an empty first column. Not handled: header cells copied onto separate lines
  (rare; that content now goes to AI anyway).
- **Moved to Wave C:** the marker on the frame itself (it belongs with review-on-canvas).
- Tests: `outlined.test.ts` (+3: retry one section, failure kept across regenerate, decision-table reply goes to
  AI; plus `analysis` assertions on the existing fallback cases), `structure.test.ts` (+3), `localPlanner.test.ts`
  (+2).
- **A1 done:** `e2e/local/visualizeSmoke.local.spec.ts` (the Visualize dialog with a fake OpenAI key; the browser's
  `/api/ai/run` calls answered with a canned outline and plan). Test 1: the decision-table reply makes exactly
  `outline_document` + `generate_visual_plan` and shows no "Structure only" row. Test 2: a broken section reply
  shows the row with the section name and cause (`invalid_output`), and "Retry 1 section" clears it with one call.
- **A2 done:**
  - `visualizeOutlined` keeps a regenerated section's earlier reply when the new one fails or places less
    (`compareCoverage`: AI-placed share, then key terms), and says so ("Kept the earlier version of …").
  - Each section is regenerated at most once (`regeneratedSections`; the coverage row stops offering it).
  - Given the canvas (`request.scene`), a regenerated section that makes the layout score worse is put back. The
    check re-renders from the replies at hand with no AI call, trying one section at a time.
  - `whenAIPlacedBelow` 0.6.
  - Fallback "Retry" (AnalysisRow) is not limited, since a fallback has nothing to lose.
- **A3 done:** the coverage row leads with **AI placed N%**, then "Nothing lost ✓" or "N points not on the canvas";
  the always-100% "Coverage" figure is gone.
- Gate: typecheck and lint clean; 1,205 unit tests pass (`regenerate.test.ts` +5). Local e2e: the full suite ran
  95 passed / 2 failed / 5 not run before A1–A3; both failures (`askAI` AI-mode toggle, `canvasExport` Escape)
  passed on a rerun (2/2), so they're load flakes. After A1–A3, the Visualize, review, content-source and
  section-update specs: 25/25.

- A section that fell back to the local tier gets a visible notice: *"AI couldn't analyse 'Decision': shown as
  structure only · Retry"*, in the review **and** as a marker on the frame. Uses the existing `failed` list and the
  per-section Regenerate path (`OutlinedReuse`).
- Promote fallback and safety-net `warnings` that change what the user sees into `notices`.
- Log the failure cause (parse, validation, timeout, provider) so we can tell *why* sections fail. If it's mostly
  one cause, fix that cause as part of this wave.
- A table's header line ("Decision · My proposal") is never promoted to a title by structure recovery. Add a test
  from the sample in the screenshot.
- **A1 — Browser smoke test with a mock AI** *(from the task-registration regression, 2026-09-29)*: an e2e in
  `e2e/local` (no AI cost, runs with every `npm run test:e2e`) that runs Visualize through the real app against a
  mock provider behind `/api/ai/run`, and fails unless the outline and section calls actually happen and no
  fallback notice appears. Unit tests register the tasks themselves, so they could not catch the browser build
  dropping `tasks.ts` (all AI calls failed silently while 1,187 tests passed).
- **A2 — Regenerate never makes it worse** *(from the live run: cheat sheet 31% → 26%, crossings 4 → 10)*:
  - per section, keep the better of the old and new reply, judged by AI-placed share, then key terms kept;
  - at most one regeneration per section; after it, the section is no longer offered;
  - a regenerated result that adds arrow crossings or cross-frame links keeps the old section;
  - default `whenAIPlacedBelow` 0.6 (offer only on a clear shortfall), not 1.
- **A3 — Honest coverage row**: lead with **AI placed N%**; replace "Coverage 100%" (which the safety net always
  reaches) with "Nothing lost ✓", or "N points not on the canvas" when that is not the case.
- Files: `outlined.ts`, `visualize.ts`, `ChangeSetReview.tsx`, `content/structure.ts`, `CoverageRow.tsx`,
  `fidelity/regenerate.ts`, `config/fidelity.ts`, `e2e/local/visualizeSmoke.spec.ts` (new).

**Live check (2026-09-29, Gemini `gemini-3.1-flash-lite`, headed; reports in `.ai/docs/fidelity-runs/2026-09-29/`).**
New case: `decision-table-reply` (the pasted reply from the user's screenshot, in `src/ai/fidelity/__fixtures__/`).

| Case | Time · calls | AI placed (first → after Regenerate) | Before Wave A |
|---|---|---|---|
| Cheat sheet | 14 s · 6 | 41% → 41% (key terms 118 → 149/197) | 31% → **26%** (made worse) |
| Hand-off note | 9 s · 5 | 34% → 48% (key terms 41 → 49/53) | 55% → 66% |
| Decision-table reply | 12 s · 2 | 69% → 69% (earlier version kept) | **no AI call at all** |

What Wave A fixed, confirmed live:
- The decision-table reply now reaches AI (outline + one section call) and shows no "Structure only" row.
- Regenerate never made a section worse. In the cheat sheet the layout guard fired ("Kept the earlier version of
  'Response Actions', 'Configuration & Controls': … more crossing arrows"). In the decision-table reply the weaker
  reply was rejected by coverage. No section was offered twice.
- Cost is modest: one outline call plus one call per section, 9–14 s; the layout guard adds only local re-renders.

What is still wrong (the input to Wave B/C):
1. **No analysis.** The decision reply becomes D1…D6 shapes, each with its proposal as a detail card, plus a
   checklist, but no takeaway, no "what needs the engineer's agreement / what's deferred", and the "problem" column
   is reduced to labels.
2. **Wrong section kind.** The outline classified six independent decisions as a **flow**, so D1 → D2 → … → D6
   are chained with arrows that imply an order that doesn't exist. → Wave B: `decision` / `cards` guidance in the
   outline prompt ("independent items are not a sequence"), and a check that a flow's steps actually follow.
3. **The safety net duplicates reworded tables.** In the cheat sheet the AI rewrote table cells, so the rows failed
   the 70%-words test and the net attached the same rows again as "Also in the source (more rows)": two copies of
   one table side by side. → Wave B: match table rows by their first cell (row key) and compare per cell, before
   attaching; put what is really missing in the collapsed "Source details" page.
4. **Layout noise.** 4 links through cards / 6 crossings (decision reply), 11 / 9 (cheat sheet); detail cards far
   from their shapes. → Wave C/D.
5. Variance between runs is large (hand-off: 55% before, 34% now, same prompts): judge Wave B on several runs
   (Wave F1), not one.

Also fixed during the check: `e2e/ai/visualize.spec.ts` still expected the removed `select_template` call (a stale
test from the earlier fidelity work; the app was right). Updated; the spec passes 5/5.

#### Wave B: Analysis layer + ledger *(M, the core fix)*

**Split (2026-09-29):** **B1** (analysis on top, **done**) · **B2** (ledger + level tags, next). The ledger changes the
reply format for every section, so it gets its own step and live check.

**B1 progress (2026-09-29): built, unit- and browser-tested with a mock AI; not yet run on a real model.**
- **Takeaway per section:** the section reply's `metadata.takeaway` (≤ 15 words asked, cut at 200 characters)
  becomes `group.content.takeaway` and renders as a centred line under the section's title, inside its frame
  (`groupTakeawayKey`; `takeawayHeight` in `measure.ts`). No stable key: it is redone with the section.
- **Analysis per kind:** each section kind has an `analysis` task (`sectionKinds.ts`); `analysisRule` in `tasks.ts`
  asks for it in `"text"` nodes marked `"origin":"analysis"`, on top of the unchanged details rule. Forced
  templates, updates and "Visualize better" are not asked.
- **Inferences marked (D-R2.1):** `origin: "analysis"` in the schema (anything else is dropped, never rejected);
  such a card's title reads **"Analysis · …"**.
- **Decisions aren't a chain:** the `decision` kind now covers "a set of decisions or proposals (D1, D2 …)", lays out
  as a grid, one shape per decision with its proposal linked `explained_by`, and links two only when one depends
  on or blocks another. The outline prompt adds: *a "flow" is only for steps where each leads to the next*.
- **Analysis check** (`fidelity/analysisCheck.ts`): no takeaway, or no analysis node (supporting sections need only
  the takeaway) → one retry told what it lacked (`analysisRetry`); the retry is kept when it lacks less. Still
  lacking → `analysis.shallow`, shown in the review row as **"Not analysed"**. An analysed plan costs no extra
  call.
- **Safety net relocated:** more than ~300 characters of missing prose, or any missing table rows or code, goes in
  one **"Source details"** page (Markdown: bullets, tables, fenced code), never a second table beside the AI's.
  A line or two stays a small "Also in the source" card. Row matching was **not** loosened: a row the AI shortened
  (a dropped column, a cut condition) is still missing, and still restored (in the page).
- **"Keep as text" (D-R2.3):** an AI result of fewer than 3 content nodes, all text/page, with no relationship
  raises `ReadsFineAsTextError`; the dialog says so and offers **Visualize anyway** (the proposal is kept, no
  new call). A table or a shape always draws.
- Tests: `visualize/analysis.test.ts` (13 new); mocks elsewhere now reply with a takeaway and an analysis node, as
  a good reply does. Gate: typecheck and lint clean, 1,219 unit tests pass; local e2e (Visualize, smoke, review,
  content source, section updates, renderer) 30/30. The smoke test also checks the takeaway and the
  "Analysis · Status" tag on the canvas after Accept.
- **Cost to watch in the live check:** a section whose first reply lacks a takeaway or analysis costs a second call.

**B1 live check (2026-09-29, Gemini `gemini-3.1-flash-lite`, headed; 11/11 specs pass).**

| Case | Time · calls | AI placed first → after Regenerate | Visible-on-cards score (Wave A → B1) | Layout issues (Wave A → B1) |
|---|---|---|---|---|
| Cheat sheet | 16 s · 5 | 18% → 55% | 95 → **78** | 11 through cards / 9 crossings → 5 / 1 |
| Hand-off note | 11 s · 5 | 59% → 72% | 95 → 84 | 1 / 2 → 6 / 1 |
| Decision-table reply | 10 s · 2 | 46% (earlier kept: layout) | 93 → **67** | 4 / 6 → 0 / 0 |

Everything on the canvas or in a page ("all" score): 94–99, so nothing was lost.

What works:
- Every section of all three documents has a takeaway under its title and an "Analysis · …" card. The analysis
  check passed first time everywhere, so there were **no extra calls** (8 sections, 8 generation calls); cost and
  time match Wave A.
- The decision reply is no longer a fake flow: one section, a decision table, a "Requests for Engineer" checklist,
  a status analysis, 1 link (was 11). No duplicate tables anywhere; missing text sits in small "Source details" pages.

What doesn't yet:
1. **The analysis is generic.** The decision reply's status reads "Plan updated; awaiting files from engineer to
   proceed with verification". It doesn't say that D2 needs the engineer's agreement or that D5 is deferred, though
   the prompt asks for per-decision status. The check tests that analysis exists, not what it covers.
2. **Asked to analyse too, the model drops more detail on its first pass.** Cheat sheet first pass 41% → 18%; the
   decision table lost its "what is being decided" column (only D1–D6 and the proposals). The safety net restores
   it in "Source details", so nothing is lost, but it is off the visible canvas (visible score 93 → 67).
3. Regenerate is still needed for decent coverage (18% → 55%).

**B1 completed (2026-09-29): architecture update, a hidden loss fixed, three more live runs.**

*Architecture update — reference, don't regenerate.* The common practice for grounded LLM pipelines (extraction
with source pointers, citations, "copy by reference"): the model points at source content instead of retyping it,
and deterministic code inserts and checks it. Applied here (`fidelity/sourceBlocks.ts`):
- Each section's source is numbered block by block for the prompt — `[T1]` tables (always shown as pipe tables,
  whatever their source form), `[L1]` lists, `[C1]` code, `[P1]` paragraphs (`numberSource`).
- The model places a block with `{"type":"source","ref":"T1"}`; `expandSourceRefs` inserts it verbatim (keeping the
  node's id, title, importance and links) before anything else reads the reply. Unknown refs are dropped with a
  warning, and the safety net restores what they meant.
- **Table repair**, deterministic: a retyped table whose rows are a source table's row keys and whose columns are
  among its columns, but fewer or shorter, gets the full source table back in place.
- **Never restate a placed block** (prompt): no shape or card repeating its rows. A decision table *is* the decisions'
  structure; shapes per decision only when they are prose.
- The model's output goes to structure and analysis; tables are no longer retyped (fewer output tokens).

*Checks.*
- **Item coverage:** in decision and status sections, the analysis must mention ≥ 60% of the items the source
  names (row keys and list ids such as D1…D6, A1, HK-3, #25; `itemIds`). Otherwise the retry names the ones it
  skipped ("an analysis line for D2, D3").
- **Structure:** a one-section document longer than a note (> 300 characters) that comes back as text only is
  asked once for its visual structure.
- **"Keep as text" corrected:** the live run showed a false positive. A 4-sentence checkout incident (components,
  calls, a failure chain) was declared "reads fine as text" because the model wrote it out as text. The rule now
  also requires the *source* to be a note (≤ 300 characters, ≤ 2 sentences).

*A hidden loss, found and fixed (older than this work).* The validator **dropped whole nodes** whose `stableKey`
exceeded 300 characters. When the outline merges several parts with long headings, the section key (every node's
key prefix) passes 300, so the entire section vanished — "Source details" page included — while the coverage row
said "Nothing lost" (it is computed before validation). The live cheat sheet run lost 24 of 101 units this way.
- Fix: `compactStableKey` (`schema.ts`) compacts an over-long key (its start, an FNV-1a fingerprint, its node-local
  end), deterministic and unique, instead of rejecting the node.
- A node the validator does drop is now also a **loss** (not only a warning), and Visualize says so in a notice.
- Regression test: the cheat sheet merged into two big sections keeps 101/101 units, measured on the change set
  after validation (fails without the fix).

*Live results (Gemini `gemini-3.1-flash-lite`, headed, final run; 11/11 specs pass).*

| Case | Calls (sections) | AI placed on its first pass: Wave A → B1 first cut → **B1 done** | Visible score: Wave A → first cut → **done** |
|---|---|---|---|
| Cheat sheet | 6 (5) | 41% → 18% → **100%** | 95 → 78 → **99** |
| Hand-off note | 6 (4) | 34% → 59% → **100%** | 95 → 84 → **99** |
| Decision-table reply | 3 (1) | 69% → 46% → **100%** | 93 → 67 → **100** |

- Cost: 13–20 s per document; the analysis retry fired for 2 of 10 sections (one each in the hand-off note and the
  decision reply). Regenerate had nothing left to fix in 2 of 3 documents.
- The decision reply as the user wanted it: the takeaway "Merge v3, formalize answer headings, and await
  engineering assets before proceeding"; the full decision table (all three columns); "Analysis · Status of
  Proposed Decisions" with a line per decision (D1 proposed · D2 needs the engineer's agreement · D3 proposed ·
  D4 decided · D5 deferred until Phase 8 · D6 decided); the requests as a card; 1 link; nothing restated.

*Left for later waves (not B1):* layout. The cheat sheet is complete but lands as a tall stack of dense tables
(12 crossings, 3 "Dense" blocks, unreadable below 25% zoom) — Wave C (signaling) and Wave D (overview level, wrapped
sections). B2 (the ledger) is now less urgent: references already stop the dropped columns; its value is
fact-level coverage for prose.

Tests: `sourceBlocks.test.ts` (7), `analysis.test.ts` (16), the stable-key tests in `validate.test.ts` and
`outlined.test.ts`; mocks elsewhere reply as a good model would. Gate: typecheck and lint clean, 1,231 unit tests
pass; local e2e (Visualize, smoke, review, content source, section updates, renderer) 30/30.
- **Prompt:** replace "in the content's own words" for level 1 with an explicit analysis task per section kind:
  - every section: a one-line **takeaway** (≤ 15 words), always rendered;
  - `decision`: the recommendation, the options, and the trade-off or reason for each;
  - `comparison`: what differs and what that means, not just the table;
  - `flow`: numbered steps, plus where it branches or can fail;
  - `hierarchy` / `cards`: how the parts relate, not only what they are;
  - status/notes: done · pending · blocked · needs a decision, as a small status structure.
  Source wording moves to level 2 (`explained_by` detail cards) and level 3 (pages).
- **Inferences allowed, but marked (D-R2.1):** level-1 analysis may state what the source implies but doesn't say
  (e.g. "D2 blocks D3"). Such nodes carry `origin: "analysis"` and render with a small "Analysis" tag, so they are
  never mistaken for a source fact. The ledger check does not require them to cite a source unit. Nothing
  contradicting the source is allowed.
- **Ledger (old Step 3):** the model lists facts and the nodes covering them in the same reply (§3.2). The safety net
  then rarely fires, which removes the duplicate copy.
- **Level tags (old Step 5):** `level` on every node; the renderer places level 2–3 one step away from the analysis.
- **Safety net, relocated:** uncovered units go into the node whose `covers` they belong to when the ledger says so.
  Otherwise they go into a collapsed **"Source details"** page linked from the section, never a large card among
  the analysis.
- **Analysis check (deterministic):** a section fails the check if its level-1 nodes are mostly source text
  (e.g. > 70% of their words appear verbatim in the source in long runs) or it has no takeaway. A failure gets one
  retry with feedback, then a visible notice. No extra AI cost when the plan is fine.
- **Failed twice (D-R2.2):** a section whose generation fails, or whose repair retry fails too, shows its own
  structure (the Wave A fallback) **with** the visible notice and Retry. It is never left out.
- **"Keep as text" outcome (D-R2.3):** fewer than 3 content nodes **and** no relationships → *"This reads fine as
  text"*, and nothing is drawn. Both conditions are required: the review suggested "or", but "or" would suppress
  legitimate relationship-free sections (a comparison table, a set of cards). Applies to the whole result; inside a
  multi-section document a small section stays as a text section, not a diagram.
- Files: `tasks.ts`, `sectionKinds.ts`, `fidelity/ledger.ts` (new), `fidelity/coverage.ts` (new), `safetyNet.ts`,
  `validate.ts`, `outlined.ts`.

#### Wave C: Signaling and review on the canvas *(S–M, largest research effect)*

**Round 1 (2026-09-29): items 1–3 done; item 4 (review reasons on the canvas) not started.** Local only: not yet
tried on a real model.
- **Relation types drawn differently** (`ai/changes/relationStyle.ts`, applied in the writer): `flows_to` solid
  arrow · `depends_on`/`derived_from` dashed · `blocks` bar head · `caused_by` triangle head, labelled "caused by"
  when unlabelled · `supports`/`implements` open triangle · `explained_by` dotted with a dot at the detail ·
  `references` dotted · `relates_to` a plain line with no head. No legend; colour unchanged (it carries no meaning).
  Applies to every producer (Visualize, MCP, reconciliation), since it is the writer's look-up.
- **Numbered flow steps**: in the plan itself (`wrapSections` → `flowSteps`), for flow sections, in `flows_to`
  order ("1 · Order", "2 · Validate"); explanations aren't numbered; an old number is replaced, never stacked
  (`unnumbered`). Part of the stored plan, so an update compares like with like.
- **The accent means something**: a card's title keeps Response styling's title background only when it is the
  model's analysis or `importance: "high"`; other card titles are plain (`plainTitle` on the change). Section and
  document titles keep it.
- Relation types look different: dashed for `depends_on`, a short on-arrow label for `causes` / `caused_by`, a
  distinct head for `explained_by`. The kind sits **on or next to** the element, not in a separate legend (this
  replaces the legend idea in Wave 1b #3, which would add split attention).
- Flow steps are numbered.
- Emphasis means something: the accent goes on primary sections and the recommendation only, not every title;
  a wider importance scale.
- Review reasons and the coverage line (old Step 4b) are shown **next to each changed element** on the canvas; the
  bottom bar keeps only totals and Accept / Reject.

#### Wave D: Scale and indicators *(M)*

**Round 1 (2026-09-29): overview level, table sizing, compare wrapping, section links checked.** Local only.
- **Overview level (semantic zoom)** — `components/ai/SectionOverview.tsx`: below 35% zoom each Visualize section
  frame shows a card over it with its title and takeaway, sized to stay readable on screen at any zoom; the canvas is
  untouched and clicks pass through. The frame carries them (`create_frame.overview` → `customData.acuteOverview`).
  Checked in the browser at 20% (smoke test + screenshot). Frames made before this show no card.
- **Tables sized to be read**: column widths from content, 80–360 px (was ≤ 220), up to 1,200 px wide (was 900),
  written as `columnWidths` and used by the compact preview (`<colgroup>`), so the drawn table matches its box
  instead of equal, thin columns.
- **`compare` sections wrap** like a grid when a row would pass 1,500 px, instead of one row so wide that every
  other section is pushed into a single column below it.
- **Section links are checked**: frame-to-frame links used to be skipped by the layout check, so "links cross cards"
  left out the links most likely to; they are now routed and judged like any other (no measurable cost: repo-map
  pipeline timings unchanged, 55–62 / 41–43 ms).
- Not started: block collapse, wrapped long flows (serpentine order), bundling cross-frame arrows, the indicator
  budget (one "N dense" summary, dense ≠ stale colour, fading "added" dots), reduced motion for the camera.
- Tests: `visualize/signaling.test.ts` (8); the smoke e2e checks a dotted `explained_by` link and the overview card
  at 20% zoom. Gate: typecheck and lint clean, 1,239 unit tests (the repo-map timing test passes alone; it failed
  once under the parallel e2e load); full local e2e **104/104**.

**Round 1 live check (2026-09-29, Gemini `gemini-3.1-flash-lite`, headed; 11/11 specs pass, then the cheat sheet
once more for diagnosis).** Reports: `.ai/docs/fidelity-runs/2026-09-29/` (previous run kept for comparison).

| Case | Time · calls | Fidelity: all / visible (B1 final → now) | Review bar layout (B1 final → now) |
|---|---|---|---|
| Cheat sheet | 24 s · 7 | 99 / 99 → 99 / 98 | 3 links through cards, 12 crossings → 6 through cards, 4 crossings (rerun: 7 sections, 5 / 15) |
| Hand-off note | 16 s · 6 | 99 / 99 → 98 / 98 | 2 through cards → 7 through cards, 1 crossing |
| Decision-table reply | 11 s · 2 | 100 / 100 → 100 / 100 | clean → clean (2 links) |

The "through cards" counts are not comparable one to one: the check now also judges section-to-section links, which
it used to skip, so part of the rise is links that were always there and never counted.

What round 1 did, confirmed on real output:
- **Overview level works where sections have room.** The hand-off note at 30% zoom reads as four cards — "Status and
  Branch Configuration: Work is staged on -sr3 branches, awaiting authorization for final merge and push", "Pending
  decisions and risks", "Built project features", "Verification test results" — with the styled links between them.
- **Relation styles are visible**: dotted detail links ending in a dot, dashed dependencies, labelled links between
  sections.
- **Numbered flow steps**: the cheat sheet's hook lifecycle reads 1 · … 8 · in order.
- **Tables read as tables**: the hooks table and the decision table have proportional columns; the decision table is
  now mostly one line per row.
- Fidelity held (98–100), and the decision reply stayed clean: takeaway, full table, a status line per decision.

Problems found (the input to round 2):
1. **Overview text breaks in narrow sections.** The overlay's text is a fixed on-screen size, so a frame that is
   narrow on screen wraps it word by word, even mid-word ("struc / ture", "Centrali / zed"). → Give the card a
   minimum readable width (it may overhang a narrow frame, centred on it), never break inside a word, and truncate
   the takeaway to its lines.
2. **Large results are still one tall column.** The cheat sheet fits the screen only at 10% zoom as a strip about
   1:4 (width : height): sections with a wide table (up to 1,200 px) plus cards are too wide to pair within
   `SECTIONS_MAX_WIDTH`, so `packRows` stacks them. → Pack for a landscape result (aim ≤ 16:9 at fit): shelf packing
   by height, or a cap on section width with members wrapping inside it, so "fit to screen" lands above 25% zoom.
3. **Wrapped chains run back across.** A chain wrapped 3 per row reads 2 3 4 / 5 6 7, so the arrow 4 → 5 crosses the
   whole section. → Serpentine (boustrophedon) order for wrapped chains: 2 3 4 / 7 6 5, so each arrow is short.
4. **Links between stacked sections run through cards** (most of the new "through cards" count). → Route
   frame-to-frame links through the gutters between frames (enter and leave a frame at its edge), not across its
   cards.
5. **Indicators crowd the overview**: a green "added" dot per object and "Dense" pills sit on top of the overview
   cards. → Hide markers while the overview shows; the indicator budget (one "N dense blocks" summary) from the
   Wave D list.
6. **One run reported "2 parts of AI's plan couldn't be shown and were left out"** (the B1 loss notice, working as
   meant). Fidelity stayed 99, so it wasn't source content, most likely nodes the model made up. The rerun didn't
   reproduce it. The fidelity report now records the app's own warnings (`appWarnings`, from the `[acute-notes]`
   console lines, including what validation lost), so the next occurrence names its cause.
7. **Run-to-run variance**: the same document outlines as 5 or 7 sections, with 4 to 15 crossings. Layout fixes must
   hold across outlines, so round 2 is judged on several runs (Wave F1).
8. Minor: the decision reply got a card restating a placed paragraph ("Required from engineer: …"), a small breach of
   "never restate a block". Not worth another check yet.

Round 2, in order: 1 (overview width) and 5 (markers hidden in the overview) are small; then 3 (serpentine
chains) and 2 (landscape packing), which target the "fits above 25% zoom" success criterion; then 4 (gutter routing
for section links).

**Round 2 (2026-09-29): built and tested locally; the live check is next.**
- **Overview cards readable in narrow sections** (problem 1): a card is centred on its frame, at least 300 px wide
  on screen, overhanging a narrow frame but never past the free space beside it (`room`, from scene geometry, so it
  holds at any zoom); lines break between words only; title up to 3 lines, takeaway up to 4.
- **Markers hidden in the overview** (problem 5): while cards show, the added dots, "Dense" pills and stale dots are
  hidden (one CSS rule on the sibling overlays); they come back when zoomed in.
- **Serpentine chains** (problem 3): a chain is ordered by its `flows_to` links (the order its step numbers follow),
  and when it wraps, every other row runs right to left: 1 2 3 / 6 5 4 / 7, so each arrow goes to a neighbour.
- **Landscape packing** (problem 2): a result that already fits a 1600×900 screen at ≥ 50% zoom keeps the plain
  packing (small results are unchanged); a larger one takes the row width, up to 4 sections side by side, at which
  the whole result fits at the highest zoom (every row break is tried, in reading order).
- **Section links in the gutters** (problem 4): a link between two sections treats the other sections' frames as
  obstacles (`avoid` on the route request, in the writer and in the layout check alike), so it goes around a
  section instead of across its cards.
- Tests: `signaling.test.ts` now 11 (snake order, landscape packing vs one column, gutter routing, overview room).
  Gate: typecheck and lint clean; 1,242 unit tests (`indexPerf` timing fails only under full-suite load and passes
  alone); full local e2e 104/104.

**Round 2 live check (2026-09-29, Gemini `gemini-3.1-flash-lite`, headed; 11/11 specs pass).**

| Case | Time · calls | Fidelity all / visible (round 1 → 2) | Fits the screen at (round 1 → 2) | Review bar (round 2) |
|---|---|---|---|---|
| Cheat sheet | 19 s · 9 | 99 / 87 → 99 / 94 | **10% → 20%**, now landscape (2 rows) | 6 sections · 7 through cards · 13 crossings |
| Hand-off note | 12 s · 5 | 98 / 98 → 98 / 98 | 30% → 30% | 4 sections · 1 overlap · 1 label overlap |
| Decision-table reply | 18 s · 3 | 100 / 100 → 100 / 100 | — (one section) | 1 through a card · 4 crossings |

Confirmed on real output:
- **The overview reads the whole cheat sheet at 20%**: six section cards — "Deterministic Check Mechanisms",
  "Hook Execution Flow", "A1–A6 Interaction Codes", "Engineer Configuration (YAML)", "Submission Outcomes",
  "System Knobs and Setup", each with its takeaway — in two rows instead of one tall strip. No word breaks; the
  markers are hidden while it shows. The hand-off note reads the same way at 30%.
- **The snake works**: the hook flow reads 2 → 3 → 4, straight down to 5 → 6 → 7, each arrow to its neighbour.

Found, and fixed after the run (local only, not yet re-run live):
- **The app's own warnings named the earlier "parts couldn't be shown" losses** (problem 6): in the hand-off note,
  six nodes were dropped for having no `content` — references the model wrote as `{"type":"table","ref":"T1"}`
  or with `sourceRef` instead of `{"type":"source","ref":"T1"}`. The safety net restored their text in "Source
  details" (fidelity stayed 98), but they left the visible canvas. `expandSourceRefs` now expands a reference
  however it is spelled (any type with a `ref` and no content of its own; `ref`, `sourceRef`, `source_ref`,
  `content.ref`); a node with content of its own keeps it.
- **A flow section's table sat inside the step grid** as one of its cells, pulling step 1 away and stretching the
  columns (the long 2 ← 3 arrow). `chainLayout`: the linked steps snake on their own; the section's other members
  (its table, notes) sit in a row below them.

Still open:
- The cheat sheet has 7 links through cards and 13 crossings, and the decision reply 4 crossings (its analysis
  linked to several blocks). Section links now go around sections, so the remainder is inside sections: links from
  a card to the blocks it explains across the grid.
- **Repo-map pipeline timing flagged**: the "50-node upsert < 100 ms" test now measures 105–130 ms (new section) and
  69–96 ms (updates), against 55–62 / 41–43 ms earlier today. Each round-2 change on its path was turned off in turn
  (the layout check's `avoid`, the router's `avoid`, the landscape packing; the test's sections are grids, so the
  chain changes don't apply) and the timing did not move, while a plain CPU loop runs about 2× slower than usual
  (780–810 ms for 3·10⁸ iterations) — so the machine, not the code, is the likely cause. Re-measure on a cool
  machine before closing; if it stays, profile the upsert stage by stage. (The parser's "large document within
  budget" test, untouched by this work, also failed once in the same session and passed alone.)

**Confirming run (2026-09-29, Gemini, headed; 11/11 specs pass).**

| Case | Time · calls | Fidelity all / visible | App warnings | Review bar |
|---|---|---|---|---|
| Cheat sheet | 14 s · 7 | 99 / 99 | none | 6 sections · 2 through cards · 2 crossings (was 7 / 13) |
| Hand-off note | 14 s · 5 | 99 / 99 | none | 4 sections · 5 through cards · 2 crossings |
| Decision-table reply | 10 s · 2 | 100 / 100 | none | 1 section · 3 through cards |

- **Both fixes hold**: no node lost in validation in any case (the reference fix), and everything visible.
- The chain fix wasn't exercised: this outline had no flow section (outlines vary run to run). It is covered by
  `signaling.test.ts`.

Two more issues from this run, fixed locally:
- **Narrow sections clipped their overview text** ("submit_answe", "Configi and Manag"): a card may not widen into
  its neighbour, and the title had a fixed size. Now the title and takeaway shrink with the card (container query:
  about 12 characters a line), down to 11 px / 10 px on screen, and only a word too long for the card on its own
  is broken. Checked in the browser at 10% zoom with a wide and two narrow frames.
- **The decision reply's only section was classified "supporting"**, which the analysis check holds to less (a
  takeaway only), so its per-decision status wasn't required. `validateOutline` now makes a document's only
  section "notes" (primary) when the model calls it supporting.

Gate after these: typecheck and lint clean; 1,245 unit tests (the repo-map "map_full" test hit its 5 s timeout
once in the full suite and passes alone at 3.6 s — the same slow-machine state as above); the Visualize, smoke,
review and routing e2e specs 21/21.

**Round 3 (2026-09-30): links inside a section — local, measured, not yet run live.**

Measured on a scenario test shaped like the live decision reply (intro, table, requests, a summary, and an analysis
card linked to several of them), with the same layout check the review bar uses (`renderer/linkOrder.test.ts`):

| Section arrangement | Before: through cards / crossings | After |
|---|---|---|
| stack (a column) | 2 / 1 | **0 / 0** |
| grid | 1 / 2 | **0 / 0** |

What did it, in order of discovery:
- **Adjacency order** (`connectedOrder`, for grid, compare and stack sections): members are placed following their
  links depth-first from the first member (plan order breaks ties and places unlinked ones), so a link joins
  neighbours. Reading order is kept wherever links don't say otherwise.
- **Room to turn in a stack**: stacked cards were 32 px apart, exactly the connector gap plus the route's stub
  (8 + 24), so a route that had to go around a card turned on the card's edge, counted as hitting it (6 px
  clearance), and the straight route through the card won the tie. Stacked sections now use a 48 px gap.
- **C-shaped routes for a link that skips a box** (`routing.ts`): when the two ends line up (a column, or a row)
  and a box sits between them, the link leaves and re-enters on the same outer side, around the box, instead of
  leaving through the facing sides and cutting across the short links between the neighbours. Guarded so a box
  merely near the path changes nothing (`skipsABox`, unit-tested). The Reflow e2e case "the step sits in line after
  A…" pinned the old entry side of an arrow that now skips the inserted step; its assertion now checks the intent
  (still bound to B, ending on B's edge).
- Cost: repo-map pipeline A/B (C route off → on, 3 runs each): new section 55–59 → 59–62 ms, updates 40–42 → 40–43 ms.
  Both back at this morning's baseline, which also closes the earlier timing flag (the 105–130 ms was the machine).

Gate: typecheck and lint clean; 1,248 unit tests (the repo-map `map_full` test sits at 3.3 s of its 5 s limit alone
and times out under full-suite load — unchanged by this work); full local e2e 104/104.

**Indicator budget (2026-09-30): local, checked in the browser.**
- **One summary, not a pill per block**: each dense block gets a small violet dot on its corner (tooltip and label
  "Dense: …"), and one chip by the zoom controls says "N dense blocks · Review · Dismiss all". Review starts the
  walk-through (the chip gives way to its bar); the walk-through bar gained "Dismiss all" (`denseBlocks.dismissAll`).
- **Dense ≠ stale**: violet (#7048e8, #9775fa dark) is "dense" only; amber stays "stale".
- **The green "added" dots pulse three times, then stay still** (they still clear after 5 s by default, or as the
  "AI change markers" setting says); reduced motion still turns the pulse off.
- The overview hides all of these while it shows (round 2).
- Tests: `denseBlocks.test.ts` (+1, Dismiss all), `e2e/local/denseSummary.local.spec.ts` (new: a local-tier table
  with an over-long cell → one dot, one chip, Review, Dismiss all). Gate: typecheck and lint clean; full local e2e
  105/105; unit tests pass except the two repo-map timing tests, which fail only under full-suite load (they pass
  alone at 3.3 s of 5 s and ~60 of 100 ms). They have failed in most full runs today: worth the wider margins or a
  serial run Wave F3 proposes.
- Not done: reduced motion for the camera scroll; one bottom bar at a time (the review bar and the "Added …" notice
  already don't overlap in the checked cases, but that isn't guaranteed).

**Review reasons on the canvas (Wave C item 4, 2026-09-30).**
- While a Visualize proposal is under review, each section frame carries a chip above its top-right corner
  (`SectionChips.tsx`, from `fidelity/sectionReview.ts`): "Structure only: AI couldn't analyse it" + **Retry**,
  "Not analysed", or "AI placed N% · +N from source · N key terms missed" + **Regenerate** when the section fell
  short (once per section). Tone by colour of its edge (warning / note / ok); the tooltip has the full reason, the
  first points added from the source and the missed key terms.
- The bar keeps the totals ("AI placed 86% · +4 from source · Nothing lost ✓ · Key terms 52/53", "Regenerate N
  sections") and Accept / Reject; its per-section list is dropped when the chips show it (kept for results
  without section frames).
- A chip is never wider on screen than its section (text cut, action kept), so side-by-side chips can't cover each
  other at low zoom — found in the live run, where one of four chips was hidden under its neighbour's.
- A one-section document no longer shows the outline's summary as a subtitle: it repeated the section's takeaway.
- Tests: `sectionReview.test.ts` (3); the smoke e2e checks the coverage chip and the fallback chip with its Retry;
  the AI fidelity spec records the chips (`sectionChips` in report.json) and screenshots the canvas instead of the
  bar's list.

**Live run (2026-09-30, Gemini, headed; 11/11 pass; reports in `fidelity-runs/2026-09-30/`).**

| Case | Time · calls | Fidelity all / visible | App warnings | Review bar |
|---|---|---|---|---|
| Cheat sheet | 18 s · 8 | 100 / 99 | none | 6 sections · 2 through cards · 3 crossings · 4 overlaps |
| Hand-off note | 18 s · 6 | 99 / 93 | none | 4 sections · 4 through cards · 3 crossings |
| Decision-table reply | 15 s · 3 | 100 / 100 | none | 1 section · 2 links · clean |

- Every section got its chip, e.g. "SR3 Deterministic Checks: AI placed 83% · +5 from source · 1 key term missed",
  "Features and Implementation Status: AI placed 50% · +4 from source · 1 key term missed" with Regenerate.
- The decision reply: a "Decision Tracker" (a line per decision: D1–D3 pending the engineer's approval, D5 pending
  Phase 8 data, D6 noted) and a "Status Summary" (Done / Pending / Blocked), the full table, 2 links, no layout issue.
- Still open: the multi-section documents keep a few links through cards (2 and 4) — links between the grid's cards
  of a large section the scenario test doesn't cover; worth a scenario from a recorded plan next.

Gate after the chip fixes: typecheck and lint clean; unit tests pass except the load-sensitive timing tests
(`map_full`, `indexPerf`; both pass alone). The local e2e ran against another session's dev server on port 3100
(a second `next dev` in the same folder refuses to start): 102 passed; the 4 MCP transport tests failed only because
they connect to a fixed `localhost:3000` ("fetch failed"), and passed in this morning's full run (106/106).

**Waves C/D completed (2026-09-30, local; not yet run live).**

| Item | What was done | Checked by |
|---|---|---|
| Links through cards in larger sections | Reproduced offline: a tree section with explanations (the live "Structure" sections) had 3 links through cards. **Tidy tree** for tree sections (`tidyTree`): each parent centred over its children, subtrees as wide as they need, layers 48 px apart. **Explanations beside their node** in a tree (`sideExplanations`): a column to its right, part of its room — hung below, they were pushed under the children and their links ran through them. **Other-axis routes** (`otherAxisRoute`): a route still through a box tries the other pair of sides and keeps the one that crosses less (a node's right side may be where its notes sit). Tree scenario 3 / 0 → **0 / 0**; the larger-grid scenario was already 0 / 0. One pair of links from a root may share a run (not spread on the other axis). Cost: none measurable (repo-map A/B 56–60 / 39–42 ms both ways). | `linkOrder.test.ts` (tree, grid, stack, C-route guard), layout snapshot updated (the fixture's tree section is now centred) |
| Collapsible blocks | Toggle headings enabled (`allowToggleHeadings`), toggle list and toggle headings added to the canvas block's slash menu (they were pages-only); the compact preview shows a toggle heading collapsed with ▸, as it already did a toggle list | `e2e/local/toggles.local.spec.ts` |
| Reduced motion | Every animated camera move (dense walk-through, Ask AI, page previews, provenance, find) jumps instead of gliding when reduced motion is asked for (`prefersReducedMotion`); the spinner turns slowly instead of fast | dense e2e samples the camera every 25 ms: ≤ 2 positions with the fix, 6 without it (checked both ways) |
| One bottom bar at a time | CSS priority on the shared spot (`main:has(…)`): a Visualize in progress or its error, then a proposal under review, then the dense walk-through, then the "Added …" notice; the others come back when it goes | smoke e2e: a second Visualize while a proposal is under review shows only its progress, and the review bar returns after |
| One AI marker per object | The green "added" dot gives way on an object that shows a dense or stale marker | dense e2e: the dense block has no green dot, other added objects do |
| Stale markers not forever | Saved with a date; dropped (and deleted from the device store) after 14 days; the older array format still loads | `staleMarkersStore.test.ts` (+1) |

Wave C is complete (relation styles, numbered steps, meaningful accent, review reasons on the canvas). Wave D is
complete except the **success-target re-run of the ICP scenario** (a repo map over MCP by an IDE agent — an AI run,
not done without approval).

Gate: typecheck and lint clean; full local e2e **108/108**; 1,279 unit tests, of which the two repo-map timing tests
fail under full-suite load (alone: 57–60 / 39–42 ms and 3.3 s, back at this morning's baseline; one spike to 140 ms
right after the e2e run).

**Live check of the completed Waves C/D (2026-09-30, Gemini, headed; 11/11 pass; reports in `fidelity-runs/2026-09-30/`).**

| Case | Time · calls | Fidelity all / visible (before → now) | Review bar (before → now) |
|---|---|---|---|
| Cheat sheet | 15 s · 6 | 100 / 99 → 100 / **77** | 2 through cards · 3 crossings · 4 overlaps → **0 through cards** · 2 crossings · 1 overlap |
| Hand-off note | 17 s · 6 | 99 / 93 → 99 / 99 | 4 through cards · 3 crossings → **0 through cards** · 8 crossings · 3 overlaps |
| Decision-table reply | 11 s · 2 | 100 / 100 → 100 / 100 | clean → clean (1 link) |

- **No link through a card in any case** (the goal of this round); no app warnings; a chip on every section; the
  hand-off note reads as four section cards at 30%.
- **Cheat sheet visible 77**: one section, "Check definitions and logic", had AI placed 28% (90 key terms missed).
  The model re-arranged the source's checks table into its own comparison table (checks as columns, three attribute
  rows) — what the `comparison` kind's rule asked for, against "place every table by reference" — and left the rows'
  examples out; a transposed table can't be repaired, so the safety net put the rows in "Source details" (nothing
  lost, but off the visible canvas). **Fixed**: the comparison kind now says a comparison already a table in the
  content IS the comparison, placed as it is; its own table only for facts scattered in prose (as decisions do).
- **The model copied block numbers into its text** ("[P1] One row per check… [P2] … [P3]"). **Fixed**: the prompt
  forbids it, and `expandSourceRefs` strips `[P1]`/`[T1]`/`[L1]`/`[C1]` tags from the model's own strings (never from
  expanded source blocks; `[x]` and `a[1]` are untouched).
- **Hand-off crossings 3 → 8** are inside its Decision section: shapes with two or three explanation cards stacked
  below them — the first is adjacent, the others are reached by C routes along the stack's side, which cross the
  links between the shapes. Open. Options: explanations of one parent in a row under it (each link direct), or one
  connector to the stack. Both change many layouts, so they want a scenario test first; crossings are the milder
  issue now that no link runs through a card.

Gate after the two fixes: typecheck and lint clean; unit tests pass except the load-sensitive timing tests; the
Visualize, smoke and dense e2e specs pass (one run failed on a Playwright trace file another run removed, ENOENT;
it passes on its own).

**Crossings from several detail cards per node — fixed (2026-09-30, local; not yet run live).**

Reproduced offline as the live hand-off "Decision" section (four shapes linked to each other, two or three detail
cards each): **5 links through cards, 11 crossings, 9 shared runs.** The cause was two-fold: every detail after a
node's first was reached by a link skipping the ones above it, and the cards (460 px) hung under narrow shapes
(170 px) overlapped and were pushed down in a staircase, so links wound around them.

| Step | Through cards / crossings / shared runs |
|---|---|
| Before | 5 / 11 / 9 |
| One detail card per node (`mergeDetailCards`, in `wrapSections`) | 0 / 3 / 2 |
| Details as part of their node's room (`explanationsBelow`: grid, compare, stack, chain) + C-route also when the best route still crosses a box | **0 / 0 / 1** |

- **`mergeDetailCards`**: a node's short text details (`explained_by` targets of the same origin, none a parent of
  its own) become one card, each detail under its own bold title, in order; links to a merged card point to the one
  it joined. Not merged: analysis with source details, details of details, tables, code, pages, or a merge past
  1,200 characters (the dense limit). Visualize only (`wrapSections`, first run and updates alike, so an update
  compares like with like); never MCP or Repo Map, whose agents refer to nodes by key.
- **`explanationsBelow`**: in grid, compare, stack and chain sections a node and its detail stack are one unit for
  the arrangement (as wide as the widest of them, as tall as the node plus the stack), the node centred over its
  cards; trees keep theirs beside the node, concept maps place their own.
- **`linkedGrid`**: a grid keeps the plan's order or the link-following order, whichever puts linked members closer
  (the plan's on a tie) — a depth-first order suits a row, not always a 2-D grid.
- Tests: `linkOrder.test.ts` now 8 (the merge keeps every detail under its title; the scenario reaches 0 / 0).
  Gate: typecheck and lint clean for this work (the other session's `compositeShapes.ts` had typecheck errors
  mid-edit); 1,059 AI / MCP / component tests pass; repo-map timings unchanged (55–58 / 42–44 ms); full local e2e
  109/109 (one run hit the same Playwright trace-file ENOENT from a parallel run and passed on its own).
Baseline from the ICP run ([2026-09-27](./icp-test-runs/2026-09-27-developer-workflows.md)): 44 of 79 arrows
cross frames, a 12-card section is 3,672 px wide, and 101 cards need 10% zoom to see.
- Overview level: section cards (label + takeaway) when zoomed out, detail when zoomed in (Wave 1b #6).
- Progressive disclosure: level 2–3 content collapsible on the canvas; toggle headings on and toggle lists in the
  canvas menu.
- Wrap long flows; wrap wide card sections into rows; route or bundle arrows that cross frames.
- Indicators, with a budget of **at most one AI marker per object** and one bottom bar at a time:
  - one "N dense blocks" summary instead of a pill per block, plus "Dismiss all";
  - separate colours for dense and stale (amber is stale only); stale dots cleared on accept/dismiss, not kept
    across reloads indefinitely;
  - green "added" dots fade after review instead of pulsing on every object;
  - paste hint and toast suppressed while a review bar is open; fix the two overlapping bottom bars;
  - honour `prefers-reduced-motion` for the spinner and camera scroll.
- Success targets (re-run the ICP scenario): under 15% of arrows cross frames, no section over 2 screen widths
  at 100%, and the whole result readable at 25% zoom through the overview level.

#### Wave E: Representation gaps *(M–L)*

**Phase 1 — Mermaid `sequenceDiagram` import (2026-10-01): done, local only (no live/AI run).**
- A `sequenceDiagram` block now converts instead of being rejected (`unsupported_diagram`): its own parser
  (`src/ai/mermaid/sequence.ts`) and plan builder (`sequenceToPlan.ts`), not the generic `graphToPlan` path —
  that path dedupes same-`(from,to,label)` edges and picks a template from graph topology, both wrong for a
  sequence diagram's repeated messages and message-order semantics. Each message becomes a chained `flows_to`
  step (the `flow` template's own rule for a sequence), in script order, never deduped; a `Note` becomes an
  `explained_by` text card on the message it follows; `loop`/`alt`/`opt`/`par`/`critical`/`break` become bracketed
  label prefixes on the messages inside them (nested blocks compose); `activate`/`deactivate`/`box`/`rect` are
  read past and reported, never silently dropped. No new node type, template or validator change.
- Deliberately not a lifeline/column layout (participants as columns, messages as horizontal arrows) — that
  needs a new `GroupArrangement`/layout, left for a later round, the same way Wave D's layout work happened in
  rounds after its first cut landed.
- Plan: `.claude/plans/humble-strolling-orbit.md` (if still present). Files: `src/ai/mermaid/{sequence,
  sequenceToPlan}.ts` (new), `types.ts`, `detect.ts`, `convert.ts`. Tests: `sequence.test.ts` (new, 16 cases:
  every arrow variant, aliases, notes incl. block form, nested loop/alt, activation shorthand, syntax errors with
  line/column), `convert.test.ts` (+4), `detect.test.ts`/`mermaidPlan.test.ts` updated (sequence is no longer in
  the "unsupported" bucket). Gate: typecheck and lint clean; `src/ai/mermaid` + `src/ai/content` 263/263.
**Phase 2 — the rest of Wave E, plus Wave F2/F3 (2026-10-01): done, local only (no live/AI run).**

- **Mermaid `pie` import**: its own parser/builder (`pie.ts`/`pieToPlan.ts`, same "own result type" shape as
  `sequence.ts` — a pie's label/value pairs have no edges at all). Becomes one `table` (Label/Value/Share columns)
  under `comparison` — exactly the fallback a bare table already supported, so no new node type.
- **Mermaid `gantt` import**: its own parser/builder (`gantt.ts`/`ganttToPlan.ts`). Tasks are kept in **source
  order** (never date-sorted: the `timeline` layout does no date math at all, confirmed by exploration, and gantt
  source lists tasks chronologically by convention anyway); section/start/duration are folded into each task's
  label, not drawn as duration bars or per-section lanes — a deliberate smaller first cut, same reasoning as
  sequence diagrams' chained-steps v1. Tags (`done`/`active`/`crit`/`milestone`) and `after <id>` are read past/
  kept literally, never rejecting the task.
- **Free-form causal map**: a new `causal_map` template (`templates.ts`) reusing `architecture`'s own
  `layerGraph`/`layeredPositions` layout verbatim (already multi-root, relationship-driven, cycle-safe — exactly
  what a causal graph needs) under its own strategy id (`causal-graph`, same `LayoutFn`) so every template still
  has a distinct strategy id. Reachable today via MCP's `render_visual_plan` and the local planner, same as
  `concept_map`/`problem_cause_solution`; **not yet wired** into the AI-outlined-sections pipeline (no
  `SectionKind` selects a `VisualTemplate` post the `select_template` removal) or into Mermaid's `chooseTemplate`
  heuristics — both left for a follow-on round.
- **Bar/line charts for numeric tables**: the chart is *additional* to the table (the table stays mandatory,
  primary, and is never replaced, per this plan's own wording for the item) — represented as a `code` node with
  `language: "acute-chart"` and a small JSON shape, exactly the pattern Mermaid preview already uses
  (`language: "mermaid"`). This sidesteps the ~15-touchpoint cost a genuine new `RichBlockType` would need (no
  BlockNote block spec exists for one; confirmed by exploration) — no new `VisualNodeType`, no schema/changeSet/
  BlockMenu change. New: `src/domain/content/chartData.ts` (parse/validate, shared by sizing and preview),
  `src/components/blocks/ChartPreview.tsx` (inline SVG, no charting library, read-only preview like Mermaid's —
  colors and mark specs from the data-viz skill's validated reference palette: fixed categorical hue order,
  rounded bar ends, 2px surface ring on line-end markers, hairline recessive gridlines, a legend for 2+ series,
  sparing direct labels), wired into `BlockPreview.tsx` and sized in `measure.ts` (from category/series counts,
  not char/line counts, falling back to normal code sizing if the JSON doesn't parse). `metrics`'s rule gained the
  "also add a chart" option; its other rules are unchanged.
- **Annotated text**: a new `SectionKind` (`annotated`, `sectionKinds.ts`) — prose as one `text` node with small
  numbered markers, plus a linked `explained_by` notes card listing each marker's note. Reuses the existing
  `stack` arrangement (already implemented for `supporting`) and `text`/`explained_by` plumbing: no new node
  type, no layout change, no new `GroupArrangement`. Registering it in the kind registry was sufficient — the
  outline prompt's kind list (`outline.ts`'s `KIND_LIST`) is generated from the registry, not hardcoded.
- **Wave F2 (model-tier guidance)**: `FIDELITY_CONFIG.modelGuidance` (`config/fidelity.ts`) — a word-bounded
  regex (`\b(lite|flash-lite|mini|nano)\b`; an earlier unbounded version false-positived on "gemini" containing
  "mini", caught by its own unit test) checked against `ChangeSet.metadata.model` (already threaded from
  `visualize.ts`'s provenance, no new plumbing needed); `CoverageRow.tsx` shows the note when it matches.
- **Wave F3 (test hygiene)**: `src/testUtils/timing.ts` (new, a shared `median`/`time`) — `indexPerf.test.ts`'s
  "re-indexes one edited object" (was a single `< 5ms` sample) and `reflow.test.ts`'s "dense 1,000-object canvas"
  (was one combined `< 100ms` sum) now take a median of several samples, widened margins (found live: an initial
  `< 8ms` indexPerf margin still flaked once at 9.5ms under full-suite load; widened to `< 15ms`, matching the
  same file's own "idle re-check" budget for a comparably cheap operation). `repoMap.test.ts`'s two pipeline perf
  tests now take a median of 3 update runs (was min-of-2), margins widened (100→150ms, 250→350ms); its unrelated
  `map_full` correctness test (expensive — fills a 1,500-node map) gained the same `60_000`ms timeout its perf
  sibling tests already had, after it timed out at the default 5s under full-suite load (passed in ~3s alone).
  Verified stable across two full, all-1395-test runs at full parallel load (134 workers) after these changes.
- Gate: typecheck and lint clean; full unit suite **1395/1395**, twice, at full parallel load.
- Left for later: a lifeline/column layout for sequence diagrams and gantt (participants/sections as lanes);
  Mermaid `pie`/`gantt` wired into `chooseTemplate`'s flowchart heuristics; `causal_map` as a `SectionKind` (or
  some other route into the AI-outlined pipeline) and into Mermaid import's own template choice; an interactive
  (not just read-only-preview) chart.

#### Wave F: Measure understanding *(S, in parallel)*
- Two scores per run: **coverage** (existing) and **analysis** (Wave B check, plus takeaway present, relationships
  per section, share of level-1 text not copied from the source).
- A small study: 5 people see the same content as text only and as our visual, then answer 3 recall and 3 "apply
  it" questions. This gives the "understand at a glance" claim in the positioning doc evidence.
- Fixtures: the two existing samples, plus the decision-table reply from the screenshot.
- **F1 — Measure over several runs** *(same document, same model: AI placed 72% in one run, 31% in another)*: the
  fidelity e2e runs each fixture 3 times and reports median and range. **AI placed** is the headline number
  (target ≥ 85% after Wave B); coverage stays a guard (≥ 95), since the safety net keeps it near 100% regardless.
- **F2 — Model guidance: done** (2026-10-01, with the Wave E phase-2 work above) *(`gemini-3.1-flash-lite`
  condenses heavily)*: when the connected model is a lite/flash-lite tier, the coverage row says so ("This model
  tends to condense; a larger model analyses better"). Later: a model per task (cheap model for
  `outline_document`, stronger one for `generate_visual_plan`).
- **F3 — Test hygiene: done** (2026-10-01, with the Wave E phase-2 work above): the timing tests that failed only
  under full-suite load (`repoMap` "map_full past 60" and its two perf tests, `reflow` "dense 1,000-object
  canvas", `indexPerf` "re-indexes one edited object") now use relative thresholds (a median of several samples)
  or a wider timeout, verified stable across two full, all-1395-test runs at full parallel load.

### Decisions taken (Revision 2, 2026-09-29)

| # | Decision |
|---|---|
| D-R2.1 | Analysis may add inferences the source implies, **marked as analysis** (`origin: "analysis"`, "Analysis" tag) and never as a source fact |
| D-R2.2 | A section that fails twice shows its own structure **with a visible notice and Retry**; never left out |
| D-R2.3 | "Keep as text" when the result has fewer than 3 content nodes **and** no relationships |
| D-R2.4 | Order **A → B → C**, then D, E; F (measurement) runs alongside from Wave B on |
| D-R2.5 | Trust fixes from the first live runs join the waves: A1–A3 (smoke test, safe Regenerate, honest coverage row) in Wave A; F1–F3 (multi-run measurement, model guidance, test hygiene) in Wave F |

### Research review → plan (traceability)

Every suggestion of the research review, and where it lands:

| Review suggestion | Wave | Note |
|---|---|---|
| 1. Relation types drawn differently, numbered flow steps, always a one-line takeaway | C (arrows, numbers), B (takeaway) | Takeaway is part of the analysis layer, so it lands with B |
| 2. Review explanations on the canvas, next to each change | C | Also carries the coverage line (old 4b) |
| 3. "Keep as text" outcome | B | "and" instead of "or" (D-R2.3) |
| 4. Overview level, fewer cross-frame arrows, wrap long flows | D | Plus block collapse and the ICP success targets |
| 5. Tame the indicators | D | Budget: one AI marker per object, one bottom bar |
| 6. Sequence diagrams, then charts | E | Plus Mermaid pie/gantt, causal map, annotated text |
| 7. Measure understanding (5-person text-vs-visual study) | F | Plus the automated analysis score |
| Caution: no separate legend for node kinds (Wave 1b #3) | C | Kind shown on or next to the element; update Wave 1b #3 in the master plan accordingly |
| "No redundancy" (text duplicated) | B | Safety net moves to a collapsed "Source details" page; the ledger makes it rarely fire |
| Signaling: one orange accent on every title, narrow importance scale | C | Accent on primary sections and the recommendation only |
| Single-template path has no takeaway | — | Obsolete: `select_template` is removed and every document is outlined |
| Chunking caps (60 nodes, ~400-char cards) | — | Kept, but content now moves to pages instead of being cut (Step 2) |

### Definition of done (Revision 2)

- **A:** no section falls back silently; every fallback has a notice, a Retry and a logged cause; the mock-AI
  smoke test runs on every e2e run; Regenerate never lowers a section's AI-placed share or adds crossings; the
  coverage row leads with "AI placed".
- **B:** on the three fixtures (cheat sheet, hand-off note, decision-table reply), every section has a takeaway and
  analysis nodes that pass the "not just copied" check; coverage stays ≥ 95; the safety net attaches < 10% of units;
  no "Also in the source" card appears among the analysis.
- **C:** each relation type is visually distinct without opening Properties; flow steps are numbered; review reasons
  show next to their elements.
- **D–F:** the targets listed in each wave.

AI contract and e2e runs still happen only with explicit approval.

## 1. Principle

> **Compress presentation. Preserve information.**

Acute may transform, reorganize, rephrase, group and visually prioritize user-provided content, but it must not silently remove meaningful information during visualization. Concision applies to *presentation*, not to *information*. When information does not fit the primary visual, it is preserved as supporting detail, linked cards, annotations, sections or pages. Information is condensed or removed only when the user explicitly asks to **Summarize**.

Engineering invariants that follow from it:

1. **Visualize ≠ Summarize.** Default intent is Visualize (restructure). Summarize is a separate, explicit action.
2. **Validation never decreases information.** The validator repairs, converts or relocates — it never deletes content.
3. **Every loss is visible.** If something could not be placed, the user is told in the review, not in a hidden warning.
4. **The model is never the final authority on coverage.** Coverage is checked deterministically by the app.

## 2. Problem — where content is lost today

The pipeline (see diagram, "Current") has three independent leak points.

### 2.1 Prompts instruct the model to condense

| Location | Instruction |
|---|---|
| `sectionKinds.ts` `cards` | "only what's needed to understand it (a few words or bullets)" |
| `sectionKinds.ts` `supporting` | "Keep it compact: one short text node of the key points" |
| `sectionKinds.ts` `hierarchy` / `flow` | "a short label" — with **no channel** for the explanation attached to each step/concept |
| `sectionKinds.ts` `decision` | reasons as "a short bullet list" |
| `sectionKinds.ts` `notes` | "prose a short text" |
| `tasks.ts` `EXPLANATION_RULE` | "Keep each node about one concept, and concise" |
| `tasks.ts` `denseRules` | "gist in 1–3 sentences", "key points as short cards", "under about 400 characters" |
| `tasks.ts` prompt | "Keep it to at most 60 nodes" — model trims to fit |

### 2.2 The validator silently drops content (`validate.ts`)

| Rule | Effect |
|---|---|
| Node type not in template's `allowedNodeTypes` | Node dropped. Hits the single-template path (documents with < 2 sections): e.g. a `table` in `concept_map`, a `todo` in `flow`. |
| More than `MAX_PLAN_NODES` (60) content nodes | Keeps the first 60 — the end of the document is lost. |
| Node over `TEXT_LIMITS` (20k markdown, 300 rows, 2k cell) | Whole node dropped, not split. |
| Any of the above | Reported only in `warnings`, which the UI never shows (only `notices` reach the toast). |

### 2.3 Nothing checks coverage

No step compares the rendered plan with the source. `VisualNode.sourceSpan` exists but is unused for verification.

## 3. Approach — Information Ledger → Visual Mapping → Coverage Check

### 3.1 Why not a plain text matcher

A sentence/fuzzy matcher is wrong in both directions: *"3 attempts → exponential backoff"* fails a text match while fully preserving meaning; *"retries three times"* passes while losing *"with exponential backoff"*. Coverage must be judged on **atomic information units** (facts), with cheap deterministic checks that do not need an AI judge.

### 3.2 The ledger lives in the same call

A separate extraction call would add cost/latency per section and can itself lose facts (then coverage reports 100% against a lossy ledger). Instead:

1. **App numbers the source.** Each section's text is split deterministically into sentence units `[s1] … [sN]` (list items, table rows, code blocks count as one unit each).
2. **Model returns ledger + plan in one reply:**
   ```json
   {
     "facts": [{ "id": "f1", "kind": "constraint", "text": "retries 3× with exponential backoff", "from": ["s4"] }],
     "nodes": [{ "id": "n3", "type": "text", "level": 2, "covers": ["f1"], "content": { "markdown": "…" } }]
   }
   ```
   Fact kinds: `concept, fact, relationship, step, decision, condition, constraint, example, exception, explanation, data, code`.
   Enumerating facts before drawing is itself the strongest anti-loss lever.
3. **App verifies deterministically:**

| Check | Catches |
|---|---|
| Every source unit `sN` is cited by ≥ 1 fact | Loss during extraction ("who checks the checker") |
| Every fact is covered by ≥ 1 node (`covers`) | Loss during visual mapping |
| A covering node contains the fact's **key terms** — numbers, units, proper names, negations and qualifiers (`not, only, unless, except, must, never, at most…`) | False `covers` claims (the "exponential backoff" case) |

### 3.3 Three levels of detail

Every node carries `level`:

| Level | Role | Example |
|---|---|---|
| 1 — Visual | Structure: shapes, labels, links. Short wording allowed. | **JWT Authentication** |
| 2 — Supporting detail | Near the visual (card body or `explained_by` card). Source wording, light edits. | "JWT has header, payload and signature. The server validates the signature before trusting claims." |
| 3 — Deep content | `page` node: long explanation, examples, code, caveats. | Full section text |

Size ladder: fits on the card → card body; medium → linked level-2 card; long → level-3 page. Level tags make a future **Compact ↔ Detailed** density control a *render* decision (collapse/expand), never a regeneration — so changing density can never lose content.

## 4. Implementation plan (ordered by user impact)

### Step 1 — Prompt rewrite *(small; removes most visible loss)*
- New shared rule replacing `EXPLANATION_RULE`: *"Short labels are encouraged. Missing information is not. You may compress wording, but never remove facts, qualifications, conditions, examples, exceptions or relationships."*
- Every section kind gets a detail channel: `flow`/`hierarchy` steps link `explained_by` detail cards; `comparison` keeps surrounding prose as a level-2 note; `cards`/`supporting`/`notes`/`decision` lose "short/compact/key points".
- `denseRules`: remove "gist in 1–3 sentences" / "under 400 chars"; keep the card → page ladder.
- Remove "at most 60 nodes" from the prompt.
- Files: `src/ai/visual-plan/sectionKinds.ts`, `src/ai/visualize/tasks.ts`.

### Step 2 — Validator: convert, never drop *(small)*
- Disallowed node type → convert: `table` → `text` with a Markdown table; `todo` → `text` checklist; `code` → `text` fenced block; `page` → `text` or kept if allowed.
- Oversized node → split into a `page` (or several) linked `explained_by`; table rows split across tables.
- Over `MAX_PLAN_NODES` → overflow into an additional section (`group`) instead of truncating; raise or remove the node cap for grouped plans (layout already handles sections).
- Property test over every validator case: *information in ≥ information out* (total characters of text-bearing content, and every source token set preserved).
- Files: `src/ai/visual-plan/validate.ts`, `validate.test.ts`.

### Step 3 — Information ledger in the same call *(medium)*
- `src/ai/fidelity/units.ts` — deterministic sentence/unit splitter + numbering (pure, unit-tested).
- `src/ai/fidelity/ledger.ts` — schema for `facts`, `covers`, `level`; lenient parsing (a malformed ledger degrades to "unverified", never fails generation).
- `src/ai/fidelity/coverage.ts` — the three checks; key-term extraction.
- Extend `generate_visual_plan` prompt/envelope; `VisualNode` gains optional `level` and `covers` (stripped before render if unused).
- Token budget: facts cite unit ids, never quote source. If replies truncate, lower `MAX_SECTION_CHARS` (currently 12k) so long sections split before generation.

### Step 4 — Safety net + visible result *(small, after Step 3)*
- Uncovered units/facts → attached deterministically to their section as a level-2 "Also in the source" card (source wording), so nothing is lost even if the model misses it.
- Change-set review shows a coverage line: *"42/42 facts placed"* or *"40/42 placed · 2 added as notes"*. Validator conversions surface as `notices`, not hidden `warnings`.
- Files: `src/ai/visualize/outlined.ts`, `visualize.ts`, `src/components/ai/ChangeSetReview.tsx`.

### Step 5 — Level tags *(tiny, with Step 3)*
- Renderer reads `level` for styling/placement only (no behaviour change yet).

### Step 6 — Later
- Compact ↔ Detailed density control (canvas collapse/expand of level 2–3).
- Optional AI placement repair for uncovered facts (AI suggests, deterministic validation still decides).
- Explicit **Summarize** action with its own task and prompts.
- Apply the same ledger to Update (F38) and the MCP `render_visual_plan` / repo-map prompts.

## 5. Testing

- Unit: unit splitter, key-term extraction, coverage checks, validator conversions, "never decreases" property test.
- Fixtures: 2–3 real documents where loss was observed → baseline coverage before/after (**needed from the user**).
- AI contract / e2e runs only with explicit approval.

## 6. Open decisions

1. Level-2 wording: keep source wording with light edits (recommended) vs free paraphrase.
2. Node cap for grouped plans: raise to N per section, or remove and rely on section overflow.
3. Whether the coverage line blocks Accept when < 100% (recommended: no — safety net already placed the rest).
4. Sample documents for the Phase-0 baseline.
