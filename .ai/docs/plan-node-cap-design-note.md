# Design note: the plan-wide node cap and merged content (for review, nothing implemented)

**Status:** decided 2026-10-11: **keep the current 300-node cap unchanged and defer every alternative budgeting scheme** (section 8). No code for the cap was changed. Evidence: the economy-mode audit (offline layout D world, `src/ai/merge/layoutDReuse.test.ts` fixtures; live Run 3 and Run 4 in `decision-spike/chat-import-live-2026-10-09.md`). Numbers marked *mock* come from that offline world with filler text and are illustrative, not measured on real content.

## 1. The problem

`validateVisualPlan` folds any content node past a limit into "More from this section" pages (`visual-plan/repair.ts` `foldOverflow`, limits in `visual-plan/validate.ts`):

- `MAX_PLAN_NODES` = 60 content nodes per section;
- `MAX_SECTIONED_PLAN_NODES` = 300 content nodes for the whole sectioned plan.

On a merge, `foldOverflow(..., existing)` counts every node already in the notes first, then lets only the new nodes fill what is left (`repair.ts`, the `existing` loop and `fits`). The first import already uses most of the 300: the live first import drew 283 content nodes, and when the stored plan is read back flat, each of its 20 section titles is a heading node that counts too (303). **Capacity for new nodes is therefore zero.** Every new node of every merged section folds into a page, whether the model planned it or economy mode wrote it as a card.

Observed:

| Measure | Value |
|---|---|
| Live Run 4 (economy on) | 466 cards, 12 sections, all folded, reason "plan limit", 12 pages |
| Live Run 3 (economy off) | the review listed "Page: More from this section" nine times; the merge's plan calls cost $0.2095 at list price |
| Mock (economy on) | 479 cards over 17 sections; 0 appear as nodes; 17 pages up to 94 cards each, cards separated by `---` rules |
| Mock (economy off) | 17 appended-text plan calls; the same 17 pages (97 nodes folded into the first, where economy folds 95) |

Consequences: economy mode does not trade analysis for cost, because analysis nodes fold too; AI planning of appended text buys pages, not nodes; a page has the same title ("More from this section") in every frame, and no passage boundaries or source labels.

## 2. The decision

**Should the 300-node cap limit the whole resulting plan, or only what the current operation adds?** These are different products:

- *Whole plan* (today): the canvas never grows past about 300 content nodes; later imports are folded away. Predictable density, but a merge into a full canvas shows nothing new as objects.
- *Per operation / per section*: each import can show its own new content as objects, and the canvas grows with every import. Content is easier to find, density is unbounded unless something else limits it.

Nothing below should be implemented until this is decided.

## 3. Options

Visible-card figures use the mock's per-section numbers (479 economy cards; 17 sections; existing nodes per section 7 to 40, 263 in total) and are estimates.

| Option | What changes in code | Benefit | Risk and limits | Mock result |
|---|---|---|---|---|
| **A. Count only nodes added by the current operation** (plan-wide cap applies to what this merge adds) | `foldOverflow`: do not pre-count `existing` against `caps.sectionedPlan` | New content can appear as cards; the cap stays as a per-operation guard | Canvas can grow without bound across repeated imports (about +300 per import at the cap); the per-section 60 still counts existing nodes, so a 40-node section keeps room for 20 | up to 300 visible at the 300 cap |
| **B. Exclude section-title headings from the count** | the `existing` loop skips the flattened title headings | Recovers 20 nodes of capacity | Does not fix exhaustion: 283 of 300 are content nodes, so only 16 to 17 cards fit | 16 of 479 visible |
| **C. Keep the cap, improve the overflow pages** | no cap change; page title per section ("More from <section>"), passage headings kept as bold lines, no `---` between consecutive related paragraphs | Density stays controlled; no canvas growth; no new risk | Content stays folded and one click away; a 94-card page is still long; economy and AI planning still spend effort on content the canvas folds | 0 visible, better pages |
| **D. Per-section or per-operation budget** (e.g. the 60-per-section limit only, or a fixed number of new nodes per import, or both) | new rule in `foldOverflow`; the plan-wide cap becomes a soft or per-operation one | Most flexible; keeps any one section readable and bounds an import | Needs explicit rules: what a repeated import may add; what happens to a long section (the biggest mock section has 63 cards on 40 existing nodes); whether the budget spans operations | per-section 60 alone: 375 of 479 visible (78%), 3 sections still fold (54, 43 and 7 cards), plan about 679 content nodes; with 300 per operation: 300 visible |

Notes on the table:
- B alone is not a fix. It only helps combined with A or D.
- A and D both change what the stored plan holds. A stored plan is read with `{stored: true}` (no folding), so previously folded pages stay as they are; new nodes would sit beside them.
- C is the only option that needs no product decision about density, and it can ship first and independently.

## 4. Open questions that need an answer before choosing A or D

1. What object count is acceptable on one canvas (render time, scroll, the app's own persistence and sync)? The audit did not measure this: the mock reaches about 680 content nodes under per-section 60. The repository has no stated target.
2. Should repeated imports keep adding visible cards, or should the canvas offer a fold or collapse for older material? (A "More" page is a fold, but with no way back to cards.)
3. Is a verbatim card the right unit for economy content at all? Cards average about 93 characters in Run 4: they may read better as one card per passage than per paragraph.
4. Should the AI path skip planning appended text when the plan has no capacity (it only produces a page), or say so in the notice? Today it pays for plan calls whose nodes all fold.

## 5. Evidence to collect before implementing (offline, no cost)

- Render or object-count check of a 700-node mock canvas in the existing e2e layout tests (local project only, no AI).
- Per-section visible-card counts from the real second-import notes, if a saved final canvas exists (none is saved today).
- Per-section part lists in `MergeDiagnostics`, so a future live run can state exactly which sections folded and why.

## 6. Suggested order (superseded by section 8)

1. Ship C (page titles and structure) and the economy fence fix, which need no decision on density.
2. Decide A, B or D from the answers to section 4.
3. Add the chosen rule with regression tests: capacity for a first import near the cap, a second import, a long section, a repeated identical import (no growth), and a stored plan read back unchanged.

## 7. Recorded lean (not adopted)

A per-section limit (option D with only the 60-per-section rule), keeping a plan-wide ceiling that applies to the new nodes of one operation (option A's guard), would show most content and still bound an import. It depended on the canvas-size answer in section 4.1, which no data in the repository gives. It was not adopted.

## 8. Decision and what was done (2026-10-11)

**Decision.** Retain the current cap for now. Do not add per-operation or per-section budgets: there is no established acceptable canvas density, and changing the cap is not a demonstrated cost-saving measure. Revisit only if real usage shows a significant discoverability problem with folded content (then collect the section 5 evidence first, and answer section 4 before choosing A, B or D).

**Done instead (readability only, no cap, schema or model change):**
- *Page titles.* An overflow page names its section: "More from this section — <label>" (the frame's label for a framed plan; the last heading of the section's first unit for a merge's flat plan, with a split-part or repeat suffix removed; clipped to 120 characters), and "(2 of 3)" when a section needs several pages. A plan without sections keeps the plain title. The old title is the prefix, so anything matching "More from this section" still matches.
- *Fenced code across pages.* Pages are chunked at 20,000 characters (`TEXT_LIMITS.markdown`). The chunking of overflow pages now moves a cut that would fall inside a fenced code block to the last paragraph break before it, so a block is not split across pages. Only overflow pages use this (`chunkText(..., { fenceSafe: true })`); source code chunking is unchanged because code can hold fence-like lines itself.
- *Economy cards* keep fenced code, tables and loose lists whole (see the evidence document).

**Remaining limits.**
- A single code block longer than one page (20,000 characters) is still cut, and each piece is then an unbalanced fence. Fixing that would mean closing and reopening the fence at each cut, which edits the content; not done.
- Other `chunkText` callers (long text nodes split by `repairEntry`, and the long-text split at `repair.ts` line 380) still cut without fence awareness; only overflow pages were in scope.
- **Passage boundaries were not added.** A page joins its cards with `---` rules, and nothing at fold time says which merged passage a card came from: a merge appends a part's blocks to the topic's text without its heading, and economy cards come from the appended paragraphs of the section's merged text. Recovering boundaries would mean writing a marker into the notes text (a content change) or carrying a passage id on each card (a schema change); neither was done.
