# Acute MCP Vision — product direction spec

**Status:** Exploratory strategy notes, not a build plan. This captures the product-direction discussion about
positioning Acute Notes as a human + AI-agent collaboration layer over MCP, the primitives/workflows that would
prove it out, and the monetization and market-sizing thinking that follows from it. None of this is scoped or
sequenced against `ai-phase-implementation-plan.md`, `acute-lens-plan.md`, or `product-positioning.md`'s Built/Planned
claims — treat every claim here as **Planned / aspirational** until it is designed, built and verified the way
`product-positioning.md` requires.

---

## 0. Current implementation readiness

**Read against the code as of 2026-10-02** (`src/mcp/*`), not just the docs. Overall: the **local MCP foundation is
more built than this doc assumes** — a typed, policy-gated tool surface, resources, prompts and the F43 Repo Map
already exist and already follow several of this doc's own principles (reviewable change sets, bounded/linked
context, a server-level `instructions` field). What's missing is almost entirely the things that turn that
foundation into the *product* this doc describes: remote/hosted access, accounts/entitlements, first-class
decision/progress primitives, the composite bootstrap/sync tools, generated agent-skill files, and anything
resembling context compression or multi-level architecture zoom for an agent. None of the pricing, market-sizing or
template/onboarding material in §6–§8 and §10.1–10.4 has a corresponding implementation yet — those sections are
pure strategy, not partially-built features.

| Spec capability | Status | What exists today | Gap to close |
|---|---|---|---|
| MCP transport | 🟡 Partial | Local-only: a Streamable HTTP bridge through the open browser tab (`src/mcp/bridge`), paired by a per-workspace token stored in local `meta` (`src/mcp/bridge/access.ts`). No remote/hosted server. | CAP-06's "remote MCP" direction; §10.5's OAuth-gated `mcp.acute.app`; needs a server-side workspace store first (today's workspace lives in the browser only). Hosting work items: §11.2 |
| Auth | ❌ Not built | A 32-byte pairing token per workspace, generated client-side, no accounts. | OAuth login flow (§8/§10.5); requires accounts, which `hosted-deployment-decisions` memory says is explicitly **deferred**, not merely unbuilt. Per-client tokens, modes and lifecycle that can come first on the local bridge: §11.1 |
| Read tools (group B/C) | ✅ Built | `search_workspace, get_canvas, get_page, get_selected_content, get_related_objects` (`src/mcp/tools/readTools.ts`) | — |
| Write tools (group B/C/D) | ✅ Built, reviewed | `create_block, create_page, create_table, create_todo, create_connection, move_object, update_block, render_visual_plan` (`src/mcp/tools/writeTools.ts`) — every write proposes a change set; the user accepts/rejects (F19/F25) | No `delete_*` tool for any object kind yet |
| Resources | ✅ Built | `acute://workspace/{id}`, `canvas/{id}`, `page/{id}`, `table/{id}`, `todo/{id}`, `context/current` — linked, bounded, `truncated` flagged (`src/mcp/resources`) | Maps to §10.2 group A/B's *reads*; no `acute://project/architecture`, `/decisions`, `/implementation-plan` — those aren't typed objects yet (next row) |
| Prompts | ✅ Built | 7 generic prompts (`review_canvas`, `summarize_investigation`, `action_plan`, `find_missing_scenarios`, `explain_architecture`, `review_code`, `meeting_notes`) plus `map_repo` (`src/mcp/prompts/registry.ts`, `src/mcp/tools/repoMap/prompt.ts`) | §3's `initialize-project`, `update-architecture`, `sync-progress`, `document-decision` prompts don't exist; today's prompts work on arbitrary canvas content, not typed project state |
| MCP server `instructions` | ✅ Built | `createAcuteMcpServer` already sets a server-level `instructions` string describing how to start and how writes behave (`src/mcp/server.ts`) | §9's reliability layer 1 is already real; extend its wording once typed project state (architecture/decisions/progress) exists to read |
| Repo Map (F43) | 🟡 Partial | `begin_repo_map, upsert_map_section, link_map_nodes, get_map_status, remove_map_nodes, tidy_map_section` tools; maps a repo onto a canvas one module at a time with staleness detection from `git diff` paths (`src/mcp/tools/repoMap`) | Local install only; the by-hand IDE-client check is still open (`pending-work-master-plan.md`); no multi-level L0–L5 zoom (see Lens row below) |
| Architecture zoom / Lens | ❌ Not built | Interactive architecture frames (single frame: node kinds, passport card, neighbourhood highlight) are done through Phase 2. **Nothing from Lens Phase 1A onward is built** — Lens is locked-decisions-only (`acute-lens-plan.md`) | §2's L0–L5 zoom and §4's "zoom" product philosophy are Lens's job; this is the single biggest gap between this doc's core differentiator and shipped code |
| Typed decisions / progress / "project knowledge" objects | ❌ Not built | Decisions and plans today are ordinary text/todo blocks a user or the `create_plan`/`turn into tasks` AI actions write — nothing is a typed, queryable "decision" or "progress" object | §3's `record_decision`/`get_decisions`, §9's skill, §10.2 group E, §10.6's `Project Knowledge` store all assume this exists; it's the prerequisite for most of §3 and §9 |
| Composite `acute_bootstrap` / `acute_sync` / `sync_project_state` | ❌ Not built | Closest equivalents: `acute://context/current` (what's open) and Repo Map's `get_map_status` (staleness) — both narrower and not composed into one call | Needs the typed-decisions/progress row above before it can return anything beyond canvas content |
| Context compression (`get_context`, token-budgeted retrieval) | 🟡 Partial, narrower than spec | Ask AI's context builder (`contextBuilder.ts`) already does bounded, priority-ordered retrieval (selection → nearby → related → keyword hits → rest) — but capped at **16,000 chars total / 4,000 per object**, keyword/IDF only, and built for the in-app chat panel, not exposed as an MCP retrieval primitive for an external agent | CAP-01 (semantic retrieval, larger budget) is the tracked gap; `get_context(task)` as an MCP-facing tool doesn't exist |
| Agent change history + revert | 🟡 Partial, different shape | Every AI write is a reviewable change set with provenance **before** it lands (Accept/Reject, F19/F25) — strong trust mechanism, but it's pre-apply review, not a persisted, attributable log of already-applied agent changes with a `revert_agent_changes` tool | §10.3's "Agent Change #142" log and revert-after-the-fact don't exist; may be partly redundant with change-set review rather than purely additive — worth deciding before building |
| Generated `AGENTS.md`/`CLAUDE.md`/Cursor-rules + engineering skill | ❌ Not built | Nothing in-app generates agent-facing instruction files; this repo's own `AGENTS.md` is Next.js's generated dev-mode file, unrelated to this idea | §9 in full: the skill content, the three workspace templates, and the onboarding flow that generates them |
| Workspace architecture templates + onboarding flow | ❌ Not built | New workspaces start blank | §9's "three templates" and step-by-step onboarding |
| Entitlements / billing / plan gating | ❌ Not built | No accounts, no plans, single local workspace per device | All of §7 and §10.4–10.6; blocked on the same deferred "accounts v1" decision as the Auth row |
| GitHub integration / git-aware auto-update | 🟡 Manual only | Repo Map's `get_map_status` flags staleness from `git diff` paths, but re-sync is the agent re-running the prompt by hand, not an automatic commit-triggered update | CAP-14 (external connectors) and §10.4's "automatic change detection" |

**Net reading:** the parts of this spec that are closest to shipping are the ones that extend the existing MCP tool
surface (new tools/resources/prompts for typed project state, a `delete_*` set, composite bootstrap/sync calls).
The parts that are furthest away are the ones that require product surfaces that don't exist yet at all — accounts,
billing, remote hosting, and Lens's multi-level zoom — and the strategy sections (§6–§8, §10.1–10.4) that depend on
those. Prioritizing "typed decisions/progress objects" unblocks the largest number of downstream rows in this table.

---

## 1. The reframe

Not "an AI note-taking app with MCP integration." The bigger opportunity:

> **Acute Notes becomes the persistent visual context layer between humans and coding agents.**

An agent session today is ephemeral — conversation, file reads, edits, then the reasoning gets buried in chat
history. A developer's mental model (architecture, decisions, unresolved questions, diagrams, constraints) lives
scattered across Markdown, Notion, diagrams, tickets and their own head. Acute sits in that gap.

Core loop:

```text
Developer (understands / decides / edits)
        │
        ▼
   ACUTE NOTES — visual + structured persistent context,
   decisions + links, architecture + TODOs
        │ MCP
   ┌────┴────┐
   ▼         ▼
 Codex    Claude Code
   │         │
   └────┬────┘
        ▼
  Code / Tests / PRs → new discoveries → back into Acute
```

**Important distinction:** don't position this as "Acute gives AI long-term memory" (commoditized). Position it as
**Acute gives AI and humans a shared external workspace for reasoning** — the AI uses it as an externalized
reasoning/context surface, the developer uses it as a visual understanding surface. One representation serves both.

---

## 2. The killer feature: context compression

A developer three weeks into a project has ~20 AI sessions, 8 PRs, 50 files modified, 200k+ tokens of conversation,
100+ decisions, dozens of investigations. You don't feed all of that to an agent. Acute maintains a structured
knowledge graph (architecture, decisions, current work, constraints, open questions, risks, historical context) and
retrieves a compact, relevant slice — e.g. ~1,500 tokens instead of 30,000 for a given task. That's the mechanism
behind the "smaller models become viable" thesis: a frontier model reconstructing "what is this project doing" from
100k tokens is expensive; a small model handed a well-chosen 3–8k-token context package can perform reasonably well.

```text
                 Acute Knowledge Layer
                         │
                 Context selection
                         │
             ┌───────────┴───────────┐
        Small model             Frontier model
        cheap/fast              expensive/deep
             └───────────┬───────────┘
                         ▼
                      Output
```

The visual layer is what differentiates this from a generic context-compression MCP server: the same underlying
structure renders as a machine-readable graph for the agent and as an actual diagram for the human, and the "zoom"
between system → architecture → component → flow → operation → source should be a core product philosophy, not a UI
feature (this overlaps with what `acute-lens-plan.md` already calls L0–L5).

---

## 3. Core MCP primitives (12, grouped retrieve / understand / write)

Kept deliberately small and semantic so an agent isn't reasoning over 50 generic tools — it asks for "context around
PaymentService" and Acute decides what's relevant, rather than the agent assembling it from raw search results.

**Retrieve**
1. `get_context(topic | file | task)` — compressed bundle: relevant architecture + decisions + constraints + open
   questions, token-budgeted
2. `get_decisions(scope)` — ADR-style records with reason + rejected alternatives
3. `get_architecture(node)` — structural map centered on a node, with zoom in/out edges
4. `get_related(entity)` — code/PRs/tests/discussions linked to a node
5. `search(query)` — fallback full-text/semantic search across the graph

**Understand** (derived, not stored)
6. `summarize_impact(diff | PR)` — what changed, why, architecture impact, risks
7. `get_open_questions(scope)`

**Write**
8. `record_decision(decision, reason, rejected[], links[])`
9. `update_map(node, change)` — structural update to the graph
10. `annotate(node, comment)` — human or agent note; becomes part of the reasoning trail
11. `log_discovery(finding, scope)` — ephemeral working knowledge, promotable later
12. `set_task_state(task, status)` — links current agent work to the map

Every write is a reviewable proposal, consistent with how Acute already treats AI writes (change-set review,
provenance) — nothing here should bypass that.

### A `get_relevant_decisions()` / "decision firewall" variant

Before changing something significant, an agent queries decisions and gets back an explicit warning, not just a
list:

```text
⚠ Important: this component was intentionally designed to remain backward compatible with v1 clients.
Do not modify the API contract. See Decision #27.
```

This reframes Acute from "stores knowledge" to "protects architectural intent" — stopping a future agent from
undoing a decision it has no visibility into (e.g. "I'll simplify this by removing Redis" when Redis was chosen for
a latency reason recorded weeks earlier).

### Three kinds of knowledge, with a promotion lifecycle

- **Stable** — architecture, domain concepts, system boundaries, conventions
- **Decision** — ADRs, tradeoffs, rejected alternatives, constraints, why something exists
- **Ephemeral working** — investigations, hypotheses, temporary findings, open questions, current task

```text
Ephemeral → Validated → Decision → Stable knowledge
```

---

## 4. Three killer workflows to prototype

1. **Understand an unfamiliar repo** — agent calls `get_architecture(root)` → `get_decisions()` for flagged areas →
   builds/populates the visual map as it reads code. Tests whether the generated map is actually more useful than
   reading files directly.
2. **Implement a feature with context compression** — agent calls `get_context("refresh-token rotation")`, gets a
   small bundle instead of scanning 30 files, implements, then calls `record_decision` + `log_discovery` for what it
   learned. Tests the core economic claim (smaller context, works with smaller models).
3. **Review what an autonomous agent changed** — after a longer unsupervised run, `summarize_impact(diff)` renders
   the before/during/after view (what changed, why, risk, what needs review) for the human, sourced from the
   `log_discovery`/`annotate` calls made during the run. Tests the human-oversight angle.

Judge each by one question: does the visual map add real value over a well-written text summary, or is the canvas
decorative? Worth testing before building further.

### The longer narrative version of workflow 3 (human oversight)

As agents work more autonomously, the open question stops being "is the code correct" and becomes "do I still
understand what the agent did." A before/during/after structure:

```text
BEFORE            DURING                              AFTER
Architecture  →    Agent discovered: ⚠ legacy dep  →   What changed
                   Agent decision: introduce adapter   Why
                   Agent changed: 7 files              Dependencies affected
                   Agent assumption: API contract       New risks
                   must remain                          Open decisions
                   Agent concern: test coverage missing
```

That's a human-readable audit trail of reasoning, not just a diff.

### "AI ↔ human negotiation" as an interaction model

Agent proposes options; Acute renders them (e.g. three migration approaches with their tradeoffs); the developer
annotates a preference/constraint directly on the option; the agent reads that annotation back through MCP and
continues. This turns `human → prompt → AI` into `human ↔ Acute ↔ AI`, i.e. human reasoning becomes structured input
to the agent, not just another prompt. This is also where the existing "comments on blocks" idea becomes more than
a collaboration feature — comments become AI-readable intent (e.g. "never retry card_declined").

---

## 5. Four-layer mental model for the MCP surface

```text
                    ACUTE MCP
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   RETRIEVE         UNDERSTAND      WRITE
 Context             Maps           Notes
 Decisions           Relationships  Decisions
 Architecture        Summaries      Diagrams
 Constraints         Impact         Comments
 History             Dependencies   Updates

              HUMAN EXPERIENCE
              Visual Workspace
          ┌──────────┴──────────┐
      Big Picture          Deep Detail
```

Acute's differentiation isn't storing more information — it's making the right information visible at the right
level of abstraction.

---

## 6. Launch positioning

Don't lead with "MCP-powered knowledge management" — developers don't wake up wanting MCP. Lead with:

> **Your AI agent can write the code. Can you still understand it?**

Before / with-Acute framing:

```text
BEFORE                          WITH ACUTE
Claude Code / Codex             Agent works
  ↓                               ↓
30-minute session               Acute captures discoveries
  ↓                               ↓
20 files changed                Architecture updates
  ↓                               ↓
"Done ✓"                        Decisions recorded
                                  ↓
                                 Dependencies visualized
                                  ↓
                                 Human reviews the change
```

Candidate taglines (pick one, don't market "all of Acute" at once):

- **Acute — The visual workspace for humans and AI coding agents.**
- **Your AI agent builds the code. Acute helps you understand it.**
- **Where developers and AI agents build understanding together.** (captures the long-term vision best)

MCP is the plumbing, not the product — the user shouldn't need to know it's MCP under the hood.

### Three marketing pillars

| Pillar | Developer pain | Acute answer |
|---|---|---|
| 🧠 Understand | "I don't understand this codebase anymore." | Visual system maps + AI-generated explanations |
| 🗺️ Remember | "Why did we build it this way?" | Decisions, architecture, context and history |
| 🤖 Control agents | "What did my AI agent actually change?" | Agent activity → visual changes → human review |

### Killer demo (one ~90-second video)

"I gave Claude Code a feature request." → let it work, while Acute builds architecture → dependencies → decisions →
code changes → open questions live → "Explain what changed" (zooms system → subsystem → component → function →
code) → "Why was this decision made?" (click node, decision appears) → "What should I review?" (three areas
highlighted). Not a 30-feature tour — one coherent loop.

### Content ideas for launch

1. "Watch Acute understand a codebase" — repo in, architecture/dependencies/visual map out
2. "Watch Claude Code update Acute" — live canvas changes during an agent session
3. "What happens after 100 AI coding sessions?" — blank canvas → complete engineering knowledge map
4. "Your AI agent forgot why you built this" — decision-memory use case
5. "AI wrote 20 files. Here's what actually changed." — impact-analysis demo

### The flywheel

Every AI coding session creates content Acute can surface: a developer posts "I asked Claude Code to refactor my
auth system — here's the before/after architecture Acute generated," which is far more shareable on X/HN/Reddit than
"I made another note-taking app."

---

## 7. Pricing: differentiate by intelligence, not call volume

**Do not** tier Basic vs. Advanced by number of MCP calls or number of exposed tools — that reads as an
implementation detail / API utility tax, not a reason to pay. Differentiate by how much understanding Acute
provides:

> **Basic MCP = Acute can access your workspace.**
> **Advanced MCP = Acute can understand and maintain your project's context.**

| Capability | Free / Basic MCP | Pro / Advanced MCP |
|---|---|---|
| Read pages / search / read blocks | ✅ | ✅ |
| Create/update notes | ✅ | ✅ |
| Create diagrams / read visual structure | Limited | ✅ |
| Project context retrieval | Basic | Advanced |
| Context compression | — | ✅ |
| Architecture understanding | — | ✅ |
| Decision memory | — | ✅ |
| Related-context retrieval | — | ✅ |
| Agent session history | — | ✅ |
| Code ↔ Acute relationships | — | ✅ |
| Impact analysis / "what changed?" | — | ✅ |
| Automatic knowledge updates | — | ✅ |
| Agent-generated architecture maps | Limited | ✅ |
| Cross-page reasoning | — | ✅ |

**Basic MCP = "remote control."** The agent can search, read, create and update inside the workspace
(`search("authentication")`, "create a page called API Design"). Already useful on its own — this is "give your
coding agent access to Acute," and it needs to stay genuinely useful or the upgrade path never gets discovered.

**Advanced MCP = "reasoning layer."** Instead of `search("authentication")`, the agent asks "give me the relevant
context for changing authentication" and gets back a compact package (architecture, decisions, constraints, risks,
related files, open questions) — this is "project context" vs. "workspace context":

- Free: *"Give your AI access to your notes."*
- Pro: *"Give your AI an understanding of your project."*

Other Advanced-only ideas:

- **Automatic context selection** — `get_relevant_context(current_task)` instead of the agent issuing a string of
  manual searches across a large workspace.
- **Agent/project memory** — not generic AI memory, project memory: a decision rejecting Redis for a deployment
  constraint should surface as a warning if a later agent session proposes reintroducing it.
- **Automatic visual-model maintenance** — code changes → Acute detects the relevant change → updates the
  architecture model → marks affected components → records the decision/change, so the workspace is living
  documentation rather than something the agent only writes to when asked.
- **Impact analysis** — "Can I change the UserService interface?" → Acute shows every component, API, test and
  integration that touches it, highlighted visually.

### Plan structure

```text
Free           Acute Workspace        — visual pages, canvas, notes, diagrams, Basic MCP,
                                         limited projects/context/history
Pro            Acute Intelligence     — everything in Free + Advanced MCP, project context,
($12–25/mo)                            context compression, decision memory, architecture
                                        understanding, impact analysis, agent session history
Team           —                      — shared projects, team architecture, decision history,
($20–40/user/mo)                        agent activity, permissions, GitHub integration
Enterprise     —                      — $10k–$100k+ annual, deployment/security/compliance,
                                         seats (not needed day one, but the data model should let
                                         individual knowledge naturally become team knowledge)
```

A possible later pricing axis: meter "AI Context" (a context-retrieval-usage unit, not raised as raw "tokens" to the
user) rather than storage, since Acute's own LLM/vector/processing costs scale with how much it understands and
synthesizes, not with how many notes are stored.

---

## 8. Market framing (explicitly a range, not a forecast)

**Caveat up front:** there isn't enough evidence to responsibly give one precise revenue number. Treat everything
below as scenario envelopes for planning, not predictions — and update them once `pending-work-master-plan.md`'s
scored killer-workflow runs come back, since those are the actual evidence this should be grounded in.

**Problem framing:** AI coding agents can now produce more work than developers can comfortably understand, review
and retain.

> AI builds the software. Acute keeps the developer in control of the understanding.

### Three adoption stages

1. **Developer tool** — ICP: AI-heavy developers / indie hackers / startup eng teams using Claude Code, Codex,
   Cursor, VS Code, GitHub, MCP. Problem: context fragmentation. Easiest wedge.
2. **Engineering knowledge layer** — once Acute connects code + architecture + decisions + agent sessions + tickets
   + PRs, it's sellable to teams as "the living engineering knowledge base," not a personal productivity tool.
3. **Human/agent workspace** — humans, agents and teams all read/write a shared project context. TAM moves well
   past "people who want better notes" into the intersection of developer tools, AI coding, knowledge management,
   architecture/documentation, collaboration and agent orchestration.

### Day-one reality: distribution is the constraint, not features

Scenario model for year one, assuming ~$8–15/user/month blended realized revenue:

| Month | Conservative | Base case | Strong execution |
|---|---:|---:|---:|
| 1 | 10 paid | 30 paid | 100 paid |
| 3 | 40 | 150 | 500 |
| 6 | 100 | 400 | 1,500 |
| 9 | 180 | 800 | 3,000 |
| 12 | 300 | 1,500 | 5,000 |

Implied MRR range at $10–12/user blended:

- Month 1: $100–$1,200 MRR
- Month 3: $400–$6,000 MRR
- Month 6: $1,000–$18,000 MRR
- Month 12: $3,000–$60,000 MRR

Reaching the base-case trajectory implies roughly **$50k–$100k first-year revenue**; strong PMF/distribution could
move that toward **$200k–$500k+**. Getting there needs sustained acquisition (developer communities, content,
integrations, referrals, team adoption), not just the feature set.

### Milestones to actually target (more useful than an MRR number)

- **First 100 users** — prove developers want their AI agent writing into Acute.
- **First 1,000** — prove Acute becomes part of the normal coding workflow, not a novelty.
- **First 10,000** — prove it's infrastructure for engineering teams, not just individuals.
- **Then** — reposition from "AI-powered notes" to "the context and reasoning layer for AI-native software
  development."

### Launch narrative priority

If prioritizing what to build and market first: **MCP integration + visual system mapping + decision memory + agent
activity/review** as the core narrative, rather than marketing all of Acute's existing functionality at once.

---

## 9. Making agents actually use it: skill + MCP + workspace template

MCP alone only gives an agent *access* to Acute — it does not make the agent reliably read or write at the right
moments. "Use Acute Notes as a knowledge base" is not a strategy; the agent needs an explicit behavioral contract on
top of the raw capabilities. OpenAI's own MCP guidance makes the same split: MCP provides the tools, and
project-level instructions (`AGENTS.md`) tell the agent **when** to use them, with an `instructions` field at the
MCP-server level for shared behavioral guidance (e.g. required tool sequences).

So this should be three layers, not one:

```text
                    ACUTE NOTES
        ┌────────────────┼────────────────┐
   MCP Server       Agent Skills       Workspace
        │                │             Templates
   "What can I do?"  "How should I?"  "What should
                                       we build?"
```

- **MCP** = capabilities (read architecture, read decisions, update architecture, update progress, create diagram,
  record decision — this is §3/§5 above).
- **Skill** = behavior (when to read before acting, when to write after acting, don't silently overwrite existing
  architecture, record significant decisions).
- **Workspace template** = methodology (the initial structure a new project starts from — modular, feature-based,
  service/distributed — so the user isn't handed a blank canvas but a preconfigured workspace that also teaches the
  agent how to maintain it).

### Onboarding should generate all three, not just create a canvas

Step 1 — what are you building (web app / API / AI application / full-stack / other). Step 2 — how should the
system evolve, framed in plain language rather than architecture jargon:

- 🧩 Modular — easy to replace components
- ⚡ Feature-based — organize around product capabilities
- 🏗️ Layered — clear separation between responsibilities
- 🔧 Custom — define your own structure

Ship **three templates** initially, not twenty:

1. **Modular** (likely default) — Presentation → Application → Domain → Infrastructure, with strict boundaries
   (adapters for database/external APIs/AI providers kept separate from domain logic). Particularly relevant for
   AI-native apps, where model providers, vector DBs and external services change quickly and the core logic
   shouldn't need to move with them.
2. **Feature-based** — one folder set (UI/API/domain/tests) per feature (auth, payments, notifications). Good for
   product applications.
3. **Service/distributed** — API gateway in front of per-domain services, with explicit service boundaries, API
   contracts, events, dependencies, observability and failure boundaries. For larger systems.

A later, ICP-specific template worth exploring: **AI-native application** (model provider → AI gateway →
application → domain → data/tools), with explicit principles around provider abstraction, model swapping,
structured outputs, retries, observability, evaluation, fallback and prompt/version management.

### The generated skill, conceptually

Not "use Acute Notes" but an explicit, falsifiable contract:

```text
# Acute Notes Engineering Workflow

Acute Notes is the persistent engineering context for this project.

## Before significant work
1. Read the current project architecture.
2. Read the current implementation plan.
3. Read relevant architectural decisions.
4. Check current project progress.
5. Identify existing components before introducing new ones.

## During implementation
Follow the architecture defined in Acute Notes.
Prefer modifying existing components over creating duplicates.
Keep module boundaries explicit.
Avoid coupling business logic directly to infrastructure.
When introducing a significant architectural change: explain the reason, update the
architecture, record the decision.

## After significant work
Update Acute Notes with: completed implementation work, architecture changes, new
dependencies, important decisions, remaining work.

## Important
Acute Notes is the source of truth for the project's high-level architecture and
implementation state. Do not assume the canvas is current without reading it. Do not
silently replace existing architecture.
```

Keep `AGENTS.md`/`CLAUDE.md` itself tiny — point at the skill rather than inlining the whole methodology:

```text
# Acute Notes
This project uses Acute Notes as persistent engineering context.
For architecture, implementation planning, decisions and project state, use the Acute
Notes MCP server.
Before significant changes: read relevant Acute Notes context.
After significant changes: synchronize relevant Acute Notes state.
Follow the Acute Notes engineering skill when performing architecture or project-state work.
```

### Explicit triggers beat "the model will figure it out"

| Situation | Agent action |
|---|---|
| Starting a new feature | Read relevant architecture |
| Architectural question | Read architecture + decisions |
| Large refactor | Read architecture + implementation plan |
| Adding a new service | Read architecture + boundaries |
| Changing a dependency | Read architecture + decisions |
| Completing a feature | Update progress |
| Architecture changed | Update architecture |
| Important tradeoff | Record decision |
| Agent resumes previous task | Read progress + recent changes |
| User asks "where are we?" | Read progress |
| User asks "why did we do this?" | Read decisions |

### Two high-level workflow tools worth adding to §3's primitive list

- **`acute_bootstrap`** — one call at the start of substantial work that returns the minimum useful context in a
  single shot (project, architecture style, current focus, implementation checklist, relevant decisions, recent
  changes, warnings) instead of forcing the agent to chain `get_project` / `get_architecture` / `get_progress` /
  `get_decisions` / `get_recent_changes` itself.
- **`acute_sync`** — one call at the end of substantial work where the agent reports what changed, what architecture
  changed, what decisions were made, what was completed and what's next; Acute updates the corresponding objects
  from that report.

```text
Coding agent → acute_bootstrap → read context → write code → test code → acute_sync
             → update Acute Notes
```

That bootstrap/sync pair is the actual "agent memory loop," and it's a stronger product surface than exposing many
small granular tools and hoping the agent calls them at the right time.

### Reliability through four layers at once, not one

1. **MCP server `instructions`** — universal behavior at the protocol level (e.g. "verify implementation against the
   repository; don't treat Acute Notes as a substitute for source code").
2. **MCP tool/resource descriptions** — tell the model what each capability does and when to use it.
3. **Generated project instructions** (`AGENTS.md`, `CLAUDE.md`, Cursor rules) — project-level behavioral contract,
   generated by Acute at workspace-creation time rather than hand-written by the user.
4. **High-level workflow tools** (`acute_bootstrap`, `acute_sync`) — make the correct behavior the easy path.

### Source-of-truth hierarchy — Acute is not a substitute for code

```text
SOURCE CODE     → actual implementation truth
TESTS           → behavioral truth
ACUTE NOTES     → architectural / contextual truth
AGENT SKILL     → engineering behavior
```

Acute should never assert "this architecture is definitely correct" — only "this is the current documented
architecture." Agents make mistakes, and decisions can be deviated from for a documented reason (e.g. "the payment
provider requires direct webhook handling") — that deviation itself becomes a recorded decision, which is what makes
the whole thing an auditable engineering memory rather than a static set of rules. Similarly, don't brand the
architecture guidance as "best practices" — call it "engineering playbooks" / "architecture patterns," and phrase
skill guidance as "prefer X unless there is a documented reason not to."

### This changes what counts as MVP (additive to whatever MVP scope is decided elsewhere)

| Feature | Treat as must-have |
|---|---:|
| `acute_bootstrap` | ✅ |
| `acute_sync` | ✅ |
| MCP server instructions | ✅ |
| Engineering skill (one default, well-made) | ✅ |
| Workspace architecture templates (3, not 20) | ✅ |
| Generate `AGENTS.md` | ✅ |
| Generate Claude-compatible instructions | ✅ |
| Generate Cursor-compatible instructions | ✅ |

The claim worth testing: this set makes the MVP meaningfully more compelling without making it meaningfully bigger,
because it's mostly instruction generation and two composite tools layered on top of primitives §3 already needs.

### Onboarding flow this implies

Connect → choose architecture template → **Acute generates `AGENTS.md`/`CLAUDE.md`/Cursor rules automatically** (the
user never has to understand MCP internals or hand-write the skill) → "Initialize this project in Acute Notes:
analyze the existing codebase, identify the architecture, create the workspace structure, record current
implementation state — do not modify code yet" → code with the agent → Acute Notes stays updated via
`acute_sync`.

Landing-page framing this supports: not "Connect Acute Notes to your MCP-compatible AI agent" but **"Give your
coding agent a memory"** — Acute remembers architecture, decisions, implementation plan and project state, and keeps
it synchronized while the agent writes the code. Demo: prompt → code changes → canvas updates automatically, no
separate narration needed.

---

## 10. MVP scope and launch sequencing

This section narrows §1–9 into an actual cut: what ships first, what's deliberately deferred, and how free vs. paid
should be framed given that. It also **refines §7's pricing split** — read this section's §10.4 as the more
concrete version of "don't tier by call volume," not a contradiction of it.

### 10.1 The sharper wedge

Don't launch as "another AI note-taking/canvas app" with document import, collaboration, etc. Launch as:

> **Acute Notes for developers: connect your coding agent through MCP and turn the agent's work into a living,
> visual engineering workspace.**

Core loop:

```text
Developer → Claude Code / Codex / Cursor → Acute Notes MCP → Canvas
```

Continuously: agent reads context → understands project → creates/updates Acute Notes → developer sees visual
state → developer asks the agent to change something → canvas updates.

**"MVP" doesn't mean "few MCP tools."** It means the developer → agent → Acute Notes → visual workspace loop has to
work extremely well end to end — which argues for a reasonably rich MCP surface from day one, not a minimal one.

### 10.2 MCP surface, organized by the protocol's three primitives

MCP's own model splits capabilities into **Tools** (act), **Resources** (retrieve context) and **Prompts** (reusable
workflows) — map Acute's surface onto that split rather than inventing a flat tool list:

- **Tools = do things** — e.g. `create_architecture_node`, `update_progress`, `connect_components`,
  `record_decision`, `revert_changes`.
- **Resources = understand things** — addressable context the agent fetches as needed, e.g.
  `acute://workspace/project`, `acute://project/architecture`, `acute://project/implementation-plan`,
  `acute://project/decisions`, `acute://project/progress`, `acute://canvas/{id}`.
- **Prompts = give agents workflows** — e.g. `initialize-project` ("analyze this repo and create an initial
  engineering workspace"), `update-architecture` ("compare the codebase with current architecture and update only
  what changed"), `sync-progress`, `document-decision`.

Grouped by function (supersedes the flatter 12-primitive list in §3 with a fuller MVP-level surface; §3's
`get_context`/`record_decision`/etc. map onto group D/E below):

```text
A. Workspace   — list_workspaces, get_workspace, list_projects, create_project, get_project
B. Canvas      — list_canvases, create_canvas, get_canvas, update_canvas, delete_canvas
C. Blocks      — list_blocks, get_block, create_block, update_block, delete_block, move_block, group_blocks
D. Relations   — create_connection, update_connection, delete_connection
E. Dev workflow — get_project_context, get_architecture, get_implementation_plan, update_implementation_plan,
                  update_progress, record_decision, record_change, get_recent_changes, revert_agent_changes
```

Not every item in group E needs to be its own literal tool — a composite like `sync_project_state` that
intelligently updates architecture, implementation plan, progress, decisions and dependencies in one call is more
useful than forcing the agent through many small canvas operations (this is the same idea as `acute_bootstrap` /
`acute_sync` in §9, just named as a single `sync_project_state` tool here).

### 10.3 Agent Change History is MVP, not a nice-to-have

Every MCP mutation should produce an attributable, reversible record:

```text
Agent Change #142
Agent: Codex · Time: 21:14
Changed: + Authentication service, + Google OAuth node, + Firebase Auth connection
Reason: Implemented Google authentication.
Reversible: Yes
```

This is what makes `revert_agent_changes` possible and is the direct answer to "what the hell did the agent just
change" — it's also the trust foundation the rest of the product depends on, so it belongs in the first release, not
a later one.

### 10.4 Free vs. paid: give away the whole core loop

Don't split individual CRUD operations (canvas create/read/update, agent read/write access) between plans — that
makes the free tier feel artificially crippled and undermines the "experience the whole magic for free" motion that
a waitlist/launch strategy depends on. Free should include: remote MCP, OAuth, a workspace with a few projects,
full canvas read/write, architecture diagrams, implementation plans, progress tracking, decision records, change
history, and revert — i.e. the entire loop described in §10.1, just capacity-limited (workspace/project counts,
usage limits), not capability-limited.

Paid (Pro) should monetize things that only matter once the loop is already proven valuable: unlimited
projects/canvases, large-workspace context, GitHub integration and git-aware updates (automatic change detection
tied to commits), multiple concurrent agents, agent activity analytics, advanced history, custom MCP
prompts/resources, webhooks, API access, higher limits. Team/Enterprise layers in SSO, SCIM, RBAC, audit, org
policies, private/self-hosted MCP, compliance.

This is consistent with where the market already sits: PostHog's hosted MCP is free, Linear's remote MCP is
OAuth-authenticated with read/write scopes rather than crippled-by-default, and dedicated MCP marketplaces already
support subscriptions and usage limits rather than per-tool gating.

**Framing on the pricing page:** not "MCP — $10/month" (that sells infrastructure). Sell the outcome — e.g. "Acute
Notes Pro: unlimited agent synchronization, projects, history and advanced developer workflows."

### 10.5 Billing architecture sketch

```text
Claude Code / Codex / Cursor → mcp.acute.app → OAuth → Acute account
                                                            │
                                                      Subscription → Entitlement
                                                            │
                                              ┌─────────────┴─────────────┐
                                           Free plan                  Pro plan
                                        (quotas, projects)      (unlimited, advanced tools)
```

Connection flow: OAuth → identify user → identify workspace → check subscription → check permissions → expose
appropriate capabilities. Tools don't necessarily need to be hidden outright for free users — a premium operation
can be exposed and return a clear entitlement/authorization response when attempted, which fits MCP's existing
OAuth-based authorization model for protected remote resources rather than requiring a bespoke gating mechanism.

**Credentials before OAuth:** §11.1 lists the token design (per-client tokens, a mode per token, hashed storage,
expiry and rotation) to build first, on the local bridge, and then carry into this hosted flow. It is modelled on
AFFiNE's shipped MCP credentials.

**Cost structure point worth keeping in mind:** MCP calls themselves are comparatively low variable cost. The LLM
inference happens in the developer's own agent/provider (Claude Code, Codex, Cursor); Acute's MCP server mostly
authenticates, reads/writes Firestore, and returns structured results. Infrastructure cost (Firestore, Cloud
Run/functions, networking, storage, monitoring) still exists, but there's no inherent per-call LLM inference bill on
Acute's side — a materially cleaner cost story than shipping a built-in AI chat product.

### 10.6 Data model split worth deciding early

Separate these four concerns now, since it's much cheaper to separate them before paid tiers exist than after:

```text
Canvas State      — canvas, blocks, edges, metadata
Agent State        — agent_id, session_id, operation, timestamp, tool, arguments, result
Project Knowledge   — architecture, implementation_plan, decisions, progress, dependencies
Entitlements        — plan, workspace, limits, features, mcp_access
```

### 10.7 What not to build before launch

PDF/PPT/DOCX/generic document import, AI chat inside Acute, a built-in LLM, a full RAG pipeline, mobile app,
consumer note-taking features, a templates marketplace, multi-user collaboration, comments, complex sharing, voice,
generic knowledge management, Notion/Obsidian import, a large block library. None of these test the core hypothesis
(does a developer's coding agent reliably keep a visual workspace in sync, and does that workspace make the
developer faster/more in-control). They can come later once that hypothesis is validated.

One specific sequencing call: **pause Viz Studio / the zoomable architecture surface as a separate product
feature for now.** Make the existing canvas the first MCP-powered visual engineering surface; once developers are
actually using that loop, the architecture-zoom experience (§2's levels, `acute-lens-plan.md`'s L0–L5) becomes the
natural next layer rather than a second surface competing for attention before the first one is proven. Sequence:
**MCP → developer adoption → living canvas → architecture zoom → team/enterprise → paid tiers.**

### 10.8 MVP, reduced to six things

1. Remote MCP server
2. OAuth + workspace authentication
3. Read/write canvas through MCP
4. Architecture + implementation-plan + progress primitives
5. Agent change history + revert
6. An excellent Claude Code / Codex / Cursor setup experience (this is §9's generated `AGENTS.md`/`CLAUDE.md`/Cursor
   rules, not a manual copy-paste instruction)

Everything else in §10.7 waits.

### 10.9 Marketing framing this sequencing supports

Lead demo: "Implement authentication" → agent modifies N files → without Acute, the developer has to reconstruct
what happened by reading the diff; with Acute, the agent has already updated architecture, implementation plan,
progress and recorded decisions, visible on the canvas as it worked. Candidate lines: **"Your coding agent needs a
visual memory,"** **"Give your coding agent a living map of your project,"** or **"Your AI writes the code. Acute
Notes keeps the system understandable."** ICP for this launch is specifically AI-native developers on Claude Code,
Codex, Cursor or similar — not a general knowledge-worker audience (contrast with the broader ICP scoring already
underway in `ai-future-workflow-enhancements.md` §4, which should stay a separate, longer-horizon track).

---

## 11. Work outside Lens, from the AFFiNE review

**Source:** [`affine/affine-mcp-analysis.md`](./affine/affine-mcp-analysis.md) ("Lessons for Acute"; the IDs below,
such as A1 or C3, refer to that list). Checked against `acute-lens-plan.md` on 2026-10-03.

**What this section holds:** the lessons that **don't belong to Lens** and need **no Lens redesign**. They can wait
until the track that owns them starts.

The lessons that touch Lens are in `acute-lens-plan.md` (lessons review, 2026-10-03):
- **C6, search reads project fields:** Phase 6, built.
- **A1 → D32, agent identity is client-reported, `credentialId` reserved:** D61, Phase 7A.
- **E3, attribution test:** Phase 7A row.
- **C2, C4, C5, B2, D1, D2, I3:** §7.3 "Tool contract rules", Phase 7B.
- **G2, paged canvas reads:** Phase 3 row.

Items 11.1.7 (fills D61's `credentialId`) and 11.3.2–11.3.3 (build on 7B's `retrieval_mode`) depend on those.

**When planning a track below, start from this list.** Each item names its trigger (when to pick it up) and what it
depends on.

### 11.1 Auth and credentials track

Owns §10.8 MVP item 2 ("OAuth + workspace authentication") and §0's Auth row. Today there is one 32-byte pairing
token per device, in plain text in local `meta`, shared by every client (`src/mcp/bridge/access.ts`).

| # | Item | Why (evidence from AFFiNE) | Trigger | Depends on |
|---|---|---|---|---|
| 11.1.1 | **One token per MCP client**, with a label ("Claude Code", "Cursor"), so each can be revoked alone (A1) | AFFiNE: "Use a separate credential for each MCP client so it can be revoked independently." Today, regenerating Acute's token disconnects every client | First auth work; can be done on the local bridge before hosting | — |
| 11.1.2 | **Read-only or read-write mode per token**, read-only by default (A2). Replaces the per-workspace switch (`setMcpReadOnly`) | AFFiNE scopes the mode to each credential. Per workspace is too coarse once several agents connect | With 11.1.1 | `ToolPolicy` resolves per call already, so the write tools need no change (lens plan D41) |
| 11.1.3 | **Store a hash, show the token once, list tokens by fingerprint** (A3) | AFFiNE stores SHA-256 plus a 12-character fingerprint: "You won't be able to see it again" | With 11.1.1 | The setup UI (11.5) can no longer re-display the token, so the config snippet is generated at creation time |
| 11.1.4 | **Typed, versioned token prefix**, e.g. `acute_mcp_v1.` (A4) | AFFiNE's `aff_mcp_v1.` makes tokens recognisable to secret scanners and lets the format change | With 11.1.1 | — |
| 11.1.5 | **Last used**, updated at most every 5 minutes (A6) | Answers "is this client still connected?" at little cost | With 11.1.1 | — |
| 11.1.6 | **Expiry, rotation, revocation by family** (A5): required expiry (30, 90 or 365 days); rotation keeps the old token valid for 24 h; status `EXPIRING` 7 days before expiry | AFFiNE's v0.27 credential model is a ready reference design | Hosted MCP (§10.5) | 11.1.1–11.1.5 |
| 11.1.7 | **Verified agent identity in Agent State.** Once tokens are per client, fill the `credentialId` the lens plan reserves on change and session records. The History tab can then say which credential made a change, not only the client's self-reported name | Today `agent` is the MCP `clientInfo.name`, which any client can set | With 11.1.1 | Lens plan D32 note (field reserved there) |
| 11.1.8 | **Never remove an auth method without a deprecation window** (A7). Version tokens and endpoints | AFFiNE dropping personal access tokens in v0.27 broke the most popular third-party server (issue #15251) | Any auth change after launch | — |
| 11.1.9 | **OAuth for remote clients** (§10.5's flow) | AFFiNE has none; Linear and PostHog do. Bearer tokens alone are fine locally, OAuth is better for a hosted launch | Hosted MCP | Accounts (deferred, `hosted-deployment-decisions`) |

### 11.2 Hosting and protocol track

Owns §10.8 MVP item 1 ("Remote MCP server") and §0's MCP transport row.

| # | Item | Why (evidence from AFFiNE) | Trigger | Depends on |
|---|---|---|---|---|
| 11.2.1 | **One endpoint per workspace** (e.g. `/api/workspaces/{id}/mcp`), working with no browser tab open (B1) | AFFiNE's remote server reaches any client from any machine. Acute's local bridge needs an open tab | Hosted MCP | Server-side workspace store; lens plan D41's `SceneSource` interface makes the tools portable |
| 11.2.2 | **Negotiate several protocol versions** (B3) and test against an older client | AFFiNE accepts 2024-10-07 through 2025-11-25 | Before the hosted launch; worth checking now what the SDK version in use already negotiates | — |
| 11.2.3 | **Cap batch size and rate-limit** the hosted endpoint | AFFiNE caps batches at 20 and throttles the endpoint | Hosted MCP | 11.1 (per-token limits) |
| 11.2.4 | **Document the `mcp-remote` fallback** for clients that can't send custom headers (B4); for local use, list which clients reach a localhost endpoint | AFFiNE documents it, and supports Claude Code, Cursor, Cline and LobeHub | Hosted launch docs; the local list any time | — |
| 11.2.5 | **Keep the official MCP SDK** unless it blocks a stateless hosted deployment (B5) | AFFiNE removed the SDK and hand-wrote the protocol (PR #14579). That trades spec currency for control | Revisit only if hosting hits an SDK limit | — |
| 11.2.6 | **Emit lifecycle events** for tokens and sessions (`created`, `rotated`, `revoked`, `session started/ended`) (I1) | AFFiNE emits `mcp.credential.*` events. Audit, analytics and notifications can then hook in without touching auth code | With 11.1 | — |
| 11.2.7 | **Decide the licence for a hosted or self-hosted MCP server early** (H3) | AFFiNE's app is MIT but its server, which contains MCP, is under its Enterprise licence. That decides who can self-host it in production | Before publishing any server code | — |
| 11.2.8 | **Fast markdown ↔ document conversion** (I2), only if it becomes a hot path for hosted MCP | AFFiNE does this in Rust exposed to Node | Only if profiling shows a need | — |

### 11.3 Semantic retrieval (CAP-01)

Owns the "Context compression" row in §0 and §2's quality ceiling. `get_session_context` (lens plan Phase 7B) ships
on keyword search; this is how it gets better without a new tool.

| # | Item | Why (evidence from AFFiNE) | Trigger | Depends on |
|---|---|---|---|---|
| 11.3.1 | **Hybrid search**: keyword and embedding search run in parallel, then merged by reciprocal-rank fusion (`1/(60+rank)`) with reranking (C1) | AFFiNE's `doc_search` (`retrieval/document.ts`) is a working reference design | When CAP-01 starts | An embeddings provider; the index already holds the text |
| 11.3.2 | **One search tool; the server chooses the strategy.** Don't add a separate `semantic_search` (D2) | AFFiNE merged `keyword_search` and `semantic_search` into one `doc_search` | When CAP-01 starts | Lens plan 7B reports `retrieval_mode`, so agents see the upgrade without a new tool |
| 11.3.3 | **Degrade visibly**: when embeddings are unavailable, fall back to keyword search and say so (`degraded_reason`) | AFFiNE reports `VECTOR_UNAVAILABLE` / `LEXICAL_UNAVAILABLE` | When CAP-01 starts | The `retrieval_mode` field from lens plan 7B |

### 11.4 Existing `search_workspace` tool

A small change to a tool that's already built. It can happen any time, independent of Lens phases.

| # | Item | Why (evidence from AFFiNE) | Trigger | Depends on |
|---|---|---|---|---|
| 11.4.1 | **Return locators in hits**: element id, frame id and Lens key, not only the object (C3), so a hit feeds `focus_lens`, `get_related_objects` or a write directly | AFFiNE's hits carry `block_id`, `element_id` and `frame_id`, and its product page sells whiteboard locators as a differentiator | Any time | — |

### 11.5 MCP settings and setup UI

Owns §9's onboarding flow and §10.8 MVP item 6. The lens plan serves agent-instruction files (D49); it doesn't
cover the connection screen.

| # | Item | Why (evidence from AFFiNE) | Trigger | Depends on |
|---|---|---|---|---|
| 11.5.1 | **An "Integrations → MCP" area** with a time-to-connect promise (F1) | AFFiNE: Settings → Integrations → MCP Server, "3 minutes" | Setup UI work | — |
| 11.5.2 | **Create dialog**: label, mode, expiry; then a reveal dialog with copy buttons for the token **and a ready config snippet per client**, with endpoint and token filled in (F2) | AFFiNE gives one generic `mcpServers` JSON snippet; Acute can give one per client (Claude Code, Codex, Cursor) | With 11.1 | 11.1.1–11.1.3 |
| 11.5.3 | **Token list**: status, fingerprint, created / last used / expiry, Rotate and Revoke (F3) | AFFiNE's credential list | With 11.1 | 11.1 |
| 11.5.4 | **Plain-words capability list** next to each token, reflecting its mode ("Read your canvases", "Propose changes for review") (F4) | AFFiNE lists "Read documents", "Keyword search", "Semantic search", … | With 11.5.2 | 11.1.2 |
| 11.5.5 | **Connection setup and agent instructions in one flow**: the snippet (11.5.2) plus the generated `AGENTS.md` / `CLAUDE.md` / Cursor rules (lens plan D49, §9 here) (F5) | AFFiNE stops at the snippet; that is where Acute goes further | With 11.5.2 and lens plan 7B | Lens plan D49 entry points |
| 11.5.6 | **Hide or explain anything switched off**, never a panel that silently fails (F6) | AFFiNE had to hide its MCP panel when AI was off on self-hosted installs (issue #15644, PR #15645) | Any setup UI | — |

### 11.6 Rules to keep (already decided; no work, but don't undo them)

AFFiNE is evidence for each of these. Each entry gives the Lessons ID, then the rule, then where it's decided.

**Writes and review**
- **E1, E2. Every agent write is reviewed; writes ship on stable builds.** AFFiNE's unreviewed writes have stayed
  on dev/canary builds since January 2026. Decided in lens plan D6 and D44.
- **E5. Agent change history and revert stay in the MVP.** AFFiNE has neither. Decided in §10.3 here and lens plan
  7A.
- **E4. Capability availability is exposed to the UI and to agents.** Uses `availableTools` in
  `acute://context/current`. Already built.

**Tool shape**
- **D3. Explicit input bounds in every tool's schema.** An existing convention.
- **D4. Bounded payloads with `truncated` flags, never whole unbounded documents.** AFFiNE's `read_document` returns
  the whole doc. Decided in lens plan §7.
- **D5. Per-object writes, not whole-document rewrites.** AFFiNE's `update_document` takes the full body. Decided in
  lens plan D5 and D6.

**Product surface**
- **G1. The canvas is what agents read and write; lead with it in comparisons.** AFFiNE's whiteboard isn't exposed
  over MCP (issue #14448). Built and planned.
- **H4. Ship a complete enough tool set that a community server doesn't replace ours.** AFFiNE's thin server led to
  a 106-tool third-party one. Decided in lens plan 7C.

**Pricing and positioning**
- **H1. Don't charge for MCP access; charge for what agents get on top.** AFFiNE's MCP is free. Decided in §10.4.
- **H2. The message is about the agent's work, not "answers from your notes".** AFFiNE's pitch is "grounding".
  Decided in §6 and §10.9.

### 11.7 Order of pickup

Shown as track → items, in rough order:

1. **Now, if wanted (local, small):**
   - 11.4.1 (locators in search hits)
   - 11.2.2 (check what protocol versions the SDK negotiates)
   - the local half of 11.2.4 (which clients reach localhost)
2. **First auth work (local bridge):** 11.1.1–11.1.5, 11.1.7, 11.2.6, then the UI items 11.5.1–11.5.4 and 11.5.6.
3. **After lens plan 7B:** 11.5.5.
4. **Hosted MCP:** 11.1.6, 11.1.9, 11.2.1, 11.2.3, the docs half of 11.2.4, and 11.2.7 (decided before any server
   code is published).
5. **CAP-01:** 11.3.1–11.3.3.
6. **Ongoing:**
   - 11.1.8 (any auth change after launch)
   - 11.2.5 (only if the SDK blocks hosting)
   - 11.2.8 (only if profiling shows a need)
   - 11.6 (rules to keep)

---

## 12. Open questions / what this doc does not answer

- Which of these primitives map onto already-planned work in `acute-lens-plan.md` (the L0–L5 hierarchy, Agent Sync,
  MCP extension in Phase 3) versus requiring new surface area? **Answered 2026-10-03:** `acute-lens-plan.md` §13
  maps every MCP feature here to a Lens decision, section and phase (D30–D42 added the missing ones), or names it as
  "not Lens" with what Lens guarantees for it.
- Which of CAP-01 through CAP-20 in `ai-future-workflow-enhancements.md` (large-context retrieval, codebase
  ingestion, workspace memory, MCP write tools) are prerequisites for `get_context`/`summarize_impact` specifically?
- None of the pricing tiers or revenue scenarios should be repeated externally as commitments — they're planning
  inputs, not promises.
