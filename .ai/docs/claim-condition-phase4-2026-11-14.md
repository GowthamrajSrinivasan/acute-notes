# Claim–condition phase 4: rubric clarification and dataset correction (2026-11-13/14)

Status: **evaluation foundation ready for your review; nothing active.**
- **Decision (user, 2026-11-13):** rubric clarification and dataset correction only.
- **Not done:** detector development, model-assisted extraction, paid calls, production or gate changes, changes to
  `AIMetadata`, domain types or `ai/changes`.
- **No checker, rule or detector was scored in this phase.** Cost: $0.

## What to review

All under `evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/phase4/`:

| File | Contents |
|---|---|
| `EVAL-SPEC-v3.md` | **The revised specification:** clause-level records, rubric v3 with your decisions, explicit ambiguity, visibility, measures, population reconciliation, sealed-set procedure |
| `DATASET-v3.md` | **The corrected snapshot's card:** 270 clause records, every annotator record traced (`FREEZE-v3.json`) |
| `sealed/MANIFEST.json` | **The sealed unseen set** (kn-13, hashed, unopened) |
| `INCIDENT-kn03-golden-reading.md` | **The kn-03 investigation** |

## 1. Decisions applied

| Decision | How it was applied |
|---|---|
| Instructions judged by consequences (approved) | Rubric R1: if following the step without the constraint would do the wrong thing, `claim` |
| Hedged figures (modified) | Rubric R2: binding decided from the **source alone**: `claim` when the source relies on the figure for a decision or warns about its reliability. Never decided by whether a card dropped the hedge |
| Cost caveats (modified) | Rubric R3: `claim` when omitting the cost materially changes the takeaway (the source's point is the trade-off, or it says the benefit isn't guaranteed); no default |
| Clause-level coverage (approved) | One record per limiting clause; spans never merged (spec §1) |
| kn-03 investigation (approved) | Done, §5 |
| Fresh unseen set (approved) | kn-13 sealed, §6 |
| Detector v2, model-assisted extraction | Deferred: not done |
| Production integration | Not approved: not done |

Rubric v3 also adds R4 (which claim a clause attaches to) and R5 (whether it is a condition at all), from phase 3's
disagreement kinds.

## 2. Reviewer agreement (two blind annotators per case, clause level)

| Measure | Phase 3 | **Phase 4 (rubric v3)** |
|---|---|---|
| Finding the same clauses | n/a (spans given) | **F1 0.95**: 230 of 242 matched |
| Unit has a condition, yes/no | n/a | 0.97 (κ 0.82), 206 units |
| claim vs set | 0.78, κ 0.56 | **0.90, κ 0.74** |
| Four-way verdict | 0.82, κ 0.73 (kn-01/02 only) | 0.85, κ 0.66 (all 12 cases) |
| Ambiguous calls per annotator | about 5% | 3–5% |
| Claim link: exact / overlap / disjoint | 69% / 18% / 13% | 83% / 1% / **16%** (191 / 2 / 37) |

Verdict agreement by rule: R5 0.91, R1 0.88, R3 0.87, general 0.82, R2 0.79, **R4 0.74**.

- **The rubric clarifications worked for binding:** κ rose from 0.56 to 0.74.
- **They didn't work for attachment.** The claim link is still 16% disjoint, and R4 has the lowest agreement. The 37
  disjoint links split evenly:
  - 18 where one annotator tied the clause to its own sentence and the other to a different one (kn-02 u55, a table
    row vs. the TTL claim in u8);
  - 19 where both tied it elsewhere, usually to a neighbouring sentence (kn-02 u49 to u45 vs. u46).

**Caveat:** rubric v3 moves the boundary towards `claim`. On the 230 matched pairs, 145 are claim/claim and 48 are
set/set. Phase 3 and phase 4 binding counts aren't comparable one-to-one.

## 3. Adjudicated binding distribution (snapshot v3, 270 records)

| Verdict | Agreed | Adjudicated | Unresolved | Total | Phase 3 (150 records, merged spans) |
|---|---|---|---|---|---|
| claim | 118 | 50 | – | **168 (62%)** | 51 (34%) |
| set | 43 | 32 | – | **75 (28%)** | 53 (35%) |
| ambiguous | 1 | – | 6 | **7 (2.6%)** | 37 (25%) |
| not_a_condition | 15 | 5 | – | **20 (7%)** | 9 (6%) |

**Ambiguity fell from 25% to 2.6%.** Most of phase 3's ambiguity came from rubric gaps (costs, instructions, hedges)
and from merged spans holding two clauses with different answers. Both are now addressed.

## 4. What the saved notes did (adjudicated labels, descriptive, no checker scored)

**Condition integrity**, per claim card × `claim` record; a failure is `separated` or `absent`:

| Note set | Pairs | carried | frame | arrow_label | linked | **separated** | **absent** | Failure rate |
|---|---|---|---|---|---|---|---|---|
| Distil, kn-03–kn-12 | 259 | 132 | 22 | 2 | 18 | **83** | **2** | **33%** |
| OpenUI v1, kn-01/02 | 35 | 12 | – | – | – | 18 | 5 | 66% |
| OpenUI v2, kn-01/02 | 44 | 12 | – | – | – | 30 | 2 | **73%** |

Ambiguous records: 11 pairs, reported apart (8 separated).

**Source coverage**, `claim` and `set` records with no carrier anywhere:

| Note set | Gaps / records | Which |
|---|---|---|
| Distil | 2 / 199 | kn-05 "For config, maybe."; kn-06 "a collection with fewer exact identifiers may see a smaller [gain]" |
| OpenUI v1 | 11 / 44 | All kn-02 |
| OpenUI v2 | **3 / 44** | kn-02: "nothing the origin does will shorten that wait", "so they still need a TTL, a purge or both", "Cannot be shortened after the fact" |

- **Clause level brings back exactly the gaps phase 1 found.** The phase 3 snapshot had hidden them by merging spans.
- **OpenUI v2 improved coverage over v1** (11 gaps to 3) **but not integrity** (66% to 73% failing). This supports
  phase 3's finding: the v2 prompt helped protected details reach some card, not the claim's own card.

## 5. Investigation: kn-03 accidental modification

**What happened.** The kn-07–kn-09 adjudicator ran `sed -i` over `phase3/adjudicated/*.json` instead of its own three
files. It changed one field in another adjudicator's file: kn-03 record c5's golden reading `verdict`, from `"claim"`
to `"link only (golden gives no binding)"`. The kn-03–kn-06 adjudicator then copied the phrase into its kn-04–kn-06
files on purpose.

**Facts.** Both adjudicators' own accounts (asked "facts only, modify nothing") and the file timestamps establish:
- the original value was `"claim"`;
- no other content in another adjudicator's file changed.

**Impact: none.** Golden links carry no binding, and no scoring or agreement code reads reading-level verdicts. The
phase 3 snapshot hashes the modified file; it is left as is, with the incident note as its correction record.

**Process fixes, applied in phase 4:**
- explicit-path writes only, no shell writes;
- golden readings carry no verdict;
- annotation files hashed on arrival.

No cross-file write occurred in phase 4.

## 6. Sealed unseen set

- **kn-13-connection-pool-runbook:** source, case files and three saved recordings, 18 files, hashed in
  `sealed/MANIFEST.json`. Nobody in this evaluation has read them.
- **Disclosure:** phase 2 printed kn-13's node and arrow counts. kn-13 is in the golden dataset, so earlier pipeline
  work may have used it.
- **One case is too small for a performance claim.** Adding cases needs new sources (AUTHORING.md) and an approved
  paid generation run: a separate decision.
- **The seal's spec field stays empty until you approve `EVAL-SPEC-v3.md`.** Labelling of kn-13 starts only after
  that (spec §7).

## 7. Counts reconciled

| Phase | Reconciliation |
|---|---|
| **Phase 3** | 112 R1 records + 20 phase 1 records + 39 golden links = 171, merged into **134** candidates (31 with more than one source). Plus **19** second-reviewer proposals (the phase 3 report said 17: corrected; 16 unique) = **153** adjudicated records written. Minus 3 duplicates = **150** scored. **37** ambiguous = 36 unresolved + 1 agreed ambiguous (kn-02 c9) |
| **Phase 4** | 484 annotator condition records + 37 not_a_condition records: **all** are in adjudicated records except 4, which were rejected with reasons. Giving **270** records: 253 from both annotators, 10 X-only, 7 Y-only, including 6 from splitting two-clause records. **7** ambiguous = 6 unresolved + 1 agreed ambiguous (kn-11 u33) |

Full tables: spec §5 and `DATASET-v3.md`.

## 8. Remaining disagreements

**Unresolved (6):**

| Kind | Records | Deciding question |
|---|---|---|
| Debate status in a transcript | kn-05 u72 | Does a rebuttal in an unresolved debate count as a reliability warning? |
| Attachment (corrected 2026-11-14, was listed under debate status) | kn-05 u56 | Does a proposal sentence need its own claim link when the agreed decision restates it? |
| Scope of a universal claim | kn-09 u35, kn-10 u48 | Does "every invoice gets its tax" or "every part has tests" really cover the excepted case? |
| Whether current state weighs the comparison | kn-04 u27 | "today only the email handler is" |
| Deliverable scope | kn-11 u35 | Are the first dashboards a phase 1 deliverable? |
| + 1 agreed ambiguous: a source self-contradiction | kn-11 u33 | 30 vs 90 days: the same store or two? |

**Settled, but the main source of disagreement:** attachment (R4) decided 30 of the 87 adjudicated records, and 16%
of annotator claim links are disjoint. If the evaluation keeps one claim link per clause, adjudication carries a
large share of the decisions.

**Proposed for your decision:**
- Allow a clause to carry **up to two claim links**, its own sentence and the section claim, both scored. This would
  absorb the 18 local-vs-section disagreements.
- Or define a single attachment level in R4.

## 9. Before any performance claim

1. **Your review of `EVAL-SPEC-v3.md`,** including the R4 attachment choice (§8).
2. **A human spot check** of a stratified sample of snapshot v3. Every annotator and adjudicator here is a Claude
   model, so agreement between them may overstate agreement between people.
3. **Label the sealed kn-13 under the approved spec** (two blind annotators plus an adjudicator), freeze, and only
   then score anything, once.
4. **More unseen cases,** which need authoring and an approved generation run.

The ChatGPT MCP write test stays blocked on the integrator's stale-target fix (P0).
