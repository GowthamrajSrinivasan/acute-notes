# Knowledge Notes: fixes and live rerun with the model check on (2026-10-20)

Approved by the user on 2026-10-20: implement the fixes for the findings of
[knowledge-notes-live-2026-10-19.md](./knowledge-notes-live-2026-10-19.md), turn on the model check on every card in
distil mode (**OD5b**), then rerun live on OpenRouter with a **$0.80** cap. Plan:
[knowledge-notes-plan.md](./knowledge-notes-plan.md) §3.2–§3.4, §4, §9, §11.0, §12. Lanes log:
[knowledge-notes-lanes.md](./knowledge-notes-lanes.md).

**Short version.**
- **The wrong citations were not a mapping bug.** The model cited the right passages, and our label→unit mapping put
  every citation on the right unit and node. The golden check matched expected *architecture components* to
  *request-flow step* shapes, because the model drew those sections as text, not as component diagrams.
- Fixed offline, with tests: honest "Represented", citation sanity, sign-offs no longer critical, decision assent
  critical, a briefer distil prompt, and the model check on every card with its verdicts reported.
- Live: **$0.673** of the $0.80 (key balance $2.4277 → $1.7551). C1c ran in full: **G3 and G4 hold on all 21 runs. G1
  now fails on 6 of 7 fixtures** (median 18–31% of cards in Needs review), because the model check flags cards.
- Most real-card flags are genuine (dropped conditions). But **26 of the 39 "not supported" verdicts were on bare
  diagram labels** (≤ 4 words, e.g. a shape "Retrieve Candidates"), which the check reads without the text node linked to
  them. That's a wiring defect of the check, found live, and not fixed in this run (product code was frozen in part B).
- The golden recording only fitted **7 of 13 cases** under the cap. Distil gate 1 passes **2 of 7** (yesterday 1 of 7;
  preserve 3 of 7 on the same cases). The caveats the golden cases look for are still missing from the cards.
- **R1: not supported yet.** See the verdict at the end.

## What changed (part A, offline, mock AI)

| # | Change | Where | Tests |
|---|---|---|---|
| 1 | **Cause of the wrong citations found: not a mapping bug** (below). New deterministic **citation sanity**: a card that shares no significant word, key term or quantity with a unit it cites gets `citation_unrelated` and goes to Needs review. The unit isn't counted Represented by that card. Units too short to judge (under 3 significant words once a "Name:" speaker label is set aside) are exempt | new `ai/fidelity/representation.ts` (`relatedToUnit`, `representationFlags`); `accounting.ts` (`NOT_REPRESENTING`: such a card doesn't represent the unit, and no duplicate `unaccounted` flag); `knowledgeCheck.ts` (`inspectSection` adds the flags; the meaning rules' own `citation_unrelated` hint is no longer repeated) | `representation.test.ts`, `knowledgeCheck.test.ts` |
| 2 | **Honest "Represented"**: a critical unit counts only when a citing card carries its condition, caveat or requirement clause. The clause is found from the same cue lists that make a unit critical; a card carries it at ≥ 50% of the clause's significant words, as the condition rule compares them, with quantities normalised and doubled consonants undone. When **no** citing card keeps it, each citing card gets `critical_dropped`, and the reason names what is missing (`the card drops the condition "when the cache holds a valid result"`). The unit is then Needs review. An AI "supported" verdict on the card keeps the unit (the rule's words stay as a hint). Protected items stay with `exactness.ts` and `restoreProtected`. The retry asks for the clause back. **Decision path checked:** kn-05's three "omitted decisions" of 2026-10-19 were assent lines ("Anyone against? … Okay.", "I'm fine with that.", "Marcus: Same.") omitted as filler. The accounting never treated them as critical. New `decision` cue list: agreed / decided / no objection / anyone against / fine with that… | `representation.ts` (`criticalClausesOf`, `cardKeepsClause`), `contracts.ts` (`critical_dropped`, `CriticalReason "decision"`), `config/fidelityCues.ts` (`critical.decision`), `components/review/wording.ts` ("limit left off the card"), `knowledgeCheck.ts` (`retryReasons`) | `representation.test.ts`, `accounting.test.ts`, `knowledgeRun.test.ts`, `knowledgeCheck.test.ts` |
| 3 | **Distil prompt**: one idea per card, the title states the point, the body only what the idea needs and never longer than the source passage it distils (except protected details), split and link rather than pad, "Brevity never drops a limit" (conditions and caveats on the claim's card), "Cite a unit only on a card that says what that unit says" | `visualize/tasks.ts` (`DISTIL_RULE`) | `distilPrompt.test.ts` (prompt text only); `preservePrompts` snapshots unchanged |
| 4 | **Critical cues**: greetings, sign-offs and meta phrases ("let me know if…", "hope this helps", "as discussed", "feel free to", "thanks"…) are blanked out before the critical cues are looked for. "As discussed, the limit must be 500" stays a requirement | `config/fidelityCues.ts` (`critical.filler`, `withoutFiller`), `accounting.ts` (`criticalReasonsOf`) | `accounting.test.ts` |
| 5 | **OD5b on**: `FIDELITY_CONFIG.semanticCheck = { enabled: true, cards: "all" }`. Distil only; `preserve` never reaches it. Report v2 gets `modelCheck` (cards, supported, partly, not supported, unanswered). `knowledgeScore` counts the verdicts and the Needs review reasons by code. `knowledgeGates` returns `modelCheck` counts, reported but not gated; `gatesMet` holds the three gates. Wording stays "checked by AI" | `config/fidelity.ts`, `outlined.ts`, `report.ts`, `e2e/fidelityScore.ts`, `e2e/ai/fidelity.spec.ts` (annotation) | `distilRun.test.ts`, `knowledgeRun.test.ts`, `knowledgeFixtures.test.ts`; local e2e asserts the check runs |

Re-scoring tool: `evaluation/knowledge-notes/tooling/rescore.test.ts` (opt-in, `RESCORE_GOLDEN=1`) recomputes a
recording's accounting with today's checks.

**Green before any live run:** `tsc` clean. Lint: 0 errors (2 old warnings in `src/mcp`). Full unit suite
(`CI=true npx vitest run`): 2,746 passed, 1 skipped, 4 todo. The 2 failures were `repoMap` timing tests that ran while
`tsc` and lint ran alongside; rerun alone, 96/96 passed. `npm run test:golden`: 349 passed. Local mock-AI e2e
`e2e/local/knowledgeNotes.local.spec.ts`: 14/14 (own `--output test-results/live2-local-kn`, trace off).

### The cause of the wrong citations (kn-08, kn-10)

- **The model cited the right labels.** In kn-08, the shapes the golden check picked were the request-flow steps:
  "1 · Agent Console posts question" cites u18 ("The Agent Console posts the question to `POST /v1/answers`…"),
  "2 · Answers API processes question" cites u19, and "6 · Orchestrator logs answer" cites u23. Every one is the right
  passage *for that step*.
- The case's `e.console`, `e.api` and `e.orchestrator` are **architecture components** that expect the HLD passages (u3,
  u4…). The model drew the HLD section as text paragraphs, with no component shapes, so the golden matcher
  (`match: "agent console"`, `planNodeTypes: shape`) found the step shapes instead.
- kn-10 is the same pattern: "4 · Request Pricing Rules", "2 · Call Supplier API" and "4 · Record in Stock Ledger" are
  step shapes citing their step's passage (u13, u24).
- `e.query-embedder` "cites nothing" because the model gave that shape no `cites` (pipeline: `uncited_card`).
- **The mapping is correct,** checked over every recorded reply of 2026-10-19:
  - 563 cited labels landed on exactly their units at the same node id.
  - 115 landed exactly, at a node renumbered by the piece merge.
  - 10 belonged to retry replies the pipeline didn't keep.
  - The other 10 were table or code labels that my script's text normalisation couldn't compare.
  - No citation was moved onto the wrong unit or node.
  - Only 13 of 739 plan citations share no word with their unit: kn-05 dialogue lines such as "Kenji: I'd like that,
    yes.", and kn-07 shapes such as "Cache" citing "It is only a copy kept for speed…".
- So the 2026-10-19 "wrong citations" are **golden assertion brittleness plus a real loss** (no component diagram for
  an HLD). They are not a pipeline bug. The case expectations (Lane J's model-reviewed drafts) need a person's call:
  should a step shape satisfy a component element?

### Re-scoring the 2026-10-19 recordings (offline; scoring changes only)

The model check can't be replayed (it didn't run then), so no card counts as "supported" here.

| Case | Units R / O / NR before → after | New flags | Golden assertions whose status changed |
|---|---|---|---|
| kn-01 | 9/0/0 → 9/0/0 | — | none |
| kn-02 | 62/2/0 → 58/2/4 | 4 `critical_dropped` | none |
| kn-03 | 29/2/0 → 28/2/1 | 1 | none |
| kn-04, kn-08, kn-11 | unchanged | — | none |
| kn-05 | 78/23/0 → 70/21/10 | 6 `critical_dropped`, 2 `citation_unrelated` | none |
| kn-06 | 49/0/0 → 44/0/5 | 10 | `a.review-queue` pass → fail (minor: units now flagged that the case says need no review) |
| kn-07 | 40/0/0 → 37/0/3 | 4 + 3 unrelated (shapes "Message Queue", "Metadata Database", "Cache") | none |
| kn-09 | 55/1/1 → 50/1/6 | 5 | none |
| kn-10 | 50/0/0 → 48/0/2 | 3 | none |
| kn-12 | 31/0/0 → 28/0/3 | 3 | none |
| kn-13 | 27/0/0 → 25/0/2 | 2 | none |

- In the main run, 35 units go to Needs review: 33 from Represented, and 2 kn-05 assent lines from Intentionally
  omitted (now `critical_omitted`, by the `decision` cues).
- The golden gate totals don't move, apart from that one minor assertion. The golden checks read the canvas text,
  which the scoring doesn't change.
- Some new flags are **real losses** the golden cases also name:
  - kn-02 "at most 60 seconds past its TTL";
  - kn-09 "but I did not find a call site and have not confirmed that it ever runs" and "but nothing in the code says so";
  - kn-13 "does not take a leaked connection back by force";
  - kn-07 Auth "cannot be reached".
- Some are **paraphrase false alarms**: "not applied simultaneously" for "not applied everywhere at the same moment";
  "solely" for "only"; "doesn't affect correctness" for "never wrong". That's why the model check's "supported" may
  clear them.

## Cost

Estimated at $0.30 per 1M input tokens and $2.50 per 1M output tokens (gemini-2.5-flash; every call reported 0
reasoning tokens). Provider check: `GET /api/v1/key`, `limit_remaining`.

| Step | What ran | Prompt tokens | Completion tokens | Estimated |
|---|---|---|---|---|
| C1c | fixtures 4–10 × 3, distil, model check on (one invocation per fixture; each incl. a preflight) | 727,343 | 74,698 | $0.405 |
| Golden | 7 cases × 1 attempt, distil, model check on (100 calls, 30 of them checks) | 337,919 | 66,614 | $0.268 |
| **Total** | | | | **$0.673** |

| When (UTC) | `limit_remaining` | Spent since start |
|---|---|---|
| 2026-10-20 02:05 (before) | $2.42768 | |
| 02:19 (after C1c) | $2.04956 | $0.378 |
| 02:28 (after golden, dev server stopped) | $1.75511 | **$0.6726** |

**Projection kept the cap.**
- Fixture 4 cost $0.073, against about $0.042 per fixture on 2026-10-19: 1.7× (the model check, plus more retries).
- C1c projected to about $0.50 and came in at $0.405.
- A full 13-case golden recording projected to about $0.66 (yesterday's $0.48 × 1.36). That exceeded the $0.395 left.
- So the golden step recorded a **subset of 7 cases** (kn-01, 02, 05, 06, 08, 10, 13), projected at $0.31, actual
  $0.268. They were chosen for the 2026-10-19 findings (citations kn-08/kn-10; caveats kn-02; decisions kn-05) and the
  cases where preserve passed (kn-06, kn-13).
- kn-03, 04, 07, 09, 11 and 12 were not recorded today.

## C1c (S1.8 rerun): fixtures 4–10, distil, 3 runs each, model check on

- **Setup:** OpenRouter `google/gemini-2.5-flash`, no decision model (`ACUTE_AI_DECISION_*` empty), `--trace off`, own
  `--output test-results/live2-c1c-f<N>`. One dev server (:3000), stopped at the end.
- **Artefacts:** `.ai/docs/fidelity-runs/2026-10-20-distil/<fixture>/` (`summary-v2.md` now has the verdicts and the
  reasons by code).
- **Harness slip:** the first invocation's `-g "Fixture 10 —"` was split by the Windows shell, so it matched every
  fixture. It ran Fixture 4, which failed G1, and the serial mode skipped the rest. Those 3 runs are valid fixture-4
  data. The others ran with `-g "Fixture.N.—"`.
- **No timeouts, schema or UI failures.**

Median (worst) of 3 runs. NR = Needs review. Model check = verdicts on the cards' reviews, all 3 runs: supported /
partly / not supported / unanswered.

| # | Fixture | Units R / O / NR, median (worst) | Cards in Needs review, median (worst) | Model check (3 runs) | G1 | G3 | G4 | Canvas words % of source, median (worst) | 2026-10-19: cards in NR, words % |
|---|---|---|---|---|---|---|---|---|---|
| 4 | Hedged prose | 10/0/0 (10/0/0) | 31.3% (46.2%) | 30 / 0 / 11 / 0 | **not met** | met | met | 202 (218) | 0%, 205 |
| 5 | Docs with code and config | 9/0/0 (9/0/0) | 0% (0%) | 28 / 0 / 0 / 0 | met | met | met | 336 (360) | 0%, 287 |
| 6 | Compound caveats | 7/0/0 (7/0/0) | 28.6% (33.3%) | 17 / 0 / 1 / 0 | **not met** | met | met | 273 (286) | 12.5%, 265 |
| 7 | Meeting notes | 9/1/1 (5/1/5) | 25% (66.7%) | 29 / 0 / 5 / 0 | **not met** | met | met | 235 (249) | 0%, 241 |
| 8 | Trade-off argument | 8/0/0 (8/0/0) | 18.2% (18.2%) | 27 / 4 / 2 / 0 | **not met** | met | met | 247 (286) | 0%, 220 |
| 9 | Chat reply | 10/2/0 (10/2/0) | 22.2% (22.2%) | 20 / 0 / 5 / 0 | **not met** | met | met | 249 (256) | 0%, 224 |
| 10 | Update series v1 | 9/0/0 (6/0/3) | 23.1% (55.6%) | 24 / 1 / 9 / 0 | **not met** | met | met | 400 (430) | 0%, 291 |

**What the numbers say:**

- **G3 and G4 hold on all 21 runs**, as before.
- **G1 fails on 6 of 7 fixtures**, because the model check now flags cards (G1 was met yesterday only because nothing
  could flag a card). Needs review reasons, all fixtures: `ai_check` 39, `uncited_card` 18, `unaccounted` 5,
  `citation_unrelated` 3.
- **The model check's verdicts, by card length** (from the recorded check calls, 253 verdicts):

  | Card | Supported | Partly | Not supported |
  |---|---|---|---|
  | Diagram label (≤ 4 words) | 14 | 0 | **26** |
  | Full card | 194 | 6 | 13 |

  - The label verdicts read "the card 'Retrieve Candidates' is too vague and loses …". The check sees a shape's label
    alone, while the text node linked to it with `explained_by` carries the content. That's a **false-alarm source
    in `checkItems`**: it treats a shape as a card.
  - Fixing it means checking a shape together with its `explained_by` text, or not citing on bare shapes. That's a
    small product change, not made in this run.
  - On full cards, the "partly" and "not supported" reasons are mostly **real dropped conditions**:
    - fixture 4: "removes the condition for skipping the reranker … not just when the budget is under 150 ms";
    - fixture 7: "omits the condition for widening the release";
    - fixture 8: "omits the condition 'once a shared cache exists'".
  - They are exactly what the 2026-10-19 golden failures pointed at, now caught by the pipeline itself.
  - That stands in for G2 here. Per-kind recall can't be measured on live output.
- **Sign-off fix confirmed live:** fixture 9's "Hope this helps — let me know if you want a sample consumer!" is now
  Intentionally omitted (10/2/0). On 2026-10-19 it was a false `critical_omitted` (10/1/1).
- **The deterministic `critical_dropped` rule rarely fires on fresh runs:**
  - 1 flag (fixture 6), plus hints on fixture 8: the model check said "supported", so the rule's words became hints.
  - In the golden recording: 2 flags (kn-05) and 7 hints.
  - The retry asks for the clause back before the final check, so fresh output is cleaner than the re-scored
    2026-10-19 plans.
- **Fixture 7, worst run:** 10 cards without `cites` and 5 units unaccounted in one run. The model's reply dropped its
  citations, and the pipeline caught it (Needs review, not silent).
- **Words are not shorter.** Median canvas words are 202–400% of the source, against 205–291% on 2026-10-19. The
  brevity prompt didn't cut words on these 90–150-word fixtures, where frame titles, analysis cards and title-plus-body
  dominate. Fixture 10 (the smallest) rose to 400%. Not gated (§9), but it works against "ideas over words".

## Golden: 7 cases recorded, side by side

- **Recording:** `recordings/2026-10-20-distil-gemini-flash-od5b/`, `gate: false`, approved by "Gowthamraj Srinivasan
  (chat, 2026-10-20)", `GOLDEN_RECORD_ATTEMPTS=1`.
- **Replay:** `npm run test:golden` (fails once on the stale `gates.md`, as expected), then
  `UPDATE_GOLDEN=1 npm run test:golden` (regenerates `reports/gates.md`), then `npm run test:golden`: **350 passed, 2
  skipped**.

Cell = passed / evaluated (critical failures).

| Case | Distil 10-20 (check on) G1 | G2 | G3 | Distil 10-19 G1 | G2 | G3 | Preserve 10-19 G1 | G2 | G3 |
|---|---|---|---|---|---|---|---|---|---|
| kn-01 idempotency keys | **PASS** 11/11 | PASS 7/8 | PASS 5/5 | **PASS** 11/11 | PASS 7/8 | PASS 5/5 | **PASS** 9/9 | PASS 7/8 | PASS 5/5 |
| kn-02 edge cache invalidation | FAIL 16/26 (9) | PASS 21/30 | PASS 7/9 | FAIL 19/26 (6) | PASS 21/30 | PASS 7/9 | FAIL 22/24 (1) | PASS 21/30 | PASS 7/9 |
| kn-05 incident review meeting | FAIL 14/26 (12) | FAIL 9/26 (4) | PASS 5/8 | FAIL 19/26 (7) | FAIL 10/26 (3) | PASS 5/8 | FAIL 13/24 (11) | FAIL 12/26 (2) | PASS 5/8 |
| kn-06 hybrid search reranking | FAIL 26/33 (2) | FAIL 21/27 (2) | FAIL 7/9 (1) | FAIL 25/33 (4) | FAIL 21/27 (2) | PASS 8/9 | **PASS** 30/30 | FAIL 19/27 (2) | FAIL 6/9 (1) |
| kn-08 helpdesk HLD/LLD | FAIL 6/21 (13) | FAIL 17/127 (37) | PASS 7/9 | FAIL 5/21 (14) | FAIL 13/127 (37) | PASS 7/9 | FAIL 7/20 (11) | FAIL 21/127 (34) | PASS 8/9 |
| kn-10 inventory architecture | FAIL 13/28 (6) | FAIL 16/62 (14) | FAIL 5/9 (1) | FAIL 12/28 (7) | FAIL 22/62 (10) | FAIL 6/9 (1) | FAIL 11/26 (6) | FAIL 28/62 (4) | PASS 7/9 |
| kn-13 connection-pool runbook | **PASS** 32/33 | PASS 9/13 | PASS 5/5 | FAIL 32/33 (1) | PASS 12/13 | PASS 4/5 | **PASS** 31/31 | PASS 10/13 | PASS 5/5 |
| **Passing (of 7)** | **2** | 2 | 5 | 1 | 2 | 6 | 3 | 2 | 5 |

**The run's own output** (from `run.json`):

| Case | Units R / O / NR | Cards in Needs review | Model check s / p / n |
|---|---|---|---|
| kn-01 | 9/0/0 | 0% | 2 / 0 / 0 |
| kn-02 | 56/1/7 | 15% | 46 / 0 / 2 |
| kn-05 | 62/31/8 | 36% | 30 / 0 / 1 |
| kn-06 | 47/0/2 | 29% | 27 / 1 / 9 |
| kn-08 | 21/0/13 | 52% (20 uncited cards, 9 units unaccounted) | 29 / 0 / 12 |
| kn-10 | 46/0/4 | 0% | 39 / 0 / 0 |
| kn-13 | 27/0/0 | 33% | 6 / 0 / 2 |

**Golden findings:**

- **Citations:**
  - kn-08: 2 of 8 elements miss their source (yesterday 4 of 6). `e.cms` cites u8, the CMS→ingestion sentence,
    where u2 is expected. `e.query-embedder` again has no `cites`.
  - kn-10: the `cites` check now passes (yesterday 3 of 9 failed).
  - kn-02: `e.ttl` and `e.ttl-tradeoff` cite nothing.
  - kn-05: `e.decision-status-page` cites nothing.
- **kn-05 omissions are worse:** 7 dialogue lines the case marks non-omittable were omitted as filler ("Dana: Should
  support be allowed to post it directly?", "Kenji: I'd like that, yes.", "Marcus: Same."…). None carries a cue word,
  so the new `decision` cue list doesn't reach them. Questions and bare assent need a different signal (a speaker turn
  right after a proposal).
- **kn-02 is where distil still loses what matters:** the stale-window caveat on the TTL claim, "purging is
  eventually consistent", tag discipline, and the 60 s stale bound. The pipeline counts 7 units Needs review
  (unaccounted). Those are the units the cards don't hold.
- **Gate 1 overall:** distil passes 2 of 7, against 1 of 7 on 2026-10-19 and 3 of 7 for preserve. With one attempt
  per case, a single case moving (kn-13) is within run-to-run variance. Not an improvement that can be claimed.

## What's still failing, and why

1. **G1 on fixtures (6 of 7):** mostly the model check reading bare shape labels (26 of 39 "not supported"), then real
   dropped conditions on full cards, then cards without `cites`. Fix next: check a shape together with its linked
   `explained_by` text (or exclude labels with no claim), then re-measure. That's a small change in `checkItems`.
2. **Golden gate 1 (5 of 7 fail):** critical caveats and figures are still missing from the cards: kn-02, kn-05,
   kn-06, kn-08 and kn-10 report "missing text" and "element not found". The pipeline now marks more of them Needs
   review instead of Represented (honest, but not yet fixed). Also: the brittle component/step matching in kn-08 and
   kn-10, and dialogue assent omitted as filler in kn-05.
3. **Words:** 2–4× the source on small fixtures. The prompt change didn't move it.
4. **Not run:** 6 golden cases (cap), 3 attempts per case, the readability judge (G8, not built).

## Verdict for R1

**Not supported.**

- G3 and G4 hold on every run.
- With the model check on, the pipeline now flags dropped conditions the 2026-10-19 runs passed silently. "Uncertain is
  never shown as verified" works as designed.
- But G1 fails on 6 of 7 fixtures, and the golden cases still find critical caveats missing in 5 of 7 recorded cases.
  Distil is no better than preserve there (2 vs 3 passing).

Next steps, in order:

1. Fix the shape-label false alarm in the model check (offline), and re-score.
2. A person reviews the golden failures, and decides whether a step shape may satisfy a component element.
3. A distil prompt change aimed at keeping each condition on the card, not at length.
4. Then one approved rerun: C1c, plus all 13 golden cases × 3 attempts.

## Offline fixes 2026-10-20 (2)

Approved by the user on 2026-10-20 (the fixes, not a live run). Offline, mock AI only: no model was called. Lane
"Distil quality 1–4" in [knowledge-notes-lanes.md](./knowledge-notes-lanes.md).

**Short version.**
- All four fixes are in, each with tests that fail without it (checked by disabling each fix by hand: 4, 3, 9 and 4 of
  the new tests fail).
- Re-scored offline, **G1 still fails on 6 of 7 C1c fixtures in both bounds.** What keeps cards in Needs review is the
  model check's verdict on full cards (24 of 33 such cards in the optimistic bound), then cards without `cites` (7) and
  unrelated citations (2). The retry can't fix the model check's findings: the check runs after it.
- Counting cards instead of nodes makes G1 *stricter* on these runs: grouped nodes were mostly healthy shape + text
  pairs, so the denominator shrinks more than the numerator (fixture 4: 31.3% per node, 45.5% per card).
- The golden gates don't move on the 7 recorded cases: the "Limit:" lines the fallback adds aren't the text the golden
  checks look for.
- kn-05's five assent and proposal lines that were omitted as filler are now Needs review, as they should be.

### What changed

| # | Fix | Where | Tests (new) |
|---|---|---|---|
| 1 | **G1 counts cards, not nodes** (plan §9 G1). A card is a node, or the nodes `cardViews` groups: a shape with the text that explains it (`explained_by`), a label shape folded into its card (fix 2). A grouped card is in Needs review when any of its nodes is, and counts once. New `KnowledgeRunOutput.cardGroups` (from the validated plan, `cardGroupsOf` in `knowledgeRun.ts`). `knowledgeScore` uses it (comment cites §9 G1); runs recorded before it count per node, as before. Report v2 counts cards the same way (`SectionKnowledge.cards`), and so does a section's `needsReview` (one item per card) | `e2e/fidelityScore.ts`, `contracts.ts`, `knowledgeRun.ts`, `knowledgeCheck.ts`, `report.ts`, `outlined.ts` | `distilQuality.test.ts` §1 (5) |
| 2 | **Label shapes with no explanation.** Rule chosen: a label-only shape (a `shape` of at most 4 words, nothing explaining it, citing ≥ 1 unit) **joins the first full card** (more than 4 words, not analysis or by reference) that cites every unit it cites. It is checked with that card, never alone. Why join, not skip: the label stays in what the model check and the rules read (a label contradicting its card is still seen); its citation is judged against the card that says what the unit says; and the reader sees one idea, which is how G1 counts. A label citing a unit no single full card covers is checked alone, as before. Only `explained_by` folds an explanation: step shapes linked by `flows_to` are never grouped through it, and no link is added to the plan | `representation.ts` (`cardViews` with `CardLinks`, `LABEL_MAX_WORDS`), `knowledgeCheck.ts` (`shapesOf`) | §2 (3) |
| 3a | **The retry names each dropped clause verbatim, with its card.** One flag per dropped clause (was: only the first). The retry asks once per clause, on the citing card closest to the unit (`limitHost`): `Put "when the query mixes keywords and concepts" (P1.1) on card "Hybrid search lifts recall": it is the condition of that card's claim, and the card leaves it out.` The clause is no longer cut at 100 characters, and the card is named by its title, not its node id. A cue inside another clause ("…which ours **do not** today" inside "However, …") is no longer a clause of its own. A one-word clause ("I don't **know**") is too short to judge (`MIN_CLAUSE_WORDS`) | `representation.ts` (`clauseText`, `droppedKindOf`, `limitHost`), `knowledgeCheck.ts` (`droppedClauses`, `retryReasons`) | §3, `distilLimits.test.ts` |
| 3b | **Still dropped after the retry: a "Limit:" line from the source** on that card (`**Limit:** When the query mixes keywords and concepts`). It goes on the card's text node, as a detail on a shape with no text (≤ 8 details of ≤ 200 characters), else on a small linked "Limit" node. The unit is `restored` (Represented; `AccountingInput.restored`, report v2 `restored.limits`). It runs **before** the model check, so the check judges the card the reader sees | `knowledgeCheck.ts` (`restoreLimits`), `accounting.ts`, `outlined.ts`, `report.ts` | §3; mock distiller (`dropConditionIn`, new knob) once and persistent; the recorded fixture 8 replies |
| 3c | **Word count.** `DISTIL_RULE`: "A card is never longer than the source passages it cites, except protected detail kept exact: count its words against theirs." New `longer_than_source` hint (`lengthHints`): a card, read with its explanations, whose words outnumber its cited units' words. Protected values and lines put back from the source aren't counted. A hint only: never Needs review, never picks a card for the model check. It rides on a retry that happens anyway ("say it in fewer words, keeping every condition and exact detail"). `knowledgeScore.longerThanSource`, report v2 `cards.longerThanSource` | `tasks.ts`, `representation.ts`, `contracts.ts` (code), `components/review/wording.ts` (label) | §3, `distilPrompt.test.ts` |
| 4 | **Dialogue turns** (`dialogueReasonsOf`, turn-level, not cue words). A transcript has ≥ 2 speakers with ≥ 2 labelled units each ("Agreed:", "Attendees:"… are never speakers). A turn runs from a labelled unit to the next label or paragraph break. A turn's last question is a critical `open_question` when the next other speaker starts with a non-answer ("I don't know", "not sure") or nobody speaks after it. A short assent (≤ 8 words, assent cue at its start) right after a turn whose **last** unit proposes ("Should …", "So the proposal is …") is a `decision`, and so is that proposal. Further assents keep the proposal open. Answered questions, requests ("Marcus, can you …?"), turn-taking and small talk are not critical. Cue lists in `FIDELITY_CUES.dialogue`; retry wording "records a decision" / "a question nobody answered". `DISTIL_RULE` says neither is filler | `config/fidelityCues.ts`, `accounting.ts`, `contracts.ts` (`open_question`), `knowledgeCheck.ts`, `tasks.ts` | §4 (6) on kn-05's `source.md` |

On kn-05's source, the turn rule marks these 8 units and no others:
- **Decisions:** "Dana: Should support be allowed to post it directly?", "Kenji: I'd like that, yes.", "Leila: No
  objection from me.", "Dana: So the proposal is…?", "Leila: Yes.", "Tomás: I'm fine with that.", "Marcus: Same.".
- **Open question:** "Do we know whether any of the 2,300 failed checkouts were retried successfully?".

### Re-score of the C1c runs of 2026-10-20 (offline)

Scripts are in the session scratchpad (`q14/rescore_c1c.mjs`, `q14/common.mjs`).

**Correction to the previous re-score.** The "Model-check label fix" re-score mapped each section to its plan prefix by
the outline's `parts`. The plan numbers sections in outline order (`u<i>_`), so where the two differ, cards were read
with another section's citations. Fixtures 7, 8 and 10 had 41 such citations. Its bounds (f4 25–62.5%, f8 36.4%,
f10 30.8%…) are superseded by the table below, which has 0 foreign citations.

**What can be recomputed exactly:**
- G1 per card with the recorded reasons and verdicts (fix 1).
- The card views, with labels folded (9 nodes folded over the 21 runs).
- The deterministic flags on those views.
- The "Limit:" fallback: 3 clauses, on f04 run 1 and f08 runs 2 and 3.
- The dialogue units (none in C1c: fixture 7's notes aren't a turn-by-turn transcript).
- The length hints: 99 of 265 cards are longer than their cited text.

**What needs a model verdict:** the check's answer on a card whose text changed. The bounds are:

- **Optimistic:** a grouped card has the verdict of its full-text nodes, and a card that got a "Limit:" line is
  supported.
- **Pessimistic:** the worst verdict of any of its nodes, and the "Limit:" lines change nothing.

Median share of cards in Needs review, 3 runs:

| Fixture | Recorded (per node) | Fix 1 only (per card) | All fixes, optimistic | All fixes, pessimistic | G1 (≤ 15%) |
|---|---|---|---|---|---|
| 4 Hedged prose | 31.3% | 45.5% | 18.2% | 45.5% | not met |
| 5 Docs with code and config | 0% | 0% | 0% | 0% | **met** |
| 6 Compound caveats | 28.6% | 40% | 40% | 40% | not met |
| 7 Meeting notes | 25% | 25% | 20% | 27.3% | not met |
| 8 Trade-off argument | 18.2% | 22.2% | 22.2% | 22.2% | not met |
| 9 Chat reply | 22.2% | 22.2% | 22.2% | 22.2% | not met |
| 10 Update series v1 | 23.1% | 25% | 25% | 25% | not met |

- **G1: still 6 of 7 not met, even optimistically.**
- In the optimistic bound, the cards left in review are there for these reasons:
  - 24 for the model check's "partly", "not supported" or no answer on full cards (mostly real dropped conditions the
    word rule counts as kept);
  - 7 for no `cites`;
  - 2 for an unrelated citation.
- All 3 "Limit:" clauses were on cards the model check had called supported: deterministic false alarms on faithful
  paraphrases ("contingent on CI runners having a shared cache, which is not currently implemented"). The fallback
  makes those cards longer for nothing. That's the price of putting the line back before the check.

### Re-score of the golden recording `2026-10-20-distil-gemini-flash-od5b` (offline)

Script: `q14/rescore_golden.mjs`.
- The recorded plans get the "Limit:" lines and the runs are re-accounted with the new rules.
- Then the golden replay runs on a copy (`replayRecording`, no issues).
- Cards in Needs review are the run's own, as report v2 counts them.

| Case | Cards in NR, recorded per node | Fix 1 only | All fixes opt / pes | Units R/O/NR before → after | "Limit:" lines | Golden gate 1 before → after |
|---|---|---|---|---|---|---|
| kn-01 | 0/2 | 0/2 | 0% / 0% | 9/0/0 → same | 0 | PASS 11/11 → same |
| kn-02 | 8/54 (14.8%) | 6/46 (13%) | 9.1% / 13.6% | 56/1/7 → same | 1 | FAIL 16/26 (9) → same |
| kn-05 | 16/44 (36.4%) | 16/44 (36.4%) | 41% / 41% | 62/31/8 → 62/26/13 | 3 | FAIL 14/26 (12) → same |
| kn-06 | 11/38 (28.9%) | 11/29 (37.9%) | 37% / 37% | 47/0/2 → 44/0/5 | 0 | FAIL 26/33 (2) → same |
| kn-08 | 32/61 (52.5%) | 19/33 (57.6%) | 58.6% / 65.5% | 21/0/13 → same | 0 | FAIL 6/21 (13) → same |
| kn-10 | 0/39 | 0/26 | 0% / 0% | 46/0/4 → same | 2 | FAIL 13/28 (6) → same |
| kn-13 | 3/9 (33.3%) | 3/7 (42.9%) | 14.3% / 42.9% | 27/0/0 → same | 0 | PASS 32/33 → same |

- **Golden gates 1–3 unchanged on all 7 cases.** No assertion changed status, so golden gate 1 still passes 2 of 7.
- **kn-05:** the 5 assent and proposal lines the model omitted as filler are now Needs review (`critical_omitted`), so
  the retry would ask for them. kn-05's case marks these lines as non-omittable.
- **kn-06:** 3 units (u31–u33) move to Needs review. This is not from these fixes: their only citing card got the model
  check's "partly" ("omits the caveat that reranking does not guarantee…"). Today's accounting counts that verdict
  against the units (since the label fix); the recording predates it.
- **"Limit:" lines added:**
  - kn-02: "But every key a page carries makes the header longer, and Larkspur keeps it under 50 keys per response".
  - kn-10: "Only found when someone opens the admin UI" and "When `inventory.dlq` starts to fill up".
  - kn-05: three knowledge gaps ("Don't know how many releases include migrations"…).

### Checks (offline)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors (2 old warnings in `src/mcp`) |
| Full unit suite (`CI=true npx vitest run`) | **2,873 passed**, 1 skipped, 4 todo (276 files), 0 failed |
| `npm run test:golden` | **352 passed**, 2 skipped |
| `preservePrompts.test.ts` snapshots | unchanged |
| Local e2e `knowledgeNotes.local.spec.ts` (`--trace off --output test-results/quality14`) | **14/14**; no other dev server was up, and Playwright's server stopped after the run |

New tests:
- `src/ai/fidelity/distilQuality.test.ts`: 19 tests.
- `src/ai/visualize/distilLimits.test.ts`: 5 tests, with the mock distiller and with the replies recorded for
  fixture 8, run 2: the recorded first reply, then the recorded retry or a mocked reply.
- The live replies are saved as a fixture: `src/ai/fidelity/__fixtures__/knowledge/live/f08-run2-limitations.json`.

Changed tests:
- `knowledgeCheck.test.ts`: the new retry wording.
- `distilPrompt.test.ts`: the new brevity wording, plus a test for the transcript line.

### What the live confirmation run would cost

Estimated from the 2026-10-20 spend: C1c $0.405 and 7 golden cases $0.268.
- **C1c (fixtures 4–10 × 3) plus the same 7 golden cases × 1: about $0.70–0.75.**
  - Folding labels removes a few check items.
  - More retries are likely on transcripts (kn-05, fixture 7) and on cards whose clauses are now named.
  - The "Limit:" lines add a little to the check prompts.
- **All 13 golden cases × 3 attempts plus C1c: about $2.4.** That is more than the key's remaining $1.7551.
- Not run: it needs the user's approval.

### What this means, and next

1. The fixes make the scoring honest: cards are counted as the reader sees them, labels are read with their cards,
   nothing critical is lost silently, and dialogue decisions count. **They do not bring G1 under 15%.**
2. **What would move G1** is acting on the model check's findings before the reader sees them. Today the check runs
   after the one retry, so its "drops the condition …" verdicts can only send cards to Needs review.
   - Proposed (not built): run the check before the retry and pass its reasons to the retry.
   - Then check only the cards the retry changed: one more check call per retried section.
3. The "Limit:" fallback fires mostly on the rule's paraphrase false alarms in these recordings: 3 of 3 in C1c were
   on cards the model judged supported. Two options:
   - keep the fallback (nothing lost, a slightly longer card);
   - put the line back only when the model check doesn't answer "supported". The check would then judge a card the
     reader doesn't see, unless it runs again.

   This needs a decision.
