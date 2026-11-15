# Acute — Work Utilities & Tool Shelf PRD

**Status:** Implementation-ready draft  
**Product:** Acute Notes  
**Feature group:** Workspace utilities / lightweight productivity layer  
**Primary goal:** Help users navigate and manage their daily work without turning Acute into a heavyweight project-management application.

---

# 1. Product vision

Acute's canvas should remain **clean, focused, and uncluttered**.

Users should not be forced to see productivity features such as tasks, scratchpads, recent pages, or daily planning.

Instead, Acute provides a small set of **optional work utilities** that users can discover and enable when useful.

The core principle:

> **Keep the canvas simple. Make useful work utilities available on demand. Let the user decide what stays visible.**

These utilities should help users:

- know what they are currently working on
- quickly navigate to the relevant canvas/page
- capture thoughts without interrupting their workflow
- return to recently used locations
- keep important locations accessible
- maintain lightweight working notes
- optionally organize today's focus
- group frequently used locations

This is **not intended to turn Acute into Todoist, Jira, Linear, Notion Projects, or a full task manager.**

---

# 2. Important UX decision

There are two different categories of functionality.

## A. Workspace tree utilities

These belong naturally in the existing workspace/page navigation.

### Recent

Shows recently accessed pages/canvases.

### Pinned

Shows user-pinned pages/canvases.

These should **not be Tool Shelf items**.

They are navigation primitives and belong inside the workspace tree.

Both are:

- collapsed by default
- always available
- accessible from the workspace tree
- expandable when the user wants them

Example:

```text
WORKSPACES

⌕ Search canvases and pages

▸ My workspace
▾ Progress tracker

▸ Recent
▸ Pinned

▸ pending items
▾ sr3 agent architecture
    ├── cmg-agent changes
    ├── Implementation...
    ├── Judgement layer...
    └── Checks...

+ New page
+ New canvas
```

---

# 3. B. Optional Tool Shelf

The Tool Shelf contains **active work utilities**, not navigation history.

Initial tools:

1. **Progress**
2. **Quick Capture**
3. **Scratchpad**
4. **Daily Focus**
5. **Work Sets**

Users can add/remove these from the Shelf.

The canvas should not show these tools unless the user enables them.

---

# 4. Tool Shelf entry point

The default Acute canvas remains clean.

A small, unobtrusive Shelf button should be available in the application chrome.

Conceptually:

```text
┌────────────────────────────────────────────────────────────┐
│ Acute Notes                       Ask AI   View   ⋯        │
│                                                            │
│                       CANVAS                               │
│                                                            │
│                                                            │
│                                                            │
│                                                            │
│                                                            │
│                                                     ✦      │
└────────────────────────────────────────────────────────────┘
```

Clicking the button opens the Tool Shelf.

---

# 5. Tool Shelf discovery UI

When opened:

```text
┌──────────────────────────────────────────┐
│ Tool Shelf                           ×   │
│                                          │
│ Add useful tools to your workspace.      │
│                                          │
│ ┌────────────────┐ ┌──────────────────┐ │
│ │ ✓ Progress     │ │ ＋ Quick Capture  │ │
│ │ Track projects │ │ Save thoughts    │ │
│ │ and activities │ │ quickly          │ │
│ │ [Add to shelf] │ │ [Add to shelf]   │ │
│ └────────────────┘ └──────────────────┘ │
│                                          │
│ ┌────────────────┐ ┌──────────────────┐ │
│ │ ☀ Daily Focus  │ │ ▣ Scratchpad     │ │
│ │ Today's focus  │ │ Temporary notes  │ │
│ │ [Add to shelf] │ │ [Add to shelf]   │ │
│ └────────────────┘ └──────────────────┘ │
│                                          │
│ ┌──────────────────────────────────────┐ │
│ │ ▱ Work Sets                          │ │
│ │ Group locations you frequently use  │ │
│ │ [Add to shelf]                       │ │
│ └──────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

Once a tool has been added:

- it becomes available from the Shelf
- user can open it
- user can dock it if supported
- user can hide/undock it
- user can reorder tools

---

# 6. Tool Shelf philosophy

Every tool must follow these rules:

### Optional

Nothing should be forced into the user's workflow.

### Lightweight

Each tool should solve one small problem.

### Reversible

User can hide/remove it.

### Persistent

Tool configuration belongs to the workspace/user, not a particular canvas.

### Non-AI dependent

V1 should work without AI.

AI can be added later.

---

# 7. Progress

## Purpose

Progress is the primary Work Utility.

It answers:

> **What am I working on, and where do I go to continue that work?**

It is both:

- a progress tracker
- a navigation layer

It is **not merely a todo list**.

---

## Progress hierarchy

```text
Progress
│
├── Project
│     ├── Activity
│     ├── Activity
│     ├── Activity
│     └── Activity
│
├── Project
│     ├── Activity
│     └── Activity
│
└── Project
```

---

# 8. Project status

Projects support:

- Active
- Paused
- Completed

The default Progress view is:

**Active**

This prevents old projects from overwhelming the user.

Example:

```text
ACTIVE

▾ 🔵 Acute Notes                  72%
▾ 🟣 Slokas                       48%

PAUSED

▸ 🟢 VoiceFlow                    31%

COMPLETED

▸ ✓ Website redesign
```

---

# 9. Project collapse/expand

Projects are collapsible.

This is intentional.

We should **not use artificial limits such as "4 more" or "+ 5 activities".**

The user should be able to see the complete list if they want.

Expanded:

```text
▾ 🔵 Acute Notes                  72%

   ✓ Canvas architecture
   ✓ Block system
   ✓ Progress tracker
   → Visualization fidelity
   ○ Export
   ○ Sharing
```

Collapsed:

```text
▸ 🔵 Acute Notes                  72%
```

The application should remember the user's expansion state.

---

# 10. Activity

An activity has:

```text
Activity
├── id
├── projectId
├── title
├── status
├── order
├── note
├── location
└── timestamps
```

Status:

- Active
- Completed

An activity can optionally be marked as the **next/current activity**.

Example:

```text
✓ Canvas architecture
✓ Block system
✓ Progress tracker
→ Visualization fidelity
○ Export
○ Sharing
```

`→` indicates the user's current/next focus.

Only one activity per project should normally be marked as the current activity.

---

# 11. Automatic progress calculation

Users do **not** manually enter percentages.

Progress is calculated from completed activities.

Example:

```text
3 completed
6 total

= 50%
```

Display:

```text
Acute Notes                   50%
██████████░░░░░░░░
```

If there are zero activities:

```text
Acute Notes                   —
```

---

# 12. Activity navigation

Every activity can optionally point to a location in Acute.

Example:

```text
→ Visualization fidelity                 ↗
```

The location can contain:

```text
workspaceId
canvasId
pageId
blockId / anchor
```

This makes Progress a navigation system.

---

# 13. Activity interaction

There are three primary interactions.

### Checkbox

```text
☐ Visualization fidelity
```

Click:

→ mark completed.

---

### Activity title

```text
Visualization fidelity
```

Click:

→ navigate directly to its associated location.

---

### Navigation arrow

```text
Visualization fidelity             ↗
```

Click:

→ show a small contextual popover.

**Do NOT open a modal.**

Popover:

```text
┌───────────────────────┐
│ Open here             │
│ Open on next page     │
└───────────────────────┘
```

The popover should appear adjacent to the activity.

After selection, it disappears.

---

# 14. "Open here"

Navigates the current canvas/view to the linked location.

The current context remains in the same window.

---

# 15. "Open on next page"

Uses Acute's existing page/navigation mechanism to open the destination in the next page/view.

Do not create a new browser tab unless that is already how the application's existing "next page" behavior works.

---

# 16. Completed activity handling

Active activities should remain visually dominant.

Completed activities can be collapsed.

Example:

```text
▾ 🔵 Acute Notes                 72%

   ACTIVE

   → Visualization fidelity
   ○ Export
   ○ Sharing

   ✓ COMPLETED (3)
```

Clicking `COMPLETED (3)` expands the history.

```text
✓ COMPLETED (3)

✓ Canvas architecture
✓ Block system
✓ Progress tracker
```

The full Progress manager can provide an `All` view.

---

# 17. Progress expanded view

The user can open Progress as a larger utility panel.

```text
┌──────────────────────────────────────────────────────────┐
│ ✦ Progress                                      ×        │
│                                                          │
│ [ Active ] [ All ] [ Completed ]              🔍         │
│                                                          │
│ ▾ 🔵 Acute Notes                                  72%   │
│   ██████████████░░░░                                     │
│                                                          │
│   ✓ Canvas architecture                         ↗       │
│   ✓ Block system                                ↗       │
│   ✓ Progress tracker                            ↗       │
│   → Visualization fidelity                      ↗       │
│   ○ Export                                      ↗       │
│   ○ Sharing                                     ↗       │
│                                                          │
│   + Add activity                 ✦ Suggest activities   │
│                                                          │
│ ▾ 🟣 Slokas                                     48%     │
│   █████████░░░░░░░                                     │
│   ✓ Hanuman Chalisa                             ↗       │
│   → Learning journey                            ↗       │
│   ○ Stories                                     ↗       │
│                                                          │
│ + Add project                                           │
└──────────────────────────────────────────────────────────┘
```

---

# 18. Progress docking

Progress can be docked.

The initial suggested position is bottom-left, but the architecture should support configurable docking.

Potential positions:

- bottom-left
- bottom-right
- left
- right
- bottom

The user controls whether it is:

- docked
- floating
- hidden

V1 can implement only the simplest useful docking option if necessary, while keeping the data model extensible.

---

# 19. Progress activity suggestions

Progress should support a deterministic suggestion system before introducing AI.

User clicks:

**Suggest activities**

Then:

```text
┌────────────────────────────────────────────────────────────┐
│ Suggest activities                                         │
│                                                            │
│ Template: [ Software Project ▾ ]                           │
│                                                            │
│ SUGGESTED                    ADD TO PROJECT                │
│                                                            │
│ ☑ Requirements              ✓ Canvas architecture          │
│ ☑ Architecture              ✓ Block system                 │
│ ☑ Data model                → Visualization fidelity       │
│ ☐ Error handling            ○ Testing                       │
│ ☐ Testing                   ○ Export                        │
│ ☐ Performance                                              │
│ ☐ Documentation                                            │
│ ☐ Deployment                                               │
│                                                            │
│ + Custom activity                                          │
│                                                            │
│                        [ Add selected ]                     │
└────────────────────────────────────────────────────────────┘
```

The user:

1. chooses a template
2. selects activities
3. orders them
4. adds them to the project

Nothing is automatically added without user confirmation.

---

# 20. Initial deterministic templates

V1 templates:

### Software Project

- Requirements
- Architecture
- Data model
- Implementation
- Error handling
- Testing
- Performance
- Documentation
- Deployment
- Monitoring

### Content Project

- Audience
- Research
- Outline
- Draft
- Review
- Visuals
- Publish
- Distribution
- Measure results

### Research

- Define question
- Gather sources
- Organize findings
- Analyze
- Validate
- Summarize
- Document conclusions

### Product Launch

- Define scope
- Build
- QA
- Pricing
- Landing page
- Analytics
- Launch
- Marketing
- Feedback

Templates are starting points, not rigid workflows.

---

# 21. Future AI integration

Do not implement AI dependency in V1.

The architecture should allow the suggestion provider to evolve:

```text
V1

Template
   ↓
Deterministic suggestions
   ↓
User selection
   ↓
Progress
```

Future:

```text
Canvas context
      ↓
AI suggestion engine
      ↓
Suggested activities
      ↓
User selection
      ↓
Progress
```

AI should **suggest**, not silently modify progress.

---

# 22. Quick Capture

## Purpose

Quick Capture solves:

> **I need to remember this, but I don't want to stop what I'm doing.**

It should not force the user to decide where the content belongs.

---

## Interaction

User clicks:

```text
+ Quick Capture
```

A lightweight **bottom panel** opens.

Not a center modal.

This keeps the user connected to the canvas.

```text
┌──────────────────────────────────────────────────────┐
│                                                      │
│                    CANVAS                            │
│                                                      │
├──────────────────────────────────────────────────────┤
│ + Quick Capture                                  ×  │
│                                                      │
│ Capture a thought, task, or link...                  │
│                                                      │
│ [Link] [Attachment] [Tag]                    [Save] │
└──────────────────────────────────────────────────────┘
```

The panel should be small and focused.

---

# 23. Quick Capture behavior

Minimum V1:

- text input
- save
- optional link
- timestamp
- source location/context
- optional project association

After saving:

```text
Captured ✓
```

The capture can later be moved into:

- Progress
- a canvas
- a page
- Scratchpad

Do not force organization during capture.

---

# 24. Scratchpad

## Purpose

Scratchpad is temporary working memory.

Unlike Quick Capture:

**Quick Capture** = "I don't want to lose this."

**Scratchpad** = "I'm currently thinking through this."

Example:

```text
┌────────────────────────────────────────────┐
│ ▣ Scratchpad                            × │
│                                            │
│ • Try horizontal layout for tables         │
│ • Investigate Pinecone issue               │
│ • Ask about validation logic               │
│ • Don't forget API change                  │
│                                            │
│ + Add a note...                            │
└────────────────────────────────────────────┘
```

It should be intentionally simple.

No elaborate formatting.

No task hierarchy.

No project-management functionality.

---

# 25. Scratchpad persistence

Scratchpad is workspace-level.

It should persist between canvases.

The user can:

- add note
- edit note
- delete note
- reorder note

Future functionality could allow:

> Convert to Progress activity

but this does not need to be implemented in the first version.

---

# 26. Daily Focus

## Purpose

Answer:

> **What are the few things I want to focus on today?**

It should remain deliberately lightweight.

Recommended limit:

**3–5 items.**

Example:

```text
☀ Daily Focus

1  → Improve visualization fidelity       ↗
2  → Review block layout                  ↗
3  → Write Progress PRD                   ↗

+ Add item
```

Each item can link to an Acute location.

Clicking the navigation icon uses the same:

```text
Open here
Open on next page
```

interaction.

Daily Focus is not intended to become a calendar or daily planner.

---

# 27. Work Sets

## Purpose

Work Sets solve:

> **I repeatedly work across the same group of locations.**

Example:

```text
▱ Work Sets

▾ Acute Notes

   Architecture
   API
   Testing
   Research

▸ Slokas

▸ VoiceFlow

+ New work set
```

A Work Set stores references to Acute locations.

Clicking a location navigates there.

This is essentially a lightweight workspace/tab-group concept.

---

# 28. Work Set creation

User creates:

```text
+ New work set
```

Example:

```text
Name:
[ Acute Development ]

Add locations:

☑ Architecture
☑ API
☑ Testing
☐ Marketing
☑ Research

[Create]
```

No complex metadata.

---

# 29. Recent

Recent should **not** be part of the Tool Shelf.

It belongs in the workspace tree.

Default:

```text
▸ Recent
```

Click:

```text
▾ Recent

   sr3 agent architecture
   Judgement layer
   Checks: examples
   Progress tracker
```

Show recent canvases/pages based on actual navigation activity.

Suggested initial limit:

**10–20 recent locations.**

This is navigation history, not task history.

---

# 30. Pinned

Pinned also belongs in the workspace tree.

Default:

```text
▸ Pinned
```

Expanded:

```text
▾ Pinned

   Architecture overview
   Product roadmap
   Marketing ideas
   Research
```

Users can pin a location from existing page/canvas actions.

Pinned locations persist until explicitly unpinned.

---

# 31. Search

Search should eventually become the universal navigation layer.

It can search:

- canvases
- pages
- blocks
- Progress activities
- Quick Captures
- Pinned locations
- Scratchpad content

But **universal search does not need to be part of the first implementation of this PRD** if existing search already exists.

The important requirement is to establish reusable navigation/location primitives.

---

# 32. Shared navigation model

This is one of the most important technical requirements.

Progress, Recent, Pinned, Daily Focus, and Work Sets should all reference the same location structure.

Conceptually:

```ts
type AcuteLocation = {
  workspaceId: string;
  canvasId?: string;
  pageId?: string;
  blockId?: string;
  anchor?: string;
};
```

This means:

```text
Progress activity
       ↓
AcuteLocation

Recent
       ↓
AcuteLocation

Pinned
       ↓
AcuteLocation

Daily Focus
       ↓
AcuteLocation

Work Set
       ↓
AcuteLocation
```

Do **not** implement separate navigation logic for every feature.

---

# 33. Shared navigation behavior

Every location-aware item should use the same navigation service.

```text
navigate(location, mode)
```

where:

```text
mode:
  - current
  - nextPage
```

The UI can consistently expose:

```text
↗
```

→

```text
Open here
Open on next page
```

This should be a reusable component.

---

# 34. Tool configuration

Users should be able to manage their Shelf.

Example:

```text
Tool Shelf settings

☷ Progress          ● Docked
☷ Quick Capture     ● Visible
☷ Scratchpad        ● Visible
☷ Daily Focus       ○ Hidden
☷ Work Sets         ● Visible
```

Users can:

- reorder
- show/hide
- dock/undock
- remove from Shelf

The configuration should persist.

---

# 35. Recommended default configuration

Do **not** enable everything by default.

Default:

```text
Workspace tree:
    Recent       collapsed
    Pinned       collapsed

Tool Shelf:
    no large utilities permanently open
```

The user can discover the Shelf and add tools.

A first-use experience can highlight:

> **Add tools to make your workspace work for you.**

But avoid an onboarding wizard.

---

# 36. Visual design principles

All utilities should inherit the existing Acute visual language.

### Avoid

- large colorful dashboards
- excessive cards
- heavy shadows
- dense tables
- multiple permanent sidebars
- large floating windows
- excessive icons
- unnecessary AI decoration

### Prefer

- compact panels
- subtle borders
- small icons
- whitespace
- simple typography
- existing Acute colors
- consistent rounded corners
- contextual actions
- bottom panels where appropriate

The user should still feel:

> **"I'm working on my canvas."**

not:

> **"I'm inside a productivity dashboard."**

---

# 37. Layout rules

The existing Acute layout already has:

- collapsible workspace tree
- collapsible page/content panel
- canvas
- top toolbar
- bottom zoom controls

These must remain the primary UI.

Work utilities must not permanently consume significant canvas real estate.

### Priority hierarchy

```text
1. Canvas
2. Existing navigation
3. Tool Shelf
4. Individual utility panels
```

When both side panels are open, utilities should not create another permanent side panel.

Bottom panels are preferred for:

- Quick Capture
- Scratchpad
- Daily Focus
- Work Sets

Progress may have a docked compact form.

---

# 38. Responsive behavior

On smaller screens:

- Tool Shelf becomes a compact drawer/bottom sheet.
- Progress becomes a bottom sheet.
- Quick Capture remains a small focused panel.
- Workspace tree can remain collapsible.
- Avoid stacking multiple permanent panels.

---

# 39. V1 implementation scope

### Build now

#### Workspace navigation

- Recent
- Pinned
- collapsed by default
- expand/collapse
- shared location model

#### Tool Shelf

- entry point
- tool discovery
- add/remove
- show/hide
- reorder
- persistence

#### Progress

- projects
- Active / Paused / Completed
- activities
- completion
- automatic percentage
- current/next activity
- collapse/expand projects
- activity ordering
- activity notes
- location references
- Open here / Open on next page
- docked compact UI
- expanded management UI
- deterministic activity templates

#### Quick Capture

- bottom panel
- text capture
- save
- optional link/context
- persistence

#### Scratchpad

- bottom panel
- simple notes
- add/edit/delete/reorder
- workspace persistence

#### Daily Focus

- 3–5 items
- location references
- completion
- navigation

#### Work Sets

- create
- rename
- delete
- add/remove locations
- reorder locations
- navigate to locations

---

# 40. Explicitly NOT V1

Do not implement:

- AI-generated progress
- automatic task completion
- automatic task creation
- AI project planning
- due dates
- reminders
- recurring tasks
- assignees
- priorities
- dependencies
- time tracking
- calendar
- notifications
- team task management
- Jira/Linear integrations
- complex analytics
- full project-management dashboards

These can be considered later.

---

# 41. Data model proposal

A simplified model:

```ts
type ProjectStatus = "active" | "paused" | "completed";

type ActivityStatus = "active" | "completed";

interface ProgressProject {
  id: string;
  workspaceId: string;
  name: string;
  icon?: string;
  color?: string;
  status: ProjectStatus;
  order: number;
  isExpanded: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface ProgressActivity {
  id: string;
  projectId: string;
  title: string;
  status: ActivityStatus;
  order: number;
  isCurrent?: boolean;
  note?: string;
  location?: AcuteLocation;
  createdAt: Timestamp;
  completedAt?: Timestamp;
  updatedAt: Timestamp;
}
```

Tool configuration:

```ts
interface WorkspaceToolConfig {
  workspaceId: string;

  shelf: {
    tools: ToolId[];
    visible: boolean;
  };

  toolState: {
    [toolId: string]: {
      enabled: boolean;
      visible: boolean;
      docked: boolean;
      position?: DockPosition;
      order: number;
    };
  };
}
```

---

# 42. Location model

```ts
interface AcuteLocation {
  workspaceId: string;
  canvasId?: string;
  pageId?: string;
  blockId?: string;
  anchor?: string;
}
```

Location resolution should gracefully handle deleted/moved content.

If the target no longer exists:

```text
Location unavailable

This page or block was moved or deleted.

[Find similar location]
```

For V1, a simpler fallback can be:

```text
This location is no longer available.
```

---

# 43. Acceptance criteria

## Tool Shelf

- [ ] Canvas remains visually unchanged when no tools are enabled.
- [ ] User can open Tool Shelf.
- [ ] User can add a tool.
- [ ] User can remove/hide a tool.
- [ ] User can reorder tools.
- [ ] Tool configuration persists after reload.
- [ ] Tool Shelf does not become another permanent sidebar.

## Recent

- [ ] Recent is available in workspace tree.
- [ ] Recent is collapsed by default.
- [ ] Navigation updates Recent.
- [ ] Clicking Recent item opens its location.
- [ ] Recent survives page reload.
- [ ] Duplicate consecutive visits don't create duplicate entries.

## Pinned

- [ ] Pinned is available in workspace tree.
- [ ] Pinned is collapsed by default.
- [ ] User can pin/unpin locations.
- [ ] Pinned items navigate correctly.

## Progress

- [ ] User can create projects.
- [ ] User can change project status.
- [ ] User can add activities.
- [ ] User can complete activities.
- [ ] Progress percentage is calculated automatically.
- [ ] Projects can collapse/expand.
- [ ] Activity ordering can be changed.
- [ ] Current activity can be identified.
- [ ] Activity can reference an Acute location.
- [ ] Clicking activity navigates to location.
- [ ] Navigation arrow opens inline menu.
- [ ] Inline menu offers `Open here`.
- [ ] Inline menu offers `Open on next page`.
- [ ] No modal is used for this navigation choice.
- [ ] Progress can be docked.
- [ ] Progress state persists.

## Suggestions

- [ ] User can choose deterministic template.
- [ ] Suggested activities are displayed.
- [ ] User can select/deselect suggestions.
- [ ] User can reorder selected activities.
- [ ] Nothing is added until user confirms.
- [ ] User can create a custom activity.

## Quick Capture

- [ ] Opens as bottom panel.
- [ ] Does not navigate away from current canvas.
- [ ] User can enter text.
- [ ] User can save.
- [ ] Saved capture persists.
- [ ] Capture can retain originating context.

## Scratchpad

- [ ] Opens as bottom panel.
- [ ] User can add notes.
- [ ] User can edit/delete notes.
- [ ] Notes persist across canvases.

## Daily Focus

- [ ] User can add focus items.
- [ ] User can reorder them.
- [ ] User can mark them complete.
- [ ] Items can link to locations.
- [ ] Navigation follows shared behavior.

## Work Sets

- [ ] User can create work set.
- [ ] User can add locations.
- [ ] User can remove locations.
- [ ] User can reorder locations.
- [ ] User can rename/delete work set.
- [ ] Clicking a location navigates correctly.

---

# 44. Recommended implementation order

I would **not implement all five tools simultaneously**.

### Phase 1 — Navigation foundation

Build:

```text
AcuteLocation
      ↓
NavigationService
      ↓
Open here / Open on next page
```

This becomes the foundation for everything.

### Phase 2 — Workspace navigation

Build:

```text
Recent
Pinned
```

This gives us the shared navigation infrastructure.

### Phase 3 — Tool Shelf

Build:

```text
Tool Shelf
├── add/remove
├── reorder
├── show/hide
└── persistence
```

### Phase 4 — Progress

Build this fully before the other utilities because it is the primary Work Utility.

### Phase 5 — Quick Capture

Simple bottom panel.

### Phase 6 — Scratchpad

Simple bottom panel.

### Phase 7 — Daily Focus

Reuse Progress/location primitives.

### Phase 8 — Work Sets

Reuse location/navigation primitives.

---

# 45. The final Acute experience

The intended experience should look conceptually like this:

```text
                         ACUTE
┌───────────────────────────────────────────────────────────────┐
│                                                               │
│  Workspace tree                  CANVAS                       │
│                                                               │
│  ⌕ Search                       ┌─────────────────────────┐   │
│                                 │                         │   │
│  ▸ Workspace                    │       Your work         │   │
│  ▸ Recent                       │                         │   │
│  ▸ Pinned                       │                         │   │
│                                 └─────────────────────────┘   │
│                                                               │
│                                                               │
│                                                     ✦ Shelf   │
└───────────────────────────────────────────────────────────────┘
```

User opens Shelf:

```text
                    Tool Shelf

        Progress       Quick Capture

        Scratchpad     Daily Focus

        Work Sets

              + Add / Manage
```

User enables Progress:

```text
┌──────────────────────────────────┐
│ ✦ Progress                       │
│                                  │
│ ▾ 🔵 Acute Notes           72%  │
│    ✓ Architecture          ↗    │
│    ✓ Block system          ↗    │
│    → Visualization         ↗    │
│    ○ Export                ↗    │
│                                  │
│ ▾ 🟣 Slokas                48%  │
│    → Hanuman journey       ↗    │
│    ○ Stories               ↗    │
└──────────────────────────────────┘
```

Clicking `↗`:

```text
                   ┌────────────────────┐
                   │ Open here           │
                   │ Open on next page   │
                   └────────────────────┘
```

Clicking Quick Capture:

```text
┌──────────────────────────────────────────────────────┐
│ + Quick Capture                                  ×  │
│                                                      │
│ Capture a thought, task, or link...                  │
│                                                      │
│                                           [ Save ]  │
└──────────────────────────────────────────────────────┘
```

And the canvas underneath remains **the canvas**.

---

# 46. Product principle to give the coding agent

This should be treated as a core implementation constraint:

> **Do not solve usability by adding permanent UI. Solve it through discoverability, optional tools, progressive disclosure, collapsible sections, and reusable navigation.**

And specifically:

> **The canvas is sacred. Work utilities must support the canvas, never compete with it.**

That should guide implementation decisions whenever there is ambiguity.

The long-term vision is that Acute quietly becomes the place where a user can **think, create, remember, organize, and return to their work**, without requiring a separate productivity application for these lightweight tasks.

Refine the implementation plan

- Turn this into engineering tickets
- Define the core data model
