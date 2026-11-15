# Claim–condition validation, phase 2: broader offline evaluation (2026-11-13)

Status: **evaluated offline; not ready to request production integration.** Follows
[claim-condition-prototype-2026-11-13.md](./claim-condition-prototype-2026-11-13.md).

Decision (user, 2026-11-13): approve the next offline phase, in this order:
1. Expand the reviewed set to kn-03–kn-12.
2. Evaluate automatic extraction.
3. Extend the protected-details check to omitted qualifying clauses.
4. Track citation completeness separately.
5. Condition-aware generation, but only once extraction and validation are credible.

Requirement: **correct citations alone never count as preservation.** A claim-bound condition must be in the card's
visible content, or reached through an explicit, stable, reader-visible link.

Constraints honoured:
- **Cost:** $0. No model call and no new generation.
- **Data:** saved output only, the approved 2026-10-19 distil Visualize recording (gemini-2.5-flash).
- **Unchanged:** production prompt, routing, review gates, `AIMetadata`, shared domain types, `ai/changes`, and every
  existing distortion check.
- **Code location:** everything is under `evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/phase2/`.

| File | Contents |
|---|---|
| `PROTOCOL.md` | Fixed before any label or extractor code existed |
| `packets/` | What reviewers saw |
| `labels/` | Blind labels |
| `FREEZE.json` | SHA-256 of labels, packets and protocol |
| `extract.ts` | Extraction |
| `clauseCheck.ts` | The clause detector, extending `representation.ts` |
| `checker.ts` | The visible-context checker |
| `phase2.test.ts` | Scoring; refuses the final set if any frozen hash differs |
| `report.json` | Results, with the hashes of the scored code |
| `goldenAgreement.test.ts`, `golden-agreement.json` | Labels vs. the golden dataset |

## 0. How it was run (and what to discount)

**Split.** Dev = kn-01–kn-04 (tuning allowed). Final = kn-05–kn-12. kn-13 is left out (outside the named range).

**Blind labels.** Five independent reviewers each labelled two cases, seeing only the protocol, their packets and the
sources (no golden files, no code, no other labels). Labels were frozen by hash before any extraction or clause rule
was tuned.

**Dev tuning:**
1. Restrictive phrasing the existing cue list lacks ("rather than", "once", "before step 5").
2. Within-sentence and across-sentence extraction from the same unit.
3. Citing a claim unit no longer makes a card a claim card unless it shares 30% of the claim's words.
4. Nothing else.

**Final set scored once, by deterministic code.** The first final attempt hit vitest's 5 s per-test timeout. Its
results had in fact been written, but I didn't read them. The only change before the rerun was that timeout, and the
code is deterministic, so both runs give the same numbers.

**Discount for:**
- One reviewer per case, so no inter-annotator agreement was measured.
- Most labels are medium confidence (51 of 86 in the final set).
- Different generator: these are distil Visualize notes, not OpenUI cards. Distil already puts dropped clauses back as
  "Limit:" lines (see §4).

## 1. Expanded dataset

| | Dev (kn-03, kn-04) | Final, frozen (kn-05–kn-12) |
|---|---|---|
| Records | 26 (20 claim, 6 set) | **86 (44 claim, 42 set)** |
| Within / across sentences | 9 / 17 | 35 / 51 |
| Kinds | precondition 8, caveat 7, bound 6, scope 4, exception 1 | caveat 22, bound 19, scope 15, exception 14, precondition 11, fact 5 |
| Claim card × claim-bound record pairs | 29 | **94** |
| Reviewer outcomes | carried 16, separated 10, linked 2, frame 1 | carried 54, **separated 29**, frame 9, linked 2 |
| `absent` (condition on no card) | 0 | **0** |
| Confidence | high 11, medium 15 | high 30, medium 51, low 5 |

kn-01/kn-02 (dev) keep their phase 1 records; those are used for extraction only.

**External check against the golden dataset.** The golden `knowledge.json` has reviewed "limits" links. Its unit IDs
come from today's splitter, so they were mapped to the recording's units by text.
- Of 27 mappable links, the blind reviewers matched **9** exactly.
- For **8**, they labelled the same condition but tied it to a different claim.
- **10** they didn't record.

Within one sentence, reviewers agree on the condition. Across sentences, **which claim a condition limits is
ambiguous even for careful human reviewers.** That caps any extraction score here.

## 2. Extraction accuracy (deterministic, no model)

| | Dev | **Final** |
|---|---|---|
| Reviewed / extracted / matched | 26 / 36 / 12 | **86 / 191 / 27** |
| Precision | 0.33 | **0.14** |
| Recall | 0.46 | **0.31** |
| `claim` vs `set` accuracy on matched pairs | 0.83 | **0.70** |

The final binding confusion (truth → extracted):

| | Extracted claim | Extracted set |
|---|---|---|
| **Truth claim** | 16 | 2 |
| **Truth set** | 6 | 3 |

So the extractor over-calls `claim`.

On kn-01/kn-02 (dev, phase 1 records), it matched 3 of 4 and 5 of 16.

**Verdict: not credible.** It over-generates (191 records against 86), misses most across-sentence links, and its
word-overlap attachment picks the wrong claim (u10 attached to u16 rather than u5). Dev-to-final degradation (0.46 to
0.31 recall) shows the dev tuning didn't generalise.

## 3. Condition integrity

Unit: (claim card, claim-bound record) pairs. A failure is `separated` or `absent`. Final set: 94 pairs, 29 failures.

| Setting | What it isolates | Final precision / recall | TP / FP / FN | Dev P / R |
|---|---|---|---|---|
| **Oracle**: reviewer records and claim cards | The clause detector and visible-context rules | **0.62 / 0.97** | 28 / 17 / 1 | 0.62 / 0.80 |
| Reviewer records, automatic claim-card attribution | + finding which cards state the claim | 0.26 / 0.34 | 10 / 28 / 19 | 0.36 / 0.40 |
| **End to end**: extracted records, automatic cards | The whole thing | **0.00 / 0.00** | 0 / 107 / 29 | 0.10 / 0.10 |
| Existing rule checks (card is Needs review) | Comparison | 0.35 / 0.41 | 12 / 22 / 17 | 0.29 / 0.20 |

- **Given correct records,** the detector finds almost every separated condition: 28 of 29. Its 17 false alarms come
  from carriers it fails to recognise (§5), not from wrong links.
- **Each automatic layer added costs most of the signal.** End to end, it would produce 107 false alarms and catch
  nothing. Usable now: no.
- The rule checks beat the end-to-end prototype, and lose clearly to the oracle setting.

Frames and links (visible-context rules) matter. In the final set, 9 claim cards hold their condition only through their
frame's takeaway, and 2 only through an arrow. Citation-only checking would score those differently from what a reader
sees.

## 4. Source coverage

| | Final | Dev |
|---|---|---|
| Real gaps (condition on no node) | **0 of 86** | 0 of 26 |
| Coverage false gaps (detector says no node conveys it) | **10 (12%)** | 2 |
| Carrier detection, per (record, node), precision / recall | **0.81 / 0.56** | 0.78 / 0.64 |

With no real gaps, coverage recall can't be measured on this data. Distil's existing "Limit:" restoration puts dropped
clauses back on a citing card, so every condition is somewhere. A meaningful coverage evaluation needs output without
that step: the OpenUI cards, where phase 1 found two real gaps, or new generation, which needs separate authorization.

## 5. Citation completeness (separate metric)

| | Final | Dev |
|---|---|---|
| Cards (text, shape, table, code, todo) with any citation | 0.79 | 0.79 |
| Reviewer claim cards citing a claim unit | **0.62** | 0.73 |
| Reviewer carriers citing a condition unit | **0.62** | 0.69 |
| Claim cards citing the condition's unit but not conveying it | 1 | 2 |

About **four in ten cards that state a claim or carry a condition don't cite the unit**. A citation-based checker would
miss them as claim cards, which is the main reason automatic attribution falls to 0.26 / 0.34.

Citations rarely point the other way, though. Only three cards cite a condition they don't show. So on this data, the
requirement "citations never count" matters more for completeness than for false preservation. It stays a requirement
either way.

## 6. Remaining failure categories

| # | Category | Where it shows | Example |
|---|---|---|---|
| 1 | **Which claim a condition limits (across sentences)** | Extraction recall; reviewer vs. golden disagreement (8 of 27) | Golden ties "not backward compatible → don't use" to the migration prerequisite; the reviewer ties it to step 2 |
| 2 | **Extraction over-generation** | 191 extracted vs. 86 reviewed | Every restrictive phrase becomes a record |
| 3 | **Binding classification** | 6 set → claim | Cost and estimate caveats extracted as claim-bound |
| 4 | **Long condition sentences** | Carrier recall 0.56 | The signature is the whole unit, and every number in it is required (kn-08: card has "800 ms" but not the "first 8 candidates") |
| 5 | **Compressed or synonym paraphrase** | Frame takeaways, summaries | "pipeline cost unknown" vs. "has not been estimated"; "not determined" vs. "no date has been set"; "unverified" vs. "not confirmed" |
| 6 | **Transcripts** | kn-05 | Conditions spread over speaker turns |
| 7 | **Coincidental matches** | Carrier false positives | "up to 100 candidates" or "up to 7 days" matching an unrelated bound |
| 8 | **Uncited claim cards** | Attribution recall | §5 |
| 9 | **Protocol gap: frame-to-frame arrows and arrow labels** | kn-03, kn-12 | "kill switch tested before canary" appears only on a frame-to-frame arrow label; the protocol credits neither |

## 7. Readiness and recommendation

**Not ready to request production integration, and the gate for step 5 (condition-aware generation) is not met.**

| Part | Credible? | Evidence |
|---|---|---|
| Extraction | **No** | Precision 0.14, recall 0.31; humans disagree on cross-sentence links |
| Validation, given good records | **Partly** | Recall 0.97, precision 0.62; carrier recall 0.56 is the bottleneck |
| Validation, end to end | **No** | 0 true positives, 107 false alarms |
| Citation completeness metric | **Yes, as a report** | Stable and cheap; it never decides preservation |

Proposed next offline steps, each needing your go-ahead:
1. **Get records from a better source than deterministic extraction.** Options:
   - author-time records, where the generator or the author declares the link;
   - model-assisted extraction: paid, needs separate authorization, scored against these frozen labels;
   - a second blind reviewer per case first, to measure agreement and settle category 1.
2. **Clause detector v2 on dev only, re-scored against the same frozen final set as a new, labelled run:**
   - per-clause signatures, so only the governing clause's numbers are required (categories 4 and 7);
   - a small reviewed synonym table for limits (unknown, not estimated, unverified, not confirmed…) (category 5).
3. **Amend the protocol for arrow labels and frame-to-frame arrows** as visible links (category 9). This means
   re-labelling the affected records and a new freeze.
4. **Coverage needs a generator without "Limit:" restoration** (OpenUI). Revisit once step 5 is authorized.

The distortion checks, gates and prompts are unchanged. The ChatGPT MCP write test stays blocked on the integrator's
stale-target fix (P0).
