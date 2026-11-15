# Knowledge Notes: first live runs (2026-10-19)

Approved by the user in chat on 2026-10-19 ("proceed with running live tests using openrouter credentials"), with a
cap of **$2.00**. Plan: [knowledge-notes-plan.md](./knowledge-notes-plan.md) §7.3, §9, §11.0 (S1.8 / C1c, S2.6).
Lanes log: [knowledge-notes-lanes.md](./knowledge-notes-lanes.md).

**Short version.** Everything planned ran, for **$1.12** of the $2.00. Distil mode passes its own gates (G1, G3, G4)
on all 7 fixtures, 3 runs each, with no failures or timeouts. The independent golden assertions disagree: distil
fails 12 of 13 golden cases on gate 1 (knowledge), and in several it does worse than preserve. The pipeline marks a
unit Represented when a card cites it. It doesn't check that the card kept the unit's caveat or condition, because
the model check is off (OD5b pending). So the C1c gates don't show that the meaning was kept, and **R1 isn't
supported by this evidence yet**.

## Setup

| | |
|---|---|
| Connection | OpenRouter (`--provider=openrouter`), key from `.env.local` |
| Model | `google/gemini-2.5-flash`, the same for every call (`ACUTE_TEST_OPENROUTER_MODEL`). The `.env.local` default `openrouter/free` wasn't used |
| Decision model | none. `ACUTE_AI_DECISION_MODEL`, `_CONNECTION` and `_KIND` were set empty, so `.env.local`'s aicredits decision model was never applied. No Jev or typed decision model. No spec needed one |
| Model check | off (`semanticCheck.enabled: false`; OD5b not approved), so "Checked by AI" is 0 everywhere |
| Meaning rules | hints only (they count as "Hinted"; they never put a card in Needs review) |
| Readability judge (G8) | **not run: it isn't built** |
| Playwright | `--trace off`, own `--output test-results/live-*`; one dev server (`npm run dev`, :3000) started for the session and stopped at the end; no other session had one up (lanes file) |
| Tree | `git-66f7e3b-dirty` (the uncommitted Knowledge Notes work), app 0.1.0 |

## Cost

The specs record token usage per call (`/api/ai/run` → `usage`). OpenRouter doesn't return a cost per call here,
and `fidelity.spec` has no price on file for this model. So the cost below is **estimated from tokens** at
gemini-2.5-flash prices: $0.30 per 1M input tokens and $2.50 per 1M output tokens. Every call reported
`reasoningTokens: 0`.

| Step | What ran | Calls | Prompt tokens | Completion tokens | Estimated cost |
|---|---|---|---|---|---|
| 1 Probe | fixture 10, distil, 1 run | 6 | 18,462 | 2,401 | $0.0115 |
| 2 C1c | fixtures 4–10, distil, 3 runs each (21 runs) | 132 | 502,727 | 58,634 | $0.2974 |
| 3a Golden distil | 13 cases, 1 attempt | 164 | 577,863 | 126,073 | $0.4885 |
| 3a′ Golden distil, kn-12 again | kn-12 only, after a recorder fix (see Failures) | 21 | 69,762 | 12,923 | $0.0532 |
| 3b Golden preserve | 13 cases, 1 attempt | 121 | 392,275 | 61,242 | $0.2708 |
| Preflight ×12 | one-word request per invocation | 12 | ~20 each | ~1 each | < $0.001 |
| **Total** | | | | | **$1.121** |

**OpenRouter key balance (`GET /api/v1/key`, `limit_remaining`)**

| When (UTC) | Balance | Change since the start |
|---|---|---|
| 2026-10-19 18:33 (before the first run) | $3.5451 | |
| 19:12 (just after the last run, dev server stopped) | $2.4277 | $1.1174 |
| 19:19 (settled: unchanged at 19:12, 19:15 and 19:19) | $2.4277 | **$1.1174** |

The balance matches the token estimate to within half a cent. The balance had already caught up a minute after each step.

## Step 1: probe (fixture 10, 1 run)

The smallest fixture: 539 bytes. It made 6 calls (outline, 4 sections, analysis), took 22 s, and cost $0.0115. The run passed
G1, G3 and G4: 9 units, all Represented; 13 cards, 0 in Needs review. From the probe's tokens, step 2 was projected at
about $0.3 and step 3 at about $0.5 per recording. Both fit, so step 2 ran at the full 3 runs. A copy of the probe's
artefacts is in `test-results/live-step1/probe/`, because step 2 overwrote that fixture's folder.

## Step 2: C1c (S1.8). Fixtures 4–10, distil, 3 runs each

Each fixture ran on its own (`-g "Fixture.N.—"`, so fixtures 1–3 and the four older "Example" cases didn't run). The
spec is `mode: "serial"`, so one fixture's gate failure would otherwise skip the rest. **21 of 21 runs passed. There
were no timeouts and no schema or UI failures.** Each run took 10–21 s.
The artefacts are in `.ai/docs/fidelity-runs/2026-10-19-distil/<fixture>/` (`run-N/` has the screenshots, `report.json`,
`report-v2.json`, `run.json` and `ai-replies.json`; each fixture also has `summary-v2.md`). They take about 19 MB, mostly screenshots,
and are uncommitted.

Report v2, the median and worst of the 3 runs. "Critical" is the pipeline's own count of critical units; "exact" is the
manifest's protected details.

| # | Fixture | Units | Represented / Omitted / Needs review (median; worst) | Critical units handled (every run) | Exact details kept (every run) | Cards in Needs review: median (worst) | G1 | G3 | G4 | Canvas words % of source: median (worst) |
|---|---|---|---|---|---|---|---|---|---|---|
| 4 | Hedged prose (hybrid search) | 10 | 10 / 0 / 0; same | 9 of 9 | 3 of 3 | 0% (0%) | met | met | met | 205 (210) |
| 5 | Docs with code and config | 9 | 9 / 0 / 0; same | 7 of 7 | 4 of 4 | 0% (0%) | met | met | met | 287 (363) |
| 6 | Compound caveats and causes | 7 | 7 / 0 / 0; same | 7 of 7 | 2 of 2 | 12.5% (28.6%) | met | met | met | 265 (305) |
| 7 | Meeting notes, action items | 11 | 10 / 1 / 0; same | 7 of 7 | 5 of 5 | 0% (0%) | met | met | met | 241 (253) |
| 8 | Trade-off argument | 8 | 8 / 0 / 0; same | 7 of 7 | 1 of 1 | 0% (0%) | met | met | met | 220 (247) |
| 9 | Chat reply (synthetic) | 12 | 10 / 1 / 1; same | 10 of 10 (1 caught, in Needs review) | 1 of 1 | 0% (0%) | met | met | met | 224 (232) |
| 10 | Update series, v1 | 9 | 9 / 0 / 0; same | 3 of 3 | 3 of 3 | 0% (0%) | met | met | met | 291 (300) |

Notes on the results:

- **Needs review almost never fires.** Only fixture 6 put cards in Needs review: 2, 1 and 0 cards in its three runs,
  each because the card cites no passage (`uncited_card`). With the model check off, nothing judges whether a card
  kept the meaning. The meaning rules gave 1–9 "Hinted" cards per run, which are hints only. So G1 is "met" mostly
  because no checker that could flag a card was running. **G2 (planted distortions in fixtures 4, 6 and 8 flagged
  every run) can't be measured in this setup.**
- **Omissions:** fixture 7 dropped "Thanks everyone, see you next week." as filler (correct). Fixture 9 dropped
  "Great question!" (correct) and "Hope this helps — let me know if you want a sample consumer!", as filler in two runs and meta in one.
  The accounting marks that sign-off line **critical** ("carries a condition", from the word "if"), so all three runs
  raise a `critical_omitted` flag and put the unit in Needs review. This is a **false critical alarm** on filler. It is
  caught rather than silent, so G3 holds, but the critical-unit cue is too broad. The pipeline also marks 9 of 10 units
  critical in fixture 4 and 7 of 7 in fixture 6.
- **Canvas words are 2–3.6× the source's words** on every fixture (median 205–291%). That's far above the 70% alarm
  (§9: observed, not gated). Part of it is fixed overhead on tiny sources (90–150 words): frame titles, section names,
  the analysis cards, and cards with a title plus a body. Still, distil wrote more words than the source on every run,
  which works against "ideas over words". It needs a look on a long source before R1.
- Word coverage (the preserve-era score, a diagnostic only): 68–96% of source words appear on the canvas (fixture 9
  68%, fixture 8 71%).

## Step 3: golden baseline recordings (gate: false)

`GOLDEN_RECORD_ATTEMPTS=1`, approved by "Gowthamraj Srinivasan (chat, 2026-10-19)". The replay is offline
(`npm run test:golden`, then `UPDATE_GOLDEN=1 npm run test:golden`): **6 files, 349 passed, 1 skipped**, and
`evaluation/knowledge-notes/reports/gates.md` was regenerated. Recordings are report-only (`gate: false`), so case
failures don't fail the suite. All 13 cases recorded in both modes, with no Visualize failures.

| Run directory | noteModel | Cases | Cost |
|---|---|---|---|
| `recordings/2026-10-19-distil-gemini-flash/` | distil | 13 | $0.4885 |
| `recordings/2026-10-19-distil-gemini-flash-kn12/` | distil | kn-12 only (the user's edit applied; see Failures) | $0.0532 |
| `recordings/2026-10-19-preserve-gemini-flash/` | preserve | 13 | $0.2708 |

Golden gates per case. Each cell is passed / evaluated assertions, with the critical failures in brackets. Gate 1
(knowledge) for distil includes the extra checks read from the run's own output (cites, accounting, review), so its
totals differ a little from preserve's.

| Case | Distil G1 | Distil G2 | Distil G3 | Preserve G1 | Preserve G2 | Preserve G3 |
|---|---|---|---|---|---|---|
| kn-01 idempotency keys | **PASS** 11/11 | PASS 7/8 | PASS 5/5 | **PASS** 9/9 | PASS 7/8 | PASS 5/5 |
| kn-02 edge cache invalidation | FAIL 19/26 (6) | PASS 21/30 | PASS 7/9 | FAIL 22/24 (1) | PASS 21/30 | PASS 7/9 |
| kn-03 blue-green deploy | FAIL 25/33 (6) | FAIL 26/41 (5) | PASS 8/9 | FAIL 27/31 (4) | FAIL 28/41 (5) | PASS 8/9 |
| kn-04 queue choice | FAIL 12/25 (12) | FAIL 15/24 (3) | PASS 7/8 | FAIL 15/23 (8) | FAIL 15/24 (3) | PASS 8/8 |
| kn-05 incident review meeting | FAIL 19/26 (7) | FAIL 10/26 (3) | PASS 5/8 | FAIL 13/24 (11) | FAIL 12/26 (2) | PASS 5/8 |
| kn-06 hybrid search reranking | FAIL 25/33 (4) | FAIL 21/27 (2) | PASS 8/9 | **PASS** 30/30 | FAIL 19/27 (2) | FAIL 6/9 (1) |
| kn-07 photo sharing HLD | FAIL 19/27 (5) | FAIL 33/100 (23) | PASS 7/9 | FAIL 13/25 (8) | FAIL 28/100 (21) | FAIL 8/9 (1) |
| kn-08 helpdesk HLD/LLD | FAIL 5/21 (14) | FAIL 13/127 (37) | PASS 7/9 | FAIL 7/20 (11) | FAIL 21/127 (34) | PASS 8/9 |
| kn-09 billing codebase map | FAIL 10/40 (17) | FAIL 10/29 (7) | PASS 5/7 | FAIL 17/37 (8) | FAIL 9/29 (6) | PASS 5/7 |
| kn-10 inventory architecture | FAIL 12/28 (7) | FAIL 22/62 (10) | FAIL 6/9 (1) | FAIL 11/26 (6) | FAIL 28/62 (4) | PASS 7/9 |
| kn-11 ambiguous analytics proposal | FAIL 15/37 (17) | FAIL 10/30 (1) | PASS 5/7 | FAIL 14/34 (15) | FAIL 10/30 (1) | PASS 5/7 |
| kn-12 flag rollout update (first run: edit **not** applied) | FAIL 15/19 (3) | FAIL 7/9 (1) | PASS 5/6 | | | |
| kn-12 flag rollout update (edit applied) | FAIL 11/19 (6) | FAIL 7/9 (1) | PASS 6/6 | FAIL 16/17 (1) | FAIL 6/9 (1) | PASS 5/6 |
| kn-13 connection-pool runbook | FAIL 32/33 (1) | PASS 12/13 | PASS 4/5 | **PASS** 31/31 | PASS 10/13 | PASS 5/5 |
| **Cases passing** | **1 of 13** | 3 of 13 | 12 of 13 | **3 of 13** | 3 of 13 | 11 of 13 |

The hand-written references pass every gate (the baseline section of `gates.md`), so the checks themselves can be
satisfied.

What the failures are. These are counts of gate-1 critical failures: 91 for distil and 71 for preserve.

- **"Element not found"** (distil 47, preserve 45): no card on the canvas matched the case's `match` rules for an
  expected idea. Some of these are real losses. Some come from distil splitting one idea into several small cards
  (kn-12's kill-switch section became 7 cards). Either way, an assertion keyed to one element can't find it. Only a
  person reviewing these can tell which is which. The cases are **model-reviewed drafts, not approved** (Lane J).
- **"Missing text"** (distil 33, preserve 25): the card for the idea exists but has lost the caveat, condition or
  figure the case calls critical. For example, kn-02 lost "the stale window limits the TTL claim" and "the 60 s
  stale bound"; kn-05 lost the incident figures "16:40, 47 minutes, 2300", and Leila's March 21 deadline.
  **This is the finding that matters for R1.** In the same distil runs, the pipeline's own accounting reports those
  units as Represented: a card cites them, and nothing checks what the card says.
- Run-output checks (distil only): **citations point at the wrong passage, or at nothing**. kn-08: 4 of 6 checked
  cards (for example, e.console cites u18 where u3 is its passage). kn-10: 3 of 9. kn-05: 3 decision cards cite
  nothing. kn-04, kn-12 and kn-13: 1 each. Wrong citations break the source chip promise (G5) on real output, even
  though U1–U5 pass with the mock AI. **Units that may not be omitted were omitted** (`units_accounted`): kn-05's
  decisions u26, u47 and u48; kn-04 u41; kn-09 u15. kn-03 has a unit-text mismatch. **Critical units were not put in Needs review** (`review_flagged`):
  12 in kn-11 and 6 in kn-09.
- kn-11, both modes: a card states one value where the source contradicts itself (hourly vs real-time; 30 vs 90
  days). The contradiction is resolved silently.
- **Distil vs preserve on gate 1** (share of assertions passed): distil is worse on 7 cases: kn-02, kn-03, kn-04,
  kn-06 (preserve passes), kn-08, kn-09 and kn-13 (preserve passes; distil fails on one uncited card). Distil is
  better on kn-05 and kn-07, and about the same on kn-10 and kn-11. Distil passes 1 case; preserve passes 3.
- Gate 3 (layout) is mostly fine in both modes. Distil fails on kn-10 (1 critical), and preserve on kn-06 and kn-07.
  Link crossings over the cap are common in both modes (up to 31 in kn-13 distil).
- kn-12 update case, distil with the edit applied: the user's "Runbook RB-12" line survives in the final scene.
  But the element the case matches as `e.kill-switch` came back `update_clean` where `unchanged/update_conflict` is
  expected. The stages, canary and advance-gate items came out as add/remove churn instead of `unchanged` or
  `update_clean` (6 critical). In preserve, the only update failure is that `i.cleanup` isn't removed.

## Failures and fixes

1. **Recorder bug (fixed in `e2e/ai/recordGolden.spec.ts`; test harness only).** The update case (kn-12) applies
   the user's edit to the card whose text contains the source's wording. On a real model, no card keeps the
   wording in either mode, distil or preserve. The edit was silently skipped (meta note "user edit not applied"),
   and the case then measured an update with no user edit. Fix: when no block holds the wording, `applyUserEdit`
   appends the edit to the card that shares the most content words with it (at least 4). The meta note says so
   ("user edit applied to the card sharing the most words…"). `tsc` is clean and eslint is clean. kn-12 was re-recorded in distil
   in its own new run directory (`…-distil-gemini-flash-kn12`, $0.053), because a recording is never re-recorded
   over. The preserve recording already used the fix. The first distil directory keeps its kn-12 with the note, and
   its result is reported but superseded.
2. `fidelity.spec` runs its cases in serial mode, so one fixture failing its gates would skip the others. Each
   fixture ran in its own invocation. No change was needed.
3. Nothing else broke: no timeouts, schema failures or UI steps the recorder couldn't do.

Not run: the readability judge (G8) isn't built. Fixtures 1–3 and the older examples weren't part of C1c. There is
no repeat of the golden recordings (`ATTEMPTS=1`; the release gates want 3).

## What this means for R1

- **G3 and G4 hold on all 21 runs**, measured by the pipeline's own accounting: no critical unit silently omitted,
  and no exact detail missing at the end. G1 holds (median Needs-review share 0–12.5%), but only because no checker
  that could flag a card ran (the model check is off).
- The **independent golden check says otherwise.** Critical caveats, conditions and figures are missing from cards
  that the accounting counts as Represented, in distil and in preserve. Distil does worse than preserve on gate 1 in 7 of
  13 cases, and on real output some distil cards cite the wrong passage. So the accounting's "Represented" means "cited", not "kept". That is the gap the model
  check (OD5b, measured earlier at $0.042 and meeting every target) was meant to close.
- Distil writes 2–3.6× the source's words on these small fixtures.
- **Recommendation:** don't make the R1 decision on this evidence. Next steps, in order:
  1. A person reviews the golden failures above and splits them into real losses and assertion brittleness. Distil
     cards are finer-grained than the cases assume.
  2. Decide OD5b. If it's approved, rerun C1c with the model check on, which also makes G2 measurable.
  3. Look into the wrong citations on real output (kn-08, kn-10), the over-broad critical cue (the "if" in a
     sign-off), and the word inflation.
  4. Then record golden runs with 3 attempts.

## Settled balance

At 2026-10-19 19:19 UTC, about 10 minutes after the last call, `limit_remaining` was **$2.42767589**. It hadn't changed since 19:12. Key usage went from $6.45490164 to $7.57232411, so the provider-side spend is **$1.1174**, against $1.121 estimated from tokens and a $2.00 cap.
