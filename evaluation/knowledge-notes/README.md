# Knowledge Notes golden dataset

The quality contract for AI-generated notes in Acute: what a good canvas built from a given source must contain,
how it must be organised, how its arrows must read, how Acute Lens must project it from L0 System to L5 Source, and
what an update must preserve. It is written **before** the note-generation work it will judge
([knowledge-notes-plan.md](../../.ai/docs/knowledge-notes-plan.md), "Q0, the quality contract"), so that every change
to prompts, grouping or layout is measured against the same cases.

> Preserve the meaning and the important details of the source, organise them by what they mean, and render them so
> people can understand, explore and maintain them. Word preservation and visual polish are not the goal.

**Status:** draft. Every case's expectations were written by hand for this dataset (by Claude Code, not by the Acute
pipeline) and are `review.status: "draft"` until a person approves them (see [Review and approval](#review-and-approval)).
No model has been run against the dataset.

## What's here

```
evaluation/knowledge-notes/
  README.md                 this file
  AUTHORING.md              how to write or change a case (rules the validator enforces)
  dataset-manifest.json     the cases, rubrics and regressions directory
  capabilities.json         what the product can do today, with code evidence (source of reports/capability-inventory.md)
  schemas/*.schema.json     JSON Schema, generated from tooling/schemas.ts (zod is the authority)
  cases/kn-NN-*/            one directory per case (see below)
  rubrics/*.json            the eight evaluation dimensions A–H
  regressions/rg-NN-*.json  planted distortions that the checks must catch
  recordings/               recorded real model output, replayed offline (empty until a run is approved)
  reports/                  generated: validation-report.md, capability-inventory.md; summary.md
  tooling/                  loader, validator, evaluator, renderer adapter, tests
```

Each case has: `source.md` (original synthetic text), `case.json` (metadata and **source units** with stable ids
`u1…`, quoted exactly), `knowledge.json` (the ideas that must be extracted, with semantic ids `ku.…`), `canvas.json`
(expected frames, elements, labelled relationships, together/apart/hierarchy, and what is expected where the product
can't do the ideal yet), `evaluation.json` (assertions), a hand-written `reference/plan.json` that satisfies the case,
and a generated `constraints.json` (the flat view: `critical`, `exact`, `groups`, `hierarchy`, `relations`,
`mustNotSay`, `update`). Architecture cases add `lens.json` + `reference/lens.json`; the update case adds
`reconcile.json` + `reference/reconcile.json`.

| Case | Scenario | Tests mostly |
|---|---|---|
| kn-01 | Short conceptual explanation | One frame, main idea vs example, limits kept on their claim |
| kn-02 | Long technical article | Several frames, omitting repetition, a page for long detail |
| kn-03 | Tutorial with branches | Sequence and conditional edges, prerequisites, failure handling, code |
| kn-04 | Comparison and decision | Comparison table, criteria and evidence, no unsupported recommendation |
| kn-05 | Meeting transcript | Decisions vs proposals, action items with owners/dates, no fabricated agreement |
| kn-06 | RAG, hybrid search, reranking | Frames per subject, labelled pipeline, "can improve when…", reranking ≠ correctness |
| kn-07 | System design (HLD only) | Architecture frames, labelled calls/writes/publishes; Lens L0–L2, L3–L5 unavailable |
| kn-08 | HLD → LLD, L0–L5 | Full Lens journey, one identity per component, failure paths, code locations, known unknowns |
| kn-09 | Codebase map | Paths and symbols, verified vs interpreted vs inferred vs unknown |
| kn-10 | Code architecture in frames | Responsibility frames, every edge labelled, no reversed dependency |
| kn-11 | Ambiguous / conflicting source | Conflicts shown, nothing resolved silently, no false precision |
| kn-12 | Source update (v1 → v2) | Unchanged / edited / added / removed / changed dependency / user edit kept |

## How the evaluation works

**Constraints, not one ideal canvas.** Many canvases are good notes. A case says what must be true (these ideas,
these exact values, these together and these apart, this the main idea and that an example, these edges with these
meanings) and what must not appear. Generated output is matched by **content** (term groups), never by ids or pixel
positions, and every check reports *why* it failed (`"missing 800 ms … in e.step-rerank: the fallback limits step 4
and must sit with it"`).

**Three gates, reported separately** (from the 2026-10-19 guidance: stages separate in the data and the checks, not
as separate model calls):

| Gate | Dimensions | Reads | Today |
|---|---|---|---|
| 1 Knowledge | A source fidelity, B coverage, G traceability | the plan's text (later: the reply's `ideas` list and `cites`) | text checks run; citations and unit accounting are `future` |
| 2 Organisation | C grouping, D element selection, E relationships, F architecture & Lens | plan structure, Lens projection | runs |
| 3 Layout | H visual | the plan **rendered by the product's renderer** and measured by its layout checks | runs (clipping needs a browser) |

A nice-looking canvas can't hide a bad summary: gate 1 fails on its own. A gate passes when none of its critical
deterministic assertions fails. Judged assertions (`model_judge`, `human`) and `future` ones are reported as
`needs_judgement` / `not_evaluable`, **never as passed**. A schema-valid case proves nothing about semantic quality;
a green deterministic run proves only what its checks check.

**No word-count gate.** Length similarity to the source is never a pass criterion (knowledge-notes-plan §9).

### Deterministic vs judged

- **Deterministic** (`tooling/evaluate.ts`): element/frame/relationship presence, direction, type and label;
  together/apart/hierarchy; exact values and conditions on the right card; forbidden distortions (regex); Lens
  nodes, edges, drills, identity, empty levels and paths; reconcile states and kept user edits; rendered layout
  (fatal issues, overlaps, cards inside frames, crossings). Free to run on every change.
- **Judged** (`rubrics/*.json`, each with a 1–5 scale and pass/fail examples): faithfulness card by card,
  readability, element fit, level abstraction. A model judge runs **only in approved offline runs** and is never a CI
  gate; human review resolves disagreements and turns misses into new deterministic assertions.

## Running the checks

All offline; no AI calls, no network.

```bash
npm run test:golden                                   # the whole dataset: integrity, references, regressions, recordings, report
GOLDEN_CASE=kn-08 npx vitest run --config vitest.evaluation.config.ts     # one case
UPDATE_GOLDEN=1 npm run test:golden                   # regenerate schemas/, constraints.json, reports/
```

What `npm run test:golden` checks:

1. `schemas/*.schema.json` match `tooling/schemas.ts`.
2. **Integrity** (`tooling/validateDataset.ts`): unique ids; every source unit's quote is found in its source
   version; every reference (units, knowledge, elements, frames, relationships, Lens nodes/frames/edges/paths,
   reconcile items, capabilities) resolves; frame children agree with their elements; every unit is accounted for
   (cited or omittable for an allowed reason); every critical unit has an expected outcome; numbers and exact details
   in expected knowledge appear in the units they cite ("no unsupported facts"); caveats sit with their claims;
   architecture relationships require labels; inferred knowledge and relationships require review; Lens parents,
   drills, levels and roll-ups are consistent; each case has a critical deterministic assertion per gate, judged
   criteria, and checks for every mandatory element, frame and relationship; capability labels agree with
   `capabilities.json`.
3. **Achievability**: each `reference/plan.json` passes the product's `validateVisualPlan` with no losses, renders
   with `renderVisualPlan`, and passes every deterministic assertion of its case (Lens and reconcile references too).
4. **Regressions**: every planted distortion makes its named assertions fail and the case's verdict fail.
5. **Recordings**: any recorded run is evaluated; gating runs fail on critical failures.
6. The checkers' own unit tests (`tooling/evaluate.test.ts`).

The suite has its own config ([vitest.evaluation.config.ts](../../vitest.evaluation.config.ts)), like the contract
tests, and is not part of `npm test` until the dataset is approved.

## Comparing real output with the golden set (record and replay)

Real model output costs money and needs approval for every run. So:

1. **Record once** (an approved run): for each case, run Visualize on `source.md` and save the validated
   `VisualPlan` (and, for kn-07/kn-08, the Lens projection; for kn-12, the update outcome) under
   `recordings/<YYYY-MM-DD-name>/`, with a `meta.json` (`recording-meta.schema.json`: approver, provider, model,
   `noteModel`, prompt version, app version, `gate`).
2. **Replay forever**: `npm run test:golden` evaluates every recording offline, on every change, at no cost.
   `gate: false` recordings are reported only; `gate: true` ones fail the suite on critical failures.
3. **Re-record deliberately** after a prompt or model change, as a new run directory, with approval.

To evaluate one output by hand:

```ts
import { evaluate, verdict } from "evaluation/knowledge-notes/tooling/evaluate";
import { renderFacts } from "evaluation/knowledge-notes/tooling/render";
const plan = validateVisualPlan(reply).plan;
const results = evaluate(c.evaluation.assertions, c, { plan, lens, reconcile, render: await renderFacts(plan) });
verdict(results); // per gate: pass, failedCritical, failed, undecided
```

Not built yet, and needed before the first recording: a small recorder that saves the merged, validated plan of a
Visualize run per case (the e2e fidelity runs save per-section `ai-replies.json`, not the merged plan), and an
adapter from `lensTree` to the normalised Lens projection (`lens.projection-adapter`, planned).

## Implemented vs future expectations

Every expectation says whether the product can meet it today (`support: implemented | partial | future`), and
anything not `implemented` names the capabilities it needs (`requires`), which must exist in
[capabilities.json](capabilities.json) with a matching status. The validator rejects an assertion marked implemented
that depends on a capability that isn't, and a "future" assertion whose capabilities are all implemented. Main gaps
today (details in [reports/capability-inventory.md](reports/capability-inventory.md)):

- No source-unit ids or `cites` on cards (`ai.source-unit-ids`, `ai.cites`): traceability is checked by content only.
- No unit accounting, meaning rules or review queue (`ai.unit-accounting`, `ai.meaning-rules`, `ai.review-queue`).
- A VisualPlan can't set Lens drill links (`lens.drill-from-plan`: partial); frames can't nest (`canvas.frame-nesting`).
- The `architecture` template drops `calls/reads/writes/publishes/subscribes` and has no frames: architecture
  expectations use `sectioned` (`ai.architecture-template-relations`).
- Plan `image` nodes can't be rendered (`canvas.image`: partial). No case requires an image; where one would help it
  is listed under `unsupported`.
- No card-role styling (main idea / example / evidence) (`canvas.card-roles`); importance is the only signal.
- Card-level, citation-driven updates (`reconcile.card-level`) are planned; section-level reconcile and user-edit
  conflicts are implemented.

## Review and approval

1. A reviewer reads `source.md`, then `knowledge.json` (are these the ideas? is anything critical missing, wrongly
   marked critical, or wrongly allowed to be omitted?), then `canvas.json` and `constraints.json` (is this a fair
   constraint, not one person's preferred canvas?), then `evaluation.json` (does each check test what it says, and is
   any important behaviour unchecked?).
2. Disagreements are resolved by changing the case or the rubric, never by averaging.
3. On approval set `review.status: "approved"`, add the reviewer to `reviewers` and the date to `approvedAt`. Only
   approved cases should gate a release (knowledge-notes-plan R1/R2).
4. Any change to an approved case goes back to `reviewed`, and changing `datasetVersion` is noted in the manifest.

## When the product changes

- The product vocabularies (relation types, node kinds, plan node types, templates, arrangements, Lens levels) are
  imported from `src` into the schemas. A rename or removal there fails `npm run test:golden` at the first case that
  uses it. Regenerate `schemas/` with `UPDATE_GOLDEN=1`, then fix the cases.
- When a planned capability lands (e.g. `cites`), update `capabilities.json` with code evidence. The validator then
  flags every `future` assertion that has become checkable; give each a deterministic check and set it `implemented`.
- When the Lens model changes, update `expectedLensSchema` and `lensProjectionSchema`, then the two Lens cases.
- A new element type: add it to `ELEMENT_TYPES` / `PLAN_NODE_TYPES`, then add or extend a case that needs it for a
  real reason.

## Limitations

- **Content matching is approximate.** An element matches a node by term groups. A paraphrase that avoids every
  listed synonym fails a good result, and a card mentioning the terms in passing can satisfy a check. Matching should
  move to cited units once `cites` exists.
- `text_absent` regexes catch known distortions only. New distortion types come from judged runs and review.
- Gate 3 runs the renderer with a stub Markdown parser and measures geometry; text clipping and real font metrics
  need the browser e2e.
- Expectations were drafted by one author and are unreviewed; the per-case `review` block says so.
- English-only cue words and terms.
