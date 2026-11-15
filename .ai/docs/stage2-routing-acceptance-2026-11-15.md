# Stage 2 (Node Router): routing acceptance criteria and offline verification (2026-11-15)

> **Status (2026-11-15, offline, no AI call). Verdict: NOT YET: verification can't be marked complete as the
> criteria stand.** The core behaviour passes, and so do most safety and quantitative criteria. Three gating
> criteria fail and one is not measurable:
>
> | Failing / open | What closes it |
> |---|---|
> | **S3:** "ask instead of guess" depends on the result size. With `limit: 1`, which MCP `suggest_placement` accepts, every close call becomes `route`: 16/16 on dev (defect **D1**). | Router fix: compute the decision on the full ranked list, before it is cut to `limit`. Plus the test in D1. About one line in `router.ts`. Not done here, because this pass changes no code. |
> | **Q7:** when the router says NEW ("no card is close"), it is right 1 time in 7 on dev. Twice the content was already on the canvas (D001, D047). | Either (a) the user accepts this as Stage 5's problem ("belongs nowhere", §13.13–13.14) and drops Q7 to recorded-only, or (b) a policy change: the dialog doesn't preselect "A new card on its own", and `suggest_placement` labels NEW as "no confident match" rather than "create one". Neither choice changes weights. |
> | **S5b:** an MCP agent applies a placement with `update_block`, a whole-block replacement. It is reviewed and baseline-checked, but it isn't the claim-level `patch_block`. | Either amend the criterion to "a reviewed change: `patch_block`/`create_block` in the app, `update_block` with a baseline fingerprint over MCP", or add a claim-level MCP write tool. That tool is outside Stage 2 and in `src/mcp`, which this pass doesn't touch. |
> | **B2b:** "non-obvious *cross-parent* match" has no test. On dev's cross-section trap cases, the router is right 1/9. | Add a fixture test: the right card sits in a different section from a word-sharing decoy. If the hashed embedder can't pass it, the user records it as Stage 5 scope. |
>
> **Proposed, the user decides whether it is a criterion:** S4b. An escalated (CONTRADICTS/UNCLEAR) update is
> preselected in the dialog when the router decides `route`. **FAIL** on a fixture; 0 cases on dev (defect **D2**).
>
> **Every quantitative bar below is PROPOSED** and needs the user's approval. The bars were written with the
> already-published dev baseline in view, and several pass by only 0–2 cases out of 33–54 (margins are given).

## 1. What Stage 2 is, and what it is not

**Stage 2's scope**, from the plan's §4 "Stage 2" and §10:
- **Unanchored content only:** a pasted line, an Ask AI answer, an MCP agent's note. Source-anchored updates
  reconcile against their own source and throw `RouterModeUnavailableError` here.
- **The output** is a ranked list of on-canvas cards, each with one of three actions: `update` (a sentence holds
  the claim), `insert_near` (a new card in that card's section), or `none` (it already says it). Plus a decision:
  `route`, `NEEDS_CLARIFICATION` or `NEW`.
- **The placement unit is the section.** `insert_near` creates a new card at the bottom of the chosen card's
  section. The only in-card edit is a sentence update.
- **A person always confirms:** in the "Where should this go?" dialog and then in review, or in review after an
  MCP agent's proposal.

**Not Stage 2 (Stage 5's bar, plan §13):**
- in-card anchors: `after_item`, `append`, `table_row`, `cell`;
- exact-duplicate recognition;
- true paraphrase retrieval (a dense embedder, 5a);
- "belongs nowhere" vs a weak paraphrase;
- trap resistance;
- end-to-end "placed" (destination + action + anchor).

The dev baseline records how far today's router is from those (13 % placed, 2 % into the right card), and §13.11
already calls that "the 5d gap, measured". **None of these gate Stage 2.** Section 4 lists them as recorded only.

**Why found@1 = 23 % does not gate Stage 2, and when it would.** Found@1 asks whether the expected *card* is
ranked first. Stage 2 is judged at the section level (56 % right, about 2.2× chance: dev canvases have 4–5
sections) and as a list a person picks from (the right card is on the shown list 72 % of the time, its section
96 %).

**Is 23 % acceptable for OpenUI Phases 4–5?**
- **Yes for a suggest-and-confirm use, with conditions.** Phase 4's "promote an insight into canonical notes" is
  one, and so is Phase 5's "retrieve related concepts", provided the agent is shown the list and its write is
  reviewed.
- **Not for any use that acts on the top card unconfirmed.** That includes an agent applying `candidates[0]`
  without showing the user, auto-accept, and Phase 5 wording such as "agents can reuse knowledge *reliably*" at
  card level. There, three placements in four would go to the wrong card.

The conditions:
1. D1 is fixed. Otherwise an agent calling with `limit: 1` is told `route` on close calls.
2. Every placement stays human-confirmed.
3. Phase 5 docs and tool text describe `suggest_placement` as candidates to choose from, not an answer.
4. Card-level reliability claims wait for Stage 5.

## 2. The criteria

Results are **PASS / FAIL / NOT MEASURABLE**, with evidence. Test names are abbreviated: "router.test › 2c ›" is
`src/ai/router/router.test.ts`, describe "2c — the Node Router". The "probe" is a scratch, read-only dev-split
script run for this document and then deleted (§3).

### Behavioural (from §4's Stage 2 test list, plus §10)

| # | Criterion | Result | Evidence |
|---|---|---|---|
| B1 | **Direct match:** content changing a claim a card makes ranks that card first as `update`, decided `route`. | **PASS** | router.test › 2c › "direct match…" (SUPERSEDES, routing > 0.2, update > 0.5). search.test › "suggest_placement… routes over the persisted canvas". e2e test 1: "Update the card (supersedes)", preselected, review shows "five → three", written. |
| B2a | **Non-obvious match:** no shared word or prefix, and the right card still ranks first. | **PASS** | router.test › 2c › "non-obvious match…" (lexical 0, semantic > 0, `keys` first). |
| B2b | **Cross-parent match:** the right card is in a different section from a word-sharing decoy. | **NOT MEASURABLE** | No fixture test exists. On dev, the 9 cross-section trap cases have top = expected 1/9 and top = trap 5/9 (probe). Recorded, not gating, until a fixture exists. |
| B3 | **Ambiguous → asks:** two sections fit about equally, so `NEEDS_CLARIFICATION` is returned, not a pick. | **PASS** (default limit) | router.test › 2c › "ambiguous… NEEDS_CLARIFICATION" (gap < 0.08). See S3/D1 for `limit` < 2. |
| B4 | **"Contains the claim" vs "related topic":** a new point on the same subject gives `insert_near` with no claim, never an update. | **PASS** | router.test › 2c › "related topic vs contains the claim…". e2e test 2: "Add a new card beside it", 1 block, written. |
| B5 | **Already says it:** an identical claim gives `none`, update confidence 1, nothing written. | **PASS** | router.test › 2c › "a claim the card already makes…". placement.test › "new… none: nothing". |
| B6 | **Nothing close → NEW**, a new card on its own. | **PASS** | router.test › 2c › "nothing close: NEW". e2e test 3: "No card is close", "A new card on its own" checked, written. |
| B7 | **Only unanchored content** is routed. The other modes throw. | **PASS** | router.test › 2c › "only unanchored content is routed here…". |

### Safety properties

| # | Criterion | Result | Evidence |
|---|---|---|---|
| S1 | **Only on-canvas destinations**: never an off-canvas document (an undo version), a deleted element, or another canvas's block. | **PASS** | router.test › 2c › "only objects on the canvas…". e2e test 2 asserts the old "five times" wording is not offered. Probe: 0 off-canvas candidates over all 60 dev cases. |
| S2 | **Two confidences, never blended.** `routing` alone ranks and decides. `update` is reported beside it. The model step changes neither. | **PASS** | router.test › 2c › "direct match" (routing ≠ update) and "a contradiction" (routing > update). placement.test › "its pick decides the route; the candidates and both confidences stay the router's". Probe: on 60/60 dev cases the decision is re-derived from routing values alone and the order is by routing (0 mismatches). |
| S3 | **NEEDS_CLARIFICATION instead of a guess when close**, whatever the caller's result size. | **FAIL** | Passes at the default `limit` 5, and at 10 (no decision changes on dev). **D1:** at `limit: 1` the ambiguous fixture returns `route` ("best fit: The cache stores user sessions"), and dev turns 16/16 clarifications into `route` (probe). MCP `suggest_placement` accepts `limit` 1–10. |
| S4 | **CONTRADICTS escalated:** flagged `escalate: true`, low update confidence, named as a contradiction in the dialog and in the MCP tool text, never written without the user. | **PASS** | router.test › 2c › "a contradiction…" (escalate, update < 0.3). The dialog labels it "Update it — but this contradicts what it says". `suggest_placement`'s description says "needs the user's decision; never apply it on your own". It reaches the user through Propose and then review. |
| S4b | *(PROPOSED, the user decides whether to adopt it)* An escalated update is **not preselected**, consistent with Stage 1's "intents a planner must not apply on its own" (`ESCALATED_INTENTS`). | **FAIL** | **D2:** the fixture "Retries never happen with exponential backoff." returns decision `route`, top = an escalated CONTRADICTS update (routing 0.67, update 0.15). `PlaceContentDialog` preselects the top whenever the decision is `route`. 0 such cases on dev. |
| S5a | **In-app placements go through review**: `patch_block` (claim-level, fingerprint-checked) or `create_block` + `update_frame`, never a direct write. | **PASS** | placement.test › 6 placeContent tests (patch applied at accept; insert/stack; fallback with a note). e2e tests 1–3: every placement appears in the review bar and is written only after "Accept all". |
| S5b | **MCP placements go through review as `patch_block`/`create_block`.** | **FAIL** (as worded) | `suggest_placement` is read-only and tells agents to apply with `update_block` or `create_block`. Both are proposals the user reviews, and `update_block` carries a baseline fingerprint (stale-target check). But `update_block` replaces the whole block: there is no claim-level MCP write. Never a direct write, so the review half holds. |
| S6 | **`route_content` picks only shown cards**, is offered only when the router said NEEDS_CLARIFICATION, and a failure leaves the router's result. | **PASS** (offline) | placement.test › "the model step" (4 tests). Probe: a reply naming only unknown references gives `NEEDS_CLARIFICATION`, no targets, candidates unchanged. The dialog shows "Ask AI to decide" only when the decision is NEEDS_CLARIFICATION and the model has not answered yet. A live model was not run (no paid calls). The approved 2026-11-13 live check is in plan §10. |

### Quantitative: dev split only, all PROPOSED

The bars are scoped to Stage 2's job (section-level routing, a list a person picks from), not to Stage 5's.
Source: the `UPDATE_LOCATE_REPORT=1` run, which reproduced `baseline-dev.md` byte for byte, plus the probe.
"Margin" is how many cases could flip before the result changes.

| # | Criterion (PROPOSED) | Bar | Dev result | Result |
|---|---|---|---|---|
| Q1 | The dev baseline reproduces exactly (deterministic router, unchanged weights). | identical report | sha256 `96a472a7…` before and after: identical. Placed 8/60, section 30/54, found@1 11/47, found@3 27/47. | **PASS** |
| Q2 | Section-level routing: the top candidate's section is the expected one. | ≥ 50 % (2× chance) | 30/54 (56 %) | **PASS**, margin 3 |
| Q3 | When the router preselects a card (`route`), its section is right. | ≥ 2/3 | 23/33 (70 %) | **PASS**, margin 1 |
| Q4 | The expected card is on the list the dialog shows (top 5). | ≥ 70 % | 34/47 (72 %) | **PASS**, margin 1 |
| Q5 | The expected section is reachable from the shown list. | ≥ 90 % | 52/54 (96 %) | **PASS**, margin 3 |
| Q6 | Dev's labelled-ambiguous cases are asked (NEEDS_CLARIFICATION). | ≥ 3/5 | 3/5 | **PASS**, margin 0 |
| Q7 | When the router says NEW, no card fits (NEW precision). | ≥ 2/3 | 1/7. False NEWs: D001 and D047 (duplicates already on the canvas), D005, D021, D033 (table rows), D027 (new card in a section). Equivalently, 6/54 (11 %) of cases with a home are told "a new card on its own". | **FAIL** |

**Recorded, not gating Stage 2 (Stage 5's bar).** Router, dev:

| Metric | Result |
|---|---|
| found@1 | 11/47 (23 %) |
| found@3 | 27/47 (57 %) |
| placed | 8/60 (13 %) |
| into card | 1/47 (2 %) |
| action | 9/60 (15 %) |
| duplicate | 0/7 |
| nowhere | 1/6 |
| trapped | 16/20 (80 %) |
| cross-section trap right | 1/9 |
| clarification rate | 16/60, of which 3 are labelled ambiguous. Over-asking costs a click but is safe. |

## 3. Verification run (2026-11-15)

All offline. No paid AI call. The held-out split was not opened or scored by this pass.

| Command | Result |
|---|---|
| `UPDATE_LOCATE_REPORT=1 npx vitest run src/ai/router` | 5 files passed, 1 skipped. 68 tests passed, 3 skipped (the opt-in `EMBEDDING_SPIKE` tests). `baseline-dev.md` rewritten identical: same sha256 before and after, no git diff. The default suite also runs the existing held-out *integrity* checks (sha256 pin, schema parse, no shared sentences). Those read the file but score nothing. |
| `npx vitest run src/mcp/tools/search.test.ts` | 1 file, 7/7 passed, including `suggest_placement`. |
| `npx tsc --noEmit` (filtered to `src/ai/router`) | Exit 0. 0 errors repo-wide, 0 in `src/ai/router`. |
| `npx playwright test --project=local e2e/local/placeContent.local.spec.ts --trace off --output test-results/stage2-verify` | 3/3 passed (11.1 s) against the already-running dev server on :3000. Config `reuseExistingServer: true`; the server was not started or restarted. No interference observed. |
| Scratch probe (dev only, read-only, deleted after) | The numbers marked "probe" above: decisions route 37 / clarify 16 / NEW 7; Q3–Q7; S1–S3 invariants; the D1 and D2 reproductions. |

## 4. Defects

**D1. The clarification decision depends on `limit`** (`src/ai/router/router.ts`, `routeContent`):

```ts
const shown = candidates.slice(0, limit);
return { mode: "unanchored", ...decide(shown), candidates: shown, sections };
```

- `decide` sees only the first `limit` candidates. At `limit: 1` there is no second candidate, so a close call is
  `route`.
- MCP `suggest_placement` passes the caller's `limit`, which may be 1 (schema `min(1)`).
- **Reproducing test (proposed):** in router.test › 2c, the "ambiguous" fixture routed with `{ limit: 1 }`
  expects `NEEDS_CLARIFICATION`. Today it returns `route`.
- **Dev evidence:** 16/16 clarifications flip at `limit: 1`. 0/60 decisions change at `limit: 10`.
- **Fix (not applied):** decide on `candidates`, then slice. Weights and thresholds don't change.

**D2. An escalated update is preselected** (`src/components/ai/PlaceContentDialog.tsx`, `find`): `setPicked` takes
`candidates[0]` whenever `decision === "route"`, including a CONTRADICTS/UNCLEAR `update`.
- Not unsafe on its own: the user still clicks Propose, and review shows "contradicts".
- It is inconsistent with Stage 1's rule that escalated intents need a decision.
- **Reproducing test (proposed):** a dialog/unit test that routes "Retries never happen with exponential backoff."
  over the gateway fixture and asserts nothing is preselected. Today `retries` is.
- Adopt as S4b only if the user agrees.

**Observations (not defects against the written spec):**
- **The MCP path is not claim-level** (S5b, above).
- **There is no cross-parent fixture** (B2b, above).
- **NEW on duplicates:** for 2 dev duplicates (D001, D047) the router says no card is close. If the user accepts
  the default, the content is added again as a stray card. This is Stage 5 duplicate work (5b exact hash), but it is
  the strongest argument for the Q7 policy option.

## 5. Recommendation

Don't mark Stage 2 verification complete yet. The smallest path to completion:
1. **Fix D1** with its test. A router one-liner, no tuning.
2. **The user rules on Q7:** recorded-only (Stage 5-owned), or the "don't preselect NEW" policy.
3. **The user rules on S5b:** amend the wording, or require an MCP claim-level write before Phase 5.
4. **The user rules on S4b:** adopt and fix (one line in the dialog), or drop.
5. **Add the B2b fixture.** If it fails on the hashed embedder, record it as Stage 5 scope rather than tuning.

After that, re-run the four commands in §3. For OpenUI Phases 4–5: unblock on this criterion only with the
conditions in §1 (human-confirmed placements; candidates presented as a list, not an answer).

## Integrator follow-up (2026-11-15)

**D1 fixed:**
- `routeContent` now decides on the full ranking, then cuts the list to `limit` (`src/ai/router/router.ts`).
- New check in `router.test.ts` "ambiguous": `{ limit: 1 }` gives NEEDS_CLARIFICATION with one candidate shown.
- `npx vitest run src/ai/router src/mcp/tools/search.test.ts src/components/ai`: 116 passed, 3 skipped.
- `baseline-dev.md` is unchanged (no diff).

**S3 now passes.**

**Still open, user decisions:** Q7, S5b wording, S4b/D2, and the B2b cross-parent test.

## User decisions 2026-11-15 applied

**What changed** (no router weight, threshold or scoring change; `src/mcp`, `src/ai/changes`, `src/app/api` untouched):
- **Q7, "don't preselect NEW":** NEW now starts with nothing picked. The banner reads "No confident match: no card is
  close to this…". The router's candidates and their evidence are still listed.
- **S4b/D2, adopted:** an `update` candidate with `claim.escalate` (CONTRADICTS, UNCLEAR) is never preselected, even
  when the decision is `route`. The banner says the change contradicts or rewrites what the card says.
  NEEDS_CLARIFICATION was already unselected; now a test pins it.
- **Keep existing — no change:** a new, exclusive choice. Picking it clears the other picks, and picking anything else
  clears it. Propose then closes the dialog with a toast. It proposes nothing and records no routing signal: keeping
  the notes says nothing about where the content belongs.
- **Propose** stays disabled until something is picked, in every unselected state.
- **"Ask AI to decide" (`route_content`):** the cards the model picks are preselected, but never an escalated update.
  A model "new" no longer preselects "A new card on its own".
- **Code:** the policy is pure functions in `src/ai/router/placement.ts`: `defaultPicks`, `modelPicks`, `togglePick`,
  `choicesFor`, `isEscalated`, `NEW_CARD`, `KEEP_EXISTING`. `PlaceContentDialog.tsx` uses them.

**Tests:**
- `placement.test.ts` › "what the dialog picks first": 8 new tests. They cover the D2 reproduction ("Retries never
  happen…" routes, top escalated, nothing picked).
- `e2e/local/placeContent.local.spec.ts`: 2 new tests (contradiction + Keep existing; NEEDS_CLARIFICATION) and the
  NEW test reworked. 5/5 passed.
- `npx vitest run src/ai/router src/components/ai`: 117 passed, 3 skipped. `tsc` and eslint are clean.

**Status:**
- **Q7:** the policy option is applied. The precision metric (1/7) is unchanged by design. A false NEW now costs an
  explicit choice, not a stray card.
- **S4b:** adopted, **PASS** (D2 fixed).
- **S5b:** the user allowed whole-block `update_block` for Phase 4 through the reviewed ChangeSet path, with
  conditions. Verified against those conditions:
  - Review shows no before/after diff for a clean `update_block`.
  - Formatting outside the agent's Markdown is not preserved.
  - Repo-map auto-accept can write an `update_block`.
  
  These gaps are in owner-gated code, so S5b stays **open** until they are fixed or the conditions are relaxed.
- **MCP `suggest_placement` wording**, noted only: it still says NEW is "create one" / "create a new card", and only
  CONTRADICTS "needs the user's decision", although `needsDecision` covers UNCLEAR too.
