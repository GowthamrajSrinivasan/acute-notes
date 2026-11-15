# Claim–condition evaluation specification v3 (2026-11-13)

The reference specification for evaluating whether generated notes keep the conditions that limit their claims.
- **Replaces:** the phase 2 protocol (v1) and the phase 3 protocol (v2) as the instructions for **new** labelling. Both
  stay in place, with their snapshots, as the record of how earlier results were produced.
- **Phase 4 decision (user, 2026-11-13):** rubric clarification and dataset correction only. No detector work, no
  model-assisted extraction, no paid calls, no production or gate changes.

## 1. Unit of annotation: the clause-level condition record

A record is **one limiting clause**: the smallest span of source text that limits, bounds, scopes or makes an exception
to a claim.

| Field | Meaning |
|---|---|
| `units` | The source unit id(s) the clause sits in. Usually one |
| `clause` | An **exact quote** of the limiting words, no longer than needed |
| `claimUnits` | The claim link: the unit(s) whose sentence states the claim the clause limits. For an intra-sentence condition, the clause's own unit |
| `claimQuote` | An exact quote of the claim |
| `verdict` | `claim`, `set`, `ambiguous` or `not_a_condition` (§2) |
| `deciding question` | For `ambiguous` only: the two readings and the question that would settle them |
| `confidence` | high, medium or low |

**Rules (they correct phase 3's merge error):**
- One unit with two limiting clauses gives **two records**. Example: kn-02 u11, "for up to the remaining 240 seconds"
  and "nothing the origin does will shorten that wait".
- **Overlapping spans are never merged.** Two records may share a unit.
- A unit that looks condition-bearing but limits nothing gets one `not_a_condition` record, so the decision is visible.

## 2. Rubric v3: verdicts

**Binding is a property of the source relationship.** It is decided from the source alone, before and without looking
at any generated note. Whether a note keeps a condition is a separate question, answered by the visibility outcomes
(§3).

**General test.** Restate the claim faithfully but without the clause. Then:

| Verdict | When |
|---|---|
| `claim` | The restatement becomes **false or misleading** in a case the clause describes, or would lead a reader to **act wrongly** |
| `set` | The reader's **takeaway is materially unchanged**, but the clause is a real limit, cost, scope or caveat the notes must contain somewhere |
| `ambiguous` | Careful readers could defend both. State the two readings and the deciding question. Never forced into claim or set; scored on its own |
| `not_a_condition` | An example, elaboration, mechanism, rationale, chronology, attribution, or an adjective with no limiting force |

**Clarified rules**, each applied through the general test:

| Situation | Rule | Decision |
|---|---|---|
| **R1. Instructions** (imperatives and procedure steps have no truth value) | Judge by the consequences of following the instruction without the constraint: if following it would do the wrong thing in a case the clause describes (break the procedure, lose data, ship an untested artifact, violate a stated rule), `claim`. If it would only be less efficient or less tidy, `set` | Approved as proposed |
| **R2. Hedged figures and epistemic caveats** ("an estimate, not measured", "the provider's figure, not ours", "probably", "not confirmed", "usually") | Decided from the source, independently of any generated output. `claim` when the source uses the figure or statement for a decision, or explicitly warns about its reliability, so a reader who took it as verified would decide differently. `set` when the hedge only colours a figure whose takeaway is the same verified or not. A source sentence that already contains the hedge is still a record: the hedge is the clause | Modified per your decision: never decided by whether a card dropped the hedge |
| **R3. Costs, trade-offs and "does not guarantee"** | Classified by whether omitting it materially changes the takeaway. `claim` when the source's point is the trade-off (the cost decides a choice, the benefit is presented as weighed against it, or the source says explicitly that the benefit is not guaranteed), so that without it a reader would believe the benefit is free or certain. `set` when the cost is real but secondary to a takeaway that stands without it | Modified per your decision: no default to `set` |
| **R4. Which claim (attachment)** | Link the clause to the **most specific** sentence whose claim it falsifies or would mislead. If two sentences qualify at different levels (a step and the section's summary), give one record per link only when both genuinely mislead without it. If you can't choose, `ambiguous` with both links | From phase 3, disagreement kind 1 |
| **R5. Is it a condition** | A descriptive adjective ("short-lived") is a condition only if a reader would act differently without it. A document-level scope note ("this document does not cover X") is `set`, linked to the summary claim it scopes, or `not_a_condition` if it scopes nothing stated | From phase 3, disagreement kind 3 |

## 3. Visibility (unchanged from v2)

What counts as the reader seeing a condition, per claim card, is the first of these that holds:

| Outcome | When |
|---|---|
| `carried` | The card's own text conveys it |
| `frame` | The card's frame label or takeaway conveys it |
| `arrow_label` | The label of an arrow touching the card or its frame conveys it |
| `linked` | A card-to-card arrow joins it to a carrier, or a cross-frame arrow does whose **label** is limiting or a dependency (requires, until, deferred until, blocked by, risk…) |
| `separated` | A carrier exists, but none of the above |
| `absent` | No node, frame or arrow label conveys it |

- Arrow types are not reader-visible.
- Chains of arrows never count.
- Citations never count.
- A carrier conveys the **clause**: a paraphrase is fine, but the specific limit must be recognisable.

## 4. Measures, kept separate

| Measure | Unit | Notes |
|---|---|---|
| Condition integrity | (claim card, `claim` record) pair | A failure is `separated` or `absent` |
| Integrity on ambiguous records | (claim card, `ambiguous` record) pair | Reported separately, never added in |
| Source coverage | Record (`claim` and `set`) | A gap is a record with no carrier |
| Assertion coverage | Golden coverage assertions | Unchanged evaluator |
| Missing citations | Claim cards not citing a claim unit; carriers not citing a condition unit | A provenance finding, never a semantic one |
| Reviewer agreement | Clause identification (does the other reviewer have a matching clause), verdict (four-way κ), claim link (exact, overlap, disjoint) | Each reported separately |

Clause records match across reviewers when their units overlap and their quotes overlap (one contains the other, or
they share at least half their significant words).

## 5. Populations, and how earlier counts relate

| Population | Count | What it is |
|---|---|---|
| Phase 2 blind records (R1) | **112** | kn-03–kn-12 |
| Phase 1 records | 20 | kn-01 4, kn-02 16; session-authored, not blind |
| Golden "limits" links mapped to recording units | 39 | Mapped by unit text; 2 unmappable links dropped |
| Phase 3 **candidates** | **134** | The 171 records above, merged where condition units overlapped; 31 candidates have more than one source. **The merge was the error §1 now forbids** |
| Second-reviewer additional proposals | **19** | 16 unique: both kn-02 reviewers proposed u40, u12 and u9. The phase 3 write-up said 17: wrong, corrected here |
| Phase 3 adjudicated records written | **153** | 134 candidates + 19 proposals |
| Phase 3 adjudicated records scored | **150** | 153 minus the 3 duplicate proposals |
| Phase 3 ambiguous | **37** | 36 `unresolved` + 1 `agreed` ambiguous (kn-02 c9: both blind reviewers independently said ambiguous) |
| Phase 3 R1-vs-R2 agreement items | 112 | One row per R1 record. Merged candidates contribute several rows, one per R1 source |
| Phase 3 A-vs-B agreement items | 17 | kn-01 4 + kn-02 13 candidates |
| Phase 3 reviewer-vs-golden items | 51 | 12 golden links in kn-01/kn-02 × 2 reviewers + 27 in kn-03–kn-12 × 1 reviewer |

## 6. Datasets

| Snapshot | Status | Use |
|---|---|---|
| Phase 2 (`phase2/FREEZE.json`) | Kept, unchanged | Record of phase 2 results |
| Phase 3 (`phase3/FREEZE-v2.json`) | Kept, unchanged | Record of phase 3 results; superseded as reference by v3 |
| **v3 (`phase4/FREEZE-v3.json`)** | The reference development dataset once reviewed | Clause-level records under rubric v3, kn-01–kn-12. **All 12 cases are development data:** inspected in earlier phases, so no performance claim may rest on them |
| **Sealed unseen set** (`phase4/sealed/`) | Sealed, not opened | See §7 |

## 7. Sealed unseen evaluation set

- **Contents now:** kn-13-connection-pool-runbook. Its source and its saved 2026-10-19 distil and preserve recordings
  are hashed in `phase4/sealed/MANIFEST.json`. Nobody working on this evaluation has opened them.
- **Caveat:** kn-13 is part of the golden dataset, which earlier pipeline work may have used, so it is unseen *by this
  evaluation*, not by every part of the pipeline.
- **Too small for a performance claim on its own.** Adding cases needs separate decisions, because new sources must be
  authored (AUTHORING.md) and generated by an **approved paid run**.

**Procedure** (it has not been run):
1. Approve this specification.
2. Hash it into the seal.
3. Two blind annotators label clause records under §1–§2.
4. An adjudicator labels visibility under §3 and freezes the labels.
5. **Only then** is any checker, rule or detector scored, once. A change after that is a new, labelled run against the
   same frozen labels.
