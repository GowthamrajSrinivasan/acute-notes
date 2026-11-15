# Claim–condition validation: offline prototype (2026-11-13)

Status: **prototype, evaluated offline, not active anywhere.** Decision (user, 2026-11-13): "approve a bounded, offline
claim–condition validation prototype. Do not activate it in production yet."

Constraints honoured:
- No model calls: $0.
- No production routing or review-gate changes.
- No `AIMetadata`, domain-type or `ai/changes` change.
- No permanent claim graph.
- The distortion checker is unchanged.

Code lives only in `evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/`:

| File | Contents |
|---|---|
| `claimConditions.ts` | Schema, validator, lineage remap |
| `records.ts` | 20 records for kn-01 and kn-02 |
| `claimConditions.test.ts` | Evaluation and controls (11 tests, all pass) |
| `report.json` | Results |

Run with `CC_OUT=<file> npx vitest run --config vitest.evaluation.config.ts evaluation/knowledge-notes/experiments/claim-conditions-2026-11-13/`.

Background: the paid meaning check ([openui-live-2026-11-13.md](./openui-live-2026-11-13.md) Step 4) caught 0 of 7
labelled problems. It judges a card against its cited units only, so it can't see a condition stated in another
sentence.

## 1. Independent review of the seven problems

A separate reviewer labelled all 24 cards blind, using the rubric (no access to my labels or the rule flags). Reconciled:

| Card | First label | Independent review | Now classed as |
|---|---|---|---|
| kn-01 g1 | unsupported wording | distorted: "prevent duplicate operations" widens u1; u9 denies a general guarantee | **wording distortion** (distortion checks' job) |
| kn-01 g2 | condition separated | partly: the source's own u2 is equally unconditional; u7/u8 qualify it later, on g7/g8 | **claim–condition, arguable**. Golden `a.window-with-claim` and `a.reuse-with-claim` require the limits on this card |
| kn-01 g4 | wording + separated | partly: "safely" added; the example is inside the window anyway | **wording distortion** (mild) |
| kn-02 g9 | caveat missing | distorted: "nothing the origin does will shorten that wait" (u11, u55) is on **no** card | **coverage gap** |
| kn-02 g31 | separated + fact missing | distorted: serves the expired copy "immediately", unbounded; the 60 s bound is on g34 | **claim–condition, definite** |
| kn-02 g41 | caveat missing | faithful (borderline): leaving out "still need a TTL, a purge or both" doesn't strengthen the claim | **label too strict**. Still a minor coverage gap (u50's consequence is on no card) |
| kn-02 g47 | caveat missing | partly, for a different reason: "short TTLs" for "expiry times" | **wording distortion**. "When the origin struggles" limits a sub-claim the card doesn't make |

The reviewer also found two wording problems I had labelled clean: kn-02 g10 ("roughly eightfold" became "eightfold")
and g33 ("time-sensitive content" generalises "live election results"). Outside the 24, they flagged g11's title
"for immediate changes" (u18: "not instant").

Result: of the seven, **one is a definite claim–condition failure, one is arguable, one is a source-coverage gap,
three are wording distortions, and one label was too strict.**

## 2. Proposed schema (prototype only)

```ts
interface ClaimConditionRecord {
  id: string;
  claim:     { units: UnitId[]; summary: string };                  // existing source-unit ids
  condition: { units: UnitId[]; kind: "bound" | "precondition" | "exception" | "scope" | "caveat" | "fact"; summary: string };
  binding: "claim" | "set";
  evidence: { golden: string } | { groups: string[][] };            // text evidence: every group, any alternative
  origin: { assertions?: string[]; limits?: string; note?: string }; // which golden data it came from
}
```

**`binding` rule.** A record is `"claim"` only when the claim's own sentence becomes false in a case the condition
describes. Example: the stored result is not returned after 24 hours. Every card stating the claim must then carry the
condition, or link to a card that does. Otherwise the record is `"set"`: the condition must be somewhere in the note
set. This rule is what separates integrity from coverage.

**Lineage.** `remapRecord(record, lineage)` follows unit ids to the next version with the Study Mode rules:

| Units after the new version | Status |
|---|---|
| All unchanged | kept |
| Any changed | source_changed (re-confirm the link) |
| Any ambiguous | needs_review |
| Any removed | retired |

**Records.** The 20 records (4 for kn-01, 16 for kn-02) come from the golden data:
- `knowledge.json` `limits` edges;
- `source_fidelity` `text_present` assertions, whose marker groups are used verbatim where they exist.

Six records have hand-written groups; three more reuse golden alternatives verbatim. Three of the six were written after I had read the cards, so they risk fitting
them; each is flagged in `records.ts`.

**Validator outcome per claim card:**

| Outcome | Meaning |
|---|---|
| `carried` | The card states the condition |
| `linked` | Explicit link to a card that states it (policy option) |
| `separated` | The condition is only on other cards |
| `absent` | No card states it |

Integrity flags are `separated` or `absent` on `binding: "claim"` records. A coverage gap is a record no card carries.

**How a card counts as carrying a condition.** Three variants were measured:

| Variant | A card carries the condition when |
|---|---|
| **lexical** | Its text matches the evidence groups, wherever the card is |
| **anchored** | Lexical, but only on cards citing the claim's or the condition's units |
| **cite-only** | It cites one of the condition's units (no text at all) |

## 3. Results (saved OpenUI v2 cards, $0)

### Integrity

Per card, over the 24 labelled cards. Positives: g31, plus g2 under the golden-strict reading.

| Checker | Strict: TP / FP / FN / TN | Precision / recall | Lenient (g2 excluded): TP / FP / FN | Precision / recall |
|---|---|---|---|---|
| Prototype, lexical | 2 / 0 / 0 / 22 | 1.00 / 1.00 | 1 / 0 / 0 | 1.00 / 1.00 |
| Prototype, anchored | 2 / 0 / 0 / 22 | 1.00 / 1.00 | 1 / 0 / 0 | 1.00 / 1.00 |
| Prototype, cite-only | 2 / 1 / 0 / 21 | 0.67 / 1.00 | 1 / 1 / 0 | 0.50 / 1.00 |
| Existing rule checks | 1 / 5 / 1 / 17 | 0.17 / 0.50 | 1 / 5 / 0 | 0.17 / 1.00 |
| Meaning check (Step 4), both variants | 0 / 0 / 2 / 22 | n/a / 0 | 0 / 0 / 1 | n/a / 0 |

The five wording distortions were flagged by none of the prototype variants: correct, since they're out of scope. The
rule checks flagged g47.

Outside the 24 labelled cards, the prototype also flags kn-02 g11 (purge "for immediate changes": eventual consistency
is on other cards). The reviewer independently called g11 partly, for the same reason.

### Coverage

Per record, over 20 records. Positives: the "cannot be shortened" caveat and the "still need a TTL or purge" caveat.

| Checker | TP / FP / FN / TN | Precision / recall | False gaps |
|---|---|---|---|
| Prototype, lexical | 2 / 2 / 0 / 16 | 0.50 / 1.00 | purge scope, HTML caveat: both word-list misses ("other cached pages", "does not apply") |
| Prototype, anchored | 2 / 5 / 0 / 13 | 0.29 / 1.00 | + 3 conditions stated by cards that don't cite them |
| Prototype, cite-only | 0 / 1 / 2 / 17 | 0 / 0 | Both real gaps are a clause dropped from a cited sentence: invisible to citations |
| Rule checks (a card citing the condition is Needs review) | 1 / 3 / 1 / 15 | 0.25 / 0.50 | |

### What the numbers do and don't say

- **Very small sample.** There are one or two integrity positives, so precision 1.00 says only that nothing went wrong
  on 24 cards, not that the checker is precise.
- **The structure works; detecting the evidence is the weak link.** In the lexical variant, g31 is flagged for a partly
  accidental reason. The golden markers ("up to" + "60 seconds") match the unrelated TTL card g9. The card that really
  carries the bound, g34, says "maximum", which isn't in the list. The verdict is right, but the stated carrier is
  wrong.
- **The variants fail in complementary ways:**
  - Lexical over-matches across the set and misses synonyms.
  - Anchored exposes incomplete citations: 10 of the 48 kn-02 cards cite nothing.
  - Cite-only can't see a clause dropped from inside a cited sentence, which is exactly what both coverage gaps are.

## 4. Remaining failures

1. **Wording distortions:** kn-01 g1, g4; kn-02 g10, g33, g47, plus g11's title. Not structural; they stay with the
   distortion checks, which flagged one of them (g47).
2. **A clause dropped inside a cited sentence:** kn-02 g9 and the u50 consequence. Only text evidence finds these.
   Citations say the sentence is covered when part of it is missing.
3. **Lexical brittleness:** coincidental matches and missed synonyms ("maximum", "other cached pages", "does not
   apply").
4. **Citation incompleteness:** cards that state a condition without citing it (g8, g15, g26, g36, g37 and others).
   This should be tracked as its own provenance metric, as earlier proposed. In this run it caused cite-only's one false
   positive (g26) and three of anchored's false gaps.
5. **Records exist only where golden data does.** Production would need records derived automatically from the
   source. That is untested.

## 5. Recommendation

**Yes, in principle: the structural check should become part of OpenUI generation and validation, but not in this form
and not yet.** It is the only checker here that classifies the arguable case, the definite failure and the coverage gap
correctly, and it left all five wording distortions alone. Before it ships, it needs these changes:

1. **Make the link structural at generation time, not lexical at check time.**
   - The prompt passes the records ("u38 is limited by u41").
   - The rule is that a card stating the claim cites the condition's units.
   - Integrity is then the cite-only check: deterministic, synonym-proof, and it didn't miss the definite failure here.
2. **Keep text evidence only for clauses inside a cited sentence:** the coverage-gap class. Extend the existing
   protected-details check from numbers to condition clauses ("nothing … will shorten", "still need …").
3. **Track citation completeness as its own metric,** next to integrity and coverage, so an uncited carrier is a
   provenance finding, not a false integrity flag.
4. **Derive records automatically and measure them.** Use condition-bearing units (`annotateUnits` critical), the same
   topic, and references between sentences, and score the result against these golden-derived records. Production has
   no golden data.
5. **Widen the labelled set beyond two cases before trusting any rate,** for example kn-03 to kn-12, through the same
   blind review.

Nothing here changes the distortion checker, the review gates or the generation prompt. All of the above is a proposal
for a later, separately approved step.
