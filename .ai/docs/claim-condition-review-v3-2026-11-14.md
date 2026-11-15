# Claim–condition: review of EVAL-SPEC v3 and snapshot v3 (2026-11-14)

Status: **spec and snapshot v3 provisionally approved pending review** (user decision 2026-11-14).
- **Waiting on a human reviewer.** The spot-check packet is built but has not been filled in.
- **Unchanged:** snapshot v3 (`phase4/FREEZE-v3.json`, re-verified, 41 of 41 files) and the sealed kn-13 (not read).
- **No checker scored, no paid calls.** Everything is under `evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/review-v3/`.

## 1. Attachment rule: bounded multiple claim links

**Schema (experimental only):** `review-v3/attachmentSchema.ts` (draft v3.1), with 5 tests that pass under
`vitest.evaluation.config.ts`.
- **Links:** a record carries 1 or 2 `links`, one `local` and one `section`.
- **Per link:** each has its own claim quote, evidence span, justification and binding.
- **Section links:** must have a positive evidence span.
- **Record verdict:** the strongest link binding.
- **Ambiguity:** an `ambiguous` record keeps both readings; a second link never replaces them.
- **Presentation is separate from attachment.** By default one visible carrier satisfies both links: one obligation, so
  no duplicate warning. `per_link` is allowed only when both links are claim-bound.
- **Untouched:** production types, `AIMetadata` and the update engine. v3 records were not migrated.

**Impact on development records:** `review-v3/attachment.mjs`, output in `attachment-impact.json`. The script refuses
to run unless FREEZE-v3 matches. Two definitions:
- **Local:** the clause's own unit, or the adjacent unit in the same section.
- **Section:** another unit in the clause's section or an enclosing section.

| Measure | Count |
|---|---|
| Records with a claim link (claim, set or ambiguous) | 250 of 270 |
| … with both blind annotators' links | 235: 194 exact, 2 overlap, **39 disjoint** (17%) |
| Disjoint pairs the rule can absorb (one local, one section-level) | **13** |
| Disjoint pairs it can't absorb | 26: 8 both section-level, 9 local vs. another section, 4 section vs. elsewhere, 3 both elsewhere, 2 both local |
| Records that could structurally gain a second link | **33** (12%); 35 candidate links |
| … proposed by a v3 blind annotator | **14** records. The other 21 links come only from phase 3's merged-span readings |
| **Unresolved records the rule would resolve** | **0 of 6**. Only one (kn-05 u56) has an attachment deciding question, and there one annotator says `not_a_condition`, so a second link wouldn't settle it |

**Findings:**
- **Small gain, upper bound.** The rule would cut disjoint links from 39 to at most 26 (17% to 11%). These are
  structural candidates only: whether each second link has the positive evidence the rule requires is a judgment this
  script can't make.
- **It reunites split records.** The adjudicators already split some clauses into two records, one per claim (kn-08
  k7 and k8, the same 800 ms clause). Under v3.1 those become one record with two links, and one presentation
  obligation instead of two.
- **It doesn't reduce ambiguity.** The six unresolved records turn on scope, debate status and deliverables, not
  attachment.

**Correction to the phase 4 report:** §8 listed kn-05 u56 under "debate status". Its recorded deciding question is
about attachment (R4: does a proposal sentence need its own claim link when the decision restates it). The counts are
unchanged.

**Recommendation:**
- Adopt the rule for **new** labelling only (kn-13 and later), as schema v3.1.
- Keep v3 records with one link.
- If v3.1 later becomes the reference, build a v3.1 dataset by documented migration with new hashes. Only the 14
  annotator-proposed candidates would need a second-link decision.

## 2. Human spot check: packet built, not yet done

All earlier labels came from Claude models, and I am one too, so I can't stand in for the human reviewer. The packet is
in `review-v3/human-review/`:

| File | Purpose |
|---|---|
| `PACKET.md` | **36 items**: the clause, the passage it sits in and instructions. No reference labels |
| `answers.template.json` | Copy to `answers.json` and fill in: verdict, up to two claim links, confidence, note |
| `SAMPLE-KEY.json` | The model reference labels. **The reviewer must not open it** |
| `SAMPLE-HASH.json` | Hashes of the packet, key, template and scripts, taken when the sample was built |
| `compare.mjs` | After the answers are in: verdict agreement, claim/set agreement, disjoint links, second links added, per stratum. Writes `discrepancies.json` with a mechanical difference kind and an empty `cause` to fill |

**Strata.** Sampled deterministically, one item per distinct clause, presented in shuffled order:

| Stratum | Items |
|---|---|
| Unresolved records | 6 |
| The 30 vs. 90 days contradiction (kn-11) | 1 |
| Two potential attachments (annotator-proposed) | 5 |
| Rubric v3 changed the phase 3 verdict | 5 |
| R1 instructions | 3 |
| R2 hedges | 3 |
| R3 costs | 3 |
| Clear `claim` | 4 |
| Clear `set` | 4 |
| `not_a_condition` | 2 |

**What happens to the results:**
- Human judgments stay in `answers.json` and `discrepancies.json`, separate from snapshot v3, which is never edited to
  match them.
- Causes are classified from a fixed list: `rubric_gap`, `model_misapplied_rubric`, `human_misread`,
  `source_ambiguous`, `attachment_level`, `other`.
- If a systematic problem shows up, the remedy is a proposed v3.1 dataset, not a patch to v3.
- About 36 items at 1–2 minutes each, roughly an hour. One reviewer gives a discrepancy report, not an agreement
  estimate; two reviewers would allow human–human κ.

## 3. Remaining disagreements (unchanged from phase 4)

**Six unresolved records:**
- kn-04 u27: the comparison weight of current state.
- kn-05 u56: attachment, where one annotator says it is not a condition.
- kn-05 u72: a debate rebuttal as a reliability warning.
- kn-09 u35 and kn-10 u48: the reach of a universal claim.
- kn-11 u35: deliverable scope.

**Plus** kn-11 u33, the source's 30 vs. 90 days self-contradiction.

All seven are in the human sample.

## 4. Recommendation on EVAL-SPEC v3

Approve it **as the labelling specification for kn-13**, with two additions recorded as v3.1:
1. the bounded two-link attachment above;
2. presentation counted once per record unless `per_link`.

**Approve snapshot v3 as the reference dataset only after the human discrepancy report.** If disagreement is
systematic in one rule, revise the rubric text and build v3.1 by migration before kn-13 is labelled. kn-13 stays sealed
until then.

## 5. Status, 2026-11-15: dataset v3.1-pre built (provisional)

**User decision:** EVAL-SPEC-v3.1-AMENDMENT approved as the evaluation protocol. Snapshot v3 stays frozen: FREEZE-v3
was verified 41 of 41, before and after. kn-13 stays sealed.

The new snapshot is
`evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/dataset-v3.1/`, described in `DATASET-v3.1.md`.
- **Records:** 270 v3 records became 269 v3.1 records. kn-08 k7+k8 were merged (local u25 plus section u21). kn-11
  k14/k15 were kept separate (local plus `elsewhere`).
- **Label changes:** only the 6 items where both humans agree and the model differs:
  - H05 and H22: ambiguous → not_a_condition;
  - H06: ambiguous → set;
  - H12: ambiguous → claim;
  - H08 and H17: claim → set.
- **Links still open:** H06 and H12 need human link re-adjudication.
- **Evidence:** every link carries `migrated: needs evidence`. No evidence was invented.
- **Re-adjudication queue:** 64 records for two humans, in a blind packet:
  - 49 match the finding 1 pattern (mechanical criteria);
  - 13 records hold the 14 second-link candidates;
  - 3 are still-split ambiguous records;
  - 2 are link re-adjudications.
- **Freeze:** `FREEZE-v3.1.json` is **provisional (v3.1-pre)**. Not the reference until the queue is adjudicated.
