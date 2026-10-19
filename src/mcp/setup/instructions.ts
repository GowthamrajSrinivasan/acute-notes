/**
 * The agent-facing setup artifact (plan D49, D55, D56; `.ai/docs/agent-setup-plan.md` Part A, approved 2026-10-03):
 * one shared core text, three thin client wrappers (Claude Code → `CLAUDE.md`, Codex → `AGENTS.md`, Cursor →
 * `.cursor/rules/acute-notes.mdc`; conventions verified against each client's documentation, Q1), generated per
 * call from the server's live registry.
 *
 * - Tool, prompt and resource names in the text are placeholders (`{{tool:get_session_context}}`) resolved against what
 *   is registered; an unregistered name throws (S2), so the artifact can't name a tool that doesn't exist (MC11 b).
 * - With writes off, the write tools are left out and the writing sections become one read-only paragraph (S3).
 * - The block is fenced so re-running setup replaces only Acute's part of the user's file (S4).
 * - At most `SETUP_LIMITS.chars` characters (S5).
 * Pure: no server, no I/O.
 */
import type { ProjectStyle } from "@/domain/canvas/nodeProject";
import { TEMPLATE_L1 } from "@/domain/project/projectChanges";

export const SETUP_CLIENTS = ["claude", "codex", "cursor"] as const;
export type SetupClient = (typeof SETUP_CLIENTS)[number];

export const SETUP_LIMITS = { chars: 7_000 } as const;
export const SETUP_FENCE = { start: "<!-- acute-notes:start -->", end: "<!-- acute-notes:end -->" } as const;
export const MCP_SERVER_KEY = "acute-notes";

export class SetupInstructionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupInstructionsError";
  }
}

export interface SetupRegistry {
  tools: readonly string[];
  /** The write tools among `tools` (left out when writes are off). */
  writeTools: readonly string[];
  prompts: readonly string[];
  /** Resource URIs or templates as served (`acute://context/current`, `acute://project/{projectKey}`, …). */
  resources: readonly string[];
}

export interface SetupArtifact {
  client: SetupClient;
  targetPath: string;
  format: "markdown" | "mdc";
  content: string;
  toolCount: number;
  generatedFrom: { writesAllowed: boolean; style?: ProjectStyle };
}

const WRAPPERS: Record<SetupClient, { targetPath: string; format: "markdown" | "mdc"; preamble: string; callNote: string; frontmatter?: string }> = {
  claude: {
    targetPath: "CLAUDE.md",
    format: "markdown",
    preamble: "Applies to every task in this repository.",
    callNote: `The tools appear prefixed with the server name (e.g. \`mcp__${MCP_SERVER_KEY}__get_session_context\`); this file uses bare names.`,
  },
  codex: {
    targetPath: "AGENTS.md",
    format: "markdown",
    preamble: "Applies to every task in this repository.",
    callNote: `The tools come from the \`${MCP_SERVER_KEY}\` MCP server; this file uses their bare names.`,
  },
  cursor: {
    targetPath: ".cursor/rules/acute-notes.mdc",
    format: "mdc",
    preamble: "Applies to every task in this repository.",
    callNote: `The tools come from the \`${MCP_SERVER_KEY}\` MCP server; this file uses their bare names.`,
    frontmatter: '---\ndescription: "Acute Notes project memory: when and how to read and record it"\nalwaysApply: true\n---\n',
  },
};

/** The `{{toolList}}` groups: each tool's short purpose, fixed here rather than read from descriptions (they're long). */
const GROUPS: { name: string; items: [string, string?][] }[] = [
  { name: "Session", items: [["get_session_context", "bootstrap a task"], ["sync_session", "report a session's outcome"]] },
  { name: "Project", items: [["get_project"], ["list_projects"], ["create_project"], ["get_implementation_plan"], ["update_progress"]] },
  { name: "Knowledge", items: [["get_decisions"], ["record_decision"], ["get_open_questions"], ["log_finding"], ["update_knowledge"], ["annotate"]] },
  { name: "History", items: [["get_recent_changes"], ["get_session_history"], ["get_session_review"], ["revert_agent_changes"]] },
  { name: "Impact", items: [["get_lens_impact", "what a change to keys or paths affects, and the warnings that protect it"], ["get_lens"], ["trace_lens_path"], ["focus_lens"], ["link_lens_detail"]] },
  { name: "Workspace", items: [["search_workspace"], ["get_canvas"], ["get_page"], ["get_selected_content"], ["get_related_objects"], ["list_blocks"], ["get_block"]] },
  {
    name: "Canvas",
    items: [["create_block"], ["create_page"], ["create_table"], ["create_todo"], ["create_connection"], ["update_connection"], ["delete_connection"], ["move_object"], ["update_block"], ["render_visual_plan"], ["delete_object"], ["group_blocks"]],
  },
  { name: "Repo map", items: [["begin_repo_map"], ["upsert_map_section"], ["link_map_nodes"], ["get_map_status"], ["remove_map_nodes"], ["tidy_map_section"]] },
];

/** The approved core text (setup plan §A2). Section headings are stable: MC11 asserts them. */
const CORE_HEAD = `## Acute Notes (project memory and architecture, over MCP)

### What it is
Acute Notes is this project's shared, human-reviewed memory: its architecture (frames of components and how they
relate, drilled from system level down to source in Lens), its decisions and constraints, findings, risks, open
questions, milestones and progress. You reach it through the \`${MCP_SERVER_KEY}\` MCP server. Everything you write is a
proposal the user reviews on their canvas; nothing changes until they accept it (unless they turned on auto-accept
for your session, and even then removals, reverts, constraints and enforced decisions wait for them).

### When to use it
- At the start of any non-trivial task, and when resuming earlier work.
- Before changing code that touches an area Acute documents, to see the decisions and constraints that protect it.
- When you make or discover something a later session would need: a decision, a constraint, a finding, a risk, an
  open question, a change of plan or progress.
- At the end of a session, once.
Skip it for trivial, self-contained edits that change no structure and need no recorded reasoning.

### Start of a session
1. Call {{tool:get_session_context}} with \`task\` (one line: what you are about to do) and, when you know them,
   \`paths\` (files you expect to change) and \`keys\` (Lens keys). Keep the default budget unless you need more.
2. Read \`warnings\` first, then the project's focus and the previous session's \`next\`.
3. If it reports no project, ask the user before running the {{prompt:initialize_project}} prompt; never create a
   project on your own initiative.
4. If \`retrieval_mode\` is degraded, treat the context as incomplete and say so when it matters.

### Warnings (constraints and enforced decisions)
A warning is a recorded constraint, or an enforced decision, on something in scope. Do not act against one. If the
task genuinely needs to, stop and ask the user.{{if:tool:record_decision}} If they agree, record the exception with {{tool:record_decision}}
using \`deviatesFrom\` and a one-line reason, so the original stays in force everywhere else.{{/if}} Do not re-propose what
\`recentRejections\` shows the user declined.
`;

const CORE_WRITE = `
### What to record (and what not to)
Record durable knowledge only:
- a decision between real alternatives that later work must respect: {{tool:record_decision}} (with \`options\` when
  the user should choose; \`constraint\` only when the user says it must always hold);
- a non-obvious finding, hypothesis, assumption or concern; an open question that needs a human; a risk:
  {{tool:log_finding}};
- progress at milestone or task granularity, and the next step: {{tool:update_progress}};
- a change of status (finding validated, question answered, decision superseded): {{tool:update_knowledge}};
{{if:tool:upsert_map_section}}- a change to the architecture's structure (a component, a boundary, a relationship): the repo-map tools
  ({{tool:upsert_map_section}});
{{/if}}- a note on a specific node for the user: {{tool:annotate}}.
Never record: your reasoning or chain of thought, command or test output, logs, every file you edited, routine
refactors, restatements of the code, secrets, or speculation presented as fact. Keep each record to a short line;
put longer write-ups on a page ({{tool:create_page}}) and reference it.

### End of a session
Call {{tool:sync_session}} once with a short \`summary\`, the \`changed\` paths (with a few words each), any decisions,
findings and progress from this session that you haven't recorded yet, and \`next\` (what the following session
should pick up). It produces ordinary proposals for the user's review. Do not call it after every step.
{{if:tool:upsert_map_section}}Map sections whose structure changed and that you haven't sent yet can go in its \`architecture\`, each
as {{tool:upsert_map_section}}'s input.
{{/if}}`;

const CORE_READ_ONLY = `
### Read-only workspace
This workspace is read-only for agents. Use the read tools only; when you would have recorded something, tell the
user instead.
`;

const CORE_CONFLICT = `
### When Acute and the code disagree
The code and the repository are the source of truth; Acute is the documented understanding of them. When they
conflict, trust the code, do not change code to match Acute, and record the divergence: a finding (\`concern\`) on the
affected node, or a repo-map update if the structure has changed. Tell the user what you found.
`;

const CORE_REFUSED = `
### When a proposal is refused
If a write fails because the user is reviewing your previous proposal, or another session's proposal changes the
same objects, stop and tell the user; do not retry in a loop or route around it with other tools.
`;

const CORE_NEVER = `
### Never fabricate project state
Record only what you observed in the code, were told by the user, or decided with them. Never invent decisions,
progress, components, owners, dates or test results. If you are unsure, record an open question or a hypothesis,
not a fact. Mark nothing done that you have not verified.
`;

function toolList(registry: SetupRegistry, writesAllowed: boolean): { text: string; count: number } {
  const writes = new Set(registry.writeTools);
  const available = new Set(registry.tools.filter((t) => writesAllowed || !writes.has(t)));
  const listed = new Set<string>();
  const lines: string[] = [];
  for (const g of GROUPS) {
    const items = g.items.filter(([t]) => available.has(t));
    if (!items.length) continue;
    for (const [t] of items) listed.add(t);
    lines.push(`- ${g.name}: ${items.map(([t, why]) => `\`${t}\`${writes.has(t) ? " (write)" : ""}${why ? ` — ${why}` : ""}`).join(" · ")}`);
  }
  // A registered tool no group names still appears (the list is the registry, not this table).
  const rest = [...available].filter((t) => !listed.has(t)).sort();
  if (rest.length) lines.push(`- Other: ${rest.map((t) => `\`${t}\`${writes.has(t) ? " (write)" : ""}`).join(" · ")}`);
  const resources = registry.resources.filter((r) => r !== "acute://setup/instructions/{client}");
  if (resources.length) lines.push(`- Resources: ${resources.map((r) => `\`${r}\``).join(" · ")}`);
  const prompts = registry.prompts.filter((p) => p !== "setup_project_instructions" || writesAllowed);
  if (prompts.length) lines.push(`- Prompts: ${prompts.map((p) => `\`${p}\``).join(" · ")}`);
  return { text: lines.join("\n"), count: available.size };
}

/**
 * Resolves the text's placeholders against the registry (S2): `{{if:tool:x}}…{{/if}}` keeps its body only when `x` is
 * served (an optional tool group, like the repo-map tools, which a server has only with its store); then
 * `{{tool:x}}` / `{{prompt:x}}` / `{{resource:x}}` become `x`, throwing when `x` isn't served.
 */
function resolvePlaceholders(text: string, registry: SetupRegistry, writesAllowed: boolean): string {
  const writes = new Set(registry.writeTools);
  const serves = (kind: string, name: string) =>
    kind === "tool" ? registry.tools.includes(name) && (writesAllowed || !writes.has(name)) : kind === "prompt" ? registry.prompts.includes(name) : registry.resources.includes(name);
  const conditioned = text.replace(/\{\{if:(tool|prompt|resource):([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, kind: string, name: string, body: string) => (serves(kind, name) ? body : ""));
  return conditioned.replace(/\{\{(tool|prompt|resource):([^}]+)\}\}/g, (_m, kind: string, name: string) => {
    if (!serves(kind, name)) {
      const why = kind === "tool" && writes.has(name) && !writesAllowed && registry.tools.includes(name) ? " with writes off" : "";
      throw new SetupInstructionsError(`The setup text names ${kind} "${name}", which this server doesn't serve${why}.`);
    }
    return `\`${name}\``;
  });
}

export function buildSetupInstructions(client: SetupClient, input: { registry: SetupRegistry; writesAllowed: boolean; style?: ProjectStyle }): SetupArtifact {
  const wrapper = WRAPPERS[client];
  const { registry, writesAllowed } = input;
  const styleLine = input.style ? TEMPLATE_L1[input.style].line : undefined;
  const list = toolList(registry, writesAllowed);
  const body = [
    CORE_HEAD,
    writesAllowed ? CORE_WRITE : CORE_READ_ONLY,
    CORE_CONFLICT,
    writesAllowed ? CORE_REFUSED : "",
    CORE_NEVER,
    styleLine ? `\n### This project\n${styleLine}\n` : "",
    `\n### Available tools, resources and prompts\n${wrapper.callNote}\n${list.text}\n`,
  ].join("");
  const text = resolvePlaceholders(body, registry, writesAllowed);
  const content = `${wrapper.frontmatter ?? ""}${SETUP_FENCE.start}\n${wrapper.preamble}\n\n${text.trim()}\n${SETUP_FENCE.end}\n`;
  if (content.length > SETUP_LIMITS.chars) throw new SetupInstructionsError(`The ${client} setup text is ${content.length} characters; the budget is ${SETUP_LIMITS.chars}.`);
  return { client, targetPath: wrapper.targetPath, format: wrapper.format, content, toolCount: list.count, generatedFrom: { writesAllowed, ...(input.style ? { style: input.style } : {}) } };
}

/** `setup_project_instructions`' message: fetch the artifact, write only the fenced block, show the user the diff. */
export function setupPromptText(client: SetupClient): string {
  const w = WRAPPERS[client];
  return [
    `Set up this repository for Acute Notes (${client}).`,
    `1. Read the resource acute://setup/instructions/${client}. Its \`content\` is a block fenced by ${SETUP_FENCE.start} and ${SETUP_FENCE.end}.`,
    `2. In the repository root, open ${w.targetPath} (create it if it doesn't exist${w.format === "mdc" ? ", with the frontmatter the content starts with" : ""}).`,
    `3. If the file already contains that fence, replace only what is between the markers (markers included); otherwise append the block. Change nothing else in the file.`,
    `4. Show the user the diff and wait for their go-ahead before saving. Don't create a project or record anything as part of this.`,
  ].join("\n");
}
