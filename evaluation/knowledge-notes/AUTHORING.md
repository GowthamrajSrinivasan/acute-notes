# Authoring a golden case

How to add or change a case. The rules below are the ones `validateDataset` enforces. The schemas
in [tooling/schemas.ts](tooling/schemas.ts) are the authority; the files in `schemas/` are generated from them.
[cases/kn-01-idempotency-keys](cases/kn-01-idempotency-keys) is the smallest complete example. Copy its shape.

## 0. Ground rules

- **Synthetic sources only.** Write original text. Don't copy articles, docs or books. Invented names, numbers,
  paths and people are fine, and are labelled as invented in `case.json` → `provenance.note`.
- **Expectations are written by hand, never by the pipeline being evaluated.** No Acute Visualize run, no model call.
  Set `review.status: "draft"` until a person has reviewed the case (README "Review and approval").
- **Constraints, not one ideal canvas.** Say what must be true (these ideas present, this condition kept, these two
  apart, this edge labelled) and what must not appear. Never require exact wording, ids or pixel positions.
- **Don't invent product capabilities.** Anything the product can't produce today is `support: "future"` (or
  `"partial"`) with the capability ids from [capabilities.json](capabilities.json) in `requires`.
- **No AI runs.** Authoring and validation are fully offline.

## 1. Files of a case

| File | Schema | What it holds |
|---|---|---|
| `source.md` (`source.v1.md`, `source.v2.md` for updates) | – | The source text. Markdown; quote it exactly in units |
| `case.json` | `source-case` | Metadata, sections, **source units**, what's safe to omit, review status |
| `knowledge.json` | `expected-knowledge` | The ideas that must be extracted, before any rendering; `mustNotClaim` |
| `canvas.json` | `expected-canvas` | Expected frames, elements, relationships, together/apart/hierarchy, unsupported behaviour |
| `evaluation.json` | `case-evaluation` | The assertions: deterministic checks and judged questions |
| `lens.json` (architecture cases) | `expected-lens` | Expected Lens projection L0–L5 |
| `reconcile.json` (update cases) | `expected-reconcile` | Expected update outcome per element |
| `reference/plan.json` | VisualPlan v1 | A hand-written plan that **satisfies** the case (proves the case is achievable and renderable today) |
| `reference/lens.json`, `reference/reconcile.json` | projection / outcome | Same, for Lens and reconcile |
| `constraints.json` | `constraints-view` | **Generated** flat view (`UPDATE_GOLDEN=1`). Never edit |
| `../../regressions/rg-NN-*.json` | `regression` | Planted distortions of the reference that must be caught |

## 2. Source units (`case.json`)

- One unit per content-bearing sentence, list item, table row (or whole table), code block, block quote or speaker
  turn. Ids are opaque and sequential: `u1`, `u2`, … (knowledge-notes-plan §3.1). Headings need no unit.
- `quote` is the **exact** text from the source file (line endings are normalised to `\n`; keep backticks and
  markdown as written). If it occurs more than once, set `occurrence` (1-based).
- `critical` (reason: limitation, requirement, condition, takeaway, protected, decision, action_item,
  open_question, conflict): the reader must not lose it. A critical unit can be omitted only as `duplicate` or
  `superseded`.
- `protected`: values that must survive exactly (`tier: "exact"`: numbers with units, identifiers, paths, quotes,
  item ids, action items, formulas, versions) or are a warning when changed (`tier: "warn"`: named terms). Each
  value must appear in the unit's quote.
- `omittable` (reason: `filler`, `duplicate` (+ `of`: the unit it repeats), `superseded`, `meta`): only those
  four reasons (plan §3.2).
- `ambiguity` (+ `conflictsWith`): the source is unclear or contradicts itself here.
- **Accounting:** every unit is cited by a knowledge unit or is `omittable`. Nothing is left unaccounted.
- `sourceFiles[].words` = whitespace-separated tokens of the file (`wc -w`); ±5% tolerated.

## 3. Knowledge (`knowledge.json`)

- Ids `ku.<slug>`. One idea per unit. Title states the point ("Reranking trades latency for precision"), not a topic.
- `type`: concept, definition, principle, component, process, example, evidence, assumption, constraint, caveat,
  trade_off, decision, question, action_item. `importance`: critical, important, supplementary.
- `sourceUnits`: the units it represents. **Every number in `claim`** and every `exactDetails` value must appear in
  those units' quotes (that is the dataset's "no unsupported facts" check). Write numbers as digits in both places.
- `limits: "ku.x"` on a caveat/condition/limit that qualifies claim `ku.x`: on the canvas the caveat must be on the
  **same element** as the claim and never on an element of its own (plan §4.2).
- `provenance`: `explicit` (stated), `inferred`, `conflicting`, `unknown`. Anything but explicit needs
  `review.required: true`.
- `omission.allowed: false` (or importance critical) ⇒ some canvas element must carry it.
- `mustNotClaim`: distortions a faithful result must not contain, each with why. Mirror the important ones with
  `text_absent` assertions.

## 4. Canvas (`canvas.json`)

- `template`: use `"sectioned"`. It is the only template with frames (`group` nodes) **and** every relation type.
  The `architecture` template drops `calls/reads/writes/publishes/subscribes/contains` and has no frames
  (capability `ai.architecture-template-relations`).
- **Elements** (`e.<slug>`): `element` (heading, text_card, takeaway, shape, table, code, todo, page, image,
  diagram_card) and `planNodeTypes` (the VisualPlan node types that may stand for it; `group` = a frame's
  title/takeaway). `knowledge`: the ku ids it carries. `frame`: its frame id, or `null` + `outsideFrameReason`.
- **`match.all`**: groups of lower-case terms; a generated node matches when its text contains one term of every
  group (after normalisation: lower case, no `*` `_` backticks, ASCII quotes and dashes, `1,000` → `1000`). Pick terms
  that identify **this** idea and no other card. Include likely synonyms. Too loose matches the wrong card; too tight
  fails a good paraphrase.
- `image` elements are never renderable from a plan today: `support: "future"` + `supportNote`.
- **Frames** (`f.<slug>`): meaningful groups, not word counts. `children` must agree with each child's `frame`.
  `titleMatch` like `match`. Architecture frames set `diagram: "architecture"` and, where it applies, `level`.
  Frames can't nest in Acute (`canvas.frame-nesting`: not_found): express sub-groups as linked frames or say so in
  `unsupported`.
- **Relationships** (`r.<slug>`): `type` from the product's `RELATION_TYPES`, or an extension (`contrasts_with`,
  `refines`, `part_of`, `evidenced_by`, `causes`, `uses`) with `acceptableTypes` from the product list. `calls`,
  `reads`, `writes`, `publishes`, `subscribes`, and any architecture relation inside a diagram frame, require a label
  (`label.required: true`, optionally `label.match`). `inferred` relationships need `reviewRequired: true`.
- `together`, `keepSeparate`, `hierarchy`: the organisation constraints. Back them with `together`, `apart` and
  `hierarchy` assertions.
- `unsupported`: the ideal behaviour, and what is expected today instead.

Product vocabularies (from `src`, checked by the schema):
- `RELATION_TYPES`: relates_to, flows_to, caused_by, depends_on, supports, blocks, implements, derived_from,
  references, explained_by, supersedes, deviates_from, option_of, calls, reads, writes, publishes, subscribes, contains.
  `caused_by` points from the effect to the cause.
- `NODE_KINDS`: frontend, backend, database, cloud, security, messagebus, external, endpoint, step, function, event,
  store. Project kinds: project, decision, constraint, finding, open_question, risk, milestone, progress_item, annotation.
- Group arrangements: grid, chain, tree, compare, radial, stack.

## 5. Assertions (`evaluation.json`)

Each has `dimension` (source_fidelity, coverage, traceability → **gate 1**; grouping, element_selection,
relationships, architecture_lens → **gate 2**; visual → **gate 3**), `severity`, `method` (deterministic,
model_judge, human), `target` (plan, lens, reconcile, render), `support`, optional `regression` (the distortion
it guards against).

Deterministic checks:

| Check | Target | Passes when |
|---|---|---|
| `element_present` | plan | a node of an allowed type matches the element |
| `element_in_frame` | plan | a matching node's parent is a group matching the frame |
| `element_kind` | plan | a matching node has one of the kinds |
| `frame_present`, `frame_level` | plan | a group's label/takeaway matches `titleMatch` (and has `level`) |
| `frame_count` | plan | number of groups within [min, max] |
| `together` / `apart` | plan | the elements share a frame / never share one |
| `hierarchy` | plan | each supporting element is linked to or beside the main one, and not weighted above it (`importance`) |
| `relationship_present` | plan | a link between matching endpoints, right direction, acceptable type, label when required |
| `relationship_absent` | plan | no link from → to (of those types): e.g. a reversed dependency |
| `architecture_edges_labeled` | plan | every relationship of those types has a label |
| `text_present` | plan | each term group is in the element's node (or anywhere) — "limits stay with claims", exact values |
| `text_absent` | plan | a case-insensitive regex matches no node text or label. Use lookbehinds so faithful negations pass |
| `lens_node`, `lens_edge`, `lens_drill`, `lens_identity`, `lens_no_children`, `lens_path` | lens | see [evaluate.ts](tooling/evaluate.ts) |
| `reconcile_state` | reconcile | the item has one of the expected states and keeps `mustKeep` |
| `layout_no_fatal`, `layout_crossings_max`, `cards_no_overlap`, `children_inside_frames`, `frames_no_overlap` | render | the product's renderer and layout checks agree |

What the validator requires of every case: a critical deterministic assertion that runs today **in each gate**;
at least one judged assertion; assertions for source_fidelity, coverage, grouping, relationships and visual; every
mandatory implemented element, frame and relationship referenced by some check. Things that can't be checked
yet (citations, unit accounting, review queue) are `support: "future"` assertions with `requires`, without a check.

## 6. Reference outputs

`reference/plan.json` is a VisualPlan (`version: 1`, `template: "sectioned"`, `nodes`, `relationships`) written
by hand that a good result could look like. It must pass the product's `validateVisualPlan` with **no losses**,
render with no fatal layout issue, and pass every deterministic assertion. Node ids are yours (`g1`, `n1`); the
evaluator never relies on them. Group nodes: `{"type":"group","content":{"label","arrangement","takeaway"?,
"diagram"?: "architecture","level"?}}`; members set `"parent": "<group id>"`. Shapes: `{"type":"shape","content":
{"shape":"rectangle"|"ellipse"|"diamond"|"cylinder"|…,"label","kind"?,"sublabel"?,"details"?}}`.

## 7. Regressions

`regressions/rg-NN-<slug>.json` (id = file name, NN = case number): one planted distortion of the reference and the
assertions that must fail. Mutations: `replace_text` (exact substring of a node's content), `remove_node`,
`reverse_relationship`, `set_label` (null removes), `set_relation_type`, `lens_rekey`, `lens_add_node`,
`lens_remove_edge`, `lens_reverse_edge`, `reconcile_set`. Distortions: possibility_to_guarantee, condition_dropped,
correlation_to_causation, critical_exception_omitted, dependency_reversed, unlabeled_architecture_edge,
mislabeled_architecture_edge, inconsistent_identity_across_levels, user_edit_overwritten, invented_detail,
fabricated_agreement, unsupported_recommendation.

## 8. Checking your case

```bash
GOLDEN_CASE=kn-03 npx vitest run --config vitest.evaluation.config.ts            # validate one case
UPDATE_GOLDEN=1 GOLDEN_CASE=kn-03 npx vitest run --config vitest.evaluation.config.ts   # regenerate constraints.json
npm run test:golden                                                                # the whole dataset
```

A green run means the case is consistent, achievable and its distortions are caught. It does **not** mean the
expectations are right; that is the reviewer's job.
