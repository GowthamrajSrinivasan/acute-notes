# Claim–condition phase 3: reviewer agreement, visibility v2, OpenUI coverage (2026-11-13)

Status: **offline evaluation and annotation only; nothing active.**
- Follows [phase 2](./claim-condition-phase2-2026-11-13.md).
- **Approved:** a second blind review, a visibility amendment, and coverage on the saved OpenUI output.
- **Not approved, and not done:** detector v2, model-assisted extraction, paid calls, generation changes, production or
  gate changes, changes to `AIMetadata`, domain types or `ai/changes`.
- The prototype detector was **not** re-scored. The frozen phase 2 final set was not touched; all 21 of its frozen
  files still match their hashes.

Files are in `evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/phase3/`:

| File | Contents |
|---|---|
| `PROTOCOL-v2.md` | The amended protocol |
| `ADJUDICATION.md` | The adjudication instructions |
| `candidates.json`, `review-packets/` | What the second reviewers saw |
| `review2/` | The blind second reviews, hashed on arrival in `REVIEWS-HASH.json` |
| `agreement.json` | Agreement statistics |
| `adjudication-packets/`, `adjudicated/` | The adjudication inputs and outputs |
| `FREEZE-v2.json` | The new snapshot |
| `report.json` | Scored once from the snapshot |

Code: `build.test.ts`, `openuiPackets.test.ts`, `agreement.test.ts`, `score.test.ts`. Cost: $0.

## 0. Method, and what to discount

**Candidates.** 134 candidate conditions in 12 cases: the phase 2 records (kn-03–kn-12) and the phase 1 records
(kn-01/kn-02), plus the golden dataset's "limits" links. Where condition spans overlapped, they were merged into one
candidate. **That merge was a mistake for coverage** (§5): it hid two clause-level gaps.

**Second review, blind.** Five fresh reviewers saw only the source and the condition span: not who proposed it, its
claim link or its binding.
- kn-01/kn-02 had no earlier blind relationship labels, so each got **two** fresh reviewers (A, B).
- kn-03–kn-12 each got one (R2), compared with its phase 2 reviewer (R1).
- Reviewers could also add conditions: **19** additions (corrected in phase 4; first written as 17). 3 were proposed
  by both kn-02 reviewers and are counted once, so 16 are unique. Population reconciliation:
  `phase4/EVAL-SPEC-v3.md` §5. The kn-03 sed slip is investigated in `phase4/INCIDENT-kn03-golden-reading.md`.

**Adjudication.** Four fresh adjudicators saw every reading and recorded each record's status:

| Status | Records |
|---|---|
| `agreed` | 88 |
| `adjudicated` (the source settles it) | 26 |
| `unresolved` (kept as `ambiguous`, never forced) | 36 |

They also re-labelled every note set under protocol v2. kn-01/kn-02 cover both saved OpenUI replies.

**Data status.**
- kn-05–kn-12 were inspected to amend the protocol, so they are now **evaluation-development data**.
- kn-01/kn-02 OpenUI was seen in phases 1–2: also development data.
- **kn-13 is untouched and reserved** as fresh unseen data. No performance claim below rests on unseen data.

**Discount for:**
- Model reviewers, not humans.
- R1 had two verdicts (claim, set) while R2 had four, so R1-vs-R2 binding agreement is over claim/set only.
- One slip: an adjudicator's `sed` changed one informational, unscored field in kn-03 (the golden reading's verdict
  text in record c5). It is noted in `FREEZE-v2.json`.

## 1. Reviewer agreement

| Comparison | Items | Binding / verdict agreement | Claim link: exact / overlap / disjoint |
|---|---|---|---|
| **R1 vs R2** (kn-03–kn-12) | 112 | claim vs set: **0.78, κ 0.56** (103 items both called claim or set) | **75 / 20 / 14** (69% / 18% / 13% of 109) |
| **A vs B** (kn-01/kn-02, both blind, four verdicts) | 17 | **0.82, κ 0.73** | 13 / 1 / 1 (of 15) |
| Reviewers vs the golden link | 51 | (golden has no binding) | 7 / 29 / 11 |

How R1 binding mapped to R2 verdict:

| R1 → R2 | claim | set | ambiguous | not_a_condition |
|---|---|---|---|---|
| **claim** (64) | 42 | **17** | 3 | 2 |
| **set** (48) | 6 | 38 | 3 | 1 |

- **The main disagreement is directional:** the first reviewers called 17 conditions `claim` that the second called
  `set`. Only 6 went the other way.
- **Agreement on whether something is a condition is high.** R2 called only 3 of R1's 112 records not a condition.
- Golden links are spans of whole knowledge units (several sentences), so "exact" is rare against them; disjoint is
  23%. The kn-04–kn-06 adjudicator also found golden unit ids misaligned there. Treat the golden comparison as a rough
  check only.

## 2. Adjudicated binding distribution

150 records after removing duplicates:

| Verdict | Agreed | Adjudicated | Unresolved | Total |
|---|---|---|---|---|
| claim | 45 | 6 | – | **51 (34%)** |
| set | 41 | 12 | – | **53 (35%)** |
| ambiguous | 1 | – | 36 | **37 (25%)** |
| not_a_condition | 1 | 8 | – | **9 (6%)** |

A quarter of all candidate conditions can't be settled from the source by careful reviewers. Unresolved records cluster
in decision and proposal documents: kn-04 (8), kn-06 (6), kn-11 (5) and kn-12 (5).

## 3. The updated visibility protocol (v2)

Full text: `phase3/PROTOCOL-v2.md`.
- **Arrow labels are reader-visible carriers.** The new outcome `arrow_label` means the label of an arrow touching the
  card or its frame conveys the condition.
- **Arrow types are not reader-visible.** They show only in the properties panel when the arrow is selected.
- **A cross-frame arrow counts as `linked` only if its label expresses a limiting or dependency relation.**

  | Counts | Doesn't count |
  |---|---|
  | requires, only if, until, before, deferred until, blocked by, limitation, caveat, risk | next step, leads to, example, details |

  Neither does an unlabelled frame-to-frame arrow.
- A card-to-card arrow counts, as in v1. Chains never count.

**What changed in the labels (distil, 97 claim-bound card pairs):** 6 outcomes moved for protocol reasons.

| Change | Cards | Where, and why |
|---|---|---|
| separated → `arrow_label` | 2 | kn-12: "kill switch tested before canary" on a frame arrow |
| linked → `arrow_label` | 1 | kn-10: "if successful" |
| separated → linked | 2 | kn-04: "requires more" |
| linked → separated | 1 | kn-11: "leads to" no longer counts |

Net, 3 fewer integrity failures. A further 52 label edits came from changed claim links, added records and merged
records, not from the protocol.

## 4. Condition integrity (adjudicated labels)

Per (claim card, claim-bound record) pair; a failure is `separated` or `absent`. Pairs on ambiguous records are reported
apart.

| Note set | Claim pairs | carried | frame | arrow_label | linked | **separated** | **absent** | Pairs on ambiguous records |
|---|---|---|---|---|---|---|---|---|
| Distil, kn-03–kn-12 (saved 2026-10-19) | 97 | 46 | 10 | 3 | 1 | **37 (38%)** | 0 | 78 |
| OpenUI v1, kn-01/kn-02 | 9 | 2 | – | – | – | **6** | **1** (kn-02: the 60 s bound nowhere) | 1 |
| OpenUI v2, kn-01/kn-02 | 10 | 2 | – | – | – | **8** | 0 | 4 |

**The existing rule checks against these labels** (a pair is flagged when its card is Needs review):

| Note set | TP / FP / FN | Precision / recall |
|---|---|---|
| Distil (97 pairs) | 12 / 20 / 25 | **0.38 / 0.32** |
| OpenUI v1 | 6 / 1 / 1 | 0.86 / 0.86 |
| OpenUI v2 | 2 / 1 / 6 | 0.67 / **0.25** |

**The v2 prompt made the rule checks blinder without fixing separation.** Its ⟨keep exactly⟩ and ⟨condition⟩
annotations cut Needs review cards (phase 1: 86% to 33% on kn-02). But 8 of 10 claim-bound cards still lack their
condition, and the rules now catch only 2 of them.

## 5. Source coverage (OpenUI, saved replies)

These are reported separately from integrity.

| | OpenUI v1 | OpenUI v2 |
|---|---|---|
| **Golden coverage assertions** (concept on the canvas) | kn-01 3/5, kn-02 9/9 | kn-01 **4/5** (fails critical `a.definition`), kn-02 9/9 |
| Golden co-location assertions (`source_fidelity`, scored as before) | kn-01 2 fail; kn-02 11 fail | kn-01 2 fail (window and reuse not on the replay card); kn-02 10 fail |
| **Adjudicated coverage gaps** (claim or set conditions on no card) | kn-02: 3 (c4, c8, a1), plus 1 ambiguous (c5) | **0 (understated, see below)** |

**Caveat on the v2 figure.** My candidate merge folded two clause-level conditions into broader neighbours:
- "nothing the origin does will shorten that wait" (u11) went into "the TTL is a guess" (u10);
- "they still need a TTL, a purge or both" (u50) went into "versioning does not help for HTML" (u49).

The reviewers judged the broader conditions, which the v2 cards do carry. Phase 1's two v2 coverage gaps are real but
are not visible in this snapshot. **Coverage records must stay at clause granularity:** never merge overlapping spans.

Distil (kn-03–kn-12): 0 coverage gaps, as in phase 2. Its "Limit:" restoration puts dropped clauses back.

## 6. Missing citations (separate from semantic failures)

| | Distil | OpenUI v1 | OpenUI v2 |
|---|---|---|---|
| Claim cards not citing a claim unit | 96 / 265 (36%) | 3 / 18 | 9 / 24 |
| Carriers not citing a condition unit | 87 / 227 (38%) | 2 / 15 | 9 / 29 |
| Integrity failures on cards that **cite** the claim | 14 | 5 | 4 |
| Integrity failures on cards that **don't** | 23 | 2 | 4 |

Citation gaps and semantic failures overlap, but each occurs without the other often. Neither predicts the other well
enough to stand in for it.

## 7. Remaining disagreements

36 unresolved records:

| # | Kind | Count | Examples |
|---|---|---|---|
| 1 | **Which claim it limits:** local sentence vs. section claim, success path vs. failure path, several plausible claims | 9 | kn-02 c5 (three different claims, all `set`); kn-07 c7 (photo stuck "processing" vs. the posting flow); kn-12 c4 (5% of requests vs. users) |
| 2 | **Cost, trade-off and "doesn't guarantee" caveats:** whether a cost falsifies a benefit claim. Reviewers split in **both** directions | 8 | kn-06 c12 "at some cost in recall"; kn-06 c9 "do not show whether the passage is current"; kn-04 c6 idempotency work vs. "almost no work" |
| 3 | **Is it a condition at all:** context, adjective, document-level scope | 8 | kn-07 c1 "short-lived" URL; kn-07 a1 design capacity; kn-11 c3 enrichment dependency |
| 4 | **Constraints on instructions:** an imperative step has no truth value, so the claim/set test doesn't fit | 6 | kn-03 c6 "same artifact, not a fresh build"; kn-03 c7 "once, from a single job"; kn-12 c8 "within 1 minute" |
| 5 | **Epistemic caveats:** estimate, provider's figure, "probably", "usually" | 5 | kn-04 c8 "12 hours is an estimate"; kn-09 c3 "not confirmed"; kn-12 c3 "usually; no minimum" |

Kinds 2, 4 and 5 are gaps in the rubric, not reviewer noise. The claim/set rule ("the sentence becomes false") doesn't
say how to treat costs, instructions or hedged figures.

**Proposed rubric additions, needing your decision:**
1. Instructions are judged as "would following the card do the wrong thing?" That makes a constraint on a step
   `claim`.
2. An epistemic caveat is `claim` when the card states the figure without the source's hedge, and `set` when the hedge
   is kept.
3. A cost is `set` unless the source presents the benefit as free.

## 8. Readiness

**Not ready for production integration, and nothing here argues for detector work yet.**
- **Binding needs more than a two-way choice.** Binding agreement is moderate (κ 0.56) and one record in four is
  genuinely ambiguous. Any future checker or gate must treat `ambiguous` as its own outcome, never pick a side.
- **Claim links are 69% exact between blind reviewers.** That is the realistic ceiling for scoring any extractor
  against single-reviewer labels.
- **The generated notes do have the defect.** In the saved output, 38% of claim-bound card pairs (distil) and 8 of 10
  (OpenUI v2) show the claim without its condition. The rule checks catch about a third.

**Before any performance claim:**
- the rubric additions in §7;
- clause-granularity coverage records (no merged spans);
- fresh, unseen cases: kn-13 plus new ones, labelled by two reviewers and adjudicated before anyone looks at results.

The ChatGPT MCP write test stays blocked on the integrator's stale-target fix (P0).
