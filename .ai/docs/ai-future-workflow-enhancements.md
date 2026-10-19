# Acute-Notes — ICP Workflow Validation & Future AI Enhancements

**Status:** Exploratory, for roadmap planning. This file does not change the scope or order of Phase 5 / 5b / 5c in the PRD (`acute-notes-prd-claude-code-ai.md`) or the tracker (`ai-phase-implementation-plan.md`). It is the one place for:

1. **ICP workflow validation.** Every workflow our target users would try, how a user would do it in Acute today, whether it works, and what has to change if it doesn't (Parts 2–4).
2. **Future AI workflow ideas.** The learning- and understanding-oriented flows noted earlier (Part 5).
3. **A capability roadmap.** New capabilities in priority order, each tied to the workflows it unlocks (Part 6).

**How the "feasible today" ratings were made:** from reading the code and the tracker as of **2026-09-27**, not from running each workflow by hand. **Re-checked the same day** after F20–F23, F33 and F43 landed. The code workflows (developer and EM rows) now have a partial path: an IDE agent reads the repo and writes to the canvas over MCP, in a local install only. They show what the product *can* support. The test runs still need to confirm it, using the scoring in §2.3.

---

## Contents

- [Part 1 — What Acute can do today](#part-1--what-acute-can-do-today-capability-baseline)
- [Part 2 — How to read and score the tables](#part-2--how-to-read-and-score-the-tables)
- [Part 3 — The headline tests](#part-3--the-headline-tests)
- [Part 4 — Workflows by ICP](#part-4--workflows-by-icp)
- [Part 5 — Future learning & understanding flows (earlier notes)](#part-5--future-learning--understanding-flows-earlier-notes)
- [Part 6 — Capability roadmap (by priority)](#part-6--capability-roadmap-by-priority)
- [Part 7 — Bottom line](#part-7--bottom-line)

---

## Part 1 — What Acute can do today (capability baseline)

Every "How a user does it today" cell below uses only these features.

| Area | What exists today | Hard limits that matter for the workflows |
|---|---|---|
| **Canvas** | Shapes, arrows, lines, freehand, text, images; multiple canvases and pages per workspace; page-preview objects; find-on-canvas; undo/redo | Local-only (IndexedDB), single user, no sharing or collaboration |
| **Rich blocks** | Text (Markdown-style), Todo/checklist, Table, Code | Tables hold no formulas and do no computation |
| **Typed relationships** | Arrows can carry a relation: `relates_to`, `caused_by`, `depends_on`, `supports`, `blocks`, `implements`, `derived_from`, `references`, `explained_by` | Typed arrows exist (F23): the user draws them, and Visualize, reconciliation and MCP `create_connection` create them. **In-app AI can't propose links between objects already on the canvas** (CAP-08; the `organize` / `extract_relationships` task ids exist but aren't built) |
| **Getting content in** | Paste text into ✨ Visualize, or type or paste into blocks; import `.acute.json` workspaces | **No file import** (PDF, DOCX, CSV, audio, URL); **no GitHub repo or local-folder import**; images are stored, but **the AI cannot see them** |
| **✨ Visualize** | Paste up to **200,000 chars**, then pick one of 9 templates: Flow, Problem → Cause → Solution, Concept Map, Timeline, Decision Tree, Architecture, Comparison, Action Plan, Sections. Long documents are outlined into grouped sections (hierarchy, comparison, flow, cards, decision, metrics, supporting, notes). Output is native, editable canvas objects | One pasted source per run. No journey map, issue/hypothesis tree, 2×2, affinity board, roadmap/swimlane, persona, ERD, sequence diagram or dependency graph template |
| **Update from new content** | Re-paste a new version of a source. Only what changed is updated, the user's own edits are preserved, conflicts are shown for review, and child explanations are created for conceptual changes (F37–F39, F38b) | Works per source and needs a manual re-paste (no auto-sync) |
| **AI selection actions** | Explain, Summarize, Visualize, Update from new content, Turn into tasks, Create test cases, Create plan, Find related items | Results come back as a note, a todo or a visual plan. "Find related" is keyword-based and local, not semantic, and it lists matches without drawing links |
| **Ask AI / chat** | Free-form questions and follow-ups at **selection / canvas / workspace** scope. Conversations are saved per canvas and anchored to the selection (F40) | **AI context is capped at 16,000 chars total (4,000 per object)** (`contextBuilder.ts` `ASK_BUDGET`). F22's context builder fills that budget by priority: selection → nearby → related → keyword search hits for the question → rest of scope. Keyword/IDF only, no embeddings (CAP-01). After each reply the panel says what the AI saw: all of the scope, or which objects were shortened or left out |
| **Review & safety** | Every AI change is a reviewable change set (Accept/Reject) with provenance (F19, F25) | — |
| **Mermaid** | Flowcharts, state, class and ER diagrams: live preview in code blocks, and ✨ Visualize converts them to native shapes, member cards, table cards and typed arrows with no AI call (F33) | Other diagram kinds (sequence, gantt, …) stay code blocks with a preview |
| **MCP (for Claude Code, Copilot, other agents)** | Local Streamable HTTP bridge through the open tab, with a token and a per-workspace switch (F20). Read resources plus read tools (`search_workspace`, `get_canvas`, …). Write tools (`create_block`, `render_visual_plan`, `update_block`, `create_connection`, `move_object`, …) are **proposals the user reviews** (F21). **Repo Map** (F43): the agent maps a repo onto a canvas one module at a time, with staleness and user corrections | **Local install only:** the bridge accepts loopback requests and needs an open tab (no hosted MCP until workspaces live server-side). No delete tool. The by-hand VS Code / Claude Code check of F43 is still open. Only the `map_repo` MCP prompt exists |
| **Getting content out** | Markdown, image and `.acute.json` workspace export; **canvas export** as JSON (with include options) or Markdown (F17) | No DOCX, PDF or slides export; no document templates (PRD, ADR, brief…) |
| **AI connections** | GitHub Copilot and Gemini validated; OpenAI, Azure, Anthropic and Ollama are wired but not yet validated | — |

**In one line:** Acute is strong today at *one pasted text source → structured, editable visual model → review, refine and update it without losing edits*. It is weak at *many sources, large context, code repositories, images, and producing finished documents*.

---

## Part 2 — How to read and score the tables

### 2.1 Feasibility legend

| Mark | Meaning |
|---|---|
| ✅ **Yes** | A user can complete the workflow today with the features in Part 1 |
| 🟡 **Partial** | Works only with manual workarounds (hand-pasting, splitting input, drawing links by hand) or at small scale (within the 16k AI context or 200k Visualize limit) |
| ❌ **No** | The core input or step isn't supported, so the workflow can't be completed as described |

### 2.2 Capability codes used in "Changes needed"

Each table refers to the new capabilities in Part 6 by code, e.g. `CAP-03`:

| Code | Capability (short) | Priority |
|---|---|---|
| CAP-01 | Large-context reasoning & semantic retrieval over the workspace | P0 |
| CAP-02 | Multi-file / multi-source ingestion (PDF, DOCX, MD, TXT, HTML) | P0 |
| CAP-03 | Codebase ingestion & code intelligence (GitHub / local repo) | P0 |
| CAP-04 | Cross-source synthesis with citations (themes, contradictions, evidence) | P0 |
| CAP-05 | Workspace memory & "continue where I left off" | P0 |
| CAP-06 | MCP server transport + tools (agents read/write the canvas) | P0 |
| CAP-07 | Expanded Visualize template library | P1 |
| CAP-08 | AI-proposed relationships & "organize existing objects" | P1 |
| CAP-09 | Artifact generation (PRD, ADR, brief, report, SOP) + DOCX/PDF/slides export | P1 |
| CAP-10 | Structured analysis actions (scoring, prioritization, RCA) + custom actions | P1 |
| CAP-11 | Meeting ingestion → typed decisions / actions / questions | P1 |
| CAP-12 | Mermaid & diagram-as-code in the UI | P1 |
| CAP-13 | Structured data & log ingestion (CSV, analytics, logs) + table calculations | P1 |
| CAP-14 | External connectors (GitHub issues/PRs, Jira/Linear, Slack, Drive/OneDrive, Notion, Figma) | P2 |
| CAP-15 | Image & screenshot understanding (vision) | P2 |
| CAP-16 | Sharing & collaboration (cloud sync, roles, handover links) | P2 |
| CAP-17 | Proactive resurfacing of related past work | P2 |
| CAP-18 | Web / URL research & capture | P2 |
| CAP-19 | Understanding layer (flashcards, quizzes, mastery, learning paths) | P3 |
| CAP-20 | Scheduled / background agents & living documents | P3 |

### 2.3 Score every test on five dimensions

Don't record just works / doesn't work. For each test run, score 0–2 on each dimension:

| # | Dimension | The question |
|---|---|---|
| 1 | **Ingest** | Can Acute take in the information in the form the user actually has it? |
| 2 | **Structure** | Can Acute structure or visualize it in a way the user would keep? |
| 3 | **Reason** | Can the AI reason over the *complete* context, not a truncated slice? |
| 4 | **Correct** | Can the user modify or correct the AI's understanding, and does the AI respect those corrections? |
| 5 | **Time saved** | Is the result meaningfully faster or better than ChatGPT + Notion/Obsidian + the user's current tools? **(Most important)** |

The goal isn't to prove "Acute has these features". It is to prove: *"For this specific kind of complex knowledge work, Acute lets the user accomplish something substantially more effectively than their current workflow."*

---

## Part 3 — The headline tests

### 3.1 The ultimate Acute test

> Can a user bring a complex problem into Acute, build up a visual, contextual representation of it step by step, use AI to reason over that context, and leave with something actionable, without rebuilding the context for the AI every time?

The loop broken into steps, with how each step holds up today:

| Step | Today | Why | Changes needed |
|---|---|---|---|
| **Collect** | 🟡 | Paste only; one source per Visualize run; no files, repos, URLs or images | CAP-02, CAP-03, CAP-18, CAP-15 |
| **Connect** | 🟡 | Typed arrows exist, but the user draws them; Find related is keyword-only and draws nothing | CAP-08, CAP-01 |
| **Visualize** | ✅ | ✨ Visualize, 9 templates, grouped long-document layouts, native editable objects | CAP-07 for more shapes of thinking |
| **Reason** | 🟡 | Ask AI works, but only on 16k chars of context | CAP-01 |
| **Modify** | ✅ | Change-set review, Update from new content keeps user edits, conflict review | — |
| **Remember** | 🟡 | Conversations are saved per canvas, but nothing builds a lasting workspace memory | CAP-05 |
| **Produce** | 🟡 | Notes, todos and plans only; no document templates or DOCX/PDF/slides export | CAP-09 |
| **Continue** | 🟡 | Follow-ups work in a conversation; returning later means re-selecting context, and it is still capped | CAP-05, CAP-01 |

**Verdict:** Acute passes the *visualize* and *modify* steps convincingly. Those are its differentiators, and competitors don't handle "update without overwriting my edits" well. The *collect → reason → remember* steps are where the claimed "context without rebuilding" advantage falls apart today. CAP-01, CAP-02 and CAP-05 close that gap.

### 3.2 The 20 killer workflows — current verdict

Run these first. Detail is in the ICP tables in Part 4.

| # | Killer workflow | ICP | Ref | Today | Main blocker |
|---|---|---|---|---|---|
| 1 | Understand an unfamiliar codebase | Developer | DEV-01 | 🟡 | Only through an IDE agent + Repo Map (F43, local install, by-hand client check open); no code intelligence in Acute itself (CAP-03) |
| 2 | Trace a feature through code | Developer | DEV-02 | 🟡 | The IDE agent traces and draws it (`render_visual_plan`); Acute has no symbol search or call graph (CAP-03) |
| 3 | Debug using codebase context | Developer | DEV-03 | 🟡 | Only hand-pasted snippets within 16k (CAP-03, CAP-01) |
| 4 | Plan feature implementation | Developer | DEV-06 | 🟡 | In-app plans aren't grounded in real code (CAP-03); an IDE agent can now read the plan and write it back over MCP (CAP-06 built) |
| 5 | Messy research → knowledge map | Researcher | RES-09 | ✅ | — (strongest workflow today) |
| 6 | Compare 20 documents | Researcher | RES-02 | 🟡 | Paste cap, no file import, no citations (CAP-02, CAP-04) |
| 7 | Find contradictions across sources | Researcher | RES-06 | ❌ | No cross-source task, 16k context (CAP-04, CAP-01) |
| 8 | Evidence → argument | Researcher / Consultant | RES-15 | 🟡 | Links drawn by hand, no claim→source trace (CAP-04, CAP-08) |
| 9 | Interviews → product insights | PM | PM-01 | 🟡 | One paste, no clustering or citations (CAP-02, CAP-04) |
| 10 | Research → PRD | PM | PM-02 | 🟡 | No PRD artifact generator (CAP-09) |
| 11 | Map a customer problem | PM / Founder | PM-03 | ✅ | — |
| 12 | Prioritize product opportunities | PM / Founder | PM-05 | 🟡 | No scoring action that writes to a table (CAP-10) |
| 13 | Startup thoughts → strategy | Founder | X-01 / FND-05 | ✅ / 🟡 | Organizing works; strategy reasoning is capped (CAP-01) |
| 14 | Competitor research → strategy | Founder | FND-04 | 🟡 | Research is gathered by hand (CAP-18, CAP-07) |
| 15 | Plan a complex project | Founder / PM | KW-06 | ✅ | — |
| 16 | Root-cause analysis | Consultant | CON-03 | 🟡 | No true issue tree; evidence not linked (CAP-07, CAP-04) |
| 17 | Decision analysis from multiple sources | Consultant | X-07 | 🟡 | Multi-source input and traceability (CAP-02, CAP-04) |
| 18 | Meeting → decisions → actions → context | Knowledge worker | PM-14 | 🟡 | Decisions and questions aren't typed or resurfaced (CAP-11, CAP-17) |
| 19 | Existing knowledge → new artifact | All | X-06 | 🟡 | 16k context, no artifact templates (CAP-01, CAP-09) |
| 20 | Return to an old workspace and keep reasoning | All | X-10 | 🟡 | No workspace memory (CAP-05) |

**Score: 4 ✅ · 15 🟡 · 1 ❌** (#13 counted as ✅). The four ✅ are all *single-source structuring* workflows. All four developer killer workflows are 🟡. #1 and #2 moved up from ❌ because of the IDE-agent path over MCP (F20/F21/F43), which works in a local install only and still needs its by-hand client check. The developer ICP is the one we most want to claim, and it is still the least supported: Acute itself has no code intelligence.

---

## Part 4 — Workflows by ICP

Each table has the same columns:

- **How a user does it today** — the concrete steps in Acute right now.
- **Today** — ✅ / 🟡 / ❌ (legend in §2.1).
- **Changes needed** — what would make it fully work. Capability codes are in §2.2.

### 4.1 Software engineers / developers

> **Critical test:** *"I joined a project I've never seen before. Here's the GitHub repo. Can Acute help me understand how the system works in 30 minutes?"* **Today: 🟡** (was ❌). In a local install, the user's IDE agent can map the repo onto a canvas with Repo Map (F43): one module at a time, updated in place, with the user's corrections kept. Acute has no code intelligence of its own, and Ask AI over the finished map still sees at most 16k chars. Not yet run by hand with real clients.

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| DEV-01 | Understand an unfamiliar codebase | GitHub repo → visual architecture explanation | Paste the README and a few key files into ✨ Visualize → **Architecture** template; select nodes → **Explain**. **Local install:** an IDE agent (Claude Code, Copilot) reads the repo and writes to the canvas over MCP: run the `map_repo` prompt → Repo Map | 🟡 | CAP-03 repo import with file tree, symbol and import graph; code-aware Architecture template; CAP-01 so Ask AI can retrieve across the repo |
| DEV-02 | Trace a feature through code | Feature/request → relevant files, classes, functions | Paste suspected files into Code blocks, draw `depends_on` arrows, Ask AI "trace X" at canvas scope. **Local install:** an IDE agent (Claude Code, Copilot) reads the repo and writes to the canvas over MCP: the agent traces the feature and sends a Flow with `render_visual_plan` | 🟡 | CAP-03 symbol search and call graph; a "trace feature" AI task that returns a Flow plan linking real files; CAP-01 |
| DEV-03 | Debug a complex issue | Error + codebase → cause → affected components → fix | Paste the error and relevant code into blocks; select them → **Explain**; paste the error into Visualize → **Problem → Cause → Solution** | 🟡 | Works for small slices the user picks. Needs CAP-03 to find the relevant code, CAP-01 for size, CAP-13 to paste stack traces or logs as structured data |
| DEV-04 | Understand an API flow | Backend code → request → controller → service → DB flow | Paste controller/service/repository code into Visualize → **Flow** | 🟡 | Only if the user already knows which files matter. CAP-03 to follow calls automatically; a **sequence diagram** template (CAP-07) |
| DEV-05 | Understand frontend architecture | React/Next.js repo → component, data and state relationships | Same as DEV-01, using Architecture / Concept Map (Repo Map through an IDE agent) | 🟡 | CAP-03 with component-tree and state/data-flow extraction; component-graph template (CAP-07) |
| DEV-06 | Plan a new feature | Product requirement → implementation plan | Write or paste the requirement into a Text block → **Create plan** / **Turn into tasks**; or Visualize → **Action Plan** | 🟡 | Plan quality is fine, but it isn't grounded in the real code. CAP-03 for grounding. (CAP-06 is built: Claude Code / Copilot can now read the plan over MCP and propose progress back, in a local install) |
| DEV-07 | Impact analysis | Proposed change → what could be affected | Paste the diff and code you know depends on it; Ask AI. **Local install:** an IDE agent (Claude Code, Copilot) reads the repo and writes to the canvas over MCP: the agent finds dependents and draws them | 🟡 | CAP-03 reverse-dependency graph; "impact" task that highlights affected nodes; dependency-graph template (CAP-07) |
| DEV-08 | Refactoring analysis | Existing module → dependencies and refactoring boundaries | Paste the module into Visualize → **Architecture** / **Sections**, or map it with Repo Map through an IDE agent | 🟡 | CAP-03 module coupling metrics; CAP-07 dependency graph; CAP-08 so the AI can draw boundaries between existing nodes |
| DEV-09 | Compare implementation approaches | Requirement + codebase → option A vs B and consequences | Write each option in a block → Visualize → **Comparison** or **Decision Tree** | 🟡 | The generic comparison works. Consequences *in this codebase* need CAP-03 |
| DEV-10 | Generate documentation from code | Codebase → architecture/technical docs | Paste code → **Explain** → move the note to a Page → export Markdown | 🟡 | Only small modules. CAP-03 for the full repo; CAP-09 technical-doc template; CAP-20 to keep docs up to date |
| DEV-11 | Onboard to a project | Repo + docs → mental model of the project | Paste docs into Visualize → **Concept Map**; explore with child explanations; map the code with Repo Map through an IDE agent | 🟡 | CAP-03 + CAP-02 (import the docs folder); an "onboarding map" composite template (CAP-07); CAP-01 |
| DEV-12 | Investigate a production bug | Logs + code + architecture → evidence linked to root causes | Paste log excerpts and code; Visualize → **Problem → Cause → Solution**; draw `caused_by` arrows by hand | 🟡 | CAP-13 log ingestion; CAP-03; CAP-04 so each hypothesis links to the log lines and code that support it |
| DEV-13 | Understand legacy code | Large old module → concepts and workflows | Paste the module (≤200k chars) into Visualize → **Sections** / **Concept Map** | 🟡 | The long-document outliner is built for prose, not code. CAP-03 code-aware parsing (by class/function) |
| DEV-14 | Code-review reasoning | PR/diff → the change in the context of the wider architecture | Paste the diff → **Explain** / Ask AI | 🟡 | No view of the surrounding architecture. CAP-14 GitHub PR import; CAP-03 to place the diff on the architecture map |
| DEV-15 | Architecture → visual map | Repo → interactive system diagram | Describe the system in text → Visualize → **Architecture**; drill in with child explanations | 🟡 | Works from a description, not from the repo. CAP-03; CAP-12 to import existing Mermaid diagrams from the repo |
| DEV-16 | Design database changes | Schema + requirement → entity relationships + migration impact | Paste the SQL schema → Visualize → **Concept Map** / **Architecture** | 🟡 | No ERD template (CAP-07). Migration impact needs CAP-03 (find the queries that touch each table) |
| DEV-17 | Plan API changes | Existing API + requirement → endpoints, data flow, dependencies | Paste the OpenAPI spec or route list → **Flow** / **Comparison** | 🟡 | CAP-02 OpenAPI/JSON import; CAP-03 for consumers of each endpoint |
| DEV-18 | Explore unfamiliar technology | Docs + code → conceptual map | Paste docs → Visualize → **Concept Map**; **Explain** nodes; child explanations | ✅ | Works within the 200k paste limit. CAP-18 (import from a docs URL) would remove the copy-paste |
| DEV-19 | Developer decision record | Several alternatives → captured reasoning and decision | Options in blocks → **Comparison** / **Decision Tree**; write the ADR page by hand | 🟡 | CAP-09 ADR generator (canvas → ADR page); `derived_from` links to the options it came from |
| DEV-20 | Ask questions against project context | Codebase → natural-language answers | Ask AI at workspace scope | 🟡 | Only what's already on the canvas, within 16k. CAP-01 retrieval; CAP-03. (CAP-06 is built: an IDE agent can already use the canvas as context over MCP, in a local install) |

### 4.2 Product managers

> **Key test:** *"Here are 20 customer interviews, existing product docs and analytics. Help me figure out what problem we should solve."* **Today: 🟡 / ❌ at that scale.** Twenty interviews won't fit in one paste, analytics can't be ingested, and there are no citations back to specific interviews.

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| PM-01 | Customer interviews → insights | Transcripts → themes + pain points | Paste the transcripts, joined together (≤200k chars), into Visualize → **Sections** / **Concept Map**; **Summarize** | 🟡 | CAP-02 multi-file import (one source per interview); CAP-04 theme extraction with counts and quote citations; affinity-board template (CAP-07) |
| PM-02 | Build product requirements | Raw problem statement → structured PRD | Problem in a Text block → Ask AI "write a PRD" → note → move to a Page by hand | 🟡 | CAP-09 PRD template that writes a Page with sections and links back to the evidence on the canvas |
| PM-03 | Map a product problem | Research + observations → problem-space visualization | Paste research → Visualize → **Problem → Cause → Solution** or **Concept Map** | ✅ | — (CAP-02 for larger research sets) |
| PM-04 | Feature discovery | Customer feedback → clustered requests | Paste the feedback → Visualize → **Sections** (cards) | 🟡 | No de-duplication or frequency counts. CAP-13 CSV import (feedback exports); CAP-04 clustering with counts; CAP-07 affinity board |
| PM-05 | Prioritize features | Feature list + evidence → structured prioritization | Put features in a Table block; Ask AI to score them; copy the scores back by hand | 🟡 | CAP-10 "Score with RICE/ICE/MoSCoW" action that writes columns into the table; 2×2 impact/effort template (CAP-07) |
| PM-06 | Compare product options | Several proposals → decision matrix | Paste the proposals → Visualize → **Comparison** | ✅ | — |
| PM-07 | Create a user journey | Research → journey map | Visualize → **Timeline** or **Flow** as an approximation | 🟡 | CAP-07 journey-map template (stages × actions / thoughts / pain points / opportunities) |
| PM-08 | Research → roadmap | Research + strategy → roadmap | Visualize → **Timeline** / **Action Plan** | 🟡 | CAP-07 roadmap / swimlane template (now/next/later, by theme); CAP-01 to reason over all the research |
| PM-09 | Analyze a competitor | Competitor info → feature/positioning map | Paste competitor notes → **Comparison** | 🟡 | Info is gathered by hand. CAP-18 URL capture; CAP-07 positioning 2×2 and feature-matrix templates |
| PM-10 | Plan a product launch | Launch requirements → launch plan | **Create plan** / **Turn into tasks**; Visualize → **Action Plan** / **Timeline** | ✅ | — |
| PM-11 | Connect metrics to product problems | Analytics + research → hypothesis tree | Paste analytics as text → **Decision Tree** / **Problem → Cause → Solution** | 🟡 | CAP-13 CSV/analytics import; CAP-07 hypothesis-tree template |
| PM-12 | Root-cause analysis | Metric decline → cause/evidence map | **Problem → Cause → Solution**; draw `caused_by` / `supports` by hand | 🟡 | CAP-04 evidence links; CAP-13 data ingestion; CAP-10 guided "5 whys" action |
| PM-13 | Prepare a stakeholder meeting | Project context → brief + discussion points | Select the project area → **Summarize** (workspace scope) or chat "prepare a brief" | 🟡 | Capped at 16k. CAP-01; CAP-09 meeting-brief template |
| PM-14 | Capture meeting decisions | Meeting notes → decisions, actions, dependencies | Paste notes → **Turn into tasks** + **Summarize**; Visualize → **Sections** | 🟡 | Decisions, assumptions and open questions aren't separate typed objects. CAP-11; CAP-17 to resurface them later |
| PM-15 | Explore product strategy | Market + company context → strategy map | Visualize → **Concept Map** / **Sections** | 🟡 | CAP-01 (the context is bigger than 16k); CAP-07 strategy templates (e.g. strategy tree, bets board) |
| PM-16 | PRD → execution | PRD → engineering / design / marketing tasks | Select the PRD page → **Turn into tasks** / **Create plan** | ✅ | Works (the AI can group tasks by team). Nice to have: one todo block per team, and CAP-14 export to Jira/Linear |
| PM-17 | Maintain product knowledge | Multiple documents → connected knowledge space | Separate canvases/pages per area; **Find related** (keyword) | 🟡 | CAP-02; CAP-01 semantic search; CAP-08 AI-proposed links between documents |

### 4.3 Researchers / analysts

> **Killer test:** give Acute 30 documents on a topic the user doesn't know, and ask *"Help me understand this field, the major concepts, where researchers disagree, and what questions remain unanswered."* **Today: ❌.** Thirty documents don't fit in one paste, there's no PDF import, and no disagreement/open-question task.

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| RES-01 | Literature review | Papers → topic map | Copy paper text or abstracts → Visualize → **Concept Map** | 🟡 | No PDF import; 200k chars ≈ 3–5 papers. CAP-02; CAP-01; CAP-04 with citations per node |
| RES-02 | Compare research papers | Several papers → comparison matrix | Paste the papers → **Comparison** | 🟡 | CAP-02; CAP-04 so each cell cites its paper and page |
| RES-03 | Extract themes | 10–50 docs → theme clusters | Paste as much as fits → **Sections** | ❌ | At 10–50 documents, doesn't fit. CAP-02; CAP-04 theme clustering; CAP-01 |
| RES-04 | Build a research map | Sources → connected concepts | **Concept Map** per source; connect maps by hand with arrows | 🟡 | CAP-08 so the AI can link concepts across sources; CAP-02 |
| RES-05 | Trace evidence | Claim + sources → evidence chain | Draw `supports` / `derived_from` arrows by hand; **Explain** | 🟡 | CAP-04 claim → source → quote tracing (the "verification table" in Part 5 is the first step) |
| RES-06 | Identify contradictions | Several sources → contradiction map | Select the sources → Ask AI "where do these disagree?" (16k) | ❌ | CAP-04 contradiction task that writes a Comparison with the conflicting claims side by side; CAP-01 |
| RES-07 | Develop research questions | Broad topic → research questions | Topic in a block → chat / **Explain** → **Turn into tasks** for the questions | ✅ | — |
| RES-08 | Generate hypotheses | Existing evidence → hypothesis tree | **Decision Tree** / chat | 🟡 | CAP-07 hypothesis-tree template; CAP-04 evidence linked to each hypothesis |
| RES-09 | Organize notes | Messy notes → structured knowledge | Paste the notes → Visualize → **Sections** / **Concept Map** | ✅ | Strongest flow today. For notes *already on the canvas*: CAP-08 "organize selection" |
| RES-10 | Research synthesis | Many sources → executive synthesis | **Summarize** at workspace scope | 🟡 | Capped at 16k. CAP-01; CAP-09 synthesis/report template with citations (CAP-04) |
| RES-11 | Explore an unknown domain | Documents → domain map | **Concept Map** + child explanations + **Explain** | 🟡 | Limited by pasting. CAP-02; CAP-18 |
| RES-12 | Track unresolved questions | Research project → open-question board | Todo block; **Turn into tasks** | 🟡 | CAP-04 "extract open questions" across the workspace; open-questions board template (CAP-07) |
| RES-13 | Create a briefing | Research → decision-ready brief | **Summarize** → note → move to a Page | 🟡 | CAP-09 brief template + DOCX/PDF export |
| RES-14 | Connect historical research | Old + new documents → how ideas evolved | **Update from new content** shows conceptual changes between versions of *one* source | 🟡 | Works for versions of one document, not across different documents. CAP-01; CAP-04 plus a Timeline of how claims changed |
| RES-15 | Build an argument | Evidence → argument/evidence structure | Draw by hand with `supports` arrows; **Decision Tree** | 🟡 | CAP-07 argument-map template (claim / reason / objection / rebuttal); CAP-04 |

### 4.4 Consultants / strategy professionals

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| CON-01 | Client discovery | Interview notes → problem structure | Paste the notes → **Problem → Cause → Solution** / **Sections** | 🟡 | Many interviews: CAP-02; CAP-04 themes with citations |
| CON-02 | Situation analysis | Client info → situation map | Paste → **Concept Map** / **Sections** | ✅ | — |
| CON-03 | Root-cause analysis | Business problem → issue tree | **Problem → Cause → Solution** or **Decision Tree** | 🟡 | CAP-07 MECE issue-tree template; CAP-04 evidence per branch |
| CON-04 | Hypothesis-driven analysis | Business question → hypothesis tree | **Decision Tree** as an approximation | 🟡 | CAP-07 hypothesis tree; CAP-10 "what would prove/disprove this?" action |
| CON-05 | Market analysis | Research → market map | Paste research → **Sections** / **Comparison** | 🟡 | CAP-18; CAP-13 market data; CAP-07 market-map / segment templates |
| CON-06 | Competitor analysis | Competitor data → competitive landscape | **Comparison** | 🟡 | CAP-07 positioning 2×2; CAP-18 |
| CON-07 | Strategic options | Research → strategic alternatives | **Comparison** / **Decision Tree** | ✅ | — |
| CON-08 | Prepare a recommendation | Evidence → decision structure | Select the evidence → chat | 🟡 | CAP-04 each recommendation traced to evidence; CAP-09 recommendation memo |
| CON-09 | Workshop preparation | Client context → workshop canvas | Build the board by hand; Visualize the agenda → **Flow** | 🟡 | CAP-07 workshop board templates; CAP-16 so the client can join |
| CON-10 | Workshop synthesis | Raw notes → structured findings | Paste the notes → **Sections**; **Turn into tasks** | ✅ | Typed-up notes work. Photos of sticky notes or whiteboards need CAP-15 |
| CON-11 | Executive briefing from large research | Large research set → executive summary | **Summarize** (workspace) | ❌ | Doesn't work at "large" scale. CAP-01; CAP-02; CAP-09 |
| CON-12 | Build a business case | Data + assumptions → argument/evidence model | Table blocks + **Comparison**; the calculations are done elsewhere | 🟡 | CAP-13 table formulas / sensitivity; CAP-04 |
| CON-13 | Scenario planning | Variables → scenario map | **Decision Tree** | 🟡 | CAP-07 2×2 scenario matrix |
| CON-14 | Project knowledge management | Several deliverables → connected project workspace | Canvases/pages per workstream; **Find related** | 🟡 | CAP-01; CAP-02; CAP-16 team workspace |
| CON-15 | Handover | Existing project → transferable project context | Export `.acute.json` / Markdown; **Summarize** the workspace | 🟡 | CAP-16 share links / roles; CAP-05 auto "project state" summary |

### 4.5 Founders / startup operators

> **Especially important:** *"I have 50 scattered thoughts about my startup. Help me turn them into a coherent strategy."* **Today: ✅ for organizing** (paste → Visualize → Sections / Concept Map) and **🟡 for the strategy reasoning** on top (16k cap, no strategy templates).

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| FND-01 | Validate a startup idea | Research + interviews → validation map | Paste → **Problem → Cause → Solution**; **Comparison** | 🟡 | CAP-02; CAP-04 evidence for/against each assumption; CAP-07 assumption-map template |
| FND-02 | Define the ICP | Customer research → ICP profiles | Paste research → **Comparison** / **Sections** (cards) | 🟡 | CAP-07 persona/ICP card template |
| FND-03 | Map customer problems | Interviews → pain-point map | Paste the interviews → **Sections** / **Concept Map** | ✅ | Within 200k. More interviews: CAP-02 |
| FND-04 | Competitor research | Competitor data → landscape | Paste notes → **Comparison** | 🟡 | CAP-18; CAP-07 landscape / 2×2 |
| FND-05 | Product strategy | Research + goals → strategy map | **Concept Map** / **Sections**; chat | 🟡 | CAP-01; CAP-07 strategy templates |
| FND-06 | Feature prioritization | Ideas + feedback → prioritized backlog | Table + Ask AI; re-type the scores | 🟡 | CAP-10 scoring action; CAP-07 2×2 |
| FND-07 | Build a roadmap | Strategy → roadmap | **Timeline** / **Action Plan** | 🟡 | CAP-07 roadmap / swimlane |
| FND-08 | Analyze the business model | Costs + pricing → business model | Tables by hand; Ask AI | 🟡 | CAP-13 table calculations; CAP-07 lean / business-model-canvas template |
| FND-09 | Explore pricing | Competitor + customer data → pricing hypotheses | **Comparison** + chat | 🟡 | CAP-13; CAP-18 |
| FND-10 | Go-to-market planning | ICP + channels → GTM map | **Concept Map** / **Flow** / **Action Plan** | ✅ | — |
| FND-11 | Content strategy | ICP + positioning → content system | **Concept Map** + **Create plan** | ✅ | — |
| FND-12 | Investor preparation | Company info → investor narrative | Chat → note → Page | 🟡 | CAP-09 narrative / deck outline + slides export |
| FND-13 | Fundraising research | Investor info → investor landscape | Not really possible; info is gathered outside Acute | ❌ | CAP-18 web research; CAP-14 CRM connector |
| FND-14 | Weekly founder review | Metrics + notes → decision/action map | Paste this week's notes → **Summarize** + **Turn into tasks** | 🟡 | CAP-13 metrics; CAP-05 "what changed since last week"; CAP-20 recurring review |
| FND-15 | Connect product, marketing and sales | Several workstreams → company-level context | One workspace, one canvas per workstream; Ask AI at workspace scope | 🟡 | Capped at 16k. CAP-01; CAP-14 |

### 4.6 Knowledge workers / general professionals

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| KW-01 | Organize messy notes | Notes → structured workspace | Paste → Visualize → **Sections** | ✅ | CAP-08 for notes already on the canvas |
| KW-02 | Research a topic | Sources → knowledge map | Paste sources one at a time → **Concept Map** | 🟡 | CAP-02; CAP-18 |
| KW-03 | Prepare a presentation | Research → presentation structure | Visualize → **Sections**; **Create plan** | 🟡 | CAP-09 slide outline + slides export |
| KW-04 | Prepare for a meeting | Context → meeting brief | Select the relevant blocks → **Summarize** | ✅ | Within 16k |
| KW-05 | Post-meeting synthesis | Notes → decisions / actions | **Summarize** + **Turn into tasks** | ✅ | CAP-11 for typed decisions and questions |
| KW-06 | Plan a complex project | Requirements → project map | **Create plan**, Visualize → **Action Plan** / **Timeline** | ✅ | — |
| KW-07 | Brainstorm | Ideas → structured possibilities | Ideas on the canvas; chat to expand them (result is a note) | 🟡 | The AI can't add idea nodes around a selection. CAP-10 "expand / generate options" action that places nodes; CAP-08 |
| KW-08 | Make a decision | Options + evidence → decision framework | **Comparison** / **Decision Tree** | ✅ | CAP-04 for evidence links |
| KW-09 | Learn something | Documents → learning map | **Concept Map** + child explanations + **Explain** | ✅ | CAP-19 for practice and retention |
| KW-10 | Write a report | Research → report | **Summarize** / chat → Page | 🟡 | CAP-09 report template + DOCX/PDF export |
| KW-11 | Connect information | Several documents → relationship map | **Find related** (keyword, lists matches only) | 🟡 | CAP-08 AI-drawn relationships; CAP-01 semantic matching |
| KW-12 | Personal knowledge management | Long-term notes → connected knowledge base | Workspaces, canvases, pages; find-on-canvas | 🟡 | No backlinks, tags or cross-workspace semantic search. CAP-01; CAP-08 (backlinks); CAP-02 (Obsidian/Notion Markdown import) |
| KW-13 | Revisit old work | Existing workspace → reconstructed context | Reopen the canvas; saved conversations; **Summarize** the canvas | 🟡 | CAP-05 "catch me up" summary of state, decisions and open questions |
| KW-14 | Create reusable knowledge | Work artifacts → knowledge system | Pages; copy/paste or duplicate | 🟡 | CAP-10 user-defined templates and actions |
| KW-15 | Ask AI over personal knowledge | Workspace → context-aware answers | Ask AI at workspace scope | 🟡 | Capped at 16k. CAP-01 |

### 4.7 Students / learners

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| STU-01 | Understand a difficult topic | Notes/textbook → concept map | Paste → **Concept Map**; **Explain** + child explanations | ✅ | — |
| STU-02 | Research assignment | Sources → research workspace | Paste each source → **Concept Map** | 🟡 | CAP-02 (PDF); CAP-18 |
| STU-03 | Connect concepts | Several topics → knowledge graph | Separate maps, linked by hand | 🟡 | CAP-08 |
| STU-04 | Prepare for an exam | Notes → study structure | **Summarize** → notes | 🟡 | CAP-19 flashcards / quiz / weak-area review |
| STU-05 | Summarize a lecture | Lecture notes → structured notes | Paste → **Sections** / **Summarize** | ✅ | Recordings need CAP-11 (transcript input) |
| STU-06 | Ask questions against notes | Notes → contextual answers | Ask AI at selection/canvas scope | 🟡 | ✅ for small sets. A full course's notes: CAP-01 |
| STU-07 | Build a project | Requirements → project plan | **Create plan** / **Action Plan** | ✅ | — |
| STU-08 | Literature review | Papers → research map | Same as RES-01 | 🟡 | CAP-02; CAP-04 |
| STU-09 | Learn programming | Code + docs → conceptual map | Paste snippets → **Explain**; docs → **Concept Map** | 🟡 | ✅ for snippets. Whole projects: CAP-03 |
| STU-10 | Prepare a thesis | Papers + notes → thesis knowledge structure | Paste as much as fits | ❌ | Too many sources. CAP-02; CAP-01; CAP-04; CAP-07 argument map |

### 4.8 Designers / UX researchers

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| UX-01 | Synthesize customer research | Interviews → affinity map | Paste → **Sections** (cards) | 🟡 | CAP-07 affinity board; CAP-02; CAP-04 quotes as evidence |
| UX-02 | Map the user journey | Research → journey | **Timeline** / **Flow** | 🟡 | CAP-07 journey map |
| UX-03 | Create personas | Interviews → personas | **Sections** / **Comparison** | 🟡 | CAP-07 persona template; CAP-04 quotes linked to each persona trait |
| UX-04 | Problem discovery | Research → problem map | **Problem → Cause → Solution** / **Concept Map** | ✅ | — |
| UX-05 | Feature ideation | Problems → solution space | **Concept Map**; chat | ✅ | CAP-10 "generate options" would help |
| UX-06 | Competitor analysis | Screenshots/info → competitive map | Drop screenshots on the canvas (the AI can't see them); type notes → **Comparison** | ❌ | CAP-15 vision; CAP-18 |
| UX-07 | Design rationale | Decisions → decision record | **Decision Tree** + Text blocks | 🟡 | CAP-09 decision record |
| UX-08 | User flow | Requirements → flow diagram | Visualize → **Flow** | ✅ | A pasted Mermaid flowchart already becomes native shapes (F33) |
| UX-09 | Information architecture | Content → IA map | Visualize → **Concept Map** (hierarchy sections) | ✅ | A dedicated sitemap/tree template (CAP-07) would help |
| UX-10 | Design critique | Design + requirements → structured critique | Not possible; the AI can't see the design | ❌ | CAP-15 vision; CAP-14 Figma connector |

### 4.9 Engineering managers / tech leads

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| EM-01 | Understand system architecture | Codebase → architecture map | Same as DEV-01 (Repo Map through an IDE agent) | 🟡 | CAP-03 |
| EM-02 | Plan a large feature | Requirement + repo → engineering plan | **Create plan** / **Action Plan** from the requirement | 🟡 | Not grounded in the repo. CAP-03 (CAP-06 is built: an IDE agent can read and write the plan over MCP) |
| EM-03 | Map technical debt | Repo → debt landscape | Only through an IDE agent that finds the debt and maps it (Repo Map / `render_visual_plan`) | 🟡 | CAP-03 (hotspots, TODOs, complexity); CAP-07 risk/debt matrix |
| EM-04 | Dependency analysis | Codebase → dependency map | Paste package manifests → **Architecture**; or Repo Map through an IDE agent, with `link_map_nodes` for dependencies | 🟡 | CAP-03; CAP-07 dependency graph |
| EM-05 | Incident analysis | Logs + docs → incident map | Paste the timeline and postmortem → **Timeline** + **Problem → Cause → Solution** | 🟡 | CAP-13 logs; CAP-04 evidence; CAP-09 postmortem template |
| EM-06 | Architecture decision | Options → ADR | **Comparison** / **Decision Tree**; write the ADR by hand | 🟡 | CAP-09 ADR |
| EM-07 | Team onboarding | Project context → onboarding map | Build the canvas by hand; share by `.acute.json` export | 🟡 | CAP-16 sharing; CAP-03 |
| EM-08 | Project status | Several sources → project overview | Not possible; issue trackers and PRs aren't reachable | ❌ | CAP-14 GitHub / Jira / Linear; CAP-01; CAP-20 |
| EM-09 | Identify risks | Project data → risk map | Paste → **Sections**; chat | 🟡 | CAP-07 likelihood × impact matrix |
| EM-10 | Map cross-team dependencies | Team/project data → dependency graph | Paste → **Architecture** / **Concept Map** | 🟡 | CAP-14; CAP-07 dependency graph |
| EM-11 | Technical documentation | Existing system → living documentation | Visualize the docs; re-paste with **Update from new content** when they change. Repo Map through an IDE agent keeps a code map current: `get_map_status` reports stale sections from `git diff` paths, and the agent re-sends them | 🟡 | Only when the user re-runs the agent. CAP-03; CAP-20 auto-update (reuses the F38/F39 reconciliation engine) |
| EM-12 | Plan a migration | Old/new architecture → migration map | Paste both → **Comparison** + **Action Plan** + **Timeline** | 🟡 | CAP-03 to find what must move |

### 4.10 Knowledge managers / operations

| ID | Workflow | Starting input → expected outcome | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| KM-01 | Build a company knowledge base | Documents → connected knowledge | Paste one document at a time; one page each | ❌ | Not practical at company scale. CAP-02; CAP-01; CAP-16 |
| KM-02 | Organize SOPs | Existing docs → structured processes | Paste each SOP → **Flow** | 🟡 | CAP-02 batch import |
| KM-03 | Find institutional knowledge | Old documents → contextual answer | Ask AI at workspace scope | ❌ | CAP-01; CAP-14 Drive / OneDrive / Notion |
| KM-04 | Create a process map | SOPs → workflow | Paste the SOP → **Flow** | ✅ | — |
| KM-05 | Document processes | Existing knowledge → SOP | Chat / **Create plan** → Page | 🟡 | CAP-09 SOP template |
| KM-06 | Identify knowledge gaps | Existing knowledge → gap map | Not possible | ❌ | CAP-01; CAP-04 "what's missing or contradictory" task |
| KM-07 | Employee onboarding | Company knowledge → onboarding workspace | Build a workspace by hand; export it | 🟡 | CAP-16 |
| KM-08 | Handover | Employee/project knowledge → transfer map | Export plus a **Summarize** of the workspace | 🟡 | CAP-16; CAP-05 |
| KM-09 | Cross-document reasoning | Several docs → synthesized answer | Select the documents → Ask AI | 🟡 | Capped at 16k. CAP-01; CAP-04 |
| KM-10 | Maintain evolving knowledge | Changing docs → updated knowledge model | **Update from new content**: re-paste a new version; user edits are kept | 🟡 | The reconciliation is already strong, but it's manual and per source. CAP-14 auto-sync; CAP-20 |

### 4.11 Cross-ICP workflows (these define Acute itself)

| ID | Workflow | Input → action → output | How a user does it today | Today | Changes needed |
|---|---|---|---|---|---|
| X-01 | Messy → structured | Random notes/links/docs → "Make sense of this" → organized canvas + relationships | Paste → ✨ Visualize → **Sections** / **Concept Map** | ✅ | Links and objects already on the canvas: CAP-08 "organize"; files: CAP-02 |
| X-02 | Research → understanding | 20–100 sources → concept map, themes, evidence, open questions | Paste what fits (≤200k chars) | ❌ | Can't be done at the stated scale. CAP-02; CAP-01; CAP-04 |
| X-03 | Context → reasoning | Large workspace → "Given everything here, what should I do?" | Ask AI at workspace scope | 🟡 | Only the first 16k chars are seen, and the answer doesn't say what was left out. CAP-01 |
| X-04 | Problem → solution | Problem + research → decomposition, hypotheses, options, decision | Chain **Problem → Cause → Solution** → **Comparison** / **Decision Tree** → **Create plan** | ✅ | Steps are chained by hand. A guided "work the problem" flow (CAP-10) would help |
| X-05 | Information → visual model | Text/docs/code → "Show me how this fits together" | ✨ Visualize (9 templates) | ✅ | Text: ✅. Code: CAP-03. Images: CAP-15 |
| X-06 | Existing knowledge → new work | Workspace → "Create something new from what I know" | Select → **Create plan** / chat | 🟡 | CAP-01; CAP-09 |
| X-07 | Multiple sources → one decision | Docs + data + opinions → evidence, alternatives, tradeoffs, open questions | Paste everything → **Comparison** | 🟡 | CAP-02; CAP-04; CAP-13 |
| X-08 | Code → mental model | GitHub repo → architecture, components, dependencies, flows | Hand-paste into **Architecture**, or Repo Map through an IDE agent (local install) | 🟡 | CAP-03 |
| X-09 | Mental model → artifact | Understanding built in Acute → PRD / ADR / roadmap / deck / report / task list | Tasks and plans: ✅. Documents: chat → note → Page by hand | 🟡 | CAP-09 |
| X-10 | Artifact → continued reasoning | Existing PRD/report → keep asking questions | Conversations are saved per canvas and resume on their anchors | 🟡 | The surrounding context is still capped at 16k, with no memory beyond the conversation. CAP-05; CAP-01 |

### 4.12 Scorecard across all ICP workflows

Counts across the 149 rows of §4.1–4.11:

| ICP | Rows | ✅ | 🟡 | ❌ |
|---|---|---|---|---|
| Developers | 20 | 1 | 19 | 0 |
| Product managers | 17 | 4 | 13 | 0 |
| Researchers | 15 | 2 | 11 | 2 |
| Consultants | 15 | 3 | 11 | 1 |
| Founders | 15 | 3 | 11 | 1 |
| Knowledge workers | 15 | 6 | 9 | 0 |
| Students | 10 | 3 | 6 | 1 |
| Designers / UX | 10 | 4 | 4 | 2 |
| Eng managers / tech leads | 12 | 0 | 11 | 1 |
| Knowledge managers / ops | 10 | 1 | 6 | 3 |
| Cross-ICP | 10 | 3 | 6 | 1 |
| **Total** | **149** | **30** (20%) | **107** (72%) | **12** (8%) |

**What this says about ICP fit today:**

- **Best current fit:** knowledge workers, PMs and UX. These users mostly work with *one text source at a time* and want a structured visual model and a plan. That is exactly the paste → Visualize → refine loop.
- **Promising but blocked by scale:** researchers, consultants and founders. The workflows exist but break down once there are more sources than fit in one paste, or the AI needs to see more than 16k chars. CAP-01, CAP-02 and CAP-04 unlock most of this group together.
- **Weakest fit today:** developers and engineering managers, even though these are the ICPs where Acute's story (code context, MCP) is most differentiated. CAP-06 and Repo Map (F43) are now built, which moved every developer row except EM-08 to 🟡. But that path works in a local install only, still needs its by-hand client check, and Acute adds no code intelligence of its own (CAP-03). **Claim "your IDE agent can map your repo onto a canvas (local install)" only after the client check and a scored test run, not "Acute understands your codebase".**

---

## Part 5 — Future learning & understanding flows (earlier notes)

*Kept from the earlier version of this file. It covers the understanding/learning direction, which adds to the ICP workflows above.*

### 5.1 The user flows behind this

Six flows, each describing a job the user wants done, not a feature to build:

1. **"Teach me this, don't just summarize it."** A large document becomes a step-by-step understand → connect → test → apply sequence, and the system remembers what the user does and doesn't understand across sessions.
2. **"Turn anything into a learning journey."** Any input (PDF, video, repo, article, meeting, paper, AI conversation) becomes a concept map → learning path → lessons → practice → weak-area review, and the path adapts to how the user answers.
3. **"Understand before you use AI."** When AI (Claude/ChatGPT/etc.) generates something (code, a plan, a document), Acute helps the user understand its architecture, key decisions and risks, and checks their understanding, before they rely on it.
4. **"Meeting → knowledge → execution."** A meeting produces not just a transcript or summary but decisions, assumptions, open questions and tasks that resurface automatically when a related topic comes up again.
5. **"AI output → verification."** An AI explanation of a source becomes a claim/evidence/confidence table with an explicit "verify before relying on this" step, instead of being taken at face value.
6. **"One source → many useful outputs."** Dropping in one source automatically produces the outputs the user is likely to want (summary, concept map, flashcards, quiz, cheat sheet, FAQ, open questions) without a separate prompt for each.

**Proposed positioning thesis (unconfirmed, for later discussion):** ChatGPT/Claude = "work with AI", NotebookLM = "understand your sources", Notion = "organize knowledge", Acute = "turn information into understanding and retained capability". The suggested moat is not feature count, which larger platforms can easily copy. It is persistent **workflow state**: the user's evolving understanding, which a single chat or notebook interaction doesn't accumulate.

### 5.2 What's achievable with the current plan, and how to handle the rest

#### Tier A — achievable once Phase 5 / 5b / 5c ship, no new architecture

| Flow piece | Goal it serves | Why it already fits |
|---|---|---|
| Architecture diagram + key decisions/risks from code (Flow 3) | understand AI-generated output before relying on it | The `Architecture` VisualPlan template already exists (F29); "explain decisions/risks" is one new `AITask` producing a text block, the pattern F26/F18 were built for |
| Claim / source / confidence verification table (Flow 5) | verify AI output instead of trusting it | `Comparison` template + a new `AITask` (`extract_claims`) → an ordinary Table VisualNode; the "your understanding" column is plain cell data, not new state |
| Summary / Concept Map / FAQ / Open Questions / Cheat Sheet (Flow 6, subset) | fast, low-effort orientation on a new source | Summary = `summarize` task. Concept Map = existing template. FAQ = a text block via `generate_note`. Open Questions = a Todo block. Cheat Sheet = a text/table block |
| Decision capture: Decision / Reason / Assumptions / Questions / Related knowledge (Flow 4) | keep a decision's context attached, not just its outcome | Existing block types + `AcuteRelation` types (`caused_by`, `derived_from`, `relates_to`) cover this. F22 (keyword search) and F23 (typed relationships) have shipped; AI-proposed links still need CAP-08 |

#### Tier B — small additions on top of the finished base

These are not currently planned, but cheap, because the extension points already exist. The pattern for all of them is the one the PRD already uses: append to a registry, don't touch the pipeline.

- **Flashcard / quiz blocks.** One new `VisualNodeContent` variant + one new F30 renderer mapping, the same way `todo`/`table` were added. Each card gets its own small review state (`nextReviewAt`, `easeFactor`, `correctCount`). This is self-contained and does **not** need the concept-mastery graph in Tier C.
- **"Learning Path" as a VisualPlan template** (Flow 2). The template registry (§13.15.2) was designed for adding templates over time. This is a registry entry, not a new subsystem.
- **PDF / YouTube / meeting-transcript / GitHub-repo ingestion** (Flows 2 and 4). New *Content Parser input adapters*, each producing the same `ParsedContent` tree F28 already defines. They plug in without touching F29/F30/F38 downstream. GitHub, Slack and meeting-tool ingestion already has a home at F24's MCP-source adapter boundary. *(These are CAP-02, CAP-03 and CAP-11 in Part 6.)*
- **Proactive "this relates to a decision from 3 weeks ago" resurfacing** (Flow 4). A UX feature on top of F22 (semantic search): show related objects while the user is writing, not only on explicit search. No new data model. *(CAP-17.)*

**One near-zero-cost note for F37:** keep `ContentSource.origin` open (`"paste" | "import" | "mcp" | ...`) rather than treating those three as the full list. Widening it later (`pdf`, `youtube`, `audio_transcript`, `repo`) is a non-breaking addition either way. Being deliberate about it means nobody assumes the future adapters need a schema migration. They don't.

#### Tier C — the one genuinely new subsystem: the Understanding Graph

This is the real gap: persistent, cross-source, cross-session **concept mastery** (weak / unfamiliar / understood / mastered), spaced-repetition scheduling, and an adaptive sequence that changes with the user's answers. These are the core claims of Flows 1 and 2, and the "mastery bars" in Flow 3.

Nothing in Phase 5/5b/5c models this. `AcuteRelation` connects canvas *objects* to each other. It does not track how a user's grasp of an abstract *concept* changes over time and across many sources.

It can be added later without reworking the canvas, block or AI-runtime architecture, using patterns already in place:

- New domain entities (`Concept`, `ConceptMastery`, `LearningGoal`). A `Concept` can be another lightweight `AcuteObject` variant, reusing the existing stable-ID, relation and provenance machinery instead of a parallel graph.
- A new repository (`ConceptRepository`), the same shape as `AISettingsRepository` / `AIUsageRepository` (§9.1). Additive, not a rewrite.
- New `AITask`s (`assess_understanding`, `identify_weak_concepts`, `generate_learning_path`). The task registry was built for this kind of addition.
- Mastery updates from quiz answers are a **different trigger** from F19's reviewable AI change sets. They are closer to F22's background indexing (a passive state update) than to an Accept/Reject transaction (an authored content change). Keep that distinction explicit when this is designed, so it isn't awkwardly bolted onto the review/undo model.

Recommended treatment: a deliberate later phase, **AI Phase 6 — Understanding Layer**, after the external MCP connectors phase in the PRD's phase list (§13.18). *(CAP-19 in Part 6.)*

---

## Part 6 — Capability roadmap (by priority)

**How priority was set:** (1) how many killer workflows (§3.2) and ICP rows (Part 4) a capability unlocks; (2) whether it backs a claim we're already making (code context, "no rebuilding context"); (3) how much of the foundation already exists. "Unlocks" counts the Part 4 rows whose "Changes needed" cites the capability. Sizes are rough: **S** ≈ days, **M** ≈ 1–3 weeks, **L** ≈ 1–2 months.

### P0 — Required before we can claim the core proposition

These close the *collect → reason → remember* gap in §3.1 and the developer ICP gap in §4.12.

| Code | Capability | What it means concretely | Builds on | Unlocks (rows) | Killer workflows | Size |
|---|---|---|---|---|---|---|
| **CAP-01** | **Large-context reasoning & semantic retrieval** | Replace the fixed 16k-char context with retrieval: index every block/page/source in chunks (embeddings or hybrid BM25), pull the most relevant chunks for each question, and **tell the user what was and wasn't included**. Raise the budget for models that allow it | F22 deterministic tier (done: `WorkspaceIndex`, `contextBuilder.ts` budgeted retrieval, keyword/IDF); `ASK_BUDGET` 16k cap; F18 Find related | 32 | #3, #7, #13, #19, #20 | L |
| **CAP-02** | **Multi-file / multi-source ingestion** | Drag-drop and batch import of PDF, DOCX, MD, TXT, HTML and JSON/OpenAPI. Each file becomes a **Source** (a page + `ContentSource` with origin `pdf`/`docx`/…) that Visualize and Ask AI can target singly or as a set. Obsidian/Notion Markdown folder import | F28 parser (new input adapters); F37 `ContentSource.origin` (keep it open, Part 5) | 26 | #6, #9, #17 | M |
| **CAP-03** | **Codebase ingestion & code intelligence** | Connect a GitHub repo or local folder (through F24's MCP host / a filesystem MCP). Build a file tree, symbol index and import/call graph. Code-aware Visualize: architecture from the repo, feature tracing, API/sequence flows, impact analysis. Code nodes link back to `file:line` | F24 boundary; F29 Architecture/Flow templates; Tier B "GitHub-repo ingestion". **The ingestion half is covered in a local install by F43 Repo Map** (the IDE agent reads the repo); code intelligence inside Acute is still open | 28 | #1, #2, #3, #4 | L |
| **CAP-04** | **Cross-source synthesis with citations** | New AI tasks: `extract_themes` (with counts), `find_contradictions`, `extract_claims`, `trace_evidence`, `extract_open_questions`. Every generated node carries `derived_from` / `references` links to the source and quote it came from | Relation types already exist; Tier A "verification table"; needs CAP-01 + CAP-02 to be useful at scale | 29 | #6, #7, #8, #9, #16, #17 | M |
| **CAP-05** | **Workspace memory & "continue where I left off"** | A lasting per-workspace summary of goals, decisions, open questions and recent changes, updated as the user works. A **"Catch me up"** action. Follow-ups automatically include that memory plus retrieved context | F40 conversations; F37 source history; CAP-01 | 5 (plus the Remember/Continue steps every ICP relies on) | #20 (and the "Remember/Continue" loop steps) | M |
| **CAP-06** | **MCP server transport + tools** — ✅ **built (local install)** | F20's browser-tab Streamable HTTP bridge and F21's read tools plus write-as-proposal tools, with a per-workspace Read-only switch. Claude Code / Copilot can **read the canvas as context and write plans, diagrams and progress back**. Still open: by-hand VS Code / Claude Code check, more MCP prompts (PRD §13.13), a delete tool behind confirmation, hosted MCP (needs server-side workspaces) | F20, F21, F43 (all done) | 3 direct; it is the developer-ICP differentiator | #4 | M |

**Recommended P0 order:** CAP-02 → CAP-01 → CAP-04 → CAP-05, alongside CAP-06 → CAP-03. Ingestion comes first because retrieval and synthesis have nothing to work on without multi-source input. CAP-06 is now built, and F43 Repo Map sits on top of it. What remains on the dev track is the real-client check and CAP-03's code intelligence.

### P1 — Broadens what users can produce (high value, mostly additive)

| Code | Capability | What it means concretely | Builds on | Unlocks (rows) | Size |
|---|---|---|---|---|---|
| **CAP-07** | **Expanded Visualize template library** | New templates, in rough order of demand: 2×2 matrix (impact/effort, positioning, scenario, risk), journey map, issue/hypothesis tree, affinity/cluster board, roadmap/swimlane, persona/ICP card, argument map, dependency graph, sequence diagram, ERD, open-questions board, business-model canvas, learning path | F29 template registry (additive entries); F30 renderer; F42 grouped layouts | 39 | S per template (M in total) |
| **CAP-08** | **AI-proposed relationships & "organize existing objects"** | The AI suggests typed arrows between objects *already on the canvas*, and clusters or arranges a selection, as a reviewable change set. Backlinks panel ("what links here") | F23 (done: typed arrows); `organize` / `extract_relationships` task ids exist but aren't built; F19 review; F41 reflow | 10 | M |
| **CAP-09** | **Artifact generation + rich export** | "Generate document" from a selection or workspace: PRD, ADR, brief, report, SOP, postmortem, investor narrative, slide outline. Writes a **Page** with sections that link back to the canvas nodes it came from. Export to DOCX / PDF / slides | `generate_note` task; Pages; Markdown export | 17 | M |
| **CAP-10** | **Structured analysis actions + custom actions** | Actions that **write back to structure**: score a table with RICE/ICE/MoSCoW, 5-whys, "expand/generate options" that places nodes, "what would prove this?". Users can save their own prompts as actions and templates | F18 selection-action registry; Table blocks; F19 | 8 | S–M |
| **CAP-11** | **Meeting ingestion → typed decisions / actions / questions** | Import a transcript (text/VTT; audio later) and extract **Decision**, **Assumption**, **Open question** and **Action** objects, linked to the meeting source | CAP-02 adapter; existing blocks + relations (Tier A decision capture) | 3 | M |
| **CAP-12** | **Mermaid & diagram-as-code in the UI** — ✅ **mostly built** | Flowcharts, state, class and ER diagrams: preview in code blocks, and Visualize / paste hint / selected block → native shapes and arrows (F33; class members become text cards and ER entities table cards). Still open: sequence diagrams, and a Mermaid block inside a larger document (it stays a code block) | F33 (done) | 2 (and supports CAP-03 repos with Mermaid docs) | S |
| **CAP-13** | **Structured data & log ingestion + table calculations** | CSV/XLSX/analytics exports → Table blocks; log/stack-trace parsing; simple table formulas (sum, average, weighted score) so business cases and prioritization can compute | Table block; CAP-02 adapter | 12 | M |

### P2 — Expands reach: connectors, vision, teams

| Code | Capability | What it means concretely | Builds on | Unlocks (rows) | Size |
|---|---|---|---|---|---|
| **CAP-14** | **External connectors** | GitHub issues/PRs, Jira/Linear, Slack, Google Drive/OneDrive, Notion, Figma, CRM, through MCP host adapters. External records become normal Acute objects with source/external-ID provenance | F24 / PRD AI Phase 4 | 9 | M each |
| **CAP-15** | **Image & screenshot understanding** | Send images (screenshots, whiteboard photos, designs) to vision-capable models; describe, extract text, critique | AI context builder (images currently skipped); provider capability flags | 4 | M |
| **CAP-16** | **Sharing & collaboration** | Cloud sync, workspace roles (Owner/Editor/Viewer), share links for handover and onboarding, live co-editing | Yjs layer; PRD §14 cloud authorization model | 7 | L |
| **CAP-17** | **Proactive resurfacing** | While the user writes, show related past decisions, questions and notes ("this relates to a decision from 3 weeks ago") | CAP-01 (F22); Tier B note in Part 5 | 1 (plus the resurfacing flow in Part 5) | S (once CAP-01 exists) |
| **CAP-18** | **Web / URL research & capture** | Paste a URL to import the page as a Source; optional web search to collect competitor, market or docs material | CAP-02 adapter; provider tools under the existing hardening rules | 11 | M |

### P3 — Long-term differentiation

| Code | Capability | What it means concretely | Builds on | Unlocks (rows) | Size |
|---|---|---|---|---|---|
| **CAP-19** | **Understanding layer** | Flashcard/quiz blocks (Tier B), Learning Path template, then the Understanding Graph (Tier C): concept mastery, spaced repetition, adaptive paths | Part 5 Tiers B–C; proposed "AI Phase 6 — Understanding Layer" | 2 (mainly students; plus Part 5 Flows 1–2) | M → L |
| **CAP-20** | **Scheduled / background agents & living documents** | Recurring jobs (weekly review, "re-sync docs from the repo"), auto-running **Update from new content** when a connected source changes | F38/F39 reconciliation (done); CAP-14; PRD AI Phase 5 | 5 | L |

### 6.1 Suggested roadmap sequence

| Horizon | Theme | Capabilities | What it lets us claim |
|---|---|---|---|
| **Next (1–2 months)** | *"Bring all your sources, and the AI sees all of it"* | CAP-02, CAP-01 (first tier: chunked keyword + budget visibility), CAP-12, CAP-07 (first 4 templates: 2×2, journey, issue/hypothesis tree, affinity) | Researchers, PMs and consultants can run the killer workflows at realistic scale |
| **Then (2–4 months)** | *"Reason across sources, and pick up where you left off"* | CAP-04, CAP-05, CAP-08, CAP-09, CAP-10 | The full collect → connect → visualize → reason → modify → remember → produce → continue loop |
| **Then (in parallel, dev track)** | *"Your codebase as a canvas"* | CAP-06 ✅ and F43 Repo Map ✅ (local), then the real-client check, then CAP-03 | The developer / EM story, including the "understand this repo in 30 minutes" test |
| **Later** | *"Your team's and tools' knowledge"* | CAP-11, CAP-13, CAP-14, CAP-15, CAP-16, CAP-17, CAP-18 | KM/ops, team onboarding and handover; design critique |
| **Future** | *"Retained understanding"* | CAP-19, CAP-20 | The positioning thesis in Part 5 |

---

## Part 7 — Bottom line

- **Test first, then claim.** Run the 20 killer workflows in §3.2 with the five-dimension scoring in §2.3. The ratings here are from reading the code and the tracker; real runs will confirm them or correct them.
- **Where Acute is genuinely strong today:** turning one text source into a structured, editable visual model, and updating it later *without losing the user's edits* (F37–F39, F38b). That second part is a real differentiator worth leading with.
- **Where the claims are ahead of the product:** many sources, large context, codebase understanding, and "the AI remembers my context". All four developer killer workflows are only partial, and 1 of the 32 developer and EM rows is ❌ (EM-08). That partial path depends on the user's IDE agent in a local install, not on Acute understanding code.
- **Planning implication:** P0 (CAP-01 to CAP-06) is what turns the proposition from "put information on a canvas → ask AI → get an answer" into the *collect → connect → visualize → reason → modify → remember → produce → continue* loop. That loop is the version of Acute worth validating against Notion, Obsidian and ChatGPT.
- **Still true from the earlier notes:** keep `ContentSource.origin` open-ended. Almost every P0/P1 ingestion capability (CAP-02, CAP-03, CAP-11, CAP-13, CAP-18) adds a new origin value.
