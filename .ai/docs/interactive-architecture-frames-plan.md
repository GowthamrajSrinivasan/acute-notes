# Interactive architecture frames — plan

Status: Phases 1–3 done, and Phase 4's canvas-side part (zoom-aware details) done (2026-10-01); the rest of Phases 4–5 is open, placed relative to Lens in [`acute-lens-plan.md`](./acute-lens-plan.md) §9 ("Canvas-side work from the frames plan").

Phase 1 is in:
- `src/domain/canvas/diagram.ts` (+ test): the semantics model and `frameGraph`
- `nodeKindStyle.ts`: the kind palette
- `src/components/canvas/diagramNodes.ts`: the commands
- `src/components/diagram/`: the panel fields, selection mapping and `DiagramOverlay`
- `e2e/local/diagramFrames.local.spec.ts`

Phase 2 is in:
- **Plan format:** plan shapes carry `kind` / `sublabel` / `tag` / `details`, relationships carry `explanation`, and groups carry `diagram` / `cards` (also `metadata.cards`). They are validated per field by `src/domain/canvas/diagramSchema.ts`.
- **Frames:** `src/ai/visual-plan/architectureFrame.ts` wraps a standalone architecture plan with kinds in one diagram section. A section is a diagram when it says so or when a member shape has a kind.
- **Change set and writer:** they carry `semantics`, `diagram` and `explanation`, and a kind sets the shape's colours (cylinders included).
- **AI prompt:** the architecture template asks for kinds.
- **Fix:** a section title that wraps no longer overlaps the first member (`layout.ts`).
- **Composite shapes:** a cylinder's host plus outline selection counts as one node, and clearing its kind resets its outline.

Phase 3 is in:
- **Archify import:** `src/ai/archify/convert.ts` (+ test) turns an Archify architecture document into a plan.
  - Components become shapes with kind, sublabel and tag; a database becomes a cylinder.
  - Boundaries become diagram sections (one level; a component in two boundaries goes to the first). Components outside every boundary share a section named after the diagram.
  - Connections become relationships with labels: `dashed` → `depends_on`, anything else → `flows_to`.
  - Cards become the frame's info cards, with the dot colour mapped to a kind.
  - The Archify id becomes the `stableKey`, so re-pasting an edited document updates the same objects.
- **Not imported yet** (each reported as a warning): authored positions and sizes (Acute lays the diagram out itself), source references (wait for Lens 1B's `acuteNode.sources`), guided views, and Archify diagram types other than architecture.
- **Entry point:** pasting the document into Visualize, bare or in one ```json fence, takes the local tier (`src/ai/content/archifyPlan.ts`): no model call.
- **Mermaid kind guess:** `src/ai/mermaid/componentKinds.ts` (+ tests in `src/ai/archify/convert.test.ts`). A flowchart whose nodes read as components gets kinds and lands in an interactive frame; a flowchart without subgraphs then uses the `architecture` template.
  - A node counts when it's a cylinder or its label names a store, queue, auth piece, external party, cloud service, service or UI.
  - It switches on only at 3 or more recognised nodes and at least 60% of them, so process flowcharts keep their plain look.
- **Tests:** `e2e/local/archifyImport.local.spec.ts` covers both paths through the real Visualize dialog.

- **Mermaid `architecture-beta`** (2026-10-01): `src/ai/mermaid/architecture.ts` (+ test).
  - Built-in icons map to kinds (`database` / `disk` → database, `cloud` → cloud, `internet` → external, `server` → backend); other icons (`logos:aws-s3`) are read with the label.
  - Groups become diagram sections (a nested group becomes its own section). `-->` / `<--` keep direction, `-[label]-` keeps the label, and `{group}` endpoints link sections.
  - Junctions fold into direct links; edge sides (layout hints) are dropped.

Phase 4, the part that stays on the canvas, is in (2026-10-01):
- **Zoom-aware node details** (`src/components/diagram/nodeDetails.ts` + test, drawn by `DiagramOverlay`): a node's sublabel shows from 60% zoom, and its tag from 125%.
  - They sit inside the shape under its label when there's room, otherwise just below it. They're drawn under the neighbourhood dimming.
  - They're an overlay, so the shape's label stays what the user typed. They're also not in image exports.
- **Tests:** `e2e/local/archifyImport.local.spec.ts` (4 tests) covers Archify, the Mermaid flowchart guess, `architecture-beta`, and details by zoom.

The rest of Phase 4 and all of Phase 5 follow the Lens plan's order (§9, "Canvas-side work from the frames plan"): guided views go to Lens, frame deep links are covered by Lens, and the route probe is Lens Trace.

Kind sigils, a global on/off preference, and kinds for outlined sections (no "architecture" section kind yet) are deferred.

Known open bug (master plan L4): ungrouping a composite shape (cylinder, hexagon, document…) breaks it into plain lines, and it stops being one node.

Acute Lens ([`acute-lens-plan.md`](./acute-lens-plan.md)) builds on this model across levels. Its Phase 0 (2026-10-01) split the `acuteNode` / `acuteDiagram` writers so Lens fields survive edits here, and moved the passport card into `components/diagram/Passport.tsx`.

## Goal

Make an architecture diagram that lives inside a canvas frame behave like an Archify diagram. It is still native Excalidraw content that you can edit, move, sync and export, and not an iframe of generated HTML:

- nodes carry a semantic **kind** (frontend, backend, database, cloud, security, messagebus, external), a **sublabel**, a **tag** and optional **details**
- edges carry a label and an optional explanation
- clicking a node opens a **passport card**: kind, sublabel, the frame it belongs to, and its incoming and outgoing relationships with their labels. Clicking a relationship moves to the neighbour and pins that edge.
- the frame has a **legend**, **info cards** and optional **guided views** (named focus sets you can step through)

## Why native, not embedded Archify HTML

Embedding the rendered HTML (about 810 KB per diagram, because of `assets/template.html`) would work, but the diagram could not be edited, arrows could not connect to it, AI reconcile could not see it, and it would duplicate our renderer. The parts of Archify we want are its **data model and interaction patterns**, not its SVG. Most of the plumbing already exists here:

| Archify concept | Existing canvas equivalent | Gap |
|---|---|---|
| `components[]` with `type` / `sublabel` / `tag` | shapes via `create_shape` | no kind, sublabel or tag fields |
| `connections[]` with `label` / `variant` | arrows with bound label + `acuteRelation` | no explanation text; variant ≈ relation style |
| `boundaries[]` (region) | native frames (`frameId`) | frames can't nest, so one boundary level only |
| `meta.views[]` (guided views) | the walkthrough in `DenseBlocks.tsx` | no stored focus sets |
| `cards[]` | rich blocks / the `SectionOverview` overlay | not modelled per frame |
| palette per kind | `relationStyle.ts` (edges only) | no node-kind palette |
| orthogonal routing and a layout check | `routing.ts` (already follows Archify), `layoutCheck.ts` | none |
| architecture layout | the `architecture` template → `layered-boxes` | none |

## Data model

Everything goes in `customData`, so it persists, syncs through Yjs and exports without schema migrations.

```ts
// on a shape inside the frame
customData.acuteNode = {
  kind: "frontend" | "backend" | "database" | "cloud" | "security" | "messagebus" | "external",
  sublabel?: string,        // "query.py · dev_ui.py"
  tag?: string,             // "WORKSPACE=auto"
  details?: string[],       // responsibilities, shown in the passport card
  sources?: { path: string; line?: number; label?: string }[],
};

// on an arrow (the label stays as bound text, as it is today)
customData.acuteEdge = { explanation?: string };

// on the frame
customData.acuteDiagram = {
  type: "architecture",
  interactive: true,
  views?: { id: string; label: string; focus: string[]; note?: string }[], // stable node keys
  cards?: { dot: Kind; title: string; items: string[] }[],
  legend?: "auto" | "hidden",
};
```

- Guided-view `focus` refers to `acuteMeta.stableNodeKey` when present, else the element id, so views survive AI reconcile.
- Add adapter getters `getNodeSemantics`, `getEdgeSemantics` and `getDiagramMeta` in `src/domain/canvas/adapter.ts`, next to `getArrowRelation`.
- Add a pure `frameGraph(frameId, scene)` helper that returns nodes and directed edges from `deriveRelations`, restricted to one frame. The card, highlight, views and route probe all build on it.

## Rendering

- **Kind palette:** a `nodeKindStyle.ts` beside `relationStyle.ts` maps kind to fill and stroke for light and dark, using the Archify values from `template.html`. Setting a kind restyles the shape through `updateScene` like any other edit.
- **Label, sublabel and tag:** a two- or three-line bound text (label bold, sublabel smaller). Excalidraw bound text has one style, so the first version puts the sublabel in the same text element on a second line. A later version could draw the sublabel and tag as a zoom-aware overlay (Archify's "reading depth": hidden below about 0.6 zoom) without mutating the scene.
- **Kind sigil:** a small overlay glyph in the top-left corner of each node. It is view-only and drawn with the same single-transform overlay technique as `SectionOverview.tsx`.
- **Legend and info cards:** an overlay strip under the frame (the `SectionOverview` pattern) that reads `acuteDiagram.cards` and the kinds actually present. An option can instead materialise the cards as rich blocks inside the frame, so they become normal editable content.

## Interaction (view-only; never mutates the scene)

1. **Passport card.** Add a `selectedDiagramNodeStore` fed from `handleChange` in `ExcalidrawCanvas.tsx`, alongside `selectedObjectStore`. When the selected shape has `acuteNode` and sits in an interactive frame, show a scene-anchored card next to it with:
   - kind chip, sublabel, tag, frame title and details
   - outgoing and incoming relations, each showing the edge label and explanation
   - clicking a relation selects and zooms to the neighbour; hovering one highlights that edge
   - the upstream and downstream counts (Archify's "authored reach")
2. **Neighbourhood highlight.** An SVG mask overlay over the frame dims everything except the node, its neighbours and the connecting arrows, and draws accent outlines on them. It is never written to element opacity: that would persist and sync to other clients.
3. **Guided views.** A chapter bar on the frame (reuse the `DenseBlocks` walk-through bar) with previous / next / play. Each step applies the focus-set highlight and zooms to fit. Deep link: `#frame=<id>&view=<id>`.
4. **Edge click.** Clicking an arrow in an interactive frame shows its from → to, label and explanation. This is the existing `ObjectSection` relation dropdown plus an explanation field.
5. **Later:** route probe (shortest directed path between two picked nodes) and kind filter (show only some kinds; renamed from "semantic lens" on 2026-10-01 so it isn't confused with Acute Lens). The route probe reuses Acute Lens's `tracePath` (`src/domain/lens/`), so there is one BFS, not two. Both are cheap once `frameGraph` exists.

## How diagrams get in

1. **AI visualize:** extend the `architecture` template so `shape` nodes may carry `kind`, `sublabel`, `tag` and `details`, and relationships may carry an `explanation`. Carry these through `VisualPlan` → `mapNode.ts` → `create_shape` / `connect` → `changeSetWriter.ts` → `customData`. The generated frame gets `acuteDiagram` with views and cards.
2. **Archify JSON import:** a pure `archifyToVisualPlan()` that maps `components` → shape nodes, `boundaries` → groups/frames, `connections` → relationships, `meta.views` → views and `cards` → cards. Our layout is the default; there is an option to honour Archify `pos`/`size`. Paste or MCP (`render_visual_plan` accepts it). The Archify skill then becomes an authoring front-end with no runtime dependency on it.
3. **Mermaid:** `graphToPlan` already produces architecture plans; add a kind heuristic from node names and shapes (for example a cylinder becomes a database).
4. **Manual:** a frame action "Make interactive diagram" plus a Kind dropdown and Sublabel / Details fields in the properties panel (`usePanelSlot`) for any shape.

## Gating

Per-frame opt-in: `acuteDiagram.interactive`. There is also a global `uiPrefs.interactiveDiagrams` (default on) so a user can turn the overlays off. The feature is not AI-gated, because the viewer works without AI.

## Phases

| Phase | Scope | Tests |
|---|---|---|
| 1 | customData model, adapter getters, `frameGraph`, kind palette, manual Kind field, passport card and neighbourhood highlight | adapter and `frameGraph` unit tests; e2e: click node → card lists relations |
| 2 | architecture template fields end to end (plan → change set → writer), legend, info cards | `validate`, `mapNode` and render snapshot tests; `visualize.local` e2e |
| 3 | Archify JSON import and the Mermaid kind heuristic | pure mapping tests using the Archify example JSON as a fixture |
| 4 | guided views, deep links, zoom-aware sublabel overlay | view-step unit tests; e2e walk-through |
| 5 | route probe (on Lens's `tracePath`), kind filter, optional standalone HTML export of a frame | BFS unit tests (shared with Lens) |

Each phase ends with `npm run typecheck && npm run lint && npm run test` passing.

## Decisions (2026-09-30)

- **Passport card:** a floating card anchored next to the node, Archify style.
- **Info cards:** a read-only overlay generated from `acuteDiagram.cards` for now. Keep the data shape friendly to becoming editable rich blocks later.
- **Boundaries:** one level (the frame). Revisit nesting only if real diagrams need it.
