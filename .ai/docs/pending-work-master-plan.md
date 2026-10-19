# Acute-Notes — Pending Work Master Plan

**Purpose:** one ordered list of everything still pending across the planning docs, so we can work through it top to bottom. This file doesn't restate requirements. Each item points to the doc that defines it, and that doc still wins on behaviour:

| Doc | What it owns |
|---|---|
| `acute-notes-prd-claude-code-ai.md` (PRD) | Requirements (F-numbers, §10–§16 cloud, §24 cloud milestones) |
| `ai-phase-implementation-plan.md` (tracker) | Per-feature status, checklists, Notes |
| `ai-future-workflow-enhancements.md` (ICP doc) | ICP workflows, CAP-01…CAP-20 roadmap |
| `ai-visualize-grouped-layout-plan.md` (F42 plan) | F42 phases and known limits |
| `ai-connection-validation-matrix.md` (F36 matrix) | Which AI connections pass |
| `product-positioning.md` | Built vs Planned claims for marketing |
| `acute-lens-prd.md` + `acute-lens-plan.md` | Acute Lens (L0–L5 semantic zoom view over interactive frames + Repo Map). Decisions locked 2026-09-30; Phase 0 clean-ups done 2026-10-01; Phase 1A-i next |
| `knowledge-notes-plan.md` | How notes are made: ideas over words, citations to stable source units, the source panel, citation-driven updates (Revision 3 of `content-fidelity-plan.md`). Approved 2026-10-19; decisions OD1–OD7 recorded; Phase 0 started 2026-10-19 |

**Priority order (revised 2026-09-27, user):**
1. **P0:** close the loose ends in features the tracker already marks Done.
2. **P1:** ICP capabilities, highest-priority ICP first.
3. **Deferred:** cloud deployment on Firebase App Hosting. It was briefly the top priority. It's kept at the end of this file, fully specified, for when it resumes.

**Standing rules:** the invariants in tracker §1 apply to every item. No git commits, pushes or PRs from this work unless the user asks. Every item ends with `npm run typecheck && npm run lint && npm run test` green. When an item is done, update the owning doc (tracker, F42 plan or ICP doc), and then tick it here.

_Baseline: code and docs as of 2026-09-27. The repo has no commits yet. Last updated 2026-10-19 (Knowledge Notes plan added; topic merge status; selection-scope rule)._

---

## 0. Where things stand

**Done (tracker):** F18–F23, F25–F31, F33, F35–F42. MCP F20 (bridge) and F21 (tools, including `update_block`) are done. F22 is done for the deterministic tier.

**Built, one check open:** F43 Repo Map over MCP. The five tools, the `map_repo` prompt, per-section review and auto-accept are all built, and the automated tests are green. The by-hand check with Claude Code and VS Code is still to do (L3).

**Not started:**
- F32, the optional decision model.
- F24, Phase 6 external MCP connectors.
- All cloud work (PRD §10–§16, §24). **Deferred.** There is no Firebase, App Hosting or Docker config in the repo.
- CAP-01…CAP-20 (ICP doc Part 6), except CAP-06, which is built, and CAP-12, which is mostly built.

**Not planned:** F34, managed AI.

### 0.1 Docs that disagreed with the code — ✅ fixed 2026-09-27

| Where | What was stale | What it says now |
|---|---|---|
| ICP doc Part 1 | MCP had "no transport, no tools". F22/F23 were "not started". Mermaid was "not in the UI". Canvas export was missing | MCP bridge, tools and Repo Map (local install, no hosted MCP, no delete tool, only one MCP prompt). F22 retrieval inside the still-real 16k cap (`ASK_BUDGET`). F23 typed arrows, but no AI-proposed links (CAP-08). Mermaid flowchart/state preview and conversion. Canvas JSON/Markdown export |
| ICP doc §3.2, §4.1, §4.9, §4.11, §4.12 | Code workflows rated ❌ before MCP and Repo Map existed | DEV-01/02/05/07/08/11, EM-01/03/04/11 and X-08 moved to 🟡 through the IDE-agent path. Killer workflows are now 4 ✅ · 15 🟡 · 1 ❌; the scorecard is 30 ✅ · 107 🟡 · 12 ❌. The claim guidance was tightened: say "your IDE agent can map your repo (local install)", not "Acute understands your codebase" |
| ICP doc Part 6 | CAP-06 was "to build", CAP-12 was "waiting on F42", CAP-01/CAP-08 said "F22/F23 planned" | CAP-06 ✅ built (local), CAP-12 ✅ mostly built, CAP-01/03/08 builds-on columns corrected |
| `product-positioning.md` | Repo Map and auto-accept "Planned". AI access "Copilot only" | Repo Map and auto-accept (Repo Map sessions) are Built in a local install, with the client check open. Copilot and a Gemini key are validated; the others are wired but not validated. The page states there's no hosted version yet |
| Tracker F42 status | Said "Phases 1–3 done" and "Phase 3 not started" together | Phases 1–3 done, with a pointer to the known limits |
| Tracker F43 status | "Not started" | Already corrected by the session that built F43: "Built, by-hand client check open" |

Re-rating note: the ICP doc ratings still come from reading code, not from test runs. Wave 1 step 2 scores the developer rows for real.

---

## P0 — Loose ends in "Done" features

These are small and already specified. With deployment deferred, they're the top priority. They're listed by user impact.

### L0 — Visualize result quality (added 2026-09-27, user: "more important than any new feature")

Owning doc: F42 plan §5, "Phase 2 fixes" and "Phase 4: dense content".

- [x] A failed section shows its own structure, not a raw "Notes" page; merged sections are capped at 12,000 characters; failures are shown to the user as a notice (done 2026-09-27).
- [x] **Phase 4.1:** dense blocks (long table cells, long checklist items, walls of text) are flagged after Accept, with a "Dense" badge and a one-by-one Review walk-through (done 2026-09-27).
- [ ] Find the entry point of the user's second bad result ("Added 2 objects", no frames). It wasn't reproduced from any in-app Visualize path; the user is to say how the run was started.
- [x] **Phase 4.3:** reconciliation keeps a split block across "Update from new content"; a changed split block is kept and reported (done 2026-09-27).
- [x] **Phase 4.2:** "Visualize better" for one dense block (opt-in AI call → replacement proposal); done 2026-09-28, checked in the app with a canned reply.
- [ ] Try "Visualize better" on a real model (user's go-ahead for AI spend) and tune its prompt.
- [x] **Phase 4.4:** "Split locally": a dense table becomes one card per row, and a checklist's long items become cards, with no AI (done 2026-09-28).
- [ ] **Phase 4.5:** wider columns for moderately dense tables (`columnWidths` in `mapNode` + `measure.ts`).
- [ ] `repoMap.test.ts` "50-node upsert … < 100 ms" is borderline: 52 ms run alone, 106 ms when its whole file runs (seen 2026-09-28; nothing in the Repo Map pipeline changed). Decide whether to isolate it or measure it differently; its budget wasn't changed.
- [ ] Check the outline's section labels (a label copied from a table row passes today).
- [ ] Investigate the two layout issues seen in the Phase 4.1 check (a table at a unit split rendered as raw `|` text; a card overlapping the next block).

**Content fidelity, Revision 2 (added 2026-09-29, user: output "directly split into card contents, no AI analysis").**
Owning doc: [`content-fidelity-plan.md`](./content-fidelity-plan.md), "Revision 2". Steps 0, 1, 2 and 4a (structure
recovery, prompt rewrite, convert-never-drop validator, verbatim safety net) are done. They stopped content loss but
produced transcription instead of analysis. Revision 2 adds an analysis layer over the preserved content and folds in
the 2026-09-29 research review (signaling, split attention, scale, indicators). Decisions: inferences allowed but
marked as analysis; a section failing twice shows its structure with a notice and Retry; "keep as text" below 3
nodes **and** no relationships; order A → B → C, then D, E, with F alongside.

- [x] **Wave A:** honest fallback: a visible notice and Retry for every section that fell back to the local tier, a logged failure cause, and no table header line promoted to a title. Core items **done 2026-09-29**: the root cause was the local tier skipping AI for table-heavy pastes (now `aiRecommended`); a persistent "Structure only" row with Why + Retry; causes logged; tab-table header fixes. Also done: A1 browser smoke test with a mock AI (`visualizeSmoke.local.spec.ts`), A2 Regenerate never makes a section worse (better-of per section, once per section, layout guard, offer below 60% placed), A3 coverage row leads with "AI placed N%" and "Nothing lost ✓". **Not yet tried on a real model** (needs the user's go-ahead for AI spend).
- [ ] **Wave B:** analysis layer (takeaway per section, analysis per section kind), information ledger, level tags, safety net moved to a collapsed "Source details" page, "not just copied" check, "keep as text" outcome. **B1 done and checked live 2026-09-29**: takeaway and per-kind analysis marked "Analysis"; source blocks placed by reference with deterministic table repair (AI placed 100% of all three test documents on its first pass, was 18–59%); item-by-item status check; decisions not chained or restated; "Source details" page; "Keep as text" for real notes only. Also fixed an older hidden loss: the validator dropped whole sections whose stable keys passed 300 characters. **B2 next:** ledger + level tags (less urgent now). Layout of large results → Waves C/D.
- [x] **Wave C:** signaling and review on the canvas: relation types drawn differently, numbered flow steps, meaningful accent, review reasons next to each change. Absorbs Wave 1b #3's link variants (no separate legend). **Round 1 done 2026-09-29** (relation styles for every producer, numbered flow steps, accent only on analysis / high-importance cards); review reasons on the canvas not started.
- [ ] **Wave D:** overview level (= Wave 1b #6), block collapse, wrapped flows and card rows, fewer cross-frame arrows, indicator budget (one AI marker per object, one bottom bar). **Round 1 done 2026-09-29**: overview cards over Visualize sections below 35% zoom, tables sized from content (and drawn that way), wide `compare` sections wrap, section links included in the layout check. **Rounds 2–3 done 2026-09-30**: overview readable in narrow sections, markers hidden in the overview, serpentine flows, landscape packing (the cheat sheet fits at 20%, was 10%), section links in the gutters, links inside sections kept short (adjacency order, C-shaped routes around a skipped card: 0 through cards / 0 crossings in the scenario test), references accepted however the model spells them, and the indicator budget (one "N dense blocks" chip with Dismiss all; violet = dense, amber = stale; added dots stop pulsing). **Completed 2026-09-30** (local): review reasons as chips on each section, tidy trees with explanations beside their nodes and other-axis routes (tree scenario 3 → 0 links through cards), collapsible blocks (toggle headings and toggle lists on the canvas), reduced motion for camera moves and the spinner, one bottom bar at a time, one AI marker per object, stale markers expire after 14 days. Open: the ICP success-target re-run (an AI run) and a live check.
- [ ] **Topic merge (added 2026-10-08, user: "the existing code should be capable of this too").** Owning doc: [`chat-share-import-plan.md`](./chat-share-import-plan.md). G0 failing tests → G1 topic identity no longer tied to headings → G2 "Merge into existing notes" (absorbs Wave B2's ledger) → G3 sources with history → G2b merge into notes written by hand. Shared-chat import (ChatGPT first, with a branch-skip layer) is an adapter on top. Phase 0 for ChatGPT done 2026-10-08. G0, G1, G2.1 (merge engine, `src/ai/merge/`) G2.2 (Visualize "Merge into existing notes", flag `NEXT_PUBLIC_TOPIC_MERGE`) and G2.3 (new parts of an outlined source generated on their own) done 2026-10-08; cross-topic repeats done and live-checked 2026-10-09. G2 complete. G3.1 (choices drawn by code, 'Use this option') and G3.2 (merge opens a choice on a contradiction) done and live-checked 2026-10-09. G3.3 (a document that changes its mind) and C1 (ChatGPT shared-chat import) done and live-checked 2026-10-09; merge cost target met (run 4 $0.2527 against $0.28). **Open:** G2b (merge into notes written by hand), Gemini and Claude chat import; Option A (skip orphan sections' AI calls) not approved. Under the Knowledge Notes plan, merge and chat import switch to distilled notes only after its R1 (OD6), and G2b should use its citations (`knowledge-notes-plan.md`, "Other open work").
- [ ] **Wave E:** sequence diagrams, bar/line charts, Mermaid pie/gantt import, free-form causal map, annotated text. Overlaps Wave 1 item 4 (CAP-07 sequence diagram) and L4's F33 item.
- [ ] **Wave F:** analysis score beside the coverage score; the 5-person text-vs-visual study.

### L1 — Run the AI e2e specs that were written but never run

Needs real AI requests, so each run needs the user's go-ahead.

- [ ] `e2e/ai/visualize.spec.ts` (F31), `e2e/ai/reconcile.spec.ts` (F39) and `e2e/ai/semanticUpdate.spec.ts` (F38b, headed). The F19 change to `acceptProposal` was never re-run either.
- [ ] Record results in the tracker.

### L2 — AI connections (F27 / F36)

- [ ] Validate OpenAI, Azure and Anthropic with real keys. Validate Ollama against a local instance (local mode only). Update the matrix and the `hidden` flags together.
- [x] Add `AIUsageRepository` and usage display (done 2026-09-27: `src/ai/usage/`, "Usage this month" in AI settings; details in tracker F27 Notes).
- [x] Add a live model dropdown for Copilot, from `listModels()`. BYOK keeps its text field (F36 criterion-4 finding). Already built (`listsModels` + `ModelSelect`); found while doing L2 on 2026-09-27.
- [x] "First AI release — done when" (PRD §23) also asks for a placeholder test adapter that proves "new folder + one registry line". Done 2026-09-27: `src/ai/providers/placeholder/`.

### L3 — MCP follow-ups

- [x] **F43 real-client check, Claude Code 2.1.209: passed** (2026-09-27, headless). Results and client quirks are in the tracker F43 Notes.
- [ ] **F43 real-client check, VS Code 1.138.0 (Copilot agent mode): to do by hand.** Use the `.vscode/mcp.json` steps in tracker F43 Notes. Also by hand in an interactive Claude Code session: the `/mcp` view, running the `map_repo` slash command, and how a wrong token or no tab is reported. Headless mode can't show any of these.
- [x] Fixes found in the check (done 2026-09-27; details in tracker F43 Notes):
  - the review-bar summary no longer repeats the section count;
  - every map tool accepts the repo name in place of `mapId`.
- [x] F43 known gaps (done 2026-09-27):
  - a section whose label changes now renames its frame too (`update_frame.name`), unless the user renamed the frame;
  - stale markers survive a reload (device-local `meta` store, `repoMap.stale.<canvasId>`). **Auto-accept stays in memory on purpose**: a reload ends it, so an agent can never write unreviewed after the user left;
  - `loadLatest` waits for a version Accept is still recording, so a same-tick re-send compares against the new version;
  - the perf test uses the real BlockNote parser (happy-dom, new dev dependency). That exposed ~160 ms for 50 updates; fixed by parsing each text once (fingerprint cache + take-once parse). Now ~85 ms new section / ~85 ms warm update (budget 100 ms, tight).
- [x] F43 levels: done as Wave 1b item 1 (one canvas). A separate child canvas / collapse-until-opened is left to Wave 1b item 6 (zoom detail).
- [x] Switch MCP `search_workspace` to the F22 index (done 2026-09-27): a `WorkspaceIndex` per MCP session (`McpSearchIndex`), re-indexing only what changed per call; text is redacted like the in-app index.
- [x] More MCP prompts (done 2026-09-27): `src/mcp/prompts/registry.ts` — `review_canvas`, `summarize_investigation`, `action_plan`, `find_missing_scenarios`, `explain_architecture`, `review_code`, `meeting_notes`. Each embeds its bounded context as a resource and names one write tool (one proposal), or asks for a chat answer when writes are off.
- [x] `delete_object` (done 2026-09-27): proposes removals for review only (the review is the confirmation), `destructiveHint: true`, all or nothing, ≤ 50 ids, no frames or locked objects; the review rows say "Delete … (asked by the agent)".
- [x] `MCPAppSurfaceProvider` interface only (`src/mcp/apps/surface.ts`), built from resource payloads, `ChangeSet` and `ToolPolicy`. Nothing implements it.
- [x] Clean-ups (done 2026-09-27): `ResourceReader` loads through `WorkspaceScan` (moved to `mcp/resources/`); `canvasDocId` lives in `sync/docIds.ts`; the `provenanceGuard` reason text is current.
- [x] Wave 1b item 4 (layout checks) and item 1b ("Tidy map", MCP side) — done 2026-09-27; see Wave 1b.
- [ ] Perf budget (decision needed): the 100 ms upsert budget holds for Acute's pipeline (~56 ms new section, ~42 ms 50 updates, stub parser). With BlockNote's parser under happy-dom it's ~96 ms / ~130 ms, guarded only at < 250 ms. Measure in a real browser, then decide whether the budget includes parsing.

### L4 — Visualize, layout and reconciliation polish

| From | Item |
|---|---|
| A3 | **Selection actions stay scoped (rule set by the user 2026-10-12).** Re-visualize with AI, Re-arrange layout and sub-topic backdrops were added on 2026-10-12 (feature map A3). The rule: anything started from a selected frame changes only that section. Re-visualize follows it (`regenerate: sections` from `sectionsOfObjects`; test `ai/reconcile/regenerateScope.test.ts`). **Re-arrange broke it** (it moved objects and redrew backdrops in every frame of the source). **Fixed 2026-10-19** (Knowledge Notes plan WP0.1): `rearrangeSource` takes the selection's frames (`RearrangeInput.frames`) and leaves every other section alone; it is scoped by frame rather than by `sectionsOfObjects`, because local-tier keys carry no analysis unit; a selection outside any frame shows a toast. Tests: `ai/reconcile/rearrange.test.ts` ("on a selection") |
| F41 | Add a cost for moving objects in the viewport, and scroll to the result after Accept |
| F41 | Re-run reflow on Accept when the canvas changed during review |
| F41 | A new node whose only link is to an existing *successor* is placed in line, not beside |
| F42 | Refit frames to their members' real heights |
| F42 | Place a new section's frame in the row of sections |
| F42 | Route arrows between frames around other frames |
| F42 | Local tier: merge scattered facts into one table (or state this as permanent) |
| F39 | Clean up superseded page documents once they can't be undone to |
| F39 | Make Keep mine / opt-out part of Ctrl+Z |
| F39 | Undo of an accepted update also rolls back the source version |
| F39 | Interleave adds into the old layout |
| F39 | A heading edited via "Update source" keeps its stable key |
| F31 | ✅ **Done 2026-09-27 (tracker F31).** Styled template picker: a radio group of cards (Auto plus the 8 unit templates), each with a layout sketch, its name and example content. Visualize a sub-range: with part of a block's text selected in its editor, Ask AI → Visualize uses only that part |
| F30 | `create_image` change kind (needed by CAP-15) |
| Frames | **Ungrouping a composite shape (cylinder, hexagon, document…) breaks it into plain lines** (open, reported again 2026-10-01). The shape is several Excalidraw elements in one group (`domain/canvas/compositeShapes.ts`). After Ungroup, its outline lines become loose elements and it stops being one node (kind, label and diagram membership are lost). Decide: block Ungroup on a composite, or treat it as converting the shape to plain lines on purpose with one undo step |
| F17 | ✅ **Done 2026-09-27.** *Canvas import:* the navigator's Import button now takes a single-canvas `.acute.json` too. It's added to the open workspace as a **copy**: new ids for the canvas, its pages and blocks, fresh block ids, embeds retargeted, images kept by id (an existing one is left as is), and " (imported)" added when the title is taken. Nothing on the device is overwritten, and importing twice gives two canvases (`workspaceBundle.ts` `importCanvas`; `inspectBundle` reports `scope`; `importWorkspace` still refuses a canvas file). The confirm dialog says "Import canvas … added to “X” as a new canvas", and the shell opens the copy without a reload. *Markdown options:* page content, frame headings, image placeholders, the connections list, and connection types, all on by default so the default output is unchanged (`canvasMarkdown.ts` `MarkdownOptions`). The export dialog shows them for Markdown in the same Include section as JSON (`IncludeOptions`). JSON options no longer touch a Markdown export. Tests: `canvasExport.test.ts` +8, and `canvasExport.local.spec.ts` +2 (export → import round trip; Markdown without Connections) |
| F33 | ~~Class and ER diagrams~~ ✅ done 2026-09-27 (tracker F33). **Still open:** sequence diagrams (need a lifeline layout in the renderer; needed by DEV-04, DEV-16 and CAP-07). A Mermaid block inside a larger document is still a code block |
| F18 | ✅ **Panel now shows what was left out (done 2026-09-27; tracker F22 Notes).** After each reply, one line under the composer says either "The AI saw everything in scope (N of 16,000 characters)" or "Context limit reached: N shortened · M left out". It expands to the named objects (click one to show it on the canvas), up to 20, then "…and K more". **Still open (CAP-01):** the 16k total and the per-object caps themselves. The first real run showed a selected 32k-character block cut to 4,000 characters while only 6,736 of the 16,000 were used, so the per-object cap is the first thing CAP-01 should raise |

### L5 — F32, the optional decision model (Phase 5b, lowest)

- [ ] It's a cost and latency optimisation only (tracker F32). Build it when a real cheap-model connection exists, and only for `select_template` and `outline_document`-style routing.

---

## P1 — ICP capabilities, highest-priority ICP first

**ICP priority used here.** It's based on the ICP doc §4.12, weighted towards the ICPs where Acute's story is most differentiated.

**Change this order if the business priority is different.**

| # | ICP | Why this rank | Fit today (✅/🟡/❌) |
|---|---|---|---|
| 1 | **Developers + Eng managers / tech leads** | The ICP we most want to claim (code context, MCP), and still the weakest: the one path is the IDE agent over MCP, in a local install only. It's the positioning's first row | 1/30/1 of 32 (re-rated after F43) |
| 2 | **Product managers** | Best current fit. Few blockers, and they're high-value (CAP-09, CAP-10) | 4/13/0 |
| 3 | **Researchers / analysts** | Blocked by scale only, and the fix is shared with #4–#5 | 2/11/2 |
| 4 | **Consultants / strategy** | Same capability set as researchers, plus templates | 3/11/1 |
| 5 | **Founders / startup operators** | Covered by the #2–#4 capabilities, plus strategy templates | 3/11/1 |
| 6 | **Knowledge workers** | Already the best fit, and needs little | 6/9/0 |
| 7 | **Designers / UX researchers** | Needs templates (journey, persona, affinity) and vision | 4/4/2 |
| 8 | **Knowledge managers / ops** | Needs company scale: connectors and sharing | 1/6/3 |
| 9 | **Students / learners** | Needs the understanding layer (P3) | 3/6/1 |

A capability is built once, in the wave of the highest ICP that needs it. Later ICPs reuse it. Sizes follow the ICP doc: S ≈ days, M ≈ 1–3 weeks, L ≈ 1–2 months.

### Wave 1 — Developers and tech leads: "your codebase as a canvas"

Killer workflows #1–#4. Acceptance test: *"Here's the repo — help me understand the system in 30 minutes."*

| Order | Item | Size | Notes |
|---|---|---|---|
| ✅ | **F43 Repo Map over MCP**: built 2026-09-27, automated checks green | — | Stands in for CAP-03 ingestion. No Acute model cost |
| 1 | L3 by-hand real-client check (Claude Code, VS Code) | S | Blocks every developer claim |
| 2 | ~~Run killer workflows #1–#4 on a real repo and score them~~ **Run 2026-09-27** on honojs/hono ($7.27, about 24 min): `icp-test-runs/2026-09-27-developer-workflows.md`. Draft: #1 stays 🟡; #2, #3 and #4 are ✅ candidates (local install + IDE agent). **Waiting on the user's Time-saved scores** before the ICP doc and positioning change | S | Confirms or corrects the re-rating |
| 2a | Fixes from the run, now folded into **Wave 1b** below (diagram quality, learned from Archify). Small ones kept here: `get_map_status` flags pending edges whose key matches nothing and suggests the nearest key; no "role step" warning noise for MCP plans; frames refit to content | S | — |

### Wave 1b — Diagram quality, learned from Archify (added 2026-09-27)

**Why:** the user compared our hono map with a diagram made by the [Archify](https://github.com/tt-a1i/archify) Claude skill (MIT, v2.17, read at `9e35d2b`). Archify's is far easier to read. The reasons, from its `SKILL.md`, `references/authoring-contract.md`, `DESIGN.md` and `renderers/`:

- **A hard content budget.** "One obvious main path", "at most 12 primary nodes", "sparse labels"; "remove low-value edges before adding routing controls".
- **The model never places pixels.** It gives kinds, lanes and columns; a renderer computes the geometry.
- **Right-angle routing with side contracts.** The first and last segment of a link leave and enter a side at right angles. Where several links meet one side, their attachment points are spread 16 px from the corners and up to 14 px apart (`geometry.mjs` `automaticPortSpread`). Near-parallel links take an outside channel. A route may not cross an unrelated box.
- **A fixed semantic vocabulary.** Node kinds (frontend / backend / database / cloud / security / message bus / external), each with a colour, a small icon and an automatic legend. Link variants: emphasis for the main path, dashed for async, security.
- **A validator the model must pass**, with stable codes, subject, evidence and supported fixes. It checks for a link through a node (always fatal), crossings, links sharing an ambiguous corridor, links running along frame borders, segments too short to read, and label collisions. A bounded repair loop stops after two rounds that don't improve.
- **Reading aids** that never change what's exported: focus on a node dims everything unrelated; "upstream / downstream reach" is explicitly *authored* reach, "never blast radius"; zoom levels show more detail (MAP → READ → FULL); source markers pinned to a commit.

Acute stays an editable, reviewed, reconciled canvas, not a static diagram generator. What we adopt is the **discipline**; we don't import Archify. Code taken from it, if any, keeps its MIT notice.

| Order | Item | Size | Notes |
|---|---|---|---|
| 1 | **Levels for Repo Map, with the budget per iteration (user's refinement, 2026-09-27).** There's no cap on the whole map. Each `upsert_map_section` adds at most about 12 primary cards, and a section may name a `parent` card in a higher-level section. The top level is the overview: one card per module or component, grouped by stage, lifecycle or trust boundary (not by directory), with a declared **main path**. A child section hangs under its parent card, on a child canvas or collapsed until opened, and a link goes from parent to child. Any one screen shows about 12 things, however large the map. Update the `map_repo` playbook: "overview first, then modules as children; drop low-value edges". ✅ **Done 2026-09-27 (without the AI re-test).** `upsert_map_section` allows at most 12 primary cards per call (nodes that are the target of an in-call `explained_by` link are details and don't count), otherwise `limit_exceeded`. `section.parent` names a card in another section (`unknown_parent` if there's no such card, `invalid_input` if it's in the same section). A child frame goes in a band below its parent's frame, to the right of its siblings, and wraps. Staging adds a parent → child-frame `explained_by` "details" link. `get_map_status` reports `parent`, and `mapId` also accepts the repo name. The playbook now has steps 4–7 (overview first, then modules). Checked by hand with a scripted map in the app (no AI): the child frames sit side by side under Overview and the links run clear of every card. **Not done:** a child canvas, and collapse until opened (still on one canvas; item 6 zoom detail covers it). Gate: typecheck clean, lint has 1 existing warning, 1,043 unit tests pass, local e2e 78/78 | M | The F43 "levels" item, promoted. Biggest win for DEV-01's Structure score |
| ✅ 1b | **"Tidy map" pass — done 2026-09-27 (MCP side; the in-app AI action is not built).** New tool `tidy_map_section` and prompt `tidy_map`. On one accepted section it proposes only: moves (cards laid out again in the agent's `order`, then along the section's own links, as grid/row/column under the title card), dropping links the map drew (`dropLinks`; anything else is reported in `notFound`), and a new parent card (`parent`, or null). It never edits card text. Cards the user moved or locked stay put, and new slots keep clear of them. Staged as a `tidy:<section>` part of the map's pending set, never auto-accepted, one undo step with the rest. The result gives the section's layout score before and after (`improved`). `get_map_status` takes `layout: true` for the whole map's issues by key. **Not built:** moving a card into another section (its content source would change; the writer can't re-home existing objects yet) | M | Also fixed: a re-staged section (tidy, `link_map_nodes`, `remove_map_nodes`) kept its level only by chance — its accepted text has no `parent`; `sectionNow` now restores it from the record |
| ✅ 2 | **Right-angle arrows — done 2026-09-27.** `ai/changes/routing.ts` (pure, with a note crediting Archify's MIT approach): it chooses sides from the clear gap, spreads attachment points on a shared side (16 px gutter, ≤ 14 px apart, ordered by the other end), and puts an unspread end onto its partner's line instead of making a tiny jog. Candidate routes run from straight to midpoint dogleg to early/late turn to outside channel; it takes the first that crosses no unrelated box. `components/canvas/connectorRoutes.ts` writes them as Excalidraw elbow arrows bound at fixed points (`customData.acuteRouted`), with the label on the longest segment. Wired into: the change-set writer (new connectors, plus existing Acute connectors whose ends a set moves), the review preview (same polylines), card auto-resize (re-route, absorbed into history), and the end of a user drag (re-route in the user's own undo step). Arrows the user reshaped (fixed segments) and the user's own arrows are never touched. Tests: `routing.test.ts` (9, incl. 300 connectors among 1,500 boxes < 500 ms), `e2e/local/routing.local.spec.ts` (elbowed, orthogonal, fixed points, 0 crossings, spread into a shared side, drag re-route, one undo). Gate: 1,039 unit, 78/78 local e2e. **Open:** two links into one side can share a corridor for a stretch (needs item 4's corridor check); connectors on canvases made before this stay straight until touched | S–M | Excalidraw re-routes elbows on drag but avoids only the two ends, hence our re-route on drag end |
| 3 | **Node kinds and link variants.** An optional `kind` on map nodes and VisualPlan nodes, from a fixed list, drives card colour and a small icon, with the kind named **on or next to each node**. ~~Automatic legend~~ dropped 2026-09-29: a separate legend adds the split-attention cost the research review warns about (content fidelity plan, Revision 2). Link style comes from what we already have: on the main path → emphasis; async or `derived_from` → dashed; plus security. The link variants for Visualize plans are built in content-fidelity **Wave C**; build them once for both | S–M | Colour always carries meaning, never decoration (Archify's "Semantic Color Rule") |
| ✅ 4 | **Layout checks on every proposal — done 2026-09-27.** `ai/changes/layoutCheck.ts` (pure; codes after Archify's validator, MIT): `link_through_card` (fatal), `links_cross`, `links_share_corridor`, `link_on_frame_border`, `label_collision`, each with subject, evidence and fixes, plus a score for comparing layouts. `ai/changes/proposalGeometry.ts` builds the geometry a set would leave — moves and removals applied, new connectors routed exactly as the writer routes them — and judges only what the set adds or moves. Wired into: every MCP write tool's result (`layout`, and a line in the text), each Repo Map upsert/link result (by map key), `get_map_status` (`layout: true`), and the review bar ("⚠ 1 link crosses a card"). The `map_repo` playbook has the repair loop (fix fatal ones; stop after two re-sends that don't lower `layout.score`). Grid-indexed, so a 1,500-card map stays cheap; routing also got a region prefilter (same routes, fewer tests). Tests: `layoutCheck.test.ts` (7), repo-map and write-tool cases, e2e review-bar case. **Open:** the review ghosts still route around fewer obstacles than the writer, so a preview can differ slightly from what is drawn | M | Moves quality from luck to a gate |
| 5 | **Focus and reach on the canvas.** Selecting a card dims everything but it and its neighbours. A "Show upstream / downstream" action highlights everything connected by links, worded as reach along drawn links, not impact | M | Serves DEV-07 (impact analysis) without claiming code analysis |
| 6 | **Zoom-dependent detail.** Below a zoom threshold, card previews show only the title and one line; full text at normal zoom | S–M | Fixes "101 cards unreadable at 10%" without deleting content. Same item as content-fidelity **Wave D** "overview level" (section cards when zoomed out); build once. **Section level done 2026-09-29** for Visualize frames (`SectionOverview.tsx`); Repo Map frames don't carry `acuteOverview` yet, and per-card detail levels are still open |
| 7 | **Source markers.** A small "SRC" marker on cards with `sourceRefs` (`path#L…@commit`) that opens the file in the editor, or on GitHub when a repo URL is known | S | We already store the refs (F43) |
| 8 | `render_visual_plan` endpoints that reference existing objects or map keys, so traces and plans link into the map | S | From the hono run |

**Exit:** re-run workflow #1 on honojs/hono with the same prompt budget. On the overview canvas: 0 links through cards, crossings ≤ 2, ≤ 12 primary nodes. Then re-score Structure.
| 3 | **CAP-06 finish**: more MCP prompts and a delete tool behind confirmation (L3) | S | `map_repo`, the transport and the tools already exist |
| 4 | **CAP-07 developer templates**: sequence diagram, dependency graph, ERD, component graph | S each | Registry entries (F29) plus layouts. Needs L4's F33 sequence-diagram item |
| 5 | **CAP-03 code-aware follow-ups** on the Repo Map: "trace feature", "impact analysis" tasks, `file:line` links on nodes (`sourceRefs`) | M | The Out-of-scope line in PRD F43 keeps repo reading in the IDE agent |
| 6 | **CAP-09 slice**: ADR and technical-doc generators (DEV-19, EM-06, DEV-10) | M | The rest of CAP-09 arrives in Wave 2 |
| 7 | Hosted developer flow | — | Deferred with deployment (needs C5). Repo Map is **local install only**, and the docs and positioning say so |

**Wave 1 exit:** re-score DEV-01…20 and EM-01…12 using the five dimensions in ICP doc §2.3. Update the `product-positioning.md` Developers row only for what passes.

### Wave 2 — Product managers: "research → PRD → execution"

Killer workflows #9–#12.

| Order | Item | Size |
|---|---|---|
| 1 | **CAP-02 multi-file ingestion** (PDF, DOCX, MD, TXT, HTML, JSON/OpenAPI) as `ContentSource` origins. Keep `origin` open (ICP doc Part 5) | M |
| 2 | **CAP-09 artifact generation**: PRD, brief, meeting brief, report. Writes a Page linked back to its canvas nodes. DOCX/PDF export | M |
| 3 | **CAP-10 structured actions**: RICE/ICE/MoSCoW scoring that writes table columns, 5 whys, generate options that places nodes, custom saved actions | S–M |
| 4 | **CAP-07 PM templates**: 2×2 (impact/effort), journey map, roadmap/swimlane, affinity board | S each |
| 5 | **CAP-11 meeting ingestion** → typed Decision / Assumption / Question / Action objects | M |
| 6 | **CAP-13 slice**: CSV/XLSX → Table (feedback exports, analytics) | S–M |

### Wave 3 — Researchers, consultants, founders: "bring all your sources, and the AI sees all of it"

Killer workflows #6–#8, #13, #14, #16, #17, #19, #20.

| Order | Item | Size |
|---|---|---|
| 1 | **CAP-01 large-context retrieval.** The F22 index already exists. Add chunked retrieval per question, a raised budget for large-context models, and "what was / wasn't included" in the Ask AI panel. The embeddings tier only if measured need | L |
| 2 | **CAP-04 cross-source synthesis with citations**: `extract_themes`, `find_contradictions`, `extract_claims`, `trace_evidence`, `extract_open_questions`, each node linked `derived_from`/`references` to its source | M |
| 3 | **CAP-05 workspace memory**: a lasting summary of goals, decisions and open questions, plus a "Catch me up" action. Follow-ups include memory plus retrieved context | M |
| 4 | **CAP-08 AI-proposed relationships** and "organize selection", plus a backlinks panel | M |
| 5 | **CAP-07 strategy templates**: issue/hypothesis tree, argument map, scenario 2×2, persona/ICP card, business-model canvas, assumption map | S each |
| 6 | **CAP-13 rest**: table formulas (sum, average, weighted score), log and stack-trace parsing | M |
| 7 | **CAP-18 URL capture**, then optional web search | M |

### Wave 4 — Knowledge workers, designers, KM/ops: "your team's and tools' knowledge"

| Order | Item | Size |
|---|---|---|
| 1 | **CAP-16 sharing and collaboration.** Needs the deferred cloud stages (C3–C5 and "Later cloud"): roles, share links, live co-editing, handover | L |
| 2 | **CAP-15 vision**: screenshots, whiteboard photos, design critique. Needs L4 `create_image` and provider capability flags | M |
| 3 | **CAP-14 external connectors** (PRD F24 / Phase 6): GitHub issues/PRs first (DEV-14, EM-08), then Jira/Linear, Drive/OneDrive, Notion, Slack, Figma | M each |
| 4 | **CAP-17 proactive resurfacing** (on top of CAP-01) | S |
| 5 | **CAP-07 remaining templates**: open-questions board, sitemap/IA tree, risk/debt matrix, workshop boards | S each |

### Wave 5 — Students and long-term differentiation (P3)

| Order | Item | Size |
|---|---|---|
| 1 | **CAP-19 understanding layer**: flashcard/quiz blocks and a Learning Path template (Tier B), then the Understanding Graph (Tier C, "AI Phase 6") | M → L |
| 2 | **CAP-20 scheduled / background agents and living documents**: auto-run Update from new content when a connected source changes | L |
| 3 | Enterprise (PRD §13.18 Phase 5, §24 Cloud Phase 5): org AI and MCP policies, provider allowlists, AI audit history, additional adapters (OpenRouter etc.) | L |

---

## Suggested running order (one line each)

0. **L0 first: Visualize result quality** (the user's top priority). Content fidelity Revision 2 (Waves A–E, F2, F3) is done. **Next: the Knowledge Notes plan** (`knowledge-notes-plan.md`, Revision 3), Phase 0 (offline fixes, started 2026-10-19), then Phase 1 (idea fidelity) and Phase 2 (source panel) up to its release gate R1. Existing behaviour stays as it is until R1; citation-based updates stay off until R2.
1. L3: F43 real-client check — Claude Code ✅; VS Code and interactive Claude Code still by hand (user).
2. Wave 1 step 2: score killer workflows #1–#4 on a real repo. Correct the ICP doc and positioning from the results.
3. L1 AI e2e runs and L2 connection validation (whenever the user approves AI spend).
4. **Wave 1** rest: MCP prompts and delete tool → developer templates (with F33 sequence/ER diagrams) → code-aware tasks → ADR/tech docs.
5. **Wave 2** (PM) → **Wave 3** (research/consulting/founders). Wave 4 needs the cloud stages for CAP-16, so it waits for deployment to resume. Wave 5 comes after.
6. Pick up L4 polish items when a wave touches the same code. Pick up F32 only if costs call for it.
7. **Deferred:** cloud deployment (C1 → C3 → C4 → C5; C2 after the repo is on GitHub), when the user picks it back up.

After each wave: re-score the ICP doc's killer workflows (§3.2) and scorecard (§4.12), and move `product-positioning.md` claims from Planned to Built only for what passed.

---

## Deferred — Cloud: live on Firebase App Hosting

**⏸ Deferred (2026-09-27, user): deployment isn't being worked on for now.** It was the top priority earlier the same day. Everything below is kept as it was specified, including the decisions already made, so it can be picked up as is. Until then Acute is a **local install only**, and the docs and positioning say so.

**Goal:** a public URL where anyone can use Acute, and later sign in and get their workspaces back on any device.

This is PRD §24 Cloud Phases 1–2, staged so a usable hosted app ships first. Each stage ships on its own.

**Architecture facts that drive the stages (verified in code):**

- **All user data lives in browser IndexedDB** (`src/persistence/`). A hosted build with no accounts is still a working local-first app: each browser keeps its own data. So hosting can ship before sync.
- **`/api/ai/*` is a Node AI host.** It spawns the Copilot SDK's native CLI through `serverExternalPackages` in `next.config.ts`.
  - Its default is `AI_HOST_MODE=local`, which falls back to the host machine's own signed-in Copilot user (`useLoggedInUser: true`, `CopilotHostRuntime.ts:34`). **The hosted deploy must set `AI_HOST_MODE=server`.** This is a hard requirement (PRD §13.15.13 Mode B, §16).
  - There is no rate limiting on the AI routes today.
- **The MCP bridge is local-only by design.** `relay.ts` rejects non-loopback `Host` and `Origin`. The relay is a per-process `globalThis` singleton, so it can't work across App Hosting's Cloud Run instances. **In hosted mode, MCP access must be hidden.** Hosted MCP arrives only once workspaces live server-side (C5, and PRD F43 "Out of scope").
- **Dev hooks** (`window.__acuteDev`, including `proposeChanges`) turn on in production with `?acuteDev` (`ExcalidrawCanvas.tsx:130`). The hosted build should compile them out.
- **Ollama and other localhost providers** are unreachable from a server host (PRD §13.15.13). Hide them in server mode.

### C1 — Hosted baseline on App Hosting (size S–M) — first step when deployment resumes

Ships: the app at `*.hosted.app`. Data stays in the browser. AI works with the user's own API key.

- [ ] Verify that App Hosting's Next.js adapter supports **Next 16.3** and this repo's Turbopack config. Read the App Hosting docs and `node_modules/next/dist/docs/` deployment guide. Do a throwaway backend deploy before anything else. **If it fails, stop and pick between a Cloud Run + Dockerfile fallback and pinning Next.**
- [ ] Set up the Firebase project on the Blaze plan (App Hosting requires it). Then `firebase init apphosting` and create a backend with `firebase apphosting:backends:create`.
- [ ] Rollout: **local-source deploy through the Firebase CLI** (decided). Don't connect a GitHub repo. Check what the upload contains: `node_modules`, `.next`, `test-results`, `.env.local` and `.playwright-mcp` must stay out.
- [ ] Add `apphosting.yaml`:
  - `runConfig`: `minInstances: 0` to start, `maxInstances`, `concurrency`, and `memoryMiB` sized for the SDK's CLI child processes (measure one). API-key requests also run through `@github/copilot-sdk`, so the CLI still runs even with the Copilot connection removed.
  - `env`: `AI_HOST_MODE=server` (RUNTIME), and `NEXT_PUBLIC_ACUTE_HOSTED=1` (BUILD + RUNTIME) as the client-side hosted flag.
  - Any secret goes in via `secret:` (Cloud Secret Manager), never as a plain value.
- [ ] Add `engines.node` to `package.json`, matching the local Node version.
- [ ] Confirm in build logs that `postinstall` (`patch-package`, Excalidraw asset copy) runs, and that the lockfile resolves the SDK's **Linux** native CLI package. The lockfile was generated on Windows.
- [ ] Add a `hosted` deployment mode, one module, read everywhere through it:
  - Hide ⋮ → MCP access and don't mount `McpBridgeHost`. Make `/api/mcp*` return 404 when hosted.
  - Hide local-transport connections (Ollama).
  - **Remove the GitHub Copilot subscription connection in hosted mode** (decided 2026-09-27). Hosted AI is API key only: Gemini (validated), plus OpenAI, Azure and Anthropic once L2 validates them. Two parts:
    - UI: filter the Copilot descriptor out of AI settings. A saved Copilot connection from an earlier visit doesn't load and is never auto-picked as primary (`resolvePrimary`).
    - Server: when hosted, `/api/ai/*` refuses any request without a BYOK `provider` with a typed error. Relying only on the `AI_HOST_MODE=server` token check isn't enough. Add a `route.test.ts` case.
  - The local install keeps Copilot exactly as it works today.
  - Show the transport line "Requests pass through the Acute-Notes AI host using your credentials" before a key is saved (PRD §13.15.13).
  - Compile out `__acuteDev` and `?acuteDev`.
- [ ] AI route hardening for Mode B (PRD §13.15.13):
  - Same-origin/CSRF check on every `/api/ai/*` route.
  - Per-IP rate limit, starting in memory per instance.
  - Request size caps.
  - Confirm `route.test.ts` covers "no prompt, key or output in logs" in server mode.
- [ ] Add security headers: a CSP that allows Excalidraw, BlockNote, Mermaid and workers, plus `X-Content-Type-Options` and `Referrer-Policy`.
- [ ] Add a privacy note page: content transits the AI host, nothing is stored, keys stay in the browser.
- [ ] Update `product-positioning.md`. The "Bring your own AI" row says "Built for GitHub Copilot only". State it per deployment instead:
  - hosted: your own API key (Gemini validated);
  - local install: Copilot subscription, API key, or Ollama.
- [ ] Smoke e2e against the hosted URL: create a canvas, reload, offline edit, BYOK Test Connection and Visualize with a Gemini key (the one validated API-key connection).
- **Done when:** a stranger can open the URL, draw, reload and keep their work, and run Visualize with their own key. No Copilot option appears, and a hand-made Copilot request to the hosted API is refused. No request is served with the host's own identity. MCP is not reachable.

### C2 — Copilot for hosted users: GitHub OAuth, Mode B (size M) — ⏸ deferred

**Deferred (2026-09-27, user): not in the current plan.** It will be reconsidered once the repo is pushed to GitHub. At that point, settle the app type (GitHub App vs OAuth App, with or without device flow) and the owner (personal account vs organization). Also check whether org Copilot policies block third-party apps. The steps below are kept for then. The running order skips this stage.

Ships: "Connect GitHub Copilot" on the hosted app. This also closes the F27 gap "no real GitHub OAuth flow".

- [ ] Register a GitHub App or OAuth App owned by Acute. **The user has to do this.** Store the client secret in Secret Manager.
- [ ] Add a web OAuth flow in route handlers. The token is held server-side, encrypted with a KMS key, and bound to an HttpOnly session cookie that page scripts can never read (PRD §13.15.13). `disconnect()` revokes it. This depends on C3 for identity, or on a minimal signed session cookie if C2 ships before C3.
- [ ] One Copilot client per user, with an idle timeout. Check memory and concurrency under load.
- [ ] Re-run the F36 contract suite in server mode and add a hosted row to the validation matrix.

### C3 — Accounts: Firebase Authentication (size S–M)

- [ ] Sign in with Google and GitHub through Firebase Auth. **Anonymous use keeps working**, since local-first stays the default.
- [ ] Verify the ID token server-side on every route that touches cloud data (`user → workspace → permission`, PRD §16).
- [ ] User profile. The shell shows the signed-in state.

### C4 — Cloud backup and restore: Cloud Phase 1 (size M)

- [ ] Add `CloudSnapshotRepository` behind the existing repository boundary (PRD §9.1, §25).
  - The workspace snapshot is the existing `.acute.json` bundle (F17). Later it becomes the `.acute.zip` form with assets (PRD §11.4).
  - Snapshots go to **Cloud Storage for Firebase** at `workspaces/{id}/…` (PRD §10.3 key pattern), private.
  - Workspace metadata goes to **Firestore** (`users`, `workspaces`, `members`).
  - Security rules deny by default and are keyed on membership (PRD §14, §16).
- [ ] Add "Back up now", automatic background backup, "Restore on this device", and a list of cloud workspaces.
- [ ] Keep secrets out: BYOK keys, conversations and AI settings are never uploaded (tracker §1). Extend `provenanceGuard` / export tests so the upload payload is checked the same way.
- [ ] Decide whether content sources (F37) are backed up. Today they're device-only, so Update from new content doesn't survive a restore (tracker F37 Notes).

### C5 — Multi-device sync: Cloud Phase 2 (size L)

- [ ] Sync incremental Yjs updates through the existing `SyncProvider` seam (`src/sync/`).
  - **Recommended first transport:** a Firestore per-document update log, with append and `onSnapshot`, plus periodic compaction into a snapshot (PRD §12.3). It needs no WebSocket server.
  - A dedicated WebSocket sync service comes with live collaboration (P2 CAP-16).
- [ ] Offline queue and reconnect. Cover the edge cases in PRD §15 (1–7) with tests.
- [ ] **Unlocks hosted MCP:** once workspaces live server-side, the MCP server can read from the cloud store instead of a tab. That makes Repo Map (F43) work on the hosted app too.

### Later cloud (P2, together with CAP-16)

Cloud Phase 3–5:
- members and roles (Owner / Editor / Viewer);
- presence;
- share links and a public read-only canvas;
- version history, audit, SSO.

Also: a service worker / PWA so a hosted user can open the app offline, not only keep editing after it has loaded.

### Decisions

**Decided (2026-09-27, user):**
1. **Hosted v1 ships without accounts.** C1 uses anonymous, device-local data, and C3 adds sign-in later.
2. **Firestore** holds the metadata, and later the C5 update log.
3. **Deploy from local source with the Firebase CLI. No GitHub connection for now.** C1 uses the CLI's local-source App Hosting deploy (confirm the exact command in the installed `firebase-tools` version). This fits the no-commits rule.

4. **No Copilot subscription on the hosted app for now.** Hosted AI is API key only. C2 and its GitHub app registration are deferred until the repo is on GitHub.
