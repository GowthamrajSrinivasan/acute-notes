# Acute Lens — plan

Status: **Decisions locked; Phase 0, 1A-i, 1A-ii, 1B, 6, 7A, 7B, 7C, 2 and 3 done** (2026-10-03; 1B ahead of D51's order
at the user's request, D60; each phase's notes in §9). The agent-setup plan (`agent-setup-plan.md`, D63) was approved
and is implemented by 7B; D55's name review is done (D62); D21 was signed off for Phase 2 (D64). **§10.2's MCP slice
(MC1–MC11) passes its automated checks**; the manual real-agent runs for MC1 and MC10 (D58) stay manual validation for
the MCP MVP release and don't block development. Phases 4 (Agent Sync) and 5 (AI in Lens) are built (2026-10-03); **every phase of D51's order is now built**, the "Later" row (§9) stays deferred. **Scope extended 2026-10-03 (D25–D29)** to bring forward
D1's "profiles (agent, project, incident, knowledge) come later on the same primitive" into two scheduled phases
(6–7, §9) that give MCP agents decision memory, progress tracking and session context/sync — see
`acute-mcp-vision-spec.md` §0 for why. This does not reopen Phases 0–5: it is additive, on the same primitive (D1).
**Scope completed 2026-10-03 (D30–D50, second alignment pass)** after a line-by-line check against the vision spec,
so every MCP feature it plans has a home here or an explicit "not Lens, owned elsewhere" note, and none should need
a redesign of Lens's data model later. Coverage map: §13. **Build order resolved 2026-10-03 (D51–D52, third pass):**
MCP-first — 6 → 7A → 7B → 7C run next, ahead of 1B and Repo Map/Trace/Agent Sync/AI (2–5) — closing open question 4
in the direction the vision spec argued for, without redoing the viewer work already built.
Requirements: this plan is the source of truth (the PRD it was adapted from, `acute-lens-prd.md`, is not kept
up to date — where they differ, this plan wins). Builds on
[`interactive-architecture-frames-plan.md`](./interactive-architecture-frames-plan.md) (Phases 1–2 done) and F43 Repo
Map (tracker §F43, master plan Wave 1b). Scope extension requirements:
[`acute-mcp-vision-spec.md`](./acute-mcp-vision-spec.md), specifically §0's readiness gaps and §3/§9/§10.2's MCP
primitives.

> **Canvas shows what you know. Lens lets you see deeper into it.**
>
> Lens is not another source of truth. Lens is a different way of seeing the source of truth.

## Decision log

Locked 2026-09-30 from the plan review. Change a locked decision only with a new dated row that supersedes it (keep
the old one). "Where" points to the section that implements it.

| # | Decision | Status | Why | Where |
|---|---|---|---|---|
| D1 | The feature is named **Acute Lens**. The architecture lens is its first **profile**; profiles (agent, project, incident, knowledge) come later on the same primitive. | Locked | Doesn't lock the product into architecture; one primitive, many lenses. | §3.4 |
| D2 | **The canvas (Excalidraw + Yjs) is the only canonical state.** Accepted Repo Map results live on the canvas (`stableNodeKey`, `sourceRefs`); the Repo Map record is a device-local index and cache, never a fact source. | Locked | One store means Canvas, Lens and AI can't disagree. The record isn't synced, so it can't be canonical. | §2 |
| D3 | **Pending change sets are proposed state.** Lens shows current (canonical) plus pending (proposed) and never blends them. | Locked | Makes Agent Sync easy to reason about; nothing an agent sends is true until accepted. | §2, §8 |
| D4 | **Lens is a separate, read-mostly view with its own SVG renderer**, not a second Excalidraw canvas. It shares kind and relation styles, routing, the passport card and highlight with the canvas overlay. | Locked | Avoids "Excalidraw inside Excalidraw"; the two surfaces still feel like one product. | §5.2 |
| D5 | **Lens is never the updater.** Every change goes Human or MCP → ChangeSet (review) → Canvas → Lens. Lens only calls existing canvas commands for small manual links, or proposes a change set. | Locked | Two write paths would create two truths. | §2 |
| D6 | **AI and MCP never write the canvas silently.** Every generated or synced change is a reviewed ChangeSet. | Locked | Trust. | §2, §6, §8 |
| D7 | **Generated deeper levels go to a companion Detail Canvas** ("<canvas> · detail"), which the user can edit like any canvas. Frames the user draws stay wherever they put them. | Locked | Keeps the user's arranged canvas clean; detail stays editable, not "generated". | §6.3 |
| D8 | **User geometry wins.** Lens reuses a frame's canvas layout; auto layout only for levels with no canvas geometry. | Locked | The spatial arrangement carries meaning. | §5.2 |
| D9 | **One global relationship vocabulary:** `calls`, `reads`, `writes`, `publishes`, `subscribes`, `contains` join `RELATION_TYPES` (canvas, Lens, Repo Map, MCP, Mermaid). | Locked | Trace, impact, AI context and docs all read one model. | §3.2 |
| D10 | **Levels belong to a profile.** The architecture profile is L0 System · L1 Architecture · L2 Component · L3 Flow · L4 Operation · L5 Source; the engine only knows "level n of profile p". | Locked | Other lenses name their levels differently; only the abstraction is built now. | §3.4 |
| D11 | **Semantic zoom and visual zoom are separate** and shown separately: `L2 Component` (semantic) beside `− 100% +` (visual). | Locked | The core interaction must never be confused with scaling. | §5.2 |
| D12 | **Every level has a canonical representation:** L0–L4 are canvas frames and nodes; L5 is source evidence attached to an L4 node (plus an optional code node). Nothing Lens shows as fact is Lens-only. | Locked | Follows D2 at every depth. | §3.1, §3.3 |
| D13 | **Every node has a stable semantic identity** (§3.1.1), not only an element id. | Locked | Rename ≠ delete + create; needed before agents keep L0–L5 current. | §3.1.1 |
| D14 | **Continuous Architecture Sync:** agents update the hierarchy incrementally through the existing Repo Map tools and change sets, by stable key, with provenance; Acute reports which ancestors a change may affect. No new sync tool in the MVP; the contract is designed so one can batch it later. | Locked | Lens reflects code as it evolves without claiming to watch files. | §8 |
| D15 | **"Live" is agent-driven** and the UI says **● Agent Sync** ("Your IDE agent is keeping this architecture current · updated 12 s ago"). No browser file watcher. | Locked | Honest wording; "Live" only once the infrastructure earns it. | §8 |
| D16 | **Trace and Evidence are first-class node actions** (beside Zoom in and Explain), not tabs. | Locked | They're what makes Lens useful rather than pretty. | §5.2 |
| D17 | **Lens and the page panel share one right-hand slot.** | Locked | One reading surface at a time; "← Back to Lens" restores the position. | §5.1 |
| D18 | **Extend the existing MCP server and AI runtime only** (PRD §0). Tool names follow `verb_noun`. | Locked | No parallel stack. | §6, §7 |
| D19 | **Build order:** 1A vertical slice → 1B evidence → 2 Repo Map → 3 MCP (+ Trace) → 4 Agent Sync → 5 AI. The MVP is 1A + 1B (§10). | Locked | The Canvas → Lens → semantic zoom → Canvas loop has to feel right before anything builds on it. | §9, §10 |
| D20 | **Not now:** Sequence and Data flow views, other profiles, automatic AI architecture generation before hand-drawn frames work, a graph database, a file watcher, PR history, organisation-wide graphs. | Locked | Focus. | §9 "Later" |
| D21 | **MVP identity is `acuteNode.key`, then the element id.** Lens doesn't read `acuteMeta.stableNodeKey` before Phase 2, and from Phase 2 only through a helper in `domain/provenance.ts`, with the user's sign-off and a reviewed entry in `provenanceGuard.test.ts`. (2026-10-01, plan review) | Locked | `stableNodeKey` is a reconciliation field that the provenance guard limits to reconciliation; hand-drawn frames don't need it. | §3.1.1 |
| D22 | **Legend:** the canvas overlay keeps the kind legend under interactive frames (built in frames Phase 2, 2026-09-30, the later decision than Wave 1b item 3). Lens doesn't draw a legend; it names the kind on each node. (2026-10-01) | Locked | One rule per surface, both written down. | §5.2 |
| D23 | **"New detail frame" (manual, 1A) lands beside its parent frame on the same canvas**, to the right, clear of other frames. D7's Detail Canvas is only for AI-generated levels. (2026-10-01, closes open question 1) | Locked | The user asked for this frame, so the user-created rule applies. | §5.3 |
| D24 | **Build order, superseding D19:** 0 clean-ups → 1A-i → 1A-ii → 1B → 2 Repo Map → 3 MCP (+ Trace) → 4 Agent Sync → 5 AI. The MVP is 1A-i + 1A-ii + 1B. (2026-10-01) | Locked | The review found prerequisites that 1A would otherwise break or trip over (§9 Phase 0). | §9 |
| D25 | **Partially supersedes D20:** a second Lens profile, **Project** (decisions, progress, agent change log), moves from "Not now" to scheduled **Phase 6–7**, after Phase 5. Data-flow/sequence views, a graph database, PR/commit evidence and org-wide graphs stay deferred — D20 otherwise stands. (2026-10-03) | Locked | D1 already names "profiles (agent, project, incident, knowledge) come later on the same primitive"; the MCP vision spec (`acute-mcp-vision-spec.md` §0) found this is the single highest-leverage gap between what's built and what developers actually need from MCP. | §3.6, §9 |
| D26 | **Decisions and progress items are canvas objects, not a new store (follows D2).** A `decision` and a `progress_item` node kind, under the Project profile, on the same canvas as everything else. A decision's evidence is `reason` + `rejected` alternatives + links, not a source file — `LensEvidence.source` gains `"decision"` alongside `"code"` etc. One new relation type, `supersedes` (a later decision supersedes an earlier one), joins `RELATION_TYPES` the way D9 added `calls`/`reads`/… | Locked | Keeps D2's "one canonical state" rule; a decision needs no parallel lifecycle or sync path, and it's still reviewable, exportable and editable like any canvas object. | §3.6 |
| D27 | **New MCP tools, same server, same review path:** `record_decision`, `get_decisions`, `update_progress`, `get_progress` (group E of the vision spec's §10.2, renamed to this repo's `verb_noun` convention); plus two session tools, `get_session_context` (bounded bootstrap: focus, relevant architecture, decisions, progress, warnings) and `sync_session` (one call reporting what changed/decided/completed, which internally calls the same write tools — never a second write path). | Locked; tool set completed by D35–D39 | Answers the vision spec's §9 `acute_bootstrap`/`acute_sync` and §3's `record_decision`/`get_decisions` without inventing new infrastructure; D18 ("extend the existing MCP server") still holds. | §7.3 |
| D28 | **Agent change history becomes a persisted, queryable record, not only session-local ghosts.** Every *accepted* `ChangeSet` (not just pending ones, §8.2) is kept and exposed through `get_recent_changes`, attributed to the agent, session and time. Reverting still goes through Excalidraw/Yjs's own undo and version history (no new revert tool in this extension) — D2's "canvas is the only canonical state" means version history is already the right mechanism. | Locked; revert clause **superseded by D30**, store named by D31, fields by D32 | Closes the vision spec's §10.3 gap ("pre-apply review, not a post-hoc attributable log") without a second history mechanism competing with Excalidraw's own. | §3.6, §7.3 |
| D29 | **Session context gets its own bound, separate from Ask AI's.** `get_session_context` is tuned for a one-shot agent handoff (target ≈ 2,000–4,000 chars) and is a distinct budget from Ask AI's existing 16,000-char cap (`contextBuilder.ts`, CAP-01) — this extension does not change that cap or its keyword/IDF retrieval. | Locked | Keeps D18's "no new AI stack" literally true: this reuses `contextBuilder`'s priority ordering with a smaller budget and a different output shape (a structured bootstrap payload, not a chat answer), rather than building a second retrieval engine. | §7.3; inputs refined by D37 |
| D30 | **Supersedes D28's revert clause:** the change log stores each accepted change's **before-state** (the inverse: elements created, and the prior `customData`/text/geometry of elements modified or removed), and a **`revert_agent_changes`** write tool proposes that inverse as an ordinary reviewed `ChangeSet` (D6). Elements edited since the change come back as conflicts (F39's mechanism), never overwritten. The rest of D28 stands. (2026-10-03) | Locked | D28 relied on "Excalidraw/Yjs undo and version history", but the app has **no version history** (`ai/reconcile/diff.ts` marks it out of scope) and Excalidraw undo is local and linear: it can't undo change #142 once later edits exist. Revert is MVP item 5 of the vision spec (§10.3, §10.8); storing the inverse now is what makes it addable without redesign. Revert-as-a-change-set keeps D2/D5/D6. | §3.7, §7.3 |
| D31 | **Agent State has its own store, outside the canvas.** New IndexedDB stores `agentChanges` (append-only, one record per accepted `ChangeSet` or part) and `agentSessions` (one record per MCP session), each indexed `byWorkspace`, like `aiConversations` / `repoMaps` (`persistence/db.ts`). Plain JSON records, so they map one-to-one onto a hosted collection later. They are **history about the canvas, never a fact source about the architecture** (D2 stands: like the Repo Map record, they're never read to decide what's true). (2026-10-03) | Locked | D28 said "kept" but named no store: `PendingChanges` is in memory, one set per canvas, and accepted sets are kept nowhere today. This is the vision spec's §10.6 "Agent State", separated now while it's cheap. | §3.7 |
| D32 | **Every change-log record is attributed:** `agent` (the MCP `clientInfo.name`, already read through `sanitizeClientName` in `mcp/tools/index.ts`), `session`, `tool`, `at`, a `reason` (required on Project-profile writes and `sync_session`, optional elsewhere), the canvas, and the stable keys and element ids it touched. `ChangeSet` gains `agent?` and `reason?` so the record is written at Accept from the set itself. (2026-10-03) | Locked | `ChangeSet` today carries only `session` and `createdBy: "mcp"`, so "Agent: Codex · Reason: …" (vision spec §10.3) and several agents side by side (§10.4) aren't representable. | §3.7, §7.3 |
| D33 | **Project knowledge kinds, fixed now (extends D26):** `project` (one root per project: name, architecture style/template, current focus), `decision`, `constraint` (a decision that must hold; feeds the warnings, D36), `finding` (ephemeral working knowledge: a discovery, hypothesis or assumption), `open_question`, `risk`, `progress_item`, and `milestone` (groups progress items in order). The promotion lifecycle **finding → validated finding → decision → stable architecture** is a reviewed kind/status change on the same node, keeping its key, never a copy. (2026-10-03) | Locked | Vision spec §3's three kinds of knowledge (stable / decision / ephemeral), `get_open_questions`, `log_discovery`, constraints, risks and the implementation plan all need kinds; adding kinds after agents have written data means migrating it. One node kind per concept keeps D26's "thin node" rule. | §3.6 |
| D34 | **Decisions record options, not only rejections.** A decision carries `options: { label, tradeoffs? }[]` and `chosen?` (an option label), plus `reason`. `rejected` is derived (options minus chosen), not stored. A `proposed` decision with options and no `chosen` is the **AI ↔ human negotiation** object: the agent proposes, the human annotates (D35) or picks, the agent reads it back. (2026-10-03) | Locked | Vision spec §4's "agent proposes three approaches, developer annotates a preference" can't be expressed with `rejected: string[]`, and changing a stored schema after Phase 7 ships is a migration. | §3.6 |
| D35 | **Annotations are canvas objects agents read.** An `annotation` is a short note (human or agent) bound to a target node through `refs` (D53; an arrow is drawn only when both are on one canvas), `customData.acuteNode.kind: "annotation"`, with `intent?: "constraint" \| "preference" \| "question" \| "note"`. `annotate` (write tool) proposes one; `get_session_context` and `get_decisions` return annotations on the nodes they return. No comment threads, no replies, no notifications. (2026-10-03) | Locked | Vision spec §3's `annotate` and §4's "comments become AI-readable intent" ("never retry card_declined") need a home; §10.7 defers multi-user comments, so this is the smallest form that serves the agent loop and still follows D2. | §3.6, §7.3 |
| D36 | **Warnings are defined, not free text ("decision firewall").** A warning is any accepted `constraint`, or decision with `enforce: true`, whose `refs` (D53) include a node in the call's scope or its ancestors. `get_session_context`, `get_lens_impact` and `get_decisions` return them in a separate `warnings` array, each with the decision's key, a one-line statement and its reason. (2026-10-03) | Locked | Vision spec §3's "⚠ do not modify the API contract, see Decision #27" needs a rule an agent can rely on; D27's "warnings" field had none. | §7.3 |
| D37 | **Session context is task-scoped, focus is the fallback (refines D27/D29).** `get_session_context` takes `task?` (free text), `paths?` (files about to change), `keys?` (Lens keys) and `budget?` (chars, default 3,000, max 8,000). Scope resolves keys → paths (via `sourceRefs`) → task (name match over `lensTree` keys and labels, then `contextBuilder`'s keyword pass) → open-tab focus. A **`get_project`** read returns the `project` node plus milestone/progress summary. (2026-10-03) | Locked | Vision spec workflow 2 (`get_context("refresh-token rotation")`) and a hosted agent with no open tab both need a scope that isn't "what the tab shows". Still one `contextBuilder`, two call sites (D29 stands). | §7.3 |
| D38 | **`sync_session` takes a typed report** (closes open question 3): `{ summary, changed?: {path, what}[], decisions?: …record_decision input[], findings?: …log_finding input[], progress?: {key, status}[], architecture?: {sectionKey}[], next?: string[] }`. Each list becomes the matching write call; `summary`, `changed` and `next` are stored on the `agentSessions` record, and `next` is what the following session's `get_session_context` returns as "where we left off". (2026-10-03) | Locked | A free-text report needs a parsing step that can fail silently; a typed one maps onto the write tools directly. Without storing `next`, the "agent resumes previous task" trigger (vision spec §9) has nothing to read. Code changes (`changed`) are recorded on the session, not as canvas objects (D2: the canvas holds architecture, not a diff log). | §3.7, §7.3 |
| D39 | **Project-profile objects are project-scoped.** Every Project-profile node carries `acuteNode.project` (the `project` node's key). Resources are `acute://project/{projectKey}`, `…/decisions`, `…/progress`, `…/open-questions`; tools take `project?` and default to the workspace's only project, and refuse with a clear message when there are several and none is given. A workspace may hold several projects. (2026-10-03) | Locked | The vision spec's free tier ships "a workspace with a few projects" (§10.4) and group A has `list_projects`/`create_project`; keying resources by workspace (D27) would need a re-key once a second project exists. | §3.6, §7.3 |
| D40 | **Several pending sets per canvas, one per producer session.** `PendingChanges` keys staged sets by `(canvasId, session)` instead of `canvasId` alone; the review bar lists them, and Accept/Reject is per set. A set that would touch an element another staged set already touches is refused with `PendingReviewError` naming that set, as today. (2026-10-03) | Locked | Today a second agent (or a `sync_session` beside a running Repo Map session) on the same canvas is refused outright. "Multiple concurrent agents" (vision spec §10.4) needs this, and the pending store's key is a design decision, not an add-on. | §3.7, §9 Phase 7 |
| D41 | **Portable to a hosted MCP server, without building one.** `domain/lens/*` and the project-profile readers stay pure (no DOM, no IndexedDB, no `window`); canvases reach them only through `SceneSource`, an interface that a server-side Yjs reader can implement later. Tab-only tools (`focus_lens`, open-tab focus) say so in their descriptions and degrade (D37's fallbacks) rather than fail. Every new tool goes through `ToolPolicy`, the one place an entitlement check can later sit. (2026-10-03) | Locked | Vision spec §10.5–§10.8 make remote MCP, OAuth and plan gating the launch shape. Lens builds none of it (deferred, see `hosted-deployment-decisions`), but must not bake in a browser-only assumption that forces a rewrite. | §2, §7 |
| D42 | **Supersedes D25's/§9's dependency on Phases 2–5 for the Project profile.** Phase 6 depends on 1A-ii only (it needs `lensView` and keys, not evidence); Phase 7's MCP tools depend on 6 and the existing MCP server, not on Phase 3's lens tools. Which runs first, 2–5 or 6–7, is open question 4: the vision spec (§10.7) argues MCP project primitives first, D24 argues the viewer first. (2026-10-03) | Locked | The old dependencies were incidental and would have forced the vision spec's MVP items 4–5 to wait behind Trace, Agent Sync and AI. | §9 |
| D43 | **Three change kinds are added to `ProposedChange` (`ai/changes/changeSet.ts`)**, because today's kinds can't express the Project-profile writes or a faithful revert: `update_node { target, semantics }` (patches the descriptive and project fields of an existing node, validated per field as in Phase 0.1; `update_shape` changes only a label and `create_shape` is the only kind that carries `semantics`), `set_lens { target, level?, expandsTo? }` (the one reviewed door for Lens fields, which AI/MCP input otherwise can't set, Phase 0.1; what `link_lens_detail` proposes), and `restore { element }` (resets or re-creates an element from a stored snapshot **keeping its id and arrow bindings**; produced only by `revert_agent_changes`). Each has an inverse made of existing kinds (`update_node`/`set_lens` with the prior values, `restore`, `remove`). Reconciliation, F39 conflicts and the review bar learn the three kinds in the same change. (2026-10-03, second alignment pass) | Locked | `update_progress`, `update_knowledge`, "Choose" (D34), `link_lens_detail` (§7.1) and `revert_agent_changes` (D30) were all specified as `ChangeSet`s with no change kind able to carry them; re-creating a removed element through `create_*` would give it a new id and drop its connections, so "Reversible: Yes" (vision spec §10.3) would not be true. | §3.7, §7.1, §7.3 |
| D44 | **Auto-accept extends to Project-profile writes, per session and opt-in** (the existing F43 `sessionAutoAccept`, `ai/changes/autoAccept.ts`): `record_decision` (as `proposed` or `accepted` non-enforcing), `log_finding`, `update_progress`, `update_knowledge`, `annotate` and `sync_session` may be auto-accepted for a session the user turned it on for. **Never auto-accepted:** `remove`, `restore`/revert, a new `constraint`, or a decision with `enforce: true` (those create warnings that bind later agents, D36). Every auto-accepted change still gets a record and an inverse (D30); the review bar shows "auto-accepted N this session" with a link to History. (2026-10-03) | Locked | The vision spec's loop (§10.1: "agent reads, writes, the canvas updates, the developer sees it") can't run through a click per decision, and Phase 7B would be unusable for `sync_session`. D6 ("never silently") still holds: the user switched it on, and every change is attributed and reversible. | §7.3, §9 Phase 7A |
| D45 | **Documented deviations are a relation, not a hack:** `deviates_from` joins `RELATION_TYPES` beside `supersedes` (extends D26). A decision that `deviates_from` a decision or constraint, scoped by the nodes in its `refs` (D53), doesn't retire the original; on those nodes D36's warning is returned **with** the deviation attached ("allowed here by #41: the provider requires direct webhook handling"), everywhere else it is raised unchanged. `supersedes` retires the original for good. (2026-10-03) | Locked | Vision spec §9: "decisions can be deviated from for a documented reason, and that deviation itself becomes a recorded decision". D36 had no way to say "this rule holds except here" without either silencing it or leaving a stale warning. | §3.6, §7.3 |
| D46 | **Agent State records every proposal outcome and the call that made it (completes D31/D32).** `AgentChangeRecord` gains `outcome: "accepted" \| "rejected" \| "expired"` (rejected and expired ones keep no inverse), `args` (a bounded, redacted summary of the tool input, ≤ 2 KB) and `result`; the review bar's Reject takes an optional one-line reason. `AgentSessionRecord` gains `usage` (calls and characters returned per tool). `get_session_context` returns `recentRejections` (keys and reasons) so an agent stops re-proposing what the user declined. Nothing is metered, limited or billed in this extension; `usage` only keeps a later "AI Context" meter and agent analytics from needing a new field. (2026-10-03) | Locked | Vision spec §10.6 lists `operation, tool, arguments, result` for Agent State, and §7/§10.4 name agent activity analytics; D31/D32 logged only accepted changes. Rejections are the cheapest way to turn "never retry X" into data (vision spec §4). | §3.7, §7.3 |
| D47 | **Session review is a first-class read (vision spec workflow 3).** `get_session_review(session \| changeIds)` returns **before** (the prior state of every touched architecture node, from the records' inverses), **during** (findings, assumptions, concerns, decisions, annotations the session created, and its `changed` list), and **after** (what changed, `impactOf` over the touched keys, new risks, `proposed` decisions with no `chosen`, unvalidated findings, and `needsReview`: touched nodes with `origin: "mcp"` the user hasn't opened in Lens). The History tab renders it as a "Session review" view. `summarize_impact` is this tool plus `get_lens_impact`; it takes `changedPaths \| session \| changeIds`. A written narrative isn't required: the calling agent or a Phase-5 AI task can add one over this data. (2026-10-03) | Locked | Vision spec §3 `summarize_impact` and §4's before/during/after audit trail had data (D30–D38) but no defined read or view; without it the human-oversight workflow would be improvised later on top of storage that may not hold the right fields. | §3.7, §7.3 |
| D48 | **Related material has a role, and context returns pages.** `acuteNode.sources[].role?: "implementation" \| "test" \| "config" \| "doc"` (carried as `LensEvidence.role`, set by the user's "Source" field and by `upsert_map_section`'s `source`); `get_lens` groups a node's evidence by role (so "tests linked to this component" is a read) and filters by `paths` ("which nodes cite this file"); `get_session_context` returns `{id, title}` for pages in-scope nodes link to (`explained_by`/`references`), so cross-page reasoning can fetch them with the existing `get_page`. PR and commit evidence stay deferred (D20), additive to `LensEvidence.source`. (2026-10-03) | Locked | Vision spec §3 `get_related` (code / PRs / tests / discussions), §7 "code ↔ Acute relationships" and "cross-page reasoning". Phase 1B hasn't started, so adding `role` to the stored `sources` shape costs nothing now and a migration later. | §3.1, §3.3, §7.1, §7.3 |
| D49 | **Setup and gating contracts are fixed here; their content isn't.** (a) The browser has no file access, so Acute never writes `AGENTS.md` / `CLAUDE.md` / Cursor rules itself. It serves them: resource `acute://setup/instructions/{client}` (`claude` \| `codex` \| `cursor`), generated from the project's `style` and the live tool names, plus prompt `setup_project_instructions` that makes the agent write the file in the repo; the UI also offers Copy and Download. The skill text and the three workspace templates are owned by an agent-setup plan (not yet written); a template is only ordinary canvas objects (a `project` node, an interactive L1 frame, optional milestones), which `create_project` accepts. (b) Any premium or limited operation returns one shape from `ToolPolicy`: `{ error: "entitlement_required", feature, limit?, upgrade? }`. Nothing is gated in this extension. (2026-10-03) | Locked | Vision spec §9 makes instruction generation an MVP must-have and §10.5 wants a clear entitlement response; both were "not Lens" with no entry point, so the first implementation would have invented the contract. | §7.3 |
| D50 | **Core object-level tools are completed as Phase 7C, on the same change-set path:** `delete_object` (the existing tool, which already takes a list of ids; proposes `remove` changes, never auto-accepted; name per D62, which replaced the `delete_objects` first written here), `update_connection`, `delete_connection`, `group_blocks`, `list_blocks`, `get_block` (vision spec §10.2 groups C–D). They are logged and revertible like every other write (D30, D43). Canvas- and page-level lifecycle (`list_canvases`, `create_canvas`, `update_canvas`, `delete_canvas`) is **not** a change set: reviewing the deletion of a whole canvas needs its own mechanism, left as open question 6. (2026-10-03) | Locked | The gaps were tracked in no document (only this plan and the vision spec mention them). Deletion is the case where "attributable and reversible" matters most, and `remove` plus `restore` already give it; leaving it unplanned would mean designing delete-and-undo a second time. | §9 Phase 7C |
| D51 | **Closes open question 4 (supersedes D24/D42's ordering): MCP-first, with the viewer that already exists carried along.** Build order becomes 0 → 1A-i → 1A-ii → **6 → 7A → 7B → 7C** → 1B → 2 → 3 → 4 → 5. D24's viewer phases are not redone: Phase 0, 1A-i and 1A-ii are already built and are exactly the "minimal viewer" step the vision spec's reordering asks for (load a workspace/canvas, render node/block kinds and relationships, show basic architecture state) — so the MCP-first request is satisfied by running 6–7C *next*, not by reopening 1A. §10 gains an MVP acceptance table for this slice (§10.2). (2026-10-03) | Locked | D42 had already found Phase 6 depends only on 1A-ii and Phase 7B only on 6/7A/the existing MCP server — the dependency facts already allowed this order; D51 is the product call D42 left open, made in the direction the vision spec argues for (§10.7–§10.8: validate the full agent → MCP → workspace → viewer loop before Trace, Agent Sync or AI). | §9, §10.2, §12 |
| D52 | **Clarifies D51's "MCP contract and server foundation" step against what this plan already deferred.** "Authentication / workspace identity" in that step is the *existing* local pairing token (`mcp/bridge/access.ts`) plus `ToolPolicy` (D41) — **not** OAuth or accounts, which stay deferred per `hosted-deployment-decisions` ("no accounts v1") and D49's "nothing gated here". "Workspace and project model" is D33/D39's `project` kind and `list_projects`/`create_project` (Phase 6), not a new server-side workspace store. "The viewer must consume the same canonical state exposed through MCP, never a separate viewer-specific representation" is already D2/D26/D41: Lens derives from the canvas, which is also what every MCP tool reads and writes — there is no second representation to build or to avoid building. (2026-10-03) | Locked | Without this, D51's step 1 reads as new scope (real auth, a server-side workspace model) that contradicts D41/`hosted-deployment-decisions`, which this session's instructions say to trust over a re-read of older material. Writing the mapping down once avoids the same question recurring at Phase 7B. | §9, §13 |
| D53 | **Semantic references are separate from canvas relations; `acuteNode.refs` is the canonical cross-canvas link.** A **relation** is a visual/spatial arrow within one canvas (D9, unchanged). A **reference** is a semantic link that may cross canvases: `acuteNode.refs?: string[]`, holding Lens keys (D13; a frame's key is its id or `lensKey`), never canvas-local relation ids. Project-knowledge nodes (decisions, constraints, findings, annotations, open questions, risks, progress items) may live on a Project State canvas while the architecture nodes they concern live on other canvases. Rules: (1) every "references" in D35–D36, D39, D47 and §7.3 means `refs`; "which decisions affect this node?" and the D36 warnings resolve through `refs`, **never** through arrows; (2) an arrow may be drawn as well when both nodes share a canvas, but it is only a picture, and drawing one doesn't create a ref; (3) a cross-canvas reference is never faked as an arrow; (4) a ref whose key doesn't resolve (target deleted, canvas removed) is **kept and reported as unresolved**, never dropped or silently rewritten, and resolves again if the key reappears; (5) renaming keeps the key (D13), duplicating drops it (so a copy never inherits a target's refs), and a genuine move between canvases preserves it (D59); (6) `refs` is validated per field like Phase 0.1 (≤ 20 entries, each ≤ 200 characters) and set through `update_node` / the "Link to node…" picker. Resolution needs a workspace-wide key lookup, so the **minimal read-only cross-canvas key resolver** (`SceneSource`, `documentRegistry`, ref-counted, released on close) is built in Phase 6. It only resolves a Lens key to its node or frame (canvas id, element id, kind, label) across canvases, read-only. **Not** brought forward: the 1B drill UI, any `SceneSource` UI, evidence or navigation UX; those stay in 1B. (2026-10-03) | Locked | Relations are arrows bound at both ends (`domain/types.ts`), so they can't cross canvases, yet D26 puts project state on its own canvas. Separating reference from relation keeps both the "no giant single canvas" layout and the later live MCP architecture. | §3.6, §4, §7.3 |
| D54 | **The pure `impactOf` is built in Phase 7B; `tracePath` and the Trace UI stay in Phase 3.** 7B includes `impactOf` (reverse edges, parent walk, and `refs` traversal) and the minimum data traversal it needs; `get_session_review` (D47) and the warnings (D36) use it. 7B does **not** include `tracePath`, the Trace action, the impact visualisation or Phase 3's UX. `impactOf` stays independent of the UI (pure, `domain/lens/`), so Phase 3 reuses the exact function. The split is: 7B computes impact for MCP/session reasoning; Phase 3 shows it. (2026-10-03) | Locked | D51 builds 7B before Phase 3, but D47 and D36 need impact; pulling only the pure function forward avoids both a half-empty review and a second implementation. | §4, §7.3, §9 |
| D55 | **The §7.3 (and §7.1) tool, resource and prompt names are the canonical public API; no aliases.** Before 7B implementation starts: (1) finalise the name list (a last review against this repo's `verb_noun` convention, which is what open question 2 asked); (2) use exactly those names in the server; (3) use them in the generated instruction and skill files (D49, D56); (4) use them in tests and examples; (5) add no aliases unless a real compatibility need appears. After release a rename is an MCP API compatibility change. (2026-10-03) | Locked | Generated instruction files hard-code names agents have already learned; an alias layer would only postpone the break. | §7.3 |
| D56 | **Agent setup is part of the MCP MVP slice (adds acceptance criterion MC11).** The setup resource (`acute://setup/instructions/{client}`, D49) must return an agent-facing artifact that tells the agent: what Acute Notes / Lens is and when to use it; how to initialise and read workspace context (`get_session_context`); which tools and resources exist (the D55 names); when to call `sync_session`; what to persist as architecture, decisions, findings, constraints and progress; what to do when Acute context conflicts with the current code (the code wins; record the divergence), and says explicitly not to fabricate project state. Two sets, kept distinct: the three **client variants** (`claude`, `codex`, `cursor`: file format and tool-call conventions) are required and tested by MC11; the three **architecture workspace templates** (modular, feature-based, service) are defined in the same plan and accepted by `create_project`. The agent-setup plan that owns both sets is written, and the client variants exist, before 7B counts as complete. (2026-10-03) | Locked | Vision spec §9 and §10.8 item 6: MCP access alone doesn't make agents read and write at the right moments. | §7.3, §10.2, §13 |
| D57 | **Phase 7C is built in its planned place but is not a gate for the MCP slice.** The slice is done when MC1–MC11 hold. Delete and group tools (`delete_object`, `group_blocks`, …; name per D62) are not needed to declare it successful, and 7C must not delay validating the agent → MCP → workspace → viewer loop. (2026-10-03) | Locked | D50 plans 7C, D51 orders it before 1B; this keeps validation of the core loop from waiting on it. | §9, §10.2 |
| D58 | **Confirmed defaults and gates (2026-10-03).** *Constants, each defined once in a single module, never repeated as literals:* change-log retention = 500 records or 30 days, whichever keeps more (D31); `get_session_context` budget = 3,000 characters by default, 8,000 maximum (D29, D37); project node kinds = exactly D33's nine, with no additions in 7B unless an acceptance criterion needs one; reject reason = optional, one line (D46); auto-accept never covers removals, reverts, new constraints or `enforce: true` decisions (D44). *Launch gate:* §10.2 (MC1–MC11) is the first MCP launch gate; external positioning claims (`product-positioning.md`) don't change until it has been validated; the validation is coding agent → MCP → canonical workspace state → viewer as one loop. *Auth:* no OAuth or accounts in this slice (D52); the pairing token stays, behind the existing access seam (`mcp/bridge/access.ts`, `ToolPolicy`) so a later mechanism replaces it without changing any tool contract. *Real-agent validation:* MC1 and MC10 each include a real Claude Code or Codex run as a **manual integration step**, run only when the user asks; ordinary unit, scripted-client and e2e development never depends on a live agent. *Deferred:* open question 1 stays a gate before Phase 2; open question 5 waits for workspace export/import; open question 6 is deferred (`list_canvases` ships without it). *Order:* D51 stands, including 7A (MC8 and MC9 need it): 6 → 7A → 7B → 7C → 1B → 2 → 3 → 4 → 5; Phase 3 later adds only `tracePath`, the Trace UI and the richer impact view (D54). | Locked | Closes the second alignment pass's confirm-list so the same questions don't resurface at 7B. | §9, §10.2, §12 |
| D59 | **Hard invariant: a move preserves `acuteNode.key`; a copy creates a new identity.** With D53 a key is the *address* that lets semantic knowledge survive canvas boundaries, not an identity convenience. (1) **Move** (a genuine relocation of the same node or frame, within or between canvases) keeps its key, so every `refs` entry and `expandsTo` that points at it still resolves. (2) **Copy / duplicate / paste** drops the key (D13, `dropsLensKeyOnCopy`) and the copy gets a fresh key when next needed; a copy never inherits the original's key or the refs aimed at it. (3) **Today there is no cross-canvas move:** a node reaches another canvas only by cut and paste, which Excalidraw delivers as new elements through `handleDuplicate`, so the key is dropped and refs to it would go unresolved. Phase 6 therefore adds an explicit **"Move to canvas…"** command (properties panel) that moves the selection with its keys intact: it calls `ensureNodeKey` on moved nodes first, pins `lensKey` to the old frame id on a moved frame (the lookup already resolves `lensKey` or id, `lensView.ts`) so `expandsTo` and refs to the frame keep working, and keeps relations whose both ends move. Cut-and-paste stays a copy by design; when the user cuts or deletes a node that other nodes `refs`, Phase 6 says how many do and points at "Move to canvas…". Undo of the command must not leave refs unresolved. (4) An MCP or Repo Map key change is a separate case (`upsert_map_section` moving a key between sections is still remove + re-add until Phase 2's `move` form, §3.1.1); refs to such a key show as unresolved, never as a different node. (2026-10-03) | Locked | D53 turns key preservation from an implementation detail into a semantic requirement; leaving a move as copy + delete would silently orphan decisions, constraints and warnings. | §3.1.1, §3.6, §9 Phase 6 |
| D60 | **Phase 1B was built on 2026-10-03 at the user's request, alongside Phase 6, instead of after 7C (amends D51's order only).** The user asked for 1B next; it depends on 1A-ii alone (§9 table), touches none of 6–7C's scope, and the cross-canvas `SceneSource` it adds is what D53's workspace-wide key lookup reads canvases through. D51's order otherwise stands: 7A → 7B → 7C next, then 2 → 3 → 4 → 5. (2026-10-03) | Locked | An explicit user request; no dependency is broken, and building the interface D41 names once, here, keeps Phase 6's reader from inventing a second one. | §9 |
| D61 | **Refines D32: `agent` is what the client reports, not a verified identity.** `agent` is the MCP `clientInfo.name` (sanitized), which the client chooses itself, and every client shares the one pairing token, so the History tab's "Agent: Codex" cannot be verified. The UI words it as reported by the client, and nothing (revert, auto-accept, warnings) trusts it. `AgentChangeRecord` and `AgentSessionRecord` each reserve an optional `credentialId`, unset until per-client tokens exist, so verified attribution can be added later without a migration. (2026-10-03, lessons review) | Locked | Honest in the UI today, and cheap to leave room for now: the stores are being designed in 7A. | §3.7, §7.3 |
| D62 | **D55's name review is done; the §7.1/§7.3 names are the canonical MCP API (amends D50's naming).** The user confirmed the names as written. One clash resolved: the server already ships `delete_object`, which takes a list of ids, so Phase 7C uses it and **no `delete_objects` tool is added** — two overlapping public delete APIs would be the aliasing D55 forbids. Phase 7C's tools are `delete_object`, `update_connection`, `delete_connection`, `group_blocks`, `list_blocks`, `get_block`. No aliases or synonyms unless a later explicit compatibility decision requires them. (2026-10-03, user decision) | Locked | Closes D55's entry gate for 7B. A shipped tool name is already learned by agents; adding a plural twin would split the API for no capability gain. | §7.3, §9 Phase 7C |
| D63 | **The agent-setup plan is drafted before 7B and reviewed before any of it is built** (`agent-setup-plan.md`). It has two separate parts: the three **client setup variants** (Claude, Codex, Cursor — the artifacts MC11 tests) and the three **workspace templates** (modular, feature-based, service — project starting structures, not part of MC11), plus a **persistence boundary** (what agents record in Acute and what they must not). The setup resource (`acute://setup/instructions/{client}`, `setup_project_instructions`) isn't implemented, and 7B doesn't count as complete, until that plan is approved. (2026-10-03, user decision) | Locked | D56 required the plan before 7B completes; the user made its review a gate before 7B starts. | §7.3, §10.2 MC11 |
| D64 | **D21 signed off for Phase 2, as written (closes open question 1).** `acuteNode.key` stays the primary identity of hand-drawn nodes; from Phase 2 a Repo Map / Visualize node's reconciliation key (`acuteMeta.stableNodeKey`, on the element or its document) is its Lens identity, read only through `lensIdentityOf` in `domain/provenance.ts`, by the one module that states the Lens identity rule (`domain/lens/identity.ts`), with a guard suite listing both and their reasons. It is the reconciliation identity carried *into* the canvas — not a second store or a generic canvas identity; the canvas stays canonical (D2). **The copy rule applies to it** (§3.1.1, D59): because provenance travels with a copy, the copy is marked `acuteNode.ownIdentity` (a Lens-half field) at duplicate time and Lens doesn't read the key on it; the reconciliation data itself isn't touched. A map node is never given an `acuteNode.key` that would override its identity (`ensureNodeKey` returns the map identity). Required tests (user, 2026-10-03): in-place update by K, conflict on a user-edited K, identity kept across rename/source changes, copy without K. (2026-10-03, user decision) | Locked | The user's sign-off on D21 with explicit test requirements; the copy mechanism is the smallest way to keep D59's "copy creates identity" true for keys stored in provenance. | §3.1.1, §9 Phase 2 |
| D65 | **Design review: Lens can assess the level on screen the way an interviewer scrutinises an HLD (L0–L2) or an LLD (L3–L5).** Two new tasks on the existing runtime (D18): `lens_review` (text: requirements, capacity, "what breaks at N×", failure modes, tradeoffs) and `lens_assess` (JSON: a verdict `strong / partial / gap / unknown`, a short answer and one improvement per question). They read the **whole level** plus structure computed locally (`structureFacts`: degree, shared stores, external dependencies, longest chain, isolated nodes), the user's own figures, and (when wired) the project's decisions. **Figures come only from the user's assumptions; any other number the model adds must be labelled an assumption.** A built-in question bank (`ai/lens/reviewQuestions.ts`: 14 HLD, 11 LLD) carries a *local* diagram check per question ("seen / not seen / can't tell"), so the table shows how the architecture sits before any AI call; users add their own questions (device-local). Nothing is written to a canvas (D5/D6 untouched). (2026-10-11, user request) | Locked | The user wanted Lens to answer requirements, capacity and scalability questions, and to give developers an interview-style way to see what an architecture is missing. Verdicts are the model's judgement, never a fact from the code, and are shown as such. | §6.4, §9 Phase 5b |

## 1. What Lens is, in this codebase

Interactive architecture frames make **one frame** behave like an Archify diagram on the canvas: node kinds, passport
card, neighbourhood highlight, legend. **Lens is the same diagram language across levels.** It is a read-mostly view
that stacks those frames into an L0 → L5 hierarchy, from HLD at the top to LLD and source at the bottom, and lets you
zoom *semantically* through them.

| | Interactive frame (canvas) | Acute Lens (view) |
|---|---|---|
| Scope | one frame | a tree of frames, one level at a time |
| Surface | Excalidraw overlay | its own panel, docked or full width, like the page panel |
| Edits | native Excalidraw editing | none directly; changes go through the canvas or a reviewed change set |
| Rendering | Excalidraw elements + overlay | its own SVG renderer, Archify-style, from a derived graph |
| Levels | none | L0 System · L1 Architecture · L2 Component · L3 Flow · L4 Operation · L5 Source |

### The key finding: most of the model already exists

The PRD asks for a `VizNode` / `VizRelationship` / `Evidence` model plus persistence. Nearly all of it is already
in the canvas, so Lens **derives** its graph instead of storing a second copy:

| PRD concept | Already here | Gap |
|---|---|---|
| `VizNode` with type, name, description | shape + `customData.acuteNode {kind, sublabel, tag, details}` (`domain/canvas/diagram.ts`) | a level; kinds for L3–L5 (see §3.2) |
| `VizRelationship` with type | arrow bound at both ends → `AcuteRelation` (`deriveRelations`), `RELATION_TYPES`, `acuteEdge.explanation` | calls/reads/writes/publishes vocabulary (§3.2) |
| `parentId` / hierarchy | Repo Map levels: `section.parent` card → child frame, joined by an `explained_by` "details" arrow (Wave 1b item 1) | a general "this node expands to that frame" link for any frame, not only map sections |
| `Evidence` (code, file, lines) | `acuteMeta.sourceRefs` `{provider:"repo", externalId:"path#La-b@commit"}` stamped by Repo Map | parsing helper; confidence; other source types |
| `canvasObjectIds` / reverse mapping | the node **is** the canvas element; the frame is the element's `frameId` | nothing |
| Diagram per frame | `frameGraph(elements, frameId)` → `DiagramGraph` | a multi-frame, multi-canvas `lensGraph` |
| Change indicators | Repo Map stale markers (`staleMarkersStore`), pending `ChangeSet` parts | a Lens overlay that reads them |
| Canvas geometry | node `box` in `DiagramNode` | none; Lens reuses it for layout (§5.2) |

That keeps the PRD's §0 rule literally. Lens adds **no new AI stack, MCP server or database**, no IndexedDB store for
architecture, and no copy of the architecture that could drift from the canvas. (Phase 7A adds two stores for Agent
State, D31: history about the canvas, never a fact source.)

## 2. Architecture

```
  IDE agent (Claude Code / Codex / Copilot)            Acute AI runtime (AIRuntime, tasks, contextBuilder)
          │ existing MCP bridge (in-tab server)                   │
          ▼                                                       ▼
  Repo Map tools + new lens tools ──► ChangeSet (review) ──► Canvas (Excalidraw + Yjs)  ◄── the user edits
                                                                  │  customData: acuteDiagram / acuteNode /
                                                                  │  acuteEdge / acuteMeta.sourceRefs
                                                                  ▼
                                              lensGraph()  (pure, derived, like frameGraph)
                                                                  │
                                     ┌────────────────────────────┼─────────────────────────┐
                                     ▼                            ▼                         ▼
                              Lens renderer (SVG)          Inspector / Evidence       Trace / Impact (BFS)
                                     └──────────── LensPanel (docked | expanded) ───────────┘
```

Rules:

1. **Canvas is canonical (D2).** Every Lens fact comes from canvas elements, on any canvas in the workspace. What a
   Repo Map adds reaches the canvas on Accept: the node key as `acuteMeta.stableNodeKey`, code locations as
   `acuteMeta.sourceRefs`. So Lens reads the canvas alone. The device-local Repo Map record is used only as an index
   (which cards cite a changed path, the repo root for "Open in VS Code"), never as a source of facts. Lens never holds
   architecture facts that aren't on some canvas.
2. **Pending is proposed, not true (D3).** A staged `ChangeSet` is shown as proposed state (ghosts, §8) on top of the
   canonical graph, never merged into it before Accept.
3. **Lens never writes the scene directly (D5).** It only calls the existing canvas commands (`diagramNodes.ts`: one undo
   step each) for small manual edits like "link to detail frame" and "set level", or proposes a `ChangeSet` for
   anything AI or MCP produces. Proposals go through the same review bar.
4. **The renderer is independent of AI** (PRD §32). AI and MCP produce `VisualPlan`s / map sections, as they do
   today; the Lens renderer only draws `lensGraph` output.
5. **Portable to a hosted server (D41).** `domain/lens/*` and the project-profile readers are pure (no DOM,
   IndexedDB or `window`) and get canvases only through the `SceneSource` interface (§4), so a server-side Yjs reader
   can serve the same tools later. Tab-only behaviour (`focus_lens`, open-tab focus) is named as such and degrades.

## 3. Data model changes (§3.1–3.6 all in `customData`: no migration, syncs through Yjs, exports as-is; §3.7 adds two IndexedDB stores, D31)

### 3.1 Levels and drill links

```ts
// on the frame (extends DiagramMeta in domain/canvas/diagram.ts)
customData.acuteDiagram = {
  type: "architecture",
  interactive: true,
  level?: 0 | 1 | 2 | 3 | 4 | 5,       // explicit level; otherwise inferred (below)
  lensKey?: string,                     // stable id for deep links, survives reconcile (else the frame id)
  cards?: [...],
};

// on a node: "zooming into me shows that frame"
customData.acuteNode = {
  ...existing,
  key?: string,                                         // semantic identity for hand-drawn nodes (§3.1.1)
  expandsTo?: { frameKey: string; canvasId?: string },  // frameKey = lensKey or frame id; canvasId when elsewhere
  sources?: { path: string; lines?: [number, number]; commit?: string; role?: "implementation" | "test" | "config" | "doc" }[],  // user-entered evidence (§3.3); role per D48
};
```

How Lens resolves a node's child frame, in order:

1. `acuteNode.expandsTo`, set explicitly (the manual "Link to detail frame", AI "Generate next level", or MCP);
2. an `explained_by` arrow from the node to a frame (what Repo Map already draws for `section.parent`);
3. a heuristic, shown only as a suggestion and never written without asking: an interactive frame whose title
   equals the node's label.

Level inference when `level` is missing: the root frame the user opened is its explicit level, or L1 if it has none;
each drill step adds 1; clamp to 5. Code nodes, and nodes whose `sourceRefs` carry a line range, are always L5.

#### 3.1.1 Stable identity (D13)

A node's **Lens key** is resolved in this order:

1. `acuteNode.key`: a hand-drawn node, assigned on first "Open in Lens" or "Link to detail frame", derived from the
   frame key and a slug of the label (`payments.webhook-handler`). It is kept on rename.
2. **From Phase 2 only, with the user's sign-off (D21):** `acuteMeta.stableNodeKey` for nodes from a Repo Map or
   Visualize. For a map node this is the agent's own key, the one reconciliation already matches by. So an agent that
   keeps the key while renaming a function gets **updated**, not deleted and re-created, and cards the user edited
   come back as conflicts instead of being overwritten (F43, already built). It's read only through a helper in
   `domain/provenance.ts`, listed in `provenanceGuard.test.ts` with its reason.
3. The element id, as a last resort (never shown to agents as a key).

Rules:
- **Copies:** a key must not survive a copy that would duplicate it. A duplicated or pasted node drops `acuteNode.key`,
  like a relation dropped on a lone copied arrow (`keepsRelationOnCopy`), and gets a fresh key when next needed.
- **Moves (D59, hard invariant):** a genuine move keeps the key, within a canvas and between canvases, via the explicit
  "Move to canvas…" command (Phase 6); cut-and-paste is a copy. With D53 the key is the address semantic `refs` use to
  cross canvases, so "move preserves key, copy creates identity" is never relaxed.
- **Frames** use `acuteDiagram.lensKey` the same way. Deep links, `expandsTo` and MCP address frames and nodes only by
  keys.
- **Moving a key between sections** is currently remove + re-add (Repo Map rejects a key used in another section).
  That's acceptable for the MVP; a later `move` form of `upsert_map_section` would keep identity across a move
  (risk, §11).

**Why a link and not nested frames:** Excalidraw frames can't nest, and the frames plan chose one boundary level.
PRD §8's "nested frames" become frames linked by `expandsTo` / `explained_by`. They can sit side by side on one
canvas, or on the Detail Canvas (D7, §6.3). The user still gets a natural hierarchy, and it's plain Excalidraw.

### 3.2 Vocabulary for L3–L5

| Addition | Where | Why |
|---|---|---|
| Kinds `endpoint`, `step`, `function`, `event`, `store` | `NODE_KINDS` + `nodeKindStyle.ts` | L3 flow and L4 operation nodes aren't "backend/database" boxes |
| Relation types `calls`, `reads`, `writes`, `publishes`, `subscribes`, `contains` | `RELATION_TYPES` in `domain/types.ts`, `relationStyle.ts`, Repo Map `schema.ts` | PRD §24; today's list has `depends_on` / `flows_to` but not reads/writes |
| `confidence?: number` (0–1), `evidence?: string` | `acuteEdge` | PRD §20; AI and MCP can state how sure they are |

Adding a relation type touches the MCP tool schemas and prompts too. Check `RELATION_TYPES` consumers, the Mermaid
converter and `relationStyle` in the same change.

### 3.3 Evidence (derived, not stored)

```ts
interface LensEvidence {
  source: "canvas" | "code" | "document" | "conversation" | "commit";
  label: string;                                   // "payment.service.ts:82"
  path?: string; lines?: [number, number]; commit?: string;
  role?: "implementation" | "test" | "config" | "doc";   // D48: lets "tests linked to this node" be a read
  ref?: { canvasId: string; elementId: string };   // for "show on canvas"
  confidence?: number;
  origin: "user" | "ai" | "mcp";                   // from acuteMeta.ai / content source origin
}
```

Built by `lensEvidence(element)` from:
- `acuteMeta.sourceRefs` (parse `path#La-b@commit`): agent-provided, `origin: "mcp"`;
- `acuteNode.sources`: entered by the user in the properties panel ("Source: path, lines"), `origin: "user"`. This
  lets a hand-drawn L4 node reach L5 in the MVP without a Repo Map;
- `acuteMeta.source` and the content source (Visualize or MCP);
- the element itself (always `canvas`).

PR evidence is deferred: nothing stores PRs today.

### 3.4 Profiles (D1, D10)

```ts
interface LensProfile {
  id: "architecture";                               // the only profile built now
  levels: { index: number; name: string; short: string }[];   // L0 "System" … L5 "Source"
  sourceLevel?: number;                             // the level rendered as a source card (5)
  kinds: readonly NodeKind[];                       // kinds offered at this profile's levels
}
```

`acuteDiagram.profile?` defaults to `"architecture"`. Every "L2" in the UI comes from `profile.levels`, never from a
constant, so an agent or project lens later is a new profile entry, not an engine change. No other profile is built
now.

### 3.5 View state (device-local)

`uiPrefs`: `lensPanelWidth` and `lensLastLevel` per root. The `meta` store holds `lens.sync.<canvasId>` (paused or
on). The PRD's §26 "persist nodes, relationships, hierarchy, evidence" is met by the canvas itself, which already
persists them.

### 3.6 Project profile: project knowledge on the canvas (D25–D27, D33–D36, D39; Phase 6–7)

Answers the vision spec's "typed decisions/progress objects" gap (§0's highest-leverage row) the same way Lens
answers architecture: derive a profile's graph from canvas objects, never a second store. **Conscious deviation from
the vision spec's §10.6:** it splits "Project Knowledge" into its own store; here project knowledge is canvas state
(D2, D26), and only "Agent State" gets its own store (§3.7, D31). "Entitlements" has no store until accounts exist
(D41).

```ts
interface LensProfile {
  id: "architecture" | "project";          // D1, D10: a second profile, same engine
  levels: { index: number; name: string; short: string }[];
  sourceLevel?: number;
  kinds: readonly NodeKind[];
}

// profile "project" levels (lanes, not a drill hierarchy like architecture's L0–L5):
//   L0 Project (the `project` node + milestone summary)
//   L1 lanes side by side: Plan (milestones → progress items) · Decisions (decisions, constraints)
//                          · Working knowledge (findings, open questions, risks) · Notes (annotations)
```

```ts
// new NODE_KINDS (D33), styled like any other kind (nodeKindStyle.ts). Every one also carries
// NodeLens.key (D13) and `project` (D39). All fields are validated per field, like Phase 0.1.
interface ProjectKnowledge extends NodeSemantics {
  project: string;                      // the `project` node's key (D39); a project node holds its own key
  refs?: string[];                      // D53: Lens keys of the nodes this concerns, on any canvas (≤ 20); arrows stay canvas-local
}
interface ProjectNode extends NodeSemantics {
  kind: "project";
  style?: "modular" | "feature" | "service" | "custom";   // the architecture template it started from (§9 templates)
  focus?: string;                       // current focus, one line; set by the user or sync_session
}
interface DecisionNode extends ProjectKnowledge {
  kind: "decision" | "constraint";      // a constraint is a decision that must hold (D33, D36)
  status: "proposed" | "accepted" | "superseded";
  reason: string;                       // why, short
  options?: { label: string; tradeoffs?: string }[];   // D34; "rejected" = options minus chosen, derived
  chosen?: string;                      // an option label; absent while proposed = an open negotiation (D34)
  enforce?: boolean;                    // decision kind only: raise as a warning (D36); constraints always do
}
interface FindingNode extends ProjectKnowledge {
  kind: "finding";                      // ephemeral working knowledge: discovery, hypothesis, assumption, concern
  stage: "ephemeral" | "validated";     // promotion: finding → validated → decision → stable architecture (D33)
  note?: "discovery" | "hypothesis" | "assumption" | "concern";
}
interface OpenQuestionNode extends ProjectKnowledge { kind: "open_question"; status: "open" | "answered"; answer?: string }
interface RiskNode extends ProjectKnowledge { kind: "risk"; severity?: "low" | "medium" | "high" }
interface MilestoneNode extends ProjectKnowledge { kind: "milestone"; order: number }
interface ProgressItemNode extends ProjectKnowledge {
  kind: "progress_item";
  status: "not_started" | "in_progress" | "done" | "blocked";
  order?: number;                       // position within its milestone (D33); the implementation plan's order
  next?: boolean;                       // marked "up next" (by the user, or sync_session's `next`)
}
interface AnnotationNode extends ProjectKnowledge {
  kind: "annotation";                   // D35: bound to its target through `refs` (D53)
  intent?: "constraint" | "preference" | "question" | "note";
}
```

- **Canonical state (D2, D26):** every one of these is a shape on a canvas, in a `customData.acuteNode` with its
  kind — not a row in a new table. They can live on their own canvas (e.g. "Project state") or beside the
  architecture frames they concern. **The implementation plan** is the Plan lane: milestones (`order`) `contains`
  progress items (`order`); `get_implementation_plan` (§7.3) reads it in that order.
- **Relations:** `supersedes` and `deviates_from` (D45) are the new `RELATION_TYPES` entries (alongside D9's `calls`/`reads`/…/`contains`).
  A decision can `relates_to`, `depends_on`, `blocks` or `supersedes` another. Any project-knowledge node can
  carry a `refs` entry to an architecture node on any canvas (e.g. "Decision: use Redis" has the "Cache" L2 node's key in its `refs`), which is how
  `get_session_context`, `get_decisions` and the warnings (D36) find what's relevant to a piece of architecture. An
  `open_question` answered by a decision is linked `explained_by`.
- **References vs relations (D53):** `refs` is the semantic link and the only one queries, warnings and the session
  context resolve through; it may point at a node on another canvas. A relation (arrow) is a picture within one
  canvas. Wherever this section or §7.3 says a node "references" another, it means `refs`. A ref that no longer
  resolves is kept and shown as unresolved.
- **Promotion (D33):** promoting a finding to `validated`, then to a `decision`, then folding it into architecture is
  a reviewed edit of the same node (kind/status change, same key) or, for the last step, a map/frame update that the
  decision's `refs` — never a copy, so the trail stays one object. The Lens inspector offers "Promote" on findings
  and decisions; the MCP side is `update_knowledge` (§7.3).
- **Negotiation (D34, D35):** an agent records a `proposed` decision with `options` and no `chosen`. The user picks
  one in the inspector ("Choose"), or adds an annotation with `intent: "preference"` or `"constraint"` on the decision
  or on the node an option concerns. The agent reads both back through `get_decisions` / `get_session_context`.
- **Evidence (extends §3.3):** `LensEvidence.source` gains `"decision"`: a decision's "evidence" is its own
  `reason`/`options` text plus whatever its `refs` point to, not a file path. The existing `origin: "user" | "ai" |
  "mcp"` field already distinguishes a human-recorded decision from an agent-proposed one.
- **Deliberately thin:** every node here is a short record, the way a map card is. Prose detail (a full writeup of
  why) belongs on a linked page via the existing `create_page` tool and `explained_by`/`references`, not inside the
  node — avoids rebuilding a second "long document" feature here (§11 risk: scope growth).
- **Not building:** a distinct "progress tracker" UI with burndown/velocity, a ticketing system, comment threads or
  replies (annotations are single notes, D35), or any sync with GitHub/Jira issues (CAP-14, still P2 and out of scope
  here). A `progress_item` is a thin status marker an agent or the user sets, nothing more.

### 3.7 Agent State: change log, sessions, pending sets (D28, D30–D32, D38, D40; Phase 7A)

History about the canvas, kept apart from it (D31). Never read to decide what is true (D2).

```ts
// persistence/db.ts, new stores (next migration), both indexed byWorkspace like aiConversations / repoMaps
interface AgentChangeRecord {             // store "agentChanges", append-only, one per accepted set or part
  id: string; workspaceId: string; canvasId: string;
  operationId: string;                    // ChangeSet.operationId: links to metadata.ai.operationId on objects
  agent?: string;                         // MCP clientInfo.name as the client reports it (D32, D61); absent for in-app AI
  credentialId?: string;                  // D61: reserved for per-client tokens; unset today
  session?: string; tool: string; at: number;
  outcome: "accepted" | "rejected" | "expired";   // D46: rejected/expired keep no inverse
  args?: string;                          // D46: bounded (≤ 2 KB), redacted summary of the tool input
  result?: "applied" | "partial" | "conflicts" | "refused";
  title: string; reason?: string;         // D32
  touched: { elementId: string; key?: string; op: "create" | "update" | "remove" }[];
  inverse: InverseChange[];               // D30: enough to propose the undo as a ChangeSet
  revertedBy?: string;                    // the record id of an accepted revert of this change
}
type InverseChange =
  | { op: "remove"; elementId: string }                       // undo a create
  | { op: "restore"; element: StoredElementSnapshot };        // undo an update or remove: the prior element, via the `restore` change kind (D43)
interface AgentSessionRecord {            // store "agentSessions", one per MCP session
  id: string; workspaceId: string; agent?: string; credentialId?: string; project?: string;   // D61
  startedAt: number; lastWriteAt?: number; endedAt?: number;
  summary?: string; changed?: { path: string; what: string }[]; next?: string[];   // from sync_session (D38)
  changeIds: string[];                    // its AgentChangeRecords
  usage?: Record<string, { calls: number; chars: number }>;   // D46: per tool; nothing is limited or metered here
}
```

- **Written at Accept, by the review path itself** (`PendingChanges` accept → canvas write → record), so every
  accepted change is logged whether it came from MCP, in-app AI or Repo Map; the user's own hand edits are not (they
  aren't change sets). The inverse is captured from the scene just before the write, in the same step. Rejected and expired proposals are logged too, without an inverse (D46).
- **Bounded:** keep the last 500 records per workspace or 30 days, whichever is more; older records drop their
  `inverse` first (still listed, no longer revertible), then go. Snapshots are capped per record (embedded file data
  is stored by file id, not copied).
- **Revert (D30):** `revert_agent_changes(ids)` builds a `ChangeSet` from the inverses, newest first. Any element
  edited since the change (its version moved past the recorded one) becomes a `ConflictItem` (F39), never silently
  overwritten. Accepting the revert writes its own record and sets `revertedBy`.
- **UI:** the "History" tab (Phase 7A) lists records by session with agent, time, reason and touched keys; each has
  "Show on canvas" and "Revert…" (which stages the revert set for review). It stays visually distinct from Phase 4's
  pending Changes drawer (§11).
- **Pending sets (D40):** `PendingChanges` keys staged sets by `(canvasId, session)`; in-app AI uses the session
  `"app"`. Two staged sets that touch the same element are refused, as one proposal over another is today. Repo
  Map's merge key keeps working inside its own session.
- **Device-local today**, like the Repo Map record; JSON shaped so a hosted collection can hold the same records
  later (D31, D41). Not exported with the workspace in this extension.

## 4. The derived graph: `src/domain/lens/`

Pure and renderer-agnostic, like `diagram.ts`, and unit-tested the same way.

```ts
interface LensNode {
  id: string;                        // element id
  canvasId: string; frameId: string;
  label: string; semantics: NodeSemantics;
  key: string;                       // stable Lens key (§3.1.1)
  level: number;                     // index into the frame's profile levels
  box: Box;                          // canvas geometry, normalised per frame
  childFrame?: { canvasId: string; frameId: string; via: "expandsTo" | "explained_by" | "suggested" };
  evidence: LensEvidence[];
  origin: "user" | "ai" | "mcp";
}
interface LensLevelView {
  frame: FrameRef; profile: LensProfile; level: number;
  nodes: LensNode[]; edges: DiagramEdge[]; crumbs: FrameRef[];
  pending?: LensPendingView;         // proposed state from staged change sets (D3), kept apart from nodes/edges
}

lensView(scenes, root: FrameRef, path: string[]): LensLevelView   // one level, built on frameGraph
lensTree(scenes, root): LensTreeNode                               // whole hierarchy, for the level rail and MCP
tracePath(tree, fromKey, toKey, kind): LensPath | undefined        // BFS across levels and edges
impactOf(tree, changedIds): { modified; affected; related }        // reverse edges + walk up parents
```

- `scenes` comes through a `SceneSource` (an interface, D41; the browser implementation is the only one built) that reads the open canvas's live elements and, only for canvases a drill
  link points into, loads those canvases' Yjs docs read-only through `documentRegistry` (ref-counted, released on
  close). A drill into another canvas opens nothing in the canvas area.
- Budget: Lens shows one level at a time, which keeps each screen near Archify's 12 primary nodes. A level with more
  than 24 nodes collapses to per-group summary nodes (the `SectionOverview` idea) until the user expands one.

## 5. UI

### 5.1 Shell and panel (follows the page panel exactly)

- `src/state/lensPanel.ts`: a store shaped like `pagePanel`:
  `{ root: FrameRef | null; path: string[]; selectedId: string | null; expanded: boolean }`.
  `lensPanel.open(root, {nodeId?})`, `drill(nodeId)`, `up(n?)`, `select(id)`, `setExpanded`, `close`.
- `src/components/lens/LensPanel.tsx`: rendered in `AppShell`'s flex row where `PagePanel` sits. It reuses the
  `.acute-page-panel` layout rules: docked, resizable (`MIN_WIDTH` / `MIN_CANVAS_WIDTH`), `data-expanded` for full
  width over the canvas, and the canvas stays mounted underneath. Factor the shared CSS into `.acute-side-panel` so
  the two can't drift.
- **One right-hand slot:** opening Lens closes the page panel and vice versa. Opening a page from the Lens inspector
  swaps to the page panel, which offers "← Back to Lens" (the store remembers the last root and path).
- Deep link: `#lens=<lensKey>&path=<k1>.<k2>&node=<k>` (hash, same style as the frames plan's
  `#frame=<id>&view=<id>`), so a Lens position can be shared or reopened after a reload.

### 5.2 Layout inside the panel

MVP (Phases 1A–1B): three columns only, no drawer and no tabs.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ✨ Lens · E-Commerce ▸ Payments ▸ Webhook Handler          ⤢  ← Canvas ✕│
├────────────┬─────────────────────────────────────────────┬───────────────┤
│ L0 System  │                                             │ Webhook Hndlr │
│ L1 Arch    │        SVG diagram (this level only)        │ Backend · L2  │
│●L2 Comp    │   click = select · double-click = zoom in   │ Details       │
│ L3 Flow    │   ⌫ / breadcrumb = zoom out                 │ Relations ↔   │
│ L4 Op      │                                             │ Evidence 📄   │
│ L5 Source  │                              −  100%  +     │ [Zoom in ▸]   │
└────────────┴─────────────────────────────────────────────┴───────────────┘
Docked (half screen): the level rail becomes a horizontal L0–L5 stepper under the header;
the inspector becomes a bottom sheet over the diagram.
```

Added later, not in the MVP: `● Agent Sync` in the header (Phase 4); the collapsible **Changes (3Δ) · Impact** drawer
at the bottom (Phase 4); the Trace action (Phase 3); Explain (Phase 5).

- **Two zooms, shown apart (D11).** The level rail and breadcrumb are *semantic* zoom (which level you're looking at).
  The `− 100% +` control in the diagram's corner is *visual* zoom (scale inside one level). They never share a
  control, and the header always names the semantic level ("L2 Component"), never a percentage.
- **Node actions (D16).** The inspector's action row is the node's verbs: **Zoom in** (1A), **Evidence** (1B),
  **Trace** (3), **Explain** (5). An action appears only once its phase ships: no disabled placeholders. Trace
  highlights a path from the selected node to a second one picked on any level (`tracePath`, §4) and names every hop
  with its relation and evidence.
- **Level rail:** each level shows whether it exists for the current path (filled) or isn't linked (empty). From
  Phase 5 an unlinked level below the selection can be generated (dashed, "✨ Generate"). Clicking a level above the current one zooms out to that ancestor. Clicking a
  level below zooms into the selected node, or the only node with a child.
- **Tabs** (Architecture · Data flow · Sequence · Dependencies, PRD §10): MVP ships Architecture only. The tab strip
  appears once a second view exists (sequence waits on CAP-07 / content-fidelity Wave E).
- **Renderer:** `components/lens/LensDiagram.tsx`, plain SVG, no Excalidraw.
  - **Geometry:** the frame's own canvas layout, normalised, so the user's mental map survives. When a level has no
    canvas geometry (e.g. a synthesised summary level), use `ai/renderer/layout.ts`'s layered layout. `layoutPlan`
    takes a `VisualPlan`, not boxes, so the fallback first builds a minimal plan (one `shape` node per Lens node, the
    edges as relationships) and reads the boxes back.
  - **Routes:** `ai/changes/routing.ts` (already Archify-style orthogonal routing, pure) over the normalised boxes.
    This yields the same right-angle routes as the canvas without Excalidraw.
  - **Style:** `nodeKindStyle.ts` fills and strokes plus the relation styles; the kind is named on each node, and
    Lens draws no legend (D22).
  - **Interaction:** the passport card, kind chip, relation labels and highlight paths, which Phase 0 moves out of
    `DiagramOverlay.tsx` (`components/diagram/Passport.tsx`, `diagramPaths.ts`, `RELATION_LABELS`). The overlay
    and Lens use one implementation.
- **Semantic zoom transition:** on drill, the selected node's box grows into the child level's bounds over 200 ms,
  cross-fading (off under reduced motion, as elsewhere). Ctrl + wheel past a threshold over a node with a child =
  drill; past the opposite threshold = up. Plain wheel pans and zooms the SVG visually inside one level.
- **L5 Source view:** instead of a diagram, a source card: path, line range, commit, the related L4 node, and the
  code when the map holds it (a Repo Map `code` node, ≤ 40 lines). Links: "Open in VS Code" (`vscode://file/<root>/
  <path>:<line>`, when the map record knows the repo root, see §7.2), "Open on GitHub" when a repo URL is known.
  Acute never reads files itself (the Repo Map guard forbids `fs`, and there's no hosted file access). Missing code
  is requested from the IDE agent (§7).

### 5.3 Canvas entry points and indicators (never change Excalidraw behaviour)

Excalidraw's native context menu isn't customised here. PRD §7.2's menu maps to the surfaces we already own:

- **Properties panel** (`DiagramPanelSection`, frame selected): **✨ Open in Lens** as the primary button, plus
  "Set level" (the profile's levels) and, for a node, "Link to detail frame…" (pick a frame, or "New detail frame",
  which lands beside the parent frame, D23) and "Source" (path, lines; writes `acuteNode.sources`, Phase 1B).
- **Frame chip** (via `DiagramOverlay`, same transform as the legend): `✨ L2` on interactive frames, `●` while Agent Sync is on,
  `3Δ` when Lens has unseen changes. Clicking it opens Lens. It stays inside the Wave D indicator budget: one chip
  per frame, hidden in the overview zoom.
- **Keyboard:** `L` with a frame or node selected opens Lens at it.
- **Viz-ready (PRD §7.1):** a non-interactive frame with ≥ 3 shapes and ≥ 2 bound arrows gets a dim `✨` chip
  ("Make interactive and open in Lens"). No AI call, no automatic change.
- **Navigator:** under each canvas, a "Lens" row lists that canvas's root frames (interactive frames no other frame
  expands into).
- **Back to canvas:** closes or docks Lens, switches canvas if needed (client-side navigation, as Repo Map does),
  selects the element and zooms to it with the existing scroll-to helper the passport card uses, then flashes it once.

## 6. AI, on the existing runtime (no new stack)

All AI calls go through `AIRuntime.run(task, input)` with tasks registered in `ai/tasks.ts`, context from
`contextBuilder`, output validated by zod, and the user's own connection. Everything is optional: with no AI
connected, Lens works fully on what the canvas holds.

### 6.1 Explain (`lens_explain`)

Inspector "✨ Explain": input is the node, its neighbourhood, its parent chain (crumbs), its child frame's node list
and its evidence. Output is a short explanation, rendered in the inspector and saved as an AI conversation turn
(`aiConversations`) so it can be reopened. It writes nothing to the canvas unless the user clicks "Add as note",
which proposes a detail card linked `explained_by`.

### 6.2 Ask and navigate (`lens_navigate`)

A Lens search box ("Show me how payments affect orders") runs `tracePath` locally first. It uses AI only when name
matching fails, and then only to map the question onto node keys from `lensTree` (keys and labels only, bounded).
Result: Lens navigates to the lowest common level and highlights the path (PRD §18).

### 6.3 Generate the next level (`lens_expand`)

On a node with no child: "✨ Generate L3 for Webhook Handler". The architecture template produces a `VisualPlan`
(kinds, sublabels, explanations; frames-plan Phase 2 fields). It is rendered as a new interactive frame with
`level` and the parent's `expandsTo`, and proposed as a normal `ChangeSet` for review. Nothing is written without
Accept (PRD non-goal "automatically rewrite the canvas").

- **Where the frame lands (D7):** on a companion **Detail Canvas** "<canvas> · detail", created on first use (like
  "Repo map · <repo>") and editable like any canvas. The user's canvas stays as they drew it, and deep levels don't clutter it. Frames the
  user drew by hand stay wherever the user put them.
- **Code-grounded levels:** when the node has `sourceRefs`, or belongs to a Repo Map, the in-app model has no access
  to the code. Lens then offers "Ask your IDE agent" instead: it copies an MCP prompt (`expand_lens_node`, §7) for
  Claude Code or Copilot, which reads the code on its own subscription (the F43 principle: Acute pays nothing in
  tokens).
- **Evidence:** AI-generated nodes carry `acuteMeta.ai`, so the inspector says "AI-generated, not verified". Edges
  carry `confidence` when the model gave one.

### 6.4 Design review (`lens_review`, `lens_assess`; D65)

A collapsible **✨ Design review** card under Ask Lens (AI on, a diagram level showing; hidden on the L5 source card).

- **Assessment table.** Tabs **HLD questions (L0–L2)** and **LLD questions (L3–L5)**, defaulting to the open level's
  track. Each row: category, question, a chip for what the diagram itself shows (local, instant: "Seen on diagram" /
  "Not on diagram" / "Can't tell from shape", from node kinds and labels), and a verdict. **✨ Analyze N questions**
  makes one `lens_assess` call over the whole level and fills every row (verdict, a short answer, one improvement),
  with a tally ("1 strong · 12 partial · 1 gap"). Ids the model wasn't asked are dropped; a verdict outside the set is a
  schema failure (one repair, then an error).
- **Own questions.** "Add a question" per track; stored device-locally (`localStorage`, like other view state, §3.5), so
  they don't sync and aren't canonical (D2 stands: no canvas or Yjs change). Removable.
- **Single-topic review.** Buttons for Requirements, Capacity estimate, "What breaks at N×?" (growth factor field,
  2–1000, default 10), Failure modes and Tradeoffs (`lens_review`, Markdown), plus a free-text question. The assumptions
  box ("2M DAU, 5% at peak, read-heavy") is the only source of figures.
- **What the model is sent** (`reviewInput` / `assessInput`, bounded and passed through `redactSecrets`): the level's
  nodes (label, kind, sublabel, details), its links (from, to, relation, label, why), the levels above, `structureFacts`,
  the assumptions, and decision statements when supplied. Acute reads no code. Limits: 60 nodes, 120 links, 24 questions.
- **Honesty rules in the prompts:** keep "what the diagram shows", "what the user assumed" and "what I assume" visibly
  apart; a part the diagram can't show is "unknown" or a "gap", never assumed present; with no baseline in the
  assumptions, scale answers are relative (×N), not absolute. The panel says "AI-generated from this level and your
  figures; not verified against the code."
- **Question bank.** HLD: requirements, capacity, scale, entry/load balancer, caching, async, datastore fit, shared
  stores, single points of failure, external dependencies, consistency, security, observability, tradeoffs. LLD:
  responsibility, contracts, data model, validation, errors, idempotency, transactions, concurrency, timeouts, patterns,
  testing. The bank is ours to change: edit `REVIEW_QUESTIONS`, keep ids unique (they key the verdicts).

## 7. MCP: extend the existing server

Same server (`createAcuteMcpServer`), bridge, token, `ToolPolicy` and review path. Names follow the existing
`verb_noun` convention, not the PRD's `acute_viz_*`.

### 7.1 New tools (read tools unless noted)

| Tool | Does | PRD |
|---|---|---|
| `get_lens` | `lensTree` for a root (frame key, frame id, canvas name or map id). Keys, labels, kinds, levels, child links, evidence refs; bounded (≤ 2,000 nodes, `truncated`). Optional `around: key` + `up`/`down` depth (default 1/1) returns only the node's ancestor chain, its level and the levels below it: the vision spec's `get_architecture(node)` "centred, with zoom in/out", without a second tool. A `paths` filter answers "which nodes cite this file?", and each node's evidence is grouped by `role` (implementation / test / config / doc, D48). Paged overview-first with a version-tied cursor (G2, Phase 3) | get, find, zoom |
| `trace_lens_path` | `tracePath` between two keys or labels: dependency, data or execution kind; returns the path with the evidence per hop | trace |
| `get_lens_impact` (built in Phase 7B, D54) | A data-only wrapper over the pure `impactOf`, no UI. Input: `keys` (always works) or `changedPaths` (matched against evidence as it exists: `acuteNode.sources` after 1B, Repo Map `sourceRefs` after Phase 2). Returns modified, affected, related, plus `warnings` (D36: constraints and enforced decisions whose `refs` (D53) include an affected node or ancestor) and the decisions, open questions and risks on affected nodes, so "can I change this?" names what protects it. The Trace action and impact visualisation are Phase 3 | changes, impact |
| `focus_lens` | Opens the Lens panel in the tab at a node or level and highlights a key path. UI-only, no scene change, allowed even when writes are off. The agent's "look here" | zoom, navigate |
| `link_lens_detail` (write) | Proposes `expandsTo` / `level` on existing nodes and frames, for review, through the new `set_lens` change kind (D43) | update |

Creating and updating nodes stays with `upsert_map_section`, `render_visual_plan` and `update_block`. Lens adds no
second write path. Resource: `acute://lens/{lensKey}` (the same bounded payload as `get_lens`).

### 7.2 Repo Map becomes Lens-native

- `upsert_map_section` accepts an optional `level` per section, plus the new kinds and relation types. `parent`
  already creates the drill link. The begin call accepts an optional `repoRoot` (absolute path, local install only,
  stored in `RepoMapRecord`, never exported) for "Open in VS Code".
- `map_repo` playbook: overview section = L1 (L0 = one system card plus externals). Modules as children = L2. New
  optional step: for the main path, L3 flow sections for key handlers and L4 operation sections whose nodes carry
  `source` line ranges. A `code` node (≤ 40 lines) makes L5 show real code.
- New prompt `expand_lens_node(key)`: read the code behind one node and send its next level as a child section.
  This is what Lens's "Ask your IDE agent" copies.
- `get_map_status` also returns `affectedAncestors` for the stale keys (the §8.1 propagation rule): keys only,
  bounded like `stale`.

### 7.3 Project-profile tools (D27, D30–D39, Phase 7B)

Same server, bridge, token, `ToolPolicy` and review path as §7.1 — no second MCP stack. Every write proposes a
`ChangeSet` reviewed like any other (D6); every tool takes `project?` (D39) and goes through `ToolPolicy` (D41);
read tools are bounded and flag `truncated`.

| Tool | Does | Vision spec |
|---|---|---|
| `get_project` | The `project` node (name, style, focus), milestones with progress counts, the last session's `next` (D38). With no project yet, says so and points at `initialize_project` | §10.2 A `get_project`; §9 bootstrap "project, architecture style, current focus" |
| `list_projects` / `create_project` (write) | Lists `project` nodes in the workspace; proposes a new one (optionally from a template, §9 templates) | §10.2 A |
| `record_decision` (write) | Proposes a `decision` or `constraint` (status, reason, `options`/`chosen`, `enforce`, `refs` (D53) and `supersedes` / `deviates_from` links; D34) | §3 `record_decision`; §4 negotiation |
| `get_decisions` | Decisions and constraints, newest first, optionally filtered by what their `refs` point to (and that node's ancestors); each with its annotations (D35) and `warnings` (D36) split out | §3 `get_decisions`, decision firewall |
| `log_finding` (write) | Proposes a `finding` (`note`: discovery / hypothesis / assumption / concern), an `open_question` or a `risk`, with `refs` to the nodes it concerns | §3 `log_discovery`; §4 workflow 3 "during" |
| `get_open_questions` | Open questions (and, with `include: ["risk","finding"]`, risks and unvalidated findings) in scope | §3 `get_open_questions` |
| `update_knowledge` (write) | Promotes or changes status on any project-knowledge node by key: finding → validated → decision; decision → superseded; question → answered (D33) | §3 promotion lifecycle |
| `annotate` (write) | Proposes an `annotation` (`intent`) bound by `refs` to a node (D35, D53) | §3 `annotate`; §4 comments as intent |
| `get_implementation_plan` | Milestones and their progress items in order, with status and `next` marks | §10.2 E `get_implementation_plan`; `acute://project/implementation-plan` |
| `update_progress` (write) | Proposes status/order/`next` changes on progress items, or new items and milestones (`update_implementation_plan` is this tool) | §3 `set_task_state`; §10.2 E |
| `get_session_context` | The bootstrap call (D29, D37). Input: `task?`, `paths?`, `keys?`, `budget?` (chars, default 3,000, max 8,000), `project?`. Scope: keys → paths (via `sourceRefs`) → task (name match over `lensTree`, then `contextBuilder`'s keyword pass) → open-tab focus. Returns, in budget order: `warnings` (D36), project + focus + last session's `next`, the in-scope architecture nodes with their ancestors (keys, labels, levels), decisions and constraints whose `refs` point to them, open questions and risks, in-progress items, annotations, recent accepted changes on those nodes, `recentRejections` (what the user declined, with their reason when given, D46), and `{id, title}` of pages those nodes link to (D48). Each section says how much it dropped | §2 `get_context(task)`; §9 `acute_bootstrap`; workflow 2 |
| `sync_session` (write) | Takes D38's typed report and turns each list into the matching `record_decision` / `log_finding` / `update_progress` / `upsert_map_section` calls — one or more `ChangeSet`s for review, never a silent bulk write. Stores `summary`, `changed` and `next` on the session record; sets the project's `focus` when given | §9 `acute_sync`; §10.2 `sync_project_state`, `record_change` |
| `get_recent_changes` | Accepted change records (D31, D32), newest first: agent, session, tool, time, reason, touched keys, revertible or not. Filters: `session?`, `agent?`, `keys?`, `since?` | §10.2 E `get_recent_changes`; §10.3 |
| `get_session_history` | Session records (D38): agent, times, summary, changed paths, `next`, and their change ids | §7 "agent session history"; §9 "agent resumes previous task" |
| `get_session_review` | Before / during / after for a session or set of change ids (D47): prior state of touched nodes, what the session found, decided and changed, impact, new risks, open decisions, `needsReview`. With `get_lens_impact` it is the vision spec's `summarize_impact` | §3 `summarize_impact`; §4 workflow 3 |
| `revert_agent_changes` (write) | Proposes the inverse of the given change records (or a whole session) as a `ChangeSet`; edits made since become conflicts (D30) | §10.2 E `revert_agent_changes`; §10.3; MVP item 5 |

In this table, `refs` (D53) are semantic keys that may cross canvases, never canvas arrows. The `references` relation type remains for same-canvas arrows and for page links (`explained_by` / `references` to a page preview).
Resources (project-scoped, D39; same bounded-payload shape as `acute://canvas/{id}`): `acute://project/{projectKey}`,
`…/decisions`, `…/implementation-plan`, `…/progress`, `…/open-questions`, `…/changes`, plus `acute://lens/{lensKey}`
(§7.1) as `acute://project/architecture`'s equivalent. `sync_session` and `get_session_context` are the vision spec's
`acute_sync` / `acute_bootstrap` under this repo's `verb_noun` naming (D27); the names are locked by D55: no aliases, and a rename after release is an MCP API change.

**Prompts (Phase 7B):** `initialize_project` (run `map_repo`, then create the `project` node, record the current
implementation state as milestones/progress and any decisions visible in the code; "do not modify code"),
`update_architecture` (compare code with the map via `get_map_status` and re-send only what changed: `keep_lens_current`
generalised), `sync_progress` (call `sync_session` with the typed report) and `document_decision` (turn a discussion
into `record_decision` with options). Names follow this repo's prompt convention (`map_repo`), not the spec's
kebab-case.

**Server `instructions` (Phase 7B):** `createAcuteMcpServer`'s existing instructions gain the session loop: call
`get_session_context` before significant work, honour `warnings`, call `sync_session` after; Acute is the documented
architecture, not a substitute for the source code (vision spec §9 reliability layer 1 and the source-of-truth
hierarchy). Tool descriptions say when to call each one (layer 2). Layers 3–4 (generated `AGENTS.md` etc., the
composite tools) are the setup entry points below (D49) and this table respectively.

**Tool contract rules (2026-10-03, lessons review).** These shape what D49's generated instructions hard-code, so they are
fixed here and built in 7B:
- *Retrieval says how it went (C2):* `get_session_context` returns `retrieval_mode` and, when it fell back, `degraded_reason`,
  so an agent can tell a thin answer from a complete one.
- *Bounded keyword pass (C4):* it caps hits per object, so one large node can't fill the budget.
- *Budget fallback (C5):* when scope resolution finds little or the budget is small, return the requested keys truncated to
  the budget instead of an empty bootstrap.
- *Cancellation (B2):* `get_session_context` and `get_session_review` take the request's abort signal and stop when it fires.
  No current MCP tool does; only tests mention a signal.
- *Descriptions state limits (D1):* each tool's description names its bounds (`budget`, hit caps, `truncated`) and what it won't do.
- *One search tool (D2):* when CAP-01's semantic retrieval lands it extends `search_workspace`; there is no separate semantic search
  tool. This belongs to the final name review (D55).
- *Read-back tests (I3):* for each block kind an agent can create, a test writes it through MCP and reads it back through the
  matching read tool.
- *Search covers project fields (C6):* built in Phase 6; `get_session_context`'s task scope depends on it.

**Auto-accept (D44).** The existing per-session opt-in applies to the Project-profile writes above, so the agent's
read → work → `sync_session` loop doesn't wait on a click per call. It never covers `remove`, revert, a new
`constraint` or an `enforce: true` decision. Each auto-accepted change is still recorded with an inverse (D30).

**Setup entry points (D49).** Acute can't write into the user's repo, so it serves the agent-facing files instead:
resource `acute://setup/instructions/{client}` (`claude` | `codex` | `cursor`) and prompt `setup_project_instructions`
(the agent writes the file). The skill text and the workspace templates they contain belong to the agent-setup plan, which D56 requires before 7B counts as complete.
Premium or limited operations return `{ error: "entitlement_required", feature, limit?, upgrade? }` from `ToolPolicy`;
none are gated here.

**Phase 7C (D50, D62).** `delete_object` (existing), `update_connection`, `delete_connection`, `group_blocks`, `list_blocks` and
`get_block` on the same change-set path, so deletion is attributable and revertible like every other write.
## 8. Agent Sync: continuous architecture sync (D14, D15)

There is **no file watcher**, and there won't be one in the browser. Keeping L0–L5 current is the IDE agent's job,
through the existing Repo Map tools and change sets. Acute validates, reconciles, stages for review, and reports what a
change may affect. Lens only renders the result. The UI calls this **● Agent Sync**, not "Live".

```
Agent edits code ──changedPaths──► get_map_status ──stale keys + affectedAncestors──► agent
agent re-reads the affected nodes ──upsert_map_section (by key, per section)──► ChangeSet (pending) ──Accept──► Canvas/Yjs
Canvas/Yjs ──scene change──► lensView (current)       ChangeSet store ──► lensView.pending (proposed)
```

### 8.1 The sync contract

The MVP adds no new tool: the contract is written against today's tools, so a batching `sync_map` can come later
without changing what agents send per node.

1. **Identity.** Every node the agent sends has a stable key (§3.1.1) that it keeps across renames and line moves.
   The same key with a new label, source or relations is an **update** of that node (reconciliation already does this),
   never a delete plus a create. A key the user edited comes back as a conflict, not an overwrite (built).
2. **Level.** Each section says its level (`upsert_map_section` gains `section.level`, §7.2). `parent` gives the drill
   link to the level above (built). L5 is the `source` on L4 nodes plus an optional `code` node (D12).
3. **Incremental.** The agent re-sends only the sections that hold affected keys, one section per call, as today.
   Resending the whole map is never required.
4. **Propagation upward.** One source change can affect every level above it. From `changedPaths`,
   `get_map_status` already returns the keys whose `source` cites a changed path (`stale`). It will also return
   **`affectedAncestors`**: the parent chain of each stale key, walked up through `parent` (L4 → L3 → L2 → L1). The
   agent re-reads those sections, re-sends the ones whose meaning changed, and leaves the rest. Acute never rewrites an
   ancestor on its own guess.
5. **Provenance.** Every code-grounded node carries source path, line range and commit (`source` + the call's
   `commit`, stamped as `acuteMeta.sourceRefs`), plus `origin: "mcp"`, the map session, and the time staged. Lens shows
   "from your IDE agent · abc123 · 2 min ago" on the node's Evidence.
6. **Review.** Everything the agent sends is a pending `ChangeSet` part (D3, D6). Removals are never auto-accepted
   (`remove_map_nodes`, built).

### 8.2 What Lens shows

- **Current:** the canonical graph. It recomputes on scene change, debounced 150 ms.
- **Proposed (pending):** ghosts from the pending `ChangeSet` store, drawn over the current graph, never merged into
  it: `+ NEW` (green dashed), `~ changed` (amber), `− removed` (struck). Each has Accept / Reject through the existing
  review actions.
- **Stale:** cards citing a changed path (from `get_map_status`) show the existing amber dot. Their ancestors show a
  lighter "may be affected" ring.
- **Changes / Impact drawer (Phase 4):** pending and recent changes (session-local), plus Impact: `impactOf` over the
  changed keys, walked up the levels. Worded as **reach along drawn links, not blast radius** (Wave 1b item 5).
- **Agent Sync chip:** `● Agent Sync · updated 12 s ago` while an MCP session for this map has written in the last 10
  minutes (tooltip "Your IDE agent is keeping this architecture current"), otherwise `○ Agent Sync off`. **Pause**
  freezes the Lens view (current and ghosts) and counts incoming changes (Δ) until resumed. It doesn't stop the agent,
  the review bar or Accept on the canvas.
- **Canvas frame chip:** `Δ` for frames with pending or unseen changes. It clears when the frame is viewed in Lens.

Prompts: `keep_lens_current` (after each edit batch, call `get_map_status` with `changedPaths`, then re-send what's
affected) and a documented Claude Code `PostToolUse` hook recipe (documentation, not code). Positioning says "your
IDE agent keeps it current"; the word **Live** waits until the infrastructure earns it (D15).

## 9. Phases (D24/D19 for phase content; **build order per D51, closing open question 4**)

Each phase ends with `npm run typecheck && npm run lint && npm run test` green, plus its own tests. No AI runs
without the user's go-ahead.

**Build order (D51): 0 → 1A-i → 1A-ii → 6 → 7A → 7B → 7C → 1B → 2 → 3 → 4 → 5.** The table below is sorted in this
order, not phase-number order. Phase *numbers* still reflect what each phase contains and its real dependencies (a
phase's "Depends on" column is a dependency fact, independent of which order the team chooses to build in); only the
*sequence* changed. 1A-i and 1A-ii are the MVP for the hand-drawn architecture viewer (§10); 6–7C are the MVP for
the vision spec's end-to-end MCP loop (§10.2). Both need no AI; 7B needs no Repo Map, Trace or Agent Sync either
(D42).

### Phase 0 — clean-ups and minor fixes (from the 2026-10-01 plan review)

Prerequisites that 1A would otherwise break or trip over. No user-visible change. This phase touches only
`domain/canvas/diagram.ts`, `domain/provenance.ts`, a new `domain/sourceRef.ts`, `components/diagram/*`,
`ai/renderer/mapNode.ts` and `mcp/tools/repoMap/convert.ts`. It leaves the files the composite-shape work is changing
alone.

| # | Item | Status |
|---|---|---|
| 0.1 | **Settings writers keep the other half's fields.** `acuteNode` holds the descriptive `NodeSemantics` (kind, sublabel, tag, details: what AI and the panel write) and, separately, the `NodeLens` fields (`key`, `expandsTo`, `sources`). `acuteDiagram` holds `DiagramMeta` and the `FrameLens` fields (`level`, `lensKey`, `profile`). Each half has its own getter and `with…` writer, and each writer keeps the other half, so changing a kind or toggling "Interactive diagram" never wipes a Lens link. Values are validated per field (unknown, oversized or malformed values are dropped). AI and MCP input can't set Lens fields: `getNodeSemantics` reads only the four descriptive fields, so `mapNode` and the change-set writer needed no change | ✅ |
| 0.2 | **Relation labels have one home**, typed by `RelationType` (`RELATION_LABELS` in `diagram.ts`). Adding D9's relation types fails to compile until each one has a label | ✅ |
| 0.3 | **Repo source references: one format, one parser, one reader.** `domain/sourceRef.ts` has `formatRepoRef` (used by Repo Map's `convert.ts`) and `parseRepoRef` (`path#La-b@commit` → path, lines, commit). The element reader is `sourceRefsOf` in `domain/provenance.ts`, the reviewed provenance module, so 1B's evidence needs no new guard entry. Identity per D21 | ✅ |
| 0.4 | **Passport card and highlight paths shared.** Moved out of `DiagramOverlay.tsx` into `components/diagram/Passport.tsx` (card, kind chip; takes the frame title, not the overlay's frame type) and `diagramPaths.ts` (edge, hole and dim paths). The overlay renders exactly as before | ✅ |
| 0.5 | **Docs:** frames plan Phase 5's "semantic lens" renamed "kind filter", and its route probe reuses Lens's `tracePath` (one BFS); D21–D24; the fallback-layout note (§5.2); Phase 2 scope corrected (below); 1A split; open question 1 closed (D23); the composite-shape Ungroup bug on the master list (L4) | ✅ |
| 0.6 | **Gate:** typecheck, lint, the full unit suite, and the local e2e specs for diagram frames and composite shapes | 🟡 one unrelated timeout, below |

**Phase 0 notes (2026-10-01):**
- **Files:** `domain/canvas/diagram.ts` (+ tests), new `domain/sourceRef.ts` (+ tests), `domain/provenance.ts`
  (`sourceRefsOf`, + test), `mcp/tools/repoMap/convert.ts` (`repoRef` is now `formatRepoRef`), new
  `components/diagram/Passport.tsx` and `diagramPaths.ts`, `components/diagram/DiagramOverlay.tsx` (uses them).
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 1,320 / 1,321 passed (new tests: Lens fields
  ×4, relation labels, source refs ×3, `sourceRefsOf`); `diagramFrames.local` + `diagramShapes.local` 6 / 6 passed.
  `provenanceGuard.test.ts` passes unchanged: the only new reader is in `provenance.ts`.
- **The one failure isn't from Phase 0:** `repoMap.test.ts` "map_full past 60 sections or 1,500 nodes" exceeds
  vitest's default 5 s timeout in the full parallel run (≈ 7 s, twice). It passes alone (2.9 s), and its whole file
  passes (48 / 48). Phase 0 adds nothing measurable on that path. The cause isn't confirmed; `ai/changes/routing.ts`
  changed in the composite-shape work the same morning. Decide: give that test an explicit timeout, or profile it
  first (it may be a slowdown). Not changed here.

**Phase 1A-i notes (2026-10-03):**
- **Files:** new `domain/lens/{lensProfile,lensView}.ts` (+ tests); new `state/{lensPanel,sidePanelSlot}.ts`;
  `state/pagePanel.ts` (claims/releases the shared slot); new `uiPrefs.lensPanelWidth`; new
  `components/lens/{LensPanel,LensDiagram,LensPanelHost}.tsx`; `components/diagram/DiagramPanelSection.tsx`
  ("✨ Open in Lens"); `components/canvas/canvasCommands.ts` (`revealNode`), new `flashStore.ts` /
  `FlashOverlay.tsx`; `components/canvas/ExcalidrawCanvas.tsx` (wires `revealNode`, mounts the Lens host and
  flash overlay); `components/shell/AppShell.tsx` (the `#acute-lens-slot` div, closes Lens with the page panel);
  `components/pages/PagePanel.tsx` + `app/globals.css` (shared `.acute-side-panel` shell factored out of
  `.acute-page-panel`); new `e2e/local/lens.local.spec.ts`.
- **One-slot rule, implemented:** `sidePanelSlot.ts` is a tiny third store (not React) that `pagePanel` and
  `lensPanel` both call into on `open`/`close`, so opening either one closes the other regardless of which entry
  point triggered it — not just a JSX conditional in `AppShell`.
- **Where `LensPanel` gets the live scene:** it needs the real Excalidraw `api` (for `lensView` and to follow scene
  changes), but has to render as `AppShell`'s flex sibling of `<main>`, not as an overlay on top of it. `LensPanel`
  itself is rendered from inside the canvas tree (`LensPanelHost`, beside `DiagramOverlay`) and portaled into a
  `display: contents` div AppShell renders in its flex row — the same portal-out-of-the-render-tree idea as
  `usePanelSlot`, but targeting a stable id instead of watching Excalidraw's own DOM.
- **Reused verbatim, not forked:** `Passport`, `diagramPaths.ts` (`edgePath`/`dimPath`), `nodeNeighborhood`,
  `NODE_KIND_STYLES`, `relationStyle`, `ai/changes/routing.ts` — exactly what Phase 0 split out for this.
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 1,398 / 1,398 passed (new: `lensView` ×3);
  `diagramFrames.local` + `diagramShapes.local` + `lens.local` 7 / 7 passed. Also driven manually in a real
  browser session (frame → "Interactive diagram" → "✨ Open in Lens" → select a node → Passport + highlight →
  "← Back to canvas"): no console errors, scene unchanged.
- **Not done yet, on purpose (1A-ii):** level rail, breadcrumb, drill/up, `lensTree`, `acuteNode.key` identity and
  its copy rule, deep links. `LensDiagram` currently renders one frame with no child-frame resolution.

**Phase 1A-ii notes (2026-10-03):**
- **Files:** `domain/canvas/diagram.ts` (new exported `frameTitleOf`, factored out of `frameGraph` and reused by
  Lens); `domain/lens/lensView.ts` (rewritten: `lensView` now walks a node-key `path` into crumbs, `lensTree`
  recurses downward, both share one `lensLevel` core with depth-based level inference); new `domain/lens/identity.ts`
  (`nodeKeyFor` + tests); new `components/canvas/lensNodes.ts` (`ensureNodeKey`, `setFrameLevel`,
  `linkDetailFrame`, `createDetailFrame`, `detailFrameCandidates`); `components/canvas/richBlocks.ts`
  (`handleDuplicate` drops a copied node's/frame's Lens key, mirroring `keepsRelationOnCopy`); new
  `components/lens/lensHash.ts` (deep link read/write); `components/lens/{LensPanel,LensDiagram,LensPanelHost}.tsx`
  (level rail, breadcrumb, drill/up/jumpTo, ⌫ shortcut, "Zoom in" action, hash sync and restore);
  `components/diagram/DiagramPanelSection.tsx` ("Set level", "Link to detail frame…"); `selectedBlockStore.ts` /
  `diagramSelection.ts` (the frame's `level` and a node's `lens` now travel with the selection).
- **Level inference is depth-based, not a flat fallback.** `lensLevel` takes a `fallbackLevel` from its caller — the
  root's own level (explicit, else L1) for `lensView`'s first step, then `current.level + 1` for every subsequent
  drill, clamped to `LENS_MAX_LEVEL`; `lensTree` threads the same value through its recursion. A frame with no
  explicit `acuteDiagram.level` reads as "one past wherever you drilled from", not always L1.
- **Where `linkDetailFrame`/`createDetailFrame` simplify the plan's own `lensKey` story:** a frame's own element id
  is already permanently stable across renames, so `expandsTo.frameKey` is written as the raw frame id and resolves
  through `lensView`'s existing id-fallback — no frame ever needs an assigned `lensKey` for linking or viewing to
  work in 1A-ii. `acuteDiagram.lensKey` stays available (read, never written here) for a future human-readable or
  MCP-facing key.
- **"Link to detail frame…" reuses `RowMenu`** (the same flat, non-modal list idiom as Navigator's "Move to"), not a
  new picker component: "New detail frame" (via `ai/renderer/place.ts`'s `findPlacement`, anchored right of the
  parent per D23) first, then "Existing frames" (other interactive frames on the canvas).
- **The semantic-zoom transition is a simplified cross-fade + scale** (`@keyframes acute-lens-level-in`, 200 ms, a
  fresh React `key={path.length}` remount per drill/up step), not the full "selected node's box grows into the
  child's bounds" geometry morph the mockup describes; `prefers-reduced-motion` turns it off. The level rail is one
  fixed vertical list in both docked and expanded widths — the mockup's "horizontal stepper when docked narrow" is
  not built. Ctrl+wheel drill/up and plain-wheel pan are not built; zoom is the `− 100% +` buttons only.
- **Deep link restore races initial load, not effect order.** `LensPanelHost`'s restore effect reads `home` as a
  prop (not `getCanvasCommands()`): that registry is filled by a *parent* `useEffect`, which React always commits
  after a *child* component's own effects, so reading it here was always `null`. The scene itself can also still be
  empty at first mount (local persistence hasn't hydrated), so the restore retries on the first non-empty
  `api.onChange` rather than checking once, synchronously.
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 1,407 / 1,407 passed (new: `lensView` depth
  inference + loop/suggestion cases, `identity.test.ts`); `e2e/local/lens.local.spec.ts` 4 / 4 (the 1A-i test
  updated for the new breadcrumb header; three new: the North Star script through four linked frames and back
  including ⌫, AC11's reload, AC12's duplicate-drops-key/rename-keeps-key), plus `diagramFrames.local` /
  `diagramShapes.local` / `relations.local` / `pageDeletion.local` unaffected (11 / 11).
- **Not done yet, on purpose (1B):** `lensEvidence`, the node "Source" field, the L5 source card, cross-canvas
  `SceneSource`, the frame chip, Navigator's "Lens" rows. *(All built in 1B, below.)*

**Phase 1B notes (2026-10-03, built out of D51's order at the user's request, D60):**
- **Files:** new `domain/lens/evidence.ts` (`lensEvidence`, `codeEvidence`, `evidenceByRole`) and
  `domain/lens/repoLinks.ts` (VS Code / web URLs, pure), each with tests; `domain/lens/lensView.ts` (reads canvases
  only through the `SceneSource` interface, D41: `singleScene` for one canvas; `childFrame` carries its `canvasId`
  and `pending` while that canvas loads; `drillTarget`; the L5 source step; `lensRootFrames`, `frameLevels`);
  `domain/canvas/diagram.ts` (`SOURCE_ROLES`, `NodeSource.role`, D48); `domain/provenance.ts`
  (`evidenceOriginOf`, the one new provenance reader, inside the reviewed module, so `provenanceGuard.test.ts`
  needs no entry); `domain/sourceRef.ts` (`parseLineRange`); new `components/lens/{lensScenes,lensReveal,lensSlot}.ts`
  and `LensEvidence.tsx`; `LensPanel` / `LensPanelHost` / `LensDiagram`; `components/canvas/lensNodes.ts`
  (`setNodeSources`, `linkDetailFrameElsewhere`); `DiagramPanelSection` ("Source" field; "On other canvases" in
  "Link to detail frame…"); `DiagramOverlay` (frame chips); new `state/{lensRoots,lensRepoLinks}.ts`; `Navigator`
  (Lens rows); `app/globals.css`; four new e2e tests in `lens.local.spec.ts`.
- **Cross-canvas `SceneSource` deviates from §4's sketch:** it loads another canvas with `WorkspaceScan.scene` (the
  loader MCP reads already use: persisted Yjs updates into a throwaway `Y.Doc`), not `documentRegistry`, which
  holds rich-text documents, not canvas scenes. Nothing stays open, so there is nothing to ref-count or release.
  One canvas is open at a time, so a loaded scene can't go stale while Lens is open. Back to canvas onto another
  canvas navigates first and hands the element over (`lensReveal.ts`), revealed once that canvas's scene loads.
- **L5 is a step, not a frame (D12):** a node with code evidence and no child frame drills into a source card at
  the profile's `sourceLevel`. Any level's node can do this, not only L4's; the rail then shows L5 as current and
  the levels skipped as not linked, which is what AC7 asks for.
- **"Open in VS Code" / "Open on GitHub" need a target nothing stored yet** (Repo Map's `repoRoot` is Phase 2). The
  card has a device-local "Code links" form (local folder + repository URL, `meta` store, per workspace, never
  synced or exported). The links appear only once it's filled in (AC8). GitHub links use the source's commit,
  else `HEAD`.
- **Origin:** user-entered sources are "you"; agent `sourceRefs` take the element's provenance origin, so an MCP
  map card reads "your IDE agent". Imported objects read as "you". The content-source evidence item (§3.3's
  "acuteMeta.source and the content source") isn't built: nothing in 1B needs it, and it adds a second provenance
  reader.
- **Frame chips:** `✨ L<n>` above each interactive frame's top-right corner (level explicit, else inferred from
  the root that reaches it), and a dim `✨` on viz-ready frames (≥ 3 shapes, ≥ 2 bound arrows; one click makes it
  interactive, one undo step, and opens Lens). Hidden in the overview zoom, like the legend. The `●` / `3Δ` parts
  wait for Phase 4.
- **Navigator "Lens" rows** list the *open* canvas's roots only, under its pages, because the Navigator only
  expands the open canvas; the canvas publishes them through `state/lensRoots.ts`.
- **Fixed on the way:** the deep link wrote the *current* level's key as `#lens=`, so a reload after a drill
  reopened Lens with the child frame as its root. It now writes the root's key (crumb 0).
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 1,426 / 1,426 (new: `evidence.test.ts`,
  `repoLinks.test.ts`, `parseLineRange`, `lensView` cross-canvas / source level / roots); `lens.local` 7 / 7 twice
  (new: AC8 L4 → L5 → links → back; a drill into a second canvas and Back to canvas switching to it; frame chips and
  viz-ready), plus `diagramFrames` / `diagramShapes` / `relations` / `pageDeletion` 11 / 11. Phase 6 work landed in
  the same files concurrently, from another session, and still typechecks against this.

**1B audit fixes (2026-10-03, after a read-only audit of the 1B build against its scope):**
- **Deep links with more than one step never restored correctly.** The path was written `path=k1.k2`, but node keys
  contain dots themselves (`<frame>.api`), so splitting on `.` broke every step. Now one `path=` parameter per step
  (`lensHash.ts`); a one-step link in the old form still reads. Hash writes also keep `history.state` (they passed
  `null`, which wipes the Next router's own entry state).
- **A path step that no longer resolves stuck.** `lensView` stopped at a dead step (node or link gone, a linked
  canvas loaded without the frame, a stale deep link), but the stored `path` kept it, so every later drill appended
  after it and did nothing. `LensPanel` now trims the path to the steps that resolved (`lensPanel.trimPath`).
- **Level rail (AC7).** "Zoom in" from a node with code and no child frame lands on L5, but the rail enabled the
  next level (L3 from L2) instead; it now enables the level the drill actually reaches. With two crumbs at one level
  (an explicit level), the current row could become a "jump up" button; fixed.
- **Frame chips** read the open canvas as `"open"`, so a link that names the canvas's own id (a pasted cross-canvas
  link, a moved frame) wasn't seen and the chip showed L1; they now use the real canvas id.
- **Smaller:** "New detail frame" wrote the link twice (two undo steps) and unlinked the node if the parent frame
  was gone; the Source field dropped an over-long or multi-line path silently after clearing the input (now marked
  invalid and not added); a slow "On other canvases" scan from an earlier open could refill a newer menu; the
  device-local code-links load could overwrite a save made while it was in flight; closing Lens didn't clear the
  deep link, so a reload reopened it.
- **Evidence origin on another canvas:** documents were read through the open canvas's store, so a rich block's
  agent provenance there would read as "you". It can't happen yet (Lens nodes are shapes, which carry provenance on
  the element), but Phase 2's map cards would hit it: a loaded canvas now brings the documents its embeds point at
  (`workspaceScenes.ts`, below), and Lens's `getDocument` reads those first.
- **Tests:** a new `lens.local` e2e covers a two-level deep link with dotted keys, sources surviving a reload, a dead
  step dropped from a deep link, and close clearing it.

**Phase 6 progress notes (2026-10-03, paused at the user's request; built beside 1B, which ran in another session):**
Phase 6 is **partly built**: the domain layer, the canvas commands and the `update_node` change kind are in the tree and
tested; the panel and Lens UI that use them are not wired yet. Architecture frames behave exactly as before (see
Results). Nothing here is reachable from the UI today, apart from the shared types and tables listed first.
- **Shared code changed in place (what other work must know):** `domain/canvas/diagram.ts`: `NodeKind` is now
  `ArchitectureKind | ProjectKind`, and `NODE_KINDS` stays the architecture list only, so Visualize, Mermaid, Archify
  and the kind picker cannot produce a project kind (7B's MCP tools will set them through their own tools).
  `NODE_KIND_LABELS` / `NODE_KIND_STYLES` have the nine project entries. `acuteNode` now has **three halves**
  (descriptive `NodeSemantics`, Lens `NodeLens`, project-knowledge `NodeProject`), each with a getter and a `with…`
  writer that keeps the other two (`withNodeProject` is new); build `acuteNode` only through them. `LENS_PROFILES`
  gained `"project"`. `RELATION_TYPES` gained `supersedes` and `deviates_from` (D45), with labels and relation
  styles. `lensView.ts`: `LensNode` has optional `project` and `badge`, `LensLevelView` optional `lanes` and
  `summary`, and a frame's level is clamped to its own profile's last level (architecture unchanged). The selection
  store carries an optional frame `profile` and node `project`.
- **New and tested (domain):** `domain/canvas/nodeProject.ts` (the nine kinds, per-field per-kind validation, D33 /
  D34 / D39 / D53 limits); `domain/canvas/projectOps.ts` (what Promote and Choose do, `withRef`, `uniqueKey`);
  `domain/canvas/nodePatch.ts` (`applyNodePatch`, used by `update_node`); `domain/canvas/moveSet.ts` (`planMove`, the
  D59 planner); `domain/lens/projectLanes.ts` (lane layout, banner summary, badges); `domain/lens/refs.ts` (the D53
  key index: resolve, ambiguous, unresolved, inbound refs); `domain/lens/lensProfile.ts` (the project profile).
- **New (browser side):** `components/canvas/projectNodes.ts` (create a node in its lane, choose, promote, edit
  fields, add/remove refs, set a frame's profile); `components/canvas/moveToCanvas.ts` ("Move to canvas…" I/O);
  `components/lens/keyIndex.ts` (workspace-wide key index + `useKeyIndex`); `components/diagram/ProjectFields.tsx`
  (the panel fields, Choose / Promote, `refs` list with "Link to node…", "Move to canvas…"; **not rendered anywhere
  yet**). **`update_node` (D43)** is in `ai/changes/changeSet.ts`, `components/canvas/changeSetWriter.ts` and
  `components/ai/ChangeSetReview.tsx`; `hasKindStyle` moved into `nodeKindStyle.ts` so `setNodeKind` and the writer
  share it. Its patch is `NodeSemantics & NodeProject` with `null` clearing a field; Lens fields (`key`,
  `expandsTo`, `sources`) cannot be set by it and survive it; a kind change restyles the shape; it is not exposed to
  MCP yet (7B).
- **Not done:** wiring `ProjectFields` into `DiagramPanelSection` (frame: profile + "Add to project…" + Move; node:
  project fields for project kinds, refs and Move for every node); lane columns, banner and badges in `LensDiagram`,
  and the Lens inspector's Choose / Promote / refs; the cut/delete notice for a node other nodes `refs` (D59);
  CSS for `acute-project-*`; the Phase 6 e2e (create a project and a decision with options by hand, choose, promote
  a finding, reload; the D59 key-invariant script); unit coverage of the copy rule beyond AC12's e2e.
- **Where this reads the plan differently (flagged, not silently changed):**
  1. **L0 is the banner, not a drill.** The project profile keeps L0 "Project" and L1 "Lanes" as its levels, but L0
     is the overview (project node, focus, milestone and item counts) shown at the top of the L1 lanes view; a
     project frame opens at L1. There is no separate L0 view to drill from.
  2. **Lanes are an auto layout, not the canvas geometry** (D8's "user geometry wins" is for architecture levels).
     New nodes are also placed in their lane's column on the canvas so the two roughly agree.
  3. **A progress item belongs to a milestone through `refs`** (its refs include the milestone's key), because
     `contains` (D9) arrives with Phase 2. When `contains` exists, an arrow can be accepted as well.
  4. **Hand edits are canvas commands, one undo step each**, as 1A-ii's "Set level" and "Link to detail frame" are
     (D5 allows this for small manual edits), not change sets, although this row's wording says "proposed as a
     `ChangeSet`". Agent and MCP writes remain change sets (D6).
  5. **The key index reads canvases through `WorkspaceScan` directly**, all of them with a 30 s cache and an
     invalidation after a move, not through 1B's `LensSceneCache`. `SceneSource` can only answer "this canvas", not
     "which canvases exist", and a ref can point anywhere. D60 expected the one loader to be shared; merging the two
     is a follow-up (give `SceneSource` a canvas list, or have the cache expose its scenes).
- **"Move to canvas…" as built (D59):** planned by the pure `planMove`, written target-first as an incremental Yjs
  update, then the source is updated. It moves shapes, text, frames (with members), groups and arrows with both
  ends in the set, keeping element ids and every key; a frame gets its `lensKey` pinned to the id it had; a keyless
  node gets a key; a drill link is re-pointed (`canvasId`) so it still resolves; an arrow with an end left behind
  is unbound. It **refuses** rich blocks, page previews and images, a key already used on the target (it would make
  refs ambiguous), and an id that already exists there. It is **not an undo step** (undoing would bring the
  originals back beside the copies and duplicate every key): to reverse a move, move it back. Not handled: drill
  links from a *third* canvas to a moved frame are not updated; moved elements land to the right of the target's
  content with no z-index, so they sit at the bottom of its stacking order and rely on Excalidraw re-indexing when
  that canvas loads (**not yet confirmed in a browser**).
- **Key uniqueness:** `createProjectNode` makes its key unique with `uniqueKey`; 1A-ii's `ensureNodeKey` does not, so
  two nodes with the same label in one frame get the same key and a ref to it would be ambiguous. Using
  `uniqueKey` there is the obvious fix and is not done.
- **Added scope, not built (2026-10-03, lessons review): search covers project fields (C6).** Checked in code: `search/workspaceIndex.ts`
  and the AI context reader `ai/context/selectionContext.ts` read only shape labels and text, never `customData.acuteNode`. So a
  decision's `reason` / `options` / `chosen`, a finding's `note` and a question's `answer` would be invisible to `search_workspace`
  and to `get_session_context`'s keyword pass (D37); today the same is true of an architecture node's `sublabel` and `details`. Phase 6
  indexes and reads those fields, with the test named in its row. Attribution honesty is D61.
- **Results (groundwork):** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 145 files / 1,498 tests passed (new: `nodeProject`,
  `projectOps`, `moveSet` ×13, `projectLanes`, `refs`, `nodePatch`, `changeSetWriter`, `update_node` schema tests,
  and a project-frame block in `lensView.test.ts`); local e2e 27 / 27 (`lens` ×7, `diagramFrames`, `diagramShapes`,
  `relations`, `changeReview`, `repoMap`, `pageDeletion`), run with this groundwork in the tree. No project UI has
  been exercised in a browser and `moveToCanvas` has only been tested through its planner.

**Phase 6 completion notes (2026-10-03):** the UI the groundwork above left unwired, plus C6. Phase 6 is done.
- **Properties panel (`DiagramPanelSection`):** a frame shows its Profile select and, for a project frame, "Add to
  project…" (Set level is hidden there: a project frame's levels are banner and lanes) and "Move to canvas…". A
  project-kind node shows its kind as text (it changes only through Promote, D33), the per-kind fields with Choose /
  Promote (`ProjectFields.tsx`), and no detail-frame link or Source (a project node has no drill or L5). Every node
  gets the `refs` list with "Link to node…" and "Move to canvas…".
- **Lens:** `LensDiagram` draws a project level's lane columns ("Decisions · 2"), the project banner with the L0
  overview line (focus, milestones, items, proposed decisions, open questions, warnings) and each card's badge
  ("✓ Redis"). The inspector gains a Project section (`LensProject.tsx`): the node's fields, Choose and Promote
  (canvas commands, offered only for a node on the open canvas), its `refs` resolved across canvases with "show on
  canvas", and **"Referenced by"** for any node, architecture ones included ("which decisions affect this node?",
  D53 (1)).
- **D59's notice (`refNotice.ts`):** after any change that removes a keyed node that others `refs` (delete, cut), a
  toast says how many refer to it and points at "Move to canvas…"; the delete itself goes ahead (undo restores it
  with its key). "Move to canvas…" announces the ids it removes, so a move is never reported.
- **C6:** `itemFromElement` (`ai/context/selectionContext.ts`), which both `search/workspaceIndex.ts` and the AI
  context read, now includes a node's descriptive and project fields (`nodeFieldLines` in `diagram.ts`: kind and
  status, sublabel, tag, details, focus, reason, options, chosen, finding note, answer; never keys or refs). A kind
  alone on an unlabelled shape still isn't content.
- **Fixed on the way:** 1A-ii's `ensureNodeKey` now makes keys unique in the scene (`uniqueKey`), so two
  same-labelled nodes in a frame no longer share a key. The key index's cache was per workspace but left out
  whichever canvas was open when it was built, so after switching canvas the one just left (and every ref on it)
  was missing; it now caches every canvas, filters the open one at read time, and is dropped when a canvas is left.
- **One canvas loader (closes deviation 5 above):** `components/lens/workspaceScenes.ts` loads other canvases
  (scene plus the documents its embeds point at) once per workspace, for Lens's drills (`LensSceneCache` is now a
  synchronous view over it), the key index and "On other canvases". Leaving a canvas and "Move to canvas…" drop it;
  an entry older than 30 s is re-read (Lens shows the old copy meanwhile, not "loading").
- **Copy rule unit-tested:** `dropsLensKeyOnCopy` moved from `richBlocks.ts` to `domain/canvas/diagram.ts` (pure),
  tested there (a node's key dropped with its kind, project fields, own `refs`, drill link and sources kept; a
  frame's `lensKey` dropped with its level and profile kept; keyless and non-node elements untouched), and
  `handleDuplicate` has its own test (`richBlocks.test.ts`: duplicate, paste onto another canvas, nothing to change).
- **Still open:** moved elements' z-order on the target relies on Excalidraw re-indexing (it loaded fine in the e2e).
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 145 files / 1,503 tests (new: C6 in
  `selectionContext.test.ts` and `workspaceIndex.test.ts`, `keysRemoved`); new `e2e/local/lensProject.local.spec.ts`
  2 / 2 (a project frame by hand: a project node with focus, a decision with two options, Accept blocked until a
  choice, Choose, a finding validated then promoted with its key kept, the lanes / banner / badge in Lens, a reload;
  D59: a decision refs an architecture node via "Link to node…", "Move to canvas…" moves the node to another canvas
  with its id and key, the ref still resolves, no notice for the move, and deleting it on the target raises the
  notice); `lens.local` 8 / 8. The full local e2e suite: 126 / 127 at first; the one failure was a stale count in `visualize.local` ("the template picker…" expected 9 cards, the picker lists 10: Auto plus nine templates since Wave E's `causal_map`), now corrected. After the follow-ups above: `vitest run` 146 files / 1,509 tests; `visualize` / `lens` / `lensProject` / `diagramFrames` e2e 23 / 23.

**Phase 7A notes (2026-10-03):** Agent State, built. Nothing about it is gated or metered.
- **Files:** new `ai/changes/agentState.ts` (pure: record types, `AGENT_STATE_LIMITS` — D58's constants in one place
  —, `diffScenes`, `boundedInverse`, `changeRecord`, `retain`, `planRevert`, `autoAcceptable`, `summarizeArgs`) and
  `state/agentLog.ts` (the browser service: records at Accept / Reject / expiry, session records and usage,
  retention, `stageRevert`, `useAgentLog`); `persistence/db.ts` migration **v7** (`agentChanges`, `agentSessions`,
  both `byWorkspace`) with the `AgentStateRepository` in `repositories/{types,indexeddb,memory}.ts`;
  `ai/changes/changeSet.ts` (`restore` kind, `StoredElementSnapshot`, `ChangeSet.agent` / `reason` / `args` /
  `reverts`, a generalised `ConflictItem`); `components/canvas/changeSetWriter.ts` (writes `restore`);
  `ai/changes/pendingChanges.ts` (D40, rewritten); `ai/changes/autoAccept.ts` (D44 sessions);
  `components/ai/acceptPending.ts` (`acceptPendingSet`, the one accept path for the review bar and auto-accept, both
  logging); `components/ai/ChangeSetReview.tsx` (set chooser, reject reason, revert-conflict wording, D44 toggle and
  status); new `components/ai/AgentHistoryTab.tsx`; `mcp/tools/{writeTools,index,liveCanvas}.ts`, `mcp/server.ts`,
  `McpBridgeHost.tsx` (session ids, attribution, usage); repo-map sets carry `agent` too.
- **The inverse is a scene diff (deviation in method, not in D30's contract).** A change set is written in one scene
  update, so the before-state is "every element that write added, and every element it changed, as it was":
  `diffScenes` over the scene just before and just after the write. That catches bound labels, arrows re-bound to
  a moved shape, a frame that grew and a composite shape's outline, which a per-change-kind inverse would have had to
  enumerate. Each touched element records its `afterVersion`; a later version at revert time means "edited since".
- **D40 slots.** A pending set's slot is its merge key when it has one (a repo map merges across that map's
  sessions, as before), else its session, else the in-app session `"app"`. A new proposal in a slot replaces the one
  there (logged as **expired**, D46); one that touches an element a set in another slot touches is refused with
  `PendingReviewError` naming that set. The review bar shows the selected set and, when several wait, a chooser. MCP
  write tools refuse only while *their own* session has a set waiting; each MCP connection gets an `mcp_…` session id.
- **Revert (D30).** `planRevert` takes, per element, the oldest record's inverse (the state before all of them) and
  checks the newest record's `afterVersion`: a `remove` for what a change created, a `restore` (keeping id and
  bindings, re-creating it if it is gone) for what it changed or removed; an element edited since becomes a conflict
  whose card offers "Revert anyway" / "Keep current" (keeping adds nothing). A removal of something already gone is
  dropped. The revert is an ordinary change set in the in-app session (`createdBy: "import"`, task `revert`,
  `reverts: [ids]`); accepting it writes its own record and sets `revertedBy` on what it reverted. Phase 7B's
  `revert_agent_changes` tool proposes the same set from its MCP session.
- **Retention (D58).** The newest 500 records or the last 30 days, whichever keeps more, stay revertible; past that a
  record loses its inverse first (listed, no longer revertible), and past **twice** those bounds it goes — the plan's
  "then go" had no second bound, so this is the reading taken. An inverse over 2 MB (or any single snapshot over
  200,000 characters) isn't kept, and the change is listed as not revertible.
- **Attribution (D32, D61, E3).** Every MCP write's set carries `session`, `agent` (the sanitized client name, absent
  rather than empty when the client gives none), `metadata.task` and an `args` summary (≤ 2 KB, secrets redacted),
  and the record copies them with `at`. The log says "Codex (as reported by the client)"; nothing trusts it.
  `credentialId` is reserved on both record types and unset.
- **Usage (D46).** `registerAcuteTools` wraps every tool it registers, so each call reports its session, the client's
  name, the tool and the characters returned; the bridge host adds them to the session record (loaded lazily, so the
  shell bundle doesn't grow).
- **Auto-accept (D44).** The per-session store, the `autoAcceptable` gate (never a removal, a restore, a new or
  converted `constraint`, an `enforce: true` patch, or a set with conflicts), the canvas's `acceptSet`, the write
  tools' `status: "applied"` and the review bar's toggle and "auto-accepted N this session" status are built. The
  list of tools it may apply to (`AUTO_ACCEPT_TOOLS`) is **empty until Phase 7B** registers the Project writes, so no
  current tool can be auto-accepted; the scripted test injects a list.
- **Where the log lives:** a third AI-panel tab, **"Agent log"**, and ⋮ More → "Agent log" (the panel's existing
  "History" tab is AI conversations, so the plan's "History" name would have collided). Records grouped by session,
  with outcome, time, tool, the client's reported name, reason / reject reason, objects touched, "Show on canvas" and
  "Revert…".
- **Known limits:** ~~a shape moved by hand after an agent's change gives two conflict cards on revert (the shape and
  its bound label), each decided on its own; agent records aren't deleted with their workspace~~ (both fixed in the
  7A–7B follow-ups below); Phase 7B's Session review view and `recentRejections` read these records but aren't built.
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 149 files / 1,534 tests (new:
  `agentState.test.ts` ×14 — diff/inverse per op, bounded inverse, attribution, reject reason, args redaction,
  retention ×3, revert of create/update/remove, conflict when edited since, skips, D44 policy; `pendingChanges.test.ts`
  ×4 — two sessions on one canvas, overlap refusal naming the set, expiry, independence of canvases;
  `changeSetWriter.test.ts` restore ×2; `mcp/tools/agentState.test.ts` ×5 — E3 for every write tool, a nameless
  client, two MCP sessions, per-session usage, auto-accept on/off and a removal never auto-accepted; the D40 parts
  test and the schema test updated); new `e2e/local/agentHistory.local.spec.ts` 2 / 2 (accept an agent's change →
  Agent log row with the reported name and reason → Revert… → review → restored, the added shape removed, "Reverted"
  shown; an edit since → conflicts → "Revert anyway"; two sessions' sets side by side; a rejection logged with its
  reason). Full local e2e: the first run found three tests matching the tab name "History" (now "Agent log"); those
  specs then passed 22 / 22.

**Phase 7B notes (2026-10-03):** the Project-profile MCP surface, built on the approved agent-setup plan.
- **Files (pure, portable — D41):** new `domain/project/workspaceGraph.ts` (every canvas as one graph: nodes and
  frames addressed by key *and* element id, relations per canvas, the drill hierarchy across canvases, `ancestorsOf`),
  `knowledge.ts` (projects and scope D39, decisions with annotations D35, warnings D36 with deviations D45, open
  questions, the implementation plan), `impact.ts` (`impactOf`, D54: reverse relations to depth 2, the levels above,
  what they depend on, the knowledge pointing at them; `nodesCitingPaths`), `sessionContext.ts`, `sessionReview.ts`
  (D47), `projectChanges.ts` (lane placement shared with the panel, new-node changes, the Part B templates); new
  `mcp/setup/instructions.ts` (the setup artifact) and `appArtifact.ts`. **MCP:** new `mcp/tools/projectTools.ts`
  (the 18 tools) and `projectResources.ts` (6 project resources, `acute://setup/instructions/{client}`, 5 prompts);
  `tools/index.ts` (wiring, `liveRegistry`, `availableToolNames` with the project tools), `server.ts` (instructions
  gain the session loop; `agentState` dep), `writeTools.ts` (`proposeChangeSet` exported: the project writes use
  the same path, attribution and D40 slot), `common.ts` (D49's `entitlement_required` shape and
  `ToolPolicy.entitlement`, unused). **App:** the Agent log's **Session review** view; MCP access → **Agent
  instructions** Copy / Download (built from a server constructed as the bridge builds it).
- **Tools (D55/D62 names):** reads `get_project`, `list_projects`, `get_decisions`, `get_open_questions`,
  `get_implementation_plan`, `get_session_context`, `get_recent_changes`, `get_session_history`,
  `get_session_review`, `get_lens_impact`; writes `create_project`, `record_decision`, `log_finding`,
  `update_knowledge`, `annotate`, `update_progress`, `sync_session`, `revert_agent_changes`. Every write takes a
  required one-line `reason` (D32). `AUTO_ACCEPT_TOOLS` now holds D44's six Project writes; the review bar's toggle
  appears for them.
- **Changes to existing models (flagged):**
  1. *`create_shape` carries `project` (a validated `NodePatch`) and `lensKey`*, set by the tool, never from agent
     input: a project node needs its key and fields at creation for refs to resolve (D53). The **project kind
     travels in `project.kind`**, because `semantics.kind` accepts architecture kinds only (Phase 6's rule that AI and
     Visualize input can't produce a project kind stays true). `create_frame` gains `profile: "project"`, and a frame
     named with no children is created empty (templates).
  2. *`supersedes` and `deviatesFrom` are project fields (keys)*, beside `refs`, so a deviation or a retirement can
     cross canvases (D53 rule 3: never faked as an arrow); an arrow with the D45 relation is drawn too when both
     decisions share the open canvas. Superseding on the open canvas also sets the old decision's status.
  3. *Refs may name a node by element id as well as by key* (the resolver and the D59 notice index both): an agent can
     ref a node it read from `get_canvas` before the node has a key; ids survive a move too.
- **Where project knowledge is written:** in the project's Project state frame, which must be on the open canvas
  (writes only ever propose there); otherwise the tool names the canvas to open. With several projects and none
  named, a tool refuses with the list (D39).
- **`get_session_context`:** scope keys → paths → task (a name match, then a keyword pass over every node's text,
  capped at 3 hits per object, C4) → the open tab's selection; `retrieval_mode` and `degraded_reason` (C2); budget
  default 3,000, max 8,000, **min 1,000** (the plan set no minimum; below about 1,000 the empty section headers alone
  overflow) — the payload never exceeds it, each section reports what it dropped, and requested keys always come back
  (C5); it honours the request's abort signal (B2). Sections: warnings, project (+ previous session's `next` and
  summary), architecture (with the levels above), decisions, open questions and risks, in-progress items,
  annotations, recent changes, recent rejections (D46), linked pages (D48).
- **`sync_session`:** decisions, findings, progress and focus become **one** proposal; `summary`, `changed` (≤ 50)
  and `next` (≤ 10) go on the session record. `architecture` was at first section keys only, returned with a hint to
  send them with `upsert_map_section` (a narrowing of D38's "each list becomes the matching write call"); the 7A–7B
  follow-ups below make it write them.
- **`get_session_review`:** `needsReview` lists every architecture node the session touched (`needsReviewBasis`),
  because nothing records which nodes the user has opened in Lens.
- **Setup (setup plan Part A, Q1–Q3):** the artifact is generated per call from the server's live registry; an
  optional tool group the server doesn't serve (the repo-map tools, served only with their store) is left out via a
  conditional block instead of failing, and the read-only variant also drops the "record the exception" sentence. Client
  conventions verified against each client's documentation (recorded in the setup plan).
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 152 files / 1,572 tests (new: `domain/project`
  ×22 — graph, warnings incl. ancestors and deviations, project scope, impact, session context incl. budget ≤ budget at
  three budgets, fallbacks, C4, C5, B2, session review, all four templates, the starter plan, node builders;
  `mcp/setup/instructions.test.ts` ×11 — MC11 (a)–(f) per client, writes on/off, unresolved placeholder throws, optional
  group omitted, style line, prompt; `mcp/tools/projectTools.test.ts` ×5 — **the MC1–MC10 slice end to end over scripted
  clients with the real writer**, D40 waits, D39 refusals, writes off, MC11 over the server; list tests updated for the
  new tools, resources and prompts); new `e2e/local/mcpSlice.local.spec.ts` 1 / 1 over the real HTTP bridge
  (bootstrap without a project, create_project, a constraint on an architecture node by id, the Decisions lane in Lens,
  sync_session, a second agent's warning and `next`, the revert removing exactly what the sync added, the Agent log and
  its Session review). Full local e2e: 130 tests; one long run passed 108, then a browser crash on this machine (a hang in `sectionUpdates`, then `Target crashed` / worker exit `0xC0000142`) failed or skipped the remaining 22; re-run on their own, `sectionUpdates` 3 / 3 and the other four specs 21 / 21 passed.

**Phase 7C notes (2026-10-03):** the core object tools, on the change-set path (D50, D62).
- **Tools:** `update_connection`, `delete_connection`, `group_blocks` (writes) and `list_blocks`, `get_block` (reads), in
  new `mcp/tools/objectTools.ts`; `delete_object` is the existing tool (D62), unchanged. Every write is a reviewed set in
  the MCP session's slot, attributed and logged with its inverse (so `revert_agent_changes` undoes it) and outside
  `AUTO_ACCEPT_TOOLS`; `delete_connection` is annotated destructive like `delete_object`.
- **Two change kinds added (D50 named the tools, not how they'd be carried):** `update_connection { target, relation?,
  label?, explanation? }` (null clears; a relation change also restyles the line per `relationStyle`; a label is added as
  a bound text element when the arrow had none, removed when cleared; the arrow itself changes only for relation or
  explanation) and `group_objects { key, title, targets }` (a new titled frame around existing objects and their labels;
  frames can't nest, so an object already in a section, an arrow or a frame is refused). Both are in the review list and
  ghosts; the summary counts them as an update and a section.
- **Fixed on the way (7A's revert, found by these tests):** (1) a restore merged the snapshot over the current element,
  so a field the snapshot lacked survived; it now rebuilds the element from the snapshot, keeping only the current
  version and z-order. (2) A revert over a live-only scene (what MCP sees) didn't notice an element the user deleted
  after the agent's change and would have resurrected it; `planRevert` now treats "absent although the change didn't
  remove it" (or deleted at a later version) as edited since, a conflict.
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 152 files / 1,578 tests (new: 7C ×5 in
  `projectTools.test.ts` with the real writer — delete → Accept → log → revert restores the object with its id, label
  and arrow binding; `update_connection` relation / label / explanation read back by `get_block`, a cleared label, and a
  revert whose label changed since coming back as a conflict; `delete_connection`; `group_blocks` with `list_blocks`,
  nesting refused, revert removing the frame and clearing `frameId`; writes off; and the deleted-since `planRevert`
  case); listing tests updated. E2e: `agentHistory`, `mcpSlice`, `mcpAccess`, `changeReview`, `reconcile`, `repoMap`,
  `lensProject`, `lens`, `sectionUpdates` 35 / 35.

**7A–7B follow-ups (2026-10-03):** the known limits above, fixed beside Phase 3.
- **Agent records go with their workspace:** `deleteWorkspace` (`workspaces/hierarchy.ts`) ends with the new
  `AgentStateRepository.deleteByWorkspace`, which removes the workspace's `agentChanges` and `agentSessions` in one
  IndexedDB transaction (memory repository likewise); other workspaces' records stay.
- **One conflict card for a shape and its label:** `planRevert` (`withBoundLabels`) folds a bound label's conflict into
  its container's when both conflict (a hand move bumps both): a restore travels in the container card's new
  `ConflictItem.alsoApply` (schema-checked, ≤ 10), which "Revert anyway" applies with it (`withDecisions`,
  `acceptParts`) and the D40 overlap check counts; a removal is dropped, since removing the container removes its
  label. A label edited on its own is still its own card. The card shows the label's before-text.
- **`sync_session` writes architecture (D38 in full):** an `architecture` entry may be `upsert_map_section`'s input
  (mapId, commit, section, nodes, relationships; ≤ 10 per call), written through the same writer
  (`registerRepoMapTools` now returns it; `ProjectToolDeps.upsertMapSection`) and so staged on the map canvas in the
  map's slot, attributed and auto-accepted exactly as that tool would; the result lists a status per section (staged,
  applied, unchanged, rejected with its reason, error) and a failed one doesn't stop the others or the report.
  `{ sectionKey }` alone is still accepted and only reported, with the hint. Without the repo-map tools a section comes
  back as an error. Description, `sync_progress` prompt and the setup artifact's "End of a session" mention it.
- **Fixed on the way:** a `sync_session` with nothing to propose (summary / next / architecture only) failed MCP
  output validation (`status: "recorded"` wasn't in `PROPOSED_SHAPE`); it has its own output schema now.
- **Results:** `tsc --noEmit` clean; `eslint` clean on the touched areas; `vitest run` 152 files / 1,598 tests (new:
  workspace deletion ×1 and the repository ×2 (memory, IndexedDB); `planRevert` bound labels ×1 (moved container,
  added container, label alone); `sync_session` ×3 in `repoMap.test.ts`: sections staged / rejected / reported,
  summary-only, the cap); `agentHistory` e2e now asserts one card and the label restored. E2e `agentHistory`,
  `mcpSlice`, `repoMap`, `changeReview` 12 / 12. After Phase 3 landed: `vitest run` 155 files / 1,626 tests.

**Phase 2 notes (2026-10-03):** Repo Map → Lens, with D21 identity (D64).
- **Identity (D21, D64):** `lensIdentityOf` (provenance) → `domain/lens/identity.ts` (`lensKeyOf`, `mapIdentityOf`,
  `lensCopyData`); a new suite in `provenanceGuard.test.ts` allows only those two files to call it. `lensView`, the
  cross-canvas key index (`refs.ts`, `keyIndex.ts`), the D59 removal notice and the MCP workspace graph all key nodes by
  `lensKeyOf` (and pass documents, since a card's provenance is on its document). `handleDuplicate` applies
  `lensCopyData` before cloning a card's document; `ensureNodeKey` never overwrites a map identity.
- **Map cards are Lens nodes:** new `domain/lens/cards.ts` — a card is a bordered rich block or a page preview inside the
  frame (frameless text, like a section's title, isn't); its label is its title or first line. `frameGraph` takes them
  as `extraNodes`, so relations between cards and shapes are drawn; drills from a card follow its `explained_by` arrow
  (the map's parent link) as before. The summary card of a section counts as a card too.
- **Map sections are Lens levels:** every section is an interactive group (`diagram: "architecture"`); `section.level`
  (0–4) is validated, carried in the group, written as the frame's `acuteDiagram.level`; without it the level is inferred
  by depth (Phase 1A-ii). **Kinds on map nodes:** `kind` on any map node (architecture kinds only: the five new L3–L4
  kinds `endpoint`, `step`, `function`, `event`, `store` join `NODE_KINDS` with styles and labels); a shape carries it in
  its semantics, a rich-block card in its own `acuteNode` (new `create_block.semantics`, VisualNode `kind`). Level and
  kind are part of the section's content version.
- **D9 relation types:** `calls`, `reads`, `writes`, `publishes`, `subscribes`, `contains` join `RELATION_TYPES`, with
  labels (`RELATION_LABELS`, the relationship picker) and line styles (`relationStyle`); the map and MCP schemas read the
  list, so they accept them.
- **Relations update by key (a change to F43's reconciliation, flagged):** before, once two nodes were linked by any
  arrow the map never touched that link again, so a changed relation type or direction was ignored. Now, for the
  section's *own* arrows only: a changed type is proposed as `update_connection` (7C's change kind); a reversed direction
  replaces the arrow. The user's own arrows still only count as "already linked".
- **`repoRoot`:** optional on `begin_repo_map` (an absolute local path), kept on the device-local `RepoMapRecord`
  (`RepoMapRepository.listByWorkspace` added); the L5 card's "Open in VS Code" uses it when the user set no local folder.
- **L5 shows the map's code:** `mapCodeFor` finds a Repo Map `code` card citing the same path (overlapping lines first)
  and the source card shows it ("a card your IDE agent put on the map"); Acute still reads no files.
- **Prompts:** `map_repo` gains the level, kind and relation guidance; new `expand_lens_node(key)` (send a card's next
  level as a child section).
- **Not done / limits:** a kind changed on an existing card isn't applied by a re-send (kinds are written at creation; a
  later change needs `update_node`, not in the map's reconciliation); map sections created before Phase 2 aren't made
  interactive retroactively (re-sending updates content, not the frame's diagram flag); a frame chip above a frame at the
  very top of the view sits under the app header; `affectedAncestors` in `get_map_status` stays Phase 4 (§8.1).
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 152 files / 1,591 tests (new: the scripted map opened
  in Lens down to L5 with the map's code; **the four D21 tests** — in-place update by K with a new label, source and
  relations; a conflict on a user-edited K; identity kept across those changes; a copy without K, in Lens and through
  `handleDuplicate`; identity precedence and the copy rule in `identity.test.ts`; the guard suite; schema and convert
  tests for `level` and `kind`; the repo-map test writer now stamps frames, kinds and `update_shape` /
  `update_connection` like the real one); new `e2e/local/lensRepoMap.local.spec.ts` 1 / 1 over the real bridge
  (`repoRoot`, two levelled sections, Accept, the chip's `✨ L1`, kinds and a `calls` relation in Lens, L1 → L4 → L5 with
  the code card and the VS Code link); affected e2e (`repoMap`, `lens`, `lensProject`, `diagramFrames`, `diagramShapes`,
  `relations`, `reconcile`, `sectionUpdates`, `visualize`, `mcpSlice`, `agentHistory`, `changeReview`) 51 / 51.

**Phase 3 notes (2026-10-03):** the Lens MCP tools, Trace, the impact view and paged reads (G2).
- **Files (pure, D41):** new `domain/lens/trace.ts` (`tracePath`, `findTraceEnd`, `TRACE_KINDS`), `paging.ts` (scene
  version, cursors), `locate.ts` (the root and drill path to a node's level, shared by `focus_lens` and the panel);
  `lensView.ts` gains `lensFrame` (one level) and a depth bound on `lensTree`. **MCP:** new `mcp/tools/lensTools.ts`
  (the four tools and `acute://lens/{lensKey}`) and `lensFocus.ts` (the tab host `focus_lens` calls, registered by
  `LensPanelHost` like `LiveCanvasActions`); `index.ts` / `server.ts` wiring (`getLensFocus` dep), `readTools.ts`
  (`get_canvas` paging), `resources/reader.ts` + `serializers.ts` (a page window). **App:** `LensOverlays.tsx` (Trace
  and Impact cards, the marks), `lensWorkspace.ts` (the workspace graph, built only while Trace or Impact is open),
  `LensPanel.tsx` (the two node actions, the agent-highlight card, "Loading the linked canvas…" for a root on another
  canvas), `LensDiagram.tsx` (marks), `state/lensPanel.ts` (`highlight`, `trace`, `impact`).
- **`tracePath` runs over the workspace graph, not `lensTree`** (§4 sketched `tracePath(tree, …)`): it is the graph
  `impactOf` already uses (D54), it crosses canvases and every drill link, and it is what the MCP tool has without a
  root. One BFS: relations (filtered by kind — `dependency`, `data`, `execution`, `any`) plus level hops (a node to the
  nodes of the frame it drills into, and `contains` arrows), allowed in every kind. A path along the arrows wins;
  only without one may a hop run against its arrow (`forward: false`). At most 12 hops. Each stop carries its code
  evidence.
- **Changes to existing models (flagged):**
  1. *`GraphNode` gains `code` and `drillsTo`; `GraphEdge` gains `explanation`.* `code` is the node's code evidence
     including Repo Map `sourceRefs`, so **`get_lens_impact`'s `changedPaths` now matches map nodes too** (§7.1 said it
     should after Phase 2; `nodesCitingPaths` read only `acuteNode.sources`). `drillsTo` keeps every node's drill link:
     `drilledFrom` holds one parent per frame, so a frame two nodes drill into lost a link for Trace.
  2. *`drilledFrom`: when several nodes `expandsTo` one frame, the first in canvas order is its parent* (before: the
     last). Deterministic; it only matters for `ancestorsOf` on such a frame.
  3. *`set_lens { target, level?, expandsTo? }` (D43)* joins `ProposedChange`: schema (level 0–5, a strict
     `{frameKey, canvasId?}`, null clears), the writer (a frame's `level`, a node's `expandsTo`; nothing else), the
     review bar ("Lens: Orders — zoom in to “Payment parts”"; frames are now named there by id and Lens key) and the
     summary (an update). Its inverse is the scene diff Agent State already stores (D30), so it reverts like any write.
- **`get_lens`:** `root` (a frame's key or id, a canvas id or title with one Lens root, or a node → `around`); none →
  the workspace's roots (or the only one's tree). `around` + `up`/`down` (default 1/1): the levels above, the node's
  own, and below it only its own detail. `paths` keeps nodes whose code evidence cites the file. Evidence grouped by
  role (D48). At most 2,000 nodes / 500 frames (`truncated`). The map id the plan listed as a root isn't accepted: the
  map's canvas id works instead.
- **Paging (G2):** a cursor is base64url JSON of the listing, the **scene version** (a 64-bit hash over every
  element's id, version and deleted flag on the canvases read), the offset and a hash of the other arguments. A cursor
  from before an edit, or for another query, is refused with "start again". `get_lens`: page 1 carries every level's
  outline (`frames`); nodes follow breadth first (top levels first), 200 per page (`limit` up to 500). `get_canvas`:
  `limit` / `cursor`, 200 objects per page as before; page 1 (and `acute://canvas/{id}`) is unchanged except for the
  added `page` field. On both, a relation or edge is listed on the page holding its later end, so it appears once.
- **`focus_lens`:** resolves the target's root and drill path (`locateInLens`; it falls back to the target's frame as
  root when Lens would resolve a link differently); `level` zooms out to an ancestor or into the node's own detail;
  `highlight` keys are marked on whichever level shows them. No tab → `focused: false, reason: "no_tab"` (D41). A read
  (allowed with writes off), annotated not idempotent.
- **`link_lens_detail`:** `links: [{node, frame | null}]`, `levels: [{frame, level | null}]`, optional `reason` (D32:
  required only on Project writes). Targets must be on the open canvas; a link may point at a frame on another canvas
  (`canvasId` set). Refuses a frame given as a node and vice versa, a node's own frame, a level past the profile's
  last; skips (with a warning) what is already so; warns on a non-interactive frame and on a link that makes a drill
  loop. Never auto-accepted (not in `AUTO_ACCEPT_TOOLS`).
- **Path probe (2026-10-08, after archify's route probe):** a **⇢ Path** button on the level (and **⇢ Trace** on a node)
  starts a path; clicking a node picks the start, then everything it can reach (`reachableFrom`, the same links as
  `tracePath`) is outlined on every level (dashed = only against an arrow) and the rest dims; clicking the end draws the
  route (flowing arrows), with Find start / Find end, Change end, New path, Copy link (`&from=<canvas>~<key>&to=…&via=`
  in the deep link) and ◀ ▶ stop stepping across levels. The canvas has the same probe (`⇢ Path` chip on an interactive
  frame, `components/diagram/RouteProbe.tsx`), picking by selection, on the open canvas's workspace graph.
- **UI:** node actions **⇢ Trace** (then select a node on any level; the click picks the end; kind picker; each stop
  opens Lens at its level) and **◎ Impact** (affected / related with why, and the warnings that protect them; marks:
  modified, affected, related). An agent's highlight shows as a card with Clear. Opening another level keeps a trace or
  impact; closing Lens clears them.
- **Fixed on the way:** the review bar's label lookup used `/s+/g` (stripping the letter "s") instead of `/\s+/g`.
- **Not done / limits:** Trace and Impact in the panel load every canvas of the workspace (through the shared,
  cached loader); a frame reached from two parents opens under the first; the impact view lists and marks the current
  level, it doesn't draw impact across other levels; the setup artifact's Impact group now names the four tools (they
  were listed and skipped while unregistered).
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 155 files / 1,626 tests (new: `trace.test.ts` ×10
  — relations with explanations and code, levels, across canvases, kinds, the direction fallback, zero hops and
  `maxHops`, ends by key / id / label / frame, ambiguity, level inference, `locateInLens`; `paging.test.ts` ×3;
  `mcp/tools/lensTools.test.ts` ×13 — roots and tree, `around`, `paths` (incl. a map's `sourceRefs`), paging with a
  stale and a foreign cursor, the resource, `get_canvas` paging, `trace_lens_path` across canvases / no path / an
  ambiguous end, `focus_lens` without a tab and with one under writes off (level up and down, another canvas),
  `link_lens_detail` with writes off, propose → Accept → read back → clear → revert with the real writer, and every
  refusal; `changeSet.test.ts` set_lens ×2; listing tests updated). New `e2e/local/lensMcp.local.spec.ts` 1 / 1 over
  the real bridge (a two-level map → `get_lens` → `trace_lens_path` → `focus_lens` opens Lens at the node with a
  highlight → Trace to a node on the level above, hops named, a stop navigates → Impact with its marks →
  `link_lens_detail` reviewed and followed). Affected e2e (`lens`, `lensProject`, `lensRepoMap`, `lensMcp`,
  `mcpSlice`, `mcpAccess`, `agentHistory`, `changeReview`, `repoMap`, `reconcile`, `diagramFrames`) 36 / 36.

**Phase 4 notes (2026-10-03):** Agent Sync (§8), built. Still no file watcher and no new sync tool (D14, D15).
- **§8.1 rule 4, `affectedAncestors`:** new pure `mcp/tools/repoMap/ancestors.ts` walks each stale key's section
  `parent` up the levels (nearest first, each once, never a given key, stops at a loop). `get_map_status` returns it
  (keys only, inside the same `statusKeys` budget as `stale`) and names it in its description and summary ("1 stale
  (2 ancestors may be affected)"). `LiveCanvasActions.setStale` gains the ancestors' object ids; the stale store keeps
  them as a second, memory-only set (re-derived by the next status call; a re-send clears a card from both).
- **Proposed state in Lens (D3):** new pure `domain/lens/pending.ts`: `lensPending(view, sets)` is a level's
  `LensPendingView` — `added` ghosts (an object a set creates with its box centre in the level's frame, or adds to it
  with `update_frame`; a new section's cards are a new level, left out), the links they draw to the level's nodes,
  `changed` node keys with what (label, content, fields, moved, zoom-in link, restored, grouped, conflict), `removed`,
  changed and removed edges, and the sets touching the level. It lives beside the view, not in `LensLevelView` as §4
  sketched (`lensView` stays a pure read of the canvas; the panel passes the pending store's sets). `LensDiagram`
  draws it over the level: `+ NEW` green dashed ghosts (the diagram grows to hold one placed outside the frame),
  `~ changed: label` amber, `− removed` struck, changed / removed edges. Stale nodes get the amber dot, their
  ancestors a lighter dashed "may be affected" ring.
- **Recompute:** debounced 150 ms (was once per animation frame).
- **Agent Sync chip + Pause (`LensAgentSync.tsx`, `state/agentSync.ts`):** the signal is an MCP write reaching the
  canvas — the canvas's `propose` / `merge` live actions (every MCP write is staged first, auto-accepted or not) touch
  the store; `● Agent Sync · updated 12 s ago` within 10 minutes of the last one, else `○ Agent Sync off`. "This map"
  is read as "this canvas" (a map writes only to its own canvas). **Pause** is per canvas: the scene snapshot and the
  pending sets Lens reads are held (the review bar, Accept and the agent carry on); the button reads `Resume · 2Δ`
  with the writes that arrived; Resume catches up at once.
- **Changes / Impact drawer:** under the diagram, collapsed by default. *Changes*: every set waiting on the canvas
  (how many of its changes are on this level, the client's reported name) with **Accept** / **Reject** (optional
  reason) through the review bar's own actions — new `components/ai/reviewActions.ts`, registered by the canvas
  (`acceptPendingSet`, so the record is logged; reject settles and logs with the reason, D46); a set with conflicts
  says to decide them in the review bar. Then this tab session's agent changes on the canvas (outcome, time). *Impact*:
  `impactOf` over what changed on the level (pending changes and removals, stale nodes, keys this session's accepted
  agent changes touched), with the warnings, "Reach along drawn links … not a blast radius". Kept apart from the Agent
  log tab (§3.7).
- **Canvas frame chip:** `✨ L1 ●` while Agent Sync is on, `2Δ` for pending changes in the frame (`pendingFrames`:
  changes by the frame of their target, a bound label as its shape; creates by where they land), `Δ` for an accepted
  agent change not yet seen. Unseen frames come from the accept path (`acceptPending.ts`: the frames `diffScenes`
  touched), for sets from a producer session of their own (MCP, mapping) — not by `createdBy`, which the provenance
  guard keeps descriptive. Viewing the frame in Lens clears it (not while paused).
- **Prompt and recipe:** new `keep_lens_current` prompt (changedPaths → stale and `affectedAncestors` → re-send only the
  sections whose meaning changed, by the same keys; removals through `remove_map_nodes`); the Claude Code hook recipe is
  `.ai/docs/agent-sync-hook-recipe.md` (documentation, not code).
- **Fixed on the way (Phase 3's test, not the tool):** `lensTools.test.ts`'s `writeScene` wrote a changed element
  from a fresh Yjs doc, concurrent with the stored one, so Yjs's client-id order kept the old version about half the
  time and `get_canvas`'s stale-cursor check failed intermittently; it now writes on top of the stored updates.
- **Not done / limits:** the stale ring set isn't kept across a reload (the stale dots are); a ghost's position is
  the proposal's own box, so a merged mapping set laid out later can shift it on Accept; Agent Sync's "on" state on
  the canvas chip refreshes on the next scene, pending or Agent Sync change, not on a timer.
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 158 files / 1,640 tests (new: `ancestors.test.ts`
  ×4; `repoMap.test.ts` ×2 — `affectedAncestors` and the ring ids over three levels, `keep_lens_current`;
  `pending.test.ts` ×4 — added with links, changed / removed / conflict by key, a new section's cards left out and a
  join counted, `pendingFrames`; `agentSync.test.ts` ×4). New `e2e/local/agentSync.local.spec.ts` 1 / 1 over the real
  bridge (chip `● Δ` → Lens clears it → a rename by the same key and a new card as ghosts → Accept from the drawer:
  the same element relabelled, the ghost now a node, Δ gone → Pause holds a new card, `Resume · 1Δ` shows it →
  Reject from the drawer with a reason → `get_map_status`: the ancestor ringed, the card stale on L4 → Impact);
  `lensRepoMap` updated for the chip's `● Δ`. Full local e2e: 130 passed, 3 failed — `lensMcp`, because the drawer's
  region was named "Changes and impact" and Playwright's case-insensitive substring match found two "Impact" regions
  (renamed "Agent Sync drawer"); `lensRepoMap` and `mermaidPreview` on missing trace files from a parallel run sharing
  `test-results` (Playwright's `ENOENT`, not an assertion). Re-run: those three specs 7 / 7, `agentSync` 3 / 3 runs.
  `parser.test.ts`'s time-budget test failed once while the e2e suite loaded the machine and passes on its own.

**Phase 5 notes (2026-10-03):** AI in Lens (§6), on the existing runtime and the user's own connection (D18). Optional
throughout: with AI off (the app's AI mode), no AI action shows and Ask Lens still matches names.
- **Tasks (`ai/lens/lensTasks.ts`, registered at load like Ask AI's):** `lens_explain` (text), `lens_navigate` (JSON
  `{from, to}` keys; the decision model when configured, since it routes rather than authors) and `lens_expand` (a
  `VisualPlan` on the architecture template, Visualize's `ARCHITECTURE_RULE` reused, ≤ 10 shapes, every relationship
  with a `confidence`). Their inputs (`ai/lens/lensAI.ts`) are built only from what Lens shows — the node's label and
  fields, its links on its level (direction, relation, label, why), the levels above, its detail level's labels, its
  evidence *paths* (Acute reads no files) — bounded and passed through `redactSecrets`. Ask sends keys, labels and
  levels only.
- **✨ Explain (§6.1):** a node action; the reply shows in the inspector and is saved as an Ask AI conversation anchored
  to the node (so "Open in Ask AI" reopens it, and it is in History). "Add as note" proposes a text card beside the
  node linked `explained_by` (offered for a node on the open canvas).
- **Ask Lens (§6.2):** a search box above the diagram. Local first: labels named in the question (whole phrase, or
  each word starting a word of the question — plurals, possessives), longest label winning over one inside it, in
  the question's order. Only with no match, and AI on, `lens_navigate` maps it onto the tree's keys; keys the model
  invents are dropped. Lens opens at the lowest level both nodes share (the common part of their drill paths), on the
  node leading to the first, with Phase 3's trace between them (one node: selected and highlighted).
- **✨ Generate L*n* (§6.3, D7):** on a node with no detail level, up to L4 (L5 is source). The plan is made one level
  (`asLevelPlan`: sections and headings the model added are dropped, a kind-less shape gets the level's default so the
  frame is a diagram), rendered with `renderVisualPlan`, its frame titled "<node> · L*n*" at that level, and proposed on
  the **Detail Canvas** "<canvas> · detail" (`components/lens/lensGenerate.ts`; created on first use and remembered in
  the device-local meta store; a node already on a Detail Canvas generates onto that one), placed right of what is
  there. Lens then opens that canvas, where the review bar shows it. **Deviation in mechanism:** the parent's drill
  link can't be in the same set (it is on another canvas, and the frame's id exists only once accepted), so the set
  carries an in-memory intent and accepting it (`acceptPending.ts`, both accept paths) writes `expandsTo
  {frameKey: <new frame id>, canvasId}` on the parent — through the scene when its canvas is open, else appended to
  its Yjs document as "Move to canvas…" writes — and reopens Lens one level down. Rejecting it leaves nothing. A
  pending set doesn't survive a reload (§3.7), so neither does the intent.
- **"Ask your IDE agent" (§6.3):** for a code-grounded node (it has code evidence or an IDE agent drew it), instead of
  Generate: copies the `expand_lens_node` prompt to the clipboard.
- **Evidence and confidence:** a node an AI plan made says "✨ AI-generated, not verified" in the inspector (its
  canvas evidence's origin). `confidence` (0–1) travels like an edge's `explanation`: plan relationship → `connect` →
  the arrow's `acuteEdge` → `DiagramEdge` → the passport card ("AI · 60% sure"); out of range is dropped, not refused.
- **Not done / limits:** Explain's reply is shown as plain text in the inspector (the conversation view renders its
  Markdown); "Generate" isn't offered from the level rail's empty levels (only as the node action); a generated level
  isn't linked if its parent node is deleted before Accept (the toast says to link it by hand).
- **Results:** `tsc --noEmit` clean; `eslint .` clean; `vitest run` 159 files / 1,650 tests (new: `lensAI.test.ts` ×9
  — inputs with redaction and bounds, `nextLevel`, code-grounded, candidates with their paths, local matching,
  `navigateTarget`, `lens_navigate` / `lens_explain` / `lens_expand` over the runtime with the mock provider and canned
  replies, a plan to one frame at the level with confidence kept; `diagram.test.ts` confidence ×1). New
  `e2e/local/lensAI.local.spec.ts` 2 / 2 with canned replies behind a fake key (Explain → Add as note → Accept → an
  `explained_by` card; Ask by name with no AI call, then by meaning through `lens_navigate`; Generate → a new
  "· detail" canvas → Accept → Lens one level down, "AI-generated, not verified", "AI · 60% sure", the parent now
  drilling into it; AI off hides the actions). New real-model spec `e2e/ai/lens.spec.ts` (Explain, Ask, Generate),
  run only through `npm run test:e2e:ai`.
- **Real-model runs (2026-10-03, on the user's go-ahead):** `lens.spec.ts` 3 / 3 on OpenRouter and 3 / 3 on AICredits
  (`meta-llama/llama-4-scout`). The whole AI suite on AICredits: 24 passed, 6 failed, 4 not run (serial specs stop at
  their first failure); a re-run of `visualize` / `sections` / `reconcile` failed the same three. Why, per failure:
  `visualize` "forced template" — the app's AI host returned 504 `Timeout after 60000ms waiting for session.idle` on
  the one `generate_visual_plan` (measured: 61 s), so the model didn't answer within the host's 60 s that day
  (the 2026-10-02 fidelity run on the same provider and model finished 11 calls in 80 s); `sections` and `fidelity`
  Example 1 — "AI analysis failed", the same timeouts falling back to local structure; `reconcile` "one changed
  section" — fails in ~0.4 s, before any AI call: its wait accepts the previous test's "Nothing changed" notice, still
  on screen, so it finds no generate call (a race in the spec); `semanticUpdate` and `followUpReplies` — the model's
  judgement (a rewording reported as an update; a mitigation not linked to Risks), soft checks. None of these touch a
  Phase 4/5 code path (Visualize's prompts are unchanged; `confidence` is optional and dropped when invalid).
  Gemini (the auto-detected provider) failed its preflight with HTTP 502.
- **Review outcome (2026-10-03, user-approved):** Phase 5 is accepted on the dedicated Lens suite (3 / 3 real-model
  passes, the planted-secret check included). Classification: `visualize`, `sections`, `fidelity` — provider /
  infrastructure (AICredits timeouts), to be re-run later on AICredits, first with the current model, optionally a
  faster one via `ACUTE_TEST_AICREDITS_MODEL`; `semanticUpdate`, `followUpReplies` — model-judgement / evaluation
  failures, specs left unchanged; `reconcile` — a test race, **fixed test-only** (`e2e/ai/reconcile.spec.ts`: waits for
  the previous test's toast to clear, then for this update's own `generate_visual_plan` response before accepting the
  review bar or a fresh "Nothing changed"), re-run on AICredits 3 / 3 (the changed-section test now waits for its
  generate call, 23.8 s). No prompt, Phase 4/5 code, confidence handling or acceptance behaviour changed for these
  failures.
- **Re-run of the provider failures (2026-10-03, AICredits, current model `meta-llama/llama-4-scout`):** 8 passed,
  2 failed, 1 not run. `visualize` 4 / 4 (the forced template answered in 42.9 s this time); `fidelity` Examples 1 and
  2 pass (all three runs each); Example 3 passed runs 1–2 and failed run 3/3 with "AI couldn't analyse the section
  'Decisions'" (the AI call failed and the section fell back to its own structure — same class as before);
  `sections` "a long ChatGPT answer" now gets through the outline and every section and fails later, on a frame
  label: "2 · Annotated" isn't in the spec's allowed list, though `annotated` → "Annotated" is a real section kind
  (`sectionKinds.ts` `KIND_NAMES`, changed 2026-10-01; the spec dates from 2026-09-27) — a stale spec list, not a
  Phase 4/5 regression; its follow-on test didn't run. Not re-run with a faster model.

**Phase 5b notes (2026-10-11):** design review (§6.4, D65): built and verified **offline only**; no real model has run.

*Covered now*
- **Tasks and inputs:** `lens_review` and `lens_assess` registered with Phase 5's three (`ai/lens/lensTasks.ts`; `AITask`
  gained both names); `lens_assess` sets `timeoutMs: 120_000`. Pure helpers in `ai/lens/lensAI.ts`: `structureFacts`
  (degree, shared stores, external dependencies, longest chain with cycles cut and a step cap, isolated nodes),
  `reviewInput`, `assessInput`, `resolveAssessment`. Question bank and local checks: `ai/lens/reviewQuestions.ts`.
- **UI:** `LensReview` and `LensAssessment` in `components/lens/LensAI.tsx`, mounted in `LensPanel.tsx` beside Ask
  Lens; styles in `globals.css` ("Design review" block after Phase 5's). The signal is a chip inside the question cell
  (a third column didn't fit the docked panel, ~210 px); the card scrolls inside itself (max 45 vh) so the diagram keeps
  its room.
- **Results:** `tsc --noEmit` clean; `eslint` clean on the changed files; `vitest run src/ai src/components/lens
  src/domain/lens` 142 files / 1,518 tests (new, in `lensAI.test.ts` ×7: `structureFacts` incl. a cycle; `reviewInput`
  schema, redaction (assumptions and a planted token in a node's details) and bounds; the bank (unique ids, track by
  level, local signals); `lens_review` and `lens_assess` over the runtime with the mock provider and canned replies;
  unknown ids dropped; a bad verdict rejected). New `e2e/local/lensReview.local.spec.ts` 2 / 2 with canned replies
  behind a fake key: local signals before any call, Analyze → verdicts, tally and improvements, the typed figures reach
  the prompt, LLD tab, an own question added / kept across reload / removed, AI off hides it; plus a screenshot run
  (light, dark, expanded) when `LENS_REVIEW_SHOTS` is set. Playwright found and fixed two layout faults (a crushed
  three-column table at the docked width; the open card hiding the diagram).

*Pending (for the live checks)*
- **Real-model run: not done.** Per the standing rule, only on the user's go-ahead; prefer `--provider=aicredits`,
  `--trace off`, a separate `--output`. No `e2e/ai/lensReview.spec.ts` exists yet; write it first (planted-secret check
  as in `lens.spec.ts`), then run it. Everything the table shows after Analyze is, so far, canned.
- **Checks to run live** (each is a pass/fail an observer can judge):
  1. *Contract:* on a real L1 frame, `lens_assess` returns one answer per asked id, valid JSON first try (no repair),
     within the time limit with 14 built-in plus 2–3 own questions. **Timeout:** Phase 5's real run saw the host's 60 s
     limit (504) on one call; whether the host honours `timeoutMs: 120_000` is untested.
  2. *Grounding:* with a queue in the diagram, "async" is not a "gap"; with no security node, "security" is not
     "strong"; no verdict contradicts the table's local chip without saying why.
  3. *No invented numbers:* with no assumptions, `capacity` and `scale` answers use labelled assumptions or relative
     terms only; with "2M DAU, 5% at peak", the arithmetic uses those figures.
  4. *Scale answer quality:* "What breaks at 10×?" on the shop fixture (Web → API → Cache / Orders DB / Order Queue /
     Stripe) names the real first bottleneck from the structure (the API's fan-out, the shared Orders DB, the external
     Stripe limit), cheapest mitigation first, with a "what to measure" line.
  5. *LLD:* the same on an L3 / L4 frame (flows and operations). Expect more "unknown" (a diagram rarely shows
     idempotency or locking); check it says "unknown" instead of guessing.
  6. *Thin diagram:* a two-node level answers with what is missing, not a filled-in design.
  7. *Redaction:* a planted `sk-live-…` in a node's details and in the assumptions never reaches the provider.
  8. *Own question:* "Can Orders survive Stripe being down?" is answered in the same table, by id.
- **Known gaps (not built):**
  - Project **decisions and constraints are not passed in**: the tasks accept them (`decisions`, ≤ 12 statements), but
    no call site reads the Project profile yet, so reviews ignore recorded decisions (D36's warnings included).
  - **Nothing is saved:** a result lives in the panel only (not an Ask AI conversation, not an "Add as note" card, not
    in History), so reopening the level loses verdicts. Verdicts over time / "what improved since last review" is not built.
  - **Custom questions are per device** (not synced, not exported); no editing of the built-in bank from the UI.
  - **The bank is unreviewed:** the 14 + 11 questions and the local checks (keyword and kind heuristics, e.g. "cache"
    in a label) were written by us, not checked against real interview rubrics; the user should review them before they
    are shown as "what an interviewer asks". A label-based check can be fooled either way.
  - **Free-text and topic reviews are single-shot:** no follow-up chat turn (use Ask AI for that); the growth-factor
    field only affects "What breaks at N×?".
  - **Layout:** docked (~210 px) shows one or two table rows at a time (expanded is comfortable); not tested on a
    phone width. Pre-existing and not changed here: dark-mode node-label contrast on light fills ("Web" on cyan).
  - **e2e covers L1 only;** L0, L3 and L4 aren't exercised. The card is hidden on the Project profile (its questions
    are architecture questions) and on the L5 source card; that gate was added after the e2e ran and has no test yet.
  - Not added to the positioning doc (`product-positioning.md`) or the MCP vision spec; no MCP tool exposes the review
    (an agent can't ask for one), and claims about it shouldn't be made until the live checks pass.

| Phase | Scope | Depends on | Tests |
|---|---|---|---|
| **1A-i. Viewer: one level, open and back** ✅ | `lensPanel` store; `LensPanel` docked/expanded with shared side-panel CSS; one-slot rule with the page panel; the architecture `LensProfile`; `lensView` on one frame; SVG renderer from canvas geometry + `routing.ts`; select, passport, highlight (shared since Phase 0); inspector Details / Relations; visual zoom control apart from the level; "Open in Lens" in `DiagramPanelSection`; Back to canvas with select + zoom + flash | 0 | `lensView` unit tests; e2e: AC1–AC3, AC6, AC9, AC10, AC13 |
| **1A-ii. Hierarchy and semantic zoom** ✅ | `acuteNode.key` / `lensKey` identity with the copy rule (`handleDuplicate`); `level`, `expandsTo`, and resolution (`expandsTo` → `explained_by` → suggestion); `lensTree` on one canvas; level rail + breadcrumb; drill / up with the transition; "Set level" and "Link to detail frame" (D23) commands; deep link | 1A-i | `lensTree` / identity unit tests (cycles, missing frames, renamed and copied nodes); e2e: the North Star script L1 → L4 and back (§10), AC4, AC5, AC7, AC11, AC12 |
| **6. Project profile (view)** ✅ | D33's kinds (`project`, `decision`, `constraint`, `finding`, `open_question`, `risk`, `milestone`, `progress_item`, `annotation`) with per-field validation and `nodeKindStyle.ts` styles; `acuteNode.project` scope (D39); `supersedes` and `deviates_from` relation types (D45; touches the same consumers as D9's additions, §3.2); the "project" `LensProfile` (L0 Project, L1 lanes, §3.6); the `update_node` change kind (D43); `acuteNode.refs`, the "Link to node…" picker and the minimal read-only cross-canvas key resolver (D53); the explicit "Move to canvas…" command that preserves keys, and the cut/delete warning for nodes other nodes `refs` (D59); `lensView` reads it the same as architecture; **search and context read the project fields (C6):** `search/workspaceIndex.ts` indexes, and `ai/context/selectionContext.ts` reads, `acuteNode`'s descriptive and project-knowledge fields (sublabel, tag, details, reason, options, chosen, note, answer, …), because 7B's task scope (D37) runs through them; properties-panel commands "New project / decision / finding / progress item / annotation", "Choose" (D34) and "Promote" (D33), each proposed as a `ChangeSet` like any manual Lens edit (D5) | 1A-ii (D42) | unit tests for every kind's validation and the project profile's `lensView` (lanes, order, scope); e2e: create a project and a decision with options by hand, choose one, promote a finding, reload; **C6:** a decision is found by a word in its `reason` through the workspace index and through the AI context reader, and so are a question's `answer` and a node's `sublabel` / `details`; **key invariant (D59):** node A has key K and node B has `refs` to K → "Move to canvas…" moves A: K unchanged and B's ref still resolves; duplicating A, and pasting it on another canvas, gives a copy without K; a cut-and-paste is a copy; moving a frame keeps its key (`lensKey` pinned) and its `expandsTo` links resolve |
| **7A. Agent State** ✅ | `agentChanges` / `agentSessions` stores and migration (D31); `ChangeSet.agent` / `reason` (D32); record + inverse written at Accept (§3.7), including rejected/expired proposals, `args`/`result` and `usage` (D46); the `restore` change kind (D43); auto-accept for Project writes with its exceptions (D44); retention bounds; an optional `credentialId` on both records and the History tab showing the agent as client-reported (D61); a test that every attribution field is filled on every MCP write (E3: `agent`, `session`, `tool`, `at`, and `reason` where required; AFFiNE issue #15467 shipped empty metadata on MCP writes); `PendingChanges` keyed by `(canvasId, session)` with per-set review (D40); "History" tab; revert set built from inverses with F39 conflicts (D30) | 6 (or the existing change-set path alone) | unit tests: record and inverse per op, revert of create/update/remove, a conflict when edited since, retention; two sessions staging on one canvas; e2e: accept a change → History row → Revert… → review → canvas restored |
| **7B. Project-profile MCP** ✅ | §7.3's tools, resources, prompts and server `instructions`; `get_session_context`'s scope resolution and separate budget (D29, D37); warnings (D36) in `get_session_context`, `get_decisions` and `get_lens_impact`; `sync_session`'s typed report (D38); `get_session_review` and the Session review view (D47); deviation-aware warnings (D45); `acute://setup/instructions/{client}` + `setup_project_instructions` and the `entitlement_required` shape (D49); D52's scope note (existing pairing token, not OAuth) applies here; the tool-contract rules of §7.3 (C2, C4, C5, B2, D1, D2, I3); the pure `impactOf` and the data-only `get_lens_impact` tool over it, with no `tracePath` or Trace UI (D54); the D55 name review as an entry gate; the three setup templates, skill variants and MC11 (D56) | 6, 7A; the existing MCP server (not Phase 3, D42) | scripted MCP clients over `InMemoryTransport` (as `repoMap.test.ts` does); writes-off policy test; budget test (payload ≤ `budget`, sections report drops); e2e: an agent calls `get_session_context` → `record_decision` → ghost → Accept → `get_decisions` returns it with a warning → `sync_session` → next session's context shows `next` → `revert_agent_changes`. This e2e is also §10.2's vertical-slice acceptance check; plus one test per tool-contract rule in §7.3 (degraded flags, hit caps, the key fallback, abort, and a read-back for each block kind an agent can create) |
| **7C. Core object tools** ✅ | `delete_object` (existing; D62), `update_connection`, `delete_connection`, `group_blocks`, `list_blocks`, `get_block` (D50) on the change-set path; each logged and revertible | 7A | scripted MCP clients; delete → review → Accept → History → Revert restores the element with its id and arrows; delete never auto-accepted; writes-off policy test |
| **1B. Evidence and L5** ✅ (built out of order, D60) | `lensEvidence` from `sourceRefsOf` and `acuteNode.sources`, with each source's `role` (D48); the node "Source" field; L5 source card (path, lines, commit, origin); VS Code / GitHub links when known; Evidence node action; cross-canvas read-only `SceneSource` drill UI (the key-resolving read itself is built in Phase 6, D53); frame chip `✨ L2`; Navigator "Lens" rows | 1A-ii | evidence unit tests; e2e: L4 → L5 source card → Back to canvas (AC8); a drill into a second canvas and back |
| **2. Repo Map → Lens** ✅ | **Map sections become Lens levels:** a section's frame is marked interactive (`acuteDiagram`, with `level` from `section.level`); map cards count as Lens nodes even though most are rich blocks (embeddables), not shapes, because `frameGraph` reads only rectangles, ellipses and diamonds today (extend it, or give `lensView` a card-node reader); kinds on map nodes (Wave 1b item 3, not built); `stableNodeKey` identity per D21 (sign-off first). Also D9 relation types (`relationStyle`, Mermaid, map schemas, MCP schemas, `RELATION_LABELS`); new L3–L4 kinds; `section.level` and `repoRoot` on map tools; `code` nodes in the L5 card; `map_repo` playbook with levels; `expand_lens_node` prompt | 1B; frames Phase 2 (done) | Repo Map schema / convert tests; a scripted map (no AI) opened in Lens down to L5, every section showing its cards as nodes |
| **3. MCP lens tools + Trace** ✅ | `get_lens`, `trace_lens_path`, `focus_lens`, `link_lens_detail` and its `set_lens` change kind (D43), `acute://lens/{key}`; `tracePath` (`impactOf` and `get_lens_impact` already exist from 7B, D54; Phase 3 adds `tracePath`, the Trace action and the richer impact view); the **Trace** node action (path across levels, every hop named); "overview first, then drill in" paging for `get_lens` and the existing `get_canvas`, with a cursor tied to the scene version so one page can't mix two versions (G2) | 2 | scripted MCP clients over `InMemoryTransport` like `repoMap.test.ts`; BFS unit tests; writes-off policy test; e2e: `focus_lens` opens Lens at a node |
| **4. Agent Sync** ✅ | the §8.1 contract (`affectedAncestors` in `get_map_status`); pending ghosts (`lensView.pending`); debounced recompute; Changes / Impact drawer with review actions; Agent Sync chip + Pause; canvas `Δ` chip; `keep_lens_current` prompt; hook recipe doc | 2, 3 | unit tests for `affectedAncestors`; e2e: a scripted agent upserts a changed section → ghost in Lens → Accept → re-rendered, Δ cleared; a rename by the same key updates in place; pause holds updates |
| **5. AI in Lens** ✅ | `lens_explain`, `lens_navigate`, `lens_expand` tasks; Detail Canvas for generated levels (D7); "Ask your IDE agent"; confidence display; Explain node action | 1B; frames Phase 2 (done) | task schema / validate tests with the mock provider; e2e with a canned reply only; a real-model run only on the user's go-ahead |
| **5b. Design review** ✅ offline; live checks pending (D65) | `lens_review` and `lens_assess` tasks; `structureFacts`, `reviewInput`, `assessInput`; the HLD / LLD question bank with local diagram checks; the Design review card (assessment table, own questions, topic buttons, assumptions, growth factor) | 5 | unit tests with the mock provider and canned replies; `e2e/local/lensReview.local.spec.ts` with canned replies; the real-model checks in "Phase 5b notes" only on the user's go-ahead |
| Later (D20) | Data flow / Sequence views (after CAP-07); other profiles beyond Project (agent, incident, knowledge); batched `sync_map`; keeping a Repo Map key across a section move (a different move from D59's canvas move); guided views reuse (frames Phase 4); PR / commit evidence | — | — |

**Impact boundary (D54).** *Phase 7B:* the pure `impactOf` (reverse edges, parent walk, `refs`), the data-only
`get_lens_impact` tool over it (no UI), and warnings (D36) in `get_session_context`, `get_decisions` and
`get_lens_impact`. *Phase 3:* `tracePath`, the Trace action, `trace_lens_path`, the richer impact view, and the rest of
the Lens tools. Nothing about impact *computation* waits for Phase 3.

### Canvas-side work from the frames plan (2026-10-01)

[`interactive-architecture-frames-plan.md`](./interactive-architecture-frames-plan.md) Phases 3–5 and its deferred
items stay that plan's canvas-side track. This is where each one lands relative to Lens:

| Frames item | Lands | Note |
|---|---|---|
| Phase 3: Archify JSON import; Mermaid kind guess | now (frames Phase 3), independent of Lens | feeds Lens with ready-made interactive frames; Archify `sources` map to `acuteNode.sources` once 1B exists |
| Phase 4: guided views (story steps) | Lens, after 1B, as a Lens feature (the "Later" row above) | one implementation, in Lens, not a second one on the canvas overlay |
| Phase 4: deep link to a frame | covered by Lens's deep link (1A-ii) | dropped from the frames plan |
| Phase 4: zoom-aware sublabels on the canvas | frames plan, any time | canvas only |
| Phase 5: route probe | Lens Phase 3 Trace (one `tracePath`, per 0.5) | the canvas reuses it afterwards |
| Phase 5: kind filter; standalone HTML export of a frame | frames plan, after Lens Phase 3 | the filter reuses Lens's highlight; export is optional |
| Deferred: kind icons, global on/off, "architecture" section kind for outlined documents | frames plan | icons should match Lens's node rendering (D4) |

## 10. MVP acceptance criteria (Phases 1A + 1B)

The MVP is done when the **North Star demo** runs end to end on a hand-drawn canvas with AI off and no MCP client
connected, and every criterion below holds. The demo is also the e2e script (`e2e/local/lens.local.spec.ts`).

**North Star demo.** Canvas "E-Commerce" has an interactive L1 frame: Frontend → API → Payments → Orders. Payments
links to an L2 frame (Payment Service: Stripe, Razorpay, Webhook, Refund). Webhook links to an L3 frame (Receive →
Verify → Parse → Update → Emit). Update links to an L4 frame (`updateStatus()`) whose node has the source
`payment.service.ts` lines 143–158. The user selects Payments, clicks **✨ Open in Lens**, zooms L1 → L2 → L3 → L4 →
L5, then clicks **← Back to Canvas** and lands on the Payments frame's node.

| # | Criterion | Checked by |
|---|---|---|
| AC1 | **Open.** "✨ Open in Lens" on an interactive frame, or on a node in one, opens Lens docked at that frame's level, with that node selected when it was a node. | e2e |
| AC2 | **Same picture.** Lens shows the frame's nodes and directional relationships in the canvas's own arrangement: left/right and above/below order preserved; kind shown on each node; arrow direction and label as on the canvas. | e2e (relative order), screenshot |
| AC3 | **Inspector.** Selecting a node shows kind, level name, sublabel, details, and incoming and outgoing relations with labels and explanations. Clicking a relation selects the neighbour. | e2e |
| AC4 | **Semantic zoom in.** Zoom in (double-click, or the action) on a node with a detail link shows its child frame at the next level. The breadcrumb and level rail update, and the header names the level ("L3 Flow"). The transition takes ≤ 200 ms, and none under reduced motion. | e2e |
| AC5 | **Semantic zoom out.** The breadcrumb, `⌫`, or a level above on the rail returns to that ancestor with the node you drilled through selected. | e2e |
| AC6 | **Two zooms.** Visual zoom (`− 100% +`, wheel) changes only scale within a level and never changes the level. The level rail never changes scale. | e2e |
| AC7 | **Level rail honesty.** Each level shows exists / not linked for the current path. Nothing is offered that can't happen (no Generate before Phase 5). | e2e |
| AC8 | **L5 Source.** An L4 node with a source shows the L5 card: path, line range, commit and origin ("you" / "your IDE agent") when known. "Open in VS Code" and "Open on GitHub" appear only when their target is known. | e2e |
| AC9 | **Back to Canvas.** From any level, returns to the canvas (switching canvas when the frame lives elsewhere), selects the originating element, scrolls it into view and flashes it once. | e2e |
| AC10 | **Canvas untouched (D2, D5).** Opening, navigating and closing Lens changes no element (versions identical before and after), adds no undo step, and leaves Excalidraw's tools and menus as they were. Only the explicit panel commands (Set level, Link to detail frame, Source) edit the scene, one undo step each. | e2e (versions + history) |
| AC11 | **Persistence.** Levels, detail links, keys and sources survive a reload. The deep link `#lens=…&path=…&node=…` restores the same view. | e2e |
| AC12 | **Identity (D13).** Renaming a node keeps its key and its detail link still resolves. Duplicating a node doesn't duplicate its key. A link cycle shows "↻ loop" instead of hanging. | unit + e2e |
| AC13 | **One slot (D17).** Lens and the page panel never show together. Opening a page from the inspector, then "← Back to Lens", returns to the same level and selection. Docked ↔ expanded keeps both. | e2e |
| AC14 | **No AI, no MCP needed.** All of the above with the AI feature off and no MCP session. | e2e runs with AI off |
| AC15 | **Responsive.** Opening Lens on a 12-node frame and each drill step feel instant (target < 300 ms on the dev machine, measured once in the e2e run and recorded, not a CI assertion). | measured |

**Not in the MVP:** Trace, Explain, MCP lens tools, Agent Sync, generated levels, new relation types, other profiles
(Phases 2–5 and Later).

### 10.1 How the PRD's full acceptance criteria land

PRD §30 describes the full release. Mapped to the phases:

| PRD §30 | Where |
|---|---|
| Excalidraw unchanged; objects editable independently | AC10; §2 rules; §5.3 (no context-menu override, overlays only) |
| Frames can be marked; "Visualize in Lens" exposed | existing "Interactive diagram" switch + Open in Lens (1A); viz-ready chip (1B) |
| Separate view; L0–L5; semantic zoom; selectable nodes; directional edges; inspector | 1A (AC1–AC7) |
| Return to canvas identifies the frame/object | 1A (AC9) |
| Evidence | 1B (AC8), 2 (code), 4 (agent provenance) |
| Reuse MCP; query; trace; context; agents update without a second server | 3 (+ 2 for the map) |
| Code changes refresh; change indicators; inspect change and impact; pause | 4, via the IDE agent (§8) |
| Reuse AI infra and context; extraction creates nodes and relationships; explain | 5 (Visualize and Repo Map already extract) |

### 10.2 MCP-first vertical slice acceptance criteria (D51, D56–D58; Phases 6–7B, the first MCP launch gate)

This is the second, independent MVP that D51's build order puts next: the vision spec's own validation criterion
for "the complete end-to-end workflow", restated against the tools this plan actually defines (§7.3) so it can be
checked rather than only narrated. Demo workspace: a `project` node ("Acme API", style `modular`) with one milestone
("Auth") holding two progress items.

| # | Criterion | Checked by |
|---|---|---|
| MC1 | **Connect.** A real MCP-compatible agent (Claude Code, Codex, Cursor, or a scripted client over `InMemoryTransport` for the automated check) connects to the existing bridge; no new pairing step beyond today's token (D52). | e2e / scripted client |
| MC2 | **Bootstrap.** `get_session_context` (no `task`, so it falls back to open-tab focus) returns the project, its focus, the milestone's progress items and any decisions, within its default budget, with a `truncated`/drop report when it didn't fit. | scripted client, budget test |
| MC3 | **Record a decision.** `record_decision` with two `options` and no `chosen` proposes a `ChangeSet`; Accept creates the node; it appears in `get_decisions` as `proposed`. | e2e |
| MC4 | **Human negotiates.** The user opens the Project profile in Lens, sees the decision, picks an option ("Choose"), or adds a `preference` annotation. The agent's next `get_decisions` call sees the chosen option or the annotation. | e2e |
| MC5 | **Update progress.** `update_progress` moves a progress item to `done` and marks the next one `next`; both show correctly in the Project profile view (Phase 6) and in `get_implementation_plan`. | e2e |
| MC6 | **Sync a session.** `sync_session` with a short typed report (`summary`, one `decisions` entry, one `progress` entry, a `next`) produces the matching writes in one call and stores `next` on the session record. | scripted client |
| MC7 | **See it represented correctly.** After Accept, the Project profile view (Phase 6) shows the new decision and progress state with no manual refresh beyond the existing scene-change recompute (§4). | e2e |
| MC8 | **Inspect what changed.** The History tab (Phase 7A) lists the session's changes with agent, time and reason. | e2e |
| MC9 | **Revert.** `revert_agent_changes` on one of the session's changes proposes the inverse as a `ChangeSet`; Accept restores the prior state; an element edited since instead shows a conflict (D30). | e2e |
| MC10 | **Decision firewall holds.** A second, independent agent session calling `get_session_context` or `get_decisions` on the same node sees the recorded decision and, if it was a `constraint` or `enforce: true` decision, the `warnings` array (D36). | scripted client |
| MC11 | **Setup resource (D56).** `acute://setup/instructions/{client}` returns, for each of `claude`, `codex` and `cursor`, an artifact that: (a) identifies Acute Notes / Lens and when to use it; (b) names **only tools, resources and prompts that exist** on the server (D55 names); (c) explains initialisation (`get_session_context`), context use and when to call `sync_session`; (d) says what to persist as decisions, findings, constraints, progress and architecture; (e) says what to do when Acute context conflicts with the code or the canonical state (the code wins; record the divergence); (f) says explicitly not to fabricate project state. `setup_project_instructions` returns a prompt that makes the agent write the file. | scripted client (names checked against the registered tools; each of (a)–(f) asserted per client); one manual real-agent run |

**Manual real-agent steps (D58).** MC1 (connect) and MC10 (a second independent session sees the warning) each also have a
real Claude Code or Codex run as a manual integration step, performed only when the user asks. The scripted-client
versions are the automated checks, so ordinary development never depends on a live agent.
**Not in this slice:** Trace, Repo Map-sourced architecture (Phases 2–3 run later in this order), Agent Sync, AI
tasks, entitlements (nothing is gated, D49). A workspace with no Repo Map still satisfies MC1–MC11 on hand-drawn
architecture plus Project-profile nodes alone, the same "no AI, no MCP-lens-tools needed" spirit as AC14 in §10.

## 11. Risks

- **Two diagram renderers** (canvas overlay and Lens SVG) can drift. Mitigation: shared kind and relation styles, the
  shared `routing.ts`, shared passport and highlight hooks, and one screenshot test that renders a fixture both ways.
- **Cross-canvas loading** can get slow with many canvases. Load only canvases a drill link names, lazily, and release
  them on close.
- **Hierarchy cycles** (A expands to a frame that expands back): `lensTree` stops at a visited frame and shows "↻ loop".
- **Identity drift.** An agent that invents a new key on every rename defeats D13, because every rename becomes
  delete + create. Mitigation: the `keep_lens_current` prompt and tool descriptions say "keep the key"; the review bar
  shows a remove paired with an add of the same label and source as a likely rename. Moving a key between sections
  still needs remove + re-add until a `move` form exists (§3.1.1).
- **Stale ancestors look current.** Without the agent re-sending, an L2 summary can stay unchanged after its L4 code
  changed. Mitigation: `affectedAncestors` rings (§8.2) make "may be affected" visible instead of silent.
- **Over-claiming "live" / "understands your code".** Wording follows §8 and D15, and `product-positioning.md` changes
  only after a phase ships and is checked.
- **Project profile scope creep (D25–D28).** A decision/progress node could grow into a second ticketing or
  long-document system if its node stays anything but thin. Mitigation: §3.6's explicit "deliberately thin" /
  "not building" rules; prose detail is a linked page (`create_page`), not a bigger node.
- **Two "history" concepts side by side.** Phase 4's Changes/Impact drawer (session-local, pending-only) and Phase
  7's persisted accepted-change log (D28) answer different questions ("what's about to land" vs. "what already
  landed") and must stay visually distinct in the UI, or users will assume one is a subset of the other when it
  isn't.
- **`get_session_context` drifting from Ask AI's context builder.** Both read `contextBuilder`; D29 fixes this by
  keeping them as two call sites with two budgets and two output shapes, not two implementations. A future change to
  `contextBuilder`'s priority ordering should be checked against both call sites.

- **Too many kinds for agents to choose well (D33).** Nine project kinds invite mis-filing (a finding recorded as a
  decision). Mitigation: tool-level kinds (`record_decision` vs `log_finding`) rather than one generic writer, tool
  descriptions that say when to use each, and promotion (D33) so a mis-filed finding is fixed by a status change.
- **Change-log size (D31).** Inverses hold element snapshots and can grow. Mitigation: §3.7's retention bounds,
  file data by reference, inverses dropped before records.
- **Revert after heavy editing (D30).** A revert of an old change can be mostly conflicts. Mitigation: it's always a
  reviewed set, conflicts are per element (F39), and the History row shows "edited since" before staging.
- **Concurrent sets (D40).** Several staged sets on one canvas can confuse review. Mitigation: the review bar names
  each set's agent and session; overlapping sets are refused rather than merged.
- **Warnings that cry wolf (D36).** If every decision warns, agents learn to ignore them. Mitigation: only
  `constraint`s and decisions with `enforce: true` warn; everything else is listed, not raised.

- **Auto-accept makes bad decisions stick (D44).** An agent could auto-record a wrong decision. Mitigation: constraints
  and `enforce` decisions are never auto-accepted, everything else is attributable and reversible, and the review bar
  keeps a visible "auto-accepted N" count.
- **New change kinds touch every consumer (D43).** The review bar, reconciliation, `parts.ts`, proposal geometry and
  the Mermaid/Repo Map paths all switch on `ProposedChange.kind`. Mitigation: add the three kinds in one change with
  exhaustive `switch` checks, so a missed consumer fails to compile.
- **Deviations hide real violations (D45).** Mitigation: a deviation is shown with the warning, never in place of it,
  and is scoped to the nodes it references.
- **Dangling or ambiguous refs (D53).** A deleted target leaves a ref that resolves to nothing, and a key copied by
  hand could resolve to two nodes. Mitigation: unresolved refs are kept and shown, never dropped; duplicating drops the
  key (D13); the resolver reports a key found twice instead of picking one; a move between canvases preserves its key (D59, tested in Phase 6).
## 12. Open questions

Everything in the earlier "Decisions needed" list is now locked (D2, D7, D8, D9, D17, D19/D24, D25–D58). Where "New
detail frame" lands is closed by D23; the `sync_session` report format (old question 3) is closed by D38; the
Phases 2–5 vs. 6–7 build order (old question 4) is closed by D51/D52. Still open:

1. *(closed by D64: D21 signed off as written; the copy rule applies through `acuteNode.ownIdentity`.)*
2. *(closed by D55: the §7.3 names are the public API, finalised in a last review before 7B starts, with no aliases; when CAP-01's semantic retrieval lands it extends `search_workspace`, with no separate semantic search tool, D2 of the lessons review.)*
3. *(closed by D38: typed report.)*
4. *(closed by D51/D52: build order is 0 → 1A-i → 1A-ii → 6 → 7A → 7B → 7C → 1B → 2 → 3 → 4 → 5.)*
5. **Whether the change log and session records should be exported with the workspace** (D31 says not in this
   extension): matters once workspaces move between devices or to a hosted store.

6. **How a canvas- or page-level deletion is reviewed** (D50): change sets are per canvas, so `delete_canvas` and
   `create_canvas` need their own review mechanism (or stay human-only). Needs deciding before those tools are added;
   `list_canvases` alone is read-only and can ship with 7C.
Deferred by D58: question 5 until workspace export/import exists, question 6 entirely (`list_canvases` ships without
it); question 1 stays a gate before Phase 2.
## 13. Coverage map: `acute-mcp-vision-spec.md` → this plan

Every MCP-related feature the vision spec plans, and where it lives. "Not Lens" rows name what Lens must still
guarantee so the owning work needs no Lens redesign.

| Vision spec feature | Where in this plan | Phase |
|---|---|---|
| L0–L5 semantic zoom (§2, §4, §5) | D10, §3.1, §5 | 1A–1B |
| `get_architecture(node)` centred, zoom in/out (§3) | `get_lens` with `around` + depth (§7.1) | 3 |
| `get_context(topic \| file \| task)`, token-budgeted (§2) | `get_session_context` inputs and scope order (D37, §7.3) | 7B |
| Context compression for smaller models (§2) | Same call's `budget` and per-section drop report; semantic retrieval stays CAP-01 (D29) | 7B |
| `get_decisions`, ADR fields (§3) | D26, D34, §3.6, §7.3 | 6, 7B |
| Decision firewall warnings (§3) | D36; in `get_session_context`, `get_decisions`, `get_lens_impact` | 7B |
| `get_related` (code / PRs / tests / discussions) (§3) | Code and tests: evidence by `role`, `get_lens` `paths` filter (D48). Discussions: linked pages in `get_session_context` (D48). PR/commit evidence deferred (D20), additive to `LensEvidence.source` | 1B, 3, 7B |
| `search` (§3) | Existing `search_workspace` | built |
| `summarize_impact(diff \| PR)` (§3, workflow 3) | `get_session_review` + `get_lens_impact`, taking `changedPaths \| session \| changeIds` (D47). Narrative left to the calling agent or a Phase-5-style task | 7B |
| `get_open_questions` (§3) | `open_question` kind, `get_open_questions` (D33) | 6, 7B |
| `record_decision` (§3) | §7.3, options/chosen (D34) | 7B |
| `update_map` (§3) | `upsert_map_section` (built) + `section.level` | 2 |
| `annotate` (§3), comments as AI-readable intent (§4) | `annotation` kind, `annotate` tool (D35) | 6, 7B |
| `log_discovery` + ephemeral → validated → decision → stable (§3) | `finding` kind, `log_finding`, `update_knowledge` (D33) | 6, 7B |
| `set_task_state` (§3) | `update_progress` | 7B |
| AI ↔ human negotiation over options (§4) | Proposed decision with `options`, "Choose", preference annotations (D34, D35) | 6, 7B |
| Workflow 1: understand an unfamiliar repo (§4) | `map_repo` + levels (2), `get_lens` (3), `initialize_project` prompt (7B) | 2, 3, 7B |
| Workflow 2: implement with context compression (§4) | `get_session_context(task)` → work → `record_decision` / `log_finding` / `sync_session` | 7B |
| Workflow 3: review an autonomous run, before/during/after (§4) | Before: architecture + decisions. During: findings + session record. After: change records, impact, History tab, revert | 4, 7A, 7B |
| Three knowledge kinds: stable / decision / ephemeral (§3) | Architecture profile / decision + constraint / finding + open question + risk (D33) | 6 |
| Implementation plan (§9, §10.2 E) | Milestones + ordered progress items, `get_implementation_plan` (D33) | 6, 7B |
| `acute_bootstrap` (§9) | `get_session_context` (D27, D37) | 7B |
| `acute_sync` / `sync_project_state` / `record_change` (§9, §10.2) | `sync_session` with the typed report (D38) | 7B |
| Agent resumes previous task; "where are we?" (§9 triggers) | Session `next` (D38), `get_project`, `get_session_history` | 7B |
| Agent change history, attributable (§10.3) | `agentChanges` store, attribution fields (D31, D32), History tab | 7A |
| `revert_agent_changes` (§10.2 E, §10.3, MVP 5) | Inverse in each record, revert as a reviewed set (D30) | 7A, 7B |
| Agent session history (§7) | `agentSessions` store, `get_session_history` | 7A, 7B |
| Multiple concurrent agents (§10.4) | Pending sets per session (D40), attribution (D32) | 7A |
| Project object; several projects per workspace (§10.2 A, §10.4) | `project` kind, `acuteNode.project`, project-scoped resources, `list_projects` / `create_project` (D33, D39) | 6, 7B |
| Resources `acute://project/{architecture,decisions,implementation-plan,progress}` (§10.2) | Project-scoped resources (§7.3) + `acute://lens/{key}` | 3, 7B |
| Prompts `initialize-project`, `update-architecture`, `sync-progress`, `document-decision` (§10.2) | §7.3 prompts (underscore names) | 7B |
| MCP server `instructions`, tool descriptions (§9 layers 1–2) | §7.3 "Server instructions" | 7B |
| Every write reviewable (§3) | D6 throughout; revert too (D30) | all |
| Data model split: Canvas / Agent / Project Knowledge / Entitlements (§10.6) | Canvas + Project Knowledge on the canvas (deliberate, D26, §3.6); Agent State store (D31); Entitlements none yet (D41) | 6, 7A |
| Generated `AGENTS.md` / `CLAUDE.md` / Cursor rules, the engineering skill (§9) | Entry points fixed (D49): `acute://setup/instructions/{client}` and `setup_project_instructions`, because the browser can't write files. **Skill text and templates: owner is an agent-setup plan, not yet written** | 7B (entry points) |
| Three workspace templates + onboarding (§9) | A template is ordinary canvas objects (a `project` node with `style`, an interactive L1 frame, milestones), accepted by `create_project` (D49). Template content and the onboarding flow: the agent-setup plan | 6, 7B |
| **Not Lens:** remote MCP, OAuth, accounts, entitlements, billing (§7, §10.4–§10.5) | Deferred (`hosted-deployment-decisions`). Lens guarantees: pure `domain/lens`, `SceneSource` interface, tab-only tools degrade, all tools via `ToolPolicy` (D41); Agent State records are JSON shaped for a hosted collection (D31) | — |
| Generic CRUD gaps: `delete_*`, `group_blocks`, connection update/delete, `list_blocks` (§10.2 C–D) | Phase 7C (D50), same change-set path, revertible via `restore` (D43). Canvas/page-level lifecycle (§10.2 B): open question 6 | 7C |
| **Not Lens:** GitHub integration, commit-triggered updates (§7, §10.4) | CAP-14; Agent Sync stays agent-driven (D14, D15). PR/commit evidence is additive (D20) | Later |
| **Not Lens:** pricing, market sizing, launch content (§6–§8, §10.1, §10.9) | Strategy, no implementation | — |
| Atomic decision/progress/status edits on existing nodes (§3 `record_decision`, `set_task_state`, promotion) | `update_node` change kind (D43): today's kinds can't patch a node's fields | 6 |
| Faithful revert, "Reversible: Yes" (§10.3) | `restore` change kind keeps ids and arrows (D43) | 7A |
| Frictionless agent loop, canvas updating as the agent works (§10.1, §9 demo) | Per-session auto-accept for Project writes, with exceptions (D44) | 7A, 7B |
| Deviating from a decision for a documented reason (§9) | `deviates_from` relation, deviation shown with the warning (D45) | 6, 7B |
| Agent State fields `operation, tool, arguments, result`; agent activity analytics (§10.6, §7) | `outcome`, `args`, `result`, session `usage`; rejections logged (D46) | 7A |
| Premium operation returns a clear entitlement response (§10.5) | `entitlement_required` shape from `ToolPolicy` (D49); nothing gated here | 7B |
| Project state on one canvas, architecture on others (§10.6 Project Knowledge vs Canvas State) | `acuteNode.refs`: semantic cross-canvas links, separate from canvas arrows (D53) | 6 |
| Agent setup as part of the MVP (§9, §10.8 item 6) | MC11 and the setup resource (D56); the agent-setup plan is required before 7B completes | 7B |
| Locked tool names for generated instructions (§9 reliability layers 2–3) | D55: names are the public API, no aliases | 7B |
