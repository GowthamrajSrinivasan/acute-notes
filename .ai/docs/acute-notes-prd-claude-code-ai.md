# Acute-Notes — Product Requirements Document (PRD)

**Status:** Build-ready MVP specification + AI/MCP-ready architecture  
**Revision:** AI provider architecture updated — user-owned AI access (subscription / BYOK / local), `AIProviderManager`, GitHub Copilot SDK as the only adapter for now, modular extension points for future Claude/ChatGPT subscriptions, explicit fallback; managed AI deferred (2026-09-25)  
Non-destructive Visualize updates added — content-source versioning, block-level provenance/fingerprinting, and diff-based reconciliation so re-running Visualize on changed content never overwrites a user's manual edits, with performance requirements keeping it off the canvas interaction path (F37–F39, §13.15.18–§13.15.22) (2026-09-25)  
§13.15.11's Copilot SDK description corrected against the real, installed `@github/copilot-sdk@1.0.14` (F35 implementation, 2026-09-26) — no native structured output, no `getUsage()` query (usage arrives via the `assistant.usage` event), no exported error classes (`session.error` event instead; `sendAndWait` can resolve `undefined` without throwing), and an undocumented `mode: "empty"` client posture adopted for hardening; see §13.15.11 and §13.15.12 point 5 for the full corrections and the one known routing gap  
Conceptual (not textual) updates added — an update changes only concepts whose *meaning* changed, a rewording changes nothing, and added explanation becomes a linked child (`explained_by`) instead of bloating its concept; the safety guarantees stay deterministic code (F38b, §1.9, §13.15.19a) (2026-09-27)  
Local spatial reflow added — when AI output has no free space near where it belongs, the layout engine makes the minimum room locally (moves only what is in the way, absorbs slack, treats locked objects as walls, prefers moving what Acute placed over what the user placed) and proposes those moves in the same reviewable, one-undo change set; a new flow step is inserted in line instead of beside the diagram (F41, §13.15.19b) (2026-09-27)  
Repo Map over MCP added — the developer's own IDE agent reads and understands a repository and sends it to Acute one module at a time as small JSON sections over MCP; Acute validates, reconciles by stable key, and renders a map canvas with provenance, staleness and user corrections fed back to the agent, without reading the repo or calling any model itself (F43) (2026-09-27)  
**Product:** Acute-Notes  
**Primary concept:** An Excalidraw-simple infinite canvas with real, editable rich-content blocks inspired by Notion/BlockNote.  
**Primary optimization:** Performance first. The app must feel instant, even when offline and while manipulating many canvas objects.  
**Architecture:** Local-first from day one, with a clean synchronization boundary so cloud persistence and multi-user collaboration can be added later without rewriting the editor/canvas model.

---

## 0. Executive Summary

Acute-Notes is a visual thinking and work-notes application.

The user works primarily on an **infinite canvas**. The canvas should retain the simplicity of Excalidraw: a small top toolbar, contextual side panel, quick object creation, pan/zoom, arrows, shapes, freehand drawing, and simple text.

The key difference is that Acute-Notes can place **real structured content on the canvas**:

- rich text with headings and formatting
- numbered and bulleted lists
- checklists / TODOs
- tables
- code blocks
- linked page previews
- images

These are not screenshots. They are live editable objects.

Acute-Notes should also be **AI/MCP-native at the data-model level**. AI should understand the canvas as structured objects and relationships rather than as a picture. AI-created or AI-modified content must use the same native block/object model as human-created content.

A headline AI capability is **Content-to-Canvas (`✨ Visualize`)**: the user pastes or imports a large unstructured input (an AI response, Markdown, notes, documentation) and Acute-Notes turns it into an editable canvas of native objects — text, TODOs, tables, code, pages, shapes, and arrows — rather than an image.

AI is **provider-agnostic** and **user-funded**. Users connect AI they already have — an **existing subscription** (first: GitHub Copilot, via the official GitHub Copilot SDK), **their own API key (BYOK)**, or a **local model** (e.g. Ollama). Acute-Notes does not pay for or proxy inference through an Acute-Notes-owned key. The rest of the application behaves identically whichever provider is used.

> **Acute-Notes owns the AI experience, not the AI bill.**

> **Acute-Notes owns the visual language and object model; AI providers only supply intelligence.**

The guiding interaction model is:

> **Canvas = thinking spatially.**  
> **Block = structured content.**  
> **Page = deep detail.**

A user can therefore reproduce a workspace such as the supplied reference screenshot with native content rather than pasted images: findings, plans, status tables, code, arrows, headings, notes, checklists, and linked documents can all coexist on the same canvas.

---

# 1. Product Principles

## 1.1 Excalidraw simplicity is a product requirement

The canvas must not become a Notion-style UI.

Do not expose dozens of block types in the main toolbar. Keep the primary toolbar compact and familiar.

**Main toolbar answers:** “What am I creating?”

**Side panel answers:** “How does the selected object look/behave?”

**Block editor answers:** “How do I format the content inside this object?”

This separation is mandatory.

## 1.2 Performance beats feature count

The first release intentionally supports fewer object types than BlockNote can technically support.

Do not add functionality simply because a library supports it.

No lag is more important than extra features.

## 1.3 Local first

The local browser/device copy is the primary working state.

Every edit should first become visible locally and be persisted locally. Network sync is an independent concern and must never sit in the critical path of typing, drawing, dragging, resizing, pan, or zoom.

## 1.4 Cloud-ready by architecture, not by premature implementation

MVP does not need accounts, cloud sync, or collaboration.

However, the storage and domain model must be designed so that later we can add:

- authenticated users
- cloud backup
- device sync
- workspace sharing
- real-time collaboration
- presence/cursors
- permissions
- version history

without replacing the canvas or block model.

## 1.5 Native content only

Anything the user can create in the reference screenshot should be creatable natively.

Examples:

- table → actual editable table
- numbered list → actual list
- code → actual editable code block
- title → actual heading/rich text block
- TODO → actual checklist
- page preview → reference to a real page document
- image → actual image object

Images remain supported as a separate object, but they are not a substitute for document content.

## 1.6 AI/MCP-native data model

AI is not an afterthought or a chatbot bolted onto the application. Stable object IDs, page IDs, relationships, source metadata, and command-based mutations must exist from day one so that an AI agent can reason about the workspace structurally.

The core principle is:

> **AI should understand the canvas as structured objects and relationships, not as a picture.**

This enables future integrations with MCP clients such as Claude Code, Cursor, VS Code, and other agent clients without changing the underlying canvas model.

## 1.7 AI works through the same native operations as the user

AI should create and modify the same objects that a human can create:

```text
AI → create_todo() → real TODO block
AI → create_table() → real table block
AI → create_page() → real page object
AI → move_object() → real canvas movement
AI → create_connection() → real canvas relationship/arrow
```

Do not make AI output a separate, non-editable chat-only representation when the requested result belongs on the canvas.

AI mutations should be grouped into reviewable transactions with explicit Accept / Reject / Undo behavior.

## 1.8 Acute-Notes owns the visual language; AI providers only supply intelligence

> **Acute-Notes owns the visual language and object model; AI providers only supply intelligence.**

Consequences:

- AI decides **what content means and how it should be represented**. Acute-Notes decides **how that representation is rendered** — IDs, positions, sizes, layout, colors, persistence.
- AI never outputs images, proprietary canvas formats, React/Excalidraw/BlockNote state, or raw persistence records. It outputs validated, application-defined structures (e.g. `VisualPlan`, declarative change sets).
- No part of the application outside the AI runtime knows which provider or model is in use. Swapping, adding, or removing a provider must not change canvas, block, page, or domain code.
- AI must remain **optional**. With no provider configured, every non-AI feature works exactly the same.
- AI is paid for by the user's own access — subscription, API key, or local model. Acute-Notes never uses an application-owned LLM key for normal user AI operations.

See §13.15 for the full AI Runtime architecture.

## 1.9 AI updates reconcile with the user's edits; they never silently overwrite them

> **AI creates a version of the understanding. The user owns the resulting artifact. A later AI update must reconcile with what the user did to that artifact, never replace it wholesale.**

Consequences:

- Re-running `✨ Visualize` (or any AI update) on changed content is never "regenerate the whole result and swap it in." It produces a new reviewable change set that is matched against the objects already on the canvas, through the same review/accept model as the first Visualize run (F19).
- An object the user has not touched since AI created it may be updated automatically as part of that reviewable change set. An object the user has edited since AI created it is never silently rewritten — it surfaces as an explicit conflict (Apply / Keep mine / View diff).
- Only the parts of the source content that actually changed are re-analyzed. Untouched sections keep their previously generated content instead of being regenerated wholesale — this also avoids re-sending unchanged content to a model and avoids spurious "changes" caused by non-deterministic model wording.
- This tracks only what it needs to compare "AI's last output" against "the user's current content" and "the new AI output." It is not a general version-history feature — that remains out of scope (§3.2).
- **An update reasons about concepts, not text** (F38b). A text diff is not a knowledge diff: "the backend validates the token" → "the backend is responsible for validating the token" is a textual change and no conceptual one, while "…and checks organization membership" is a small textual change and a real conceptual one. The AI tier is asked what changed in *meaning* and proposes changes only for that.
- **Concepts stay concise; explanation goes one level down.** New explanatory detail about an existing concept (how it works, examples, background) becomes a linked child explanation (`explained_by`) placed below that concept — never folded into the concept, never added as another step of a flow. The high-level representation stays clean while detail accumulates beneath it, one level at a time (concept → explanation → deeper explanation).

Two invariants follow for the AI tier:

> **Propose changing an existing representation only when the concept it represents changed.**
> **Never add detail to a parent representation that can be represented as a child explanation.**

They govern what AI *proposes*. What is *safe to write* stays decided by deterministic code, independent of any model's judgement: nothing is written without Accept, an object the user edited is always a conflict, and the whole accepted set is one undo step (F38/F39). A wrong model call can therefore cost a poor proposal, never the user's work.

See §13.15.18–§13.15.22 and §13.15.19a (architecture) and F37–F39, F38b (features) for the full design.

---

# 2. Target User Experience

The user opens a workspace and immediately sees a large infinite canvas with very little UI chrome.

Example mental model:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Acute-Notes   Project / Telemetry Investigation          Share  ⋮  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│              🔒 ✋ ↖ ▢ ◇ ○ → — ✎ T 🖼 🧩 ⋮                        │
│                                                                     │
│     ┌───────────────────┐                                          │
│     │ IN PROGRESS       │──────→┌─────────────────────────────┐    │
│     │ Investigate...    │       │ # Problem Summary           │    │
│     └───────────────────┘       │ Text + bold + list          │    │
│                                 └─────────────────────────────┘    │
│                                                                     │
│            ┌───────────────────┐         ┌────────────────────┐    │
│            │ # Findings        │         │ # Plan Items       │    │
│            │ 1. First issue     │         │ ☑ Fix bug          │    │
│            │ 2. Second issue    │         │ ☐ Add test         │    │
│            └───────────────────┘         └────────────────────┘    │
│                                                                     │
│       ┌───────────────────────────┐    ┌────────────────────────┐ │
│       │ Telemetry Checks           │    │ </> Code               │ │
│       │ ID │ Status │ Issue        │    │ async function ...    │ │
│       └───────────────────────────┘    └────────────────────────┘ │
│                                                                     │
│                         ┌──────────────────────────────┐            │
│                         │ 📄 Observability Plan       │            │
│                         │ Page preview                │            │
│                         │ Open page →                 │            │
│                         └──────────────────────────────┘            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The visual language should be close to the provided Excalidraw screenshots: compact top toolbar, rounded controls, contextual left/right properties panel, muted neutral surface, minimal chrome, strong whitespace, and clear selected-state highlighting.

Using Excalidraw's current toolbar structure and option organization as a direct implementation reference is acceptable. The Acute-Notes additions should fit the same interaction grammar rather than introducing a visually separate design system.

---

# 3. Scope

## 3.1 MVP in scope

### Canvas / drawing

- Infinite canvas
- Pan
- Zoom
- Selection
- Multi-selection
- Rectangle
- Diamond
- Ellipse
- Arrow
- Line
- Freehand draw
- Simple text
- Image
- Lock/unlock object
- Move
- Resize
- Duplicate
- Delete
- Layer ordering
- Undo/redo
- Contextual properties side panel

### Rich content blocks

- Rich text block
- Heading styles
- Paragraphs
- Bold / italic / inline code / links as supported by the chosen BlockNote core configuration
- Bulleted list
- Numbered list
- Checklist / TODO
- Code block
- Table
- Page preview / linked page

### Pages

- Create page
- Open page
- Edit page with BlockNote
- Show page preview on canvas
- Link canvas page preview to a page document
- Back to canvas

### Local persistence

- IndexedDB persistence
- Local auto-save
- Reload without losing content
- Offline-first operation
- Workspace recovery on abnormal browser close

### Basic application chrome

- Acute-Notes branding
- Workspace name
- Minimal page/workspace list
- Search pages (simple title search initially)
- New page
- Export basic workspace/document format

### AI/MCP-ready foundation

- Stable IDs for every canvas object, page, table, TODO, code block, and asset reference
- Semantic relationship model for connected objects
- Structured workspace/canvas/page serializers for AI context
- Domain command layer that AI can invoke later
- AI provider abstraction with streaming support; no Acute-Notes-owned LLM key anywhere (user subscription tokens and BYOK keys are handled per §13.15.13)
- Selection/context model suitable for scoped AI actions
- Provenance metadata for AI/imported/external objects
- Object-creation commands that are the single path for human, AI, import, and MCP object creation (a prerequisite for Content-to-Canvas)

### First AI release (Phase 5, after the editor MVP is stable)

These are planned features, not blockers for the editor MVP:

- Provider-agnostic AI runtime, `AIProviderManager`, and task-based routing (F26)
- GitHub Copilot SDK provider + AI host — the only AI adapter: Copilot subscription and Copilot-SDK BYOK (F35), validated per connection (F36)
- AI Providers settings: subscription / API key / local connections, primary + explicit fallback, Test Connection (F27)
- `✨ Visualize` — Content-to-Canvas pipeline: parser → analysis → `VisualPlan` → deterministic renderer → review (F28–F31)
- Initial visual templates: Flow, Problem → Cause → Solution, Concept Map, Timeline, Decision Tree, Architecture, Comparison, Action Plan
- Non-destructive updates: re-running Visualize on changed content reconciles with the objects already on the canvas instead of replacing them, and never silently overwrites a user's manual edits (F37–F39); updates are conceptual, not textual, and added detail becomes a linked child explanation (F38b)
- Local spatial reflow: AI output goes where it belongs (below its concept, in line in a flow) even on a crowded canvas; the layout engine moves only what is in the way, as reviewable moves in the same change set (F41)

Later AI releases: optional decision model (F32), Mermaid import/convert (F33), Repo Map over MCP after the F20/F21 MCP server (F43), and new subscription adapters (e.g. Claude, ChatGPT) once their providers officially support third-party apps (§13.15.12). Managed AI + credits (F34) is deferred and not planned.

## 3.2 MVP explicitly out of scope

The core canvas MVP should not be blocked by AI or cloud delivery. The following remain outside the initial editor build:

- Real-time collaboration
- Accounts/authentication
- Cloud sync
- External MCP server integrations
- Advanced autonomous AI agents
- Long-running background AI tasks (a bounded, cancellable `✨ Visualize` request is not a long-running task)
- AI-generated content without review
- AI image generation (AI composes native objects; it does not produce pictures)
- Comments
- Mentions
- Complex database relations
- Kanban database
- Calendar database
- Formula engine
- Whiteboard templates marketplace (the small application-owned visual template registry in §13.15.2 is in scope)
- Version history UI (the reconciliation engine, F37–F39, keeps only a bounded per-object baseline snapshot for 3-way diffing — not a browsable revision history)
- Notifications
- Team administration
- Billing, managed AI, and AI credits (deferred, not planned — F34)
- Mobile application
- Native desktop wrapper

These may be added later.

---

# 4. Recommended Technology Foundation

## 4.1 Frontend

- React + TypeScript
- Next.js App Router is acceptable/preferred for the application shell
- Client-side canvas/editor route
- Tailwind CSS and shadcn/ui for application chrome

shadcn/ui is MIT licensed.

## 4.2 Canvas

Use Excalidraw as the starting point for the canvas interaction/rendering and to closely reproduce the minimal toolbar/property-panel behavior.

Excalidraw's repository documentation is MIT licensed.

Do not rewrite basic canvas interaction logic unless the library creates a concrete performance or extensibility blocker.

## 4.3 Rich content editor

Use BlockNote core for the rich block and page editing experience.

BlockNote is block-based, supports rich formatting, tables, drag/drop blocks, slash menus, and real-time collaboration concepts. The majority of BlockNote is MPL-2.0; its XL packages are GPL-3.0/dual-licensed. For the MVP, use only core packages compatible with the project's licensing requirements and avoid XL packages unless licensing is explicitly reviewed.

**Important:** Do not introduce an XL package simply because it makes one export or formatting feature easier.

## 4.4 Local persistence and future collaboration

Use Yjs as the underlying synchronization-ready document state where practical. Yjs and related projects are MIT licensed.

Use `y-indexeddb` for local persistence. It is MIT licensed.

The editor must remain usable when no network provider exists.

## 4.5 AI and MCP foundation

Use a provider-agnostic AI runtime. The UI/domain layer asks for an **AI task** (`ai.run("generate_visual_plan", input)`), never a specific model vendor. Provider-specific code lives only in adapters inside `src/ai/providers/` and, for SDKs that must run in Node (the GitHub Copilot SDK), in the AI host under `src/ai/host/`. See §13.15 for the full design.

Suggested interfaces (full definitions in §13.15.7–13.15.8):

```ts
interface AIRuntime {
  run<T extends AITask>(
    task: T,
    input: TaskInput<T>,
    options?: { signal?: AbortSignal }
  ): Promise<AIRunResult<TaskOutput<T>>>;
}

interface AIProvider {
  id: string;
  name: string;
  capabilities: AICapabilities;
  isConfigured(): Promise<boolean>;
  generate(request: AIRequest): Promise<AIResponse>;
  stream?(request: AIRequest): AsyncIterable<AIStreamChunk>;
  getModels?(): Promise<AIModel[]>;
  getUsage?(): Promise<AIUsage | null>;
  disconnect?(): Promise<void>;
}

interface AIContextProvider {
  getSelectionContext(): Promise<AIContext>;
  getCanvasContext(canvasId: string): Promise<AIContext>;
  searchContext(query: string, scope: SearchScope): Promise<AIContext[]>;
}
```

For MCP, use the official MCP TypeScript SDK when implementing the server boundary. Acute-Notes should expose **resources, tools, and prompts** rather than a single generic JSON endpoint.

The application should also be designed so it can later act as an MCP host for external MCP servers. This is a future integration layer and should not complicate the MVP editor.

Do not use BlockNote XL AI packages as the architectural foundation. Build the AI/MCP layer around the core Acute-Notes data model and command system.

Additional AI dependencies:

- **Schema validation:** use one runtime schema library (e.g. Zod) for `VisualPlan`, task inputs/outputs, and MCP tool inputs, so the same schema validates model output and generates the JSON Schema sent to providers.
- **GitHub Copilot SDK (`@github/copilot-sdk`):** the only provider SDK in the current plan (F35). It runs only in the Node AI host, never in the browser bundle.
- **No other provider SDKs** (`openai`, `@anthropic-ai/sdk`, `@google/genai`, `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`, …) are added now. The adapter structure in §13.15.12 keeps adding one later to a new module plus one registration line.
- **Markdown parsing:** use a small, well-maintained Markdown parser (e.g. an mdast/remark-style parser) for the Content Parser. Lazy-load it on first Visualize/import.
- **Mermaid:** optional, lazy-loaded, only for F33. Never in the initial canvas bundle.


---

# 5. Core Data Architecture

The central architecture decision is to separate **canvas objects** from **rich document data**.

Do not force BlockNote into the canvas scene model and do not force all Excalidraw elements into BlockNote.

## 5.1 Domain model

```ts
type ObjectId = string;
type PageId = string;
type AssetId = string;
type CanvasId = string;

interface CanvasDocument {
  id: CanvasId;
  title: string;
  objectIds: ObjectId[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  version: number;
}

type AcuteObject =
  | ShapeObject
  | ArrowObject
  | LineObject
  | DrawObject
  | SimpleTextObject
  | ImageObject
  | RichBlockObject
  | PagePreviewObject;

interface BaseObject {
  id: ObjectId;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  locked: boolean;
  opacity: number;
  zIndex: number;
  metadata?: {
    title?: string;
    tags?: string[];
    source?: SourceRef;
    ai?: AIMetadata;
  };
}

interface RichBlockObject extends BaseObject {
  type: "rich-block";
  blockType: "text" | "todo" | "table" | "code";
  documentId: string;
}

interface PagePreviewObject extends BaseObject {
  type: "page-preview";
  pageId: PageId;
  previewVersion: number;
}

interface ImageObject extends BaseObject {
  type: "image";
  assetId: AssetId;
  fit: "contain" | "cover";
}

interface PageDocument {
  id: PageId;
  title: string;
  blockNoteState: unknown;
  updatedAt: number;
}

interface SourceRef {
  provider: string;
  externalId?: string;
  url?: string;
  lastSyncedAt?: number;
}

interface AcuteRelation {
  id: string;
  from: ObjectId;
  to: ObjectId;
  type:
    | "relates_to"
    | "caused_by"
    | "depends_on"
    | "supports"
    | "blocks"
    | "implements"
    | "derived_from"
    | "references"
    | "explained_by"; // from a concept to a child explanation of it (F38b)
}

interface AIMetadata {
  createdBy: "user" | "ai" | "import" | "mcp";
  operationId?: string;        // one AI transaction (F19)
  task?: string;               // AITask, e.g. "generate_visual_plan"
  provider?: string;           // connection id actually used, e.g. "copilot", "openai", "ollama"
  authType?: "subscription" | "api_key" | "oauth" | "local";
  model?: string;
  template?: string;           // VisualPlan template, when produced by Visualize
  visualPlanNodeId?: string;   // VisualNode.id this object was rendered from (plan-local, per run)
  sourceRefs?: SourceRef[];

  // Reconciliation (F37–F39, §13.15.18–§13.15.22) — set only on objects created/updated by Visualize.
  contentSourceId?: ContentSourceId;      // which ContentSource this object was derived from
  contentSourceVersion?: number;         // ContentSourceVersion.version at last AI write
  stableNodeKey?: string;                // identity stable across regenerations; unlike visualPlanNodeId, comparable run to run
  contentFingerprint?: string;           // hash of this object's content as AI last wrote it — the reconciliation baseline
  modificationState?: "ai_clean" | "user_modified"; // derived by comparing current content to contentFingerprint
  excludeFromReconciliation?: boolean;   // user opted this object out of future AI updates
}

type ContentSourceId = string;

// The user's pasted/imported input that a Visualize run was based on. Append-only versions;
// not a general document-history feature — see §13.15.19.
interface ContentSource {
  id: ContentSourceId;
  workspaceId: string;
  canvasId: CanvasId;
  origin: "paste" | "import" | "mcp";
  versions: ContentSourceVersion[];
}

interface ContentSourceVersion {
  version: number;              // 1, 2, 3, ... append-only
  text: string;                 // raw pasted/imported text for this version
  createdAt: number;
}
```

`AIMetadata` is **descriptive only** for `createdBy`. No editing, rendering, search, sync, export, or MCP behavior may branch on `createdBy`. An AI-created object must be indistinguishable in behavior from a manually created one.

The reconciliation fields (`contentSourceId` onward) are a deliberate, narrow exception: they exist only so the reconciliation engine (F38) can detect user edits and avoid overwriting them. No other feature — editing, rendering, search, sync, export, or MCP — may read them.

The exact types may be refined during implementation, but the separation must remain.

## 5.2 Important rule: rich content is referenced, not embedded into every canvas render pass

A canvas object should contain lightweight metadata plus a reference to its document.

For example:

```json
{
  "id": "obj_123",
  "type": "rich-block",
  "x": 600,
  "y": 420,
  "width": 500,
  "height": 280,
  "documentId": "doc_789"
}
```

The heavy BlockNote state should not be unnecessarily cloned through React state or serialized on every drag event.

## 5.3 One source of truth per object

Do not maintain multiple conflicting React states for the same object.

Use a clear flow:

```text
User interaction
    ↓
Domain command
    ↓
Local collaborative/local state
    ↓
Renderer update
    ↓
IndexedDB persistence
```

The canvas renderer must be derived from the domain state and transient UI state.

### One object-creation path for every actor

Human UI, AI (in-app), MCP tools, import, and the `VisualPlan` renderer all create and modify objects through the **same domain commands**:

```text
Toolbar / Block menu ─┐
AI change set ────────┤
VisualPlan renderer ──┼──→ Domain commands (create_todo, create_page, create_table,
MCP tools ────────────┤      create_code, create_text, create_shape, create_connection, ...)
Import ───────────────┘            ↓
                            Validation → Transaction → Local state / Yjs
```

Do not create a separate "AI object" type, a parallel note representation, or an AI-only write path.

## 5.4 Stable identity and semantic relationships

Every object must have a stable identity that survives reload, export/import, and future synchronization. Do not use array position, DOM identity, or generated React keys as the durable object identity.

Relationships are first-class metadata and may be rendered visually as ordinary Excalidraw-style arrows. An arrow can optionally have a semantic relationship type without changing its visual appearance.

Example:

```text
Bug B1
  │
  └── caused_by → Validation logic
```

This creates a lightweight knowledge-graph layer that AI can query without inspecting pixels.

## 5.5 AI workspace context

The domain model should support a small contextual view for AI:

```ts
interface AIContext {
  workspaceId: string;
  canvasId?: string;
  selectedObjectIds: ObjectId[];
  nearbyObjectIds?: ObjectId[];
  openPageId?: PageId;
  recentChanges?: string[];
  relevantRelations?: AcuteRelation[];
}
```

Default AI actions should use the smallest useful scope: selection first, then nearby/relevant objects, then the current canvas, and only then the broader workspace. Do not send the whole workspace to an AI model by default.

---

# 6. UI / UX Specification

## 6.1 Main application shell

Target layout:

```text
┌──────────────────────────────────────────────────────────────────┐
│ ☰  Acute-Notes        Project / Telemetry Investigation      ⋮  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│               [ compact floating toolbar ]                       │
│                                                                  │
│                                                                  │
│                       INFINITE CANVAS                            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Optional page/workspace sidebar should be collapsible and hidden by default when possible.

The canvas should dominate the viewport.

## 6.2 Toolbar philosophy

Use an Excalidraw-like compact horizontal toolbar centered near the top.

Recommended MVP order:

```text
🔒 | ✋ | ↖ | ▢ | ◇ | ○ | → | — | ✎ | T | 🖼 | 🧩 | ⋮
```

Where:

- Lock = lock/unlock
- Hand = pan
- Selection = selection
- Rectangle = rectangle
- Diamond = diamond
- Ellipse = ellipse
- Arrow = arrow
- Line = line
- Draw = freehand
- T = simple canvas text
- Image = image
- Block = rich content
- More = secondary actions

**Do not put Table / Todo / Code / Page / Heading directly into the main toolbar.**

## 6.3 Rich Block creation menu

When the user chooses `🧩 Block`, show a very small menu:

```text
┌──────────────────────┐
│ Add block             │
├──────────────────────┤
│ 📝 Text               │
│ 📄 Page               │
│ ☑ Todo                │
│ ▤ Table               │
│ </> Code              │
└──────────────────────┘
```

This is intentionally small.

No database builder in MVP.

## 6.4 AI interaction placement

Do not put an AI button on every block.

Use one of two lightweight entry points:

1. A contextual `✨ Ask AI` action when an object or group is selected.
2. A single optional global `✨` action in the top toolbar once AI is enabled.

Selection-first actions should open a compact command surface:

```text
✨ Ask AI

Explain
Summarize
Visualize
Find related items
Turn into tasks
Create test cases
Create plan
```

The AI surface should make the scope explicit:

```text
○ Selection
○ This canvas
○ This workspace
```

Keep it as lightweight as the rest of Acute-Notes.

### `✨ Visualize` entry points

Visualize turns large unstructured content into native canvas objects (§13.15.1). It has three entry points, none of which adds a new toolbar button:

1. **Selection:** `✨ Ask AI → Visualize` on a selected rich text block, page preview, or multi-selection.
2. **Global ✨ menu:** `Visualize content…` opens a compact paste/import dialog.
3. **Large paste hint:** when the user pastes large or clearly structured content (e.g. Markdown with headings/lists/tables) onto the canvas, the paste is first inserted normally as a rich text block. A small, dismissible, non-modal hint then appears near it: `✨ Visualize this?`. The hint must never auto-run AI and must never delay the paste.

Visualize dialog:

```text
┌───────────────────────────────────────────┐
│ ✨ Visualize                               │
├───────────────────────────────────────────┤
│ [ paste Markdown / text / AI response… ]  │
│                                           │
│ Template  [ Auto ▼ ]                      │
│ Sends ~4,200 words to: <Provider name>    │
│                                           │
│               [ Cancel ]  [ Visualize ]   │
└───────────────────────────────────────────┘
```

- `Template: Auto` lets the runtime pick a template; the user may force one (Flow, Problem → Cause → Solution, Concept Map, Timeline, Decision Tree, Architecture, Comparison, Action Plan).
- The dialog always shows **where content will be sent** and how it is paid for ("GitHub Copilot · your subscription", "Anthropic · your API key", "Ollama · local").
- If no provider is configured, Visualize still offers **local structure-only** conversion (§13.15.1, tier 1) and links to AI Settings.

## 6.5 Side panel

The contextual side panel should visually follow Excalidraw's model.

It appears when an object is selected.

The panel should be narrow enough not to dominate the canvas.

### Rectangle / Diamond / Ellipse

```text
Stroke
[ black ][ red ][ green ][ blue ][ orange ]

Background
[ transparent ][ light ][ light ][ light ][ light ]

Fill
[ hatching ][ dots ][ solid ]

Stroke width
[ thin ][ medium ][ thick ]

Stroke style
[ solid ][ dashed ][ dotted ]

Sloppiness
[ low ][ medium ][ high ]

Edges
[ sharp ][ rounded ]

Opacity
────────────●

Layers
[ bottom ][ down ][ up ][ top ]
```

Use the same compact icon/button language as the Excalidraw reference.

### Arrow

```text
Stroke
Stroke width
Stroke style
Start marker
End marker
Sloppiness
Opacity
Layers
```

### Line

```text
Stroke
Stroke width
Stroke style
Sloppiness
Opacity
Layers
```

### Freehand

```text
Stroke
Stroke width
Pressure
Opacity
```

Remove irrelevant options rather than showing disabled controls.

### Simple text

```text
Color
Font
Size
Alignment
Opacity
Layers
```

Do **not** turn simple text into a full rich editor.

### Image

```text
Opacity
Layers
```

Later additions may include crop/fit, but not MVP.

### Rich block

```text
Type [ Text ▼ ]

Background
[ transparent ][ soft ][ soft ][ soft ][ soft ]

Border
[ none ][ subtle ][ selected ][ dark ]

Border width
[ thin ][ medium ][ thick ]

Opacity
────────────●

Layers
[ bottom ][ down ][ up ][ top ]
```

BlockNote formatting does not belong in this panel.

## 6.6 AI settings

Reachable from the `⋮` menu → `AI settings` (**Settings → AI Providers**). Not part of the canvas chrome.

```text
AI Providers                                     AI [ On ▼ ]
──────────────────────────────────────────────────────────
SUBSCRIPTION
● GitHub Copilot                   Connected · ★ Primary
  Uses your existing Copilot subscription.
  Acute-Notes does not pay for inference.
  Model [ default ▼ ]   [ Test ] ✓   [ Disconnect ]

YOUR API KEY — billed directly by the provider
○ OpenAI                           [ Connect key ]
○ Anthropic                        [ Connect key ]
○ Gemini                           Connected
○ Azure OpenAI / Foundry           [ Connect key ]

LOCAL — no cloud AI charges
○ Ollama                           [ Connect ]
  Endpoint [ http://localhost:11434 ]

Fallback  [ Off ▼ ]     e.g. Gemini — may incur API charges on your key
▸ Advanced: decision model (optional)              ← F32, feature flag

Usage this month
Copilot 41 premium requests · Gemini ~$0.18
```

Connect dialog for an API-key connection:

```text
API key      [ ••••••••••••••• ]  [Show]
Model        [ required for this provider ▼ ]
Endpoint     [ optional, for compatible endpoints ]
Key storage  (•) Remember on this device   ( ) This session only
Route        Requests pass through the Acute-Notes AI host using your key   ← transport, §13.15.13
             [ Test Connection ]
```

Rules:

- The connection list comes from `AIProviderManager` descriptors. The UI does not hard-code providers.
- Every connection shows its access type and billing wording (§13.15.6): **Subscription** — "Uses your existing AI subscription. Acute-Notes does not pay for inference."; **Your API key** — "Uses your own API key. You are billed directly by the AI provider."; **Local** — "Runs locally. No cloud AI charges."
- Only connections that passed F36 are listed; in server-hosted mode, Local connections are hidden. Today every connection is backed by the GitHub Copilot SDK.
- Only providers that officially support third-party subscription authentication appear under Subscription — today, only GitHub Copilot. OpenAI, Anthropic, and Gemini appear under "Your API key" — the UI must not suggest that a ChatGPT, Claude, or Gemini consumer plan can be connected.
- `Test Connection` makes one minimal request through the same adapter used for real calls and reports success, auth failure, quota/allowance exhausted, network/CORS failure, or model-not-found distinctly.
- Exactly one primary. Fallback is off by default; when set, it names one configured connection and shows whether it can incur charges (§13.15.10).
- Keys and tokens are masked by default, never logged, never included in exports, sync, MCP context, telemetry, or error reports (§13.15.13).
- `Off` disables every AI entry point; the UI hides `✨` actions rather than showing disabled ones.

## 6.7 AI progress, data-sent indicator, and review

While an AI request runs:

```text
✨ Analyzing content…   [Cancel]
```

- Show progress as a small non-modal status near the target area or in the header. Never use a blocking overlay.
- The canvas remains fully interactive (pan, zoom, select, edit, create, navigate pages) — see §8.
- Multi-stage requests may update the label: `Parsing…` → `Analyzing…` → `Planning layout…`.
- Results land as a **review change set** (F19) with a ghosted/outlined preview of the proposed objects at their planned positions: `[Review] [Accept all] [Reject]`.
- The first time content is sent to a given destination, and every time a fallback provider is used, the UI must make the destination clear ("Sent to GitHub Copilot using your subscription" / "Sent to <Provider> using your key" / "Used Gemini (fallback) — GitHub Copilot was unavailable").

---

# 7. Feature Specifications with Coding-Agent Prompts

Each feature below contains an implementation prompt that can be pasted into Claude Code or another coding agent as a focused task.

---

## F01 — Application Shell

### Goal

Create the Acute-Notes application shell with a minimal canvas-first layout.

### Requirements

- Acute-Notes branding
- minimal top header
- workspace/canvas title
- optional collapsible left page list
- top floating toolbar area
- canvas area takes maximum viewport space
- responsive desktop-first behavior
- no unnecessary dashboards or cards
- keyboard focus must not be trapped by layout components

### Acceptance criteria

- App opens directly into a canvas workspace.
- Canvas occupies almost the entire viewport.
- Sidebar can be hidden.
- No layout shift during initial load.
- Toolbar remains accessible without covering primary content.

### Coding-agent prompt

> Implement F01 only. Build the Acute-Notes shell in React/Next.js with TypeScript. Keep the UI visually minimal and strongly inspired by the provided Excalidraw screenshots: compact top floating toolbar, lightweight header, muted canvas background, rounded controls, contextual side panel placeholder, and optional collapsible page sidebar. Do not implement actual editing yet. Establish clean component boundaries: `AppShell`, `TopHeader`, `PageSidebar`, `CanvasViewport`, `FloatingToolbar`, `PropertiesPanel`. Avoid global state for UI that can remain local. Prioritize first paint and minimal rerenders. Do not add extra product concepts.

---

## F02 — Canvas Engine

### Goal

Provide the Excalidraw-like infinite canvas experience.

### Requirements

- pan
- zoom
- selection
- multi-selection
- move
- resize
- delete
- duplicate
- lock/unlock
- undo/redo
- keyboard shortcuts
- touchpad / wheel behavior should feel natural

### Acceptance criteria

- Canvas remains smooth while panning and zooming.
- Selecting/moving an object does not cause full application rerender.
- Undo/redo works across canvas object changes.
- Locked objects cannot be moved accidentally.
- Selection can be cleared quickly with Escape.

### Coding-agent prompt

> Implement F02 using Excalidraw as the canvas interaction foundation wherever practical. Reproduce the compact toolbar interaction and contextual property behavior from the reference screenshots. Do not redesign the canvas UI. Keep canvas mutations isolated from React-heavy state updates. Pointer move interactions must use the canvas engine's high-performance path; do not update large React trees on every pointer event. Use requestAnimationFrame or the engine's native interaction loop where appropriate. Build a domain adapter so Acute-Notes objects are not permanently coupled to internal Excalidraw types. Implement undo/redo through commands or transactional state changes, not ad-hoc snapshots on every mousemove.

---

## F03 — Simple Canvas Text

### Goal

Retain Excalidraw-style simple text for quick annotations.

### Requirements

- click Text tool
- click canvas
- type text
- resize text box
- font size
- font family
- alignment
- color
- opacity
- layer order
- double-click existing text to edit

### Design rule

Simple canvas text is intentionally **not** a rich document.

### Coding-agent prompt

> Implement F03. Keep simple text extremely lightweight. It must not instantiate BlockNote. Store plain text plus visual properties in the Acute-Notes canvas object model. Match the reference Excalidraw text interaction closely. Optimize typing and dragging so only the active text object updates. Use a lightweight editor while editing and a static renderer when not editing. Do not add headings, lists, tables, markdown, or rich formatting to this object type.

---

## F04 — Rich Block Object

### Goal

Add a new canvas object that hosts real BlockNote content.

### Requirements

- create rich block via `🧩 Block`
- choose Text/Page/Todo/Table/Code
- rich block can move and resize on canvas
- single click selects object
- double click or enter activates content editing
- block retains its own content/document identity
- block can display a compact border/background
- block can be collapsed/closed from editing mode without losing state

### Critical performance rule

Do not mount a full BlockNote editor for every rich block on the canvas simultaneously if this can be avoided.

Use a lightweight/read-only preview for inactive blocks and activate the full BlockNote editor only for the block currently being edited, or for a very small number of actively edited blocks.

### Coding-agent prompt

> Implement F04 as the bridge between Excalidraw and BlockNote. A canvas rich block must be a first-class Acute-Notes object containing a lightweight reference to a BlockNote document. Use BlockNote core, not Tiptap directly and not BlockNote XL packages. Keep BlockNote editor instances minimized: render inactive blocks as lightweight previews/read-only HTML or another cheap representation, and instantiate the full editor only when the user activates a block. Moving/resizing a rich block must not rerender its entire BlockNote editor tree on every pointer event. Preserve canvas coordinates separately from document content. Make the object adapter provider-agnostic so future Yjs/cloud synchronization can be inserted later. Do not implement cloud sync in this task.

---

## F05 — Rich Text Block

### Goal

Support the formatted text shown in the reference screenshot.

### Supported MVP content

- title/heading
- paragraph
- bold
- italic
- inline code
- link
- bullet list
- numbered list
- basic indentation/nesting
- slash menu for a small subset of supported blocks

### Example

```text
# Problem Summary

The 'mean' is compared with `summary.mean`...

1. First issue
2. Second issue
3. Third issue
```

### Coding-agent prompt

> Implement F05 using BlockNote's core editor. Configure only the minimum required block types and formatting needed to reproduce the supplied reference screenshot: heading, paragraph, bold, italic, inline code, link, bullet list, numbered list, and basic nesting. Keep the slash menu limited to supported items. Do not expose every BlockNote feature. Prioritize editor responsiveness and low bundle/runtime cost. Ensure the resulting document state can be serialized deterministically and stored independently from canvas geometry. Test keyboard navigation, undo/redo, copy/paste, list indentation, and editing after reload.

---

## F06 — TODO / Checklist Block

### Goal

Create a native checklist block.

### Requirements

- checkbox
- checked/unchecked state
- multiple todo items
- keyboard Enter creates next item
- Backspace merges appropriately
- reorder through normal block editing
- preview renders actual states

### Coding-agent prompt

> Implement F06 as a BlockNote-backed checklist object. Do not create a custom canvas-only fake checkbox unless BlockNote's core checklist is insufficient. The canvas preview must be lightweight and reflect checked state. Editing should activate the real BlockNote content. State changes must persist locally immediately. Avoid rerendering unrelated canvas objects when a checkbox changes.

---

## F07 — Table Block

### Goal

Support real editable tables, not images of tables.

### Requirements

- table rows and columns
- cell editing
- add row
- add column
- delete row/column
- copy/paste cells as reasonably supported
- simple text cell content
- resize block on canvas
- preview when inactive

### MVP exclusions

- database relations
- formulas
- filters
- sorting
- advanced column types

### Coding-agent prompt

> Implement F07 using BlockNote's core table capability. Keep the table model local to the rich document. Do not turn the table into a full database. Provide only basic row/column editing required by the reference use case. Optimize inactive table previews so they do not mount large editable DOM structures. Verify that resizing the surrounding canvas object does not destroy the table's internal editing state. Do not add sorting/filtering/formulas in MVP.

---

## F08 — Code Block

### Goal

Support real editable code content.

### Requirements

- multiline code
- monospace rendering
- language label if supported cleanly
- syntax highlighting only if it does not meaningfully harm startup/performance
- copy button
- editable content
- preview mode

### Performance rule

Do not load a huge syntax-highlighting language bundle for every code block.

Prefer lazy loading or a small language set.

### Coding-agent prompt

> Implement F08 with BlockNote's core code-block support or a minimal compatible code block. Prioritize responsiveness over elaborate syntax highlighting. Lazy-load heavy syntax highlighting assets where possible. Only render the full editor for the active block. Add a small copy action. Avoid rerendering the code block while its canvas container is merely moving. Keep language metadata separate from canvas geometry.

---

## F09 — Page Preview Object

### Goal

Allow users to attach a page to the canvas without forcing the whole page into the workspace.

### User flow

```text
🧩 Block → Page
        ↓
Create/select page
        ↓
Page preview appears on canvas
        ↓
Double-click / Open page
        ↓
Full BlockNote page editor
        ↓
Back to canvas
```

### Page preview

Show:

- page icon
- title
- small preview excerpt
- updated time or lightweight metadata
- open-page action

### Coding-agent prompt

> Implement F09. A Page Preview object contains only a `pageId` and canvas presentation metadata. The full BlockNote document lives separately. Render a lightweight preview when the page is not open. Double-click or an explicit Open action navigates to the page editor. When returning, the canvas should reopen at the same viewport and preserve selection where practical. Do not mount the full BlockNote editor inside every page preview. Maintain a clear page/document repository interface so cloud persistence can later replace the local repository implementation without changing UI code.

---

## F10 — Image Object

### Goal

Support image insertion while keeping it distinct from document content.

### Requirements

- file picker
- drag/drop image onto canvas if feasible
- resize
- maintain aspect ratio by default
- opacity
- layers
- local asset persistence

### Coding-agent prompt

> Implement F10. Store image metadata in the canvas object and the actual binary asset through a separate asset repository. For MVP, persist image files locally in IndexedDB or an equivalent local asset store. Never serialize image bytes into every canvas state snapshot. Generate lightweight thumbnails/previews when useful. Prepare an `AssetStore` interface so later the implementation can switch from local storage to S3/GCS/Azure Blob/R2 without changing canvas object contracts.

---

## F11 — Contextual Properties Panel

### Goal

Reproduce the Excalidraw two-toolbar concept.

### Requirements

- contextual panel opens for selected object
- options are limited to relevant properties
- changes apply immediately
- panel disappears when nothing is selected
- panel must not cover excessive canvas area

### Coding-agent prompt

> Implement F11 to closely reproduce the side-panel concept in the provided Excalidraw screenshots. Keep panels compact and contextual. Use a single properties framework with object-specific schemas. Do not create a generic properties inspector with dozens of advanced controls. Each object should expose only the fields defined in the PRD. Use reusable shadcn-style primitives but customize them to visually fit the Excalidraw-like aesthetic. Avoid expensive React rerenders when a property slider changes; update the selected object through a localized command path.

---

## F12 — Undo / Redo / Commands

### Goal

Make editing reliable without storing a full giant snapshot on every interaction.

### Requirements

- Ctrl/Cmd+Z
- Ctrl/Cmd+Shift+Z or platform equivalent
- object creation/removal
- move/resize
- property edits
- text editing
- block edits
- page edits

### Performance strategy

- transaction boundaries
- coalesce drag events
- coalesce slider changes
- do not write every pointer event as an independent persistent history entry

### Coding-agent prompt

> Implement F12 using a command/transaction strategy. A drag operation should become one logical history item, not hundreds of mousemove snapshots. Same for resize and continuous sliders. BlockNote's own internal editing history may remain inside the editor where appropriate, but the canvas history system must not duplicate every keystroke. Define clear transaction boundaries between canvas-level and document-level edits. Ensure undo/redo remains deterministic after reload.

---

## F13 — Local-First Persistence

### Goal

The application must work fully offline and survive reloads/browser restarts.

### Requirements

- IndexedDB-backed local storage
- save automatically
- local write before network/remote sync (none in MVP, but architecture must support it)
- restore last workspace
- robust handling of partial/incomplete writes
- schema versioning
- migration layer

### Recommended persistence model

```text
IndexedDB
├── workspaces
├── canvases
├── canvas objects / document state
├── pages
├── assets
├── metadata
├── ai-settings   (device-local; encrypted keys; never synced/exported)
└── ai-usage      (device-local usage log)
```

For collaborative-ready document state, Yjs documents/updates can also be persisted locally using `y-indexeddb`.

### Coding-agent prompt

> Implement F13 as a local-first repository layer. Use IndexedDB as the persistent local source for MVP. Prefer Yjs + y-indexeddb where collaborative document state is involved, but keep the rest of application metadata behind repository interfaces. All UI edits must commit locally before any asynchronous background operation. Implement versioned schemas and migrations from the beginning. Add recovery behavior for interrupted writes. Do not couple UI components directly to IndexedDB APIs. Create interfaces such as `WorkspaceRepository`, `CanvasRepository`, `PageRepository`, and `AssetRepository`. Provide an in-memory repository for tests.

---

## F14 — Yjs Document Layer

### Goal

Introduce synchronization-ready shared document state without requiring a cloud server yet.

### Requirements

- Y.Doc per logical collaborative document or canvas unit where appropriate
- local persistence
- deterministic document identifiers
- update/change observation
- no network provider required for local operation

### Important architecture

Prefer separate logical documents rather than one giant Y.Doc for an entire account.

Example:

```text
workspace
├── canvas/123 → Y.Doc
├── canvas/456 → Y.Doc
├── page/789   → Y.Doc
└── page/890   → Y.Doc
```

### Coding-agent prompt

> Implement F14 as a synchronization boundary, not as a cloud feature. Create a document-provider abstraction around Yjs. The initial provider is local-only using IndexedDB persistence. The application should be able to replace or augment the provider later with a WebSocket/cloud provider. Do not put authentication, WebSocket code, or server assumptions into canvas components. Expose simple lifecycle methods such as `load()`, `applyLocalChange()`, `subscribe()`, `flush()`, and `dispose()`. Keep Yjs updates incremental; avoid serializing entire workspaces after every change.

---

## F15 — Keyboard and Interaction Shortcuts

### Goal

Make common canvas actions fast.

### MVP shortcuts

- `V` / selection
- `H` / hand/pan if compatible with existing interaction
- `R` rectangle
- `D` diamond
- `O` ellipse
- `A` arrow
- `L` line
- `P` draw
- `T` text
- `I` image
- `B` block
- `Delete/Backspace` delete selected
- `Escape` clear editing/selection
- `Ctrl/Cmd+Z` undo
- `Ctrl/Cmd+Shift+Z` redo
- `Ctrl/Cmd+D` duplicate where not conflicting

Avoid shortcut collisions with text editing.

### Coding-agent prompt

> Implement F15 with a small centralized shortcut registry. Shortcuts should activate canvas tools only when the user is not typing in a contenteditable/editor input. Do not implement dozens of shortcuts. Keep the current tool visible/clear. Test macOS and Windows modifier behavior.

---

## F16 — Basic Page Navigation

### Goal

Provide lightweight deep-dive pages without changing the canvas-first model.

### Requirements

- create page
- rename page
- open page
- save page
- back to canvas
- page list
- basic title search

### Coding-agent prompt

> Implement F16. Pages are separate BlockNote documents linked from the canvas. The page list should be simple and fast. Avoid building a Notion-style sidebar with nested databases, filters, icons, and complex navigation. Use a repository abstraction for page metadata. Preserve the last canvas viewport in local workspace state.

---

## F17 — Export / Import

### Goal

Avoid locking users into an opaque database.

### MVP export formats

1. Workspace bundle: `.acute.json`
2. Human-readable page Markdown export where feasible
3. PNG/SVG/PDF can be considered later after the core model is stable

### Canvas export (added 2026-09-28)

`⋮ → Export canvas…` opens a dialog (styled like AI settings) to export the open canvas:

- **Format: JSON.** The `.acute.json` format with `scope: "canvas"`: that canvas, the blocks it uses, its own and previewed pages, and its images.
  - **Include** options, all on by default. Turning one off strips that detail and leaves a valid file (text, shapes, pages and arrows are always kept):
    - Origin (`metadata.ai` / `customData.acuteMeta`)
    - Block styles
    - Connection types (arrow relation types, plus the derived relations list)
    - Images
    - View settings (viewport, background)
    - Layout hints (`customData.acuteLayout`, F41)
  - **Workspace import refuses a canvas file**, with a clear message: import replaces a whole workspace, so a one-canvas file would drop every other canvas. Importing a single canvas into an existing workspace is future work.
- **Format: Markdown.** Converted from that same JSON (`portability/canvasMarkdown.ts`, a pure function of the bundle):
  - `# Canvas title`, then every object in reading order (top to bottom, left to right within a row):
    - blocks as Markdown;
    - pages as `## Title` + content;
    - frames as `## Name`;
    - shapes by their labels, and free text;
    - images as a placeholder.
  - Then `## Connections`: `- Source → Target (Relation) — "label"`.
  - Detail options for Markdown are future work. The dialog shows none for it yet.

### Proposed `.acute.json` conceptual format

```json
{
  "format": "acute-notes",
  "version": 1,
  "workspace": {
    "id": "workspace_123",
    "name": "Telemetry Investigation"
  },
  "canvases": [],
  "pages": [],
  "assets": []
}
```

For large workspaces, the future portable format should become a ZIP bundle:

```text
project.acute/
├── manifest.json
├── canvases/
│   ├── canvas-123.json
│   └── canvas-456.json
├── pages/
│   ├── page-123.json
│   └── page-456.json
└── assets/
    ├── image-123.webp
    └── image-456.png
```

### Coding-agent prompt

> Implement F17 with a versioned, human-inspectable export format. Do not depend on a proprietary database dump. Implement JSON first. Design serializers so future formats can be added without changing the internal model. Export must not mutate live state. Include schema version and stable IDs. Add validation on import and reject malformed/incompatible versions safely. Avoid relying on BlockNote XL exporters in MVP. Exports must include object `metadata.ai` provenance but must never include AI settings, API keys, or AI usage records. Markdown import should reuse the Content Parser from F28 so import and Visualize share one parsing path.

---

## F18 — AI Selection Actions

### Goal

Provide a small, scoped AI interaction that operates on the current selection without turning Acute-Notes into a chatbot application.

### Requirements

- Show `✨ Ask AI` only when a useful object/block selection exists.
- Provide a compact action menu: Explain, Summarize, Visualize, Find related items, Turn into tasks, Create test cases, Create plan.
- Explicitly show AI scope: Selection / This canvas / This workspace.
- Stream responses where supported.
- Never block canvas interactions while an AI request is running.
- AI output that belongs on the canvas must become native Acute-Notes objects.
- Every action calls the AI runtime by task (F26) — e.g. Summarize → `summarize`, Turn into tasks → `transform_note`, Visualize → the F31 pipeline. No action calls a provider directly.
- Hide all `✨` entry points when AI mode is `Off`.

### Acceptance criteria

- Selecting a block exposes Ask AI without adding persistent clutter to the toolbar.
- AI receives structured content and relevant relationships rather than a screenshot.
- User can cancel a running request.
- AI-generated objects are editable and have provenance metadata.

### Coding-agent prompt

> Implement F18 as the smallest possible AI interaction layer. Build a selection-scoped AI command surface, not a general-purpose chat page. Use the `AIRuntime` from F26 and an `AIContextProvider` so model/vendor choice is isolated; UI code calls `ai.run(task, input)` only. The initial implementation may use a mock provider for deterministic development/testing if no real provider is configured. AI requests must execute outside the canvas interaction critical path. Return structured action results that map to Acute-Notes commands. Do not directly mutate React component state from streamed model tokens. Do not add AI controls to every block.

---

## F40 — AI Conversation History (added 2026-09-26)

### Goal

Let a user reopen and continue what they asked AI about an object, without turning Acute-Notes into a general chat app. Conversations stay anchored to canvas objects.

### Scope decision

F18 was intentionally one-shot. On 2026-09-26 the user chose to extend it into multi-turn conversations: follow-ups use the `chat` task that §13.15.8 reserved for later phases. The surface is still selection-first. There is no free-standing chat page: every conversation starts from a selection, and the canvas side panel lists only this canvas's conversations.

### Requirements

- Starting from Ask AI, a menu action or a typed question starts a conversation, anchored to the selected objects. Follow-ups carry a bounded history (the latest turns within a character budget) plus fresh context rebuilt from the anchors.
- One AI side panel, docked on the right of the canvas (beside the page panel when one is open), with two tabs. The floating Ask AI modal was removed on 2026-09-26 at the user's request.
  - **Chat**: `✨ Ask AI` opens it. It follows the current selection for new chats, and an open conversation stays anchored to its own objects. The layout is bottom-anchored, like assistant side panels: a greeting and three suggestions phrased for what is selected (code → Explain / Create test cases / Plan changes; todo, table and canvas-wide variants), then a **Sharing “…”** chip (click to change the scope; "About “…”" inside a conversation), then the composer. In the composer, `/` or the actions button opens every action, `+` starts a new conversation, the model picker shows the connection and model in use (switch models where the connection can list them, or switch connection), and send. The app has no user profile, so the greeting uses no name.
  - **History**: the clock button next to `✨ Ask AI` (or ⋮ → AI conversations) opens it. A toggle switches between the selected object's conversations ("Selected") and "All on this canvas". It has search, relative age, open (which continues it in Chat), Markdown export, delete, Export all (JSON) and Delete all.
- Saving: "Save AI conversations on this device" is on by default and can be turned off in AI settings. When off, conversations work for the session but are never written. There is a "Delete all saved conversations" action.
- Storage is device-local: one record per conversation in IndexedDB (`aiConversations` headers + append-only `aiTurns`). Never part of workspace documents, Yjs state or `.acute.json` workspace exports (they have their own export). Never holds secrets.
- Writes: one transaction per completed exchange, never per streamed token. A cancelled exchange writes nothing.
- Deleting an object that conversations are about asks whether to delete them too. The question doesn't block: Keep leaves them (marked "deleted object"), and undoing the deletion dismisses the question.
- Cloud readiness: headers change once per exchange and turns are append-only, keyed by (conversationId, seq), so a future sync (Cloud Phase 1–2) pushes only unsent turns in batches. No sync is implemented until the cloud phases exist.

---

## F19 — AI Action Transactions and Review

### Goal

Make AI changes safe, understandable, and reversible.

### Requirements

- Group multiple AI changes into one logical operation.
- Present created/updated/moved/connected objects as a reviewable change set.
- Support Accept, Reject, and Undo.
- Preserve the normal canvas undo model after an AI operation is accepted.
- Never silently delete or overwrite existing content.
- Support large additive change sets from Visualize (tens of objects + connections): preview them as ghosted/outlined objects without committing, accept as **one** transaction, undo as **one** step.
- The user may keep editing the canvas while a change set is pending review. If a pending change references an object that has since been deleted, drop that change (e.g. a connection) and report it rather than failing the whole set.

### Coding-agent prompt

> Implement F19 using the existing command/transaction system from F12. AI must produce a declarative change set first; only the accepted change set may be committed to the domain state. Make one AI request a logical history boundary even if it contains many internal CRDT updates. Add deterministic tests for accept, reject, partial failure, and undo. Never bypass domain validation by directly editing renderer state.

---

## F20 — Acute-Notes MCP Server

### Goal

Expose Acute-Notes workspaces to external MCP clients such as Claude Code, Cursor, VS Code, and other compatible agents.

### MCP Resources

Start with:

```text
acute://workspace/{workspaceId}
acute://canvas/{canvasId}
acute://page/{pageId}
acute://table/{objectId}
acute://todo/{objectId}
acute://context/current
```

Resources should return structured, bounded context suitable for model consumption.

### Coding-agent prompt

> Implement F20 behind a clear `mcp/` module boundary using the MCP TypeScript SDK. Do not couple MCP request handling directly to React components. Reuse domain repositories and serializers. Expose read-only resources first. Resource payloads must use stable IDs and structured object types. `acute://context/current` should describe the current user selection/open page/nearby relevant objects when available, but must never expose secrets or unrelated workspace content. Build contract tests around resource shapes.

---

## F21 — MCP Tool Surface

### Goal

Allow an external agent to perform a small, deliberate set of Acute-Notes actions.

### Initial tool set

#### Read

```text
search_workspace
get_canvas
get_page
get_selected_content
get_related_objects
```

#### Create

```text
create_block
create_page
create_table
create_todo
create_connection
```

#### Modify

```text
update_block
move_object
```

#### Visualize

```text
render_visual_plan
```

Accepts a `VisualPlan` (§13.15.4) from an external agent, validates it with the same schema used for in-app AI output, renders it through the same deterministic renderer (F30), and returns a pending change set for user review. This lets MCP clients produce Acute-Notes visuals without Acute-Notes calling any model, and without the client knowing about positions, IDs, or canvas internals.

Potentially later:

```text
delete_object
```

but destructive operations must require explicit confirmation/permission.

### Coding-agent prompt

> Implement F21 with a deliberately small typed tool surface. Every tool must validate inputs against the domain schema and execute through the same domain command/transaction path used by the UI and AI layer. Return structured results containing stable object IDs and a concise human-readable summary. Do not expose arbitrary database mutation or raw JSON editing tools. Separate safe read operations from write operations. Prepare permission checks at the tool boundary even when the MVP is local-only.

---

## F22 — Semantic Search and AI Context Retrieval

### Goal

Allow AI to find relevant content without loading an entire workspace.

### Initial approach

Index lightweight representations of pages, rich blocks, tables, TODOs, code blocks, and relationship metadata. Include workspaceId, canvasId, pageId, blockId, type, createdAt, updatedAt, tags, and source where available.

Start with deterministic local metadata/title/content search. Add embeddings/vector search only when measured need justifies it.

### Coding-agent prompt

> Implement F22 with a repository-level search abstraction. Start with deterministic local metadata/title/content search and leave an adapter boundary for a later vector/embedding implementation. Search must return stable object references and relevance metadata, not copied renderer state. The AI context builder should cap the number of returned objects and prefer selected/nearby/related content before broad workspace results. Keep indexing asynchronous and off the typing/pointer interaction path.

---

## F23 — Semantic Canvas Relationships

### Goal

Allow ordinary-looking arrows/connectors to carry optional semantic meaning for AI.

### Requirements

Support relationship types:

```text
relates_to
caused_by
depends_on
supports
blocks
implements
derived_from
references
```

Visual appearance remains Excalidraw-like. Metadata is stored separately.

### Coding-agent prompt

> Implement F23 by extending the domain relation model, not by encoding semantics in arrow labels or colors. Preserve normal Excalidraw visual behavior. Provide commands for create/update/delete relation metadata and ensure relations survive export/import. Do not force users to choose a relation type for every arrow; semantic type is optional in MVP. Add tests for relation integrity when either endpoint moves, is duplicated, or is deleted.

---

## F24 — External MCP Sources / MCP Host Boundary

### Goal

Prepare Acute-Notes to consume external MCP servers later so external system information can appear as structured content on the canvas.

### Intended future sources

```text
GitHub
Slack
Linear
Filesystem
Google Drive
Microsoft OneDrive
other MCP servers
```

External objects should retain provenance:

```text
Source: GitHub
External ID: #142
Last synced: ...
```

### Coding-agent prompt

> Implement F24 as an interface boundary only unless an external MCP server is explicitly configured. Define `MCPHostProvider` / adapter contracts so future connectors can be added without changing Acute-Notes objects. External records must be represented as normal Acute-Notes objects with `source` metadata and optional external IDs/URLs. Do not hard-code GitHub, Slack, or other vendor logic into the canvas components.

---

## F25 — AI Provenance and Current Context Resource

### Goal

Make AI-created and externally sourced content understandable and traceable.

### Requirements

Optional metadata:

```text
createdBy: user | ai | import | mcp
operationId
task
provider
authType
model
template
visualPlanNodeId
sourceRefs[]
```

Support simple actions: View context, View changes, Undo.

### Coding-agent prompt

> Implement F25 as lightweight metadata and serializers. Provenance is descriptive only: no behavior may branch on `createdBy`. Do not add large provenance panels or audit systems to the MVP UI. Store enough information to explain where an AI/imported object came from and which logical AI operation created it. Make provenance optional and backwards-compatible. Ensure the current-context resource never exposes auth tokens, provider secrets, or unrelated workspace data.

---

## F26 — AI Runtime, Provider Manager, and Task Routing

### Goal

Provide a single provider-agnostic AI runtime that every AI feature uses, backed by an `AIProviderManager`. See §13.15.7–13.15.10.

### Requirements

- `AIProvider` interface per §13.15.7: `id`, `name`, `authTypes`, `transport`, `capabilities: AICapabilities`, `isConfigured`, `testConnection`, `generate`, optional `stream`, `getModels`, `getUsage`, `disconnect`.
- `AIRequest`, `AIResponse`, and `AIProviderConfig` stay provider-neutral as defined in §13.15.7; secrets are never part of `AIProviderConfig`.
- `AIProviderManager`: register providers, expose descriptors to settings, store the active primary / fallback / decision selection, lazy-initialize providers, check configuration, select models, track availability, apply the explicit fallback policy.
- `AIRuntime.run(task, input, { signal })` — the only AI entry point for application code.
- Task registry: each `AITask` declares its input schema, output schema, default prompt template, and routing policy.
- Initial tasks: `classify`, `select_template`, `extract_content`, `extract_entities`, `extract_relationships`, `summarize`, `generate_note`, `transform_note`, `generate_visual_plan`. `organize`, `suggest`, and `chat` are reserved for later phases.
- Routing policy (§13.15.10) resolves a task to: local handler → optional decision model → primary provider → fallback provider (only when the user enabled fallback). Fallback triggers only on availability failures and is always reported to the UI.
- Capability detection: the runtime picks native structured output, JSON mode, or prompt-for-JSON from `AICapabilities.structuredOutput`; features check capabilities instead of assuming them.
- Structured output: whatever the path, validate with the task's schema (F29); on validation failure allow **one** repair retry, then fail with a typed error.
- Every call supports cancellation via `AbortSignal` and a timeout.
- Every call returns `AIUsage` (§13.15.14) alongside the result, including the provider actually used and whether fallback occurred.
- A deterministic `MockProvider` for development and tests.
- Adapters are registered, not imported, by application code; each adapter module is lazy-loaded.

### Acceptance criteria

- `grep` for provider/vendor names or SDK imports outside `src/ai/providers/` and `src/ai/host/` returns nothing.
- Replacing the configured provider requires no change outside `src/ai/`.
- Structured results that fail schema validation never reach the renderer or domain commands.
- Cancelling a request stops network activity and leaves no partial state.
- With fallback disabled, a primary-provider failure never results in a request to any other provider (test).

### Coding-agent prompt

> Implement F26 in `src/ai/runtime` and `src/ai/providers`. Define `AIProvider`, `AICapabilities`, `AIRequest`, `AIResponse`, `AIProviderConfig`, `AIProviderManager`, `AIRuntime`, a typed task registry, and a routing policy object. Application code may import only `AIRuntime` and task types. Implement `MockProvider` first and build all tests against it. Provider adapters translate generic requests to vendor APIs and must not leak vendor types outside their module. Validate every structured result with the task's schema; allow a single repair retry. Support `AbortSignal` and timeouts end to end. Return `AIUsage` with every result. Implement fallback only as an explicit, user-enabled policy and surface every fallback to the UI. Do not add vendor-specific branches (`if (provider === ...)`) anywhere in the application layer.

---

## F27 — AI Connections Settings and Credential Storage

### Goal

Let users connect the AI they already have — subscription, own API key, or local model — choose a primary and an optional fallback, and store credentials safely. See §6.6, §13.15.6, §13.15.10, §13.15.13.

### Requirements

- AI settings UI per §6.6: Off / On, connections grouped by access type (Subscription / Your API key / Local), connect/disconnect, model, optional endpoint, Test Connection, primary, optional fallback, usage summary.
- The connection list and per-connection fields come from `AIProviderManager` descriptors, including the access-type label and billing wording from §13.15.6.
- Store non-secret `AIProviderConfig` in a dedicated local store (`AISettingsRepository`), **separate from workspace/canvas/page documents and Yjs state**.
- Store secrets per §13.15.13: browser-held BYOK keys encrypted with a non-extractable WebCrypto key (or session-only); GitHub tokens held by the AI host (OS secure storage locally; KMS-encrypted and bound to an HttpOnly session on a server), never readable by page scripts.
- Secrets are never synced, exported, placed in MCP resources, logged, sent to telemetry, included in error reports, or stored in plaintext in any server-side database.
- Document honestly that WebCrypto at-rest encryption protects against casual disk inspection, not against script injection in the page; pair it with a strict Content Security Policy.
- Show each connection's transport before a credential is saved.
- Fallback is off by default. Enabling it requires choosing a specific configured connection and shows whether that connection can incur API charges.

### Acceptance criteria

- With AI `Off` or no connection, every non-AI feature works identically and no AI network request is made.
- Test Connection distinguishes auth failure, quota/allowance exhausted, network/CORS failure, and model-not-found.
- Exported `.acute.json` and Yjs documents contain no key or token material (automated test).
- Disconnect removes the stored secret and, for GitHub, revokes or deletes the token.

### Coding-agent prompt

> Implement F27. Create `AISettingsRepository` backed by a separate IndexedDB store, never inside workspace documents or Yjs. Keep secrets out of `AIProviderConfig`. Encrypt persisted browser-held keys with a non-extractable WebCrypto key; support session-only keys held in memory. Leave GitHub tokens to the AI host (F35) and never expose them to page scripts. Build the settings panel from `AIProviderManager` descriptors — do not hard-code providers in UI. Wire Test Connection to `AIProvider.testConnection()`. Implement primary/fallback selection with fallback off by default. Add tests proving secrets never appear in exports, Yjs updates, MCP resource payloads, or logs.

---

## F28 — Content Parser and Local Structure Detection

### Goal

Turn pasted/imported content into a structured, provider-independent parse tree, and handle simple cases with no AI at all.

### Requirements

- Accept Markdown, plain text, AI responses (usually Markdown), and imported content.
- Produce a `ParsedContent` tree: headings (with levels), paragraphs, bullet/numbered lists, checklists, tables, code blocks (with language), links, images (as references), and plain text runs, each with a source span.
- **Local deterministic tier:** detect content whose structure is already explicit (e.g. checklists → Todo, Markdown tables → Table, fenced code → Code, heading-sectioned documents → text blocks/pages) and build a `VisualPlan` directly without AI.
- Return a confidence signal: "local structure is sufficient" vs "needs AI analysis".
- Handle large input: size limits, chunking by section for AI analysis, and a clear message when content exceeds limits.
- Run off the interaction path; move to a Web Worker if profiling shows main-thread blocking >16 ms.

### Coding-agent prompt

> Implement F28 in `src/ai/content/`. Use a small Markdown parser (lazy-loaded) to produce a typed `ParsedContent` tree with source spans. Implement a local planner that maps explicit structure to a `VisualPlan` without calling any model and reports whether AI analysis is needed. Make parsing pure and unit-testable. Reuse this parser for Markdown import in F17. Do not call React, Excalidraw, or BlockNote from this module.

---

## F29 — VisualPlan Schema, Template Registry, and Validation

### Goal

Define the provider-independent intermediate representation that AI (or the local planner, or an MCP client) produces and Acute-Notes renders. See §13.15.2–13.15.4.

### Requirements

- Versioned `VisualPlan` schema with typed node content per node type (§13.15.4) — no `unknown` content reaches the renderer.
- Application-owned template registry: Flow, Problem → Cause → Solution, Concept Map, Timeline, Decision Tree, Architecture, Comparison, Action Plan. Each template declares allowed node types, required roles/slots, relationship types, and its layout strategy.
- Validation: schema check, template conformance, unique node IDs, relationships referencing existing nodes, no self-loops unless the template allows them, node/relationship count limits (e.g. ≤ 60 nodes initially), text length limits.
- Sanitization: strip unknown fields; treat all text as plain/Markdown content, never HTML to inject.
- Lenient recovery: drop invalid relationships and oversized content with warnings; reject the whole plan only if it is unusable.
- The same validator is used for in-app AI, local planner, and MCP `render_visual_plan`.

### Coding-agent prompt

> Implement F29 in `src/ai/visual-plan/`. Define the `VisualPlan` schema with one schema library so it both validates model output and generates the JSON Schema sent to providers. Build a template registry where each template declares slots, allowed node/relationship types, and a layout strategy id. Implement validation and sanitization with clear warnings; never pass unvalidated data to the renderer. Add fixtures for every template, including malformed plans.

---

## F30 — Deterministic VisualPlan Renderer

### Goal

Convert a validated `VisualPlan` into native Acute-Notes objects through the normal domain commands. See §13.15.3 and §13.15.15.

### Requirements

- Node mapping (§13.15.3): text → rich text block; heading → simple text (section title) or rich-block heading; todo → checklist block; table → table block; code → code block; page → PageDocument + page preview; shape → rectangle/diamond/ellipse with label; image → image object referencing an **existing** asset only; relationship → arrow + `AcuteRelation`.
- Layout is application-owned and **deterministic**: the same plan + same free space → the same positions. Per-template layout strategies (left-to-right flow, columns, timeline axis, tree, radial/seeded concept map, grid).
- Size nodes from their content using cheap measurement (no full BlockNote mount).
- Place the result in free canvas space near the current viewport/selection without overlapping existing objects. When it has an anchor and there is no free space near it, make room locally instead of placing it far away (F41).
- Apply visual styling from the application theme; importance (`low | medium | high`) may map to size/emphasis — never to arbitrary colors from the model.
- Output a **declarative change set** for F19 review; commit only on Accept, as one transaction.
- Stamp `metadata.ai` provenance on every created object.

### Acceptance criteria

- Rendering the same fixture twice produces identical geometry (snapshot test).
- Every created object is editable, movable, searchable, exportable, and undoable exactly like a manually created one.
- A 50-node plan previews without dropping canvas frames and commits in a single transaction.

### Coding-agent prompt

> Implement F30 in `src/ai/renderer/`. Map validated `VisualPlan` nodes to existing domain commands only — do not construct Excalidraw elements or BlockNote documents directly outside the existing adapters. Implement deterministic per-template layout (seeded where any randomness is involved). Measure content cheaply. Produce a declarative change set for F19; do not mutate domain state until the user accepts. Add geometry snapshot tests for each template.

---

## F31 — `✨ Visualize` (Content-to-Canvas) User Flow

### Goal

Ship the end-to-end Visualize experience. See §6.4, §6.7, §13.15.1.

### Requirements

- Entry points: selection action, global `✨` → `Visualize content…`, and the large-paste hint (§6.4).
- Pipeline: F28 parse → local planner (if sufficient) **or** `select_template` + `generate_visual_plan` via F26 → F29 validate → F30 render → F19 review.
- Optional user-forced template.
- Progress states, cancel, and data-destination indicator (§6.7).
- Errors are specific and recoverable: no provider configured (offer local-only + settings), auth failure, rate limit, content too large, invalid plan after retry.
- Canvas stays fully interactive throughout.

### Acceptance criteria

- Pasting a Markdown AI response and choosing Visualize produces an editable canvas of native objects in a single reviewable change set.
- With no provider configured, Markdown with explicit structure still visualizes via the local tier.
- User can pan/zoom/edit during analysis; Cancel stops the request.
- Accept → one undo step removes the entire result.

### Coding-agent prompt

> Implement F31 by composing F26–F30 and F19. Keep orchestration in `src/ai/visualize/` as an async workflow with explicit stages and `AbortSignal` support. UI components only start the workflow, show its stage, and render the review change set. The LLM may only produce a validated `VisualPlan`; it must never manipulate React, Excalidraw, BlockNote, or persistence state. Never auto-run Visualize on paste — only show the hint.

---

## F32 — Optional Decision Model (Cheap Routing)

### Goal

Optionally use a secondary, lower-cost model for lightweight decisions. See §13.15.9.

### Requirements

- Behind a feature flag; configured under AI Settings → Advanced.
- Used only for inexpensive tasks: `classify`, `select_template`, routing, confidence estimation ("does this need deep processing?").
- Uses the user's own subscription, key, or local model like any other connection.
- If not configured, unavailable, errors, or returns low confidence → fall back to the primary provider automatically, without user-visible failure.
- Never required: the product must be fully functional without it.

### Coding-agent prompt

> Implement F32 as a routing-policy extension in F26. Register the decision model as an ordinary `AIProvider` adapter bound to a `decision` role. Route only tasks marked `preferDecisionModel` to it, with automatic fallback to the primary provider on absence, error, timeout, or confidence below a threshold. Add routing tests for every fallback path. Do not reference any specific decision-model vendor outside its adapter.

---

## F33 — Mermaid Import and Convert-to-Native

### Goal

Support Mermaid as an additional representation for flow, sequence, architecture, and state diagrams. See §13.15.5.

### Requirements

- Detect Mermaid code blocks in pasted/imported content.
- Optionally render a Mermaid preview (lazy-loaded library).
- `Convert to canvas`: parse the Mermaid graph into a `VisualPlan` (nodes + relationships) and render through F29/F30 — producing editable shapes, text, and arrows.
- Mermaid source may be kept as a code block and as `sourceRefs` provenance; it is never the canonical Acute-Notes data model.

### Coding-agent prompt

> Implement F33 as a converter from Mermaid to `VisualPlan`, starting with flowcharts, then state and sequence diagrams where the mapping is clean. Lazy-load Mermaid only when a Mermaid block is present. Reuse F29 validation and F30 rendering. Do not store Mermaid as the canonical representation of canvas objects.

---

## F34 — Managed AI Gateway and Credits (Deferred — not planned)

### Goal

None for now. Managed AI conflicts with the cost-ownership objective (§13.15.6). This entry exists only to fix the boundary in case the decision is revisited. See §13.15.14.

### Constraints if ever revisited

- `ManagedAIProvider` is a normal adapter behind `AIProvider`; features behave identically.
- Strictly opt-in and paid; never the default; **never** a fallback for subscription, BYOK, or local users.
- Credits represent product-level actions in a server-side policy — never in the `AIProvider` interface.
- The UI always shows that content is sent to Acute-Notes managed AI and what it costs.

### Coding-agent prompt

> Do not implement F34. Do not add an Acute-Notes-owned LLM key, AI gateway, or credit logic anywhere in the codebase.

---

## F35 — GitHub Copilot SDK Provider and AI Host

### Goal

Ship the first real adapter: `CopilotProvider`, built on the official GitHub Copilot SDK, serving the Copilot subscription and the SDK's BYOK connections. See §13.15.11 and §13.15.13.

### Requirements

- AI host: Next.js route handlers on the Node.js runtime under `src/app/api/ai/`, delegating to `src/ai/host/`. The browser-side `CopilotProvider` talks only to these routes (request + streamed response); it never imports the SDK.
- Only `src/ai/host/copilot/` imports `@github/copilot-sdk`. It implements the provider-neutral `HostRuntime` interface. **Implemented routing gap:** the routes actually shipped are flat — `/api/ai/run`, `/api/ai/stream`, `/api/ai/models` — not the per-connection-id form (`/api/ai/connections/:id/test`, `/api/ai/connections/:id/models`) §13.15.12 point 5 describes, because F27 (which defines what a "connection" *is*) doesn't exist yet. Revisit the route shape when F27 lands; until then a single `getHostRuntime()` singleton stands in for the connection-id dispatch.
- GitHub OAuth is implemented as the first `AuthFlow`; credential persistence goes through `CredentialStore`. **Not yet implemented in F35** — there is no credential store to read from yet, so the route handlers take the caller's `gitHubToken` straight off the request's `Authorization` header instead (an `AI_HOST_MODE=local|server` env var gates whether a missing token may fall back to the host's own logged-in user). F27 replaces this with real per-user storage populating that same header, not a new gating mechanism.
- Auth: GitHub OAuth / GitHub App user token (`gitHubToken`) in both deployment modes; the SDK's signed-in-user option only in local mode; `useLoggedInUser: false` in server mode. Classic PATs are not offered.
- BYOK through the SDK's `provider` config for `openai`, `azure`, `anthropic`, and OpenAI-compatible endpoints (Ollama and similar); `model` is always sent for BYOK. A BYOK `provider` bypasses Copilot API authentication entirely (verified against the SDK), so it always takes precedence over `gitHubToken`/`useLoggedInUser` — never fall back to the host's own login just because a BYOK request happened to omit a token.
- Hardening per §13.15.11: `availableTools: []`, deny-all `onPermissionRequest`, isolated empty per-user `baseDirectory`/working directory, `mode: "empty"` (the SDK's own documented posture for multi-user server apps — see §13.15.11), one client per user, sessions stopped after use or on idle timeout.
- Streaming maps `assistant.message_delta` to `AIStreamChunk`; completion maps `assistant.message` to `AIResponse`. **Correction:** there is no `session.idle` completion signal to map — `sendAndWait` itself resolves once the run finishes (with the final `assistant.message`, or `undefined` if the run produced none). Cancellation calls `session.abort()`, raced against the request's `AbortSignal`.
- **Correction — no structured output exists in this SDK.** `sendAndWait` has no schema/structured-output parameter of any kind (verified against `@github/copilot-sdk@1.0.14` — see §13.15.11). `CopilotProvider.capabilities.structuredOutput` is `"json_mode"`, never `"native"`; F29/F26's prompt-then-validate-then-one-repair-retry is the *only* mechanism that produces a valid `VisualPlan` for this provider, not a convenience layered on top of an SDK capability.
- `getModels()` uses `listModels()` for the Copilot subscription; for BYOK, the model comes from the settings field.
- **Correction — no typed SDK errors exist.** A failed run surfaces as a `session.error` event (`data.errorType`/`data.statusCode`/`data.message`), fired *while* `sendAndWait` is pending; a run can also simply resolve `undefined` with no thrown/rejected error at all. Map `errorType`/`statusCode` to the Acute-Notes error taxonomy inside the adapter; a low-level transport failure (before any session event exists) is a plain `Error` with only `.message`, classified by best-effort pattern match. Unrecognized errors propagate unmapped rather than being force-fit into a kind, so they never falsely trigger fallback. **Correction — no cumulative usage query exists.** Per-call usage is captured from the `assistant.usage` event (`inputTokens`, `outputTokens`, `copilotUsage.totalNanoAiu` for Copilot-subscription calls) fired during the same run; `CopilotProvider.getUsage()` honestly returns `null` always, since there is nothing to query after the fact.
- Copilot billing wording in AI Settings: "Uses your GitHub Copilot plan. Requests count toward your premium-request allowance."

### Acceptance criteria

- A user with a Copilot subscription can connect, pass Test Connection, run Visualize, and disconnect.
- A test proves no built-in CLI tool (shell, file read/write, fetch) can be invoked through any Acute-Notes session.
- In server mode, a request without a valid per-user token fails; the server's own GitHub identity is never used.
- Tokens, keys, prompts, and outputs never appear in host logs (test).

### Coding-agent prompt

> Implement F35. Add the AI host as Node.js-runtime route handlers under `src/app/api/ai/` (read the route-handler guide in `node_modules/next/dist/docs/` first) delegating to `src/ai/host/copilot/`, the only module allowed to import `@github/copilot-sdk`. Create one `CopilotClient` per authenticated user with that user's token; in server mode set `useLoggedInUser: false`. Create sessions with `availableTools: []`, a deny-all permission handler, `mode: "empty"`, and an isolated empty working directory/`baseDirectory`. Support the SDK's BYOK `provider` config for openai/azure/anthropic/OpenAI-compatible endpoints (it bypasses Copilot auth entirely — never fall back to the host's login for a BYOK request). The SDK has no native structured-output, error-class, or cumulative-usage query support (verified against `@github/copilot-sdk@1.0.14`): map streaming deltas, the `assistant.usage` event, and `session.error` events to the provider-neutral types from F26, and let F26's validate-then-repair-retry be the only thing that enforces schema correctness. Never log secrets or content. Never read CLI credential files directly.

---

## F36 — Connection Validation and Shared Contract Tests

### Goal

Confirm, per connection, that the GitHub Copilot SDK serves it correctly, and offer only the connections that pass. The same test suite becomes the acceptance gate for any future adapter. See §13.15.11–13.15.12.

### Requirements

- Run the nine exit criteria in §13.15.11 for: Copilot subscription, OpenAI, Azure OpenAI/Foundry, Anthropic, Gemini (OpenAI-compatible endpoint), and Ollama (local host mode).
- Record results in a validation matrix in the repo (connection × criterion, date, SDK version).
- A connection that fails stays hidden behind its descriptor's feature flag and is logged as future work. **No provider-specific SDK is added** to make it pass.
- The suite is written against `AIProvider` and `HostRuntime` only, so it runs unchanged against any future adapter (e.g. a Claude or ChatGPT subscription adapter).

### Acceptance criteria

- Every connection shown in AI Settings has a passing row in the validation matrix.
- The contract-test suite contains no Copilot-specific code outside its Copilot fixture.

### Coding-agent prompt

> Implement F36 as a contract-test suite that runs every registered `AIProvider` descriptor against the §13.15.11 criteria, using real credentials supplied only through local environment variables that are never committed. Keep the suite provider-neutral so future adapters can reuse it unchanged. Hide connections that fail behind their feature flag; do not add other provider SDKs.

---

## F37 — Content Source Versioning and Extended Provenance

### Goal

Give every Visualize-created object a durable link back to the input it came from, so a later run can tell what changed and whether the user has since edited the result. See §13.15.18–§13.15.19.

### Requirements

- New `ContentSource` / `ContentSourceVersion` domain types (§5.1): each Visualize run against pasted/imported content is tied to a `ContentSourceId`; re-pasting updated content for the same canvas area/selection appends a new `ContentSourceVersion` rather than creating an unrelated one.
- Extend `AIMetadata` (§5.1) with `contentSourceId`, `contentSourceVersion`, `stableNodeKey`, `contentFingerprint`, `modificationState`, `excludeFromReconciliation`. These fields are read only by the reconciliation engine (F38) — no other feature branches on them, preserving the existing rule that `AIMetadata` is otherwise descriptive-only.
- Extend the `VisualPlan` schema (F29, §13.15.4) with optional `VisualNode.stableKey`, derived deterministically by the local planner (F28) and, where possible, the model, from structural position (heading path, list ordinal, template slot) rather than content wording.
- `contentFingerprint` is a hash of an object's content **as AI last wrote it** — the reconciliation baseline. Store only the current baseline per object, not a history of every prior fingerprint.
- Persist `ContentSourceVersion.text` as plain text (or a reference for very large inputs); do not duplicate the full BlockNote/canvas state into it.

### Acceptance criteria

- Two Visualize runs against the same canvas area (original paste, then an edited paste) produce two `ContentSourceVersion` rows under one `ContentSource`, not two unrelated sources.
- Objects created by Visualize carry a `contentFingerprint` immediately after Accept, before any user edit.
- Manually created objects and objects from unrelated Visualize runs have no `contentSourceId` and are never considered by reconciliation.
- No field added here is read by editing, rendering, search, export, or MCP code paths (grep-verifiable).

### Coding-agent prompt

> Implement F37 in `src/domain/` (types) and `src/ai/content/` (source versioning helpers). Add `ContentSource`/`ContentSourceVersion` and extend `AIMetadata` and `VisualNode` exactly as specified in §5.1 and §13.15.4/§13.15.19. Compute `contentFingerprint` with a cheap, stable content hash over an object's serializable content, not its canvas geometry. Do not add a general revision-history table — only the current baseline per object is stored. Add unit tests proving these fields are inert everywhere except the reconciliation engine (F38).

---

## F38 — Content Reconciliation Engine (Diff, Match, Classify)

### Goal

When a user provides updated content for a canvas area that Visualize already populated, compute what changed and how it maps onto the objects already there — without regenerating everything or touching objects the model didn't need to. See §13.15.19–§13.15.21.

### Requirements

- **Scoped re-analysis, not whole-document regeneration.** Diff the new `ContentSourceVersion` text against the previous version at the parsed-content level (F28) to find changed/added/removed sections *before* calling any model. Only changed or new sections go through AI content analysis / `generate_visual_plan`; sections with no textual change reuse their previously accepted `VisualNode` content unchanged. This is a correctness requirement, not only a performance one: re-running an LLM over unchanged text produces different wording even when nothing meaningfully changed, which would otherwise show up as false-positive edits.
- **Node matching.** Match new `VisualNode`s to existing Acute objects primarily by `stableNodeKey` (F37); fall back to role + structural position when a stable key is unavailable; never match by array position or timing alone.
- **Classification.** Produce a `ReconciliationPlan`: a list of per-node results, each one of:
  - `add` — no matching existing object → ordinary new object (additive, same as first-run Visualize).
  - `remove` — existing object's node no longer appears in the new content → proposed removal, never applied without Accept.
  - `update_clean` — matched, and the existing object's current content hash still equals its `contentFingerprint` (untouched since AI wrote it) → safe proposed update.
  - `update_conflict` — matched, but the existing object's current content hash differs from its `contentFingerprint` → the user has edited it since; propose the update as a conflict, never auto-apply.
  - `unchanged` — matched, proposed content is identical to current content → excluded from the review set entirely (no noise).
- Objects with `excludeFromReconciliation: true` (F39) are always skipped, even if `add`/`update` logic would otherwise touch them.
- Run entirely off the interaction path (§13.15.21): parsing, diffing, and matching must not block typing, panning, or zooming, and must be cancellable like any other AI request (F26).
- Reuse F29 validation for every newly generated node before it enters the plan; a `ReconciliationPlan` is never partially unvalidated.

### Acceptance criteria

- Re-running Visualize with byte-identical content produces an empty `ReconciliationPlan` (no review prompt at all).
- Changing one paragraph out of a ten-section document re-analyzes only the affected section(s); a test asserts the AI task is invoked with only the changed span(s), not the full document.
- An object edited by the user since its last AI write is always classified `update_conflict`, never silently included in `update_clean`.
- Deleting a paragraph from the source produces a `remove` entry for its corresponding object(s), never a silent delete.
- Diff + match for a 50-node canvas completes within the budget in §13.15.21/§8.2 in a synthetic benchmark.

### Coding-agent prompt

> Implement F38 in `src/ai/reconcile/`. Reuse F28's parser to diff `ContentSourceVersion` text at the section/span level before any model call — this is the mechanism that keeps regeneration scoped and avoids wasted tokens and spurious diffs. Reuse F29 validation for any newly generated `VisualNode`. Implement matching by `stableNodeKey` first, structural fallback second. Produce a typed `ReconciliationPlan` (`add | remove | update_clean | update_conflict | unchanged` per node) as a pure, unit-testable function of (previous plan, previous objects' current content + fingerprints, new plan). Do not call React, Excalidraw, or BlockNote from this module. Support `AbortSignal` end to end, matching F26. Move matching/diffing to a Web Worker if profiling shows main-thread blocking >16 ms, same rule as F28. Add fixtures: no change, add-only, remove-only, clean update, conflicting update, and a mix of all four in one document.

---

## F38b — Conceptual Change Detection and Child Explanations (added 2026-09-27)

### Goal

Make "Update from new content" reflect what changed in the user's *understanding* of a subject, not in the wording of their text — and keep each representation conceptually clean by putting added explanation into linked child explanations instead of into the concept. See §1.9 and §13.15.19a.

### Requirements

- **Conceptual outcomes.** For every re-analysed section, each concept falls in exactly one of:

  | Detected | Behaviour |
  | --- | --- |
  | Concept unchanged (including a rewording) | Nothing — the object isn't touched and isn't in the review |
  | Existing concept changed | Update that object (`update_clean`), or a conflict card if the user edited it (`update_conflict`) |
  | Existing concept expanded (new explanation) | A new child explanation, linked `explained_by` from the concept and placed below it; the concept itself is not changed |
  | New concept | A new object of the appropriate type, connected into the structure (e.g. a new flow step inserted between two others rewires the links around it) |
  | Concept no longer in the content | A proposed removal (with the links this source drew to it) |
  | User-modified concept | Preserved; a conceptual change to it is a conflict card, never an overwrite |

- **The model sees what is already there.** A changed section is sent to `generate_visual_plan` together with its current representation (its previous nodes under short ids, with their stable keys) and instructions to report conceptual changes: an unchanged concept is answered with only `{"id": "p2", "unchanged": true}`; a changed concept keeps its id and key; a new one gets a new key (keys are identities, never renumbered); explanation goes in an `explained_by` child.
- **Fidelity.** Every `generate_visual_plan` call — first run or update — is told to represent only what the content says, never adding steps, items, examples, pages or facts. A section with nothing but its heading (a document title above its subsections) is never sent to a model: it is rendered as a heading directly, since a model asked about a bare title invents content for it.
- **Preservation is done by code.** An `unchanged` answer — or a node re-sent with only case, spacing or punctuation differences — is expanded back to the previous node *verbatim* by the app — the model never has to copy a node character for character — so an unchanged concept is byte-identical and classified `unchanged` by F38's existing rules. A changed node that kept a previous id keeps that node's key whatever key the model wrote.
- **Child explanations.** `explained_by` is an ordinary `RelationType` (§5.1), allowed in every template. The renderer (F30) keeps explanation nodes out of the template's own arrangement — the concepts are laid out exactly as they would be without them — and places each explanation below its concept (nested explanations below theirs, never overlapping). On an update, an explanation of an existing object is placed below that object. Every Visualize run, not only updates, is asked to keep concept nodes concise and put explanation in such children.
- **Links are reconciled too.** An update may add a link to or from a new object, add a missing link between two existing objects, and propose removing a link *this source drew* that the new plan no longer has. An arrow the user drew is never removed, and a pair already linked by any arrow (either direction) is never linked twice. Links are only rewired inside re-analysed sections.
- **Contradictions.** When the new content is the user's own (paste/import), a contradiction of an earlier version *is* the change they meant: it is treated as a changed concept, not flagged separately (flagging it would be noise). Contradiction flagging is reserved for content from other origins (e.g. an MCP agent's update, §13.15.10) and is not part of this feature.
- **Local tier (structural reading of the same rule).** A structured paste (headings, lists) takes the local tier by default, with or without an AI connection, and no model judges meaning there. On an *update* it applies the rule structurally: within an existing section, a paragraph that corresponds to one already on the canvas (identical, or a correction sharing most of its wording) stays where it was — in the section's block or in an explanation split out earlier — and a paragraph with no counterpart is new detail about that section, split out as its own block, linked `explained_by` from the section's block, keyed `<section key> › detail#n` (never renumbered). The split is part of the accepted plan, so later updates align against it again: follow-up replies pasted one after another keep the section and each explanation as separate, stable objects. A new *section* is a new concept (an ordinary add); first runs are unchanged (a section always starts as one block).
- **Placement of an explanation.** Directly below its concept; when that space is taken (a stacked note continues below it), beside the concept at the same height; otherwise the usual free-space search. Always linked, never floating.
- **Guarantees are unchanged and stay deterministic** (§1.9): the model only proposes; nothing is written without Accept; an edited object is always a conflict; Keep mine / opt-out / directionality (F39) apply as before; the whole accepted set is one undo step.

### Acceptance criteria

- Rewording a section without changing its meaning gives "Nothing changed" — no review, nothing written — when the model reports its concepts unchanged.
- Adding a step to a flow (e.g. "the backend now also checks organization membership before creating the session") proposes one new step and rewires the links around it, and rewrites none of the existing steps.
- Adding explanatory detail about a concept (e.g. "Firebase ID tokens are JWTs with claims…") proposes one child explanation below that concept, linked `explained_by`, and changes neither the concept nor the flow.
- **Follow-up replies over one note (local tier, no model).** A note pasted from a chat reply (title, checklist, "Risks", "Owners"); a second reply that corrects the Risks sentence *and* adds a mitigation paragraph proposes exactly one update (Risks, in place) plus one new block for the mitigation, next to Risks and linked to it — no title, checklist or Owners rebuilt, no merged wall of text; a third reply that corrects only Owners proposes exactly that one update, leaving Risks, the mitigation and their link as they are.
- A conceptual change to an object the user edited is a conflict card; the edit is never overwritten without Apply.
- Adding an explanation to a first-run plan leaves the concepts' own layout exactly as it would be without it (renderer test for every template).
- The same scenarios are covered by unit tests with a scripted model (what the app does with each kind of answer) and by an AI e2e suite against a real model (what the model answers), where the model-judgement checks are soft and the app guarantees hard.

### Coding-agent prompt

> Implement F38b on top of F38/F39 without changing their safety rules. In `src/ai/reconcile/`, give each changed section's `generate_visual_plan` call its current representation (previous nodes under short ids with unit-local stable keys, plus their relationships) and expand every `"unchanged": true` answer back to the previous node verbatim before merging — preservation by code, not by trusting the model to copy. Add `explained_by` to `RelationType` and to every template; in the renderer, lay out the concepts alone and hang each explanation below its concept; on an update, place an explanation of an existing object below that object. Reconcile links: add links to new objects and missing links between existing ones, and propose removing only arrows this content source drew (stamp connectors with the source id) that the new plan no longer has — never the user's arrows, never a duplicate link. Keep the local tier's structural behaviour. Test each outcome with a scripted model, and add a real-model e2e whose model-judgement checks are soft.

---

## F39 — "Update from New Content" Review and Merge UX

### Goal

Let a user paste updated content into an existing Visualize result and safely apply what changed, while every manual edit they made is either preserved or explicitly and reversibly overridden by their own choice. See §6.4, §13.15.20.

### Requirements

- Entry point: on a canvas area (or page) that already has Visualize-derived objects, `✨ Ask AI → Update from new content` opens the same paste surface as Visualize (§6.4) scoped to that area's `ContentSource`.
- Extend the F19 review change set with per-item states, rendered from the `ReconciliationPlan` (F38):
  - `add` / `remove` render exactly like existing Visualize review items (ghosted create / marked-for-removal).
  - `update_clean` renders as a normal proposed change, pre-selected; **Accept all** applies every `add`/`remove`/`update_clean` item as a single transaction, same as today's Visualize accept.
  - `update_conflict` renders as a **conflict card**: current (user's content) vs. proposed (new AI output), with per-item **Apply** / **Keep mine** / **View diff**. Conflict cards are never pre-selected into "Accept all" — each one needs its own decision.
- **Directionality rule:** applying an artifact update never rewrites the `ContentSource` text, and editing an artifact never automatically edits the source. An explicit, separate `Update source from this edit` action may append the user's change back into a new `ContentSourceVersion`; it is opt-in and never runs implicitly.
- **Opt-out:** a per-object "Don't update this from AI" action sets `excludeFromReconciliation`; excluded objects never appear in future reconciliation runs for that `ContentSource` until the user turns it back on.
- Applying `update_clean`/`update_conflict` refreshes the object's `contentFingerprint` to the newly applied content (new baseline) and bumps its `contentSourceVersion`; choosing "Keep mine" refreshes the fingerprint to the user's current content without changing its visible content, so the same manual edit isn't re-flagged as a conflict on the next run.
- Reuse F19's transaction/undo model: accepting the whole reviewed set (clean updates + resolved conflicts) is one undo step, same as first-run Visualize.

### Acceptance criteria

- A block the user never touched updates cleanly with one click, alongside every other clean update, as one transaction.
- A block the user manually edited is never overwritten without the user explicitly choosing "Apply" on its conflict card; choosing "Keep mine" leaves it untouched and stops it from reappearing as a conflict next time nothing further changes.
- Rejecting the whole change set leaves the canvas exactly as it was, including any objects proposed for removal.
- No automatic write ever touches `ContentSource` text; `Update source from this edit` is a distinct, explicit action.
- This flow does not introduce a version-history browser or per-keystroke history UI (out of scope, §3.2) — only the current-vs-proposed comparison needed for the conflict card.
- Opening the conflict review, applying a mix of clean updates and conflict resolutions, and panning/zooming the canvas mid-review shows no measurable frame-rate drop (§13.15.21).

### Coding-agent prompt

> Implement F39 by extending the F19 review UI and transaction system with the `ReconciliationPlan` states from F38. Build the conflict card as a compact current/proposed comparison — reuse existing lightweight block preview rendering (§8.3) rather than building a new diff viewer or mounting full BlockNote editors per card. Wire "Apply", "Keep mine", and "View diff" to distinct, testable code paths that each update `contentFingerprint`/`contentSourceVersion` correctly. Implement the opt-out flag and the explicit "Update source from this edit" action as separate, deliberate user actions — neither may run implicitly. Keep the whole accepted set (clean updates + resolved conflicts) one undo step. Do not build a general version-history UI.

---

## F41 — Local Spatial Reflow for AI Insertions (added 2026-09-27)

### Goal

AI output goes where it belongs — an explanation directly below its concept, a new flow step in line between the steps it connects — even when that part of the canvas is full, without the user having to make room first and without disturbing unrelated content. See §13.15.19b.

> **AI is responsible for semantic composition; the layout engine is responsible for spatial composition.**

The model never gives coordinates (already true: `VisualPlan` has no positions, §13.15.4). F41 adds the one thing F30's placement cannot do: move existing objects out of the way.

### Requirements

- **Minimum room, locally.** When the natural slot for new objects is taken, the engine creates only the room those objects need, moving only objects that are in the way (directly, or because an object that moved now is). Nothing else moves. It never shifts "everything below" or "everything to the right".
- **Slack absorbs the push.** An object moves by the room still needed when the push reaches it, minus the free space already in front of it. A push fades out across gaps; an object with enough room in front of it does not move.
- **Units move whole.** An Excalidraw group, a frame with its children, and a container with its label move as one rigid unit. Connectors bound to a moved object follow it (F19's move handling). A connector is never an obstacle and never moved on its own.
- **Locked objects are walls.** A locked object is never moved. A push that would move one fails, and the engine tries another strategy.
- **Placed by Acute vs placed by the user.** Every object Acute places or moves records where it put it (`customData.acuteLayout`, a layout hint — not provenance, and nothing branches on who created an object). An object still where Acute put it is cheap to move; one the user placed or has moved since is expensive (it moves only when every alternative is worse). This protects deliberate arrangements without making the canvas unmanageable.
- **Strategies, scored.** The engine considers, deterministically:
  1. a free slot near the natural one (moves nothing);
  2. push along the insertion direction (down for an explanation, along the flow for a new step);
  3. push along the other axis — only when 2 is not possible (a wall, or too much to move), because it moves objects out of the line they are in;
  4. the fallback: F30's guaranteed-clear placement (moves nothing, may be far away; this is where 1 ends when nothing nearby is free).

  Each is scored as the distance of the new objects from their natural slot (× 3: content far from where it belongs is what a user notices most) plus the weighted displacement of every moved object. The cheapest valid one wins; ties go to the earlier strategy. A strategy that moves more than a bounded number of units (40) or hits a wall is invalid.
- **Validated before it is proposed.** The chosen result is checked: no new overlaps with anything that didn't move, no locked object moved, every move a whole unit. An invalid result is never proposed; the next strategy is used.
- **Inline insertion on update.** In "Update from new content" (F38/F38b), a new node that follows an existing object is anchored at that predecessor, in the direction the diagram runs there (towards its existing successor when it has one — right when the successor is more to the right than below, else down; otherwise the template's direction), so a new step lands in line and pushes its successors along — instead of being placed as a group beside the whole diagram. An explanation is still anchored below its concept. A new node with no existing predecessor keeps being placed as a group beside the source's objects (free space only, nothing moved).
- **Several insertions, one pass.** Every group of one change set is placed against the canvas *as already moved by the earlier groups* of the same set, and each object gets at most one move (its final position).
- **Reviewable, atomic, undoable.** Moves are ordinary F19 `move` changes in the same change set: ghosted in the review (moved outline + a line from where it was), counted in the summary ("3 moves"), written only on Accept, together with everything else, as one undo step. Reject leaves every object exactly where it was. The engine never asks the user where to put something.
- **Only with an anchor.** A first Visualize with nothing selected has no natural slot to protect, so it keeps F30's free-space placement and moves nothing.

### Acceptance criteria

- An explanation added below a concept in a dense column goes directly below it; the objects below move down by exactly the room needed, and objects beside the column don't move.
- Where there is already enough gap, nothing moves. Where there is some gap, objects further down move less than objects directly below (slack absorption), and objects past enough slack don't move at all.
- A locked object below the slot is never moved; the engine picks another strategy (sideways, or a free slot), and the result has no overlaps.
- An arrangement the user placed is not moved when a free slot nearby costs less; objects Acute placed and the user never moved are preferred for moving.
- A new flow step between two existing steps is placed in line; its successors move along the flow; the arrows around it are rewired (F38b) and bound arrows follow moved objects.
- Groups, frames and labelled shapes move whole; nothing is left behind.
- Reject leaves the canvas identical; Accept + Undo restores every moved object.
- Deterministic: the same plan and the same canvas always give the same positions and moves.
- Performance: inserting 3 groups into a dense 1,000-object canvas computes in well under 100 ms and moves nothing outside the affected region.

### Coding-agent prompt

> Implement F41 in `src/ai/renderer/reflow.ts` as a pure, renderer-agnostic function beside `place.ts`: given the local layout's bounds, an anchor with a side, and the scene's movable objects (id, box, unit, locked, whether still where Acute placed it), return the placement offset plus a list of unit moves. Implement the four scored strategies with a sweep-order push that absorbs slack, rigid units, locked walls and a move budget; validate the result before returning it. Use a spatial grid index so a 1,000-object scene stays fast. Let `renderVisualPlan` emit the resulting `move` changes and merge moves across groups in `update.ts`; anchor a new step at its existing neighbour there. Gather units, locks and the `customData.acuteLayout` hint in `renderPlanContext.ts`, and stamp the hint in the change-set writer on every create and move. Test with scenario tests (dense column, slack, locked wall, user arrangement, inline flow step, groups, 1,000 objects, determinism).

---

## F43 — Repo Map over MCP (added 2026-09-27)

### Goal

A developer's own IDE agent (Claude Code, Copilot, Cursor, any MCP client) builds and maintains a reliable visual map of a code repository on an Acute canvas. The agent does all the reading and understanding. Acute only validates, lays out, reconciles and renders.

> **The IDE agent pays for understanding; Acute pays for nothing but local CPU.**

No Acute code reads the repository, runs git, or calls a model for F43. This extends F21's `render_visual_plan` principle ("MCP clients produce Acute-Notes visuals without Acute-Notes calling any model") from one plan to a whole repository sent incrementally. It covers the developer use cases in `ai-future-workflow-enhancements.md` (DEV-01, DEV-02) without building our own code ingestion: it replaces the ingestion half of CAP-03 and is the first concrete use of CAP-06.

### Why incremental

No agent context holds a whole repository, so agents already work one module at a time. F43 turns each module into one small, self-contained tool call:

- **Small calls.** A call carries one module's summary as a few KB of JSON — never the source code itself.
- **The canvas is the agent's memory.** The agent asks Acute what is already mapped and what is stale instead of remembering or re-deriving it. A summary computed once is not paid for again.
- **Cheap re-runs.** After new commits, the agent re-analyses only the files `git diff` reports as changed and re-sends only the sections that contain them.

### Transport

F20's bridge: the Streamable HTTP endpoint `/api/mcp`, relayed to the open tab, which runs the MCP server over its own workspace data. F43 adds no transport of its own. It needs the workspace's MCP access switch turned on (off by default) and the pairing token, like every F20/F21 tool.

### Tools

Five tools, registered beside F21's. Every tool validates its input with zod and states its limits in its description.

| Tool | Input | Returns |
|---|---|---|
| `begin_repo_map` | `repo` (display name, e.g. `org/name`), `commit`, optional `title` | `mapId` plus the current status (as `get_map_status`). Creates the map canvas on first use; later calls for the same `repo` in the same workspace reopen it. Starts a mapping session (see Review). |
| `upsert_map_section` | `mapId`, `commit`, `section`, `nodes`, `relationships` (shape below) | Per-node outcome (`added` / `updated` / `unchanged` / `conflict` / `rejected` + reason), pending edges still unresolved, and a one-line summary. Idempotent by key. |
| `link_map_nodes` | `mapId`, `links[]` of `{ from, to, type, label? }` (keys) | Which links were drawn and which are pending. Used for cross-module edges once both sides exist, or ahead of them. |
| `get_map_status` | `mapId`, optional `commit`, optional `changedPaths[]` | Keys only, no content: sections and nodes with their commit, which are **stale** (their `source.path` is in `changedPaths`, or they were mapped at a different commit than `commit` when no paths are given), pending edges, and the user's corrections since the last call (see Reliability). |
| `remove_map_nodes` | `mapId`, `keys[]` | A pending removal for review. Always reviewed, even under session auto-accept, as F21 requires for destructive operations. Removes only objects this map created. |

Plus one **MCP prompt**, `map_repo` (§13.13), with the playbook: list the tree → pick modules (≈5–40 files each) → call `get_map_status` → for each module that is new or stale, read it, summarize it, `upsert_map_section` → add cross-module `link_map_nodes` → check status again. The prompt tells the agent to write short card text (a concise concept plus `explained_by` children for detail, as F38b), and to never put secret values, credentials or large code in a card. The same playbook gives consistent maps across Claude Code, Copilot and Cursor.

### Section payload

A section is one module of the repo. It maps onto a `VisualPlan` (§13.15.4) with the `sectioned` template: the section becomes one `group` node (one frame, F42), each node a member of it.

```json
{
  "mapId": "map_7f3a",
  "commit": "9c1e2ab",
  "section": { "key": "mod:src/ai", "label": "AI runtime", "arrangement": "tree",
               "summary": "Provider-neutral AI entry point, task registry and routing." },
  "nodes": [
    { "key": "file:src/ai/runtime.ts", "type": "text", "title": "AIRuntime",
      "markdown": "Single entry point for all AI tasks; routes to a provider, retries once on schema failure.",
      "source": { "path": "src/ai/runtime.ts", "lines": [1, 120] } },
    { "key": "file:src/ai/tasks.ts", "type": "text", "title": "Task registry",
      "markdown": "Tasks declare schema, prompt and routing policy.",
      "source": { "path": "src/ai/tasks.ts", "lines": [1, 86] } }
  ],
  "relationships": [
    { "from": "file:src/ai/runtime.ts", "to": "file:src/ai/tasks.ts", "type": "depends_on" },
    { "from": "file:src/ai/runtime.ts", "to": "mod:src/app/api", "type": "references" }
  ]
}
```

- **Keys are identity.** `section.key` and each node's `key` become the node's `stableKey` (§13.15.19). They are free strings, 1–200 characters, unique within the map. The prompt recommends `mod:<dir>`, `file:<path>` and `sym:<path>#<name>`. Re-sending a key updates that object; it never duplicates it.
- **Node types.** `text`, `heading`, `table`, `todo`, `shape` and `code` — the `VisualNodeContent` types except `page` and `image`. A `code` node is capped at 40 lines.
- **Relationships** use the existing `RelationType`s (§5.1). `from`/`to` are keys and may point at a node or section key in any section, sent or not.
- **Pending edges.** A relationship whose other end has not been sent yet is stored as a pending edge and drawn when that key arrives. The agent can therefore send sections in any order. Pending edges are reported by `get_map_status` and dropped when either end is removed.
- **Provenance.** `source` (`path`, optional `lines`, and the call's `commit`) is stored on the object as an `AIMetadata.sourceRefs` entry (`provider: "repo"`, `externalId: "<path>#L<a>-<b>@<commit>"`), shown in the provenance panel (F25). Paths are repo-relative, never absolute, and never read by Acute.
- **Limits per call.** ≤ 50 nodes, ≤ 2,000 characters of text per node, ≤ 100 relationships, ≤ 64 KB request. Per map: ≤ 60 sections and ≤ 1,500 nodes (MVP; see Scale). A call over a limit is rejected whole with an error that names the limit, so the agent can split it and retry.

### Rendering and reconciliation

- Each section is one F37 `ContentSource` (`origin: "mcp"`, `tier: "ai"`, template `sectioned`). Each upsert appends a `ContentSourceVersion` whose `text` is the canonical JSON of the section and whose `plan` is the converted `VisualPlan`.
- A re-sent section goes through F38 matching by `stableKey` and F38b link reconciliation: unchanged nodes stay byte-identical, changed ones are `update_clean` — or `update_conflict` when the user edited them. Arrows the map drew that the new section no longer has are proposed for removal; the user's own arrows never are.
- Validation is F29's schema, run on the converted plan exactly as for in-app AI output. Markdown is sanitized like any other imported content.
- Placement is F30/F41: a new section frame goes beside the existing frames without moving them; a new node inside an existing frame uses F41's local reflow. The layout never needs coordinates from the agent.
- The map is ordinary canvas content. Frames, cards and arrows are edited, moved, locked and deleted like anything else, and export like anything else. The map's own bookkeeping (keys → sources, pending edges, last commit) is a `RepoMap` record in the local store beside content sources — never inside canvas documents or Yjs state, and it contains no content the canvas doesn't already hold.

### Review

A mapping session is many calls, so reviewing each call separately would be unworkable. F19 also allows only one pending change set per canvas.

- **Staged by default.** During a session, each upsert *merges* into the map canvas's single pending change set instead of replacing it: the review shows everything the agent has sent so far, grouped by section frame, and grows as calls arrive. Accept all writes it as one undo step. Accept per section is available too (from F39's per-item states). Reject discards everything staged; later calls start a new set.
- **Auto-accept for this session.** The user can switch this on in the app (in the review bar, or when the session starts). Each section is then written on arrival as its own undo step. Only the user can turn it on. No tool input can, and it ends when the session ends (`begin_repo_map` starts a new one, or 30 minutes pass without a call). Conflicts (`update_conflict`) and removals are **never** auto-accepted: they wait in the review like any other.
- The tool result always says what happened (`staged` / `applied` / `rejected`), so the agent never assumes a write that didn't happen.

### Reliability

- **Idempotent.** Same key → same object. A retry, crash or re-run never duplicates anything. Sending the same section twice is `unchanged` and costs one validation.
- **User corrections win and are fed back.** An object the user edited is a conflict, never silently overwritten (F38). `get_map_status` returns `corrections`: keys whose objects the user edited, deleted or excluded (F39's opt-out) since the agent last saw them, with the user's current text for edited cards (within the same caps). The agent can use this on the next pass instead of fighting the user.
- **Staleness is explicit.** Acute never runs git. The agent passes `changedPaths` from its own `git diff`, and Acute answers which keys cite those paths. Stale objects get a quiet "stale" marker on the canvas until they are re-sent or the user dismisses it.
- **Bounded output to the agent.** Status responses list keys, not content (except `corrections`), capped at 2,000 keys with `truncated`, so asking "what's there?" stays cheap for the agent too.
- **No partial writes.** A rejected call changes nothing; a call that times out on the relay (F20) either staged completely or not at all, and is safe to retry.

### Scale

- **MVP:** one map canvas per repo, one frame per section, within the per-map limits above. Past the limit, `upsert_map_section` is rejected with `map_full` and the prompt tells the agent to map at a coarser module level.
- **Later (not MVP):** levels. An overview canvas holds one card per module, and each module drills down into its own canvas, linked from its card. No one gets a 3,000-node canvas; a level is just another map canvas with the same tools.

### Security

- Write tools need the workspace's MCP access switch and the pairing token (F20). F43 can write only to map canvases it created. It cannot touch other canvases or pages.
- Everything the agent sends is untrusted data: schema-validated, sanitized, capped, and rendered as text — never executed, never used as HTML, never followed as a link by Acute.
- The agent is told not to send secrets. As a backstop, nodes matching high-confidence secret patterns (private-key blocks, common cloud/API key formats) are rejected with reason `possible_secret`.
- `corrections` returns only map objects' own text, never other canvas content.

### Out of scope

- Any Acute-side repo reading, git access, code indexing or embeddings. That work stays in the IDE agent.
- Any model call from Acute for F43. Asking questions over the finished map later is ordinary in-app AI (F18) on the user's own connection.
- Server-side workspaces so mapping works with no tab open — that arrives with cloud sync (§10); the same tools will work there unchanged.

### Acceptance criteria

- Mapping a ~300-file repository in ~15 `upsert_map_section` calls produces one map canvas with one frame per section and no overlaps. No Acute code reads a file or calls a model while doing so.
- Re-sending an identical section yields `unchanged` for every node and no change set.
- Changing one node's text and re-sending proposes exactly one `update_clean`. If the user had edited that card, it is an `update_conflict` and is not auto-accepted.
- A relationship to a key not yet sent is reported as pending and drawn automatically when that key arrives, in either order of calls.
- `get_map_status` with `changedPaths` lists exactly the keys that cite those paths, and returns the user's edits and deletions as `corrections`.
- A call over any limit, with an unknown relation type, a duplicate key, or a possible secret is rejected whole, changes nothing, and names the reason.
- Staged review: calls merge into one pending set; Accept writes it as one undo step; Reject leaves the canvas untouched. Under auto-accept, each section is one undo step and removals still wait for review.
- With MCP access off or a wrong token, every F43 tool fails and nothing is written.
- Performance: an upsert of 50 nodes into a 1,500-node map validates, reconciles and stages in under 100 ms of main-thread time, and the canvas stays interactive while calls arrive.

### Coding-agent prompt

> Implement F43 in `src/mcp/tools/repoMap/` on top of F20's bridge and F21's tool registration; add no transport. Convert each `upsert_map_section` input into a `sectioned` `VisualPlan` (one `group` + members, keys → `stableKey`, `source` → `AIMetadata.sourceRefs`) and push it through the existing pipeline only: F29 validation, F37 content source (`origin: "mcp"`), F38/F38b reconciliation, F30/F41 placement, F19 change set via `LiveCanvasActions.propose`. Extend F19 so a mapping session merges into the canvas's one pending set instead of replacing it, and add a user-only, session-scoped auto-accept that never applies conflicts or removals. Store keys, pending edges and last commit in a `RepoMap` record in the local store, not in canvas documents or Yjs. Never read the repository, run git, or call `AIRuntime` from this module. Register the `map_repo` prompt. Test with scripted MCP clients over `InMemoryTransport`: first map, identical re-send, clean update, conflict, out-of-order pending edges, staleness from `changedPaths`, corrections feedback, each rejection reason, staged Accept/Reject, auto-accept limits, access off.

---

# 8. Performance Requirements

Performance is the highest priority after correctness.

## 8.1 Hard principles

1. No network dependency for core editing.
2. No full-app React state update for pointer movement.
3. No full BlockNote editor instance for every rich preview.
4. No image binary inside normal document state.
5. No full-workspace serialization on every small change.
6. No synchronous expensive work in pointermove/zoom loops.
7. Heavy functionality must be lazy-loaded.
8. Large lists/pages must be virtualized where needed.
9. Canvas interactions should remain visually responsive under realistic load.
10. AI never runs in the canvas rendering or input critical path. AI requests, parsing, and layout are asynchronous and cancellable; the canvas never waits on them.
11. Reconciliation (F37–F39) never regenerates or re-sends unaffected content. Only changed source spans are re-diffed/re-analyzed, and only the resulting diff — never a full re-render — reaches the canvas (§13.15.21). A re-analysed section carries its current representation (F38b), which costs a few hundred tokens but replaces a full regeneration of that section with a short list of conceptual changes.
12. Making room for AI output (F41) is local and bounded: it looks only at objects near the insertion point (spatial index, not a scan per candidate), moves a bounded number of objects, and runs off the input path as part of building the change set.

## 8.2 Initial target budgets

These are engineering targets, not marketing guarantees:

| Area | Target |
|---|---:|
| Canvas pan/zoom interaction | ~60 FPS on a modern laptop for typical MVP workspaces |
| Canvas object move | visually immediate; target <16 ms per frame |
| Basic text typing | no noticeable input lag; target <16 ms local interaction path |
| Local persistence acknowledgement | asynchronous; UI never waits for disk write |
| Warm workspace open | target <1.5 s for a typical workspace |
| Creating a basic object | target <50 ms to visible result |
| Active rich editor startup | target <300 ms where feasible |
| Background export | never block primary canvas interaction |
| AI action feedback | progress indicator visible <100 ms after the user starts an AI action |
| Canvas during AI request | no measurable frame-rate drop from AI work (network wait, parsing, layout) |
| Content parse (≈100 KB Markdown) | off the interaction path; no main-thread task >16 ms (use a worker if needed) |
| VisualPlan preview (≤50 nodes) | ghost preview appears in <200 ms after a valid plan arrives |
| VisualPlan accept (≤50 nodes) | committed as one transaction; visible in <100 ms |
| AI code in initial bundle | none — runtime, adapters, parser, Mermaid are lazy-loaded |
| ContentSourceVersion diff (before any AI call) | off the interaction path; no main-thread task >16 ms (worker if needed) |
| Reconciliation match + classify (≤50 candidate objects) | `ReconciliationPlan` ready in <200 ms after re-analyzed sections arrive, matching the VisualPlan preview budget |
| Conflict-card render (per item) | reuses the lightweight-preview budget — no full BlockNote mount per card |
| Canvas during reconciliation (diff/match/AI re-analysis in flight) | no measurable frame-rate drop, same as any other AI request |

Do not treat these as acceptable reasons to hide functionality that can be implemented efficiently. Profile first.

## 8.3 Rendering strategy

### Inactive rich blocks

Use a lightweight read-only renderer.

### Active rich block

Mount the full BlockNote editor only when needed.

### While dragging rich blocks

Move the outer container using transform styles / requestAnimationFrame. Do not mutate BlockNote document state just because the block moved 2 px.

### After drag end

Commit final x/y to the document model as one operation.

## 8.4 React state discipline

Avoid patterns such as:

```ts
setObjects(newObjects)
```

on every pointermove for thousands of objects.

Prefer:

- imperative refs for transient interaction
- command transactions
- selector-based subscriptions
- local component state for transient UI
- batched commits at interaction boundaries

## 8.5 Persistence discipline

During a drag:

```text
pointermove
   ↓
visual transform only
   ↓
pointerup
   ↓
commit one position update
   ↓
persist async
```

During typing:

```text
keystroke
   ↓
BlockNote local state
   ↓
Yjs/local state
   ↓
async persistence
```

Do not await persistence from the typing event handler.

## 8.6 AI execution discipline

```text
User starts AI action
   ↓
show progress (non-blocking)
   ↓
async: parse → (local | decision model | primary) → validate → layout
   ↓
pending change set (ghost preview, not committed)
   ↓
user Accept
   ↓
one domain transaction → persist async
```

- Never stream model tokens into React/domain state for canvas-bound output; stream only into a text preview where applicable.
- Never hold a lock on canvas state while waiting for a model.
- Heavy CPU steps (large parse, layout of large plans) move to a Web Worker if profiling shows main-thread blocking.
- The user may start editing, navigating, or another action at any time; in-flight AI requests are cancellable and their results are discarded if their target no longer exists.

---

# 9. Local-First Architecture in Detail

## 9.1 Repository boundaries

Define interfaces before persistence implementation:

```ts
interface WorkspaceRepository {
  getWorkspace(id: string): Promise<Workspace>;
  saveWorkspace(workspace: Workspace): Promise<void>;
}

interface CanvasRepository {
  getCanvas(id: string): Promise<CanvasDocument>;
  saveCanvas(canvas: CanvasDocument): Promise<void>;
}

interface PageRepository {
  getPage(id: string): Promise<PageDocument>;
  savePage(page: PageDocument): Promise<void>;
}

interface AssetRepository {
  put(asset: Blob, metadata: AssetMetadata): Promise<AssetId>;
  get(id: AssetId): Promise<Blob | null>;
}

// Device-local only. Never part of workspace documents, Yjs, sync, or export.
interface AISettingsRepository {
  getSettings(): Promise<AISettings>;
  saveSettings(settings: AISettings): Promise<void>;
  getKey(role: "primary" | "decision"): Promise<string | null>;
  setKey(role: "primary" | "decision", key: string, storage: "device" | "session"): Promise<void>;
  clearKey(role: "primary" | "decision"): Promise<void>;
}

// Device-local usage log for the AI Settings usage summary.
interface AIUsageRepository {
  record(usage: AIUsage): Promise<void>;
  summarize(range: { from: number; to: number }): Promise<AIUsageSummary>;
}
```

Later, cloud implementations can satisfy the same interfaces. `AISettingsRepository` is the exception: BYOK keys stay device-local even when cloud sync exists.

## 9.2 Sync boundary

Introduce a provider interface:

```ts
interface SyncProvider {
  connect(docId: string): Promise<void>;
  disconnect(docId: string): Promise<void>;
  onUpdate(callback: (update: Uint8Array) => void): () => void;
  sendUpdate(update: Uint8Array): void;
}
```

MVP implementation:

```text
LocalOnlySyncProvider
```

Future:

```text
WebSocketSyncProvider
```

This prevents cloud concerns from leaking into the UI.

---

# 10. Cloud Extension Plan

Cloud should be considered an additional provider, not a rewrite.

## 10.1 What changes later

Add:

```text
Authentication
     ↓
Workspace membership / permissions
     ↓
Sync service
     ↓
Cloud persistent state
     ↓
Object storage for assets/snapshots
```

The browser still remains local-first. AI and MCP should plug into the same repository/command boundaries rather than introducing a second state model:

```text
User edit
  ↓
Local state
  ↓
Instant UI
  ↓
IndexedDB
  ↓
Background sync
  ↓
Cloud
```

## 10.2 Recommended cloud data split

### SQL database

Use for metadata:

- users
- workspaces
- workspace members
- permissions
- canvas IDs
- page IDs
- asset metadata
- share links
- billing later
- encrypted per-user GitHub OAuth tokens for the server-hosted Copilot AI host (F35 Mode B; KMS-encrypted, never plaintext)
- sync metadata

BYOK keys are never stored server-side. No managed-AI credit ledger exists (F34 is not planned).

### Object storage

Use for:

- uploaded images
- attachments
- workspace snapshots
- export bundles
- large Yjs update archives

### Real-time service

Use WebSocket-based sync for live collaboration.

Yjs can be used for the CRDT layer.

## 10.3 Cloud storage options

### Google Cloud Storage

Google Cloud Storage is object storage for files/objects in buckets and supports arbitrary object data.

Good fit for:

- Acute-Notes assets
- snapshots
- exports
- Yjs update archives

### Amazon S3

Use S3 as the object storage equivalent when deployed on AWS.

Recommended object key pattern:

```text
workspaces/{workspaceId}/canvases/{canvasId}/snapshot.json
workspaces/{workspaceId}/pages/{pageId}/snapshot.json
workspaces/{workspaceId}/assets/{assetId}
```

### Microsoft Azure Blob Storage

Azure Blob Storage is Microsoft's object storage service for unstructured data.

Same application storage abstraction can target Blob Storage instead of S3/GCS.

### Cloudflare R2

Cloudflare R2 supports an S3-compatible API, which means an S3 SDK can be used with an R2 endpoint. R2 also advertises no egress fees and object-storage semantics suitable for application files.

This makes R2 an attractive future option when minimizing egress costs is important.

## 10.4 Google Drive / Microsoft OneDrive

These should be treated differently.

Google Drive provides a file API for creating and managing files in a user's Drive.

Microsoft Graph can work with OneDrive, OneDrive for Business, and SharePoint document libraries, and exposes Drive/DriveItem APIs. Microsoft Graph also provides webhooks and delta APIs for reacting to and tracking file changes.

These are appropriate as **user-controlled storage/export integrations**:

```text
Acute-Notes
   ↓
Export / Sync Connector
   ↓
Google Drive / OneDrive
```

Do not make Google Drive or OneDrive the authoritative real-time collaboration database for Acute-Notes.

The primary real-time collaboration system should remain a purpose-built sync service backed by CRDT state.

---

# 11. Cloud Synchronization Formats

The system should support multiple representations for different purposes.

## 11.1 Live collaboration format

**Yjs updates / Yjs document state**

Use for:

- incremental synchronization
- conflict-free merging
- real-time collaboration
- offline changes

Do not make the live-sync protocol depend on Markdown.

## 11.2 Durable application snapshot

Use a versioned JSON representation:

```text
Acute-Notes Canonical JSON
```

This contains:

- canvas geometry
- object types
- references
- page metadata
- asset metadata
- schema version

## 11.3 Human-readable document format

Use Markdown for page/document export where possible.

Example:

~~~md
# Observability Plan

## Goals

1. Capture submission events.
2. Verify usage metrics.

## Checks

- [ ] Add hook
- [ ] Add tests

```ts
const result = validateClaim(data);
```
~~~

The application should own its own Markdown serializer rather than requiring BlockNote XL exporter packages for the core product.

## 11.4 Portable Acute bundle

Eventually support:

```text
project.acute.zip
```

with:

```text
manifest.json
canvases/*.json
pages/*.json
pages/*.md
assets/*
```

This is the recommended long-term portable backup format.

---

# 12. Real-Time Collaboration — Future Architecture

## 12.1 Desired experience

User A:

```text
moves block
```

User B sees:

```text
block move
```

without page refresh.

User A types into a page while User B edits another section.

The system merges changes rather than applying “last whole document wins.”

## 12.2 Proposed future stack

```text
                  Acute-Notes Client
                        │
             ┌──────────┴──────────┐
             │                     │
         IndexedDB                Yjs
             │                     │
             └──────────┬──────────┘
                        │
                     WebSocket
                        │
                 Sync Service
                        │
             ┌──────────┴──────────┐
             │                     │
          Presence              Yjs state
             │                     │
             └──────────┬──────────┘
                        │
                 SQL + Object Store
```

Presence data should remain ephemeral:

- cursor position
- selected object
- user name/color
- current page

It should not be stored as durable content.

## 12.3 Server persistence strategy

Possible approach:

```text
WebSocket update
      ↓
validate/authenticate
      ↓
broadcast to peers
      ↓
persist incremental update
      ↓
periodic compaction
      ↓
periodic canonical snapshot
```

Do not store every transient cursor event in the main database.

---

# 13. AI & MCP Integration

AI is a first-class extension point of Acute-Notes, but it must not change the product's simple canvas-first interaction model. The key principle is:

> **AI understands structured canvas objects and relationships, not screenshots.**

Acute-Notes should eventually support both directions:

```text
External agents / MCP clients
            │
            ▼
     Acute-Notes MCP Server
            │
            ▼
    Acute-Notes structured state

Acute-Notes
    │
    └── MCP Host / external connectors → GitHub / Slack / Linear / Drive / ...
```

## 13.1 Product goals

The AI layer should let users:

- ask about the current selection
- summarize a canvas or investigation
- find related objects
- convert findings into TODOs
- generate a table from unstructured notes
- create a page for deeper detail
- create and explain test cases
- group or organize related objects
- connect objects with semantic relationships
- **visualize** a large unstructured input (AI response, Markdown, notes, docs) as an editable canvas (§13.15)
- use **the AI access they already have** — an existing subscription (GitHub Copilot first), their own API key (BYOK), or a local model — with no difference in features
- eventually ask an external agent to create/update content through MCP

AI must produce **native Acute-Notes objects**, not screenshots or chat-only results, whenever the requested result belongs on the canvas.

## 13.2 Acute-Notes as an MCP server

External agents such as Claude Code, Cursor, VS Code, or another MCP client should be able to access an Acute-Notes workspace through MCP.

```text
Claude Code
     │
     │ MCP
     ▼
Acute-Notes MCP Server
     │
     ├── Canvas
     ├── Pages
     ├── Tables
     ├── Todos
     ├── Code
     └── Relationships
```

MCP resources provide readable structured context; MCP tools perform explicit actions. Keep these concepts separate.

## 13.3 MCP Resources

Initial resource model:

```text
acute://workspace/{workspaceId}
acute://canvas/{canvasId}
acute://page/{pageId}
acute://table/{objectId}
acute://todo/{objectId}
acute://context/current
```

Resource payloads must be bounded and should not automatically contain the entire workspace.

## 13.4 Current context resource

Provide:

```text
acute://context/current
```

It may contain the workspace, canvas, selected objects, nearby objects, open page, recent changes, relevant relations, and available tools. This should answer:

> **What is the user looking at right now?**

Never include credentials, access tokens, or unrelated private content.

## 13.5 MCP Tools

Do not expose 100 tiny tools. Start with a deliberately small surface:

```text
Read:
search_workspace
get_canvas
get_page
get_selected_content
get_related_objects

Create:
create_block
create_page
create_table
create_todo
create_connection

Modify:
update_block
move_object

Visualize:
render_visual_plan
```

`render_visual_plan` lets an external agent supply the intelligence (a `VisualPlan`) while Acute-Notes keeps ownership of validation, layout, rendering, and review.

A future `delete_object` tool must require explicit permissions/confirmation.

Every tool must use the normal domain command and transaction layer.

## 13.6 AI selection experience

When the user selects an object or group, expose a compact `✨ Ask AI` action. Possible actions:

```text
Explain
Summarize
Find related items
Turn into tasks
Create test cases
Create plan
```

Use explicit scope: Selection / This canvas / This workspace. Do not add persistent AI buttons to every object.

## 13.7 AI action model

AI should produce declarative actions that map to native domain operations:

```text
User request
   ↓
AI reasoning
   ↓
Declarative action set
   ├── create_todo()
   ├── create_page()
   ├── create_connection()
   └── move_object()
   ↓
Review
   ↓
Accept
   ↓
Domain transaction
   ↓
Local state / Yjs
```

The user should be able to inspect, accept, reject, and undo AI changes.

For Content-to-Canvas, the "declarative action set" is produced in two steps: the model produces a `VisualPlan` (meaning + representation), and the deterministic renderer turns it into the change set (IDs, positions, sizes, styling). See §13.15.

## 13.8 AI review and provenance

Display a compact summary for multi-object operations:

```text
✨ AI suggestion

Created:
+ 3 todos
+ 1 page
+ 2 connections

[Review] [Accept all] [Reject]
```

Optional metadata:

```text
createdBy: user | ai | import
model: ...
operationId: ...
sourceRefs: [...]
```

Support View context, View changes, and Undo without creating a heavy audit UI.

## 13.9 Spatial AI capabilities

AI can eventually operate on layout through typed spatial commands:

```text
move_object
resize_object
align_objects
group_objects
connect_objects
create_section
arrange_layout
```

Agents must operate on stable object IDs and geometry rather than interpreting screenshots.

## 13.10 Semantic relationships / lightweight knowledge graph

Ordinary arrows may optionally carry semantic meaning:

```text
relates_to
caused_by
depends_on
supports
blocks
implements
derived_from
references
```

Visual appearance remains Excalidraw-like. Metadata is stored separately. This creates a lightweight graph without requiring a separate graph database.

## 13.11 Semantic search / retrieval

AI should not inspect the entire workspace JSON on every request. Search across pages, blocks, tables, TODOs, code, and relationships.

Start with deterministic local search. Add embeddings/vector search only when measured scale or product requirements justify it.

```text
Query
  ↓
Search
  ↓
Relevant objects
  ↓
Relevant relations
  ↓
Bounded AI context
  ↓
Model
```

## 13.12 Acute-Notes as an MCP host

Acute-Notes should eventually consume other MCP servers:

```text
Acute-Notes
    │
    ├── GitHub MCP
    ├── Slack MCP
    ├── Linear MCP
    ├── Filesystem MCP
    ├── Google Drive MCP
    └── Microsoft OneDrive MCP
```

External information can become structured canvas objects with provenance such as source provider, external ID, URL, and last-synced timestamp.

## 13.13 MCP prompts

MCP prompts may expose reusable actions such as:

```text
Review this canvas
Summarize this investigation
Turn findings into an action plan
Find missing scenarios
Explain this architecture
Review this code
Prepare meeting notes
```

Keep these invisible/simple in the Acute-Notes UI. The user should see lightweight actions such as `Review`, `Summarize`, or `Create plan`; the underlying implementation may map them to MCP prompts where appropriate.

### Coding-agent prompt

> Add a small prompt registry behind the `mcp/` boundary. Prompts must resolve to bounded context and explicit actions. Do not expose prompt implementation details in the canvas UI. Keep prompts reusable and deterministic enough for tests. Do not create a large prompt marketplace or prompt-management UI.

## 13.14 MCP Apps / interactive MCP surfaces

MCP Apps may later allow an external agent/client to render an interactive Acute-Notes surface rather than returning only text. This is a future integration capability, not a dependency of the core editor.

Potential future flow:

```text
Claude / another MCP client
        │
        │ MCP
        ▼
Acute-Notes MCP surface
        │
        ▼
Interactive canvas / review UI
```

The first implementation should not depend on MCP Apps for normal Acute-Notes operation. Preserve the ability to expose the structured canvas through MCP resources/tools independently.

### Coding-agent prompt

> Define an optional `MCPAppSurfaceProvider` interface only. Do not implement an interactive MCP App runtime during the core editor build. Ensure future MCP UI surfaces can reuse existing resource serializers, domain commands, and AI review transactions without introducing a second document model.

## 13.15 AI Runtime — Content-to-Canvas & Provider-Agnostic Architecture

> **Acute-Notes owns the visual language and object model; AI providers only supply intelligence.**

> **Acute-Notes owns the AI experience, not the AI bill.**

These rules protect Acute-Notes from depending on any single provider and from absorbing users' inference costs. Users bring the AI access they already have — **an existing subscription, their own API key, or a local model** — and Acute-Notes provides the note intelligence on top, without changing canvas, block, page, or domain code. For now the **only** real adapter is built on the **GitHub Copilot SDK**, which serves the Copilot subscription and the user's own API keys; other subscriptions (Claude, ChatGPT) are added later as new adapters without refactoring (§13.15.11–13.15.12).

Features: F26 (runtime + provider manager), F27 (AI connections + credential storage), F28 (parser), F29 (VisualPlan), F30 (renderer), F31 (Visualize), F32 (decision model), F33 (Mermaid), F34 (managed AI — deferred, not planned), F35 (Copilot SDK provider + AI host), F36 (connection validation + shared contract tests).

### 13.15.1 Content-to-Canvas workflow

**Objective:** let users take a large unstructured input — an AI response, Markdown document, pasted text, research notes, meeting notes, documentation, or imported content — and turn it into a **visually understandable, editable Acute-Notes canvas**.

The AI does **not** generate an image or a proprietary canvas format. It produces a structured intermediate representation (`VisualPlan`) that Acute-Notes converts into the **native objects already supported by the application**.

> **AI decides what the content means and how it should be represented. Acute-Notes decides how that representation is rendered.**

This keeps AI-generated content editable, searchable, local-first, and compatible with future features.

The user pastes/imports content and chooses `✨ Visualize` (entry points in §6.4). Pipeline:

```text
User Content
     │
     ▼
Content Parser (F28, local, deterministic)
     ├── Markdown structure
     ├── headings
     ├── lists / checklists
     ├── tables
     ├── code
     └── plain text
     │
     ▼
Tier 1: Is local structure sufficient? ──YES──→ Local planner ──┐
     │ NO                                                         │
     ▼                                                            │
AI Content Analysis (via AIRuntime tasks)                         │
     ├── concepts / entities                                      │
     ├── relationships                                            │
     ├── actions / processes / decisions                          │
     └── important sections                                       │
     │                                                            │
     ▼                                                            │
Visual Planning                                                   │
     ├── choose template  (decision model if configured, F32)     │
     ├── map content to node types                                │
     └── define relationships                                     │
     │                                                            │
     ▼                                                            │
VisualPlan (validated, F29) ←─────────────────────────────────────┘
     │
     ▼
Deterministic Renderer (F30): IDs, layout, sizes, styling
     │
     ▼
Pending change set → Review (F19) → Accept
     │
     ▼
Native Acute-Notes objects (one transaction, one undo step)
```

The LLM must **not** directly manipulate React state, Excalidraw state, BlockNote state, or persistence.

### 13.15.2 Visual templates

Acute-Notes maintains a small, **application-owned** registry of visual templates. Initial set:

| Template | Typical input | Layout strategy |
|---|---|---|
| Flow | "User logs in → API validates → token generated → dashboard" | left-to-right / top-down chain |
| Problem → Cause → Solution | "App is failing because of three possible causes…" | three columns with connecting arrows |
| Concept Map | research notes, explanations of related ideas | seeded radial / clustered |
| Timeline | dated events, release plans, incident timelines | horizontal axis |
| Decision Tree | options, conditions, if/then guidance | top-down tree |
| Architecture | components, services, data flows | layered boxes + arrows |
| Comparison | A vs B, pros/cons, option evaluation | columns or table |
| Action Plan | steps, tasks, follow-ups | heading + checklist (+ optional pages) |

The AI **selects and populates** a template; it does not invent arbitrary UI structures. Each template declares its allowed node types, slots/roles, relationship types, and layout strategy. Templates are deterministic code, not prompts. New templates are added by the Acute-Notes team, not generated at runtime.

### 13.15.3 Native object generation

Templates compose **existing Acute-Notes primitives only**:

> **AI-generated content must be composed from the same objects that a human can create manually.**

| VisualNode type | Rendered as |
|---|---|
| `heading` | simple canvas text (section title) or heading inside a rich text block, decided by the template |
| `text` | rich text block |
| `todo` | checklist (TODO) block |
| `table` | table block |
| `code` | code block |
| `page` | new `PageDocument` + page preview object |
| `shape` | rectangle / diamond / ellipse with a text label |
| `image` | image object referencing an **existing asset** from the input (AI never generates images) |
| relationship | arrow + `AcuteRelation` with semantic type |

Example — an AI-generated action plan becomes a real checklist block, not a picture:

```text
┌──────────────────────────────┐
│ Action Plan                  │
│                              │
│ ☑ Validate input             │
│ ☐ Fix retry logic            │
│ ☐ Add integration tests      │
└──────────────────────────────┘
```

### 13.15.4 VisualPlan intermediate representation

The model (or the local planner, or an MCP client via `render_visual_plan`) produces a provider-independent, versioned structure. Node content is **typed per node type** so it can be validated before rendering.

```ts
type VisualTemplate =
  | "flow"
  | "problem_cause_solution"
  | "concept_map"
  | "timeline"
  | "decision_tree"
  | "architecture"
  | "comparison"
  | "action_plan";

type VisualPlan = {
  version: 1;
  template: VisualTemplate;
  nodes: VisualNode[];
  relationships: VisualRelationship[];
  metadata?: {
    title?: string;
    summary?: string;
  };
};

type VisualNode = {
  id: string;                         // plan-local id; NOT the Acute object id
  role?: string;                      // template slot, e.g. "problem", "cause", "step"
  title?: string;
  importance?: "low" | "medium" | "high";
  sourceSpan?: { start: number; end: number }; // where in the input it came from
  stableKey?: string;                 // identity stable across regenerations of the same ContentSource (§13.15.19) — unlike `id`, comparable run to run
} & VisualNodeContent;

type VisualNodeContent =
  | { type: "heading"; content: { text: string } }
  | { type: "text"; content: { markdown: string } }
  | { type: "todo"; content: { items: { text: string; checked: boolean }[] } }
  | { type: "table"; content: { columns: string[]; rows: string[][] } }
  | { type: "code"; content: { language?: string; source: string } }
  | { type: "page"; content: { title: string; markdown: string } }
  | { type: "shape"; content: { shape: "rectangle" | "diamond" | "ellipse"; label: string } }
  | { type: "image"; content: { assetRef: string; alt?: string } };

type VisualRelationship = {
  from: string;                        // VisualNode.id
  to: string;                          // VisualNode.id
  type: AcuteRelation["type"];         // same vocabulary as the domain (§5.1)
  label?: string;
};
```

`stableKey` (added for F37–F39, §13.15.19) is optional and, when populated, lets a later regeneration for the same `ContentSource` recognize "this is the same logical node" rather than only "a new node." The local planner (F28) derives it deterministically from structure (heading path, list ordinal, template slot); when a model produces it, it is still just a string compared for equality — never trusted as an object ID.

The model produces only this. **The application determines:**

- object IDs
- positions and dimensions
- layout
- colors and styling
- rendering
- persistence
- relationships as arrows + `AcuteRelation`
- canvas state

This separation is mandatory for reliability and performance. Validation rules are defined in F29.

### 13.15.5 Mermaid support

Mermaid may be supported as an additional representation for flow, sequence, architecture, and state diagrams. It must **not** become the primary Acute-Notes data model.

```text
Mermaid diagram
       ↓
Render (optional preview)
       ↓
Convert to native canvas (Mermaid → VisualPlan → renderer)
```

This lets users convert generated Mermaid into editable Acute-Notes shapes, text, and arrows. See F33.

### 13.15.6 AI cost ownership — subscription, BYOK, and local

**Objective:** Acute-Notes must not own or absorb users' LLM inference costs.

> **Acute-Notes owns the AI experience, not the AI bill.**

Users connect AI they already have access to, in one of three ways:

| Access type | What it means | Who pays for inference | UI wording |
|---|---|---|---|
| **Subscription** | An existing AI subscription whose provider **officially** supports third-party application/SDK authentication (initially: GitHub Copilot via the GitHub Copilot SDK) | the user's existing plan | "Uses your existing AI subscription. Acute-Notes does not pay for inference." |
| **BYOK** (Bring Your Own Key) | The user's own API credentials for a provider | the user, billed directly by the provider | "Uses your own API key. You are billed directly by the AI provider." |
| **Local** | A model running on the user's machine (e.g. Ollama) | nobody — no cloud inference | "Runs locally. No cloud AI charges." |

```text
User
 │
 ├── Existing subscription ──► Provider SDK ──► Provider
 │
 ├── Own API key ────────────► Provider SDK ──► Provider
 │
 └── Local model ────────────► Local runtime
```

Rules:

- **No shared application-owned LLM key** for normal user AI operations. Acute-Notes does not proxy user AI requests through an Acute-Notes-owned key.
- A consumer chat subscription is **not** an API credential. A ChatGPT Plus/Pro, Claude Pro/Max, or Gemini consumer subscription must not be presented as usable unless that provider officially supports third-party application authentication against it (see §13.15.12).
- The UI must never imply that every provider's consumer subscription can automatically be used by third-party applications.
- Subscription-based access still consumes the user's plan allowance (for Copilot, each prompt counts toward the user's premium-request allowance, with model multipliers). The UI says so; it does not describe subscription use as "free".

### 13.15.7 Provider-agnostic AI runtime

The application must not contain provider-specific calls throughout feature code. Do **not** build:

```ts
if (provider === "gemini") { ... }
if (provider === "openai") { ... }
if (provider === "anthropic") { ... }
```

Provider-specific logic — authentication, SDK calls, request/response formats, model lists, error mapping, billing wording — lives **only** inside provider adapters. Feature code (Visualize, Summarize, Create Page, Ask AI, templates, knowledge graph) must not know which provider is in use.

```text
Acute-Notes feature (Visualize, Ask AI, Summarize, …)
        │
        ▼
AIRuntime.run(task, input)          ← the only entry point for features
        │   task registry: schemas, prompts, routing policy, validation
        ▼
AIProviderManager                   ← registry, active selection, fallback
        │
        ▼
AIProvider interface
        │
        ├── CopilotProvider ─────────── GitHub Copilot SDK   (the only real adapter for now)
        │      ├── Copilot subscription (GitHub OAuth / signed-in user)
        │      └── BYOK via SDK: OpenAI · Azure OpenAI / Foundry · Anthropic · OpenAI-compatible (Ollama, Gemini*, …)
        │
        ├── (future) ClaudeSubscriptionProvider ── when Anthropic officially allows it   ┐ new module + one
        ├── (future) ChatGPTSubscriptionProvider ─ when OpenAI officially allows it      ┘ registry line (§13.15.12)
        │
        └── MockProvider ────────────── deterministic, dev/tests
```

Core interfaces (names may be refined during implementation; the abstraction must stay provider-neutral):

```ts
type AIAuthType = "subscription" | "api_key" | "oauth" | "local";

// Where the adapter's SDK actually executes (see §13.15.13).
type AITransport =
  | "browser_direct"   // browser → provider (fetch-based adapter)
  | "ai_host_local"    // browser → AI host on the user's machine → provider
  | "ai_host_server";  // browser → Acute-Notes AI host → provider (user's credentials, never an app key)

interface AICapabilities {
  streaming: boolean;
  structuredOutput: "native" | "json_mode" | "none";
  toolCalling: boolean;
  vision: boolean;
  embeddings: boolean;
  modelSelection: boolean;
  maxContextTokens?: number;
}

interface AIProvider {
  readonly id: string;                       // e.g. "copilot", "openai", "ollama", "mock"
  readonly name: string;                     // display name
  readonly authTypes: readonly AIAuthType[];
  readonly transport: AITransport;
  readonly capabilities: AICapabilities;     // for the selected model; refreshed on model change

  isConfigured(): Promise<boolean>;
  testConnection(): Promise<ConnectionTestResult>;

  generate(request: AIRequest): Promise<AIResponse>;
  stream?(request: AIRequest): AsyncIterable<AIStreamChunk>;

  getModels?(): Promise<AIModel[]>;
  getUsage?(): Promise<AIUsage | null>;      // null when the provider does not expose usage
  disconnect?(): Promise<void>;
}

interface AIRequest {
  task: AITask;
  systemPrompt?: string;
  prompt: string;
  context?: AIContext;                       // bounded, selection-first (§5.5)
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseSchema?: JSONSchema;               // generated from the task's Zod schema
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface AIResponse {
  text: string;
  structured?: unknown;                      // UNVALIDATED — the runtime validates it
  model: string;
  finishReason: "stop" | "length" | "cancelled" | "error";
  usage: AIUsage;
}

interface AIProviderConfig {
  providerId: string;
  authType: AIAuthType;
  model?: string;
  metadata?: Record<string, unknown>;        // non-secret settings only (endpoint, BYOK type, …)
  // Secrets are NOT part of this object. They live in the credential store (§13.15.13).
}
```

`AIProviderManager` responsibilities:

- register providers (`registerProvider(new CopilotProvider(...))`) and expose the registry to AI Settings — the settings UI is built from each provider's descriptor, never hard-coded
- store the active selection (primary, optional fallback, optional decision model — F32)
- initialize providers lazily and check configuration
- select models (via `getModels()` when `capabilities.modelSelection`)
- track availability and apply the **explicit** fallback policy (§13.15.10)
- expose one provider-neutral interface to `AIRuntime`

```ts
const ai = AIProviderManager.getInstance();
await ai.initialize();
const provider = ai.getActiveProvider();     // used by AIRuntime, not by feature code
```

Features call `AIRuntime.run(task, input)`, which resolves a provider through the manager, builds the `AIRequest`, and validates the result. Features never import an adapter or call `generate` with a vendor-specific shape.

**Capability detection.** Features and the runtime check `provider.capabilities` rather than assuming support:

```ts
if (provider.capabilities.structuredOutput === "native") {
  // pass responseSchema to the provider
} else {
  // ask for JSON, then validate + one repair retry (F26)
}
```

This matters most for `VisualPlan` generation and other structured Acute-Notes blocks. Whatever path is used, **every structured result passes the Acute-Notes schema/validation layer (F29) before it reaches the renderer or domain commands.**

### 13.15.8 Task-based routing

The application requests an **AI task**, not a model:

```ts
ai.run("select_template", input);
```

rather than:

```ts
gemini.generate(...);
```

Tasks:

```ts
type AITask =
  | "classify"
  | "select_template"
  | "extract_content"
  | "extract_entities"
  | "extract_relationships"
  | "summarize"
  | "generate_note"        // new rich text / page content
  | "transform_note"       // rewrite, restructure, convert selection (e.g. to TODOs)
  | "organize"             // arrange / group existing objects (Phase 3 spatial ops)
  | "generate_visual_plan" // Content-to-Canvas and "AI-generated note templates"
  | "suggest"
  | "chat";
```

Each task is registered with its input schema, output schema, prompt template, and routing policy. The runtime decides which configured provider handles it. Providers can be added or replaced without changing the Content-to-Canvas implementation or any other feature.

"AI-generated note templates" means the AI **selects and populates** an application-owned template (§13.15.2) and returns a `VisualPlan`; it never invents template code, UI, or database structures at runtime.

### 13.15.9 Optional cheap decision model

Acute-Notes may optionally support a secondary, lower-cost decision model (for example, Jev) for lightweight classification/routing. This is an **optional optimization, never a dependency**, and like every other provider it runs on the **user's own** subscription, key, or local model — never an Acute-Notes-owned key.

```text
User Content
     │
     ▼
Can local rules determine the structure?
     │
   YES ─────────────→ Local processing
     │
    NO
     │
     ▼
Decision model configured?
     │
   YES ─────────────→ Decision model ──(error / low confidence)──┐
     │                                                          │
    NO                                                          │
     │                                                          │
     ▼                                                          │
Configured primary provider ←───────────────────────────────────┘
```

Suitable tasks: template selection, content classification, routing, confidence estimation, "does this need deep AI processing?".

If the user configured a decision model, use it. If not, **the primary user-configured provider must continue to work normally**. The application must never require the decision model. Falling back from the decision model to the primary is allowed without prompting because both are connections the user configured for this purpose. See F32.

### 13.15.10 Provider priority and explicit fallback

Default policy:

```text
1. Local deterministic processing
2. Optional decision model (user-configured)
3. User-selected primary provider
4. User-selected fallback provider — only if the user explicitly enabled fallback
```

The order is configurable internally, per task:

```ts
const AI_POLICY = {
  select_template: {
    preferDecisionModel: true,
    fallback: "primary",
  },
  classify: {
    preferDecisionModel: true,
    fallback: "primary",
  },
  generate_visual_plan: {
    provider: "primary",
  },
} satisfies AIPolicy;
```

**Primary → fallback provider switching is never silent and never implicit.**

```text
Primary:  GitHub Copilot
Fallback: Gemini (API key)      ← set by the user in AI Settings; off by default
```

```text
Primary unavailable (auth expired, provider/network outage, quota exhausted)
       ↓
Fallback enabled by the user?  ── NO ──→ show error + "Open AI Settings"
       ↓ YES
Fallback provider configured and passing?
       ↓ YES
Use fallback → show "Used Gemini (fallback) — GitHub Copilot was unavailable"
```

Rules:

- Fallback triggers only on **availability** failures (auth expired, 5xx/network, rate limit, quota/premium-request allowance exhausted). It does not trigger on schema-validation failures, content refusals, or user cancellation.
- The settings UI shows the fallback's access type (subscription / BYOK / local) so the user understands that falling back to a BYOK provider **can incur API charges**. No fallback may create charges the user has not explicitly configured.
- Fallback never crosses a privacy boundary the user did not choose (e.g. from a local model to a cloud provider) without the same explicit setting.
- The provider actually used is recorded in `AIUsage.provider` and `AIMetadata.provider`.

### 13.15.11 Adapter strategy — GitHub Copilot SDK only (for now)

**Decision:** Acute-Notes ships **one** real adapter, `CopilotProvider`, built on the official **GitHub Copilot SDK** (`@github/copilot-sdk`). No other provider SDK is added in the current plan. The Copilot SDK lets a user's GitHub Copilot subscription be used directly, and its BYOK support covers the main API-key providers through the same adapter:

| User-facing connection | Copilot SDK mechanism | Access type | Offered when |
|---|---|---|---|
| GitHub Copilot | Copilot subscription — GitHub OAuth / GitHub App user token (`gitHubToken`), or the signed-in Copilot user in local mode | Subscription | always |
| OpenAI | BYOK `provider: { type: "openai", baseUrl, apiKey }` | BYOK | always |
| Azure OpenAI / Microsoft Foundry | BYOK `type: "azure"` | BYOK | always |
| Anthropic | BYOK `type: "anthropic"` | BYOK | always |
| Ollama (and other local OpenAI-compatible runtimes, e.g. Foundry Local) | BYOK `type: "openai"`, `baseUrl` = local endpoint, no key | Local | local host mode only (§13.15.13) |
| Gemini, OpenRouter, other OpenAI-compatible APIs | BYOK `type: "openai"` against the provider's OpenAI-compatible endpoint — **not documented by the Copilot SDK** | BYOK | only after it passes validation (F36) |

The AI Settings list shows each of these as a **separate connection** — a provider descriptor registered with `AIProviderManager`, all backed by the Copilot SDK adapter.

**If a connection fails validation, it is not offered** (hidden behind its feature flag) and recorded as future work. We do **not** add a provider-specific SDK to rescue it in this plan. The architecture keeps that option cheap for later (§13.15.12).

**Why only the Copilot SDK**

- It is an official, generally available SDK that lets users run requests **on their own Copilot subscription** from a third-party application — the clearest example of zero-inference-cost access.
- The same SDK already supports BYOK for OpenAI, Azure, Anthropic, and OpenAI-compatible endpoints, so one adapter covers most users.
- One adapter means one auth, transport, streaming, and error-mapping implementation to build, secure, and test.
- Claude (Pro/Max, Claude Code) and ChatGPT (Plus/Pro, Codex) subscriptions **cannot** be used through the Copilot SDK. Neither provider currently offers an officially supported way for a third-party app to use them (§13.15.12). Users can still reach Claude and GPT models through their Copilot plan or through their own Anthropic/OpenAI API keys.

**Runtime constraints of the Copilot SDK (re-verified 2026-09-26 against the real, installed `@github/copilot-sdk@1.0.14` during the F35 implementation — the 2026-09-25 version of this section got several specifics wrong; corrections are called out inline below)**

- It runs in **Node.js**, not in the browser. The Node package bundles the Copilot CLI and talks to it over JSON-RPC. Acute-Notes therefore needs an **AI host** (a Node process) for this adapter — see §13.15.13 and F35.
- Authentication: explicit `gitHubToken` (supports `gho_` OAuth user tokens, `ghu_` GitHub App user tokens, `github_pat_` fine-grained PATs), environment tokens, or the signed-in user (`useLoggedInUser`). In a multi-user server, create one client/session per authenticated user with that user's token.
- A Copilot subscription is required unless BYOK is used; a Copilot Free tier exists. Usage counts toward the user's premium-request allowance.
- BYOK: `type` is `openai`, `azure`, or `anthropic`; `baseUrl` is required; `model` is **required** with BYOK; `bearerToken` is static (no automatic refresh); `wireApi` is `completions` or `responses`. BYOK needs no GitHub auth and **bypasses Copilot API authentication entirely** — a BYOK session should never also carry `useLoggedInUser: true`.
- `CopilotClientOptions.mode: "empty"` — not previously documented here — is the SDK's own posture for exactly Acute-Notes' situation ("multi-user server applications … ambient behavior is unsafe"): it disables the cross-session store, memory, and built-in skills/plugins by default. Adopt it unconditionally alongside the hardening below.
- Messaging: `client.createSession({ model, provider, streaming, systemMessage, tools, availableTools, excludedTools, onPermissionRequest, ... })` returns a `CopilotSession`; `session.sendAndWait(options, timeoutMs?)` sends one message and waits for the run to finish. **Corrected:** it has no schema/structured-output parameter of any kind — "supports typed structured output with a Zod schema" (previous wording) does not exist anywhere in this SDK; the only Zod-schema usage in the whole SDK is for defining *tool call arguments* (irrelevant here, since `availableTools: []`). Streaming events are `assistant.message_delta` / `assistant.reasoning_delta` (mid-run) and `assistant.message` / `assistant.reasoning` (final) — **there is no `session.idle` completion event**; `sendAndWait`'s own resolution is the completion signal, and it can resolve `undefined` (no message produced) without throwing. `client.listModels()` and `client.stop()` exist as documented.
- **Corrected — no exported error classes.** A failed run is reported via a `session.error` event (`data.errorType` — e.g. `"authentication"`, `"authorization"`, `"quota"`, `"rate_limit"`, `"context_limit"`, `"query"` — plus `data.statusCode` and `data.message`), fired *during* the same `sendAndWait` call whose resolution may simply be `undefined`. Only a failure before any session/event stream exists (the CLI process itself failing to start, the connection dying) throws a plain `Error` with just `.message` — nothing more structured.
- **Corrected — no `getUsage()`-style query exists.** Per-call usage arrives only as the `assistant.usage` event (`inputTokens`, `outputTokens`, `copilotUsage.totalNanoAiu` for Copilot-subscription calls, `isByok` to tell BYOK calls apart), fired during the call — there is no way to ask for it afterward.
- **By default the SDK exposes the Copilot CLI's first-party tools (file system, shell) as if run with `--allow-all`.** This is unacceptable for Acute-Notes and must be locked down (below).

**Mandatory hardening for `CopilotProvider`**

- Expose **no** built-in CLI tools: `availableTools: []` — confirmed a real allow-list on `SessionConfigBase.availableTools` (`string[] | ToolSet`; an empty array means zero tools) — and an `onPermissionRequest` handler that denies every request (`{ kind: "reject" }`, regardless of the request's `kind`).
- Set `mode: "empty"` on the `CopilotClient` (see above) alongside the rest of this hardening — not previously required by this section, but confirmed to be exactly the SDK's own recommended posture for this scenario.
- Run every session with an isolated, empty per-user `baseDirectory` (client-level; sets `COPILOT_HOME`) and `workingDirectory` (settable at both the client and the session level — set both to the same isolated path) — never the Acute-Notes repo, the user's home directory, or workspace files.
- In a server deployment set `useLoggedInUser: false` and always pass the requesting user's own token. Never let the server machine's own GitHub login or environment token serve users. A BYOK `provider` bypasses Copilot auth entirely — when one is set, `useLoggedInUser` must be `false` and no `gitHubToken` sent, regardless of what auth would otherwise apply.
- Acute-Notes tools (future MCP-style domain tools) may be registered as custom SDK tools only if they return **proposals** (a `VisualPlan` or change set) — never direct mutations.
- **Corrected:** there is no SDK-level structured output to "use with the task's schema" — F29/F26's prompt-then-validate-then-one-repair-retry (`AIRuntime.run`, already built in F26) is the *only* thing that produces a valid, schema-conformant result for this provider.
- Map `session.error`'s `errorType`/`statusCode` (and, for failures outside that event stream, best-effort `.message` pattern matching) to the Acute-Notes error taxonomy (auth, quota/premium requests exhausted, model not available, network, timeout, cancelled) inside the adapter. Treat anything unrecognized as unmapped rather than guessing a kind, so it never falsely triggers fallback.

**Validation (F36) — exit criteria per connection**

A connection is offered in AI Settings only when all of the following pass through the Copilot SDK:

1. Authenticates using only documented mechanisms.
2. `generate` and `stream` work; cancellation stops the request.
3. Structured output produces a valid `VisualPlan` for all 8 templates via JSON + one repair retry (this provider has no native structured-output path — see above — so "native" is not a real option to test here).
4. Model listing or a documented model field works for model selection.
5. Errors are distinguishable (auth / quota / model / network) via the `session.error` event's `errorType`/`statusCode`, not a typed SDK exception.
6. Per-call usage is captured from the `assistant.usage` event, or the adapter's `getUsage()` honestly returns `null` (there is no cumulative-usage query to fall back to for this provider).
7. No built-in tool is ever invoked (verified by test).
8. The connection works in the target deployment mode (local host vs. server host — Ollama in particular, see §13.15.13).
9. Overhead of the SDK/CLI hop is acceptable against the §8.2 AI budgets.

### 13.15.12 Future providers and modularity requirements

We will add subscriptions such as **Claude (Pro/Max, Claude Code)** and **ChatGPT (Plus/Pro, Codex)** once their providers officially support third-party apps using them. Until then, the code must be structured so that adding one is **a new module plus one registration line** — not a refactor.

**Status of other subscriptions and SDKs (verified 2026-09-25; re-verify before acting)**

| Provider / SDK | Official SDK (JS/TS) | Consumer subscription usable by a third-party app today? | Current route in Acute-Notes | Revisit when |
|---|---|---|---|---|
| **GitHub Copilot** | `@github/copilot-sdk` | **Yes** — requests run on the authenticated user's Copilot plan | `CopilotProvider` (the only adapter) | — |
| **Claude Pro/Max (Claude Code)** | Claude Agent SDK `@anthropic-ai/claude-agent-sdk`; client SDK `@anthropic-ai/sdk` | **No, unless Anthropic approves.** Agent SDK docs: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products." A Claude help article describes third-party apps drawing on a user's plan through the Agent SDK, but that change was paused on 2026-06-15. | Anthropic API key via Copilot SDK BYOK; Claude models via the user's Copilot plan | Anthropic documents or approves third-party subscription login for Acute-Notes |
| **ChatGPT Plus/Pro (Codex)** | Codex SDK `@openai/codex-sdk`; `openai`; `@openai/agents` | **No official mechanism.** OpenAI documents ChatGPT sign-in only for its own products (ChatGPT apps, Codex CLI, IDE extension). Community "Sign in with ChatGPT" guides use OpenAI's own Codex login and internal `chatgpt.com/backend-api` endpoints — prohibited by §13.15.13. | OpenAI API key via Copilot SDK BYOK; GPT models via the user's Copilot plan | OpenAI publishes a third-party "Sign in with ChatGPT" / subscription auth for developers |
| **Google Gemini** | `@google/genai` | **No** — Gemini consumer plans are not API credentials | Gemini API key via Copilot SDK BYOK (OpenAI-compatible endpoint), if F36 passes | Copilot SDK path fails and demand justifies a direct adapter |
| **Ollama** | `ollama` JS / REST | n/a — local | Copilot SDK BYOK in local host mode | Server-hosted deployment needs local models (requires a browser → `localhost` adapter) |
| **OpenRouter / other OpenAI-compatible** | `openai` with custom `baseURL` | n/a | Copilot SDK BYOK, if F36 passes | Phase 3 |
| **Vercel AI SDK** | `ai` + `@ai-sdk/*` | n/a — a library, not a provider | not used | Several direct adapters become necessary |

**Modularity requirements — build these now so future adapters need no refactoring**

1. **One folder per adapter.** `src/ai/providers/<id>/` holds the client-side adapter and its descriptor; `src/ai/host/<runtime>/` holds any Node-only SDK code. Copilot types and `@github/copilot-sdk` imports never leave `providers/copilot/` and `host/copilot/`.
2. **A single registration point.** `src/ai/providers/registry.ts` is the only file that lists adapters, one line each. Adding Claude or ChatGPT later is a new folder plus one line there.
3. **Descriptor-driven settings.** Each descriptor declares id, display name, access type (subscription / api_key / local), billing wording, auth flow, fields, transport, and feature flag. AI Settings renders from descriptors only, so a new subscription automatically appears under "Subscription".
4. **Pluggable auth flows.** Define `AuthFlow` (`oauth_web`, `oauth_device`, `api_key`, `sdk_signed_in_user`, `none`) and a `CredentialStore` interface. GitHub OAuth is the first `AuthFlow` implementation; a future "Sign in with Claude" or "Sign in with ChatGPT" is another one, not a change to settings or storage.
5. **Provider-neutral host protocol.** Browser ↔ AI host routes are generic and dispatch by connection id to a `HostRuntime` interface. `CopilotHostRuntime` is the first implementation; a future Claude Agent SDK or Codex SDK runtime implements the same interface beside it. **As actually implemented in F35** (2026-09-26): the routes are the flatter `/api/ai/run`, `/api/ai/stream`, `/api/ai/models` — not the per-connection-id `/api/ai/connections/:id/test` / `/api/ai/connections/:id/models` form this point originally described — because F27 (which defines what a "connection" *is*, and is what a route would dispatch *by*) doesn't exist yet; a single `getHostRuntime()` singleton stands in for connection-id dispatch until then. The `HostRuntime` interface itself also ended up simpler than `createSession`/`send`/`stream`/`listModels`/`stop`: it's `{ generate(input), stream(input), listModels(auth) }`, where `input` already carries the resolved per-user auth and optional BYOK `provider` — session lifecycle (`createSession`/`send`/`stop`) is an internal `CopilotHostRuntime` concern, not part of the neutral contract other host runtimes need to expose the same way. Revisit both the route shape and this interface once F27 lands and a second `HostRuntime` actually needs to be built against it.
6. **Neutral types only across boundaries.** `AIRequest`, `AIResponse`, `AIStreamChunk`, `AIUsage`, `AICapabilities`, and a provider-neutral error taxonomy (`auth`, `quota_exhausted`, `rate_limited`, `model_unavailable`, `network`, `timeout`, `cancelled`, `invalid_output`) are the only types features, runtime, UI, and host routes see. SDK events are mapped in one file per adapter.
7. **Generic subscription usage.** `AIUsage.subscriptionUsage` (`{ unit, amount }`, e.g. Copilot premium requests) describes plan-based usage, so other plans' units fit without type changes.
8. **Shared hardening contract.** Any agent-style SDK (Copilot today; Claude Agent SDK or Codex SDK later) must pass the same tests: no built-in tools, isolated working directory, per-user credentials, no server identity, no secret logging.
9. **One reusable contract-test suite.** F36's suite runs against every registered descriptor, so a future adapter is accepted by passing the existing tests rather than by new, ad-hoc checks.

Adding a provider later is always the same checklist:

```text
1. Create src/ai/providers/<id>/ (and src/ai/host/<runtime>/ if the SDK is Node-only)
2. Implement AIProvider (and HostRuntime, if needed)
3. Implement or reuse an AuthFlow + CredentialStore
4. Declare AICapabilities, access type, billing wording, transport
5. Add one line to registry.ts
6. Pass the shared contract-test suite (F36)
```

No note-generation, chat, template, knowledge-graph, settings-UI, or other AI feature changes.

### 13.15.13 Privacy, transport, and credential handling

Because the Copilot SDK runs in Node, AI requests for `CopilotProvider` go through an **AI host**: a small Node service (Next.js route handlers on the Node.js runtime under `src/app/api/ai/`, backed by `src/ai/host/`). The host is an **execution environment for the user's credentials**, not an Acute-Notes AI gateway: it never holds an Acute-Notes-owned LLM key.

**Mode A — local host (preferred for local-first use).** Acute-Notes runs on the user's machine (`next start`, a dev build, or a future desktop wrapper); the AI host listens on `localhost` only.

```text
Browser (Acute-Notes) ──► AI host on localhost ──► GitHub Copilot / provider / local Ollama
```

- Auth: GitHub OAuth device/web flow, or the Copilot CLI's own signed-in user through the SDK's `useLoggedInUser` option. Acute-Notes never reads, copies, or parses CLI credential files itself — only the SDK does, as documented.
- Content leaves the device only to the user's chosen provider. Local Ollama works through the SDK's OpenAI-compatible BYOK path.

**Mode B — server host (when Acute-Notes is deployed for many users).**

```text
Browser ──► Acute-Notes AI host (per-user session, user's token/key) ──► GitHub Copilot / provider
```

- Auth: a GitHub App / OAuth App owned by Acute-Notes that users authorize; the per-user token is passed as `gitHubToken`. `useLoggedInUser: false` always.
- User content **transits** Acute-Notes infrastructure (compute and bandwidth only — inference is billed to the user). The UI and privacy policy must state this; the host keeps no content after the request completes and never logs prompts, outputs, tokens, or keys.
- Localhost providers (Ollama) are **not reachable** from a server host, so Ollama is offered in Mode A only. Supporting it in Mode B would need a future browser → `localhost` adapter (§13.15.12).
- Per-user session isolation, rate limiting on the host, and CSRF/origin checks on every AI route.

Adapters declare `transport`. The settings UI shows the transport **before** a credential is saved ("Requests are sent from this device" / "Requests pass through the Acute-Notes AI host using your credentials").

**Credential rules**

- Provider secrets (API keys, OAuth/GitHub tokens) are **user secrets**. They are never stored in plaintext in any server-side database (e.g. Firestore), never synced, never exported, never in Yjs/canvas/page documents, never in MCP resources, logs, telemetry, or error reports, and never sent to unrelated Acute-Notes APIs.
- `AIProviderConfig` (provider id, auth type, model, non-secret metadata) is stored separately from secrets.
- **Browser-held secrets** (BYOK keys): device-local `AISettingsRepository`, encrypted at rest with a non-extractable WebCrypto key where available, or session-only. In Mode B a BYOK key is sent per request over TLS to the AI host, held in memory for that request, and never persisted server-side.
- **GitHub tokens**: in Mode A, held by the local host in OS-level secure storage (or left to the SDK's signed-in-user mechanism). In Mode B, held server-side only, encrypted with a managed KMS key, bound to the user's Acute-Notes session, and exposed to the browser only as an HttpOnly session cookie — never readable by page scripts. `disconnect()` revokes/deletes the token.
- Send only the bounded content needed for the action (selection-first, §5.5). Visualize sends the user-provided input, not the workspace.
- Use only officially supported SDKs and authentication flows. Do not scrape credentials from CLI config files, extract consumer subscription tokens, reverse-engineer authentication, call undocumented subscription endpoints, circumvent provider billing, or present Acute-Notes requests as a provider's first-party application.

### 13.15.14 Managed AI and credits — deferred, not planned

An Acute-Notes-managed AI mode (an Acute-Notes AI gateway holding provider keys and selling credits) conflicts with the cost-ownership objective (§13.15.6) and is **not part of the plan**. It remains documented only as a boundary (F34):

- If it is ever built, it is just another adapter (`ManagedAIProvider`) behind `AIProvider`; features do not change.
- It would be strictly opt-in and paid, never the default, and **never** a fallback for subscription/BYOK/local users.
- Credits would represent product-level actions in a server-side policy and would never enter the `AIProvider` interface.

The runtime reports usage uniformly for every provider:

```ts
type AIUsage = {
  provider: string;              // connection id, e.g. "copilot", "openai"
  authType: AIAuthType;          // subscription | api_key | oauth | local
  task: AITask;
  productAction?: string;        // e.g. "visualize_document"
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  subscriptionUsage?: { unit: string; amount: number }; // plan-based usage, e.g. { unit: "premium_request", amount: 1 } for Copilot
  estimatedCost?: number;        // BYOK estimate in provider currency; never guessed when unknown
  usedFallback?: boolean;
};
```

Usage is stored device-locally (`AIUsageRepository`) for the AI Settings usage summary. When a provider does not expose usage, the UI shows "Usage not reported by this provider" rather than an estimate.

### 13.15.15 AI must use the existing object model

The AI layer must never create a parallel representation of notes. If a user can manually create Text, Heading, Todo, Table, Code, Page, Shape, or Arrow, AI uses **the same object creation APIs**:

```text
AI → create_todo() → Acute Todo object
AI → create_page() → Acute Page object
```

So AI-created content can immediately be:

- edited
- moved
- searched
- linked
- persisted
- synced
- exposed through MCP
- modified by another AI operation

See "One object-creation path for every actor" in §5.3.

### 13.15.16 Performance requirements for AI

AI must never block the canvas.

```text
Canvas interaction
       │
       ├── independent
       │
       └── AI processing
              │
              └── asynchronous, cancellable
```

While AI is processing, the user must still be able to pan, zoom, select, edit, create objects, and navigate pages. The UI shows `✨ Analyzing content…` without freezing the canvas. Budgets in §8.2; discipline in §8.6.

### 13.15.17 Consolidated coding-agent prompt

> **Implement the AI layer behind a provider-agnostic `AIProvider` interface. Do not add provider-specific logic to canvas components, BlockNote components, or domain objects. Implement the Content-to-Canvas pipeline as: parser → content analysis → optional decision model → VisualPlan → deterministic Acute-Notes renderer. The LLM must generate only a validated `VisualPlan`; it must never directly manipulate React, Excalidraw, BlockNote, or persistence state.**
>
> **Implement user-owned AI access (subscription, BYOK, local) through `AIProviderManager` and a generic task-based runtime. Acute-Notes must never use an application-owned LLM key for normal user AI operations. Build the first real adapter, `CopilotProvider`, on the official GitHub Copilot SDK running in a Node AI host, with all built-in CLI tools disabled; use its subscription auth and its BYOK support for OpenAI, Azure, Anthropic, and OpenAI-compatible/local endpoints. Do not add any other provider SDK; offer only connections that pass F36. Structure adapters, auth flows, and host runtimes per §13.15.12 so future Claude/ChatGPT subscription adapters are a new module plus one registration line. The application must work with a user-selected primary provider without requiring any secondary model. Add an optional decision-model adapter behind a feature flag; if configured, use it for inexpensive template-selection/classification tasks, otherwise automatically fall back to the primary provider. Never switch to a different provider unless the user explicitly configured a fallback, and tell the user when a fallback was used. Do not hardcode any specific provider into the application layer.**
>
> **Use the same domain commands and object creation APIs for both human-created and AI-created objects. Ensure AI-created Text, Todo, Table, Code, Page, Shape, Arrow, and other objects are indistinguishable from manually created objects. Keep AI completely asynchronous and outside the canvas rendering critical path.**

### 13.15.18 Non-destructive updates: source, artifact, and user-edit layers

Content-to-Canvas (§13.15.1) covers the *first* Visualize run. It does not by itself say what happens when the user's underlying content changes after AI has already turned it into flowcharts, tables, timelines, and so on — and the user has since edited some of those blocks by hand.

> **AI creates a version of the understanding. The user owns the resulting artifact. A later AI update must reconcile with what the user did to that artifact, never replace it wholesale.**

Three things are easy to conflate but must stay separate:

```text
ContentSource               →  the user's pasted/imported text (versioned, F37)
AI-derived objects           →  the VisualPlan-rendered canvas objects (F29/F30)
User edits on those objects  →  ordinary manual edits, indistinguishable in the editor (§1.7)
```

The rule this PRD prohibits explicitly:

```text
Source changes
      ↓
Re-send the whole document to the model
      ↓
Regenerate the whole VisualPlan
      ↓
Replace the existing objects
      ↓
💥 any manual edits on those objects are gone
```

Instead, a later Visualize run over updated content ("Update from new content", F39) always reconciles with what is already on the canvas: it produces a new reviewable change set (F19) whose items are matched against existing objects, not a wholesale replacement. See §13.15.19–§13.15.21 and F37–F39.

### 13.15.19 Content source versioning and the reconciliation pipeline

Each Visualize run against pasted/imported content is tied to a `ContentSource` (§5.1); providing updated content for the same canvas area appends a new `ContentSourceVersion` rather than starting over. The reconciliation pipeline runs when the user chooses "Update from new content" (F39):

```text
New ContentSourceVersion
        │
        ▼
Diff against previous ContentSourceVersion (F28, local, deterministic)
        │
        ├── unchanged sections ──────────────► reuse prior VisualNode content, no AI call
        │
        └── changed / new sections
                │
                ▼
        AI content analysis + generate_visual_plan (only for these sections)
                │
                ▼
        VisualPlan (validated, F29) — with VisualNode.stableKey where derivable
        │
        ▼
Match new VisualNodes to existing Acute objects by stableKey (F38)
        │
        ▼
Classify each match:
   add | remove | update_clean | update_conflict | unchanged
        │
        ▼
ReconciliationPlan → Review (F19, extended) → Accept
```

Only changed or new sections are re-analyzed by AI — this is deliberate, not an optimization detail: because model wording is not guaranteed stable across runs, regenerating unaffected sections would produce spurious "changes" even when nothing meaningful changed, on top of the wasted cost. See F38 and §13.15.21.

`update_clean` vs. `update_conflict` is decided by comparing an object's **current** content hash to its stored `contentFingerprint` — the content hash as AI last wrote it. Equal → untouched since AI wrote it, safe to propose as a normal update. Different → the user changed it since, so it is never silently applied.

### 13.15.19a Conceptual change detection (F38b)

The diff in §13.15.19 decides *which sections* are re-analysed; it is textual on purpose (cheap, exact, no model). Deciding *what changed inside* a re-analysed section is conceptual: the model is asked what changed in the user's understanding of the subject, not how to regenerate the section.

```text
changed section (text)  +  its current representation (nodes p1…pn, keys, links)
        │
        ▼
generate_visual_plan — "report conceptual changes":
   unchanged concept   → {"id":"p2","unchanged":true}
   changed concept     → full node, same id + key
   new concept         → new node, new key (keys are identities, never renumbered)
   expanded concept    → new explanation node + {"from":"p1","to":"n5","type":"explained_by"}
   concept gone        → omitted
   links               → the full set for the section
        │
        ▼
expand "unchanged" → the previous node, verbatim (code, not the model)
        │
        ▼
F38 classification (unchanged: same as before, so byte-identical → unchanged)
        │
        ▼
change set: updates / adds (explanations below their concept) / removals /
link changes (this source's arrows only) / conflicts → F19 review
```

**Why preservation is code.** Asking a model to copy an unchanged node back exactly is unreliable (whitespace, punctuation, a synonym) and every such drift would surface as a spurious update. The `unchanged` marker makes preservation exact and also shortens the reply.

**Why explanations are children.** Folding every new detail into its concept makes each version of a diagram larger than the last until it is unusable. An explanation linked `explained_by` and placed below its concept keeps the concept level clean and lets detail deepen one level at a time — concept → explanation → deeper explanation (examples, edge cases, code, references) — with page previews (§6) as the natural container once an explanation is long.

```text
[Firebase Auth] ──► [Backend validates token] ──► [Check organization membership] ──► [Session created]
       │
       │ explained_by
       ▼
┌────────────────────────┐
│ Firebase ID tokens     │
│ JWT-based; claims:     │
│ user ID, email, custom │
└────────────────────────┘
```

**What stays deterministic.** The model only proposes. Matching (stable keys), clean-vs-conflict (baseline vs. current fingerprint), placement, link ownership (connectors stamped with their content source), review, and undo are all code (F38/F39) and behave the same whatever the model answers.

**Limits.** The local tier (no model) reads the rule structurally: new paragraphs in an existing section become explanations, corrected ones stay put (F38b). Judgement quality depends on the model: a model that rewrites an unchanged concept produces an ordinary reviewable update, never a silent change. A new concept is placed in line next to the existing object it links to (or below its concept for an explanation), making room locally if needed (F41, §13.15.19b); the rest of the diagram is not re-laid-out.

### 13.15.19b Making room: local spatial reflow (F41)

F30 places AI output by translating it, as a whole, into free space near an anchor. On a crowded canvas that free space can be far away: an explanation lands screens away from its concept with a long arrow back. F41 adds the missing step, **making room**, and keeps everything else about placement as it was: deterministic, application-owned, proposed through F19.

```text
VisualPlan (no coordinates)
   │
   ▼
layoutPlan (local positions, per template)  ── F30
   │
   ▼
natural slot = anchor + side (below the concept / along the flow)
   │
   ▼
candidates:  A free slot nearby   (moves nothing)
             B push along side    (sweep, slack absorbs, units whole)
             C push other axis    (only when B is invalid)
             D guaranteed-clear   (F30 fallback)
   │  each: invalid if it moves a locked unit or exceeds the move budget
   ▼
score = 3 × distance from slot + Σ weight × displacement   → cheapest valid, ties → earliest
   │
   ▼
validate (no overlap with anything unmoved) → create_* + move changes → F19 review
```

**The push.** Units are processed in sweep order along the push axis (nearest first). A unit is pushed when a pusher (the new objects, or a unit already pushed) overlaps it across the push axis, with the minimum gap, and its far edge plus the gap now passes the unit's near edge. It moves by exactly that overlap, so the free space in front of each unit absorbs part of the push, and the push stops where the space is enough.

```text
before                  explanation needs 300 + gap below A

  [A]    [B]              [A]    [B]
                           │
  [C]    [D]              [EXPLANATION]         ← new
                          [C]                    ← pushed (was in the way)
                                 [D]             ← not in the column: stays
  [E]                     [E]                    ← gap absorbed the rest: stays
```

**Units.** An object's unit is its frame, else its outermost group, else itself; a label moves with its container and bound connectors follow the objects they are bound to (F19's move). Connectors are not obstacles: they are redrawn from their bindings.

**Weights.** Moving a unit costs its displacement × 1 when every member is still where Acute last placed it (`customData.acuteLayout` matches its position), × 4 otherwise (the user placed or moved it). A locked member makes the unit a wall. This is a layout hint, not provenance (§5.1): it says *where Acute put the object*, not who created it, and nothing branches on the creator.

**Why moves are reviewed rather than invisible.** A silent move of the user's content would break the rule that nothing changes before Accept (§1.9, F19). Making room never *asks* the user anything, though: the moves are simply part of the proposal (ghosted, counted, one undo step).

**Why not move "everything below".** A small insertion near the top would shift the whole canvas. Pushing only what is in the way, and letting gaps absorb the push, keeps a local change local.

**Limits.** Moves are computed against the canvas as it was when the proposal was built. Accept writes them as proposed (objects deleted meanwhile are dropped by `resolveChangeSet`), so an object moved by the user while the review is open ends up where the proposal says. The engine never compacts: when content shrinks, nothing is pulled back.

### 13.15.20 Conflict resolution UX and directionality

The review surface from F19 gains per-item states instead of a single "created/updated/moved/connected" summary:

```text
✨ Update from new content

+ 2 new              (add)
− 1 removed           (remove)
~ 4 updated           (update_clean — pre-selected)
⚠ 1 needs your input  (update_conflict — decided individually)

[Review] [Accept all clean changes] [Reject]
```

A conflict card shows the user's current content next to the proposed AI content, with **Apply** / **Keep mine** / **View diff**. Conflict cards are deliberately excluded from "Accept all" — each one is the user's call.

Only the current baseline (`contentFingerprint`) is kept per object, not a browsable history: this is enough for a current-vs-proposed comparison and is not a version-history feature (explicitly out of scope, §3.2; full version history remains a Cloud Phase 5 idea, §24).

**Directionality** is one-way by default: `ContentSource → AI-derived objects → user edits`. A user edit on an artifact never automatically rewrites the `ContentSource` text — otherwise a manual flowchart edit could ripple back into the source, then back out into an unrelated summary block, producing confusing, hard-to-predict churn. Updating the source from an edited artifact is always a separate, explicit action.

A per-object opt-out (`excludeFromReconciliation`) lets a user permanently exclude a block from future reconciliation without having to keep resolving the same conflict.

### 13.15.21 Performance requirements for reconciliation

Reconciliation follows the same non-blocking discipline as the rest of the AI layer (§8, §13.15.16): nothing about diffing, matching, or re-analysis may compete with canvas interaction.

```text
                    Acute-Notes UI
                60 FPS target, <16.6 ms/frame
                          │
                 ┌────────┴────────┐
                 │                 │
        Interaction-critical    Background
        (must stay <16.6 ms)   (async, cancellable)
                 │                 │
      • typing                • diff previous vs. new
      • selection               ContentSourceVersion
      • dragging              • AI re-analysis of
      • pan / zoom              changed spans only
      • block preview         • node matching /
        rendering               fingerprint comparison
                 │             • ReconciliationPlan
                 │               construction
                 │             • conflict-card diff
                 │               text preparation
                 ▼                 ▼
           committed frame     pending change set
                                (ghost preview, F19)
```

Requirements:

- Diffing the previous and new `ContentSourceVersion` (§13.15.19) is triggered only by the explicit "Update from new content" action — never on every keystroke of a live document — and still must not run on the input event handler itself.
- Node matching and fingerprint comparison (F38) work against already-loaded canvas/document state and reuse the same bounded, area-scoped context as the original Visualize (§5.5); a reconciliation run must not silently widen its scope to the whole workspace.
- Move diffing/matching to a Web Worker if profiling shows main-thread blocking >16 ms, the same rule already applied to F28's parser (§8.1 principle 9).
- AI re-analysis of changed spans reuses the same async/cancellable `AIRuntime` path as first-run Visualize (F26, §8.6) — it is additional AI work, not a new execution model.
- Conflict-card rendering reuses existing lightweight block preview rendering (§8.3); it must not mount a full BlockNote editor per card any more than inactive blocks do.
- The canvas stays fully interactive throughout — pan, zoom, select, edit other objects — with no measurable frame-rate drop while a reconciliation run is in flight (§8.1 principle 10, §13.15.16). Budgets are in §8.2.

### 13.15.22 Consolidated coding-agent prompt (F37–F39)

> **Implement content-source versioning and non-destructive reconciliation as an extension of the existing Visualize pipeline (F28–F31), never as a replacement for it.** Add `ContentSource`/`ContentSourceVersion` and the reconciliation fields on `AIMetadata` (§5.1) and `VisualNode.stableKey` (§13.15.4). Before calling any model, diff the new pasted/imported content against the previous `ContentSourceVersion` at the parsed-content level and re-analyze only the changed or new sections — this is both a correctness rule (avoids non-deterministic model wording flagging unrelated content as "changed") and a performance rule (§13.15.21). Match new nodes to existing objects by `stableNodeKey`, then compare each matched object's current content hash to its stored `contentFingerprint` to classify it `update_clean` (safe, auto-selectable) or `update_conflict` (never auto-applied — always an Apply / Keep mine / View diff decision). Extend the existing F19 review change set and transaction/undo model rather than building a parallel review UI. Never write back into `ContentSource` automatically; provide only an explicit, separate "Update source from this edit" action. Store only the current baseline fingerprint per object — do not build a general version-history feature. Keep every step off the canvas interaction path, using a Web Worker for large-canvas matching if profiling shows main-thread blocking, exactly like the rest of the AI layer.

## 13.16 Permissions and safety

Future AI/MCP permissions should be explicit:

```text
☑ Read pages
☑ Read canvas
☑ Search workspace
☑ Create blocks
☑ Create pages

☐ Modify existing blocks
☐ Delete blocks
☐ Move objects
☐ Access external MCP sources
☐ Send content to AI provider (in-app AI)
```

For cloud deployments, permission checks must happen server-side. Destructive actions require confirmation or an equivalent explicit authorization model.

In-app AI actions (Visualize, Summarize, …) are additive and reviewable by design: they create a pending change set and never modify or delete existing objects without an explicit user Accept. MCP `render_visual_plan` requires the "Create blocks" permission and also goes through review.

## 13.17 Local-first + AI

AI is an asynchronous computation over structured local state. It must never become a prerequisite for basic editing, local persistence, or canvas rendering.

```text
Acute-Notes
     │
     ├── Local state → IndexedDB / Yjs
     ├── Local deterministic processing (parser, local planner, renderer)
     ├── Optional AI provider (user's subscription, own key, or local model)
     └── Optional MCP layer
```

With AI off, Visualize still works for content whose structure is already explicit (tier 1). Where possible, AI calls stay on the user's machine until they reach the user's provider, by running the AI host locally (§13.15.13).

## 13.18 AI/MCP delivery phases

### AI Phase 1 — Scoped in-app AI, user-owned AI access, and Visualize

- AI runtime + `AIProviderManager` + task routing + MockProvider (F26)
- `CopilotProvider` on the GitHub Copilot SDK + AI host (F35): Copilot subscription and Copilot-SDK BYOK
- AI connections settings, credential storage, Test Connection, explicit fallback (F27)
- Connection validation (F36): offer only the connections that pass through the Copilot SDK
- Ask AI on selection
- Summarize canvas
- Convert selection to TODOs
- Generate table
- Create page
- Find related objects
- `✨ Visualize` Content-to-Canvas with the initial template set (F28–F31)

### AI Phase 1b — Cost and format extensions

- Model selection, capability detection, and usage display across all connections
- Optional decision model behind a feature flag (F32)
- Mermaid import and convert-to-native (F33)

### AI Phase 1c — Non-destructive updates

- Content-source versioning and extended provenance (F37)
- Reconciliation engine: scoped re-analysis, node matching, conflict classification (F38)
- "Update from new content" review/merge UX, extending F19 (F39)

### AI Phase 2 — MCP server

- read resources
- typed tools, including `render_visual_plan`
- Repo Map over MCP: an IDE agent maps a repository onto a canvas incrementally, at no model cost to Acute (F43)
- prompts
- current-context resource
- explicit write permissions

### AI Phase 3 — Spatial agent operations

- arrange canvas
- create relationships
- organize sections
- review/accept transactions

### AI Phase 4 — MCP host / external sources

- GitHub
- Slack
- Linear
- Drive / OneDrive
- other MCP-compatible systems

### AI Phase 5 — Advanced / enterprise

- long-running tasks
- scheduled agents
- organization-wide AI permissions
- audit history
- model/provider policies
- additional providers (OpenRouter, other OpenAI-compatible APIs, enterprise providers, future subscription-based or agent SDKs) as new adapters only
- managed AI gateway and credits — deferred, not planned (F34, §13.15.14)

Beyond these phases: `ai-future-workflow-enhancements.md` tracks not-currently-planned, learning/understanding-oriented user flows (progressive learning, multi-source "learning journeys," verifying AI output, resurfacing past decisions, one-source-to-many-outputs) and the incremental architecture upgrades — mostly additive registry entries, plus one deliberate future "Understanding Layer" phase — that would support them without reworking Phase 5's foundations.

# 14. Cloud Authorization Model

Future permissions should be based on workspace membership.

Minimal roles:

```text
Owner
Editor
Viewer
```

Potential later role:

```text
Commenter
```

Page-level permission should not be implemented until workspace-level permissions are stable unless a real use case demands it.

---

# 15. Offline / Sync Edge Cases

The cloud-ready architecture must anticipate:

1. User makes changes offline.
2. User opens the same workspace on a second device.
3. Two devices edit the same page before either reconnects.
4. A browser tab is closed during a write.
5. A user loses connectivity during a large asset upload.
6. A sync connection reconnects after a long offline period.
7. The server has a newer snapshot than the local device.

Desired principle:

> Local edits should not disappear merely because the network is unavailable.

Yjs/CRDT state and incremental updates should be the primary mechanism for merging collaborative document changes, with snapshots used for recovery/compaction rather than as a simplistic conflict winner.

---

# 16. Security Considerations for Future Cloud

MVP is local-only, but implementation should avoid security dead ends.

Do not:

- bake a cloud secret into browser code
- assume an object ID is a permission grant
- trust client-supplied workspace membership
- make storage bucket paths public by default
- store access tokens in canvas documents
- store BYOK API keys or GitHub/OAuth tokens in workspace documents, Yjs state, exports, sync payloads, MCP resources, logs, telemetry, or plaintext server-side databases
- introduce an Acute-Notes-owned LLM key for normal user AI operations
- let the Copilot SDK's built-in CLI tools (shell, file system) run in the AI host, or let the server's own GitHub identity serve user requests
- scrape CLI credential files, extract consumer subscription tokens, or call undocumented provider endpoints
- proxy user AI content through Acute-Notes servers when a direct or local-host path is possible
- render model output as HTML without sanitization (treat all AI text as untrusted content)
- let model output choose arbitrary URLs, scripts, or asset fetches during rendering
- treat instructions inside pasted/imported content as commands (prompt injection): content being visualized is data, and AI output can only become a validated `VisualPlan` or change set

Future server must validate:

```text
user → workspace → permission → document → update
```

Asset URLs should be private/signed where appropriate.

---

# 17. Testing Strategy

## 17.1 Unit tests

Test:

- object creation
- object transformations
- serialization/deserialization
- schema migrations
- repository interfaces
- command transactions
- undo/redo
- page references
- asset references
- `VisualPlan` validation and sanitization (valid, malformed, oversized, dangling relationships)
- template conformance for every template
- deterministic renderer geometry (same plan → same layout; snapshot per template)
- Content Parser output and local-planner tier for Markdown fixtures
- task routing and every fallback path (no decision model, decision-model error/timeout/low confidence; primary failure with fallback off → no other provider called; fallback on → fallback used and reported)
- structured-output repair retry and final failure
- provider adapter contract tests (each adapter against a recorded/mock SDK layer); the same provider-neutral suite runs live for the F36 validation matrix with local credentials
- Copilot host hardening: no built-in CLI tool can run; server mode rejects missing per-user tokens and never uses the host's own GitHub login
- secret-leak tests: keys and tokens absent from exports, Yjs updates, MCP payloads, AI host logs
- `ReconciliationPlan` classification (no change, add-only, remove-only, clean update, conflicting update, mixed) against fixed fingerprint/content fixtures
- `stableKey` matching across a regenerated `VisualPlan`, including the structural fallback when `stableKey` is absent

## 17.2 Integration tests

Test:

- create canvas object → reload → object exists
- create BlockNote block → reload → content exists
- create page preview → open page → edit → return → preview updates
- table edit → reload
- TODO edit → reload
- code block → reload
- image insert → reload
- offline editing throughout a workspace
- Visualize with `MockProvider` → review → accept → reload → all objects exist and are editable
- Visualize → accept → single undo removes everything created
- Visualize → cancel mid-request → no objects created, no partial state
- AI mode Off → no `✨` entry points and no AI network requests
- AI-created objects behave identically to manual ones (move, edit, search, export, MCP read)
- edit an AI-created block → "Update from new content" with changed source → the block is classified `update_conflict` and is never overwritten without an explicit Apply
- unedited AI-created blocks → "Update from new content" → clean updates apply as one transaction; unrelated unchanged sections trigger no AI re-analysis (assert on the AI task's input)

## 17.3 Performance tests

Create synthetic workspaces containing:

- 100 canvas objects
- 500 canvas objects
- 1,000 canvas objects
- 25 rich blocks
- 50 rich blocks
- 100 page previews
- multiple images

Measure:

- initial load
- pan FPS
- zoom FPS
- object drag latency
- active editor latency
- memory usage
- persistence time
- pan/zoom FPS while an AI request (mock with artificial latency) is in flight
- preview and accept time for 10 / 25 / 50-node VisualPlans
- parse time for 10 KB / 100 KB Markdown inputs
- initial bundle size with and without AI configured (AI code must be lazy)
- `ContentSourceVersion` diff + reconciliation match/classify time for 10 / 25 / 50-node canvases
- pan/zoom FPS while a reconciliation run (diff + AI re-analysis of changed spans) is in flight
- AI task input size when only 1 of 10 sections changed (must exclude the other 9)

Do not optimize based on guesses. Profile.

---

# 18. Accessibility

Maintain:

- keyboard navigation for toolbar controls
- visible focus states
- accessible names for icon-only buttons
- sufficient contrast
- Escape behavior
- screen-reader labels for major controls

Canvas itself is inherently visual, but page/content editing must remain accessible.

---

# 19. Visual Design Rules

## Do

- lots of whitespace
- muted background
- compact toolbar
- rounded controls
- subtle borders
- contextual controls
- small iconography
- selected tool highlighted with a light accent
- side panel similar to Excalidraw's proportions
- content blocks can have gentle backgrounds

## Do not

- add persistent complex dashboards
- put a giant editor toolbar at the top
- make every object look like a card
- use strong shadows everywhere
- create ten layers of navigation
- add AI buttons to every block
- auto-run AI on paste or open
- block the canvas with modal AI spinners
- let AI choose arbitrary colors or styles outside the theme
- add database configuration panels in MVP

The product should feel like:

> **“I opened a blank canvas and started thinking.”**

not:

> **“I opened a productivity suite and need to configure it.”**

---

# 20. Suggested Component Architecture

```text
src/
├── app/
│   ├── page.tsx
│   └── workspace/
│       └── [workspaceId]/
│           └── page.tsx
│
├── components/
│   ├── shell/
│   ├── toolbar/
│   ├── properties/
│   ├── canvas/
│   ├── blocks/
│   │   ├── RichBlock.tsx
│   │   ├── PagePreview.tsx
│   │   ├── TodoBlock.tsx
│   │   ├── TableBlock.tsx
│   │   └── CodeBlock.tsx
│   ├── pages/
│   └── common/
│
├── domain/
│   ├── canvas/
│   ├── pages/
│   ├── assets/
│   ├── commands/
│   └── schemas/
│
├── persistence/
│   ├── repositories/
│   ├── indexeddb/
│   └── migrations/
│
├── sync/
│   ├── SyncProvider.ts
│   ├── LocalOnlySyncProvider.ts
│   └── yjs/
│
├── ai/                      # nothing outside ai/ imports providers/
│   ├── runtime/             # AIRuntime, task registry, routing + fallback policy, AIUsage
│   ├── providers/           # AIProvider, AIProviderManager, registry.ts (one line per adapter), AuthFlow, CredentialStore
│   │   ├── copilot/         # CopilotProvider client adapter + descriptors (Copilot, OpenAI, Azure, Anthropic, Ollama, …)
│   │   └── mock/            # MockProvider
│   ├── host/                # Node-only AI host behind the HostRuntime interface
│   │   └── copilot/         # CopilotHostRuntime — the only importer of @github/copilot-sdk (F35)
│   ├── settings/            # AISettingsRepository, credential storage (device-local)
│   ├── content/             # Content Parser, local planner (F28)
│   ├── visual-plan/         # VisualPlan schema, template registry, validation (F29)
│   ├── renderer/            # deterministic layout → domain change set (F30)
│   ├── visualize/           # Visualize workflow orchestration (F31)
│   ├── reconcile/           # ContentSource diff, node matching, ReconciliationPlan (F37–F38)
│   ├── mermaid/             # Mermaid → VisualPlan (F33, lazy)
│   └── context/             # AIContextProvider, bounded serializers
│
├── mcp/                     # MCP server boundary (F20/F21), reuses ai/visual-plan + ai/renderer
│
└── performance/
    ├── metrics.ts
    └── profiling.ts
```

The exact path structure can change, but keep boundaries close to this model.

---

# 21. Coding Agent Global Rules

Paste the following as the **global instruction** before asking Claude Code to implement individual features.

> ## Acute-Notes implementation rules
>
> You are implementing Acute-Notes, a canvas-first local-first workspace. Treat this PRD as the source of truth.
>
> ### Product behavior
> - Preserve the simplicity of Excalidraw.
> - The canvas is the primary interface.
> - Use a compact top toolbar and contextual properties panel.
> - Do not turn the app into a Notion clone.
> - Do not add features that are not required by the PRD.
> - Rich content lives inside blocks/pages, not inside the main canvas toolbar.
>
> ### Technology
> - React + TypeScript.
> - Use Excalidraw for the canvas foundation where practical.
> - Use BlockNote core for rich content.
> - Avoid BlockNote XL packages unless licensing is explicitly approved.
> - Use Yjs as the synchronization-ready document abstraction.
> - Use y-indexeddb/local IndexedDB for local persistence.
> - Use shadcn/ui for small application controls.
>
> ### Performance is the top priority
> - Never block the UI on persistence.
> - Never block the UI on network operations.
> - Do not update the whole React component tree on pointermove.
> - Do not create a BlockNote editor instance for every inactive block.
> - Do not serialize the entire workspace for every minor change.
> - Coalesce drag/resize/property history operations.
> - Use requestAnimationFrame/imperative transforms where appropriate.
> - Lazy-load heavy code/highlighting features.
> - Use lightweight previews for inactive rich blocks and pages.
> - Profile before introducing architectural complexity.
>
> ### Local-first
> - Every edit must work without network access.
> - Local persistence happens asynchronously and reliably.
> - Cloud synchronization must later be replaceable/injectable through a provider interface.
> - UI components must not know whether persistence is local or remote.
>
> ### Data architecture
> - Keep canvas geometry separate from rich content.
> - Rich canvas blocks reference document IDs.
> - Page previews reference page IDs.
> - Image objects reference asset IDs.
> - Do not embed binary assets in normal document state.
>
> ### UX
> - Follow the provided Excalidraw screenshots closely for toolbar placement, compact controls, side-panel proportions, and selected states.
> - Minimal is better than configurable.
> - Add options only when the user cannot accomplish a required task without them.
> - Escape should always provide an obvious way out of editing/selection.
>
> ### Engineering quality
> - Use strict TypeScript.
> - Keep domain logic testable without a browser.
> - Add schema versioning from day one.
> - Add unit tests for state transitions and serialization.
> - Add integration tests for persistence and reload.
> - Do not leave dead experiments or duplicate state stores.
> - Keep components small and purpose-specific.
> - Do not hide architectural decisions inside UI components.
>
> ### Before adding a dependency
> 1. Check whether the requirement can be met with an existing dependency.
> 2. Check package license.
> 3. Check bundle/runtime impact.
> 4. Check maintenance/activity.
> 5. Prefer small dependencies.
>
> ### AI/MCP rules
> - AI is optional and must never be required for core editing.
> - Never put AI logic directly inside canvas rendering components.
> - AI context is selection-first and scope-limited.
> - AI must operate through the same domain commands as the human UI.
> - Group AI mutations into reviewable transactions.
> - Keep provenance for AI-generated/imported content when practical.
> - Do not silently overwrite or delete user content.
> - Do not expose arbitrary database mutation through MCP.
> - MCP resources are for structured read context; MCP tools perform explicit actions.
> - External MCP sources must be behind provider/adapter boundaries.
> - Do not add a vector database just because AI search may need one later. Start with local search and measure.
> - Never introduce an Acute-Notes-owned LLM key for normal user AI operations. Users bring their own subscription, key, or local model.
> - User secrets (BYOK keys, GitHub/OAuth tokens) are stored per §13.15.13 and never enter documents, sync, exports, MCP, logs, or plaintext server-side storage.
> - Use only officially supported SDKs and auth flows. The GitHub Copilot SDK is the only adapter for now; run it only in the AI host with all built-in CLI tools disabled.
> - Keep adapters modular per §13.15.12 (one folder per adapter, one registry line, descriptor-driven settings, pluggable `AuthFlow`, provider-neutral host routes and types) so future Claude/ChatGPT subscription adapters need no refactoring.
> - **Acute-Notes owns the visual language and object model; AI providers only supply intelligence.**
> - Application code calls `ai.run(task, input)`. No provider/vendor names, SDK imports, or `if (provider === ...)` branches outside `src/ai/providers/` and `src/ai/host/`.
> - Model output must be schema-validated before use. For canvas output, models produce a `VisualPlan` or declarative change set only — never React, Excalidraw, BlockNote, or persistence state.
> - Layout, IDs, sizes, and styling of AI results are decided by deterministic application code.
> - AI-created objects use the same domain commands as manual creation; no behavior branches on `createdBy`.
> - The decision model is optional; everything must work with only a primary provider, and core editing must work with no provider.
> - Never silently route content to a different provider. Fallback happens only when the user configured it, and the UI says when it happened.
> - Build and test AI features against `MockProvider` first.
> - Re-running Visualize on updated content must reconcile with existing objects (F37–F39): match by stable identity, never silently overwrite an object the user has edited since AI created it, and always route through review.
> - Only re-analyze the source spans that actually changed — never resend or regenerate unaffected content. Keep diffing, matching, and re-analysis off the canvas interaction path (§13.15.21).
> - Store only a bounded baseline snapshot per AI-derived object for 3-way diffing — do not build a general version-history feature (deferred, §3.2).
>
> ### Implementation style
> For each task:
> 1. Inspect the existing repository before editing.
> 2. Reuse existing patterns where sensible.
> 3. Implement the smallest coherent change.
> 4. Run tests/typecheck/lint.
> 5. Measure or sanity-check performance for interaction-heavy changes.
> 6. Do not implement future cloud features prematurely.

---

# 22. Recommended Implementation Order

Build in the following order.

```text
Phase 1 — Foundation
    F01 App shell
    F02 Canvas engine
    F03 Simple text

Phase 2 — Rich content
    F04 Rich block bridge
    F05 Rich text
    F06 Todo
    F07 Table
    F08 Code
    F09 Page preview

Phase 3 — Reliability
    F10 Images
    F11 Properties panel
    F12 Undo/redo
    F13 Local persistence
    F14 Yjs boundary
    F15 Shortcuts
    F16 Page navigation
    F17 Export/import

Phase 4 — Performance hardening
    synthetic large workspace tests
    profiling
    lazy loading
    preview virtualization
    persistence optimization

Phase 5 — AI / MCP integration (after the core editor is stable)
    F26 AI runtime, AIProviderManager, task routing, MockProvider
    F35 GitHub Copilot SDK provider + AI host
    F27 AI Providers settings, credential storage, explicit fallback
    F36 connection validation + shared contract tests
    F18 AI selection actions
    F19 AI action transactions/review
    F25 provenance/current-context resource
    F28 Content Parser + local planner
    F29 VisualPlan schema, templates, validation
    F30 deterministic VisualPlan renderer
    F31 ✨ Visualize end-to-end
    F20 MCP resources/server boundary
    F21 MCP tools (incl. render_visual_plan)
    F22 local semantic/metadata search
    F23 semantic canvas relationships

Phase 5b — AI cost/format extensions
    F32 optional decision model (feature flag)
    F33 Mermaid import / convert-to-native

Phase 5c — Non-destructive updates
    F37 content source versioning + extended provenance
    F38 reconciliation engine (diff, match, classify)
    F39 "update from new content" review/merge UX

Phase 6 — External AI/MCP ecosystem integrations
    F24 MCP host boundary
    external GitHub/Slack/Linear/Drive/OneDrive connectors

Not planned — Managed AI
    F34 managed AI gateway + credits (deferred; see §13.15.14)
```

F26 comes first in Phase 5 because every other AI feature depends on it. F35 follows so a real provider exists early; F36 decides which connections are offered. F28–F30 can be built and tested with no real provider (local planner + `MockProvider`).

Do not start Phase 4 by prematurely adding advanced caching or workers before measuring.

---

# 23. Definition of Done for MVP

Acute-Notes MVP is complete when a user can reproduce the structure of the supplied reference screenshot using only native objects.

A user must be able to create on one canvas:

- simple labels
- headings
- paragraphs
- numbered lists
- TODOs
- a real table
- a real code block
- images
- arrows
- lines
- shapes
- a linked page preview

and all of them must:

- move around the canvas
- remain editable
- survive page reload
- work offline
- support undo/redo appropriately
- remain responsive

The UI must still feel visually and interaction-wise like a simple Excalidraw canvas rather than a heavy document management system.

### AI/MCP readiness

The core MVP is also structurally AI-ready when:

- every object/page has a stable ID
- semantic relationships are representable
- domain commands can be invoked without UI coupling
- workspace/canvas/page content can be serialized into bounded structured context
- AI/MCP functionality can be added through provider boundaries without changing the core canvas model
- every object type is creatable through a domain command usable by UI, AI, import, and MCP alike

Functional AI/MCP features may be shipped immediately after the editor MVP, but they must not compromise local-first performance or simplicity.

### First AI release — done when

- A user can connect GitHub Copilot with their own subscription through the official GitHub Copilot SDK, pass Test Connection, and disconnect.
- A user can connect an API-key provider (OpenAI, Azure, Anthropic) and, in local host mode, Ollama — all through the Copilot SDK.
- `@github/copilot-sdk` is the only provider SDK in the dependency tree, and adding a future adapter needs only a new folder plus one line in `registry.ts` (verified by a placeholder test adapter).
- The UI shows for every connection whether usage comes from a subscription, the user's API key, or local inference.
- With fallback off, a failing primary never causes a request to another provider; with fallback on, the fallback is announced.
- No Acute-Notes-owned LLM key exists in the codebase or deployment.
- Pasting a large Markdown AI response and choosing `✨ Visualize` produces a reviewable change set of native objects for each of the 8 initial templates, and Accept creates them as one undoable transaction.
- Visualize works in structure-only mode with no provider configured.
- The canvas stays interactive during every AI request, and every request can be cancelled.
- No provider-specific code exists outside `src/ai/providers/` and `src/ai/host/`; swapping providers requires no other change.
- Keys and tokens never appear in exports, sync payloads, Yjs state, MCP resources, or logs (automated tests).
- AI-created objects are indistinguishable from manual ones in editing, search, export, and MCP.
- Re-running Visualize on changed content never silently overwrites a block the user has edited: matched blocks the user touched surface as a reviewable conflict (Apply / Keep mine / View diff), and clean updates apply as one transaction.
- Reconciliation re-analyzes only changed source spans, and diffing/matching/AI re-analysis run with no measurable canvas frame-rate impact (§13.15.21).

---

# 24. Future Cloud Milestones

After MVP, cloud support can be layered in approximately this order:

## Cloud Phase 1 — Account + Backup

- authentication
- user profile
- workspace sync
- cloud snapshots
- restore device from cloud
- server-hosted AI host with per-user GitHub OAuth for Copilot (F35 Mode B) — BYOK keys stay device-local and are never persisted server-side

## Cloud Phase 2 — Multi-device

- incremental Yjs update synchronization
- reconnect/queue behavior
- conflict-safe offline synchronization

## Cloud Phase 3 — Collaboration

- workspace members
- viewer/editor roles
- WebSocket sync
- cursors/presence
- selection indicators

## Cloud Phase 4 — Sharing

- share links
- public read-only canvas
- page sharing
- permissions

## Cloud Phase 5 — Enterprise / advanced

- version history
- audit log
- SSO
- organization workspaces
- retention
- admin policies

Optional AI/MCP additions at this stage:

- organization-wide MCP policies
- model/provider allowlists
- AI audit history
- agent execution controls
- external connector governance

---

# 25. Cloud Provider Decision Guidance

The application should not hard-code a provider into the domain model.

Use interfaces like:

```text
ObjectStorageProvider
├── S3Provider
├── GCSProvider
├── AzureBlobProvider
└── R2Provider
```

and optionally:

```text
ExternalFileConnector
├── GoogleDriveConnector
└── OneDriveConnector
```

### Practical future choices

| Provider | Best role in Acute-Notes | Notes |
|---|---|---|
| AWS S3 | Primary object storage | Standard choice for AWS deployment |
| Google Cloud Storage | Primary object storage | Natural fit for GCP ecosystem |
| Azure Blob Storage | Primary object storage | Natural fit for Microsoft ecosystem |
| Cloudflare R2 | Primary object storage | S3-compatible and designed to reduce egress costs |
| Google Drive | User-owned file/export integration | Useful for user-controlled backup/export, not live CRDT authority |
| OneDrive / SharePoint | User-owned file/export integration | Microsoft Graph exposes file APIs and change tracking mechanisms |

### Recommended portable format

Use:

```text
.acute.json        → single-file export for small workspaces
.acute.zip         → full portable workspace bundle for larger projects
```

Internally the bundle can contain canonical JSON plus Markdown pages and binary assets.

### Recommended live-sync format

Use:

```text
Yjs updates / Y.Doc state
```

not Markdown.

Markdown is best treated as a user-facing export/interchange format, while Yjs is the collaboration state mechanism.

---

# 26. Final Product Definition

Acute-Notes is not trying to be “Notion with a whiteboard.”

It is:

> **A fast infinite canvas where anything can become a real piece of structured content — and where humans and AI agents can operate on the same objects.**

> **Acute-Notes owns the visual language and object model; AI providers only supply intelligence.**

The essential experience is:

```text
                 THINK
                   ↓
              Infinite canvas
                   ↓
      ┌────────────┼────────────┐
      ↓            ↓            ↓
    sketch       rich block     arrow
                   ↓
        ┌──────────┼───────────┐
        ↓          ↓           ↓
       list       table       code
                   ↓
                 page
                   ↓
             deep detail
```

The app should feel almost trivial to start using:

```text
Open canvas
   ↓
Draw / type / connect
   ↓
Need structure?
   ↓
Add a block
   ↓
Need depth?
   ↓
Attach a page
```

Everything else is secondary.

---

# 27. Source / Licensing Notes for Implementation

AI/MCP implementation notes:

- Use the official MCP TypeScript SDK for the MCP boundary when implementing server functionality.
- Treat MCP resources, tools, and prompts as separate concepts in the code architecture.
- Do not depend on BlockNote XL AI packages for the core product when strict open-source licensing is required.
- Re-check the licenses of exact installed package versions before production release.
- Mermaid (F33), the Markdown parser (F28), and the schema library (F29) must pass the same license, bundle-size, and maintenance checks as any other dependency, and must be lazy-loaded.
- GitHub Copilot SDK: check the license of the SDK and of the bundled Copilot CLI, and the GitHub Copilot terms for third-party application use, before release. Keep it inside `src/ai/host/copilot/`.
- Provider adapters: prefer thin `fetch`-based clients in the browser. If a vendor SDK is used, check its license and keep it inside its adapter module.
- Review each AI provider's terms (data retention, training use, browser-direct usage, third-party use of consumer subscriptions) before listing it as a connection, and surface material differences in AI Settings.

These sources were checked while preparing this PRD:

- Excalidraw documentation repository license: MIT.
- BlockNote repository/license: majority MPL-2.0; XL packages GPL-3.0, with dual licensing for some use cases.
- Yjs and related projects: MIT.
- y-indexeddb: MIT.
- shadcn/ui: MIT.
- Google Cloud Storage object model / Drive file APIs: Google official documentation.
- Microsoft Graph OneDrive/SharePoint file APIs: Microsoft official documentation.
- Azure Blob Storage: Microsoft official documentation.
- Cloudflare R2: S3-compatible object storage.
- Claude Agent SDK overview (code.claude.com/docs/en/agent-sdk/overview): third-party developers may not offer claude.ai login or rate limits unless previously approved; Claude Help Center article on Agent SDK plan usage notes the change was paused on 2026-06-15 (checked 2026-09-25).
- OpenAI auth docs (learn.chatgpt.com/docs/auth) and Codex plan help article: ChatGPT sign-in is documented for OpenAI's own products only; no third-party subscription auth for developers (checked 2026-09-25).
- GitHub Copilot SDK (`github/copilot-sdk`, docs.github.com Copilot SDK auth/BYOK/OAuth guides): GA; Node/Python/Go/.NET/Java/Rust; per-user GitHub OAuth/App tokens use the user's Copilot subscription; BYOK types `openai`/`azure`/`anthropic` incl. OpenAI-compatible local endpoints (checked 2026-09-25).

**License process requirement:** Re-check the licenses of the exact package versions actually installed before production release, especially when adding optional/XL/editor/export packages.
