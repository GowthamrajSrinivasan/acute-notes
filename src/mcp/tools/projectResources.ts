/**
 * Phase 7B's resources and prompts (plan §7.3, D39, D49, D56): the project-scoped resources (same bounded payloads
 * as the matching read tools), the setup artifact (`acute://setup/instructions/{client}`, generated from this
 * server's live registry; `.ai/docs/agent-setup-plan.md`) and the session-loop prompts. Names are the canonical API
 * (D55, D62).
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { decisionView, decisionsOf, implementationPlan, listProjects, openQuestionsOf, resolveProject } from "@/domain/project/knowledge";
import { buildSetupInstructions, SETUP_CLIENTS, setupPromptText, type SetupClient, type SetupRegistry } from "../setup/instructions";
import { loadWorkspace, records, type ProjectToolDeps } from "./projectTools";

const JSON_MIME = "application/json";
const RESOURCE_NOT_FOUND = -32002;
const notFound = (uri: string, message = `Resource not found: ${uri}`) => new McpError(RESOURCE_NOT_FOUND, message, { uri });
const json = (uri: string, payload: unknown) => ({ contents: [{ uri, mimeType: JSON_MIME, text: JSON.stringify(payload) }] });

export const PROJECT_RESOURCE_TEMPLATES = {
  project: "acute://project/{projectKey}",
  decisions: "acute://project/{projectKey}/decisions",
  plan: "acute://project/{projectKey}/implementation-plan",
  progress: "acute://project/{projectKey}/progress",
  questions: "acute://project/{projectKey}/open-questions",
  changes: "acute://project/{projectKey}/changes",
} as const;
export const SETUP_RESOURCE_TEMPLATE = "acute://setup/instructions/{client}";

export const PROJECT_PROMPT_NAMES = ["initialize_project", "update_architecture", "sync_progress", "document_decision", "setup_project_instructions"] as const;

const variable = (v: string | string[] | undefined) => {
  const x = Array.isArray(v) ? v[0] : v;
  try {
    return x ? decodeURIComponent(x) : null;
  } catch {
    return null;
  }
};

export function registerProjectResources(server: McpServer, deps: ProjectToolDeps, registry: () => SetupRegistry): void {
  const project = async (uri: string, key: string | null) => {
    const loaded = await loadWorkspace(deps);
    const r = resolveProject(loaded.g, key ?? undefined);
    if (!key || !r.ok) throw notFound(uri, r.ok ? `Resource not found: ${uri}` : r.message);
    return { loaded, project: r.project };
  };
  const list = async () => {
    const { g } = await loadWorkspace(deps);
    return { resources: listProjects(g).map((p) => ({ uri: `acute://project/${encodeURIComponent(p.key)}`, name: p.label, mimeType: JSON_MIME })) };
  };
  const reg = (name: string, template: string, title: string, description: string, read: (uri: string, key: string | null) => Promise<unknown>, listable = false) =>
    server.registerResource(name, new ResourceTemplate(template, { list: listable ? list : undefined }), { title, description, mimeType: JSON_MIME }, async (uri, vars) =>
      json(uri.href, await read(uri.href, variable(vars.projectKey))),
    );

  reg(
    "project",
    PROJECT_RESOURCE_TEMPLATES.project,
    "Project",
    "A project (D39): its node (name, style, focus) and milestones with progress counts.",
    async (uri, key) => {
      const { loaded, project: p } = await project(uri, key);
      const plan = implementationPlan(loaded.g, p);
      return { kind: "project", project: p, milestones: plan.milestones.map((m) => ({ key: m.key, label: m.label, done: m.items.filter((i) => i.status === "done").length, total: m.items.length })) };
    },
    true,
  );
  reg("project-decisions", PROJECT_RESOURCE_TEMPLATES.decisions, "Project decisions", "The project's decisions and constraints, newest first (at most 50).", async (uri, key) => {
    const { loaded, project: p } = await project(uri, key);
    const all = decisionsOf(loaded.g, p);
    return { kind: "decisions", project: p.key, decisions: all.slice(0, 50).map(decisionView), truncated: all.length > 50 };
  });
  reg("project-plan", PROJECT_RESOURCE_TEMPLATES.plan, "Implementation plan", "Milestones in order with their progress items in order (D33).", async (uri, key) => {
    const { loaded, project: p } = await project(uri, key);
    return { kind: "implementation-plan", project: p.key, ...implementationPlan(loaded.g, p) };
  });
  reg("project-progress", PROJECT_RESOURCE_TEMPLATES.progress, "Progress", "Every progress item's status and `next` mark.", async (uri, key) => {
    const { loaded, project: p } = await project(uri, key);
    const plan = implementationPlan(loaded.g, p);
    return { kind: "progress", project: p.key, items: [...plan.milestones.flatMap((m) => m.items.map((i) => ({ ...i, milestone: m.key }))), ...plan.unassigned] };
  });
  reg("project-open-questions", PROJECT_RESOURCE_TEMPLATES.questions, "Open questions", "Open questions, risks and unvalidated findings.", async (uri, key) => {
    const { loaded, project: p } = await project(uri, key);
    return { kind: "open-questions", project: p.key, items: openQuestionsOf(loaded.g, p, ["risk", "finding"]).slice(0, 100).map((n) => ({ key: n.ref, kind: n.kind, label: n.label })) };
  });
  reg("project-changes", PROJECT_RESOURCE_TEMPLATES.changes, "Recent changes", "Accepted change records of the workspace, newest first (at most 50).", async (uri, key) => {
    const { project: p } = await project(uri, key);
    const { changes } = await records(deps);
    const accepted = changes.filter((r) => r.outcome === "accepted");
    return {
      kind: "changes",
      project: p.key,
      changes: accepted.slice(0, 50).map((r) => ({ id: r.id, title: r.title, ...(r.agent ? { agent: r.agent } : {}), tool: r.tool, at: r.at, ...(r.reason ? { reason: r.reason } : {}), revertible: r.revertible && !r.revertedBy })),
      truncated: accepted.length > 50,
    };
  });

  // The setup artifact (D49, D56; setup plan Part A).
  server.registerResource(
    "setup-instructions",
    new ResourceTemplate(SETUP_RESOURCE_TEMPLATE, { list: async () => ({ resources: SETUP_CLIENTS.map((c) => ({ uri: `acute://setup/instructions/${c}`, name: `Agent instructions (${c})`, mimeType: JSON_MIME })) }) }),
    {
      title: "Agent setup instructions",
      description: `Instructions for a coding agent to keep in its project file, generated from this server's live tools: ${SETUP_CLIENTS.join(" | ")}. Write \`content\` to \`targetPath\` (see the setup_project_instructions prompt).`,
      mimeType: JSON_MIME,
    },
    async (uri, vars) => {
      const client = variable(vars.client);
      if (!client || !(SETUP_CLIENTS as readonly string[]).includes(client)) throw notFound(uri.href, `No setup instructions for "${client ?? ""}"; use one of ${SETUP_CLIENTS.join(", ")}.`);
      const { g } = await loadWorkspace(deps);
      const projects = listProjects(g);
      const style = projects.length === 1 ? projects[0]!.style : undefined;
      return json(uri.href, buildSetupInstructions(client as SetupClient, { registry: registry(), writesAllowed: deps.policy().allowWrites, ...(style ? { style } : {}) }));
    },
  );

  // Prompts (§7.3).
  const prompt = (name: (typeof PROJECT_PROMPT_NAMES)[number], title: string, description: string, text: (args: Record<string, string | undefined>) => string, argsSchema?: z.ZodRawShape) =>
    server.registerPrompt(name, { title, description, ...(argsSchema ? { argsSchema } : {}) }, ((args: Record<string, string | undefined>) => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: text(args ?? {}) } }],
    })) as never);

  prompt(
    "initialize_project",
    "Initialize project",
    "Map the repository, then create the project and record its current state — once, when the user asks.",
    (a) =>
      [
        `Set up this repository's project in Acute Notes${a.style ? ` (style: ${a.style})` : ""}. Do not modify any code.`,
        "1. Call get_session_context to see what Acute already holds; if a project exists, stop and report it instead.",
        "2. Run the map_repo prompt to map the architecture from the code (overview first, then modules).",
        `3. Propose the project with create_project${a.style ? ` (style "${a.style}")` : " (choose modular, feature or service from how the code is organised)"}, with starterPlan if the user wants onboarding tasks.`,
        "4. Record only what the code shows or the user tells you: decisions visible in the code with record_decision (options only when real alternatives existed), current milestones and progress with update_progress, questions you can't answer from the code with log_finding.",
        "5. Leave unknown what you don't know; never invent decisions, progress, owners or dates. Finish with sync_session (summary and next).",
      ].join("\n"),
    { style: z.enum(["modular", "feature", "service", "custom"]).optional() },
  );
  prompt("update_architecture", "Update architecture", "Compare the code with the map and re-send only what changed.", () =>
    [
      "Bring the Acute architecture up to date with the code.",
      "1. Call get_map_status to see which sections are stale (their source changed since they were mapped).",
      "2. For each stale or missing section, read the code and re-send it with upsert_map_section, keeping existing keys so nodes are updated rather than replaced.",
      "3. Where the map and the code disagree in a way you can't resolve, record a finding (note: concern) with log_finding. The code is the source of truth.",
      "4. Don't touch sections that haven't changed. Finish with sync_session.",
    ].join("\n"),
  );
  prompt("sync_progress", "Sync progress", "Report this session's outcome with sync_session.", () =>
    [
      "Report this session to Acute with one sync_session call:",
      "- summary: one or two lines on what was done;",
      "- changed: the files changed, a few words each (no diffs);",
      "- decisions / findings / progress: durable knowledge from this session not yet recorded (nothing transient, no logs);",
      "- architecture: map sections whose structure changed and that you haven't sent yet, each as upsert_map_section's input (when the repo-map tools are available);",
      "- next: what the following session should pick up.",
      "Only record what you verified; leave unknown what you don't know.",
    ].join("\n"),
  );
  prompt(
    "document_decision",
    "Document decision",
    "Turn a discussion into a recorded decision with its options.",
    (a) =>
      [
        `Record the decision${a.topic ? ` about "${a.topic}"` : ""} that was just discussed, with record_decision:`,
        "- statement: the decision in one line; reason: why, in one line;",
        "- options: the real alternatives considered, with their tradeoffs; chosen: only if the user chose one;",
        "- refs: the keys of the architecture nodes it concerns (get_session_context or get_lens_impact can find them);",
        "- kind constraint, or enforce, only if the user said it must always hold.",
        "If no real alternative was weighed, don't record a decision.",
      ].join("\n"),
    { topic: z.string().optional() },
  );
  prompt(
    "setup_project_instructions",
    "Set up project instructions",
    `Write the Acute Notes agent instructions into this repository's ${SETUP_CLIENTS.join(" / ")} file (client defaults to claude).`,
    (a) => setupPromptText((SETUP_CLIENTS as readonly string[]).includes(a.client ?? "") ? (a.client as SetupClient) : "claude"),
    { client: z.enum(SETUP_CLIENTS).optional() },
  );
}
