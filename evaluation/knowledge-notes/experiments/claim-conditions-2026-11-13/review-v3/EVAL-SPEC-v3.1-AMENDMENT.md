# EVAL-SPEC v3.1: amendment to `phase4/EVAL-SPEC-v3.md`

**Status:**
- **Approved for evaluation preparation** (user, 2026-11-14).
- **v3 stays as frozen.** This file amends it for new labelling. Read the two together; where they differ, this file
  wins.
- **Snapshot v3 is provisionally accepted,** not yet the final reference dataset: that waits on the human discrepancy
  report (§3).
- **kn-13 stays sealed.** Labelling, scoring or inspecting it needs a separate authorization.

## A1. Claim links: at most two, each with its own evidence (replaces v3 §1 `claimUnits` / `claimQuote` and R4)

A record carries 1 or 2 **links**. A `not_a_condition` record carries none.

**The two kinds:**
- **`local`:** the claim in the clause's own sentence or immediate passage.
- **`section`:** a broader section-level claim the clause genuinely qualifies.

**What each link holds:**
- a claim quote;
- an **evidence span:** the exact source words that show this clause limits this claim;
- a one-sentence justification;
- its own **binding** (`claim`, `set` or `ambiguous`).

**Rules:**
- **Never automatic.** A second link needs **positive** source evidence that the clause materially limits the broader
  claim. Being near it, or in the same section, is not enough.
- **Never a tie-breaker.** When two readings compete, the record stays `ambiguous`, with both readings and the
  deciding question. A second link is never added to dissolve a disagreement.
- **Two links are one local and one section-level,** naming different claims.
- **The record verdict** is the strongest link binding: claim > ambiguous > set.

**Annotation.** An annotator gives the local link first, then asks: *"Would a reader of the section's main claim,
seeing it without this clause, act wrongly or be misled?"* Only a sourced yes adds the section link.

## A2. Presentation obligations are separate from attachment (adds to v3 §3–§4)

| Mode | Obligations | Satisfied when |
|---|---|---|
| `one_carrier` (default) | One per record | One visible carrier of the clause reaches the claim cards of its claim-bound links. Counted once, with no duplicate warning |
| `per_link` | One per claim-bound link | Each link's claim card shows the condition |

`per_link` applies only when both links are claim-bound, their claims sit on different cards, and a reader of either
card alone would act wrongly. Integrity is then scored per obligation.

## A3. Schema and migration

- **Schema:** `review-v3/attachmentSchema.ts` (`ClauseRecordV31`, `validateClauseRecordV31`,
  `presentationObligations`), evaluation-only.
- **Snapshot v3 isn't migrated.** Any v3.1 dataset is built by a documented migration with new hashes:
  - each record's single link becomes its `local` or `section` link;
  - records the v3 adjudicators split by claim (kn-06, kn-08, kn-09) are merged into one record with two links;
  - the 14 annotator-proposed second links (`review-v3/attachment-impact.json`) each get an evidence decision.
- **Expected effect, development records only:** at most 13 of 39 disjoint annotator links absorbed; 0 of 6
  unresolved records resolved. Not a reason to widen the rule.

## A4. Human validation

Agreement between Claude annotators is **not** human validation, and isn't to be reported as such.

The human spot check (`review-v3/human-review/`, 36 items):
- **Reviewers:** two independent humans preferred, one at minimum.
- **Blind:** reviewers don't open `SAMPLE-KEY.json` or `phase4/adjudicated/`.
- **Separate:** human answers stay in their own files and never change v3.
- **Output:** `compare.mjs` writes the discrepancy report. Causes are classified from the fixed list in that script.
- **Systematic problems** lead to a proposed new dataset version, never a patch to v3.
