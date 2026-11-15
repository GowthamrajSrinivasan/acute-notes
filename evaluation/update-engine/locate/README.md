# Locate evaluation set (Stage 5f)

"Where does this new information go, and what edit is it?" — measured on canvases of sections and cards. Plan:
`.ai/docs/intelligent-update-engine-plan.md` §13.6, §13.11. Code: `src/ai/router/locateEvaluation.ts` (schema, canvas
builder, predictors, scorer), tests in `locateEvaluation.test.ts`.

| File | What it is |
|---|---|
| `dev.json` | 5 canvases, 60 cases. **Tune on this only.** Written blind by an isolated agent (no repository access). |
| `heldout.json` | 4 canvases, 40 cases, different subjects, a second isolated author. **Sealed:** SHA-256 `bf726cbe…` pinned in `locateEvaluation.test.ts`; never scored in the default test run; never edited. Score it once, for a decision, and record that it was used. |
| `labels-blind.json` | A third isolated agent's labels for all 100 cases, from the canvases and note text only (no answers). Used to measure agreement; disagreements go to the user. |
| `label-comparison.md` | Author vs blind labeller, case by case. |
| `baseline-dev.md` | Today's Stage 2 router on dev (`UPDATE_LOCATE_REPORT=1`). |
| `rankers-dev.md` | The hashed embedder and MiniLM-L6 as pure rankers on dev (`EMBEDDING_SPIKE=1 UPDATE_LOCATE_REPORT=1`). |
| `adjudications-dev.json` | Decisions on dev label differences, applied over `dev.json` at load (the split is never edited). D019 → `cell` (review rule: smallest edit). |
| `descent-dev.md` | The 5b–5c prototype on dev: hashed, MiniLM-L6 at defaults, and the best of a settings search on dev (`EMBEDDING_SPIKE=1 UPDATE_LOCATE_REPORT=1`). Plan §13.13. |

**Scoring note:** "placed" (end to end: destination, action and anchor) is the headline metric. "Insert after the
last item" counts as "append" for both expected and predicted answers — they are the same edit.

**A case:** the canvas, the note's text, and `expected` = card, section, action, item (0-based list/todo item, table
data row, or text-card sentence), column, row, relation. `acceptable` holds other right answers; `ambiguous` marks a
case that could genuinely go to two places (its `expected` keeps the likelier real action). `trap` is a wrong card
that shares two or more words with the note; `overlap` is "low" when the note shares at most one content word with its
expected card.

**Actions:** `replace_item` (SUPERSEDES / EXTENDS / CONTRADICTS), `after_item`, `append`, `table_row`, `cell`,
`duplicate`, `new_block` (right section, no card fits), `new_section` (fits nowhere). A predictor may also answer
`clarify`.

**Metrics, never blended:** section · found@1 / found@3 (the expected card is the predictor's top / in its top three —
retrieval) · into card · action · item · nowhere · duplicate · trapped (lower is better). Every rate is printed with
its numerator and denominator, overall, by overlap and by expected action.

**Edits after authoring (dev only):** the brief contradicted itself on "clarify" (an action count *and* the likelier
real action in `expected`). The held-out author kept the real action and marked the case ambiguous; the dev author
wrote "clarify" and put the real action in `why`. Dev's five cases (D007, D020, D031, D042, D056) were changed to the
real action named in their own `why`, so both splits follow one convention; `problemsOf` now rejects "clarify" as
an expected action. Nothing else was changed.
