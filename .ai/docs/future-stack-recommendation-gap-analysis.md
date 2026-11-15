# Acute-Notes — Stack Recommendation Gap Analysis

**Purpose:** compare an outside "recommended tech stack and user experience" proposal with what Acute already has. For each item, say why we kept our own approach where it differs, and list the real gaps in the order we'll fill them.

**Status:** decisions recorded 2026-10-19 (§6). The gaps follow the order in [pending-work-master-plan.md](pending-work-master-plan.md), which stays authoritative. Two gaps (G2, G3) aren't in the master plan yet and still need a slot.

_Checked against the code and [feature-map.md](feature-map.md) on 2026-10-19._

Related docs: the capability roadmap is in [ai-future-workflow-enhancements.md](ai-future-workflow-enhancements.md) (CAP-01 to CAP-20), MCP is in [acute-mcp-vision-spec.md](acute-mcp-vision-spec.md), cloud sync is in [cloud-sync-plan.md](cloud-sync-plan.md), and the ingest pipeline is in [ingest-service.md](ingest-service.md).

---

## 1. The proposal in brief

**Stack:** React/Next.js or SolidJS for the shell. Tldraw (preferred) or an Excalidraw fork for the canvas. BlockNote or Plate.js for blocks. LangGraph or AutoGen for agent orchestration. FastAPI or Hono/Express for the backend. The official MCP SDK used as a **client**, to reach Notion, GitHub and filesystems. PostgreSQL with pgvector for semantic search. Neo4j or FalkorDB for the relationships between canvas nodes, doc blocks and chat entities.

**Target experience:**

1. Paste a GitHub issue link.
2. An agent reads it through MCP, summarises it, and writes a requirements doc.
3. Ask "how does this affect our architecture?" and get a diagram of the current system with the proposed changes in red.
4. In a side panel, one model (Qwen) writes the code and another (Claude) reviews it.
5. The app ingests both chats and draws a comparison of the two approaches.
6. "Merge to Doc" pushes the final result into Notion.

---

## 2. Stack: what we have and why we differ

✅ = matches, ◐ = same capability by a different route, ❌ = missing.

| Layer | Recommended | What Acute uses | Status | Why we differ |
|---|---|---|:-:|---|
| App shell | React/Next.js or SolidJS | Next.js 16 + React 19. The same build also ships as an Electron desktop app | ✅ | — |
| Canvas | Tldraw (preferred) or an Excalidraw fork | Excalidraw 0.18, patched with `patch-package`. We added custom blocks, pages, frames, knowledge nodes, routed architecture arrows, composite shapes and web embeds | ✅ | **We keep Excalidraw.** A lot is built on Excalidraw's element model: Mermaid → canvas (C11), arrow routing (`ai/changes/routing.ts`), layout checks on proposals (`layoutCheck.ts`), review ghosts, Repo Map and Lens frames. Moving to Tldraw would mean rewriting all of that for a nicer custom-shape API we have already worked around. Tldraw also needs a licence for production use. |
| Block editor | BlockNote or Plate.js | BlockNote 0.55 with Yjs, used for both blocks and pages | ✅ | — |
| Agent orchestration | LangGraph or AutoGen | No framework. One pipeline (`ingestContent`: new / update / merge), a task runtime, decision-model routing (A5), and the ChangeSet review step (S2) | ◐ | **Deliberate.** Two rules shape our AI: (a) every AI write is a reviewed ChangeSet, never a direct edit; (b) the user pays for inference (BYOK), so cost per run matters. The pipeline is mostly deterministic and only calls a model where it has to (see the deterministic-pipeline and chat-import cost work). An open-ended agent loop works against both rules. There's no multi-step tool-using agent yet. Gap G8 adds one only when the connectors need it. |
| Backend | FastAPI (Python) or Hono/Express (Node) | Next.js route handlers (Node), e.g. `src/app/api/ai`, `src/app/api/mcp`, `src/app/api/import`. The MCP server runs **in the browser tab** and Next.js only relays to it | ✅ | Same role. We avoid Python because one TypeScript codebase serves the browser, the Next.js server and Electron. A Python service would add a second runtime to package with the desktop app and a second place where domain types are defined. |
| MCP | Official SDK as an **MCP client** (Notion, GitHub, filesystem) | Official `@modelcontextprotocol/sdk`, but only as an **MCP server** (tool groups M1–M7, plus resources and prompts). No client code exists in `src/` | ❌ | **Not a design choice, a gap** (G1, G6). The server side came first because external agents like Claude Code already read repos and issues on their own subscription. That kept Acute out of the business of reading files or paying for inference. The cost is that Acute's own AI can't pull from or push to other tools. This is CAP-14 in the roadmap. |
| Semantic search | PostgreSQL + pgvector | Local-first storage: IndexedDB in the browser, SQLite in Electron. Search is a lexical token / IDF index (`src/search/workspaceIndex.ts`) with secret redaction. Ask AI context is capped at 16,000 chars | ◐ / ❌ | **We keep local-first storage, but semantic retrieval is a real gap** (G5 / CAP-01). Postgres would mean a server database holding every user's notes. That breaks the local-first, privacy-first model in the cloud-sync plan, which chose Firestore + Cloud Storage for opt-in sync. The index already has an adapter boundary for "a later vector tier" (`workspaceIndex.ts` around line 118), so embeddings can live on the device (in IndexedDB, or sqlite-vec on desktop) and be fused with the keyword index. |
| Relationship graph | Neo4j or FalkorDB | No graph database. Typed relationships (C5) are worked out from arrows on the canvas. Lens builds an in-memory graph for Trace (shortest named path) and Impact (modified / affected / related), across canvases | ◐ | **We keep relationships derived from the canvas.** The arrows are the single source of truth, so a relation can't point at nothing. A separate graph database would be a second copy that has to stay in sync and could drift. Per-workspace graphs are small: Repo Map is tested at 1,500 cards, which is easily traversed in memory. What's actually missing is persisted **provenance links** between chats, sources, doc blocks and canvas nodes (G7). Those fit as tables in the existing store. |

---

## 3. Target experience, step by step

| # | Step | What we have today | Status | Gap |
|---|---|---|:-:|---|
| 1 | Paste a GitHub issue link; an agent reads it via MCP | An external agent (Claude Code, Cursor) can read the issue itself and push it in with `import_content` (M7) or `create_page` (M2). In-app link import supports **ChatGPT share links only** (`src/ai/import/chatShare/providers.ts`) | ◐ | G1 |
| 2 | Summarise into a Notion-like requirements doc | Visualize (A2, 10 templates), Ask AI → Summarize (A1), Pages (C4). All writes go through review | ✅ | — |
| 3 | "How does this affect our architecture?" → diagram with changes in red | Architecture frames (C6), Repo Map from agents (M4), Lens Impact (L3), and Update with dashed ghosts and conflict cards (A3) | ◐ | G2: the pieces exist, but no single action ties them together. G5 is needed once the architecture spans many canvases |
| 4 | Side panel: Qwen writes code, Claude reviews | Ask AI uses **one** AI connection at a time (`AIProviderManager`). Validated: Copilot, Gemini. Wired but not validated: OpenAI, Azure, Anthropic, Ollama, OpenRouter (Qwen would come through Ollama or OpenRouter). Lens design review (L6) gives verdicts on architecture, not on code | ❌ | G3 |
| 5 | Ingest both chats and draw a comparison of the approaches | Topic merge and ChatGPT share import (A4), with "Needs your call" for disagreements and a "Changed over time" page. Visualize has a Comparison template | ◐ | G4: our own in-app chats can't be a source yet (they export only to Markdown), and there's no "approach A vs B" view |
| 6 | "Merge to Doc" pushes the result into Notion | Merging into Acute's own pages works, with review, one-step undo and revert (S2, S3) | ◐ | G6 |

---

## 4. Gap plan, in master-plan order

**How the order was set:** we follow the master plan (decision 1, §6). Each gap is attached to the master-plan item it extends, so it ships with that item and doesn't jump the queue. Two rules apply to every gap: AI never writes without review, and the user pays for inference (BYOK). We also read before we write, because a write to an outside tool can't be undone with Acute's undo.

### Wave 3, item 1: CAP-01 large-context retrieval

#### G5. Semantic retrieval (CAP-01). **First**

- **What:** replace the fixed 16,000-char Ask AI context with chunked retrieval per question. Raise the budget for models with large context windows. Show in the panel what was and wasn't included. If we measure a need for it, add hybrid search: keyword and on-device embedding search run in parallel and are merged by reciprocal-rank fusion (design in acute-mcp-vision-spec §11.3.1).
- **Why first:** the master plan puts CAP-01 first. It is also what makes later gaps work across a whole workspace. "How does this affect our architecture?" (G2) is only useful if the AI can see an architecture spread over many canvases.
- **Design notes:** embeddings stay on the device (IndexedDB in the browser, sqlite-vec on desktop), behind the existing adapter in `workspaceIndex.ts`. There's no server vector database (§2). The embeddings tier comes only after a measured need, as the master plan says. Measure it with workspace-scope architecture questions on the golden-dataset cases.
- **Size:** L.

### Wave 3, item 2: CAP-04 cross-source synthesis with citations

#### G4. Our own chats as a source, and a comparison view

- **What:** a conversation from `ConversationStore` can be used as an ingest source, the same way a ChatGPT share link is. A new **Approach comparison** layout puts two or more sources in columns, lines up matching points, and flags disagreements with the existing "Needs your call" box.
- **Why here:** CAP-04 already plans `find_contradictions` and `extract_claims` across sources. Comparing two chats is one use of those. G4 reuses topic merge (A4) and the Comparison template. Each chat turn already has a stable ID that citations can point at (knowledge-notes plan).
- **Size:** S–M on top of CAP-04.

#### G7. Persisted provenance links

- **What:** store links of the form source ↔ doc block ↔ canvas node ↔ chat turn as rows in the existing store (IndexedDB / SQLite, and later Firestore through sync). Lens and Find related can then answer "where did this come from" and "what else used this source".
- **Why here:** CAP-04 already requires that each derived node is linked `derived_from` / `references` to its source. G7 makes those links durable and queryable, and CAP-08's backlinks panel (item 4) reads them. This replaces the proposal's graph database.
- **Size:** M.

### Wave 4, item 3: CAP-14 external connectors

The connectors stay where the master plan has them: after CAP-16 (sharing) and CAP-15 (vision).

**Shared design for G1 and G6, hosted web build first (decision 2):**

- The MCP client runs in the Next.js server of the hosted App Hosting backend. It connects only to **remote MCP servers that sign in with OAuth**. Local stdio servers (desktop only) come later.
- GitHub and Notion both publish remote MCP servers. Confirm their endpoints, scopes and OAuth client registration when the work starts.
- **Tokens:** decide at kickoff whether OAuth tokens are kept encrypted on the device and sent per request to a stateless relay route, or held server-side per account. The device option matches today's BYOK model and the cloud-sync privacy rules. The server option needs the account work from cloud sync.
- **Prerequisite:** the hosted build currently runs with AI and MCP switched off. They must be turned on for hosted (the rest of cloud stage C1) before connectors can ship there.
- A connector manager (add / remove / test, one token per connector, read and write scopes shown separately) sits next to the existing AI Connections settings.

#### G1. Read from GitHub through an MCP client

- **What:** paste a GitHub issue or PR link (or pick one from a connected repo). Acute fetches it through the GitHub remote MCP server and feeds it through `ingestContent` as a new `ContentSource` origin (`github`), keeping the external ID and URL as provenance (G7). Read-only.
- **Why first among connectors:** the master plan names GitHub issues/PRs first (DEV-14, EM-08), and reading carries no risk to anyone's data. It reuses the ingest pipeline, review, and the M7 cost guard: fetching costs no AI, and summarising previews the cost and asks to confirm.
- **Size:** M (including the shared connector work). **Done when:** on the hosted build, an issue link becomes a reviewed page and diagram whose source card links back to GitHub. Unit tests mock the MCP client; one e2e test runs against a recorded fixture.

#### G6. Push to Notion ("Merge to Doc")

- **What:** **Push to Notion** for a page or an accepted ChangeSet: create a Notion page, or update the one it was pushed to before. It uses the Notion remote MCP server (decision 3).
- **Why after G1:** outside writes can't be reverted from Acute. Every push needs an explicit confirm, a preview of exactly what will be sent, an Agent log entry, and a write scope that is off until the user turns it on. GitHub writes (issue comments, PR descriptions) come after Notion.
- **Size:** M.

### After CAP-14

#### G8. A tool-using agent inside the app

- **What:** a bounded agent loop (plan → call connector tools → propose one ChangeSet) with a step budget, a cost cap and a single review at the end.
- **When:** only once G1 and G6 produce tasks that need several tool calls ("read the issue, its linked PRs and the touched files, then propose"). At that point, compare LangGraph.js with a small in-house loop. Both stay in TypeScript.
- **Size:** M–L.

### Not in the master plan yet: need a slot

#### G2. "Impact on architecture" action

- **What:** from a selected source or page, Ask AI → **Show impact on architecture**. It matches the requirements to nodes in the architecture frames and Repo Map, runs Lens Impact to find affected neighbours, and proposes a ChangeSet. Changed nodes and edges are styled as *proposed* (red or amber), new components appear as ghosts, and a short "what changes and why" page links each change to the requirement it came from. It only touches the frames involved (selection-scope rule).
- **Proposed slot:** Wave 3, right after CAP-01. It needs workspace-scale retrieval (G5) to find the architecture, and otherwise it mostly combines what exists: Lens Impact (L3), the A3 update planner, ChangeSet ghosts and conflict cards. It doesn't need connectors, because a pasted issue or a ChatGPT link works as input before G1 exists.
- **Size:** M.

#### G3. Several models side by side, with roles

- **What:** in Ask AI, run the same prompt on two connections side by side (**Compare**), or chain them (**Author → Reviewer**: model A drafts, model B critiques the draft). The panel shows the cost of each run from the usage log.
- **Which models (decision 4):** only connections that pass the F36 validation matrix can be picked. Today that is GitHub Copilot and Gemini. Qwen (through Ollama or OpenRouter) and Anthropic become available only after they pass F36.
- **Proposed slot:** Wave 3, after CAP-04, so G4 can compare the two answers. The F36 validation runs it depends on are paid AI runs and need approval each time.
- **Size:** M, plus F36 validation per extra provider.

### Summary

| Order | Gap | Master-plan item | Target step | Builds on | Size |
|---|---|---|---|---|---|
| 1 | **G5** Semantic retrieval | Wave 3 #1 CAP-01 | 3 at scale | WorkspaceIndex adapter, context builder | L |
| 2 | **G2** Impact-on-architecture action | *Proposed:* Wave 3, after CAP-01 | 3 | G5, Lens Impact, A3 planner, ChangeSet ghosts | M |
| 3 | **G4** In-app chats as a source + comparison view | Wave 3 #2 CAP-04 | 5 | ConversationStore, topic merge, Comparison template | S–M |
| 3 | **G7** Persisted provenance links | Wave 3 #2 CAP-04 (read by #4 CAP-08) | 5, 6 | Knowledge-notes citations, store | M |
| 4 | **G3** Several validated models, with roles | *Proposed:* Wave 3, after CAP-04 | 4 | AIProviderManager, usage log, F36 matrix | M |
| 5 | **G1** Read GitHub via remote MCP (hosted) | Wave 4 #3 CAP-14 | 1 | Hosted AI/MCP on, ingest service, M7 cost guard | M |
| 6 | **G6** Push to Notion | Wave 4 #3 CAP-14 | 6 | G1 connector work, Agent log | M |
| 7 | **G8** Tool-using agent loop | After CAP-14 | 1–6 end to end | G1, G6 | M–L |

---

## 5. Not adopting, and what would change that

| Recommendation | Decision | We'd reconsider if… |
|---|---|---|
| Tldraw | Keep Excalidraw | Excalidraw upstream blocks a feature we need and the patches can't cover it |
| FastAPI / Python | Stay on Node (Next.js) | We need Python-only ML tooling server-side. Even then, it would be a separate worker, not the main backend |
| PostgreSQL + pgvector | Local store + on-device vectors (G5) | We offer a hosted, server-side search tier that users opt into |
| Neo4j / FalkorDB | Relations derived from the canvas + provenance rows (G7) | Cross-workspace graph queries at a scale the in-memory Lens graph can't handle |
| LangGraph / AutoGen now | Pipeline + review spine; reassess at G8 | Multi-step connector tasks become common (after G1 and G6) |

---

## 6. Decisions

| # | Question | Decision (2026-10-19, user) | Effect on this plan |
|---|---|---|---|
| 1 | Order against the master plan | **Follow the master plan; CAP-01 first** | G5 leads. G1 and G6 stay in Wave 4 with CAP-14. G4 and G7 ship with CAP-04 |
| 2 | Where the MCP client runs first | **Hosted web build**, remote servers with OAuth only | The client lives in the Next.js server. Depends on turning AI and MCP on for hosted. Stdio servers (desktop) come later |
| 3 | First tool to push to | **Notion** | G6 targets the Notion remote MCP server. GitHub writes follow |
| 4 | Models offered for side-by-side runs | **Only connections that pass F36 validation** | G3 offers Copilot and Gemini today. Other providers wait for paid validation runs, which need approval |

**Still open:**

1. Slots for G2 and G3, which aren't in the master plan yet (proposed in §4).
2. Where connector OAuth tokens live: on the device with a stateless relay, or server-side per account (§4, shared design). Decide when CAP-14 starts.
