# Human spot check: two-reviewer discrepancy report (2026-11-15)

**Inputs:**
- **Reviewer A:** `answers-A.json`, from "Gowthamraj".
- **Reviewer B:** `answers-B.json`, from "R2".
- **Provenance:** both are byte-identical copies of the files the user supplied, hashed in `ANSWERS-HASH.json`. Both
  answer all 36 items. No AI-generated answers were used.

**Output:** `discrepancies-2.json`, from `compare2.mjs`. Snapshot v3 is unchanged. The causes below are proposed by
the integrator (a Claude model) for discussion; the `cause` fields are left empty for the human decision.

**Caveats:**
- **Blindness:** reviewer A had seen earlier phase reports that named the unresolved records. Reviewer B's
  independence is as the user reported it.
- **Sample:** 36 items, deliberately enriched with hard cases (unresolved records, attachment, rubric-changed
  records). These figures describe this sample, not the dataset. They aren't comparable one-to-one with phase 4's
  model–model κ, which was measured on all records.

## Agreement

| Pair | Verdict agreement | Verdict κ (4-way) | claim/set agreement | claim/set κ | Claim links exact / overlap / disjoint |
|---|---|---|---|---|---|
| **Human A – Human B** | **27 / 36 (75%)** | **0.62** | 22 / 26 | **0.68** | 19 / 1 / 7 |
| Human A – model reference | 22 / 36 (61%) | 0.43 | 19 / 25 | 0.51 | 20 / 1 / 9 |
| Human B – model reference | 25 / 36 (69%) | 0.56 | 21 / 24 | 0.73 | 17 / 1 / 10 |

**Item patterns:**

| Pattern | Items |
|---|---|
| All three agree | 21 |
| **Humans agree, model differs** | **6**: H05, H06, H08, H12, H17, H22 |
| Humans split, one with the model | 5: H18, H21, H24, H27, H28 |
| Three-way split | 4: H10, H16, H26, H35 |

**All three agree on every** R2 hedge, R3 cost and not-a-condition item.

## Findings

### 1. Rubric v3's `claim` boundary is too wide for contrasts, consequences and usage exclusions (confirmed on 4 items)

- **Both humans reject `claim` on four items:**
  - H08 "Its weakness is vocabulary mismatch": set, set;
  - H17 "but not on live election results": set, set;
  - H10 "so they still need a TTL, a purge or both": set, not a condition;
  - H16 "not a way to make content fresher": set, not a condition.
- **All four were `set` in phase 3.**
- **What they share:** a contrast or consequence already stated by a neighbouring sentence, or a usage exclusion that
  leaves the claim literally true.
- **Not confirmed for bounds and applicability conditions:** H21 ("at most 5 attempts") and H28 ("where a minute of
  staleness is acceptable") split the humans one each way.
- **Proposed cause:** `rubric_gap`, in the general test and R4. The rubric doesn't say whether a reader possibly
  over-generalising is enough for `claim` when the stated claim stays literally true.

### 2. Several reference-`ambiguous` records were settled the same way by both humans

| Item | Humans |
|---|---|
| H05, the 30/90 days contradiction | not a condition, both |
| H22 | not a condition, both |
| H06 | set, both; claim links differ, u31 vs. u35 |
| H12 | claim, both; claim links differ, u54 vs. u59 |

- **The other 3 unresolved items still split** (H26, H27, H35), and **B itself marked H27 ambiguous**, so `ambiguous`
  stays a real outcome.
- **Proposed cause:** `source_ambiguous`, as the models judged it, but two humans settled 4 of 7 without effort.
  These are candidates for re-adjudication in a new version, not proof that v3 is wrong.

### 3. Attachment is hard for people too

- **The humans' claim links are disjoint on 7 of 27 items** where both gave a link.
- **Where they agree with each other and not the reference,** they pick the clause's own sentence over the section
  claim (H17, H28: u40 over u37).
- **This supports the v3.1 two-link rule:** a local link first, a section link only with evidence. It also shows that
  a single-link score will always carry disagreement. **Proposed cause:** `attachment_level`.

### 4. R5 for schedules and frequencies stays open

H18 "Every 10 minutes": A says not a condition, B says set at low confidence, the reference says set.

## Recommendation on formal adoption of the dataset

**Don't adopt snapshot v3 as the reference as it stands.** The human evidence shows one systematic issue (finding 1)
and a resolvable-ambiguity issue (finding 2). Under the agreed rule, that means proposing a revised version, not
patching v3.

Proposed **dataset v3.1**, for your decision, built by documented migration with new hashes:
1. **Rubric text, general test and R4:** "A contrast or consequence already stated nearby, or a usage or scope
   exclusion, that leaves the stated claim literally true is `set` unless the source shows a reader would act wrongly
   without it." Bounds and applicability conditions keep the current test; the humans split on them.
2. **Re-adjudicate the `claim` records matching that pattern** across all 12 cases: find them by rule (R3, R4, general)
   and clause type, with two-reviewer adjudication, not models alone. Count them first.
3. **Re-adjudicate the reference-`ambiguous` records** with the two humans' readings as input. Keep `ambiguous`
   where they disagree.
4. **Apply the v3.1 two-link attachment** (already approved).
5. **R5:** add a sentence on schedules and frequencies.

Then freeze v3.1, and only after that label the sealed kn-13 under it, with separate authorization. kn-13 stays
sealed.
