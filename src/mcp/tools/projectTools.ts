/**
 * The Project-profile MCP tools (plan §7.3, Phase 7B; D27, D29–D39, D44–D48, D53, D54): project knowledge, the
 * session loop (`get_session_context` → work → `sync_session`), Agent State reads and revert, and the data-only
 * `get_lens_impact`. Names are the canonical API (D55, D62): no aliases.
 *
 * - **Reads** build the workspace graph from every canvas (the open one live, the others as persisted), through the
 *   pure readers in `domain/project/` (D41). Bounded; `truncated` says when something was cut.
 * - **Writes** go through the one write path (`proposeChangeSet`): a reviewed change set in this MCP session's slot
 *   (D6, D40), attributed (D32), with a required one-line `reason`. Project-knowledge nodes are created in the
 *   project's Project state frame, which must be on the open canvas (writes only ever propose on the open canvas).
 * - `sync_session` writes its report's `summary`, `changed` and `next` on the session record (Agent State, D38) — the
 *   canvas changes it implies are an ordinary proposal like any other.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { planRevert, type AgentChangeRecord, type AgentSessionRecord } from "@/ai/changes/agentState";
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { getArrowRelation } from "@/domain/canvas/adapter";
import type { NodePatch } from "@/domain/canvas/nodePatch";
import {
  DECISION_STATUSES,
  FINDING_NOTES,
  PROGRESS_STATUSES,
  PROJECT_LIMITS,
  PROJECT_STYLES,
  RISK_SEVERITIES,
  ANNOTATION_INTENTS,
  type ProjectKind,
} from "@/domain/canvas/nodeProject";
import { impactOf, nodesCitingChanges, nodesCitingPaths, riskOf } from "@/domain/project/impact";
import {
  annotationsOn,
  decisionView,
  decisionsOf,
  implementationPlan,
  listProjects,
  openQuestionsOf,
  projectMembers,
  resolveProject,
  scopeAddresses,
  warningsFor,
  type ProjectRef,
} from "@/domain/project/knowledge";
import { addProjectNodes, projectTemplate, type NewProjectNode, type PlacedShape } from "@/domain/project/projectChanges";
import { SessionContextAborted, sessionContext, SESSION_CONTEXT_BUDGET } from "@/domain/project/sessionContext";
import { sessionReview } from "@/domain/project/sessionReview";
import { buildWorkspaceGraph, resolve, type GraphNode, type WorkspaceGraph } from "@/domain/project/workspaceGraph";
import type { DocumentRecord } from "@/domain/types";
import type { AgentStateRepository } from "@/persistence/repositories/types";
import type { CurrentContext } from "../context/currentContext";
import type { WorkspaceScan } from "../resources/workspaceScan";
import { guarded, READ_ANNOTATIONS, ToolFailure, toolResult, WRITE_ANNOTATIONS, type ToolPolicy } from "./common";
import type { LiveCanvasActions } from "./liveCanvas";
import type { MapSectionWriter } from "./repoMap";
import { SECTION_SHAPE } from "./repoMap/schema";
import { MESSAGES, PROPOSED_SHAPE, proposeChangeSet, sanitizeClientName, type WriteToolDeps } from "./writeTools";

export const PROJECT_READ_TOOLS = [
  "get_project",
  "list_projects",
  "get_decisions",
  "get_open_questions",
  "get_implementation_plan",
  "get_session_context",
  "get_recent_changes",
  "get_session_history",
  "get_session_review",
  "get_lens_impact",
] as const;
export const PROJECT_WRITE_TOOLS = ["create_project", "record_decision", "log_finding", "update_knowledge", "annotate", "update_progress", "sync_session", "revert_agent_changes"] as const;
export const PROJECT_TOOL_NAMES = [...PROJECT_READ_TOOLS, ...PROJECT_WRITE_TOOLS] as const;

/** At most this many canvases are read into the workspace graph per call. */
export const PROJECT_LIMITS_MCP = { canvases: 100, decisions: 50, changes: 50, sessions: 20, changedEntries: 50, nextEntries: 10 } as const;

export interface ProjectToolDeps {
  workspaceId: string;
  scan: WorkspaceScan;
  liveCanvas(): LiveCanvasActions | null;
  policy(): ToolPolicy;
  clientName(): string | undefined;
  sessionId(): string;
  /** Agent State (D31). Without it, the history tools answer empty and `sync_session` can't store its report. */
  agentState?: AgentStateRepository;
  /** The open tab's context, for the focus fallback (D37). */
  currentContext(): Promise<CurrentContext | null>;
  parseMarkdown?: WriteToolDeps["parseMarkdown"];
  /** `upsert_map_section`'s writer, for `sync_session`'s `architecture` (D38); absent when the repo-map tools aren't served. */
  upsertMapSection?: MapSectionWriter;
}

/** Full sections one `sync_session` may send (each up to `upsert_map_section`'s request size). */
const SYNC_SECTIONS_MAX = 10;

type SectionOutcome = { sectionKey: string; status: string; reason?: string; message?: string };

/** One `architecture` entry's result, from what `upsert_map_section` returned for it. */
function sectionOutcome(sectionKey: string, res: CallToolResult): SectionOutcome {
  const texts = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? "");
  if (!res.isError) return { sectionKey, status: String((res.structuredContent as { status?: unknown } | undefined)?.status ?? "staged") };
  try {
    const payload = JSON.parse(texts[1] ?? "") as { status?: string; reason?: string; message?: string };
    if (payload.status === "rejected") return { sectionKey, status: "rejected", ...(payload.reason ? { reason: payload.reason } : {}), message: payload.message ?? texts[0]! };
  } catch {
    // A plain tool error: its text says why.
  }
  return { sectionKey, status: "error", message: texts[0] ?? "" };
}

// ---------------------------------------------------------------------------
// Reading the workspace
// ---------------------------------------------------------------------------

export interface Loaded {
  g: WorkspaceGraph;
  canvases: { canvasId: string; title: string; elements: readonly SceneElement[] }[];
  /** Cards' and previews' documents: the open canvas's live, the others' as persisted. */
  getDocument: (id: string) => DocumentRecord | undefined;
}

/** Every canvas of the workspace, the open one live, as one graph. */
export async function loadWorkspace(deps: ProjectToolDeps): Promise<Loaded> {
  const live = deps.liveCanvas();
  const open = live && live.workspaceId === deps.workspaceId ? live : null;
  const list = await deps.scan.canvases(PROJECT_LIMITS_MCP.canvases);
  const canvases: Loaded["canvases"] = [];
  for (const c of list) canvases.push({ canvasId: c.id, title: c.title, elements: open && c.id === open.canvasId ? open.elements() : await deps.scan.scene(c.id) });
  if (open && !canvases.some((c) => c.canvasId === open.canvasId)) canvases.push({ canvasId: open.canvasId, title: "", elements: open.elements() });
  // Cards' documents (their titles, and the map identity a Repo Map card carries, D21): the open canvas's from its
  // own lookup, the others' as persisted.
  const embedded = canvases.flatMap((c) => c.elements.flatMap((el) => {
    const ref = el.isDeleted ? null : getEmbedRef(el);
    return ref?.kind === "rich-block" ? [ref.documentId] : ref?.kind === "page-preview" ? [ref.pageId] : [];
  }));
  const docs = embedded.length ? await deps.scan.documents(embedded) : new Map();
  const getDocument = (id: string) => open?.getDocument?.(id) ?? docs.get(id);
  return { g: buildWorkspaceGraph(canvases.map((c) => ({ ...c, getDocument }))), canvases, getDocument };
}

function projectOrFail(g: WorkspaceGraph, wanted: string | undefined): ProjectRef {
  const r = resolveProject(g, wanted);
  if (!r.ok) throw new ToolFailure(r.message);
  return r.project;
}

export async function records(deps: ProjectToolDeps): Promise<{ changes: AgentChangeRecord[]; sessions: AgentSessionRecord[] }> {
  if (!deps.agentState) return { changes: [], sessions: [] };
  const [changes, sessions] = await Promise.all([deps.agentState.listChanges(deps.workspaceId), deps.agentState.listSessions(deps.workspaceId)]);
  return { changes: changes.sort((a, b) => b.at - a.at), sessions: sessions.sort((a, b) => (b.lastWriteAt ?? b.startedAt) - (a.lastWriteAt ?? a.startedAt)) };
}

/**
 * Pages nodes link to through an arrow (`explained_by` / `references` to a page preview), with their titles (D48):
 * a lookup from node ids to the pages they link to. Titles are read once, for at most 50 linked pages.
 */
async function pageLinks(deps: ProjectToolDeps, loaded: Loaded): Promise<(nodeIds: readonly string[]) => { id: string; title: string }[]> {
  const byNode = new Map<string, Set<string>>();
  const pageIds = new Set<string>();
  for (const c of loaded.canvases) {
    const byId = new Map(c.elements.map((e) => [e.id, e] as const));
    for (const el of c.elements) {
      if (el.isDeleted || el.type !== "arrow") continue;
      const rel = getArrowRelation(el);
      if (rel !== "explained_by" && rel !== "references") continue;
      const a = el.startBinding?.elementId;
      const b = el.endBinding?.elementId;
      for (const [from, to] of [[a, b], [b, a]] as const) {
        if (!from || !to) continue;
        const ref = byId.get(to) && getEmbedRef(byId.get(to)!);
        if (ref?.kind !== "page-preview") continue;
        pageIds.add(ref.pageId);
        if (!byNode.has(from)) byNode.set(from, new Set());
        byNode.get(from)!.add(ref.pageId);
      }
    }
  }
  const docs = pageIds.size ? await deps.scan.documents([...pageIds].slice(0, 50)) : new Map<string, { id: string; title: string }>();
  return (nodeIds) => {
    const ids = new Set(nodeIds.flatMap((n) => [...(byNode.get(n) ?? [])]));
    return [...ids].flatMap((id) => {
      const d = docs.get(id);
      return d ? [{ id: d.id, title: d.title.trim() || "Untitled" }] : [];
    });
  };
}

// ---------------------------------------------------------------------------
// Proposing project knowledge
// ---------------------------------------------------------------------------

const reason = z.string().trim().min(1).max(500).describe("One line: why (kept with the change in the agent log, D32).");
const addressList = z.array(z.string().trim().min(1).max(PROJECT_LIMITS.key)).max(PROJECT_LIMITS.refs);
const projectArg = z.string().trim().min(1).max(PROJECT_LIMITS.key).optional().describe("The project's key; defaults to the workspace's only project.");
const label = z.string().trim().min(1).max(200);

/** The Project state frame of `project` on the open canvas, and its members; a `ToolFailure` naming the canvas otherwise. */
function stateFrame(loaded: Loaded, live: LiveCanvasActions, project: ProjectRef): { frameId: string; frame: { x: number; y: number; width: number; height: number }; members: PlacedShape[] } {
  const elements = live.elements();
  const projectEl = elements.find((e) => e.id === project.elementId && !e.isDeleted);
  const frame = projectEl?.frameId ? elements.find((e) => e.id === projectEl.frameId && e.type === "frame" && !e.isDeleted) : undefined;
  if (!frame) {
    const where = loaded.canvases.find((c) => c.canvasId === project.canvasId)?.title;
    throw new ToolFailure(
      projectEl
        ? `The project node "${project.label}" isn't in a frame on this canvas; nothing was proposed.`
        : `Project "${project.label}" lives on ${where ? `canvas "${where}"` : "another canvas"} (${project.canvasId}); ask the user to open it. Changes can only be proposed on the open canvas.`,
    );
  }
  const members = elements
    .filter((e) => !e.isDeleted && e.frameId === frame.id && (e.type === "rectangle" || e.type === "ellipse" || e.type === "diamond"))
    .map((e) => ({ x: e.x, y: e.y, kind: (e.customData?.acuteNode as { kind?: string } | undefined)?.kind }));
  return { frameId: frame.id, frame: { x: frame.x, y: frame.y, width: frame.width, height: frame.height }, members };
}

/** Every key already in the workspace (new keys must be unique, D53). */
const takenKeys = (g: WorkspaceGraph) => new Set(g.nodes.flatMap((n) => (n.key ? [n.key] : [])));

/** Refs that name nothing (kept and reported, D53 (4)). */
const unresolvedOf = (g: WorkspaceGraph, refs: readonly string[] = []) => refs.filter((r) => !resolve(g, r));

/** A node by key or id that must be on the open canvas for an update. */
function liveNode(g: WorkspaceGraph, live: LiveCanvasActions, address: string, kinds?: readonly string[]): GraphNode {
  const n = resolve(g, address);
  if (!n || n.what !== "node") throw new ToolFailure(`No node "${address}" in this workspace.`);
  if (g.ambiguous.has(address)) throw new ToolFailure(`The key "${address}" is on more than one node; use its id instead.`);
  if (kinds && (!n.kind || !kinds.includes(n.kind))) throw new ToolFailure(`"${n.label}" is a ${n.kind ?? "plain node"}, not ${kinds.join(" / ")}.`);
  if (n.canvasId !== live.canvasId) throw new ToolFailure(`"${n.label}" is on another canvas (${n.canvasId}); ask the user to open it. Changes can only be proposed on the open canvas.`);
  return n;
}

export function registerProjectTools(server: McpServer, deps: ProjectToolDeps): void {
  const client = () => sanitizeClientName(deps.clientName());
  const writeDeps: WriteToolDeps = {
    workspaceId: deps.workspaceId,
    liveCanvas: deps.liveCanvas,
    policy: deps.policy,
    clientName: deps.clientName,
    sessionId: deps.sessionId,
    ...(deps.parseMarkdown ? { parseMarkdown: deps.parseMarkdown } : {}),
  };
  const title = (what: string) => `${client() ?? "MCP"}: ${what}`.slice(0, 200);
  const meta = (task: string): ChangeSet["metadata"] => ({ createdBy: "mcp", task, ...(client() ? { provider: client()! } : {}) });

  const read = <S extends z.ZodRawShape>(name: (typeof PROJECT_READ_TOOLS)[number], t: string, description: string, inputSchema: S, run: (args: z.infer<z.ZodObject<S>>, signal?: AbortSignal) => Promise<ReturnType<typeof toolResult>>) =>
    server.registerTool(name, { title: t, description, inputSchema, annotations: READ_ANNOTATIONS }, ((args: z.infer<z.ZodObject<S>>, extra?: { signal?: AbortSignal }) =>
      guarded(() => run(args, extra?.signal))) as never);

  const write = <S extends z.ZodRawShape>(
    name: (typeof PROJECT_WRITE_TOOLS)[number],
    t: string,
    description: string,
    inputSchema: S,
    run: (args: z.infer<z.ZodObject<S>>) => Promise<ReturnType<typeof toolResult>>,
    outputSchema: z.ZodRawShape = { ...PROPOSED_SHAPE, keys: z.array(z.string()).optional() },
  ) =>
    server.registerTool(
      name,
      {
        title: t,
        description: `${description} Proposes a change for the user's review; nothing changes until they accept it (or the user turned on auto-accept for this session).`,
        inputSchema,
        outputSchema,
        annotations: WRITE_ANNOTATIONS,
      },
      ((args: z.infer<z.ZodObject<S>>) => guarded(() => run(args))) as never,
    );

  /**
   * Proposes new project nodes (and any extra changes) in the project's state frame on the open canvas. `extraChanges`
   * may reference the new nodes as `{ created: "n<i>" }` (their index in `nodes`).
   */
  const proposeNodes = (
    tool: string,
    args: { project?: string; reason: string } & Record<string, unknown>,
    what: string,
    build: (loaded: Loaded, live: LiveCanvasActions, project: ProjectRef) => { nodes: NewProjectNode[]; extra?: ProposedChange[]; warnings?: string[] },
  ) =>
    proposeChangeSet(writeDeps, args, async (live, operationId) => {
      const loaded = await loadWorkspace(deps);
      const project = projectOrFail(loaded.g, args.project);
      const { frameId, frame, members } = stateFrame(loaded, live, project);
      const spec = build(loaded, live, project);
      const { changes, keys } = addProjectNodes({ frameId, frame, members, nodes: spec.nodes.map((n) => ({ ...n, fields: { project: project.key, ...n.fields } })), taken: takenKeys(loaded.g), keyBase: project.key });
      return {
        set: { operationId, title: title(what), metadata: meta(tool), reason: args.reason, changes: [...changes, ...(spec.extra ?? [])] },
        warnings: spec.warnings ?? [],
        extra: { keys },
      };
    });

  // ---- Project -------------------------------------------------------------

  read("get_project", "Get project", "The project node (name, style, focus), its milestones with progress counts, and the previous session's `next` (D38). With no project yet, says so. Bounded.", { project: projectArg }, async (args) => {
    const loaded = await loadWorkspace(deps);
    const r = resolveProject(loaded.g, args.project);
    if (!r.ok) return toolResult(r.message, { project: null, reason: r.reason, message: r.message, projects: r.projects.map((p) => p.key) });
    const plan = implementationPlan(loaded.g, r.project);
    const { sessions } = await records(deps);
    const previous = sessions.find((s) => s.id !== deps.sessionId() && s.next?.length);
    const milestones = plan.milestones.map((m) => ({ key: m.key, label: m.label, done: m.items.filter((i) => i.status === "done").length, total: m.items.length }));
    const payload = { project: r.project, milestones, unassigned: plan.unassigned.length, ...(previous?.next ? { lastNext: previous.next } : {}) };
    return toolResult(`Project "${r.project.label}" (${r.project.style ?? "no style"}): ${milestones.length} milestones.`, payload);
  });

  read("list_projects", "List projects", "Every project in this workspace (D39): key, name, style, focus, canvas.", {}, async () => {
    const projects = listProjects((await loadWorkspace(deps)).g);
    return toolResult(`${projects.length} project${projects.length === 1 ? "" : "s"}.`, { projects });
  });

  write(
    "create_project",
    "Create project",
    "Proposes a new project from a workspace template (setup plan Part B): a `project` node in a Project state frame and one empty L1 architecture frame named for the style — structure only, never invented architecture, decisions or progress. `starterPlan` adds one onboarding milestone with three not-started tasks. Only when the user asked for a project.",
    { name: label, style: z.enum(PROJECT_STYLES), focus: z.string().trim().min(1).max(PROJECT_LIMITS.focus).optional(), starterPlan: z.boolean().optional(), reason },
    (args) =>
      proposeChangeSet(writeDeps, args, async (live, operationId) => {
        const { g } = await loadWorkspace(deps);
        if (listProjects(g).some((p) => p.label.toLowerCase() === args.name.toLowerCase())) throw new ToolFailure(`A project named "${args.name}" already exists (list_projects).`);
        const boxes = live.renderContext().existing;
        const at = boxes.length ? { x: Math.max(...boxes.map((b) => b.x + b.width)) + 160, y: Math.min(...boxes.map((b) => b.y)) } : { x: 0, y: 0 };
        const t = projectTemplate({ name: args.name, style: args.style, ...(args.focus ? { focus: args.focus } : {}), ...(args.starterPlan ? { starterPlan: true } : {}), at, taken: takenKeys(g) });
        return { set: { operationId, title: title(`Create project "${args.name}"`), metadata: meta("create_project"), reason: args.reason, changes: t.changes }, warnings: [], extra: { keys: [t.projectKey] } };
      }),
  );

  // ---- Decisions -------------------------------------------------------------

  write(
    "record_decision",
    "Record decision",
    "Proposes a decision or constraint (D33–D36): a one-line statement, why, optional options and the chosen one (D34: a proposed decision with options and no choice is a question for the user), `enforce` to raise it as a warning to later agents, `refs` (keys or ids of the nodes it concerns, on any canvas, D53), and `supersedes` / `deviatesFrom` (D45). A constraint is only for a rule the user says must always hold. Record decisions between real alternatives only — not reasoning, not routine choices.",
    {
      statement: label,
      kind: z.enum(["decision", "constraint"]).optional(),
      status: z.enum(DECISION_STATUSES).optional(),
      reason,
      options: z.array(z.object({ label: z.string().trim().min(1).max(PROJECT_LIMITS.optionLabel), tradeoffs: z.string().trim().max(PROJECT_LIMITS.tradeoffs).optional() })).max(PROJECT_LIMITS.options).optional(),
      chosen: z.string().trim().min(1).max(PROJECT_LIMITS.optionLabel).optional(),
      enforce: z.boolean().optional(),
      refs: addressList.optional(),
      supersedes: addressList.optional(),
      deviatesFrom: addressList.optional(),
      project: projectArg,
    },
    (args) =>
      proposeNodes("record_decision", args, `Record decision "${args.statement.slice(0, 60)}"`, (loaded, live) => {
        const kind = args.kind ?? "decision";
        if (args.chosen && !args.options?.some((o) => o.label === args.chosen)) throw new ToolFailure(`"chosen" must be one of the options' labels.`);
        if (kind === "constraint" && args.enforce !== undefined) throw new ToolFailure("`enforce` is for decisions; a constraint always raises a warning.");
        const status = args.status ?? (kind === "constraint" ? "accepted" : args.chosen ? "accepted" : "proposed");
        const fields: NodePatch = {
          status,
          reason: args.reason,
          ...(args.options?.length ? { options: args.options } : {}),
          ...(args.chosen ? { chosen: args.chosen } : {}),
          ...(args.enforce ? { enforce: true } : {}),
          ...(args.refs?.length ? { refs: args.refs } : {}),
          ...(args.supersedes?.length ? { supersedes: args.supersedes } : {}),
          ...(args.deviatesFrom?.length ? { deviatesFrom: args.deviatesFrom } : {}),
        };
        const extra: ProposedChange[] = [];
        const warnings: string[] = [];
        const linked = (list: readonly string[] | undefined, relation: "supersedes" | "deviates_from") => {
          for (const address of list ?? []) {
            const t = resolve(loaded.g, address);
            if (!t || t.what !== "node" || (t.kind !== "decision" && t.kind !== "constraint")) {
              warnings.push(`${relation === "supersedes" ? "supersedes" : "deviatesFrom"} "${address}" isn't a decision or constraint in this workspace; kept as written.`);
              continue;
            }
            if (t.canvasId === live.canvasId) {
              extra.push({ kind: "connect", key: `${relation}:${t.id}`, from: { created: "n0" }, to: { existing: t.id }, relation });
              if (relation === "supersedes" && t.project?.status !== "superseded") extra.push({ kind: "update_node", target: t.id, semantics: { status: "superseded" } });
            } else if (relation === "supersedes") warnings.push(`"${t.label}" is on another canvas: it is retired by this decision's \`supersedes\`, but its status there isn't changed.`);
          }
        };
        linked(args.supersedes, "supersedes");
        linked(args.deviatesFrom, "deviates_from");
        for (const r of unresolvedOf(loaded.g, args.refs)) warnings.push(`ref "${r}" names nothing in this workspace yet; kept and shown as unresolved (D53).`);
        return { nodes: [{ kind: kind as ProjectKind, label: args.statement, fields }], extra, warnings };
      }),
  );

  read(
    "get_decisions",
    "Get decisions",
    `Decisions and constraints of the project, newest first (at most ${PROJECT_LIMITS_MCP.decisions}), each with its annotations (D35). With \`about\` (a node's key or id): only those whose refs point at it or its ancestors, plus \`warnings\` (D36) for it — constraints and enforced decisions that protect it, with any documented deviation (D45).`,
    { project: projectArg, about: z.string().trim().min(1).max(PROJECT_LIMITS.key).optional() },
    async (args) => {
      const { g } = await loadWorkspace(deps);
      const project = projectOrFail(g, args.project);
      const all = decisionsOf(g, project, args.about);
      const decisions = all.slice(0, PROJECT_LIMITS_MCP.decisions).map((d) => ({ ...decisionView(d), annotations: annotationsOn(g, d).map((a) => ({ key: a.ref, label: a.label, ...(a.project?.intent ? { intent: a.project.intent } : {}) })) }));
      const warnings = args.about ? warningsFor(g, [args.about]) : [];
      return toolResult(`${decisions.length} decision${decisions.length === 1 ? "" : "s"}${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.`, {
        decisions,
        warnings,
        truncated: all.length > decisions.length,
      });
    },
  );

  // ---- Working knowledge ----------------------------------------------------

  write(
    "log_finding",
    "Log finding",
    "Proposes a finding (a non-obvious discovery, hypothesis, assumption or concern — including \"Acute disagrees with the code\"), an open question that needs a human, or a risk, with `refs` to the nodes it concerns (D33, D53). Not for observations anyone gets from reading the code, and never for reasoning, logs or command output.",
    {
      kind: z.enum(["finding", "open_question", "risk"]),
      statement: label,
      reason,
      note: z.enum(FINDING_NOTES).optional().describe("finding only"),
      severity: z.enum(RISK_SEVERITIES).optional().describe("risk only"),
      refs: addressList.optional(),
      project: projectArg,
    },
    (args) =>
      proposeNodes("log_finding", args, `Log ${args.kind.replace("_", " ")} "${args.statement.slice(0, 60)}"`, (loaded) => {
        if (args.note && args.kind !== "finding") throw new ToolFailure("`note` is for findings.");
        if (args.severity && args.kind !== "risk") throw new ToolFailure("`severity` is for risks.");
        const fields: NodePatch = {
          ...(args.kind === "finding" ? { stage: "ephemeral", ...(args.note ? { note: args.note } : {}) } : {}),
          ...(args.kind === "open_question" ? { status: "open" } : {}),
          ...(args.kind === "risk" ? { severity: args.severity ?? "medium" } : {}),
          ...(args.refs?.length ? { refs: args.refs } : {}),
        };
        const warnings = unresolvedOf(loaded.g, args.refs).map((r) => `ref "${r}" names nothing in this workspace yet; kept and shown as unresolved (D53).`);
        return { nodes: [{ kind: args.kind, label: args.statement, fields }], warnings };
      }),
  );

  read(
    "get_open_questions",
    "Get open questions",
    "Open questions of the project; with `include`, also risks and unvalidated findings. Bounded.",
    { project: projectArg, include: z.array(z.enum(["risk", "finding"])).max(2).optional() },
    async (args) => {
      const { g } = await loadWorkspace(deps);
      const items = openQuestionsOf(g, projectOrFail(g, args.project), args.include ?? []).slice(0, 100);
      return toolResult(`${items.length} item${items.length === 1 ? "" : "s"}.`, {
        items: items.map((n) => ({ key: n.ref, kind: n.kind, label: n.label, ...(n.project?.severity ? { severity: n.project.severity } : {}), ...(n.project?.note ? { note: n.project.note } : {}), refs: n.project?.refs ?? [] })),
      });
    },
  );

  write(
    "update_knowledge",
    "Update knowledge",
    "Proposes a status change on a project-knowledge node by key (D33): `validate` a finding; `promote_to_decision` a validated finding (same node, same key); `accept` a decision (with `chosen` when it has options); `supersede` a decision; `answer` an open question (with `answer`); `reopen` a question or decision. Never a copy.",
    {
      key: z.string().trim().min(1).max(PROJECT_LIMITS.key),
      transition: z.enum(["validate", "promote_to_decision", "accept", "supersede", "answer", "reopen"]),
      answer: z.string().trim().min(1).max(PROJECT_LIMITS.answer).optional(),
      chosen: z.string().trim().min(1).max(PROJECT_LIMITS.optionLabel).optional(),
      reason,
    },
    (args) =>
      proposeChangeSet(writeDeps, args, async (live, operationId) => {
        const { g } = await loadWorkspace(deps);
        const n = liveNode(g, live, args.key, ["finding", "decision", "constraint", "open_question"]);
        let patch: NodePatch;
        switch (args.transition) {
          case "validate":
            if (n.kind !== "finding") throw new ToolFailure("Only a finding can be validated.");
            patch = { stage: "validated" };
            break;
          case "promote_to_decision":
            if (n.kind !== "finding") throw new ToolFailure("Only a finding can be promoted to a decision.");
            if (n.project?.stage !== "validated") throw new ToolFailure("Validate the finding first (transition: validate).");
            patch = { kind: "decision", status: "proposed", reason: args.reason };
            break;
          case "accept": {
            if (n.kind !== "decision" && n.kind !== "constraint") throw new ToolFailure("Only a decision or constraint can be accepted.");
            const options = n.project?.options ?? [];
            if (options.length && !args.chosen && !n.project?.chosen) throw new ToolFailure("This decision has options: pass `chosen`.");
            if (args.chosen && !options.some((o) => o.label === args.chosen)) throw new ToolFailure("`chosen` must be one of its options.");
            patch = { status: "accepted", ...(args.chosen ? { chosen: args.chosen } : {}) };
            break;
          }
          case "supersede":
            if (n.kind !== "decision" && n.kind !== "constraint") throw new ToolFailure("Only a decision or constraint can be superseded.");
            patch = { status: "superseded" };
            break;
          case "answer":
            if (n.kind !== "open_question") throw new ToolFailure("Only an open question can be answered.");
            if (!args.answer) throw new ToolFailure("Pass `answer`.");
            patch = { status: "answered", answer: args.answer };
            break;
          case "reopen":
            patch = n.kind === "open_question" ? { status: "open", answer: null } : n.kind === "finding" ? { stage: "ephemeral" } : { status: "proposed", chosen: null };
            break;
        }
        return { set: { operationId, title: title(`${args.transition.replace(/_/g, " ")}: ${n.label.slice(0, 60)}`), metadata: meta("update_knowledge"), reason: args.reason, changes: [{ kind: "update_node", target: n.id, semantics: patch }] }, warnings: [] };
      }),
  );

  write(
    "annotate",
    "Annotate",
    "Proposes an annotation (D35): a short note bound by `refs` to one node (any canvas, D53), with an intent — constraint, preference, question or note. An arrow is drawn too when both are on the open canvas. No threads or replies.",
    { target: z.string().trim().min(1).max(PROJECT_LIMITS.key), text: label, intent: z.enum(ANNOTATION_INTENTS).optional(), reason, project: projectArg },
    (args) =>
      proposeNodes("annotate", args, `Annotate: ${args.text.slice(0, 60)}`, (loaded, live) => {
        const t = resolve(loaded.g, args.target);
        if (!t) throw new ToolFailure(`No node "${args.target}" in this workspace.`);
        const extra: ProposedChange[] = t.what === "node" && t.canvasId === live.canvasId ? [{ kind: "connect", key: "annotates", from: { created: "n0" }, to: { existing: t.id }, relation: "references" }] : [];
        return { nodes: [{ kind: "annotation", label: args.text, fields: { intent: args.intent ?? "note", refs: [t.ref] } }], extra };
      }),
  );

  // ---- Plan ------------------------------------------------------------------

  read("get_implementation_plan", "Get implementation plan", "Milestones in order, each with its progress items in order: status and `next` marks (D33). Items without a milestone are listed apart.", { project: projectArg }, async (args) => {
    const { g } = await loadWorkspace(deps);
    const plan = implementationPlan(g, projectOrFail(g, args.project));
    return toolResult(`${plan.milestones.length} milestone${plan.milestones.length === 1 ? "" : "s"}.`, plan);
  });

  const progressItem = z.object({ key: z.string().trim().min(1).max(PROJECT_LIMITS.key), status: z.enum(PROGRESS_STATUSES).optional(), order: z.number().int().min(0).max(PROJECT_LIMITS.order).optional(), next: z.boolean().optional() });
  const newItem = z.object({ label, milestone: z.string().trim().min(1).max(200).optional().describe("A milestone's key, or the label of one added in `milestones`."), status: z.enum(PROGRESS_STATUSES).optional(), order: z.number().int().min(0).max(PROJECT_LIMITS.order).optional(), next: z.boolean().optional() });

  /** The changes `update_progress` (and `sync_session`'s `progress`) make on existing items. */
  const progressUpdates = (g: WorkspaceGraph, live: LiveCanvasActions, items: readonly z.infer<typeof progressItem>[]): ProposedChange[] =>
    items.map((i) => {
      const n = liveNode(g, live, i.key, ["progress_item"]);
      const patch: NodePatch = { ...(i.status ? { status: i.status } : {}), ...(i.order !== undefined ? { order: i.order } : {}), ...(i.next !== undefined ? { next: i.next || null } : {}) };
      if (!Object.keys(patch).length) throw new ToolFailure(`Nothing to change on "${i.key}".`);
      return { kind: "update_node", target: n.id, semantics: patch };
    });

  write(
    "update_progress",
    "Update progress",
    "Proposes progress changes (D33): status, order or `next` on existing progress items, and new milestones and items (an item names its milestone). Task granularity only — not per command or per test, and nothing marked done that isn't verified.",
    { items: z.array(progressItem).max(30).optional(), add: z.array(newItem).max(30).optional(), milestones: z.array(z.object({ label, order: z.number().int().min(0).max(PROJECT_LIMITS.order).optional() })).max(10).optional(), reason, project: projectArg },
    (args) => {
      if (!args.items?.length && !args.add?.length && !args.milestones?.length) return Promise.reject(new ToolFailure("Nothing to change: pass `items`, `add` or `milestones`."));
      return proposeNodes("update_progress", args, "Update progress", (loaded, live, project) => {
        const nodes: NewProjectNode[] = (args.milestones ?? []).map((m) => ({ kind: "milestone", label: m.label, fields: { ...(m.order !== undefined ? { order: m.order } : {}) } }));
        // A milestone added in this same call is referenced by its index; its key is assigned with it.
        const added = new Map<string, number>((args.milestones ?? []).map((m, i) => [m.label.toLowerCase(), i]));
        const existing = projectMembers(loaded.g, project).filter((n) => n.kind === "milestone");
        const milestoneOf = (milestone?: string): { refs: string[]; newIndex?: number } => {
          if (!milestone) return { refs: [] };
          const found = resolve(loaded.g, milestone);
          if (found?.what === "node" && found.kind === "milestone") return { refs: [found.ref] };
          const byLabel = existing.find((m) => m.label.toLowerCase() === milestone.toLowerCase());
          if (byLabel) return { refs: [byLabel.ref] };
          const index = added.get(milestone.toLowerCase());
          if (index !== undefined) return { refs: [], newIndex: index };
          throw new ToolFailure(`No milestone "${milestone}"; add it in \`milestones\` or use an existing milestone's key.`);
        };
        for (const a of args.add ?? []) {
          const m = milestoneOf(a.milestone);
          nodes.push({
            kind: "progress_item",
            label: a.label,
            fields: { status: a.status ?? "not_started", ...(a.order !== undefined ? { order: a.order } : {}), ...(a.next ? { next: true } : {}), ...(m.refs.length ? { refs: m.refs } : {}) },
            ...(m.newIndex !== undefined ? { refsToNew: [m.newIndex] } : {}),
          });
        }
        return { nodes, extra: progressUpdates(loaded.g, live, args.items ?? []) };
      });
    },
  );

  // ---- The session loop -----------------------------------------------------

  read(
    "get_session_context",
    "Get session context",
    `The bootstrap call: run it before significant work (D29, D37). Give \`task\` (one line), and \`paths\` / \`keys\` when you know them. Scope resolves keys → paths → task → the open tab's selection; \`retrieval_mode\` says which, and \`degraded_reason\` why it fell back. Returns, within \`budget\` characters (default ${SESSION_CONTEXT_BUDGET.default}, max ${SESSION_CONTEXT_BUDGET.max}): warnings (honour them), the project, its focus and the previous session's \`next\`, in-scope architecture, decisions, open questions and risks, in-progress items, annotations, recent changes, recent rejections (don't re-propose those) and linked pages; each section reports what it dropped. Read-only.`,
    {
      task: z.string().trim().min(1).max(500).optional(),
      paths: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
      keys: z.array(z.string().trim().min(1).max(PROJECT_LIMITS.key)).max(50).optional(),
      budget: z.number().int().min(SESSION_CONTEXT_BUDGET.min).max(SESSION_CONTEXT_BUDGET.max).optional(),
      project: projectArg,
    },
    async (args, signal) => {
      const loaded = await loadWorkspace(deps);
      if (signal?.aborted) throw new ToolFailure("Cancelled.");
      const ctx = await deps.currentContext().catch(() => null);
      const { changes, sessions } = await records(deps);
      const linkedPages = await pageLinks(deps, loaded);
      try {
        const payload = sessionContext(loaded.g, {
          ...(args.task ? { task: args.task } : {}),
          ...(args.paths ? { paths: args.paths } : {}),
          ...(args.keys ? { keys: args.keys } : {}),
          ...(args.budget ? { budget: args.budget } : {}),
          ...(args.project ? { project: args.project } : {}),
          ...(ctx ? { focus: ctx.selection.map((o) => o.id) } : {}),
          records: changes,
          sessions,
          session: deps.sessionId(),
          linkedPages,
          ...(signal ? { signal } : {}),
        });
        const head = payload.warnings.items.length ? `⚠ ${payload.warnings.items.length} warning${payload.warnings.items.length === 1 ? "" : "s"}. ` : "";
        return toolResult(`${head}Context for ${payload.retrieval_mode === "none" ? "no scope" : `scope by ${payload.retrieval_mode}`} (${payload.chars}/${payload.budget} chars${payload.truncated ? ", truncated" : ""}).`, payload);
      } catch (err) {
        if (err instanceof SessionContextAborted) throw new ToolFailure(err.message);
        throw err;
      }
    },
  );

  write(
    "sync_session",
    "Sync session",
    `Call once at the end of a session (D38): a short \`summary\`, the \`changed\` paths with a few words each (at most ${PROJECT_LIMITS_MCP.changedEntries}), decisions, findings and progress not yet recorded, and \`next\` (what the following session should pick up). The knowledge becomes one ordinary proposal; summary, changed and next are stored on this session's record for the next session's get_session_context. \`architecture\`: map sections that changed, each as upsert_map_section's input (mapId, commit, section, nodes, relationships; at most ${SYNC_SECTIONS_MAX}), staged on the map canvas like upsert_map_section, with a status per section; or \`{ sectionKey }\` alone just to report one you already sent. Not after every step; no diffs, logs or command output.`,
    {
      summary: z.string().trim().min(1).max(500),
      changed: z.array(z.object({ path: z.string().trim().min(1).max(300), what: z.string().trim().min(1).max(120) })).max(PROJECT_LIMITS_MCP.changedEntries).optional(),
      decisions: z.array(z.object({ statement: label, kind: z.enum(["decision", "constraint"]).optional(), reason: z.string().trim().min(1).max(500), options: z.array(z.object({ label: z.string().trim().min(1).max(PROJECT_LIMITS.optionLabel) })).max(PROJECT_LIMITS.options).optional(), chosen: z.string().trim().min(1).max(PROJECT_LIMITS.optionLabel).optional(), refs: addressList.optional() })).max(10).optional(),
      findings: z.array(z.object({ kind: z.enum(["finding", "open_question", "risk"]), statement: label, note: z.enum(FINDING_NOTES).optional(), severity: z.enum(RISK_SEVERITIES).optional(), refs: addressList.optional() })).max(10).optional(),
      progress: z.array(progressItem).max(30).optional(),
      architecture: z.array(z.union([z.object(SECTION_SHAPE), z.object({ sectionKey: z.string().trim().min(1).max(200) })])).max(30).optional(),
      next: z.array(z.string().trim().min(1).max(200)).max(PROJECT_LIMITS_MCP.nextEntries).optional(),
      focus: z.string().trim().min(1).max(PROJECT_LIMITS.focus).optional(),
      project: projectArg,
    },
    async (args) => {
      if (!deps.policy().allowWrites) throw new ToolFailure(MESSAGES.writesDisabled);
      const hasKnowledge = !!(args.decisions?.length || args.findings?.length || args.progress?.length || args.focus);
      const sections = (args.architecture ?? []).filter((a) => !("sectionKey" in a));
      if (sections.length > SYNC_SECTIONS_MAX) throw new ToolFailure(`architecture: at most ${SYNC_SECTIONS_MAX} full sections per sync_session; send the rest with upsert_map_section.`);
      let proposal: Awaited<ReturnType<typeof proposeChangeSet>> | null = null;
      if (hasKnowledge) {
        proposal = await proposeChangeSet(writeDeps, { ...args, reason: args.summary }, async (l, operationId) => {
          const loaded = await loadWorkspace(deps);
          const project = projectOrFail(loaded.g, args.project);
          const { frameId, frame, members } = stateFrame(loaded, l, project);
          const nodes: NewProjectNode[] = [
            ...(args.decisions ?? []).map((d) => {
              if (d.chosen && !d.options?.some((o) => o.label === d.chosen)) throw new ToolFailure(`decision "${d.statement}": chosen must be one of its options.`);
              const kind = d.kind ?? "decision";
              return { kind: kind as ProjectKind, label: d.statement, fields: { status: kind === "constraint" || d.chosen ? "accepted" : "proposed", reason: d.reason, ...(d.options?.length ? { options: d.options } : {}), ...(d.chosen ? { chosen: d.chosen } : {}), ...(d.refs?.length ? { refs: d.refs } : {}) } as NodePatch };
            }),
            ...(args.findings ?? []).map((f) => ({
              kind: f.kind as ProjectKind,
              label: f.statement,
              fields: {
                ...(f.kind === "finding" ? { stage: "ephemeral", ...(f.note ? { note: f.note } : {}) } : {}),
                ...(f.kind === "open_question" ? { status: "open" } : {}),
                ...(f.kind === "risk" ? { severity: f.severity ?? "medium" } : {}),
                ...(f.refs?.length ? { refs: f.refs } : {}),
              } as NodePatch,
            })),
          ];
          const { changes, keys } = addProjectNodes({ frameId, frame, members, nodes: nodes.map((n) => ({ ...n, fields: { project: project.key, ...n.fields } })), taken: takenKeys(loaded.g), keyBase: project.key });
          const extra = progressUpdates(loaded.g, l, args.progress ?? []);
          if (args.focus) {
            const p = liveNode(loaded.g, l, project.elementId, ["project"]);
            extra.push({ kind: "update_node", target: p.id, semantics: { focus: args.focus } });
          }
          return { set: { operationId, title: title(`Sync: ${args.summary.slice(0, 80)}`), metadata: meta("sync_session"), reason: args.summary, changes: [...changes, ...extra] }, warnings: [], extra: { keys } };
        });
        if (proposal.isError) return proposal;
      }
      // Changed architecture (D38): each full section is written as upsert_map_section writes it, one at a time; a
      // failed one doesn't stop the others or the report.
      const architecture: SectionOutcome[] = [];
      for (const a of args.architecture ?? []) {
        if ("sectionKey" in a) architecture.push({ sectionKey: a.sectionKey, status: "reported" });
        else if (!deps.upsertMapSection) architecture.push({ sectionKey: a.section.key, status: "error", message: "The repo-map tools aren't served here, so sections can't be written." });
        else architecture.push(sectionOutcome(a.section.key, await deps.upsertMapSection(a)));
      }
      // The report itself, on this session's record (D38): what the next session's context reads.
      const session = deps.sessionId();
      let stored = false;
      if (deps.agentState) {
        const existing = await deps.agentState.getSession(session);
        const now = Date.now();
        const loaded = await loadWorkspace(deps);
        const project = resolveProject(loaded.g, args.project);
        await deps.agentState.putSession({
          ...(existing ?? { id: session, workspaceId: deps.workspaceId, startedAt: now, changeIds: [] }),
          ...(client() ? { agent: client() } : {}),
          ...(project.ok ? { project: project.project.key } : {}),
          summary: args.summary,
          ...(args.changed?.length ? { changed: args.changed } : {}),
          ...(args.next?.length ? { next: args.next } : {}),
          lastWriteAt: now,
        });
        stored = true;
      }
      const structured = (proposal?.structuredContent as Record<string, unknown> | undefined) ?? { status: "recorded" };
      const reported = architecture.some((a) => a.status === "reported");
      const payload = { ...structured, session, stored, ...(architecture.length ? { architecture } : {}), ...(reported ? { hint: "Sections given by sectionKey alone are only reported; send their content with upsert_map_section, or in architecture." } : {}), ...(args.next?.length ? { next: args.next } : {}) };
      const failed = architecture.filter((a) => a.status === "rejected" || a.status === "error");
      const sectionsText = architecture.some((a) => a.status !== "reported")
        ? ` Architecture: ${architecture.filter((a) => a.status !== "reported").map((a) => `${a.sectionKey} ${a.status}${a.reason ? ` (${a.reason})` : ""}`).join(", ")}.${failed.length ? ` ${failed.map((a) => `${a.sectionKey}: ${a.message}`).join(" ")}` : ""}`
        : "";
      const text = `${proposal ? (proposal.content as { text: string }[])[0]!.text : "Nothing to propose."}${sectionsText} ${stored ? "Session summary and next stored for the next session." : "Session record unavailable: summary not stored."}`;
      return toolResult(text, payload as never);
    },
    // With nothing to propose (only a summary, next or architecture) there is no proposal: status "recorded".
    {
      ...z.object(PROPOSED_SHAPE).partial().shape,
      status: z.enum(["proposed", "applied", "recorded"]),
      keys: z.array(z.string()).optional(),
      session: z.string(),
      stored: z.boolean(),
      architecture: z.array(z.object({ sectionKey: z.string(), status: z.string(), reason: z.string().optional(), message: z.string().optional() })).optional(),
      hint: z.string().optional(),
      next: z.array(z.string()).optional(),
    },
  );

  // ---- Agent State -----------------------------------------------------------

  read(
    "get_recent_changes",
    "Get recent changes",
    `Accepted change records (D31, D32), newest first (at most ${PROJECT_LIMITS_MCP.changes}): agent (as the client reported it), session, tool, time, reason, touched keys, revertible or not. Filters: session, agent, keys, since (ms epoch).`,
    { session: z.string().trim().min(1).max(200).optional(), agent: z.string().trim().min(1).max(40).optional(), keys: z.array(z.string().trim().min(1).max(PROJECT_LIMITS.key)).max(50).optional(), since: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(PROJECT_LIMITS_MCP.changes).optional() },
    async (args) => {
      const { changes } = await records(deps);
      const keys = args.keys ? new Set(args.keys) : null;
      const list = changes.filter(
        (r) => r.outcome === "accepted" && (!args.session || r.session === args.session) && (!args.agent || r.agent === args.agent) && (!args.since || r.at >= args.since) && (!keys || r.touched.some((t) => keys.has(t.elementId) || (t.key && keys.has(t.key)))),
      );
      const limit = args.limit ?? PROJECT_LIMITS_MCP.changes;
      const out = list.slice(0, limit).map((r) => ({
        id: r.id,
        title: r.title,
        ...(r.agent ? { agent: r.agent } : {}),
        ...(r.session ? { session: r.session } : {}),
        tool: r.tool,
        at: r.at,
        ...(r.reason ? { reason: r.reason } : {}),
        touched: r.touched.slice(0, 30).map((t) => ({ op: t.op, ...(t.key ? { key: t.key } : {}), id: t.elementId })),
        revertible: r.revertible && !r.revertedBy,
        ...(r.revertedBy ? { revertedBy: r.revertedBy } : {}),
        canvasId: r.canvasId,
      }));
      return toolResult(`${out.length} change${out.length === 1 ? "" : "s"}.`, { changes: out, truncated: list.length > out.length });
    },
  );

  read("get_session_history", "Get session history", `Agent sessions (D38), newest first (at most ${PROJECT_LIMITS_MCP.sessions}): agent, times, summary, changed paths, next, change ids.`, { limit: z.number().int().min(1).max(PROJECT_LIMITS_MCP.sessions).optional() }, async (args) => {
    const { sessions } = await records(deps);
    const out = sessions.slice(0, args.limit ?? PROJECT_LIMITS_MCP.sessions).map((s) => ({ ...s, usage: undefined, changeIds: s.changeIds.slice(-50) }));
    return toolResult(`${out.length} session${out.length === 1 ? "" : "s"}.`, { sessions: out, truncated: sessions.length > out.length });
  });

  read(
    "get_session_review",
    "Get session review",
    "Before / during / after for a session (default: the most recent other session) or a set of change ids (D47): the prior state of what it touched, what it found and decided, what changed, its impact, new risks, open decisions, unvalidated findings, and what needs review. With get_lens_impact this is a session's impact summary.",
    { session: z.string().trim().min(1).max(200).optional(), changeIds: z.array(z.string().trim().min(1).max(200)).max(100).optional() },
    async (args, signal) => {
      const { changes, sessions } = await records(deps);
      if (signal?.aborted) throw new ToolFailure("Cancelled.");
      const session = args.session ? sessions.find((s) => s.id === args.session) : args.changeIds?.length ? undefined : sessions.find((s) => s.id !== deps.sessionId() && s.changeIds.length);
      if (args.session && !session) throw new ToolFailure(`No session "${args.session}" (get_session_history lists them).`);
      const { g } = await loadWorkspace(deps);
      if (signal?.aborted) throw new ToolFailure("Cancelled.");
      const review = sessionReview(g, { records: changes, ...(session ? { session } : {}), ...(args.changeIds ? { changeIds: args.changeIds } : {}) });
      return toolResult(`Review of ${review.changeIds.length} change${review.changeIds.length === 1 ? "" : "s"}.`, review);
    },
  );

  write(
    "revert_agent_changes",
    "Revert agent changes",
    "Proposes the inverse of the given change records, or of a whole session's, as one change set (D30): what they added is removed, what they changed is restored with its id and connections. An object edited since comes back as a conflict for the user to decide, never overwritten. Never auto-accepted.",
    { changeIds: z.array(z.string().trim().min(1).max(200)).max(100).optional(), session: z.string().trim().min(1).max(200).optional(), reason },
    (args) =>
      proposeChangeSet(writeDeps, args, async (live, operationId) => {
        if (!deps.agentState) throw new ToolFailure("The agent change log isn't available here.");
        const { changes } = await records(deps);
        const chosen = args.changeIds?.length ? changes.filter((r) => args.changeIds!.includes(r.id)) : args.session ? changes.filter((r) => r.session === args.session && r.outcome === "accepted") : [];
        if (!chosen.length) throw new ToolFailure("Name the changes to revert: `changeIds` (get_recent_changes) or a `session`.");
        const elsewhere = chosen.find((r) => r.canvasId !== live.canvasId);
        if (elsewhere) throw new ToolFailure(`Change ${elsewhere.id} was made on canvas ${elsewhere.canvasId}; ask the user to open it.`);
        const plan = planRevert(chosen, live.elements());
        if (!plan.changes.length && !plan.conflicts.length) throw new ToolFailure(`Nothing to revert${plan.skipped.length ? ` (${plan.skipped.map((s) => `${s.id}: ${s.why.replace(/_/g, " ")}`).join("; ")})` : ": what they changed is already gone"}.`);
        const reverted = chosen.filter((r) => !plan.skipped.some((s) => s.id === r.id));
        return {
          set: {
            operationId,
            title: title(reverted.length === 1 ? `Revert: ${reverted[0]!.title}` : `Revert ${reverted.length} changes`),
            metadata: meta("revert_agent_changes"),
            reason: args.reason,
            reverts: reverted.map((r) => r.id),
            changes: plan.changes,
            ...(plan.conflicts.length ? { conflicts: plan.conflicts } : {}),
          },
          warnings: plan.skipped.map((s) => `${s.id} skipped: ${s.why.replace(/_/g, " ")}`),
        };
      }),
  );

  // ---- Impact ----------------------------------------------------------------

  read(
    "get_lens_impact",
    "Get lens impact",
    "What a change affects (D54): `keys` (nodes' keys or ids), `changedPaths` (matched against nodes' sources) or `changedFiles` (paths plus the line ranges your diff touched, so nodes citing other lines of the file are skipped). Also returns `risk`: modified and affected nodes ranked by dependents, warnings and missing tests, and the changed nodes with no linked test. Returns modified, affected (what depends on them, and the levels that contain them) and related (what they depend on, and the knowledge pointing at them), the warnings that protect them (D36, with deviations, D45), and the decisions, open questions and risks on them. Bounded; data only (no UI).",
    {
      keys: z.array(z.string().trim().min(1).max(PROJECT_LIMITS.key)).max(50).optional(),
      changedPaths: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
      changedFiles: z
        .array(z.object({ path: z.string().trim().min(1).max(500), lines: z.array(z.tuple([z.number().int().min(1), z.number().int().min(1)])).max(200).optional() }))
        .max(50)
        .optional()
        .describe("Like changedPaths, plus the 1-based [start, end] line ranges your diff touched. A node whose cited lines don't overlap them is skipped, not reported as affected."),
      project: projectArg,
    },
    async (args) => {
      if (!args.keys?.length && !args.changedPaths?.length && !args.changedFiles?.length) throw new ToolFailure("Pass `keys`, `changedPaths` or `changedFiles`.");
      const { g } = await loadWorkspace(deps);
      const byPath = args.changedPaths?.length ? nodesCitingPaths(g, args.changedPaths).map((n) => n.ref) : [];
      const byLines = args.changedFiles?.length ? nodesCitingChanges(g, args.changedFiles) : { hit: [], skipped: [] };
      const fromPaths = [...byPath, ...byLines.hit.map((h) => h.node.ref)];
      const impact = impactOf(g, [...(args.keys ?? []), ...fromPaths]);
      const scope = [...impact.modified, ...impact.affected].map((e) => e.ref);
      const warnings = warningsFor(g, scope);
      const warned = new Map(scope.map((r) => [r, warningsFor(g, [r]).length] as const).filter(([, c]) => c > 0));
      const risk = riskOf(g, impact, warned);
      const addrs = scopeAddresses(g, scope);
      const knowledge = g.nodes
        .filter((n) => (n.kind === "decision" || n.kind === "constraint" || n.kind === "open_question" || n.kind === "risk") && (n.project?.refs ?? []).some((r) => addrs.has(r)))
        .slice(0, 50)
        .map((n) => ({ key: n.ref, kind: n.kind, label: n.label, ...(n.project?.status ? { status: n.project.status } : {}) }));
      return toolResult(`${impact.modified.length} modified, ${impact.affected.length} affected, ${impact.related.length} related${warnings.length ? `; ⚠ ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.`, {
        ...impact,
        ...((args.changedPaths?.length || args.changedFiles?.length) && !fromPaths.length ? { note: "No node cites those paths or line ranges (sources come from the node's Source field, or a repo map)." } : {}),
        ...(byLines.skipped.length ? { skippedByLines: byLines.skipped.slice(0, 50).map((n) => n.ref) } : {}),
        risk,
        warnings,
        knowledge,
      });
    },
  );

}
