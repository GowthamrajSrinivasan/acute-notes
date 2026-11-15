# Organisation and layout (Lane F): design plan

Status: **Draft for review** (2026-10-19). Design only: nothing here is built, and Lane F builds only after this is
agreed ([knowledge-notes-lanes.md](./knowledge-notes-lanes.md), Checkpoints, "Wave 2 started"). Lane F owns
`src/ai/renderer/*`, `src/ai/visual-plan/groups.ts` and new `src/ai/visual-plan/grouping*.ts`. Every change to a file
outside those is a request to its owner (§4.3).

Scope: how Acute organises cards into frames and lays them out, and what happens to that layout when the user moves
or resizes things and then runs Re-visualize, Update or Re-arrange. Measured against the golden dataset's
organisation (C grouping) and layout (H visual) dimensions ([evaluation/knowledge-notes/README.md](../../evaluation/knowledge-notes/README.md)).

The parent plan's rules hold throughout ([knowledge-notes-plan.md](./knowledge-notes-plan.md) §0.3):

- **Layout and signalling stay as they are** (relation styles, numbered steps, overview cards, landscape packing,
  routing, `mergeDetailCards`) unless a golden check shows a defect.
- **`preserve` doesn't change before R1** (gate G7: "`preserve` output identical to today"), except for bug fixes.
- **Selection actions stay scoped** (rule 4): anything started from a selected frame or card changes only that
  section, with a test like [regenerateScope.test.ts](../../src/ai/reconcile/regenerateScope.test.ts).

---

## 1. What is wrong or missing today

### 1.1 Findings

| # | Finding | Evidence | Effect |
|---|---|---|---|
| F1 | **Layout is fragile to frame order.** When cards in different frames are linked (architecture, pipelines), most frame orders give a link through a card, which is a fatal layout issue. The reference plans pass only because their author picked a good order | Measured offline (§1.2): with the frames of kn-06, kn-07 and kn-10 shuffled 120 times, **111, 101 and 100 of the 120 orders** have `link_through_card`. `packRows` places frames strictly in plan order ([layout.ts:691](../../src/ai/renderer/layout.ts#L691)) and never looks at the links | A real run's outline order can fail `a.layout` (critical, gate 3) on cases whose references pass |
| F2 | **Many crossings pass the gate.** kn-07's reference has 28 link crossings, kn-10's 15. The visual rubric calls "many link crossings" a major issue and lists `layout_crossings_max` as its check, but **no case uses it** | [rubrics/visual.json](../../evaluation/knowledge-notes/rubrics/visual.json) `methods.deterministic`; `layout_crossings_max` is implemented in [evaluate.ts:382](../../evaluation/knowledge-notes/tooling/evaluate.ts#L382) and absent from all 12 `evaluation.json` files | Gate 3 passes a canvas that is hard to read. Better orders exist: 11 crossings for kn-07 and 3 for kn-10 (§1.2) |
| F3 | **A model's sub-groups are lost on the AI tier.** `wrapSections` gives every node of a section `parent: <section group>`, overwriting the parent the model set. The model's sub-group is then a nested group, so validation makes it top-level and, now empty, drops it | [groups.ts:326](../../src/ai/visual-plan/groups.ts#L326); [validate.ts:218-250](../../src/ai/visual-plan/validate.ts#L218-L250) (`sanitizeGroups`). Reproduced offline: a "Persistence" section with an "External" sub-group of two shapes ends with warnings *"groups can't be nested, so it was made top-level"* and *"has no members, dropped"*, and the two shapes sit loose in Persistence | It contradicts the grouped layout plan, which says "the model may still emit sub-groups" ([ai-visualize-grouped-layout-plan.md](./ai-visualize-grouped-layout-plan.md) §4.5). Only a warning is shown, nothing in `losses` |
| F4 | **There are no nested groups.** The only structure inside a frame is the sub-topic backdrop, made from ≥ 2 plain headings ([layout.ts:797](../../src/ai/renderer/layout.ts#L797) `subTopics`). A nested group from MCP or the local tier becomes a sibling frame | Same reproduction: a direct plan with `ext.parent = g` renders 2 frames side by side. `capabilities.json`: `canvas.frame-nesting` is `not_found` | kn-07, kn-08 and kn-10 list nesting under `unsupported`. kn-10 wants "an 'External' sub-frame for the supplier API inside persistence & external" |
| F5 | **Frames never split.** A section grows to any size, and only the node cap (60 per section) folds the rest into "More from this section" pages | `foldOverflow` ([repair.ts](../../src/ai/visual-plan/repair.ts)), `MAX_GROUPS` ([validate.ts:36](../../src/ai/visual-plan/validate.ts#L36)); `canvas.frame-split-oversized` is `planned` in `capabilities.json` | Distil mode writes more, smaller cards (one idea per card, §4.2 of the parent plan), so sections get larger. **No golden case exercises this today**: the largest reference frame is 1,991 × 761 px (kn-09, 13 members), which fits a laptop screen at 50% zoom |
| F6 | **Re-arrange picks a group's frame from its last member.** `frameId` is overwritten for each member, so a card the user dragged into another section's frame makes the whole group move relative to *that* frame. The selection check then uses that frame too | [rearrange.ts:48-60](../../src/ai/reconcile/rearrange.ts#L48-L60) (`frameId = frame.id` inside the member loop) | A bug against rule 4: re-arranging section B can move section A's cards into B's frame. No test covers a member in a foreign frame |
| F7 | **Re-arrange moves cards the user placed.** It moves every member whose position differs from the layout. It never checks the layout hint that marks user placement | [rearrange.ts:55-56](../../src/ai/reconcile/rearrange.ts#L55-L56); the hint exists and is read only by reflow: `isWhereAcutePlacedIt` ([adapter.ts:195](../../src/domain/canvas/adapter.ts#L195)), `USER_PLACED_WEIGHT` ([reflow.ts:36](../../src/ai/renderer/reflow.ts#L36)) | The user's arrangement in the selected section is undone without being mentioned in review |
| F8 | **Re-arrange ignores the real sizes.** It lays out with the estimated sizes (`measureNode`) and moves only positions. A card the user resized, or an auto-height card taller than estimated, can overlap the next one | [rearrange.ts:38](../../src/ai/reconcile/rearrange.ts#L38) (`layoutPlan(plan)`), [rearrange.ts:55](../../src/ai/reconcile/rearrange.ts#L55) (only `x`, `y`). Known limit already logged: "a card can overlap the next block in its section … Not yet investigated" ([ai-visualize-grouped-layout-plan.md](./ai-visualize-grouped-layout-plan.md), Known limits) | Overlaps after an action whose purpose is to tidy |
| F9 | **Re-arrange is never checked.** Its proposal goes to review without a layout check. Regenerate uses one (`checkProposal`, "never worse") | [AIPanel.tsx:631-651](../../src/components/ai/AIPanel.tsx#L631-L651); [regenerate.ts:89-92](../../src/ai/fidelity/regenerate.ts#L89-L92) | A re-arrange that makes things worse is proposed as if it were fine. The review bar does describe layout issues ([ChangeSetReview.tsx:274](../../src/components/ai/ChangeSetReview.tsx#L274)), but only as a line of text |
| F10 | **Resizes leave no record.** The layout hint stores only `x`, `y`. The only resize signal is `autoHeight: false` on a rich-block card. Shapes and pages have none | [adapter.ts:195-203](../../src/domain/canvas/adapter.ts#L195-L203); [ExcalidrawCanvas.tsx:383-386](../../src/components/canvas/ExcalidrawCanvas.tsx#L383-L386) | We can't tell "the user made this bigger" from "Acute made it this size". §3.4 avoids needing to know |
| F11 | **Scope: is a move a change?** During Update and Re-visualize, reflow (F41) may move other units, whole frames included, to make room. The scope test explicitly ignores moves | [regenerateScope.test.ts:42](../../src/ai/reconcile/regenerateScope.test.ts#L42) (`c.kind !== "move"`); [update.ts:863-912](../../src/ai/reconcile/update.ts#L863-L912) `placeAdds` | Unclear against rule 4; a question for the user (§6, Q3) |
| F12 | **The layout gate sees only a first run on an empty canvas.** `renderFacts` renders with `existing: []`, and its overlap and containment checks are its own copies, not shared with the product | [tooling/render.ts:27-53](../../evaluation/knowledge-notes/tooling/render.ts#L27-L53) | Nothing golden measures Update, Re-visualize or Re-arrange on a canvas the user has changed. Reading order, frame size and sub-group containment can't be expressed |
| F13 | **The golden checks assume one level of parent.** `together`, `apart`, `element_in_frame` and `hierarchy` compare `node.parent` directly, and `frame_count` counts plan groups, not frames on the canvas | [evaluate.ts:171-225](../../evaluation/knowledge-notes/tooling/evaluate.ts#L171-L225) | With sub-groups (F4) two cards in one frame would read as "in different frames". With frame splitting (F5) the plan's count and the canvas's would differ |
| F14 | **The `architecture` template drops the arrows architecture needs.** It allows neither groups nor `calls / reads / writes / publishes / subscribes / contains`, so architecture cases use `sectioned` | [templates.ts:106-115](../../src/ai/visual-plan/templates.ts#L106-L115); `ai.architecture-template-relations` is `partially_implemented` | Architecture sections lay out with `tree` (`tidyTree`), not the label-aware `layered-boxes`. Not a Lane F change (templates.ts isn't ours): we keep `sectioned` (§2.2) |

### 1.2 How the numbers in F1, F2 were measured

Offline, no model: each case's `reference/plan.json` went through `validateVisualPlan` and the golden
`renderFacts` (the product's `renderVisualPlan` + `checkProposal`). For F1, the group nodes were shuffled in place
120 times with a fixed seed, and each order was rendered.

| Case | Frames | Links (across frames) | Crossings in the reference | Best order found | Orders with a link through a card |
|---|---|---|---|---|---|
| kn-06 hybrid search | 5 | 6 (4) | 2 | 0 | 111 / 120 |
| kn-07 photo sharing HLD | 7 | 22 (15) | 28 (plus 3 shared corridors, 1 label collision) | 11 | 101 / 120 |
| kn-08 helpdesk L0–L5 | 7 | 22 (0) | 0 (5 label collisions) | 0 | 0 / 120 |
| kn-10 inventory frames | 7 | 14 (11) | 15 | 3 | 100 / 120 |

The other eight references have 0–1 crossings, and a few have shared corridors or label collisions. kn-08 is not
affected because all its links stay inside a frame. One render and check of kn-07 takes about 7 ms, so trying a
few dozen candidate orders in the app is affordable (§3.3).

---

## 2. Goals and non-goals

### 2.1 Goals

1. **Layout that can't easily fail on frame order.** When frames are linked card to card, frames are ordered so
   that no link runs through a card and crossings stay low. Reading order is kept where that costs nothing (F1, F2).
2. **One set of geometry checks**, used by the renderer's tests, Re-arrange, and the golden layout gate: overlap,
   containment, reading order, frame size, link crossings, links over unrelated frames. Built on the existing
   `checkLayout` / `proposalGeometry`, not a second implementation (F12).
3. **Nested groups, one level inside a frame**, so the model can say "these components are the External part of
   this section" without a frame that can't exist (F3, F4).
4. **Splitting a frame that is too big to read, along meaning boundaries only** (sub-topics, unlinked clusters),
   never by count, never separating a limit from its claim (F5).
5. **Manual moves and resizes are respected** by Re-visualize, Update and Re-arrange, scoped to the selection (F6–F10).

### 2.2 Non-goals

- **No change to `preserve` output before R1**, except bug fixes the user agrees are bug fixes (§6, Q8). Goals 1, 3
  and 4 apply only when the organisation switch is on (§3.0).
- **No restyling.** Relation styles, numbered steps, overview cards, routing, landscape packing, `mergeDetailCards`
  and frame naming stay as they are. Where a goal needs a layout change (frame order, sub-group placement), golden
  evidence comes first (§5).
- **No native nested frames.** Excalidraw frames can't nest. Lens expresses levels as linked frames, not nested ones
  ([acute-lens-plan.md](./acute-lens-plan.md) §3.1), and that stays.
- **No change to the `architecture` template** (F14). Architecture content keeps using `sectioned`, and section
  diagrams keep `isDiagramGroup`.
- **No model calls, no prompt changes.** If a sub-group needs a prompt line, it is a request to the integrator after
  the layout side exists.
- **No new reconciliation behaviour.** Frames stay unreconciled, as today (`groups.ts` module doc). Card-level
  updates are Lane G's (Phase 3).
- **No wiring.** Nothing in this lane is connected to Visualize, Update or the panel. The integrator does that
  (lane rule 8).

---

## 3. Design

### 3.0 The switch

Everything that changes a first run's layout sits behind one option on the pure functions. Defaults reproduce
today's output byte for byte:

```ts
// src/ai/visual-plan/grouping.ts (new)
export interface OrganisationOptions {
  /** "v1": today's behaviour. "v2": frame order by links, sub-groups, frame splitting. */
  organisation: "v1" | "v2";
}
```

`layoutPlan(plan, options?)` and `renderVisualPlan(plan, { …, organisation })` take it. The integrator sets `v2` when
`noteModel` is `distil` (or from a dev flag for testing). `preserve` keeps `v1` until R1. The bug fixes (§3.4.1,
§3.4.2) are not behind the switch, because they don't change a first run.

### 3.1 Geometry checks (one module, reused everywhere)

New `src/ai/renderer/geometry.ts`. It is pure and reads only boxes, never moves anything. It builds on
`proposalGeometry` and `checkLayout` ([ai/changes/](../../src/ai/changes/layoutCheck.ts)), imported, not changed.

```ts
export interface GeometryReport {
  layout: LayoutReport;                 // checkProposal as today: link_through_card (fatal), crossings, corridors, frame borders, label collisions
  cardOverlaps: string[];               // pairs of cards (created or moved) whose boxes overlap
  frameOverlaps: string[];
  outsideFrames: string[];              // a card not inside the frame that lists it (create_frame children, update_frame add)
  outsideSubGroups: string[];           // a sub-group member not inside its backdrop (§3.2)
  linksOverFrames: string[];            // a card-to-card link that passes over a third frame (not one of its ends' frames)
  readingOrder: { inversions: number; detail: string[] };  // frames out of plan order, read row by row (left→right, top→bottom)
  oversizedFrames: string[];            // a frame that can't be read whole at READABLE_FIT_ZOOM on FIT_SCREEN (§3.3)
  movedUserPlaced: string[];            // existing objects the user placed that the change set moves (needs the scene)
  outsideScope: string[];               // changes that target objects outside the allowed frames (needs `scope`)
}
export function geometryOf(changes: readonly ProposedChange[], scene: readonly SceneElement[], options?: { scope?: ReadonlySet<string>; planOrder?: readonly string[] }): GeometryReport;
```

- **Overlap and containment** move here from the golden `render.ts` (same tolerance, 1 px). The golden tooling then
  calls `geometryOf`, so the product and the gate measure the same thing (a request to Lane A, §4.3).
- **Reading order** counts pairs of frames whose plan order disagrees with row-major canvas order, where rows are
  frames whose vertical extents overlap. Today's `packRows` never inverts, so this is 0 for every v1 render. It
  exists so that a reordering (§3.3) is visible and capped.
- **Links over frames** extends what `checkLayout` already does for frame borders. It is the "arrows between frames
  can cross other frames" limit in the grouped layout plan, now measured.
- **Moved user-placed objects** uses `isWhereAcutePlacedIt`. **Outside scope** is the rule 4 check as a function, so
  each selection action's test reads one field.
- Works on a scene too: `proposalGeometry(changes, scene)` already applies moves and removals. This lets the same
  report judge Re-arrange and Update on a changed canvas (F12).

### 3.2 Nested groups (one level, inside a frame)

**Plan.** A `group` whose `parent` is a top-level group is a **sub-group**. Depth stays at 2: a deeper group is
flattened into its sub-group, as today's rule flattens nesting. Sub-groups count against `MAX_GROUPS` like groups. A
sub-group with fewer than 2 members is dissolved into its section (one card needs no box). Validation keeps
sub-groups only with `organisation: "v2"`. In v1 it flattens exactly as today. This lives in `sanitizeGroups`
([validate.ts:218](../../src/ai/visual-plan/validate.ts#L218)), which isn't Lane F's file: Lane F writes the rule
as `normalizeSubGroups()` in `grouping.ts`, and the owner calls it (request, §4.3).

**`wrapSections`** ([groups.ts:326](../../src/ai/visual-plan/groups.ts#L326)) keeps a node's parent when that parent
is a group of the same section. It re-parents only nodes with no parent, or a parent outside the section. This fixes
F3 (in v2; in v1 the result after validation is the same as today, because validation flattens).

**Layout.** Bottom-up, as the grouped layout plan's §4.3 step 1 first intended. A sub-group's members are arranged
with the sub-group's own `arrangement` and drawn on a backdrop with a small title. The backdrop then takes part in its
section's arrangement as **one sized item**, so a grid, stack or tree places it like a card. This reuses the
sub-topic machinery: `clusterKey`-style keys (`<group>::sub<i>`, `<group>::sub<i>::title`), `TOPIC_PAD`, and
`create_shape … backdrop: true` in `render.ts`. The members' `frameId` is the outer frame. Links into and out of a
sub-group stay card to card. `sectionOfNodes` ([layout.ts:774](../../src/ai/renderer/layout.ts#L774)) resolves a
member to its **top-level** group.

**Reconciliation.** `ungroup` turns a sub-group into a plain heading (not `role: "section"`), with its own
`stableKey`. On the canvas it is the backdrop's title object, so it reconciles like a sub-topic heading does today.
`sectionOfNode` is unchanged: a sub-group's key is namespaced by its unit like any node.

**Lens.** Unaffected. Lens reads frames, and a sub-group is not a frame.

**What it covers.** kn-10's "External" part of *Persistence & external systems*. kn-07's outer *system boundary*
around several frames is the other direction (a group around frames) and stays unsupported (§6, Q6).

### 3.3 Frame order and frame splitting

**Frame order (v2).** New `src/ai/renderer/frameOrder.ts`, called by `layoutGrouped` in place of plain plan order:

1. Candidates: (a) plan order; (b) a *link order*: frames sorted so that frames sharing card-to-card links are
   neighbours, using a barycentre pass over the frame graph, the same idea `layerGraph` uses inside a tree. The
   outline's primary sections stay before supporting ones; (c) for each (a)/(b), single adjacent swaps (at most 2 ×
   frames). That is at most about 40 candidates for 20 frames.
2. Each candidate is packed with today's `packRows` (unchanged) and scored with §3.1. Fatal issues come first, then
   crossings + links over frames, then reading-order inversions.
3. **Plan order wins unless a candidate is clearly better:** it removes a fatal issue, or it cuts crossings by at
   least 3 and at least 25%. A tie or a small gain keeps the reader's order.

It is deterministic (fixed candidate order, ties to the earlier one). Cost is about 7 ms per candidate for a 7-frame,
22-link plan (§1.2), so under 0.3 s at worst. A plan whose links all stay inside frames (kn-08) has nothing to
gain and returns plan order without trying candidates.

**Frame splitting (v2).** New `src/ai/renderer/frameSplit.ts`, applied **at render time** to a laid-out section.
The plan and the stored plan are unchanged.

| Rule | Value |
|---|---|
| Trigger | The section's frame can't be read whole at `READABLE_FIT_ZOOM` (0.5) on `FIT_SCREEN` (1600 × 900): wider than 3,200 px or taller than 1,800 px. The constants are the ones `packRows` already uses ([layout.ts:719-722](../../src/ai/renderer/layout.ts#L719-L722)) |
| Never split | A diagram section (`isDiagramGroup`), a section with a Lens `level`, a `comparison` section (one table), a section with fewer than 4 core members |
| Where | Only along a meaning boundary, in this order: sub-groups (§3.2), sub-topics (`subTopics`, ≥ 2 headings), then link components (cards connected by any relationship). An explanation always goes with the card it explains, so a limit stays with its claim. A component is never cut |
| Parts | At least 2 core members each. Neighbouring small parts are merged until each part fits the budget or no boundary is left. If no boundary exists, the frame isn't split, and the dense walk-through and overflow pages handle it as today |
| Frames | Part 1 keeps the section's title object, takeaway and frame name. Each later part gets its own frame titled "*Section* — *sub-topic*" (or "*Section* (2 of 3)" for link components), placed right after part 1 in packing order. The continuation titles have no `stableKey`, like the takeaway: they are layout, not content |
| Keys | Frame keys `<group>::part<i>`. Card keys and stable keys are unchanged, so reconciliation sees no difference |

Splitting at render time keeps the plan, the stored plan and every reconciliation key as they are. Re-arrange
reproduces the same split, because it lays out from the stored plan. The cost is two follow-ups outside Lane F:
`frameToJoin` ([update.ts:942](../../src/ai/reconcile/update.ts#L942)) joins new cards to part 1 (the title's frame).
It should join the part holding the card's anchor (`groupAnchor`'s object). And `rearrangeSource` must map one group
to several frames. Both are requests (§4.3). A plan-level split is the alternative (§6, Q4).

### 3.4 Manual moves and resizes

What the user did, and how each action treats it:

| User action | Signal we have | Update from new content | Re-visualize (selection) | Re-arrange (selection) |
|---|---|---|---|---|
| Moved a card within its frame | `acuteLayout` ≠ position (`isWhereAcutePlacedIt` false) | Not moved, except by reflow at 4× cost (today; unchanged) | Same as Update | **Today: moved back (F7). Proposed: stays put by default** (§3.4.3) |
| Moved a card to another section's frame | `frameId` ≠ its section's frame | Not moved (today) | Same | **Today: drags its old section along (F6). Proposed: left where it is, and its old section is arranged without it** (§3.4.1) |
| Moved a card out of every frame | no `frameId` | Not moved (today) | Same | Not moved (today: skipped, [rearrange.ts:53](../../src/ai/reconcile/rearrange.ts#L53)); unchanged |
| Resized a card | real box ≠ estimate; `autoHeight: false` for rich-block cards | Never resized (today) | Never resized (today) | **Today: laid out with the estimate, can overlap (F8). Proposed: laid out with the real size** (§3.4.2) |
| Moved or resized a frame | frame box | Frames only grow (`growFrame`, [changeSetWriter.ts:516](../../src/components/canvas/changeSetWriter.ts#L516)); unchanged | Same | Members are placed relative to the frame's current corner (today); unchanged |
| Added their own card in a frame | no reconciliation link | Treated as an obstacle (it is in `context.objects`) | Same | **Today: ignored, can be overlapped. Proposed: treated as pinned** (§3.4.3) |

#### 3.4.1 Re-arrange finds each section's frame by its title (bug fix, F6)

A group's frame is the frame of its **title object** (the object keyed with the group's `stableKey`). Failing that,
it is the frame most of its members are in, with ties going to the first member in plan order. Members in any other
frame are not moved: the user put them there. Scope uses the same frame. Not behind the switch: it changes only
Re-arrange, never a first run.

#### 3.4.2 Re-arrange lays out with real sizes (bug fix, F8)

`layoutPlan(plan, { sizes })` takes an optional map of node id → size. Re-arrange passes the scene box of each
existing object: whatever the user resized, or the height an auto-height card really has. Sizes it doesn't pass are
measured as today. Re-arrange still only proposes moves, never a resize. With no `sizes`, the layout is exactly
today's (the snapshot tests in [layout.test.ts](../../src/ai/renderer/layout.test.ts) prove it). This also removes
the need for a size record (F10): the real box is the user's size, whoever set it.

#### 3.4.3 Re-arrange keeps what the user placed (F7)

By default, inside the selected frames:

- A card the user placed (`isWhereAcutePlacedIt` false), and a user's own card with no link, is **pinned**: not
  moved, and treated as an obstacle.
- The section is laid out as usual, without the pinned cards. Then one deterministic sweep (new
  `resolvePins` in `src/ai/renderer/pins.ts`) pushes laid-out cards down or right past any pinned box they would
  overlap, in reading order. This is the same idea as reflow's push sweep ([reflow.ts](../../src/ai/renderer/reflow.ts)),
  inside one frame.
- Review says so: "2 cards you placed were left where they are" (wording is the integrator's).
- An option, **"Also move cards I placed"**, re-arranges everything, as today.

Pinned cards stop being pinned once the user moves them back to where Acute put them, since the hint then matches
again. This is a behaviour change to Re-arrange, so it needs the user's decision (§6, Q2).

#### 3.4.4 Every selection action gets a scope test and a geometry check

- Re-arrange runs `geometryOf(changes, scene, { scope: frames })` before proposing. `outsideScope` must be empty (a
  test, and an assertion in code). If the result is worse than the current canvas (more fatal issues or overlaps),
  it is still proposed, with that said in review. It is never applied silently, and never dropped silently either.
- Update, Re-visualize and Re-arrange each get a test where the user moved one card and resized another: the moved
  card isn't moved (except reflow's whole-frame move, pending Q3), the resized card keeps its size, and no proposed
  card overlaps either one.
- The existing "on a selection" tests stay ([rearrange.test.ts](../../src/ai/reconcile/rearrange.test.ts),
  [regenerateScope.test.ts](../../src/ai/reconcile/regenerateScope.test.ts)), plus a new one for F6: a card of
  section A dragged into B's frame. Re-arranging B moves nothing of A's, and re-arranging A leaves that card in B.

---

## 4. Work packages

Each package is small, offline, and adds tests. Nothing is wired. Each package ends with: typecheck clean for our
paths, eslint on our files, `npx vitest run src/ai/renderer src/ai/visual-plan` green, `npm run test:golden` green
(all 12 references still pass every gate), and the v1 snapshots unchanged.

### 4.1 Packages

| WP | What | Files (owned) | Tests | Behaviour change |
|---|---|---|---|---|
| **F0** | Geometry report (§3.1) | new `renderer/geometry.ts` | `geometry.test.ts`: each field on hand-made change sets (overlap, outside frame, link over a third frame, inversion, oversized, moved user-placed, outside scope); on a scene with moves and removals; every golden reference gives the same overlaps and containment as `renderFacts` today | None |
| **F1** | Golden measurement (request to Lane A, §4.3): `renderFacts` uses `geometryOf`; a report-only "frame order robustness" line per case (fixed-seed shuffles, share of orders with a fatal issue) | — (Lane A's `tooling/`) | Lane A's | None (report-only) |
| **F2** | Re-arrange bug fixes: frame by title (§3.4.1), real sizes (§3.4.2) | `renderer/layout.ts` (`sizes` option); `rearrange.ts` by request or permission (§4.3) | `layout.test.ts`: `sizes` absent → identical snapshot; a taller card pushes its row down. `rearrange.test.ts`: F6 case; a resized card no longer overlaps after re-arrange (checked with `geometryOf`) | Re-arrange only |
| **F3** | Re-arrange keeps what the user placed (§3.4.3), after Q2 | new `renderer/pins.ts`; `rearrange.ts` (request) | `pins.test.ts`: no laid-out card overlaps a pin; reading order kept; deterministic. `rearrange.test.ts`: a user-moved card isn't in `moves`; "also move mine" moves it; scope test still green | Re-arrange only |
| **F4** | Frame order by links (§3.3), v2 only | new `renderer/frameOrder.ts`; `layout.ts` (`organisation` option) | `frameOrder.test.ts`: kn-06, kn-07, kn-10 references, shuffled with a fixed seed → 0 fatal issues in every order tried; crossings ≤ the reference's; plan order kept when nothing is gained (kn-08, kn-01); deterministic. v1 snapshots unchanged | First run, v2 only |
| **F5** | Sub-groups (§3.2), v2 only | new `visual-plan/grouping.ts` (`normalizeSubGroups`, options type); `groups.ts` (`wrapSections`, `ungroup`); `layout.ts`; `render.ts` | `grouping.test.ts`: depth flattening, 1-member sub-group dissolved, cap. `groups.test.ts`: the F3 reproduction keeps "External" with 2 members in v2, and v1 is unchanged. `layout.test.ts`: members inside the backdrop, the backdrop inside the frame, no overlap. `render.test.ts`: backdrop + title, members' frame = outer frame | First run, v2 only |
| **F6** | Frame splitting (§3.3), v2 only, after Q4/Q5 and a golden case that needs it (§5.2) | new `renderer/frameSplit.ts`; `render.ts`; `layout.ts` | `frameSplit.test.ts`: a 3-sub-topic section over budget → 3 frames, each within budget; explanations stay with their card; a diagram, levelled, comparison or small section never splits; no boundary → no split; keys unchanged; kn-01's single frame never splits (its `frame_count` max 1) | First run, v2 only |

Order: F0 → F2 → F1 → F4 → F5 → F3 (after Q2) → F6 (after Q4, Q5). F0 and F2 are independent of the user's
answers. F4 and F5 need the switch (§3.0), which the integrator adds to the options; until then they are reachable
only through the option in tests.

**Status (2026-10-19, Lane F):** F0–F5 built, offline, nothing wired. F6 not started (waits for a golden case).

- **F0** `renderer/geometry.ts` (`geometryOf`, `rowMajorOrder`, `readingOrderOf`); the fit-screen constants moved to
  `renderer/screen.ts` so the renderer has no import cycle.
- **F2** (ships for everyone, Q8): `layoutPlan(plan, { sizes })`; Re-arrange finds a section's frame by its title
  object (`sectionFrame`), leaves cards dragged into another frame there and lays their section out without them,
  and lays out at the cards' real sizes.
- **F1** (tooling now Lane F's): `renderFacts` measures with `geometryOf` (an oracle test shows the same overlaps,
  containment and layout report as the old copies on all 12 references); `together`, `apart`, `element_in_frame`
  and `hierarchy` read frames through sub-groups; `reports/gates.md` has a report-only frame order robustness table
  (120 orders, seed 20261019, v1 and v2); `layout_crossings_max` added to all 12 cases at today's v1 reference
  counts (kn-06 ≤ 2, kn-07 ≤ 28, kn-10 ≤ 15, others ≤ 1). Not done: the other new render checks and mutation ops of
  §4.3's first row.
- **F4** `renderer/frameOrder.ts` (v2). With this seed, orders with a fatal issue go from kn-06 114/120, kn-07
  95/120, kn-10 97/120 (v1) to 0/120, and to 0 on every other case with links across frames (kn-02–05, kn-12 were
  37–58% in v1). Reference crossings: kn-07 28 → 16, kn-10 15 → 8, kn-06 2 → 2. The caps stay at v1 counts
  until the golden gate renders v2.
- **F5** (v2): `visual-plan/grouping.ts` (`normalizeSubGroups`, `topLevelGroupOf`, `subGroupsOf`,
  `restoreSubGroups`); `wrapSections` takes `organisation` (§3.2 said v1 would come out the same after validation;
  it would not, since `sanitizeGroups` makes a non-empty nested group a frame of its own, so v1 keeps the old
  overwrite); `ungroup` makes a sub-group a plain heading; layout (`subGroupLayout`, backdrop `<g>::sub<i>` and title
  `<g>::sub<i>::title`), render (the title carries the sub-group's stable key; a link to a whole sub-group ends at
  its backdrop) and Re-arrange. The `sanitizeGroups` hook is an integrator request.
- **F3** `renderer/pins.ts` (`resolvePins`: rows move down past pins, reading order kept). Re-arrange pins cards
  the user placed and the user's own unlinked cards by default; `moveUserPlaced` restores the old behaviour;
  `planRearrange` returns `kept` and the `geometryOf` report, and asserts nothing changes outside the selection.
- Not done: Q3's reflow rule (moving other frames only when Acute placed them). It would change `preserve` Update
  output, so it waits for the integrator.

**Status (2026-10-19, F6 and follow-ups):** F0–F6 done, offline (no AI, live or e2e runs). F6 is **v2 only** (distil
mode, through the existing `organisationFor` switch); v1 never splits and its layout snapshot is unchanged.

- **F6** `renderer/frameSplit.ts` (rules of §7 Q5), `layout.ts:layoutPlanWithParts`, `render.ts` (one frame per part;
  part 1 keeps the section's key, title and takeaway; later parts `<group>::part<i>` with no stable key). Golden case
  kn-13-connection-pool-runbook (draft): one section of 5 sub-topics, one frame of 3,270 × 1,879 px in v1, five parts
  that fit in v2. `capabilities.json`: `canvas.frame-split-oversized` is `implemented`.
- **Follow-ups:** sub-topic and sub-group backdrops are no longer obstacles for the layout checks
  (`proposalGeometry`: a link may cross a backdrop, never a card; routes are unchanged, the writer still routes
  around backdrops), so the review bar and the golden gate stop reporting every link inside a sub-topic as a fatal
  "link through a card" (kn-13 v1: 9 → 1, the one left a real card). Update joins new cards to the part holding
  their anchor (`update.ts:frameToJoin`); Re-arrange reproduces the split from the stored plan, treats every part's
  frame as the section's and lays each part out in its own frame, still scoped to the selection. `reports/gates.md`
  shows gate 3 for v1 and v2.
- **Open:** kn-13's `a.layout` stays scoped to v2 (v1 draws one real link through a card, `n2 → s1` over `n1`, and
  120/120 shuffled orders have a fatal issue); the crossing caps and kn-07/kn-10 v2 assertions are Lane J's; the
  writer still treats backdrops as route obstacles (harmless for links inside one sub-topic, may lengthen a route
  that leaves it); Re-arrange leaves a card where it is when the reproduced split puts it in another part than the
  one it is in (a split that changed since the first run); Q3's reflow rule as above.

### 4.2 Guards that stay green throughout

- `layout.test.ts` "geometry snapshot per template" and `render.test.ts` "is deterministic": v1 output identical.
- All 12 golden references pass gates 2 and 3, in v1 and in v2.
- `rearrange.test.ts` "on a selection" and `regenerateScope.test.ts`.
- `layoutPlan` performance test (60 nodes) still "well under a frame". `frameOrder` adds at most about 40 scored
  candidates, and only for plans with cross-frame links.

### 4.3 Requests to other owners (to add to the lanes file's Requests table)

| To | Request | For |
|---|---|---|
| Lane A (golden tooling) | `renderFacts` returns `geometryOf`'s report. New render checks: `reading_order_max`, `frames_fit_screen`, `links_over_frames_max`, `subgroup_contains`. Resolve a node's frame by walking `parent` to the top-level group in `together`, `apart`, `element_in_frame` and `hierarchy` (F13). Add `rendered_frame_count`. Mutation ops `shuffle_groups` and `move_to_group` for regressions | F1, F4–F6 |
| Lane A + the user (case expectations) | Add `layout_crossings_max` to the cases with cross-frame links, and later the checks in §5.2. Expectations wait for the user's review | §5 |
| Owner of `visual-plan/validate.ts` | Call `normalizeSubGroups` from `sanitizeGroups` when `organisation` is `v2` | F5 |
| Owner of `ai/reconcile/rearrange.ts` (Lane G is listed for `ai/reconcile/*` in wave 3; who edits it in wave 2 is Q7) | F2 and F3 changes as above, or permission for Lane F to make them | F2, F3 |
| Owner of `ai/reconcile/update.ts` | `frameToJoin`: join the frame (part) of the new card's anchor, not only the title's frame | F6 |
| Integrator | The `organisation` option from `noteModel` (§3.0); review wording for pinned cards; the "Also move cards I placed" option in the panel; capability entries (§5.3) | F3–F6 |

---

## 5. How it is measured

### 5.1 Gates

The golden suite reports three gates ([README](../../evaluation/knowledge-notes/README.md), "How the evaluation
works"). Lane F moves gate 2 (organisation: C grouping) and gate 3 (layout: H visual). Both run on the references
today and on every recording once one exists.

| Check | Gate | Today | After Lane F |
|---|---|---|---|
| `frame_present`, `frame_count`, `element_in_frame`, `together`, `apart`, `hierarchy` | 2 | Implemented; one level of `parent` | Same assertions; read through the top-level frame (F13, Lane A). `frame_count` stays plan-level (organisation), and `rendered_frame_count` is the layout view |
| `layout_no_fatal`, `cards_no_overlap`, `children_inside_frames`, `frames_no_overlap` | 3 | Implemented, own copies in `render.ts` | From `geometryOf` (same results on all references) |
| `layout_crossings_max` | 3 | Implemented, **used by no case** (F2) | Added per case: first at the reference's count (a regression guard: kn-07 ≤ 28, kn-10 ≤ 15, kn-06 ≤ 2, others ≤ 1), then tightened after F4 to what F4 reaches on the references (expected about kn-07 ≤ 11, kn-10 ≤ 3) |
| Frame order robustness (shuffled groups) | 3 report | — | Report-only line per case: share of orders with a fatal issue. Today 83–93% on kn-06/07/10. Target after F4: 0% |
| `reading_order_max`, `frames_fit_screen`, `links_over_frames_max` | 3 | Not expressible | New render checks (Lane A), on every case |
| `subgroup_contains` | 3 | Not expressible | New, for cases with a sub-group (kn-10 after F5) |
| Scene checks: `user_moves_kept`, `actions_scoped` | 3 (target `scene`) | Not expressible (F12) | New: a scripted move and resize applied to a reference canvas, then Re-arrange/Update replayed offline; checked with `movedUserPlaced`, `outsideScope`, overlaps. kn-12 is the natural host (it already applies a user edit before the update) |

### 5.2 Which assertions become checkable

No organisation or layout assertion is `future` today. Every grouping and visual assertion in the 12 cases is
`implemented`, and the `future` ones are traceability, accounting, Lens markers and card-level updates. What Lane F
changes is the **`unsupported`** entries and capabilities that no assertion could express:

| Case | `unsupported` today | Becomes |
|---|---|---|
| kn-10 | `canvas.frame-nesting`: "an 'External' sub-frame for the supplier API inside persistence & external" | After F5: a sub-group assertion (`subgroup_contains` / `element_in_group`) as `future` with `requires: ["canvas.sub-groups"]`, then `implemented` when the capability lands. The case's expectations need the user's review first |
| kn-07 | `canvas.frame-nesting`: an outer boundary frame around the internal frames | Stays unsupported (a group around frames isn't in this design, Q6) |
| kn-08 | `canvas.frame-nesting`: L2–L5 frames nested in their parents | Stays: Lens uses linked frames on purpose |
| — | `canvas.frame-split-oversized` (planned, no assertion) | Needs a case whose source makes one oversized section with sub-topics (a new case, or kn-02 extended). Until then F6 has no golden evidence and waits (§2.2) |

### 5.3 Capabilities (`capabilities.json`, updated by the integrator with code evidence)

| Capability | Today | After |
|---|---|---|
| `canvas.frame-nesting` | `not_found` | Unchanged (native nesting stays impossible) |
| `canvas.sub-groups` (new) | — | `implemented` after F5: `grouping.ts:normalizeSubGroups`, `layout.ts`, `render.ts` |
| `canvas.frame-split-oversized` | `planned` | `implemented` after F6: `frameSplit.ts` |
| `test.render-geometry` | `implemented` | Evidence gains `renderer/geometry.ts:geometryOf` |
| `layout.respects-manual` (new) | — | `implemented` after F2 and F3: `rearrange.ts`, `pins.ts` |

### 5.4 What counts as done for Lane F

- F0–F2: the golden suite green with crossings caps at the reference counts; the F6/F8 tests green.
- F4: frame order robustness 0% fatal on kn-06/07/10; caps tightened; v1 snapshots unchanged.
- F5: kn-10's sub-group assertion passes on a v2 reference (once the case is updated and reviewed).
- Live confirmation (the first approved recording, not run by this lane): gate 3 passes on the recorded plans of
  the cases with cross-frame links. Until then, F1's evidence is synthetic, and the plan says so.

---

## 6. Open questions for the user

1. **Evidence for changing frame order.** Is the offline shuffle result (83–93% of frame orders give a link
   through a card on kn-06/07/10) enough of a "golden check shows a defect" to change packing in v2? Or should F4 wait
   for the first approved recording to fail `a.layout`? Recommended: build F4 now behind v2, and turn it on with
   distil.
2. **Re-arrange and cards the user moved.** Keep them where they are by default, with "Also move cards I placed"
   as an option (recommended)? Or move everything, as today? Or ask each time?
3. **Is a move outside the selection a change under rule 4?** Today Update and Re-visualize may move other whole
   frames to make room (reflow), and the scope test ignores moves. Options: allowed (today); allowed only for
   objects Acute placed; never (look for free space instead). Recommended: allowed only for frames and cards Acute
   placed, never a user-placed one.
4. **Split frames at render time or in the plan?** Render time (recommended) keeps keys, the stored plan and
   reconciliation untouched, and Re-arrange reproduces it. A plan-level split (`<unit> § group#1`) would show the
   parts to the model and to Update, but touches reconciliation (`sections.ts`, `withoutUnitSections`).
5. **Split thresholds and titles.** "Doesn't fit 1600 × 900 at 50% zoom", at least 4 core members, parts of at
   least 2, and titles "Section — sub-topic" / "Section (2 of 3)". Are these right?
6. **Sub-group scope.** One level inside a frame only. kn-07's "system boundary around several frames" (a group
   *around* frames) is left out. Is that acceptable for now?
7. **Who edits `ai/reconcile/rearrange.ts` and `update.ts` in wave 2?** They are listed under Lane G (wave 3).
   Lane F needs small changes in `rearrange.ts` (F2, F3) and `update.ts` (`frameToJoin`, F6).
8. **Do the Re-arrange fixes count as bug fixes in `preserve`?** F6 (frame by title) and F8 (real sizes) change
   only what Re-arrange proposes, never a first run, so G7's "preserve output identical" isn't affected. Can they
   ship before R1 for everyone?
9. **Shrinking frames.** Frames only ever grow (`growFrame`). Should Re-arrange propose fitting a frame to its
   members when that makes it smaller (a writer change, the integrator's)? The grouped layout plan lists "frames
   don't refit yet" as a known limit.
10. **The switch.** Tie organisation v2 to `noteModel: "distil"` (recommended), or give it its own setting so it can
    be tried on `preserve` canvases first?
11. **Crossing caps.** Add `layout_crossings_max` to the cases now at today's reference counts (a guard), and
    tighten after F4. Is that acceptable as a case change during review?

## 7. Provisional answers (2026-10-19)

The user asked to proceed without manual steps, so the integrator adopted each question's recommended answer. They
are **provisional**, recorded here, and the user can override any of them. Nothing they enable reaches users before
R1, except the two Re-arrange bug fixes (Q8).

| Q | Provisional answer |
|---|---|
| 1 | Yes: the offline shuffle evidence is enough to change frame order, in v2 only (F4). |
| 2 | Re-arrange keeps cards the user moved, by default; an "Also move cards I placed" option moves them too. |
| 3 | During Update and Re-visualize, moving other frames to make room is allowed only for objects Acute placed. A test asserts it. |
| 4 | Split frames at render time; keys, the stored plan and reconciliation stay untouched. |
| 5 | Thresholds as proposed (doesn't fit 1600×900 at 50% zoom, ≥ 4 cards, parts of ≥ 2, titled "Section — sub-topic" or "Section (2 of 3)"). F6 still waits for a golden case that needs it. |
| 6 | One level of sub-group inside a frame is enough for now. |
| 7 | Lane F edits `rearrange.ts` in Wave 2 (Lane G isn't active until Wave 3). |
| 8 | Yes: frame-by-title and real sizes ship as bug fixes. Both break rule 4 or the layout today, and neither changes a first Visualize in `preserve`. |
| 9 | No: frames don't shrink in Re-arrange (unchanged). |
| 10 | v2 is tied to the distil note model. No separate setting. |
| 11 | Yes: add `layout_crossings_max` at today's reference counts, and tighten it after F4. |
