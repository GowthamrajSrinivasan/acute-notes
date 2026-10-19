# Orphan planning after the regenerated sections' replies — design (offline, not implemented)

Status: Option C (no margin) implemented offline 2026-10-11 in `update.ts`, tests in `merge/capacitySkip.test.ts` (57 pass); not run live. Original status: proposal for review. Evidence: run 6 (`decision-spike/data/benchmark-2026-10-11-run6-recheck.stats.jsonl`, end of `decision-spike/chat-import-live-2026-10-09.md`) and two offline replays described below.

## The problem in one paragraph

In an economy, append-only merge, `updateOutlined` asks the model for every changed section in one `Promise.all`: sections with a stored representation that were edited ("regenerated"), and "orphans" (units whose first-import nodes were folded into pages, so no stored nodes). An orphan that only had paragraphs appended is skipped, as verbatim cards, when the first capacity check says the plan is full (`noRoom && orphan`). That check runs before any reply and is a lower bound: it cannot count the nodes a regenerated section will return. In run 6 it counted 241 against a real 320 (the regenerated sections' 29 + 47 nodes and 3 titles), said `room`, and all 7 orphans were planned (28.5k input, 19.3k output tokens, about $0.057 at list) and every node they returned was folded into pages (overflow "plan limit" for all seven; the recheck proved the plan was full at 320). The recheck itself worked: exact count, one new section skipped.

## What the code does today (exact)

`update.ts`, `updateOutlined`:
1. `reps[i]` = stored representation of changed section `i` (null for an orphan or a new unit).
2. `noRoom` = first check (`everyAddedNodeFolds`, lower bound; unchanged sections + pure-append sections + their titles).
3. One `Promise.all` over all changed sections. Per section: an economy append (`reps[i]`) or a skipped orphan (`noRoom && orphan`, pure append only) returns verbatim cards without a call; everything else is a `generateSection` call. An orphan that is not a pure append is always planned (nothing to skip to).
4. Replies are merged (`keptReply` -> `mergeUnitPlans` -> `wrapSections`), then the `added` path asks the recheck (`planIsFull`).

Run 6 timing (trace): 9 plan calls started at t=106 s, six at once (concurrency 6), the rest as slots freed; the two regenerated calls ended at +5.9 s and +16.6 s; the seven orphan calls took 8.3 to 19.0 s; the phase ended at +25 s. The orphan calls shared the six slots with the regenerated ones.

## Why a deterministic rule (option B) cannot be proven safe

To skip an orphan safely the merge must know that every node the model would plan for it is folded. That needs: existing nodes counted by the fold + new nodes already kept >= 300. Before the replies the only certain contribution is the lower bound the first check already uses (241). A regenerated section can return fewer nodes than it had (the model may drop or merge them; a node it drops is not in the fold's input), so its old node count (29 + 47) is an expectation, not a floor. Its titles can be missing too. There is no deterministic floor, so any rule that skips on the expectation can skip when the plan has room: the orphan would then be added as verbatim cards (no loss of text), but the structured placement the user is owed would be suppressed. Option B as a proof does not exist; B as a heuristic is only acceptable with a check after the replies, which is option C below.

## Options compared

| | A: always wait | B: heuristic, no check | C: hold only when the expectation says full, verify after |
|---|---|---|---|
| Decision | exact, same as the recheck | unproven (can skip with room) | exact: identical to A for held orphans, identical to today otherwise |
| Never suppresses structure | yes | no | yes (fallback plans them, late) |
| Latency, expectation holds | +up to the regenerated phase (run 6: orphan calls start at +16.6 s instead of +0 s) when they are still needed; none when skipped | none | **less** (run 6: the phase ends at about +16.6 s instead of +25 s, orphans are not called) |
| Latency, expectation fails (reply smaller) | same as A | none, but wrong | like A: orphans start at the end of the regenerated replies (about +16.6 s later, run 6 shape) |
| Latency, plan clearly has room (expectation < cap) | like A: slower for nothing | none | none (orphans start at once, as today) |
| Savings | up to the orphan calls | up to the orphan calls | up to the orphan calls |

Recommendation: **C**. A would slow every merge that has a regenerated section and any orphan, including the ones that need planning. C pays latency only when its expectation fails.

## Option C

Hold an orphan call only when all of these hold: economy and append-only; the orphan is a pure append (`appendedParagraphs` is non-null: only then can it be skipped); there is at least one regenerated section (`reps[i]` and not a pure append) whose reply is not yet in; and the expectation is `counted + sum(old nodes of regenerated sections) >= cap` (run 6: 241 + 76 = 317). Orphans that fail any condition start at once as today.

Held orphans wait for the other changed sections' replies, assemble the plan so far exactly as the final plan will be (same `keptReply`, `mergeUnitPlans`, `wrapSections`, so titles are re-made), and ask `planIsFull`. Full: cards, `planSkips` path `orphan`. Room: the orphan is planned now (late). Nothing else changes: the cap, economy defaults, the `added` recheck and the existing diagnostics stay as they are.

### Call flow

- Today: regenerated and orphans all in parallel (concurrency 6); recheck after all replies; `added` path.
- Option C, expectation holds: regenerated sections only (parallel), then recheck for orphans and for `added` (one `planIsFull` each, or one shared); no orphan calls. Critical path = longest regenerated call (run 6: 16.6 s, was about 25 s).
- Option C, expectation fails: regenerated in parallel; at the last reply the orphans start in parallel; critical path = regenerated + longest orphan.
- Orphans not held (not pure append, or the expectation says room): as today.

### Offline evidence

1. Run 6 arithmetic replay (record only; the trace holds token counts and timings, not texts or replies, so a full replay is not possible): expectation 241 + 76 = 317 >= 300, so the orphans are held; the recheck count after the replies is 320 >= 300, so they are skipped. All 7 calls avoided.
2. Mock reproduction of the mechanism (edited section + pure-append orphan + new section, first imports of 280 to 286 nodes, `capacitySkip.test.ts` world): the orphan is planned and 20 to 22 of its nodes are folded in every case, the first check says `room` (290 to 297), the recheck says `folds` with a count equal to the real fold's (299 to 306). So the waste appears offline too.
3. Synthetic matrix on the real `planIsFull` (two regenerated sections with 29 + 47 old nodes, first reply = n nodes, titles re-made; existing counted by key):

| unchanged nodes | regenerated reply | expectation | actual existing after replies | plan full |
|---|---|---|---|---|
| 241 | one node each | 317 | 245 | no (room) |
| 241 | half | 317 | 280 | no |
| 241 | same | 317 | 319 | yes |
| 241 | double | 317 | 319 | yes |
| 230 | same / double | 306 | 308 | yes |
| 230 | none or half | 306 | 234 / 269 | no |
| 200 | same | 276 | 278 | no (expectation < cap: orphans start at once) |
| 200 | double | 276 | 278 | yes (new nodes fill the plan; orphans already started) |

The expectation is a lower bound of the post-reply existing count when replies keep their nodes, and above it when they shrink; the verification after the replies is what makes the decision exact in both cases.

## Correctness invariants (each needs a test)

- No source text is dropped: a skipped orphan's appended paragraphs are added verbatim (`economyCards`), as today; a held orphan that is planned late produces exactly what it would have today.
- No existing content is overwritten: cards fold into section-scoped pages (`more~<section>~N`), existing keys untouched (existing regression tests).
- The skip never suppresses planning when the plan has room: the skip decision after the hold is the exact `planIsFull` of the plan the merge will validate; a hold is only a delay.
- A failed or aborted regenerated reply: the existing `failures` throw happens before the held orphans resume; the hold must not leave an unhandled rejection or a call in flight after an abort.
- Economy off, or not append-only: no hold, no new field.

## Cost and latency (estimates, not guarantees)

- Potential saving: the seven observed orphan calls were $0.0568 at list (billed was within 0.1% of list this run). That is an upper bound for run 6 and only for orphans that are pure appends: the trace does not say how many of the seven were (the diagnostics do not record it; add `pureAppend`). Run 5's merge had 8 such calls (about $0.04 of its $0.049 merge plan list), so 15 to 20 percent of a run is the right scale. One run each; the model's output size varied by 30 to 60 percent between runs 4 to 6.
- Latency: expectation holds: about 8 s shorter merge plan phase (run 6: 25 s to about 17 s, because the orphans no longer share the six slots). Expectation fails, or a hold that ends in planning: about +16 s on that phase (the regenerated phase). No latency change when the expectation says room or there is no regenerated section.

## Minimal change

Files:
- `src/ai/reconcile/update.ts`: compute the expectation and the hold set; split the `Promise.all` into regenerated and held orphans; factor the assembly of the plan-so-far (replies -> `keptReply` -> `mergeUnitPlans` -> `wrapSections`) so the hold check and the final assembly share it; held orphans use `planIsFull` on `[...reused, ...assembled.nodes]`.
- `src/ai/reconcile/capacity.ts`: no change (reuse `planIsFull`).
- `src/ai/merge/merge.ts`, `compose.ts`: no change (the capacity record is passed through; notices already say "plan limit is full").
- Tests: `src/ai/merge/capacitySkip.test.ts`.
- Docs: this note and the evidence doc.

New diagnostics (all inside `capacity`, present only when it is): `orphans: { eligible: number; pureAppend: number; held: number; skipped: number; plannedAfterHold: number; expectation: number; heldMs: number }`.

Tests to add: the matrix above through `updateFromNewContent` (regenerated grows, shrinks, returns one node; orphan fits or overflows; held and skipped, held and planned late, not held); title re-creation counted after the replies; repeated import (identical text: no changed sections, no capacity record, no calls); failure and abort during the hold; economy off unchanged; calls counted (held and skipped: no orphan call; held and room: one late call per orphan; expectation room: parallel as today); the 300 cap, economy defaults and skip scope unchanged (existing 48 tests keep passing).

## Open questions for review

1. Is a one-regenerated-section-phase delay acceptable when the expectation fails (about +16 s in the run 6 shape)? Alternative: hold only when the expectation clears the cap by a margin (for example 5 percent), which makes a failed hold rarer but misses marginal savings.
2. Add `pureAppend` per orphan to the diagnostics before any live run so the saving can be stated rather than estimated.
3. Should the post-hold check also be used for orphans that are not pure appends? It cannot skip them (nothing to skip to), so no.


## Implemented (offline, 2026-10-11)

`updateOutlined` holds a pure-append orphan only when the economy and append-only check ran, the first check was not already full, a regenerated section is outstanding and `counted + regenerated sections' previous nodes >= 300` (no margin). Held orphans wait for every other reply, the plan so far is assembled with the same code as the final plan and asked of `planIsFull`; full: the orphan is added as verbatim cards (`planSkips` path `orphan`); otherwise (room, unsupported, or any error while checking) it is planned then. A failed or aborted reply stops the update before a held orphan is asked. Diagnostics inside `capacity`: `orphans[]` (`pureAppend`, `held`, `outcome`: `skipped`, `skipped_after_hold`, `planned`, `planned_after_hold`), `orphanExpectation`, and `hold` (`held`, `expectation`, `heldMs`, the check and the node count it saw) only when something was held.

### Failure semantics (reviewed offline, 2026-10-11)

`generateSection` never rejects on a non-fatal provider error: it records a warning and `updateOutlined` throws all of them together after the step (`failures.join(" ")`). Fatal errors (AbortError, AIError `cancelled`, no provider configured) reject at once. With the hold, calls in the same step still report every failure. The single difference: when a regenerated call fails while an orphan is held, the orphan is never asked, so its would-be failure message is absent (previously it was asked in parallel, was billed, and could add its own message). The update fails either way, with the regenerated section's message. That is intentional: no spend on an update that already failed. Cancellation is unchanged: an abort before the held orphans start throws the same abort-class error (`isFatalAIError`) and the orphans are not asked. Tests: `capacitySkip.test.ts`, "failure semantics" (5). Run against the reconstructed previous code, four pass and the one that asserts the absent message fails, as expected.

The code change as a diff against the previous code, reconstructed from this session's record of the file (the previous code plus the earlier 48 tests were run and pass): `decision-spike/data/orphan-hold-update-2026-10-11.diff`.
