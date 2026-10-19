# AFFiNE's MCP compared with Acute's MCP plan

**Status:** Competitive research, for planning. Sources: AFFiNE's open-source repo (`toeverything/AFFiNE`, `canary`
branch, read 2026-10-03), its PRs and issues, its release notes, and its MCP product page
(https://affine.pro/mcp, dated 2026-08-20). I did not check docs.affine.pro. Anything not confirmed is marked
*unverified*. Where the product page and the code disagree, both are given.

**What we compare against:**
- [`../acute-mcp-vision-spec.md`](../acute-mcp-vision-spec.md): the product direction.
- [`../acute-lens-plan.md`](../acute-lens-plan.md): the build plan. Its build order is D51: 0 → 1A-i → 1A-ii → **6 → 7A → 7B → 7C** → 1B → 2 → 3 → 4 → 5.
- What Acute's code ships today (`src/mcp/*`).

"Planned" means designed and phased in the lens plan, not built.

---

## Lessons for Acute

Each point below follows the same pattern: what AFFiNE does, what Acute should take from it, and where that lands.
The "Status in our plans" labels mean:

- **New:** in no plan yet.
- **Partly:** a plan covers some of it.
- **Covered:** already planned.
- **Avoid:** a lesson in what not to do.

Section numbers like §3 refer to sections of this doc. Locations like "Lens §7.3" or "vision spec §10.4" are other
documents.

### A. Authentication and credentials

| # | What AFFiNE does | What Acute should do | Status in our plans |
|---|---|---|---|
| A1 | One credential per MCP client, each with a label ("Claude Desktop") and the advice "use a separate credential for each MCP client so it can be revoked independently" | Replace the single shared pairing token per device (`mcp/bridge/access.ts`) with one labelled token per client, so revoking Cursor doesn't disconnect Claude Code. Regenerating today's token disconnects every client | **New.** Fits the local bridge now; doesn't need hosting |
| A2 | Read-only or read-write mode **per credential**, read-only by default | Move the read-only switch from the workspace (`setMcpReadOnly`) to each token, default read-only. `ToolPolicy` (D41) is already the right place to check it | **New** |
| A3 | Only a SHA-256 hash and a 12-character fingerprint are stored; the token is shown once ("You won't be able to see it again") | Store a hash, not the token; show it once; list tokens by fingerprint | **New.** Today the token sits in plain text in local `meta` |
| A4 | Typed, versioned token prefix (`aff_mcp_v1.<uuid>.<secret>`) | Prefix Acute tokens (e.g. `acute_mcp_v1.`), so they're recognisable in logs and secret scanners and the format can change later | **New.** Tiny change |
| A5 | Expiry must be chosen (30/90/365 days); rotation keeps the old token valid for a 24 h grace period; revoking a token revokes its whole family; status `EXPIRING` 7 days before | Adopt the same model when hosting comes; for local use, at least add "last used" and revoke per token | **New** (hosted/auth track, not Lens) |
| A6 | `lastUsedAt` updated at most every 5 minutes | Record last use per token, throttled. It costs little and answers "is this client still connected?" | **New** |
| A7 | Dropping personal access tokens in v0.27 broke the popular third-party server (issue #15251) | **Avoid:** never remove an auth method without a deprecation window. Version tokens and endpoints so they can change without breaking clients | **Avoid** |

### B. Hosting, transport and protocol

| # | What AFFiNE does | What Acute should do | Status in our plans |
|---|---|---|---|
| B1 | Remote server inside the backend, one endpoint per workspace (`/api/workspaces/:id/mcp`); works with no tab open, from any machine | Keep D41's rules (pure `domain/lens`, the `SceneSource` interface, tab-only tools that degrade) so the same tools can move to a hosted endpoint. Plan a path per workspace from the start | **Partly** (D41); hosting itself is deferred |
| B2 | Stateless JSON-RPC over `POST`; batches capped at 20; throttled; the request's `AbortSignal` cancels a tool when the client disconnects | Pass an abort signal into long tools (`get_session_context`, `get_session_review`, Repo Map) so a cancelled agent stops server work; cap batch size; rate-limit when hosted | **New.** Abort is useful even locally |
| B3 | Accepts five protocol versions (2024-10-07 → 2025-11-25) and negotiates in `initialize` | Test against more than one protocol version, so older clients keep working | **New.** Check what the SDK version in use already negotiates |
| B4 | Works with any client that supports remote servers, and documents `mcp-remote` for clients that can't send custom headers | When hosted, document the `mcp-remote` fallback. Locally, note which clients reach a localhost endpoint | **New** (docs) |
| B5 | Removed the MCP SDK and hand-wrote the protocol (PR #14579) | **Avoid** for now: the official SDK keeps Acute current with spec changes; revisit only if it blocks a hosted, stateless deployment | **Avoid** |

### C. Search and retrieval

| # | What AFFiNE does | What Acute should do | Status in our plans |
|---|---|---|---|
| C1 | Keyword and embedding search run in parallel, merged by reciprocal-rank fusion (`1/(60+rank)`), with reranking | Use this as the reference design for CAP-01, the day Acute adds embeddings | **Partly** (CAP-01 tracked, not designed) |
| C2 | Results say which mode ran (`retrieval_mode: hybrid \| lexical \| vector`) and why one was degraded (`VECTOR_UNAVAILABLE`, `LEXICAL_UNAVAILABLE`) | Add `retrieval_mode` / `degraded_reason` to `search_workspace` and `get_session_context` now, even with keyword search only, so agents know how far to trust a miss | **New.** Add to D37 when Phase 7B starts |
| C3 | Hits carry `block_id`, `element_id` and `frame_id` locators, so an agent can point at the exact place in a doc or on a whiteboard | Return element and frame ids (and Lens keys) in `search_workspace` hits, not only the object, so a hit can feed `focus_lens`, `get_related_objects` or a write directly | **New.** Small change to the existing tool |
| C4 | Caps of 3 hits per doc and 20 in total, so one doc can't flood the results | Cap hits per object in `search_workspace` and in `get_session_context`'s keyword pass | **New** |
| C5 | Scoped fallback: if search fails and doc ids were given, return those docs' markdown truncated to ~20k chars in total | `get_session_context` already falls back to open-tab focus (D37); also allow "these keys, truncated to the budget" when ranking finds nothing | **Partly** (D37) |
| C6 | Search indexes whiteboard text, and the product page sells this as its differentiator | Make sure `search_workspace` indexes text inside canvas shapes, frames and arrow labels, not only blocks and pages, and say so in the tool description | **Partly.** Check the current index coverage |

### D. Tool design and payloads

| # | What AFFiNE does | What Acute should do | Status in our plans |
|---|---|---|---|
| D1 | A few tools with long, specific descriptions that state limits ("does NOT update the document title", "never includes files, blobs, attachments, or the web") | Write the limits into every new tool description (§7.3's tools), not only what the tool does. Agents follow negative instructions in descriptions | **Partly** (vision spec §9 layer 2) |
| D2 | Consolidated `keyword_search` and `semantic_search` into one `doc_search` where "retrieval strategy is selected by the server" | Keep one search tool and let the server choose the strategy; don't add a separate semantic tool when CAP-01 lands | **New** (guards CAP-01's design) |
| D3 | Input bounds in the schema (query 1–2000 chars, up to 50 `doc_ids`, `limit` 1–20) | Put explicit bounds in every new tool's zod schema (§7.3), as the existing tools do | **Covered** (existing convention) |
| D4 | `read_document` returns the whole doc with no truncation | **Avoid:** Acute's bounded payloads with `truncated` flags are better. Keep them | **Avoid** |
| D5 | Writes take a whole markdown body (`update_document`) and apply it as a structural diff | **Avoid** as the main write model, because the agent has to resend everything. Acute's per-object writes are better. The structural diff is a good *internal* technique if Acute ever accepts a markdown page rewrite | **Avoid** (as an interface) |

### E. Write safety, attribution and history

These are mostly lessons from what AFFiNE lacks.

| # | What AFFiNE does | What Acute should do | Status in our plans |
|---|---|---|---|
| E1 | Write tools held back on stable since January 2026, still "rolling out progressively" in August | Treat this as evidence that unreviewed agent writes are hard to ship. Keep D6 (every write reviewed) and ship writes on stable *because* they're reviewed | **Covered** (D6) |
| E2 | No review step: MCP writes apply immediately | **Avoid.** Acute's reviewed change sets and opt-in auto-accept with exceptions (D44) are the answer | **Covered** (D6, D44) |
| E3 | Writes are recorded as the credential's human user; no agent identity; metadata left empty (issue #15467) | Record the agent separately from the human (D32), and test that every field is filled on MCP writes. The bug is a reminder to cover attribution with tests | **Covered** (D32, D46); add a test |
| E4 | Writes gated on build channel (`env.dev \|\| canary`), with a query telling the UI whether writes are available (`mcpCredentialReadWriteAvailable`) | Expose capability availability to the UI and to agents (`acute://context/current`'s `availableTools` already does this for policy). Use the same mechanism for anything experimental | **Covered** (existing `availableTools`) |
| E5 | No per-agent change log or revert | Acute's Agent State and revert (D30, D31, 7A) are a differentiator; keep them in the MVP | **Covered** (7A) |

### F. Setup and onboarding

| # | What AFFiNE does | What Acute should do | Status in our plans |
|---|---|---|---|
| F1 | Settings → Integrations → MCP Server, marketed as "3 minutes" | Put MCP in an "Integrations" area with a time-to-connect promise, not buried in workspace settings | **New** (UI) |
| F2 | Create dialog: label, mode, expiry; reveal dialog with copy buttons for the token and a ready `mcpServers` JSON snippet | Give a ready-to-paste config snippet for each client, generated with the endpoint and token filled in | **Partly** (D49 serves instruction files, not the connection config) |
| F3 | Credential list with status, fingerprint, created / last used / expiry, and Rotate and Revoke | Build a token list once A1–A6 exist | **New** |
| F4 | Lists capabilities in the panel ("Read documents", "Keyword search", "Semantic search", "Create and update documents") | Show what a connected agent can do, in plain words, next to the token, reflecting the token's mode | **New** |
| F5 | Only one generic JSON snippet; no client-specific instructions | Acute's per-client `AGENTS.md` / `CLAUDE.md` / Cursor setup (D49) goes further; do both, connection snippet *and* instructions | **Covered** (D49), plus F2 |
| F6 | Hides the MCP panel when the server has AI off (PR #15645), after confused self-hosters (issue #15644) | When a capability is off, hide or explain it ("MCP needs X turned on"), never show a panel that silently fails | **New** (UI rule) |

### G. Canvas and whiteboard

| # | What AFFiNE does | What Acute should do | Status in our plans |
|---|---|---|---|
| G1 | No MCP canvas read or write; users ask for it (issue #14448) | Confirms the canvas is the gap competitors haven't closed. Lead with `get_canvas`, Repo Map and Lens in comparisons | **Covered** (built and planned) |
| G2 | The in-app copilot reads the canvas in bounded steps: "Use overview first, then a frame, element ids, or region… Cursors are revision-bound" (`doc_canvas_read`) | Borrow the pattern for big canvases: an overview first, then drill by frame or region, with a cursor tied to the scene version so a stale page of results is detectable. Fits `get_canvas` and `get_lens` (`around` + depth) | **New** (pagination with revision-bound cursors) |
| G3 | Search locators point into the whiteboard (element, frame) | Same as C3: hits should give canvas locators | **New** (see C3) |

### H. Pricing, packaging and positioning

| # | What AFFiNE does | What Acute should do | Status in our plans |
|---|---|---|---|
| H1 | MCP is free on Cloud and on self-hosted with AI enabled | Confirms vision spec §10.4: don't charge for MCP access; charge for what agents get on top (decisions, history, session context, canvas understanding) | **Covered** (vision spec §10.4) |
| H2 | The pitch is "grounding": an assistant that answers from your notes | **Avoid** sounding like this. Acute's message is about the agent's *work* ("Can you still understand it?") | **Covered** (vision spec §6) |
| H3 | The MCP server lives in the Enterprise-licensed backend, so self-hosting it in production needs a subscription | Decide Acute's licence for a future hosted or self-hosted MCP deliberately and early; AFFiNE's split (MIT app, EE server) is one model | **New** (decision for the hosting track) |
| H4 | A third-party server with 106 tools gained ~290 stars because the official one is thin | A thin official MCP invites a community replacement that breaks on internal changes. Ship a complete enough surface (Phase 7C's CRUD gaps) to stay the default | **Covered** (7C) |

### I. Engineering practice

| # | What AFFiNE does | What Acute should do | Status in our plans |
|---|---|---|---|
| I1 | Credential lifecycle emits events (`mcp.credential.created`, `.rotated`, `.revoked`) | Emit events for token and session lifecycle, so audit, analytics and notifications can hook in later without touching the auth code | **New** |
| I2 | Converts markdown and documents with Rust code exposed to Node, for speed and correctness | Not needed now. Note it if Acute's Yjs ↔ markdown conversion ever becomes a hot path for hosted MCP | **New** (note only) |
| I3 | Open issues show where agents struggle: tables created over MCP come back empty (#15466); tag search requested (#14628) | Add e2e checks for every block kind an agent can create (table, todo, code) that read the result back and check it isn't empty | **New** (tests for 7B/7C) |

### Next steps

Each line starts with where the work belongs.

- **Now, small, local:** A1, A2, A3, A4, A6, B2 (abort signals), C3, C4.
- **When Phase 7B starts:** C2 and C5 (as a dated row refining D37), D1, D2, G2, I3.
- **UI:** F1–F4 and F6.
- **Hosted/auth track:** A5, B1, B3, B4, H3, I1.
- **When CAP-01 starts:** C1.

---

## 0. Comparison at a glance

| Capability | Acute today | Acute planned (phase) | AFFiNE (shipped) | Who's ahead |
|---|---|---|---|---|
| **Where the server runs** | Local only. The open browser tab hosts it through a bridge (`src/mcp/bridge`) | Kept local; designed so it can move to a hosted server later, without building that now (D41) | Hosted, inside the NestJS backend (cloud and self-host), one server per workspace at `/api/workspaces/:id/mcp` | **AFFiNE.** Works with no tab open and from any machine |
| **Transport** | Streamable HTTP, using the official MCP SDK | Same | Hand-written stateless JSON-RPC over `POST` only (SDK removed in PR #14579); batches up to 20 requests | Even. AFFiNE has no SSE stream and no sessions |
| **Authentication** | One pairing token per device, kept in local `meta` (`mcp/bridge/access.ts`) | Same token. OAuth and accounts are deferred (D52, `hosted-deployment-decisions`) | Credentials scoped to a workspace (`aff_mcp_v1.*`): only a SHA-256 hash is stored; 30/90/365-day expiry; rotation with a 24 h grace period; revoke a whole token family; `lastUsedAt` tracking | **AFFiNE.** Proper credential lifecycle. Neither has OAuth |
| **Access modes** | Read-only switch per workspace (`setMcpReadOnly`) | Every new tool goes through `ToolPolicy`; an `entitlement_required` response is defined (D49, D41) | `READ_ONLY` (default) or `READ_WRITE` per credential; the user's own permissions apply per doc | **AFFiNE** on scope per credential; Acute's mode is per workspace |
| **Gating by plan** | None | Response shape only; nothing gated (D49) | **Free**: "Free on AFFiNE Cloud and self-hosted instances with AI features enabled" (product page). Needs Copilot/AI enabled on the server; the backend is under the Enterprise Edition licence | Neither monetizes MCP. AFFiNE uses it as a free hook |
| **Read: documents** | `get_page`, `get_canvas`, `get_selected_content`, `get_related_objects`; resources `acute://workspace,canvas,page,table,todo,context/current` | `get_lens`, `get_project`, `get_implementation_plan`, `get_decisions`, … (3, 7B) | `read_document`: the whole doc as markdown, never truncated | **Acute.** Typed objects, bounded payloads, `truncated` flags |
| **Read: whiteboard / canvas** | `get_canvas` gives objects, kinds, bounds and relations | Lens levels L0–L5 over MCP (3) | **Search only.** Edgeless canvas text is indexed, and hits come back with element and frame locators, which the product page presents as a differentiator. There is no MCP tool that reads canvas structure (shapes, connectors, positions); only the in-app copilot has `doc_canvas_read`. Issue #14448 is open | **Acute**, clearly. AFFiNE can find text on a whiteboard, not read its structure |
| **Search** | `search_workspace`: keyword/IDF, local | No semantic search; that stays CAP-01 (D29) | `doc_search`: keyword plus embeddings run in parallel, reranked, merged by reciprocal-rank fusion, with block, element and frame locators and degraded modes | **AFFiNE**, clearly. Real hybrid semantic search |
| **Write: documents** | `create_page`, `create_block`, `create_table`, `create_todo`, `update_block` | `update_node`, project-profile writes (6, 7B) | `create_document`, `update_document` (markdown with structural diff into Yjs), `update_document_meta` (title only). The product page says these are "rolling out progressively" to workspaces. The code read on 2026-10-03 still limits them to **dev/canary builds**, and users are asking for them on stable (issue #15652). Reconciling the two is *unverified*: the cloud may enable writes per workspace by configuration | **Acute.** Its writes are reviewed and not behind a rollout |
| **Write: canvas** | `create_connection`, `move_object`, `render_visual_plan`, Repo Map tools | `link_lens_detail`, `delete_objects`, `update_connection`, `group_blocks` (3, 7C) | **None** | **Acute** |
| **Delete** | None | `delete_objects`, `delete_connection`: reviewed, never auto-accepted, revertible (7C) | None | Even today; Acute's plan is ahead |
| **Resources / prompts** | 6 resource kinds; 7 prompts plus `map_repo` | Resources scoped to a project; prompts `initialize_project`, `sync_progress`, … (7B) | **Neither.** `initialize` advertises tools only | **Acute** |
| **Server `instructions`** | Yes (`server.ts`) | Extended with the session loop (7B) | No *(unverified; not in the handler)* | **Acute** |
| **Review before a write lands** | Every write is a proposed `ChangeSet` the user accepts or rejects | Same, plus opt-in auto-accept per session that never covers removes, reverts or constraints (D44) | **None.** Writes apply at once | **Acute.** A core difference |
| **Attribution of agent writes** | `createdBy: "mcp"`, session | `agent` (client name), session, tool, reason, outcome (D32, D46) | Recorded as the credential's user; no separate agent identity; metadata fields left empty (issue #15467) | **Acute (planned)** |
| **Change history and revert** | None after a change is applied | `agentChanges` / `agentSessions` stores, History tab, `revert_agent_changes` built from stored inverses (7A) | Ordinary Yjs updates; whether page-history snapshots can revert them is *unverified*; no per-agent log | **Acute (planned)** |
| **Decisions, progress, project state** | None (plain blocks only) | `project`, `decision`, `constraint`, `finding`, `progress_item`, … with warnings (6, 7B) | None | **Acute (planned)**; AFFiNE has nothing here |
| **Session bootstrap / sync** | `acute://context/current` only | `get_session_context` (budgeted), `sync_session` (typed report) (7B) | None | **Acute (planned)** |
| **Context budgeting** | Bounded resources; Ask AI capped at 16k chars | `get_session_context` budget of 3k by default, 8k at most, with a report of what was dropped (D29, D37) | Search capped at 3 hits per doc and 20 in total; ~20k-char fallback cap; `read_document` unbounded | **Acute (planned)** on deliberate budgeting; AFFiNE on retrieval quality |
| **Code / repo awareness** | Repo Map (F43): an agent maps a repo onto a canvas | Lens levels down to source, Trace, Agent Sync (2–4) | None. The only pitch is "Cursor reads your docs" | **Acute** |
| **Setup UX** | Token and switch in settings | Generated `AGENTS.md`/`CLAUDE.md`/Cursor setup via `acute://setup/instructions/{client}` (7B, D49) | Settings → Integrations → MCP Server: label, mode, expiry; copy the token and one generic `mcpServers` JSON snippet; a list with Rotate and Revoke. Marketed as "3 minutes" | **AFFiNE today** (polished credential UI); **Acute's plan** goes further (instructions per client) |
| **Supported clients** | Any MCP client that can reach localhost (Claude Code, Copilot tested) | Same | Claude Code, Cursor, Cline, LobeHub, and "any MCP client that supports remote servers over streamable HTTP". Clients that can't send custom headers use the standard `mcp-remote` bridge | **AFFiNE.** Being remote, it reaches any client; Acute needs a local install |
| **Concurrent agents** | One pending proposal per canvas | Pending sets per session (D40) | Stateless; no conflict model besides Yjs merging | Different models |
| **App as an MCP client** | No | No | No (its copilot uses internal tools) | Even |

**In one line:** AFFiNE is ahead on **infrastructure**: a hosted server, a credential lifecycle, and semantic search.
Acute is ahead on **what an agent can do and how safely**: typed canvas objects, reviewed writes on stable builds,
canvas access, and the planned decision, history and session layer, none of which AFFiNE has.

---

## 1. What AFFiNE ships

Official, built into the backend at `packages/backend/server/src/plugins/copilot/mcp/`:

| File | Role |
|---|---|
| `controller.ts` | The endpoint |
| `provider.ts` | The tools |
| `credential.ts` | The token service |
| `resolver.ts` | GraphQL for managing credentials |

- The data model is `models/mcp-credential.ts`.
- The server is named `AFFiNE MCP Server for Workspace <id>`, version `1.0.1`.
- Protocol versions accepted: 2024-10-07 through 2025-11-25.
- Methods handled: `initialize`, `ping`, `tools/list`, `tools/call`. `GET` and `DELETE` return 405.
- Throttled. A client disconnect cancels the tool call (`AbortSignal`).

It needs `copilot.enabled` on the server. That is off by default on self-hosted installs, and the MCP panel is
hidden when it is off (PR #15645). The backend is under the **AFFiNE Enterprise Edition licence**, not MIT:
production self-hosting needs an EE subscription.

**Pricing:** the product page settles it: MCP is "Free on AFFiNE Cloud and self-hosted instances with AI features
enabled". There is no paid MCP tier; MCP is a free acquisition feature.

**How AFFiNE markets it** (product page, dated 2026-08-20):
- **The pitch is "grounding":** "An assistant that can search your actual notes answers from your knowledge: meeting
  decisions, project context, research."
- **The differentiator it claims:** search reaches whiteboard text, returning "block, element or frame locators, so
  an assistant can point at exactly where on a whiteboard an answer lives".
- **Writes:** described as "rolling out progressively". Read-only stays the default.

A popular unofficial server, `DAWNCR0W/affine-mcp-server` (MIT, about 290 stars), advertises 106 tools over
GraphQL and WebSocket with session-cookie auth. It exists because the official server is so thin, and it broke when
v0.27 dropped personal access tokens (issue #15251).

---

## 2. Tool surface

| Tool | When available | Does |
|---|---|---|
| `read_document(docId)` | always | The whole doc as markdown (`DocReader.getDocMarkdown`) |
| `doc_search(query, doc_ids?, limit?)` | always | "Search persisted workspace documents and return bounded passages with Page or canvas locators." Returns `retrieval_mode` and `degraded_reason`, and `hits[]` each with `doc_id`, `title`, `excerpt`, `block_id`, `element_id`, `frame_id` |
| `create_document(title, content)` | read-write credential **and** a dev/canary build | Markdown → Yjs (Rust, `markdown_to_ydoc.rs`). No database or image blocks |
| `update_document(docId, content)` | same | Full markdown body, applied as a structural diff (`update_ydoc.rs`) |
| `update_document_meta(docId, title)` | same | Title only |

There are no resources and no prompts. The two earlier tools, `keyword_search` and `semantic_search`, were merged
into `doc_search`. A database-row tool was proposed and closed (PR #15369).

**The edgeless whiteboard isn't exposed for reading or writing.** That is the closest overlap with Acute's core
surface, and AFFiNE leaves it open (issue #14448).

---

## 3. Search: the part worth learning from

`plugins/copilot/retrieval/document.ts` runs **keyword (indexer) and embedding search in parallel**:

- **Ranking:** it reranks the embedding hits, then merges both lists by reciprocal-rank fusion (`1/(60+rank)`).
- **Caps:** at most 3 hits per doc and 20 in total.
- **Modes:** it reports `hybrid`, `lexical` or `vector`. When one side is down it says which, with `VECTOR_UNAVAILABLE` or `LEXICAL_UNAVAILABLE`.
- **Fallback:** if both fail and doc ids were given, it falls back to `scoped` mode, which returns the raw markdown of those docs truncated to about 20,000 characters in total.

**What this means for Acute.** Acute's `search_workspace` and `contextBuilder` are keyword/IDF only, and semantic
retrieval is still tracked as CAP-01. Two of AFFiNE's choices are cheap to borrow even without embeddings:

- telling the agent which retrieval mode ran, and why it was degraded;
- returning a locator to the exact element or frame inside a doc, not only the doc.

`get_session_context`'s quality ceiling (D37) is this search step.

---

## 4. Auth and setup: the other part worth learning from

AFFiNE's credential design (PR #15221, v0.27.0) is a good template for when Acute moves to a hosted server:

- **Tokens:** typed and prefixed (`aff_mcp_v1.<uuid>.<secret>`); only the hash and a 12-character fingerprint are stored.
- **Lifetime:** expiry must be chosen (30, 90 or 365 days).
- **Rotation:** the old token keeps working for 24 hours, tracked by generation; revoking one token revokes its whole family.
- **Status:** `ACTIVE` / `ROTATING` / `EXPIRING` / `EXPIRED` / `REVOKED`, and `lastUsedAt` is updated at most every 5 minutes.
- **Per client:** each credential has a label and its own mode, and the UI says "use a separate credential for each MCP client".
- **Shown once:** the token is shown once, with a copy button for a ready `mcpServers` JSON snippet.

**What this means for Acute.** Today Acute has one shared pairing token per device, and regenerating it disconnects
every client (`access.ts`). Even before hosting:

- tokens labelled per client, each with its own read-only/write mode;
- a "last used" time.

Both would fit `ToolPolicy` (D41) and would make D32's agent attribution more trustworthy. Neither is in the lens
plan, and both belong to the hosted/auth track rather than Lens.

---

## 5. What AFFiNE doesn't do, and why it matters for positioning

- **No review step.** Agent writes land immediately, and the editor is recorded as the credential's user. When
  write tools come to stable builds, AFFiNE users get no way to see or approve what an agent changed. Acute's
  reviewed change sets (D6) and planned History/revert (D30, 7A) are a real differentiator, not an incremental one.
- **No agent identity.** Edits made through MCP are recorded as the human user, and some metadata is left empty
  (issue #15467). Acute's plan records the agent, session, tool, reason and outcome (D32, D46).
- **No project memory.** AFFiNE has no decisions, constraints, progress, or session bootstrap/sync. Agents get
  "search and read my notes" and nothing more. This is the vision spec's **Basic MCP** tier (§7) exactly.
- **No canvas for agents.** AFFiNE's whiteboard is invisible over MCP. Acute's canvas, Repo Map and Lens are what
  agents read and write.
- **Writes held back.** Write tools have been dev/canary-only in code since January 2026. The product page (August
  2026) still calls them "rolling out progressively", and users are asking for them on stable (issue #15652). Holding
  them back for this long suggests AFFiNE sees unreviewed agent writes into collaborative docs as risky, which is the
  problem Acute's review path solves.
- **"Decisions" means search hits, not records.** The product page's "meeting decisions, project context" are text
  an assistant can *find*. Nothing is a typed decision an agent can rely on, and nothing warns before a decision is
  contradicted. That is the gap Acute's Project profile (D33–D36) fills.

**Positioning takeaway.** AFFiNE validates the market: a mainstream notes app ships an MCP server, gives it away
free, and users want writes. It also shows where the floor is: read and search docs as markdown. The vision spec's
claim, "Basic MCP connects the agent to Acute; Advanced MCP makes Acute useful to the agent", holds up against
AFFiNE. Its whole MCP surface fits inside the vision spec's free tier.

AFFiNE's free pricing backs the vision spec's §10.4 rule: give away the whole core loop, and don't charge for MCP
access. A competitor already gives "search and read your notes" away. Acute's paid value has to be what AFFiNE
doesn't have, namely decisions, change history, session context and canvas understanding, not the connection itself.

**Messaging overlap to avoid:** AFFiNE's pitch is "grounding: your assistant answers from your notes". If Acute's
launch message sounds like that, it reads as the same product. The vision spec's lines, "Your AI agent can write the
code. Can you still understand it?" and "Give your coding agent a living map of your project", are about the agent's
*work*, not about searching notes. That is the distinction to keep.

---

## 6. Recommendations

Ordered by fit with the current plan:

1. **No change to the lens plan's order (D51).** AFFiNE has no counterpart to Phases 6–7C, which are the
   differentiators. Building them next is the right call against this competitor.
2. **Before Phase 7B ships:** add `retrieval_mode`/`degraded_reason`-style transparency to `get_session_context` and
   `search_workspace` (cheap, works with keyword search), and element/frame locators in search results. A small
   addition to D37; worth a dated decision row when 7B starts.
3. **Hosted/auth track (not Lens):** when hosting is revisited, use AFFiNE's credential model as the starting design:
   - per-client labelled tokens, stored as a hash, with expiry, rotation and revocation;
   - read-only/write mode per token;
   - a copy-JSON setup snippet.

   The `hosted-deployment-decisions` note should point here.
4. **CAP-01 (semantic retrieval):** AFFiNE's hybrid keyword + embedding search with reciprocal-rank fusion is a
   concrete reference design for the day Acute adds embeddings.
5. **Don't copy:** whole-document markdown replacement as the write model (`update_document` takes the full body),
   and writes with no review. Both are the opposite of D5/D6.

---

## Sources

**Code**
- https://github.com/toeverything/AFFiNE/tree/canary/packages/backend/server/src/plugins/copilot/mcp
- `packages/backend/server/src/plugins/copilot/retrieval/document.ts`
- `packages/backend/server/src/core/doc/writer.ts`
- `packages/frontend/core/src/desktop/dialogs/setting/workspace-setting/integration/mcp-server/`

**Pull requests**
- #13298: the basic MCP server
- #13372: access tokens
- #13630: the settings UI
- #14245: write tools
- #14579: refactor, SDK removed
- #15221: MCP credentials
- #15247: token-prefix fix
- #15645: panel hidden when Copilot is off
- #15369: database-row tool, closed

**Issues**
- #14448: canvas positioning
- #15251: third-party server broken by v0.27
- #15467: empty metadata on MCP writes
- #15644: Copilot off by default when self-hosted
- #15652: write tools on stable

**Releases:** v0.24.0, v0.25.0, v0.27.0

**Product page:** https://affine.pro/mcp (dated 2026-08-20): pricing, supported clients, rollout status, positioning

**Third-party server:** https://github.com/DAWNCR0W/affine-mcp-server
