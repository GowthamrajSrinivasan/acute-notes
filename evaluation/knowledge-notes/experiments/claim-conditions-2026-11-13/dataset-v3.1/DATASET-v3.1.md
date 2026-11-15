# Dataset card: claim–condition dataset v3.1-pre (2026-11-15)

**Status: provisional. Not yet the reference dataset.** The reference waits on two-human re-adjudication of the
queue below (`READJUDICATION-QUEUE.json`, 64 records). `FREEZE-v3.1.json` is a **provisional** freeze (v3.1-pre).

- **Protocol:** `review-v3/EVAL-SPEC-v3.1-AMENDMENT.md`, approved by the user as the evaluation protocol on 2026-11-15.
- **Base:** frozen snapshot v3 (`phase4/FREEZE-v3.json`, 41 files). It's verified before and after migration and
  never edited.
- **kn-13 stays sealed.** Nothing in this folder reads, labels or scores it. Development cases kn-01 to kn-12 only.
- **No AI calls.** No label here comes from a model's judgment made during this migration.

## How it was built

`migrate.mjs` is deterministic: no clock, no randomness, byte-reproducible (the test checks this). It refuses to run
if FREEZE-v3, the human answer hashes (`ANSWERS-HASH.json`) or the sample key hash don't match.

1. **Shape.** Each v3 record becomes a `ClauseRecordV31`:
   - its single link becomes `links[0]`;
   - `binding` is the record verdict;
   - `presentation: "one_carrier"`;
   - `claimQuote` and `justification` are copied from the v3 `claimQuote` and `rationale`.
2. **Link level.** It's derived mechanically, exactly as in `review-v3/attachment.mjs`:
   - `local`: the clause's own unit, or the adjacent unit under the same heading path;
   - `section`: elsewhere in the clause's section or an enclosing one.
   - **28 single links are `elsewhere`** (the claim is outside the clause's section). The schema has only two
     levels, so they're carried as `section` with `levelDerived: "elsewhere"` kept for a human to confirm.
3. **Evidence is never invented.** v3 has no evidence spans, so **every link's `evidence` is
   `"migrated: needs evidence"`** (248 of 248). The validator accepts the marker. A human evidence pass is still needed
   before any section-link scoring.
4. **Claim-split records.** These are records v3 split by claim: same case, units and clause, with disjoint links.
   Two were found:
   - **kn-08 k7 + k8** ("If the Reranker does not respond within 800 ms"): u25 is local and u21 is section-level, so
     they're **merged** into `k7+k8`, one record with two links.
   - **kn-11 k14 / k15** ("once the mobile SDK is ready"): u36 is local and u5 is `elsewhere`, so they're **kept as
     two records** (A1 allows two links only as one local and one section).
   - The other v3 splits in kn-06 and kn-09 split *clauses*, not claims, so they're unaffected.

## Human corrections: the only label changes

These are applied only where **both humans agree with each other and differ from the model reference on the
verdict** (`humans_agree_model_differs`). The pattern is re-checked against `answers-A.json` and `answers-B.json`
directly. Every corrected record has `status: "human_adjudicated"` and records its provenance: the item, both
reviewers' verdicts and links, and the sha256 of both answer files and the sample key.

| Item | Record | v3 → v3.1 | Link |
|---|---|---|---|
| H05 | kn-11 k12 "90 days" | ambiguous → not_a_condition | none: both humans gave none |
| H06 | kn-09 k12 | ambiguous → set | **`needs_human_readjudication`**: A u31, B u35; v3 u18 kept as a placeholder |
| H08 | kn-06 k1 "Its weakness is vocabulary mismatch" | claim → set | u7, unchanged (both humans and v3 agree) |
| H12 | kn-05 k8 | ambiguous → claim | **`needs_human_readjudication`**: A u54, B u59; v3 u56+u59 kept as a placeholder |
| H17 | kn-02 k21 "but not on live election results" | claim → set | u40 (local), the link **both humans** gave, replacing v3's u37 |
| H22 | kn-10 k14 | ambiguous → not_a_condition | none: both humans gave none |

**Unchanged where the humans split:** H10, H16, H18, H21, H24, H26, H27, H28 and H35 (listed in
`MIGRATION-LOG.json` `humanSplitsUnchanged`).

H10 and H16 are worth noting:
- both humans reject `claim`, but split between `set` and `not_a_condition`;
- they stay `claim` until adjudicated.

## Counts

| | v3 | v3.1-pre |
|---|---|---|
| Records | 270 | **269**: 270 − 2 merged + 1 merged record |
| claim | 168 | 166 |
| set | 75 | 78 |
| ambiguous | 7 | 3 |
| not_a_condition | 20 | 22 |

| Status | Records |
|---|---|
| `migrated` | 262 |
| `migrated_merged` | 1 |
| `human_adjudicated` | 6 |

**Validation (`validateClauseRecordV31`):**
- 269 of 269 records pass.
- 248 links: 152 local and 96 section, of which 28 were derived as `elsewhere`.
- 1 record has two links.
- 248 links carry the needs-evidence marker.
- 2 links need human re-adjudication.

## Re-adjudication queue: 64 records, for two humans, not decided

It's in `READJUDICATION-QUEUE.json`, with a blind packet `READJUDICATION-PACKET.md` and a template
`READJUDICATION-ANSWERS.template.json`. The packet uses the format of `review-v3/human-review/PACKET.md` and shows no
reference, annotator or earlier-human labels. Item order is a fixed hash.

| Reason | Records |
|---|---|
| `finding1_pattern` | 49 |
| `second_link_evidence` | 13 records (all 14 annotator-proposed candidates; kn-08 `k7+k8` holds two) |
| `reference_ambiguous_unsettled` | 3: kn-04 k11, kn-05 k19 and kn-11 k13 (H26, H35, H27; the humans split) |
| `link_needs_human_readjudication` | 2: kn-05 k8 (H12) and kn-09 k12 (H06) |

Three records carry two reasons (kn-02 k7, kn-06 k13 and kn-07 k5), so the queue holds 64 distinct records.

### Finding 1 criteria (`DISCREPANCY-REPORT-2.md` finding 1), mechanical and over unsampled records only

| Criterion | Selects |
|---|---|
| Base: v3 verdict `claim` and rule ∈ {R3, R4, general}, not in the 36-item sample | 103 |
| (a) the phase 3 reading was `set` | 30 |
| (b) a clause cue matches: `contrast` (but / rather than / instead / whereas / however) | 8 |
| (b) a clause cue matches: `exclusion` (not / n't / never / nothing / none / no), unless the clause opens with if / when / unless / until / once / after / before / while | 25 |
| (b) a clause cue matches: `consequence` (so … / which means) and `weakness` (weakness / drawback / downside / limitation) | 0 |
| (b) any cue | 31 |
| (a) and (b) | 12 |
| **Queued: (a) or (b)** | **49** |
| Not queued: R1 records with phase 3 `set` (H10 was R1, but the report's recommendation names R3, R4 and general) | 3 |

**This selection is deliberately wide.** It finds candidates for the humans to look at; it isn't a judgment that
they're wrong. The exact regexes are in `MIGRATION-LOG.json` `finding1Rules`.

## What's open before v3.1 can be the reference

1. **Two independent humans answer the 64-item packet.** Where they agree, the records are updated by a new
   documented migration step. Where they disagree, the record stays as it is, or `ambiguous` with both readings.
2. **Evidence spans for links,** at least for every `section` link, plus confirmation of the 28 `elsewhere` levels.
3. **Rubric text** for finding 1 and the R5 schedules question (report recommendations 1 and 5). These need a user
   decision; this migration doesn't make them.
4. **Then a final freeze,** v3.1 replacing v3.1-pre. Only after that can kn-13 be labelled, with separate
   authorization.

## Files

| File | Contents |
|---|---|
| `migrate.mjs` | The migration |
| `freeze.mjs` | Writes `FREEZE-v3.1.json` |
| `records/<case>.json` | 12 files of v3.1 records |
| `MIGRATION-LOG.json` | Input hashes, merges, kept splits, corrections, splits left unchanged, criteria and summary |
| `READJUDICATION-QUEUE.json`, `READJUDICATION-PACKET.md`, `READJUDICATION-ANSWERS.template.json` | The queue, the blind packet and the answer template |
| `datasetV31.test.ts` | The test |
| `FREEZE-v3.1.json` | The provisional freeze |

Run the test from the repo root:

```
npx vitest run --config vitest.evaluation.config.ts evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/dataset-v3.1
```
