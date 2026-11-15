# Golden dataset: summary report (2026-10-19)

The Knowledge Notes golden dataset v1.0.0 is built, schema-validated and green offline. Every expectation is a
**draft**, written by hand by Claude Code (not by the Acute pipeline) and not yet reviewed by a person. **No model
was run.** Generated counts live in [validation-report.md](validation-report.md) and
[capability-inventory.md](capability-inventory.md); the numbers below are copied from them.

## 1. Repository capabilities found

56 capabilities were inspected in the code (not in the plans): **35 implemented, 7 partially implemented, 12 planned,
1 not found, 1 needs verification**. Full table with evidence: [capability-inventory.md](capability-inventory.md).

- **Implemented, and used by the dataset:**
  - VisualPlan v1 node types: heading, text, todo, table, code, page, shape, group (frame).
  - 19 relation types, including calls, reads, writes, publishes and subscribes.
  - Labelled, typed arrows with explanation and confidence.
  - Interactive architecture frames with node kinds.
  - The Lens L0–L5 profile, projection, stable keys, drill-down and roll-up, code evidence, trace and canvas reveal.
  - Section-level reconcile with user-edit conflicts.
  - A deterministic renderer and layout checks.
- **Partially implemented:**
  - Plan `image` nodes are typed but can't be rendered.
  - The `architecture` template drops calls/reads/writes and has no frames.
  - A plan can't set Lens drill links.
  - A plan can't set project kinds (decision, open_question).
  - Lens has edge confidence but no "unknown detail" marker.
  - `sourceSpan` is only reliable from the local tier.
  - Record/replay exists only for e2e.
- **Planned, not in the code:** source-unit ids, `cites`, unit accounting, meaning rules, the source panel, the review
  queue, `noteModel`/`DISTIL_RULE`, card-level reconcile, card-role styling, splitting oversized frames, and the
  `ideas` reply part.
- **Not found:** nested frames.
- **Needs verification:** Lens design review (only ever run against the mock provider).

## 2. Cases created

12 cases, all original synthetic text, `review.status: draft`:

| Case | Scenario | Words | Units (critical) | Knowledge | Frames | Elements | Relationships | Assertions |
|---|---|---|---|---|---|---|---|---|
| kn-01 | Short concept | 181 | 9 (5) | 6 | 1 | 4 | 2 | 23 |
| kn-02 | Long article | 1,429 | 64 (16) | 24 | 5 | 10 | 6 | 62 |
| kn-03 | Tutorial with branches | 721 | 42 (15) | 21 | 4 | 17 | 12 | 81 |
| kn-04 | Comparison, no recommendation | 729 | 46 (17) | 24 | 6 | 11 | 3 | 52 |
| kn-05 | Meeting transcript | 947 | 82 (17) | 19 | 5 | 11 | 3 | 55 |
| kn-06 | Hybrid search and reranking | 1,045 | 45 (13) | 24 | 5 | 13 | 6 | 65 |
| kn-07 | HLD only (Lens L0–L2) | 930 | 40 (13) | 28 | 7 | 22 | 23 | 134 |
| kn-08 | HLD → LLD (Lens L0–L5) | 607 | 34 (9) | 30 | 7 | 31 | 22 | 157 |
| kn-09 | Codebase map | 929 | 57 (14) | 21 | 3 | 19 | 10 | 71 |
| kn-10 | Code architecture in frames | 907 | 50 (19) | 24 | 7 | 15 | 14 | 95 |
| kn-11 | Ambiguous / conflicting source | 626 | 41 (12) | 25 | 3 | 16 | 6 | 67 |
| kn-12 | Update v1 → v2 | 523 → 541 | 63 (8) | 7 | 3 | 7 | 2 | 34 |

Each case also has a hand-written reference output that satisfies it (12 plans, 2 Lens projections, 1 reconcile
outcome) and a generated flat `constraints.json` view.

## 3. Element types covered

- **Text cards:** 80.
- **Shapes:** 81, with kinds.
- **Frames:** 56, of which 21 are architecture diagram frames.
- **Others:** takeaways 6, tables 3, code 2, todo lists 2, page 1, heading 1.
- **Relationships:** 109, including 27 calls, 10 writes, 9 reads, 6 publishes, 2 subscribes, 26 flows_to, 7 depends_on,
  6 supports, 5 derived_from and 6 explained_by.
- **Not exercised:** images. A plan can't render one, so no case requires one, and the README states the expected
  behaviour.

## 4. Architecture and Lens levels covered

- **kn-08** (the full HLD-to-LLD journey) has every level available:
  - L0 System
  - L1 Architecture
  - L2 Component: two frames, one each for the Orchestrator and the Retrieval service
  - L3 Flow: the 7-step request flow, with the 800 ms reranker fallback on its step
  - L4 Operation: `composeAnswer`, with two opposite failure paths
  - L5 Source: code locations only, because the source gives no code
  
  It has 30 Lens nodes, 22 edges with roll-ups, 3 navigation paths and 6 invariants. Its Lens file is derived from
  the canvas spec, so the two can't disagree.
- **kn-07** (HLD only): L0 and L1 are available, L2 is partial, and L3–L5 are unavailable, each with a stated reason
  and no nodes.

## 5. Deterministic assertions

There are 896 assertions in total.

| Kind | Count |
|---|---|
| Deterministic, run today | 834 |
| Deterministic, waiting on a future capability (not run) | 31 |
| Judged | 31 |

By gate:
- **Gate 1 (knowledge):** 280 deterministic assertions run today.
- **Gate 2 (organisation):** 512.
- **Gate 3 (layout, on the product's own renderer):** 42.

Every case has a critical deterministic assertion in each gate.

54 planted regressions cover all 8 required distortions, plus 6 more:

| Distortion | Regressions |
|---|---|
| Possibility → guarantee | 4 |
| Condition dropped | 7 |
| Correlation → causation | 1 |
| Critical exception omitted | 7 |
| Dependency reversed | 8 |
| Unlabeled architecture edge | 4 |
| Mislabeled architecture edge | 4 |
| Inconsistent identity across levels | 2 |
| User edit overwritten | 1 |
| Invented detail | 11 |
| Fabricated agreement | 2 |
| Unsupported recommendation | 1 |
| Removed content kept | 1 |
| Unnecessary regeneration | 1 |

Each one makes its named assertions fail and its case's verdict fail.

## 6. Semantic criteria

- **Rubrics:** 8, one per dimension (A–H). Each has a definition, questions, severity levels, methods, required
  assertions, pass and fail criteria with examples, and a 1–5 judge scale.
- **Judged assertions:** 31 (18 model_judge, 13 human).
- Judged assertions are reported as `needs_judgement` and never count as a pass. A model judge may run only in
  approved offline runs, and it is never a CI gate.

## 7. Gaps in current product support (what the dataset can't check yet)

- **Traceability is checked by content, not by citation.** There are no source-unit ids and no `cites` yet. 16
  traceability and 12 coverage assertions are `future`.
- **No unit accounting, review queue, meaning rules or card-level reconcile.**
- **Drill links don't come from generation.** The 9 Lens drill checks pass only against a projection where drill links
  are set by `set_lens`, MCP or the UI (partial).
- **Project kinds and card roles can't be expressed in a plan.**
- **Silent text loss.** `validateVisualPlan` silently drops an over-long shape `sublabel`, or the shape's whole
  `details` list (`src/domain/canvas/diagramSchema.ts:21`), and never reports it in `losses`. The suite guards the
  reference plans against this, but generated plans can still lose text this way. **This needs a product fix.**
- **Layout limit, reported by an author but not verified here.** Frame title and takeaway blocks count as cards, so a
  link that enters a frame from above can be routed through the header. Some references needed `stack` arrangements
  to avoid it.

## 8. Validation commands and actual results (run 2026-10-19)

| Command | Result |
|---|---|
| `npm run test:golden` | **2 files, 124 tests passed, 0 failed**: integrity (0 problems), schemas in sync, 12 references render with no losses and pass all their deterministic assertions, 54 regressions caught, 14 checker unit tests, recordings: none yet |
| `npm test` (existing suite, unchanged) | **228 files passed, 1 skipped; 2,370 tests passed, 4 todo, 0 failed** |
| `npx tsc --noEmit` (filtered to the new files) | no errors |
| `npx eslint evaluation vitest.evaluation.config.ts` | no problems |

**Not run:** any model, e2e, e2e:ai or contract test, and the browser e2e that would measure text clipping.

## 9. Limitations and untested behaviour

- **Content matching is approximate.** Generated nodes are matched by term groups. A good paraphrase that uses
  none of the listed synonyms fails, and a card that mentions the terms in passing can pass. Each author checked
  that every expected element matches exactly one node in its reference, but generated output is untested.
- **`text_absent` patterns catch only the distortions someone thought of.** One author noted that some of the
  "no silent resolution" regexes in kn-11 can be escaped by any conflict word in the same card.
- **The checkers have never seen real model output.** The tests show the checkers reject planted distortions and
  accept a good answer. They don't show how often they flag faithful paraphrases, and only a recorded run can measure
  that.
- **One person wrote the expectations, with no review.** The authors' judgment calls are listed in their reports, and
  a reviewer should go through them. Examples: a kn-09 component that is drawn as a text card fails; kn-12 gives the
  user-edited card the state `unchanged`.
- **The Lens schema has a single level per node.** Context nodes that reappear at another level (kn-07's externals
  at L1) exist only in the reference projection.
- **Two adapters are not built:** a recorder for the merged validated plan of a Visualize run, and an adapter from
  `lensTree` to the normalised Lens projection.

## 10. Recommended next step

1. **Review and approve the cases.** For each one, read `source.md`, then `knowledge.json`, then `constraints.json`.
   Start with kn-01, kn-06 and kn-08, which are the templates. Only approved cases should gate.
2. **Then build the recorder (offline).** It saves the merged, validated `VisualPlan` per case into `recordings/`.
   Also build the `lensTree` → projection adapter.
3. **Then one approved live run** of today's `preserve` pipeline with `gate: false`. This gives the baseline every
   later change (distil, `ideas` + `cites`, semantic frames) is measured against. It is also the first measure of
   false alarms on real output.
4. **Separately, fix the silent shape-text drop** in `validateVisualPlan`: report it as a loss, or fold the dropped
   text into the card.
