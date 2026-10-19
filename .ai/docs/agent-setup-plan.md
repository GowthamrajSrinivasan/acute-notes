# Agent setup — plan

Status: **Approved** (2026-10-03, user review): S1–S7 are the setup contract; Q1–Q3 are resolved below. Phase 7B
implements it. The exact client file syntax (§A3) is **verified against each client's own documentation at
implementation time**, before the client artifacts are generated (Q1).

Parent plan: [`acute-lens-plan.md`](./acute-lens-plan.md): D49 (setup contracts), D55 and D62 (canonical names), D56
(setup is part of the MCP slice), D63 (this plan is a gate), §7.3 (tools), §10.2 MC11 (acceptance). Requirements:
[`acute-mcp-vision-spec.md`](./acute-mcp-vision-spec.md) §9 (reliability layers, templates) and §10.8 item 6.

This plan has three parts, kept apart on purpose:

- **Part A, client setup variants** (Claude, Codex, Cursor). These are the artifacts **MC11 tests**: what an agent
  is told about Acute, when to use it, and how to use it.
- **Part B, workspace templates** (modular, feature-based, service). These are project **starting structures** that
  `create_project` accepts. They are **not** part of MC11, and nothing in Part A depends on which template a project
  used.
- **Part C, the persistence boundary.** What agents record in Acute and what they must not. Part A states it to the
  agent, and Part B's structures assume it.

---

## 0. Decisions this plan asks you to approve

| # | Proposal | Why |
|---|---|---|
| S1 | **One shared core text plus three thin client wrappers.** The guidance (Part A §A2) is identical for every client. A variant differs only in target file, file format and tool-call conventions (§A3). | The rules shouldn't drift between clients; MC11 then checks one text three times. |
| S2 | **Tool names in the text are placeholders resolved against the live registry**, never literals: `{{tool:get_session_context}}`. Generation **fails** when a placeholder names an unregistered tool. The "Available tools" section is generated from the registry, filtered by `ToolPolicy`. | MC11(b): the artifact names only tools that exist. A rename can't leave stale names behind (D55). |
| S3 | **Read-only workspaces get a read-only variant.** When `allowWrites` is off, write tools are omitted from the list, and the workflow says to read only and tell the user that writes are off. | The text must never instruct a call the server will refuse. |
| S4 | **The written file is fenced** between `<!-- acute-notes:start -->` and `<!-- acute-notes:end -->`. `setup_project_instructions` tells the agent to replace only that block, or append it, and never touch the rest of the file. | Users already have `CLAUDE.md` / `AGENTS.md` content; re-running setup must be safe and repeatable. |
| S5 | **Size budget: ≤ 7,000 characters per artifact**, the generated tool list included (one line per tool). The draft in §A2, with the expected 7B list, measures about 6,000. | Agents read it every session; the session context, not this file, carries the project's knowledge. |
| S6 | **Templates create structure, never content.** A template makes the `project` node, the frames and their level conventions. It invents no architecture nodes, decisions or progress (Part B). An optional starter milestone exists only if the user ticks it. | "Never fabricate project state" applies to templates too. |
| S7 | **The persistence boundary in Part C is normative**: the core text states it, and the 7B write tools' descriptions repeat the relevant line (layer 2 of the vision spec's reliability layers). | One rule, stated where the agent decides. |

---

## Part A — Client setup variants (MC11)

### A1. What the setup resource returns

- `acute://setup/instructions/{client}`, where `client` is `claude`, `codex` or `cursor`. It returns
  `{ client, targetPath, format, content, toolCount, generatedFrom: { writesAllowed, style? } }`. `content` is the
  complete fenced block (S4). An unknown client returns a "not found" error that lists the three valid values.
- Prompt `setup_project_instructions(client)` returns a message telling the agent to fetch that resource, write
  `content` to `targetPath` in the repository root (replacing only the fenced block, or appending it), show the user
  the diff, and change nothing else.
- In the app (D49): ⋮ More → MCP access gets an "Agent instructions" row with a client picker and **Copy** /
  **Download** buttons. Acute never writes into the repo itself (it has no file access).
- Generated per call from: the static core text (§A2), the client wrapper (§A3), the live tool/resource/prompt
  registry under the current `ToolPolicy` (S2, S3) and, when the workspace has exactly one project, that project's
  `style`. The style adds one line about level conventions, from Part B. Nothing else project-specific goes in. The
  project's knowledge comes from `get_session_context` at run time, not from this file.

### A2. The shared core text (proposed wording; review this)

The block below is the text every variant carries, before the client wrapper. `{{tool:…}}` and `{{resource:…}}` are
the S2 placeholders; `{{toolList}}` is the generated list. Headings are stable: MC11 asserts them.

```markdown
<!-- acute-notes:start -->
## Acute Notes (project memory and architecture, over MCP)

### What it is
Acute Notes is this project's shared, human-reviewed memory: its architecture (frames of components and how they
relate, drilled from system level down to source in Lens), its decisions and constraints, findings, risks, open
questions, milestones and progress. You reach it through the `acute-notes` MCP server. Everything you write is a
proposal the user reviews on their canvas; nothing changes until they accept it (unless they turned on auto-accept
for your session, and even then removals, reverts, constraints and enforced decisions wait for them).

### When to use it
- At the start of any non-trivial task, and when resuming earlier work.
- Before changing code that touches an area Acute documents, to see the decisions and constraints that protect it.
- When you make or discover something a later session would need (Part C below): a decision, a constraint, a
  finding, a risk, an open question, a change of plan or progress.
- At the end of a session, once.
Skip it for trivial, self-contained edits that change no structure and need no recorded reasoning.

### Start of a session
1. Call {{tool:get_session_context}} with `task` (one line: what you are about to do) and, when you know them,
   `paths` (files you expect to change) and `keys` (Lens keys). Keep the default budget unless you need more.
2. Read `warnings` first, then the project's focus and the previous session's `next`.
3. If it reports no project, ask the user before running the {{prompt:initialize_project}} prompt; never create a
   project on your own initiative.
4. If `retrieval_mode` is degraded, treat the context as incomplete and say so when it matters.

### Warnings (constraints and enforced decisions)
A warning is a recorded constraint, or an enforced decision, on something in scope. Do not act against one. If the
task genuinely needs to, stop and ask the user. If they agree, record the exception with {{tool:record_decision}}
using `deviates_from` and a one-line reason, so the original stays in force everywhere else. Do not re-propose what
`recentRejections` shows the user declined.

### What to record (and what not to)
Record durable knowledge only:
- a decision between real alternatives that later work must respect: {{tool:record_decision}} (with `options` when
  the user should choose; `constraint` only when the user says it must always hold);
- a non-obvious finding, hypothesis, assumption or concern; an open question that needs a human; a risk:
  {{tool:log_finding}};
- progress at milestone or task granularity, and the next step: {{tool:update_progress}};
- a change of status (finding validated, question answered, decision superseded): {{tool:update_knowledge}};
- a change to the architecture's structure (a component, a boundary, a relationship): the repo-map tools
  ({{tool:upsert_map_section}}); a note on a specific node for the user: {{tool:annotate}}.
Never record: your reasoning or chain of thought, command or test output, logs, every file you edited, routine
refactors, restatements of the code, secrets, or speculation presented as fact. Keep each record to a short line;
put longer write-ups on a page ({{tool:create_page}}) and reference it.

### End of a session
Call {{tool:sync_session}} once with a short `summary`, the `changed` paths (with a few words each), any decisions,
findings and progress from this session that you haven't recorded yet, and `next` (what the following session
should pick up). It produces ordinary proposals for the user's review. Do not call it after every step.

### When Acute and the code disagree
The code and the repository are the source of truth; Acute is the documented understanding of them. When they
conflict, trust the code, do not change code to match Acute, and record the divergence: a finding (`concern`) on the
affected node, or a repo-map update if the structure has changed. Tell the user what you found.

### When a proposal is refused
If a write fails because the user is reviewing your previous proposal, or another session's proposal changes the
same objects, stop and tell the user; do not retry in a loop or route around it with other tools.

### Never fabricate project state
Record only what you observed in the code, were told by the user, or decided with them. Never invent decisions,
progress, components, owners, dates or test results. If you are unsure, record an open question or a hypothesis,
not a fact. Mark nothing done that you have not verified.

### Available tools, resources and prompts
{{toolList}}
<!-- acute-notes:end -->
```

The client wrapper (§A3) adds a short preamble line and the call-convention note above `### Available tools`. With
writes off (S3), the "What to record", "End of a session" and "When a proposal is refused" sections are replaced by
one paragraph: *"This workspace is read-only for agents. Use the read tools only; when you would have recorded
something, tell the user instead."*

**`{{toolList}}` format.** One line per item, grouped and sorted, each with a short purpose. The purposes come from a
fixed table, not from tool descriptions (so they stay short):

```text
Session:   get_session_context — bootstrap a task · sync_session (write) — report a session's outcome
Project:   get_project · list_projects · create_project (write) · get_implementation_plan · update_progress (write)
Knowledge: get_decisions · record_decision (write) · get_open_questions · log_finding (write) · update_knowledge (write) · annotate (write)
History:   get_recent_changes · get_session_history · get_session_review · revert_agent_changes (write)
Impact:    get_lens_impact — what a change to keys or paths affects, and the warnings that protect it
Workspace: search_workspace · get_canvas · get_page · get_selected_content · get_related_objects
Canvas:    create_block · create_page · create_table · create_todo · create_connection · move_object · update_block · render_visual_plan · delete_object  (all write)
Repo map:  begin_repo_map · upsert_map_section · link_map_nodes · get_map_status · remove_map_nodes · tidy_map_section
Resources: acute://context/current · acute://project/{projectKey} (+ /decisions, /implementation-plan, /progress, /open-questions, /changes) · acute://workspace/{id} · acute://canvas/{id} · acute://page/{id}
Prompts:   initialize_project · update_architecture · sync_progress · document_decision · map_repo · setup_project_instructions
```

The list is whatever is registered when the artifact is generated. The lines above show the expected registry once
7B ships (§A5). Phase 7C's tools appear once they're registered, and Phase 3's (`get_lens`, `trace_lens_path`,
`focus_lens`, `link_lens_detail`) once Phase 3 ships, with no change to the core text.

### A3. The three client wrappers

| | **Claude** (Claude Code) | **Codex** | **Cursor** |
|---|---|---|---|
| `targetPath` | `CLAUDE.md` | `AGENTS.md` | `.cursor/rules/acute-notes.mdc` |
| `format` | Markdown | Markdown | MDC: Markdown with a frontmatter header (`description`, `alwaysApply: true`) |
| Fence | the S4 markers, inside the user's file | the S4 markers, inside the user's file | the whole file is Acute's (a dedicated rules file); the markers are kept anyway |
| Tool-call note | "The tools appear prefixed with the server name (e.g. `mcp__acute-notes__get_session_context`); this file uses bare names." | "The tools come from the `acute-notes` MCP server; this file uses their bare names." | "The tools come from the `acute-notes` MCP server; this file uses their bare names." |
| Preamble | "Applies to every task in this repository." | same | the frontmatter `description`: "Acute Notes project memory: when and how to read and record it" |

Connecting the client to the server stays where it is today: the MCP access dialog's command and token. It isn't
part of this artifact (D52: the existing pairing token, no new step).

**Verified 2026-10-03 against each client's documentation (Q1), before generating the artifacts:**
- *Claude Code* ([memory](https://code.claude.com/docs/en/memory), [MCP](https://code.claude.com/docs/en/mcp)):
  project instructions are `./CLAUDE.md` (or `./.claude/CLAUDE.md`), loaded every session, with a target of under
  200 lines. MCP tools are callable as `mcp__<server-name>__<tool-name>`. With both `CLAUDE.md` and `AGENTS.md` in a
  repo, Claude Code reads only `CLAUDE.md` by default, which is why each artifact is self-contained (Q2).
- *Codex* ([AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)): reads `AGENTS.md` (and an
  `AGENTS.override.md`, which wins) in each directory from the Git root down, concatenated; combined size capped by
  `project_doc_max_bytes`, 32 KiB by default. The S5 budget (7,000 characters) fits well inside it. Its docs don't
  name a tool-prefix convention, so the wrapper uses bare names.
- *Cursor* ([rules](https://cursor.com/docs/rules)): project rules are `.cursor/rules/*.mdc` (a plain `.md` file
  there is ignored), with YAML frontmatter `description`, `globs` and `alwaysApply`. Cursor also reads a root
  `AGENTS.md`, but the artifact stays a dedicated rule (Q2). The rules page doesn't describe MCP tool naming, so
  bare names again.

### A4. MC11, made testable

A scripted MCP client (over `InMemoryTransport`, as the repo-map tests do) reads `acute://setup/instructions/{client}`
for each of the three clients, with writes on and with writes off, and asserts:

| MC11 | Assertion |
|---|---|
| (a) identifies Acute / when to use it | the headings `### What it is` and `### When to use it` are present and non-empty |
| (b) only existing names | every tool, resource and prompt name in `content` (matched as backticked identifiers and `acute://` URIs) is in the server's registry at that moment, and the generator throws on an unresolved placeholder (a unit test feeds it a bad one) |
| (c) initialisation, context use, when to sync | `### Start of a session` names `get_session_context`; `### End of a session` names `sync_session` (writes-on variant) |
| (d) what to persist | `### What to record` names `record_decision`, `log_finding`, `update_progress`, `update_knowledge`, and the repo-map tool for architecture |
| (e) conflicts with code or canonical state | `### When Acute and the code disagree` is present and contains "source of truth" |
| (f) no fabrication | `### Never fabricate project state` is present |
| extra | `content` ≤ 7,000 characters (S5); starts and ends with the S4 markers; the writes-off variant names no write tool; `setup_project_instructions` returns a message naming `targetPath` and the fence rule |

Plus one **manual real-agent run** per D58, only when you ask: Claude Code or Codex writes the file via the prompt,
then performs a small task following it (MC1/MC10's manual step).

### A5. The canonical names this text relies on (D55, D62)

Every `{{tool:…}}` in §A2 must be registered by the end of 7B: `get_session_context`, `record_decision`,
`log_finding`, `update_progress`, `update_knowledge`, `annotate`, `sync_session`, `create_page`,
`upsert_map_section`. The prompt it uses is `initialize_project`. All are §7.3 names, or existing tools. If any
is renamed, the generator test fails rather than shipping a stale name.

---

## Part B — Workspace templates (not part of MC11)

### B1. What a template is

A template is what `create_project(name, style, …)` proposes as one reviewed change set: ordinary canvas objects
(D49), the same kinds as everything else, and no special store. Every template creates:

1. a **`project` node** (`style` = the template, `focus` only if the user gave one);
2. a **Project state frame** (Lens profile `project`), where decisions, findings, progress and annotations go (§3.6
   lanes);
3. one **interactive L1 architecture frame**, named for the style, **empty**. It is filled from the code by the
   `initialize_project` prompt (which runs `map_repo`) or by the user. A template never draws components it hasn't
   seen in code (S6).
4. *(optional, only if the user ticks "Add a starter plan")* one milestone, **"Get started with Acute"**, with three
   onboarding progress items (Q3): "Understand the project", "Record current state", "Set the next step". These are
   tasks to do, all `not_started`, never marked done by the template; they onboard the workflow once and are not a
   per-session checklist.

Templates differ in **what the levels mean** and **how the repo map is cut into sections**. That is what the agent
needs from them, and what the one style line in Part A carries.

### B2. The three templates

| | **Modular** (`modular`) | **Feature-based** (`feature`) | **Service** (`service`) |
|---|---|---|---|
| For | a single codebase organised by technical layers or packages (a monolith, a library, a modular app) | a single codebase organised by product features or vertical slices | several deployable services, or a system whose boundaries are network calls |
| L1 frame name | "Modules" | "Features" | "Services" |
| L1 holds | top-level modules/packages and the externals they talk to | features (user-facing capabilities) and shared kernels | services, data stores, queues, external systems |
| L2 | a module's components (classes, sub-packages) | a feature's slices (UI, API, domain, data for that feature) | a service's internal components |
| L3 | flows through a module's components | a feature's user flow end to end | a request or event flow across services (`calls`, `publishes`, `subscribes`) |
| L4 / L5 | operations / source, as in every profile | same | same |
| Repo-map sections | one section per module | one section per feature, plus one for shared code | one section per service, plus an overview of service-to-service relations |
| Typical relations | `depends_on`, `calls` | `depends_on`, `calls`, `reads`/`writes` | `calls`, `publishes`, `subscribes`, `reads`/`writes` |
| Style line in the Part A artifact | "This project's architecture is organised by module: L1 = modules, L2 = their components." | "…by feature: L1 = features, L2 = each feature's slices." | "…by service: L1 = services, L2 = each service's internals; L3 = cross-service flows." |

`custom` (the fourth `style` value in D33) creates items 1–3 with a neutral L1 name, "Architecture", and adds no style
line.

### B3. Template tests (7B, separate from MC11)

- Unit: for each style, `create_project`'s change set contains exactly one `project` node with that `style`, one
  project-profile frame, one empty interactive frame named as in §B2, and no decision, finding or architecture node.
  With the starter plan it adds one milestone ("Get started with Acute") and the three Q3 items, `not_started`, their
  refs naming the milestone.
- Scripted MCP client: `create_project(style: "service")` → Accept → `get_project` returns the style. The
  `setup/instructions` artifact then carries the service style line, and nothing else changes in it.

---

## Part C — The persistence boundary

Acute holds **durable project knowledge**: things a later session, another agent or the user needs, that aren't
obvious from reading the code. It is not a log of what an agent did.

| Record in Acute | Through | Not in Acute |
|---|---|---|
| Decisions between real alternatives that later work must respect, with options and a one-line reason | `record_decision` | the reasoning that led there, or decisions with no real alternative |
| Constraints: rules that must always hold, only when the user states them | `record_decision` (`constraint`) | rules the agent infers on its own (record a finding or a proposed decision instead) |
| Findings: non-obvious discoveries, hypotheses, assumptions, concerns, including "Acute disagrees with the code" | `log_finding` | observations anyone gets from reading the file |
| Risks; open questions that need a human | `log_finding` (`risk`, `open_question`) | questions the agent can answer itself by reading the code |
| Milestones and progress at task granularity; the next step | `update_progress`, `sync_session.next` | per-command or per-test progress; percentages |
| Architecture structure: components, boundaries, relationships, levels, source locations | repo-map tools, `upsert_map_section` | every class or function; restating code line by line |
| Session outcome: a short summary, the changed paths with a few words each | `sync_session` (`summary`, `changed`) | diffs, full file lists of a refactor, command or test output, logs |
| Longer explanations | a page (`create_page`), referenced from the node | long prose inside nodes |
| — | — | secrets, credentials, personal data; chain of thought; speculation stated as fact |

Mechanical bounds that already enforce part of this: node fields are short (reason ≤ 500 characters, options ≤ 6,
refs ≤ 20; Phase 0.1 / D33 validation). `sync_session`'s `changed` is bounded in 7B: proposed ≤ 50 entries, each a
path and ≤ 120 characters. Tool arguments in the change log are redacted and capped (D46). The rest is behavioural:
the core text states it (S7), and each write tool's description repeats its own line from this table.

---

## Implementation outline (after approval; part of 7B)

- `mcp/setup/instructions.ts` (pure): `buildSetupInstructions(client, { tools, resources, prompts, writesAllowed,
  style? })`. It holds the core text with placeholders, the three wrappers, the purpose table for `{{toolList}}`
  and the style lines, and throws on an unresolved placeholder or when the result exceeds S5's budget.
- `mcp/setup/templates.ts` (pure): `projectTemplate(style, { name, focus?, starterPlan? })` → `ProposedChange[]`,
  used by `create_project`.
- Server: the resource and the prompt registered beside the other 7B tools; the generator reads the server's own
  registry, so the list can't diverge from what is served.
- App: the "Agent instructions" row in the MCP access dialog (Copy / Download).
- Tests: §A4 (MC11) and §B3, plus a generator unit test per placeholder kind.

## Resolved questions (2026-10-03, user review)

- **Q1 — client file conventions: implementation-time verification required.** The architecture and the setup
  contract are approved; only the exact client syntax in §A3 (target paths, the `.mdc` frontmatter, how each client
  names MCP tools) is checked against the clients' authoritative documentation before the final artifacts are
  generated. A difference changes only that client's wrapper, never the core text.
- **Q2 — no cross-client coupling.** `CLAUDE.md` does not import `AGENTS.md`. Each client artifact is self-contained:
  Claude → `CLAUDE.md`, Codex → `AGENTS.md`, Cursor → its `.mdc` rule. The user picks a client when asking for setup
  instructions; duplicated text across clients is accepted.
- **Q3 — the starter plan keeps three small onboarding tasks** (§B1.4), replacing the three drafted there:
  1. **Understand the project**: establish the project and architecture context.
  2. **Record current state**: capture the durable decisions, findings, constraints and progress already known.
  3. **Set the next step**: establish the immediate milestone and progress state and a useful session `next`.
  They are onboarding tasks for initialisation, not something every session repeats. After initialisation the normal
  loop is: read context → work → record durable knowledge → sync session → leave `next`. They are never a source of
  fabricated state: what the agent doesn't know from the code or from Acute stays unknown.
