# Instructions for the two human reviewers (approved 2026-11-15)

Two people review the same 36 items **independently**.

## What each reviewer gets
- `PACKET.md`;
- `phase4/EVAL-SPEC-v3.md` §2, the rubric;
- `review-v3/EVAL-SPEC-v3.1-AMENDMENT.md` A1, the rule for at most two claim links;
- a copy of `answers.template.json`, saved as `answers-A.json` for one reviewer and `answers-B.json` for the other.
  Put your name in `reviewer`.

Ideally, give each reviewer only these files, outside the repository.

## Blindness
Don't open these until both reviewers have handed in their answers:
- `SAMPLE-KEY.json`;
- `phase4/adjudicated/`;
- `review-v3/attachment-impact.json`;
- the other reviewer's answers;
- any phase 3 or phase 4 report.

Don't discuss items with each other until both have handed in.

## Filling in
Fill in every item. Use `ambiguous` with both readings in `note` when the source doesn't settle the question; don't
leave it blank. It takes about an hour.

## After both have handed in
Run `node compare2.mjs` from this folder. It writes `discrepancies-2.json` with:
- human–human, human A–model and human B–model agreement: verdict κ, claim/set κ, and how often the claim links
  match exactly, overlap or are disjoint;
- a pattern per item. The most important is `humans_agree_model_differs`: both humans agree and the model reference
  differs. Those items are the candidates for a revised dataset version.

Then fill the `cause` field for each disagreement, in a short discussion, from this list: `rubric_gap`,
`model_misapplied_rubric`, `human_misread`, `source_ambiguous`, `attachment_level`, `other`.

## What doesn't change
- Snapshot v3 is never edited.
- Human answers stay in their own files.
- If problems are systematic, propose a new dataset version (v3.1) by documented migration.
- kn-13 stays sealed.
