# Handoff: Jev picks the conflicting statements in a merge (2026-10-09)

**For:** the session that owns the typed decision path (`assignToTopicsDecision` in `src/ai/merge/assign.ts`, `.ai/docs/decision-models-plan.md`).
**From:** the topic-merge / choices session (G2/G3 in `.ai/docs/chat-share-import-plan.md`). It will not edit `assign.ts` while you work on this.
**Status:** the user approved this change on 2026-10-09 and asked that the owner of the decision path implement it.

## Why

A live comparison on 36 labelled statements (`src/ai/contractTests/mergeJevCompare.contract.test.ts`; results in
`merge-jev-vs-chat-2026-10-09.md` in this folder) compared Jev (`typesafe/jev-1.13`) with the chat model (`gpt-oss-120b`).

| | Jev | gpt-oss-120b |
|---|---|---|
| Relation right (repeats / adds / contradicts) | 100% (36/36) | 97% |
| Hard cases | 100% (20/20) | 95% |
| Contradictions caught | 100% (14/14) | 93% |
| False alarms | 0% | 0% |
| Additions wrongly dropped as "nothing new" | 0% | 0% |
| Correct contradicted sentence | 100% (picked from the topic's sentences) | 93% (quotes were exact, but it missed one contradiction) |
| Time per statement | 0.6 s | 5.5 s |

"Nothing new": Jev's probability was ≤ 0.06 on every addition and ≥ 0.73 on every repeat, so **keep 0.5**. A threshold
of 0.8 would have kept two real repeats.

**Limits:** the cases are self-written, there was a single run, and each test gave one sentence against a known
topic. The next milestone is the full merge on realistic multi-statement content, not more classification tests.

## What to build (approved)

1. **Statements, not parts.** Split each topic's text and each incoming part into stable statement units: sentences,
   list items and table rows. Use ids such as `t3.s2` and `p1.s0`. This avoids classifying a part as one block when
   it both adds something and contradicts something.
2. **Questions for Jev** (when the typed provider is configured):
   - the topic, per part (as now);
   - the relation, per part (repeats / adds / contradicts, as now);
   - nothing new (as now, at 0.5; make the threshold an internal constant);
   - for a likely contradiction:
     - **which topic statement** it contradicts, as a choice over that topic's statement ids plus `none`;
     - **which incoming statement** says it, as a choice over the part's statement ids.
3. **Validate.** Both ids must exist in the statement lists built in step 1. Turn them into
   `Conflict { about, topicSays, partSays }` using the **exact statement text**, so the existing `verbatim` check
   passes by construction.
   - `about`: Jev can't write free text, so use the topic's label (for example "Pricing: which is current?").
4. **Then the existing pipeline, unchanged.** `validateAssignment` returns `conflicts` as today; `composeMerged`
   writes the `[!choice]` callout; `withChoiceNodes` draws the box. Return the conflicts in the same reply shape as
   the chat path, `{ assignments: [{ part, topic, conflicts: [...] }] }`. Then `interpret` no longer steps aside for
   contradictions.
5. **Fallback.** If Jev fails, returns ids that aren't in the lists, or is unsure (low confidence on the topic or the
   statements), keep the current behaviour: hand the merge to the chat task, which quotes, and code checks the quotes
   word for word. Never drop content on an uncertain answer.
6. **Users without Jev:** nothing changes.

## Code the other session owns (please don't change its behaviour)

- `src/ai/merge/compose.ts` (`composeMerged`: `conflicts`, `from`, choice callouts, the repeat checks)
- `src/ai/merge/merge.ts` (`mergeIntoSource`, notices)
- `src/ai/history/*` (choices: the callout format and how they're drawn)
- `validateAssignment(...).conflicts` and `verbatim` in `assign.ts`: the reply shape and checks the chat path relies on.

## Checks before calling it done

- typecheck, lint, `npx vitest run`;
- `src/ai/merge/*.test.ts` and `src/ai/history/*.test.ts` unchanged and passing;
- `mergeJevCompare` / `mergeConflictSpike` contract tests;
- a live run of `e2e/ai/choices.spec.ts` with Jev configured. With `--provider=aicredits` it runs without Jev, which
  covers the fallback;
- a full merge on **realistic multi-statement content**: a part that adds one fact and contradicts another; two
  plausible topics.
