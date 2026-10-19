# Acute-Notes — Product Positioning & Messaging

Reference for explaining Acute-Notes to people who don't know it: pitches, landing copy, demos, onboarding.
Source of truth for behaviour is the PRD (`acute-notes-prd-claude-code-ai.md`) and the ICP doc (`ai-future-workflow-enhancements.md`). Each claim below is marked **Built** or **Planned** — only market Built claims as available today.

_Last checked against the code: 2026-09-27 (re-checked after F43 Repo Map landed). Everything below runs in a **local install**; there's no hosted version yet (deployment is deferred)._

---

## One-liners

- **Short:** Turn AI output into a visual, editable canvas you actually understand.
- **Tagline options:**
  - "AI does the work. Acute makes it make sense."
  - "Your AI's work, on one canvas you own."
  - "AI updates that never overwrite your edits."
- **Principle lines (from the PRD):**
  - "Canvas = thinking spatially. Block = structured content. Page = deep detail."
  - "Acute-Notes owns the AI experience, not the AI bill."
  - "AI creates a version of the understanding. The user owns the resulting artifact."

## 30-second pitch

> Acute-Notes turns AI output — a ChatGPT or Claude answer, or work your IDE agent did — into a visual, editable canvas of diagrams, checklists, tables and notes that you can understand at a glance and edit yourself. When the AI produces something new on the same topic, Acute proposes only what actually changed. You review it, and it never overwrites your own edits. The core is the same for everyone; developers, PMs and researchers each build on it with their own templates and workflows.

## The problem

- AI produces long walls of text across many chats and tools; the understanding gets lost.
- Re-asking the AI regenerates everything, wiping out the notes and fixes you made by hand.
- Diagrams from AI are usually images or code you can't edit naturally.

## Core value (the framework every role shares)

| Pillar | What it means | Status |
| --- | --- | --- |
| **Capture from any AI** | Paste a ChatGPT/Claude reply, Markdown, meeting or research notes (up to 200k chars) | Built |
| **Condense into a visual canvas** | `✨ Visualize` turns it into native, editable objects: text, headings, TODOs, tables, code, pages, shapes, arrows | Built |
| **9 templates** | Flow, Problem → Cause → Solution, Concept Map, Timeline, Decision Tree, Architecture, Comparison, Action Plan, Sections | Built |
| **Edit by hand** | Everything AI creates is the same editable content a person creates — not a picture | Built |
| **Safe AI updates** | "Update from new content" proposes only what changed; you Accept/Reject; one-step undo | Built |
| **Your edits are protected** | An object you edited is never silently rewritten — it becomes a conflict card: Apply / Keep mine / View diff | Built |
| **Meaning, not wording** | A rewording changes nothing; only real conceptual changes are proposed | Built |
| **Detail goes one level down** | New explanation becomes a linked child note below the concept, keeping the top view clean | Built |
| **Bring your own AI** | Use an existing subscription, your own API key, or a local model; Acute never pays for or proxies inference | Built: GitHub Copilot subscription and a Gemini API key (both validated). OpenAI, Azure, Anthropic and Ollama are wired but not validated yet, so don't market them. Claude/ChatGPT subscriptions are not planned through this SDK |
| **Works without AI** | With no AI connected, every non-AI feature works | Built |
| **Local-first, fast** | Edits save locally and instantly; works offline | Built |
| **IDE agents over MCP** | Claude Code, Cursor, VS Code etc. can read and write the canvas through Acute's MCP server | Built (local install): MCP bridge, read tools, write tools that propose changes the user reviews. By-hand check with real VS Code / Claude Code is still open, so demo it before claiming it |
| **Repo Map** | Your IDE agent maps a repository into Acute one module at a time | Built (F43, local install), automated tests green; by-hand client check still open |
| **Auto-accept updates** | User-only, per-session auto-accept; conflicts and removals always still wait for review | Built, for Repo Map sessions only |

## How to talk about auto-approve (be precise)

- **Say:** "You review every AI update. Clean changes are pre-selected, so accepting is one click."
- **Say (Repo Map only):** "When your IDE agent maps a repo, you can turn on auto-accept for that session. Only you can turn it on, and it never applies conflicts or deletions."
- **Don't say:** "The AI updates your notes automatically."

## Differentiators vs. alternatives

- **vs. chat history (ChatGPT/Claude):** structured and visual, persists across chats, you can edit it.
- **vs. Notion / Obsidian:** AI output arrives already structured, and later AI updates merge in instead of replacing.
- **vs. Excalidraw / Miro:** blocks are real rich content (tables, checklists, code, pages), not just shapes and text.
- **vs. AI diagram tools (Mermaid output, image generators):** native editable objects, and re-running AI never destroys manual work.

## Compared with Eraser.io (added 2026-10-11)

Written for internal positioning, not for publishing as is. **Eraser's column is taken from a description the team supplied (not verified against Eraser's own site or product); our column was checked against the code and plans on 2026-10-11.** Status uses the same rule as above: only market **Built** claims, and only the way the notes beside them allow. The sections above were last checked on 2026-09-27, before Acute Lens, Mermaid sequence/ER import and the design review landed.

### Feature coverage

| Eraser capability | Acute-Notes | Status | Say / don't say |
| --- | --- | --- | --- |
| Natural language → diagram | `✨ Visualize` on pasted text or a document: native editable shapes, 9 templates (incl. Architecture) | **Built** | Works on text you paste, not a one-line "draw me X" prompt |
| Code / repo → diagram | **Repo Map**: your IDE agent reads the repo and maps it in through MCP; Lens organises it L0–L5 | **Built** (local install); by-hand check with a real client still open | Say "your IDE agent maps your repo". Don't say Acute's AI reads your code: it never does |
| Screenshot → diagram | None | **Not built** | Don't claim. Would be a new task; two AI connections are flagged as accepting images, but no feature uses it |
| Diagram-as-code (text → layout) | **Mermaid import** (flowchart, state, class, ER, sequence, pie, gantt, architecture) → native objects | **Built** (import only) | No Eraser-style DSL and no live text editor. A Mermaid block inside a larger document stays a code block |
| Cloud icon libraries (AWS / GCP / Azure) | A fixed set of node kinds (frontend, backend, database, cloud, security, message bus, external…) with colour, icon and legend | **Not built** (vendor icons) | Don't claim cloud-vendor icon sets or snapping |
| Sequence diagrams | Mermaid `sequenceDiagram` → participants, ordered messages, notes, loop/alt/par blocks | **Built** (import); confirm the rendering by hand before demoing | The master plan still lists a lifeline layout as open. As a **Lens** view it is deferred (plan D20) |
| ER diagrams | Mermaid `erDiagram` import | **Built** (import) | No database-dump or schema import |
| Flowcharts / BPMN | Flowcharts and state diagrams | **Built** / BPMN **not built** | Don't claim BPMN |
| Docs + canvas in one workspace | Pages, blocks and canvases together, with workspace search | **Built** | Depth versus Eraser not compared |
| Knowledge graph across files | Cross-canvas references (`refs`), search index, project knowledge (decisions, constraints, findings) | **Partly built** | No graph view; don't call it a knowledge graph |
| GitHub / GitLab sync | **Agent Sync**: your IDE agent keeps the architecture current; Lens shows pending changes for review | **Built** (local install) | Agent-driven by design (plan D15). Not a webhook or CI sync; don't say "live" or "automatic" |
| MCP server for assistants | Local MCP server: read and write tools (writes are proposals you review), decisions, progress, session context, revert | **Built** (local install); by-hand check with real VS Code / Claude Code still open | Demo it before claiming it. Hosted MCP is deferred |
| Hierarchy: system → components → flows → source | **Acute Lens**, L0–L5 semantic zoom with evidence | **Built** (local install) | Not in Eraser's description. Real-client check still open |
| Interview-style architecture review | **Design review** in Lens: an HLD / LLD question table with an AI verdict per question | **Built, offline-tested only: no real model has run** | **Don't market yet.** Wait for the live checks in `acute-lens-plan.md` (Phase 5b notes); the question bank is unreviewed |

### Their drawbacks, and how we answer

| Eraser drawback (as supplied) | Our position | Status |
| --- | --- | --- |
| AI hallucinations, invented or inverted links | Nothing AI makes is written without your review. AI-made links carry a confidence; generated nodes say "AI-generated, not verified"; design-review verdicts are labelled as the model's judgement | **Built**. Say "you review every change", never "no hallucinations" |
| "Wall of text" for big topologies | A visual canvas plus Lens drill-down by level, instead of one script | **Built** |
| Per-member cost scaling | We have no accounts or pricing; AI runs on the user's own subscription or key | **Unclear**: hosted is deferred, so make no pricing comparison |
| Docs-first, restrictive for freeform work | An Excalidraw whiteboard underneath: freeform works, structure is optional | **Built** |
| Security review for private repos | Acute's own AI never sees code; the IDE agent reads it on its own subscription | **Built**, with a caveat: every local MCP client shares one pairing token, so attribution is client-reported, not verified (plan D61) |

### Where we are weaker (don't hide it in a pitch)

- No screenshot-to-diagram, no cloud-vendor icon sets, no text DSL or live text editor, no BPMN.
- No hosted version, accounts or team features yet; everything here is a local install.
- Maturity: only a Copilot subscription and a Gemini key are validated; the real-client MCP check and the design review's real-model checks are still open.

### Where we are stronger

- Lens's L0–L5 hierarchy with evidence; reviewed, attributed and revertible agent changes; decisions and progress as canvas objects that agents read over MCP; the design-review table (once validated); bring-your-own-AI with no per-member inference bill.

---

## Specializations by role (same core, different use)

Status column: ✅ works today, 🟡 partly (workaround or gap), ⏳ needs planned capability. Full scoring in `ai-future-workflow-enhancements.md` Part 4.

| Role | Example use | Fit today |
| --- | --- | --- |
| **Developers** | Turn an IDE agent's investigation or design into an Architecture/Flow canvas; keep it current as the agent keeps working | 🟡 (Repo Map built, local install; client check open) |
| **Product managers** | Paste a PRD or AI brainstorm → Action Plan / Comparison; update it as requirements change | 🟡 |
| **Researchers / analysts** | Paste research notes → Concept Map / Sections; add findings over time as child explanations | 🟡 |
| **Consultants / strategy** | Problem → Cause → Solution and Decision Tree from AI analysis | 🟡 (2×2, issue trees ⏳) |
| **Founders** | Research → ICP comparison, plans, roadmaps | 🟡 (persona/roadmap templates ⏳) |
| **Students / learners** | Turn AI explanations into a concept map that grows one level at a time | 🟡 |
| **Designers / UX researchers** | Interviews → Sections/Comparison | 🟡 (persona, journey map ⏳) |
| **Eng managers / tech leads** | Incident or project write-ups → Timeline / Action Plan | 🟡 |

Planned templates that unlock more roles (CAP-07): 2×2 matrix, journey map, issue/hypothesis tree, affinity board, roadmap/swimlane, persona/ICP card, argument map, dependency graph, sequence diagram, ERD.

## Demo script (≈3 min)

1. Paste a long ChatGPT/Claude answer → `✨ Visualize` → pick **Flow** → canvas appears as editable blocks and arrows.
2. Edit one step by hand and add your own note.
3. Paste a follow-up reply that adds a step and more detail about another → **Update from new content**.
4. Show the review: one new step inserted and rewired, one child explanation, and a **conflict card** on the step you edited → **Keep mine**.
5. Accept → Undo once to show it's one step → Redo.

## Words to use / avoid

- **Use:** visual, editable, canvas, understand, review, your edits are safe, bring your own AI, local-first.
- **Avoid:** "fully automatic", "AI writes your notes for you", "works with any AI" (only Copilot and a Gemini key are validated today), "image"/"screenshot" for AI output.
