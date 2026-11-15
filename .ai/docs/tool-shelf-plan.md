# Tool Shelf Plan: optional work utilities, Progress first

Status: **Draft for review** (2026-10-19). Plan only: no code has changed. Source PRD:
[../future-features/tool-shelf-features.md](../future-features/tool-shelf-features.md) (cited as "PRD §n") and the six-panel
mock-up shared with it. Decisions marked **Provisional** need the user's yes before the phase that depends on them starts.

**Principle (PRD §46):** the canvas is sacred. Nothing on this plan adds permanent UI. With no tool added, the app looks
exactly as it does today, apart from one small Shelf button.

**Scope:** a Tool Shelf, starting with **Progress** (projects → activities → linked locations). The shared location and
navigation layer is built first, at the size Progress needs and no more. Recent, Pinned, Quick Capture, Scratchpad, Daily Focus
and Work Sets follow, in that order, reusing the same parts.

| Plan | What it said | Here |
|---|---|---|
| PRD §44 | Order: navigation → Recent/Pinned → Shelf → Progress → the rest | **Changed** (user, 2026-10-19): start with Progress. Navigation and the Shelf frame are built only as far as Progress needs. Recent and Pinned move after Progress (TS-D1) |
| [cloud-sync-plan.md](./cloud-sync-plan.md) §3 | Every store gets a sync category; `meta` is device-only | Progress data is user content, so it needs a category before C1 (TS-D4, R4) |
| [feature-map.md](./feature-map.md) §6 | Core features are never behind a flag | A build flag is used only while the work is being built, then removed (TS-D6) |
| [knowledge-notes-lanes.md](./knowledge-notes-lanes.md) | The integrator owns `persistence/repositories/*`, `components/canvas/*` and `e2e/**` | The early phases avoid those files. Changes there go through requests (§10) |

---

## 0. Summary

### 0.1 The change in one paragraph

A **Shelf button** sits at the bottom-right of the canvas area. It opens a **Tool Shelf** panel listing the tools; at first
only Progress is listed, and each other tool is listed once it is built. Adding a tool puts it on a slim **shelf bar** at the
bottom of the canvas. Clicking a tool on the bar opens its **panel docked above the bar** (mock 4). Progress shows projects
(Active by default) with automatic percentages and collapsible activity lists. Each activity can link to an Acute location.
Clicking the title goes there; the ↗ button opens a small popover with **Open here** and **Open beside**. All of this sits in
the app shell, outside Excalidraw, so it survives canvas switches. It works with AI off.

### 0.2 Where this plan departs from the PRD or the mock-up

1. **Recent and Pinned are not Shelf tools.** Mock panels 2, 3 and 6 show them on the Shelf, but PRD §2, §29 and §30 put
   them in the workspace tree. The PRD wins (TS-D2).
2. **"Open on next page" becomes "Open beside".** Acute has no second canvas pane and no "next page". The nearest existing
   behaviour is the right-hand page side peek (`pagePanel`), so that is what the option uses (TS-D3).
3. **Docking.** Version 1 builds only "Docked to bottom" plus the expanded management view. Left and right docking are kept in
   the data model but not built (PRD §18 allows this).

---

## 1. Goals and non-goals

**Goals**
- Progress fully working (PRD §7–§20, §43 "Progress" and "Suggestions" criteria), persisted per workspace, on web and
  desktop.
- One location model and one `navigate(location, mode)` function, used by everything.
- A Shelf frame (entry button, discovery, add/remove, open/close, persisted) that later tools plug into without changing the
  frame.

**Non-goals (PRD §40):** AI suggestions, due dates, reminders, assignees, priorities, dependencies, time tracking, team
features, integrations, dashboards. Universal search (PRD §31) is also out; the Navigator's search stays as it is.

---

## 2. What exists today (checked against the code, 2026-10-19)

- **Shell.** `components/shell/AppShell.tsx` renders `TopHeader`, `Navigator` (only when the sidebar is open), and
  `<main aria-label="Canvas">` → `CanvasViewport`. The Lens slot and `PagePanel` sit to the right. The canvas remounts per
  canvas id (`CanvasViewport` keys `ExcalidrawCanvas`), so **the Shelf mounts in `<main>`, not inside the canvas**.
- **Bottom of the canvas.** The zoom and undo/redo controls are Excalidraw's own footer at the bottom-left
  (`HistoryButtons` portals into it). Excalidraw's help button is at the bottom-right. The Shelf button and bar must clear
  both (TS1).
- **Navigation.**
  - Canvases are addressed by URL (`workspaces/paths.ts` `canvasPath`, `router.push` in `AppShell.goTo`).
  - Pages are not in the URL. They open through `state/pagePanel.ts`: `open(pageId, {elementId})`, and `setExpanded`
    switches between side peek and full width.
  - The only reveal mechanics are `getCanvasCommands().revealPage / revealNode` (`components/canvas/canvasCommands.ts`),
    which are registered by the mounted canvas, and Lens's pending reveal across canvases (`components/lens/lensReveal.ts`).
- **State.** The app uses small module stores with `useSyncExternalStore`; there is no zustand. `state/lensRepoLinks.ts` is
  the per-workspace `meta`-key pattern; `state/uiPrefs.ts` is the per-device preferences pattern.
- **Persistence.** `getPersistence()` uses IndexedDB in the browser and SQLite over IPC on desktop. `meta.get/set` works on
  both with no migration. A new record store needs migration v8, plus IndexedDB, memory and IPC/SQLite implementations and
  conformance tests. Those files belong to the integrator.
- **UI primitives.**
  - `common/RowMenu.tsx` (`MenuButton`, `RowMenu`) gives a positioned, flipping menu that closes on outside click and Escape.
    It is the ↗ popover.
  - `.acute-popover` and `.acute-segmented` CSS classes are available.
  - Icons are hand-written SVG components in `common/icons.tsx`.
  - Tokens are `--acute-*`. The precedent for feature CSS in its own file is `source/sourcePanel.css`.
- **Nothing to reuse** for recents, pins, tasks or progress. The todo block's done/total count (`mcp/resources/serializers.ts`)
  is unrelated data.

---

## 3. Location and navigation (the foundation, sized for Progress)

### 3.1 `AcuteLocation` (`src/navigation/location.ts`, new)

```ts
export interface AcuteLocation {
  workspaceId: string;
  canvasId?: string;   // absent → the workspace's last canvas
  pageId?: string;     // a page on that canvas
  elementId?: string;  // an object on the canvas (block, shape, frame); PRD's blockId/anchor
  label?: string;      // title captured when linked; shown when the target is gone
}
```

PRD §42's `blockId` and `anchor` become one `elementId`, because Acute blocks are canvas elements. Pure helpers in the same
file:
- `sameLocation`
- `describeLocation` (breadcrumb text from the hierarchy plus the page title)
- `isLocationValid` (looks up the hierarchy and the document store)

### 3.2 `navigate(location, mode)` (`src/navigation/navigate.ts`, new)

`mode: "here" | "beside"` (TS-D3). Order of steps:

1. **Workspace or canvas differs:** `router.push(canvasPath(ws, canvas))`. The router comes from a small registration made
   once by `AppShell`, the same way `registerCanvasCommands` works.
2. **Page or element target:** hold a **pending reveal**, then carry it out when the target canvas registers its commands.
   This generalises `lensReveal`'s pattern into `navigation/pendingReveal.ts`. Lens can move onto it later; it is not
   migrated here.
3. **Page target:** `pagePanel.open(pageId, {elementId})`. Then `setExpanded(true)` for **here**, or `setExpanded(false)`
   (side peek, canvas still visible) for **beside**.
4. **Element target:** `revealNode(elementId)` (select, scroll, flash).
5. **Target missing:** no navigation. The caller shows an inline "This location is no longer available." with **Remove link**
   (PRD §42's simple fallback).

For a canvas-only location, **beside** is disabled with the hint "Only pages open beside". **Here** always works.

### 3.3 `LocationMenu` component (`src/components/navigation/LocationMenu.tsx`, new)

A ↗ button that opens a `RowMenu` with *Open here* and *Open beside* next to the row, never a dialog (PRD §13, §33). Every
later tool uses it.

### 3.4 Linking a location

A link is made in two ways:
- **"Link to here"** captures the current canvas, the open page (`pagePanel`) and a single selected element. This is the main
  path and needs no picker.
- **"Choose…"** opens a small searchable list of canvases and pages. It reuses `hierarchy` and `useDocumentList`, with the
  same substring match as the Navigator.

---

## 4. Tool Shelf frame

### 4.1 Layout (mock 1–4, PRD §4, §5, §37)

- **Shelf button:** 28 px, at the bottom-right of `<main>`, left of Excalidraw's help button. It is the only change to a
  clean canvas.
- **Discovery panel:** an `.acute-popover`-style panel above the button (mock 2), not a full-screen dialog. One row per
  tool: icon, name, one line of text, and *Add to shelf* or *Remove*. Only tools that are built are listed (TS-D7).
- **Shelf bar:** after the first tool is added, a slim bar at the bottom centre of `<main>` (icon + label per tool, mock 3)
  plus the settings gear. It has the same height as Excalidraw's footer and must not cover it; there is an overlap check in
  TS1.
- **Tool panel:** clicking a tool opens its panel docked above the bar (mock 4). Width is `min(640px, 100% − 32px)` and
  height at most 55% of `<main>`. One panel is open at a time; Escape or clicking the tool again closes it. It is never a
  side panel, so the Navigator, Page and Lens slots are unchanged (PRD §37).
- **Narrow screens (< 640 px):** the panel becomes a bottom sheet the full width of `<main>` (PRD §38).

### 4.2 Tool registry (`src/tools/registry.ts`, new)

```ts
export type ToolId = "progress" | "quickCapture" | "scratchpad" | "dailyFocus" | "workSets";
export interface ToolDefinition {
  id: ToolId;
  name: string;
  blurb: string;
  icon: (p: IconProps) => JSX.Element;
  Panel: ComponentType<{ workspaceId: string; onClose(): void }>;
  FullView?: ComponentType<{ workspaceId: string; onClose(): void }>; // Progress only (§5.5)
}
```

A tool is one registry entry plus its own folder. The frame never names a specific tool.

### 4.3 Shelf configuration (`src/tools/shelfConfig.ts`, new)

```ts
interface ShelfConfig {
  version: 1;
  tools: { id: ToolId; visible: boolean; dock: "bottom" | "left" | "right" }[]; // array order = shelf order
  open?: ToolId;                                                              // panel open at reload; usually absent
}
```

Stored per device in `meta` under `tools.shelf` (TS-D5), using the `uiPrefs` pattern. When the key is missing, `tools` is
`[]`, so the canvas is unchanged (PRD §35). Unknown tool ids are dropped when the config is read.

### 4.4 Shelf settings (mock 6, TS5)

Rows can be dragged to reorder, each has a show/hide switch, and a ⋯ menu offers *Dock to bottom* (the only dock built),
*Hide from shelf* and *Remove tool*. Hidden means the tool is still added but not on the bar. Removed means it is off the
shelf; its data is kept.

---

## 5. Progress (TS2–TS3, built in full before any other tool)

### 5.1 Data model (`src/tools/progress/model.ts`, new; pure)

```ts
type ProjectStatus = "active" | "paused" | "completed";
type ActivityStatus = "active" | "completed";

interface ProgressProject {
  id: string;            // newId("prj")
  name: string;
  color?: ProjectColor;  // a small fixed palette mapped to --acute-* tokens; no emoji icons
  status: ProjectStatus;
  order: number;
  createdAt: string; updatedAt: string;
}

interface ProgressActivity {
  id: string;            // newId("act")
  projectId: string;
  title: string;
  status: ActivityStatus;
  order: number;
  isCurrent?: boolean;   // at most one per project (enforced in the reducer)
  note?: string;         // plain text
  location?: AcuteLocation;
  createdAt: string; completedAt?: string; updatedAt: string;
}

interface ProgressDoc {  // one per workspace
  version: 1;
  workspaceId: string;
  projects: ProgressProject[];
  activities: ProgressActivity[];
}
```

Changes from PRD §41:
- `workspaceId` lives on the document, not on each project.
- View state (`isExpanded`, the completed-section toggle, the status filter) is stored separately, per device, in
  `tools.progress.view.<ws>`. Expanding a project is not an edit.

### 5.2 Pure operations (`model.ts`, all unit-tested)

- `percent(projectId)`: `round(100 × completed / total)`. Zero activities gives `null`, shown as "—" (PRD §11).
- Create, rename and delete project. Delete takes its activities with it; the undo toast keeps a snapshot.
- `setProjectStatus`, `addActivity`, `editActivity`, `toggleComplete` (completing the current activity clears `isCurrent`),
  `setCurrent` (clears the others in that project), `moveActivity` / `moveProject` (reindex `order`), `setLocation` /
  `clearLocation`.
- Each operation returns a new `ProgressDoc`, and invariants are checked in tests (orders contiguous, one current per
  project). This keeps a later move to Yjs or cloud sync a storage change, not a logic change.

### 5.3 Store (`src/tools/progress/progressStore.ts`, new)

A module store with `useProgress(workspaceId)`, `dispatch(op)` and lazy loading per workspace, copying the shape of
`lensRepoLinks.ts`. Saves are debounced by 300 ms and flushed through `sync/pendingWork.ts` so nothing is lost on unload.
Persistence goes through a `ProgressRepository { load(ws), save(doc) }` interface. Version 1 uses the `meta` key
`tools.progress.<ws>` (TS-D4); tests use an in-memory version.

### 5.4 Compact panel (docked; mock 4, PRD §9, §13, §16)

- **Header:** "Progress", an *Active / Paused / Completed* filter (Active by default), *Open full view*, and ⋯.
- **Project row:** chevron, colour dot, name, a thin progress bar and the percentage. Collapsible; the state is remembered.
  There is never an "N more" (PRD §9).
- **Activities:** the active ones first, with the current one marked →. Then "✓ Completed (n)", collapsed by default.
- **Activity row:**
  - The checkbox completes the activity.
  - The title navigates "here" (it does nothing when there is no link).
  - ↗ opens `LocationMenu`.
  - Double-click renames.
  - ⋯ offers Set as current, Note, Link to here, Choose location, Remove link, Delete.
- **Inline add:** "+ Add activity" (Enter adds and keeps focus, Escape stops) and "+ Add project".

### 5.5 Full view (PRD §17)

*Open full view* shows the same component at a larger size (`FullView`), in a centred panel over the canvas with a backdrop
click to close. It is the one place a larger surface is used, and only on request. It adds:
- an *All* filter;
- search across project and activity titles;
- drag reordering for projects and activities (keyboard: Alt+↑/↓);
- an editable note under each activity;
- project status changes;
- **Suggest activities**.

### 5.6 Suggest activities (PRD §19–§21)

- `src/tools/progress/templates.ts` holds the four V1 templates exactly as in PRD §20, as data.
- `SuggestionProvider { id; suggest(project, existing): string[] }`. The V1 provider is `templateProvider(templateId)`. A
  later AI provider uses the same interface and the same confirm step (PRD §21).
- **Popover (two columns).** On the left, the template picker and checkboxes; titles already in the project are greyed and
  marked "added". On the right, a preview of the project's list with the selected suggestions inserted. Selections can be
  reordered, and there is a *+ Custom activity* field. Nothing changes until **Add selected** (PRD §19).

---

## 6. Later tools (after Progress ships)

| Phase | Tool | Reuses | Storage | Notes |
|---|---|---|---|---|
| TS4 | **Recent** and **Pinned** in the Navigator (collapsed groups above the canvases) | `AcuteLocation`, `navigate`, `LocationMenu` | Recent: device `meta` `nav.recent.<ws>`, 20 entries, consecutive duplicates merged. Pinned: `meta` `nav.pinned.<ws>` (TS-D4) | Recent records a visit in `navigate` and in `AppShell.goTo` / `pagePanel.open`. Pin and Unpin go in the canvas and page row menus. Needs a Navigator edit (§10) |
| TS5 | Shelf settings (reorder, show/hide, dock menu) | §4.4 | `tools.shelf` | Can move before TS4 if wanted |
| TS6 | **Quick Capture** | Shelf panel, `AcuteLocation` (origin) | `tools.captures.<ws>`, list of `{id, text, link?, origin, projectId?, createdAt}` | A bottom panel with a textarea, Mod+Enter to save, and "Captured ✓". A later *Move to…* sends a capture to Progress or Scratchpad |
| TS7 | **Scratchpad** | Shelf panel | `tools.scratchpad.<ws>` | A plain bullet list: add, edit, delete, drag. No formatting (PRD §24) |
| TS8 | **Daily Focus** | `LocationMenu`, Progress activity picker | `tools.focus.<ws>`, at most 5 items, each with a date | Items not done before today are offered again with *Keep* or *Clear*. Not a planner |
| TS9 | **Work Sets** | `AcuteLocation`, "Choose…" picker | `tools.workSets.<ws>` | Create, rename, delete; add, remove and reorder locations |

---

## 7. Phases and tickets

Every phase leaves the app shippable. **Phases TS0–TS3 are the Progress delivery.**

| Phase | Tickets | Done when | Tests |
|---|---|---|---|
| **TS0: Location and navigation** | TS-0.1 `navigation/location.ts` + helpers. TS-0.2 `navigation/pendingReveal.ts`. TS-0.3 `navigate()` with router registration from `AppShell` (one line). TS-0.4 `LocationMenu`. TS-0.5 "Link to here" capture function | `navigate` opens a canvas, a page here or beside, and an element across canvases. A missing target returns `"missing"` | Vitest: helpers, pending reveal (fire on register, cancel on a newer request), `navigate` with stubbed router, `pagePanel` and commands. happy-dom: `LocationMenu` keyboard and Escape |
| **TS1: Shelf frame (Progress only)** | TS-1.1 `tools/registry.ts`. TS-1.2 `shelfConfig.ts` (`meta` `tools.shelf`). TS-1.3 `ShelfButton`, `ShelfDiscovery`, `ShelfBar`, `ToolPanelHost` in `components/tools/`, styled in `toolShelf.css`. TS-1.4 mount in `AppShell` `<main>` behind `NEXT_PUBLIC_TOOL_SHELF`. TS-1.5 icons (Shelf, Progress) | With no tools, only the button is new. Adding Progress shows the bar, and its panel (a placeholder) opens, closes and survives a canvas switch and a reload | Vitest: config read, write and cleaning. e2e `toolShelf.local.spec.ts`: clean canvas, add, open, reload, remove; no overlap with Excalidraw's footer or help button (bounding boxes) |
| **TS2: Progress core (compact)** | TS-2.1 `model.ts` + ops. TS-2.2 `ProgressRepository` (`meta` + memory). TS-2.3 `progressStore.ts` with debounced save and `pendingWork` flush. TS-2.4 compact panel (§5.4). TS-2.5 linking (Link to here, Choose…, Remove link), title navigation and ↗ menu. TS-2.6 missing-location fallback. TS-2.7 cleanup on `deleteWorkspace` (request, §10) | Every PRD §43 "Progress" criterion except docking variants and drag reordering passes. Data survives a reload on web and desktop | Vitest: every op and its invariants, `percent` (0, partial, all), one-current rule, store load/save race (a save during load wins, as in `lensRepoLinks`). happy-dom: panel add, complete, collapse, filter. e2e `progress.local.spec.ts`: create a project, add 3 activities, complete 1 → 33%, link to a page, open here and open beside, delete the page → "no longer available", reload → state kept |
| **TS3: Progress full view and suggestions** | TS-3.1 `FullView` (All filter, search, notes, status). TS-3.2 drag and keyboard reorder. TS-3.3 `templates.ts` + `SuggestionProvider`. TS-3.4 suggest popover. TS-3.5 remove the build flag; add entry-point rows to `feature-map.md` | All PRD §43 "Progress" and "Suggestions" criteria pass | Vitest: templates match PRD §20, provider de-duplicates existing titles, add-selected keeps chosen order. e2e: suggest → deselect 2 → reorder → cancel adds nothing; confirm adds in order |
| **TS4: Recent and Pinned** | §6 row | PRD §43 Recent and Pinned criteria | Vitest: recent merge and cap. e2e: visit 3 canvases → Recent order; pin, reload, navigate |
| **TS5: Shelf settings** | §4.4 | PRD §43 Tool Shelf criteria | e2e: reorder, hide, remove, reload |
| **TS6–TS9** | §6 rows, one phase each | That tool's PRD §43 block | Same pattern: Vitest for the pure model, one local e2e spec per tool |

Estimated size: TS0 + TS1 about 2 sessions, TS2 about 2, TS3 about 1–2. One session can run TS0–TS1 while the design of TS2
is reviewed.

---

## 8. Decisions

| Id | Decision | Status |
|---|---|---|
| TS-D1 | **Order:** TS0 → TS1 → TS2 → TS3 (Progress complete), then TS4 Recent/Pinned, TS5 settings, TS6–TS9 | **Approved** 2026-10-19 (user: "start with the progress tracker") |
| TS-D2 | Recent and Pinned live in the workspace tree, not on the Shelf (PRD over mock-up) | Provisional |
| TS-D3 | "Open on next page" is renamed **Open beside**: the page opens in the right-hand side peek with the canvas still visible. "Open here" opens it full width. For a canvas-only location, *beside* is disabled. No new browser tabs or windows | Provisional |
| TS-D4 | V1 storage is per-workspace `meta` keys behind a `ProgressRepository` interface (no migration, no integrator files). Before cloud-sync C1 (or sooner if export needs it), Progress moves to its own store in a v8 migration and gets the sync category "user content" | Provisional |
| TS-D5 | The Shelf configuration is per device (like `uiPrefs`), not per workspace: tool habits belong to the person and the machine. The tools' data is per workspace | Provisional |
| TS-D6 | `NEXT_PUBLIC_TOOL_SHELF` (fails closed, `config/features.ts`) is on in `.env.development` and off in production until TS3, then removed. Core features stay unflagged after launch (feature-map §6) | Provisional |
| TS-D7 | Discovery lists only built tools; no "coming soon" cards | Provisional |
| TS-D8 | Progress has no undo/redo history of its own. Destructive actions (delete project, delete activity) get a 6-second "Undo" toast | Provisional |
| TS-D9 | Project colours come from a fixed 6-colour palette on `--acute-*` tokens, so light and dark both work; no emoji icons | Provisional |

---

## 9. Risks

- **R1: covering Excalidraw's own UI.** The footer and help button change size with zoom and in phone layout. Mitigation: the
  TS1 e2e checks bounding boxes in both widths, and the bar sits at the bottom centre.
- **R2: navigation timing.** Revealing an element before the new canvas mounts fails. Mitigation: the pending reveal runs only
  when commands are registered, and a newer navigation cancels it (tested in TS0).
- **R3: export gap.** `meta` is not included in the workspace backup bundle, so V1 Progress is lost by backup and restore.
  Mitigation: a Lane E request (§10) to include `tools.progress.<ws>` keys, or bring TS-D4's own store forward.
- **R4: sync category.** Cloud-sync plan §3's guard only covers `db.ts` stores; `meta` keys holding user content would be
  skipped silently. Mitigation: list `tools.*` keys in the sync audit (cloud-sync CS0).
- **R5: drift into project management.** Every addition is checked against PRD §40 and the principle above.

---

## 10. Files and coordination

**New, owned by whichever session takes this work:** `src/navigation/**`, `src/tools/**`, `src/components/tools/**`,
`src/components/navigation/**`, `src/components/tools/toolShelf.css`, and the specs `e2e/local/toolShelf.local.spec.ts` and
`e2e/local/progress.local.spec.ts`.

**Edits to shared files, as requests to their owners:**

| File | Change | Phase | Owner |
|---|---|---|---|
| `components/shell/AppShell.tsx` | Mount `<ToolShelf workspaceId/>` in `<main>`; register the router for `navigate` | TS0–TS1 | Unowned shell; tell the integrator |
| `components/common/icons.tsx` | Add `ShelfIcon`, `ProgressIcon` (later the others) | TS1 | Unowned; additive |
| `config/features.ts`, `.env.development` | `isToolShelfEnabled` | TS1 | Unowned; additive |
| `components/canvas/canvasCommands.ts` | Only if `revealNode` needs a hook for the pending reveal; read-only otherwise | TS0 | Integrator |
| `workspaces/hierarchy.ts` `deleteWorkspace` | Delete the `tools.*.<ws>` and `nav.*.<ws>` meta keys | TS2 | Unowned; tell the integrator |
| `e2e/local/*` (new specs) | New files only | TS1+ | Integrator holds `e2e/**`; request a row |
| `portability/workspaceBundle.ts` | Include `tools.progress.<ws>` (R3) | TS2 | Lane E |
| `components/shell/Navigator.tsx` | Recent and Pinned groups; Pin in row menus | TS4 | Unowned shell |
| `.ai/docs/feature-map.md` | Entry points and the flag row | TS1, TS3 | Docs |

When a session starts this work, it adds a "Tool Shelf" row to *Who is working right now* in
[knowledge-notes-lanes.md](./knowledge-notes-lanes.md) and opens the requests above there.
