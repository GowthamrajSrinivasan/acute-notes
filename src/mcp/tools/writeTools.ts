/**
 * Write tools (F21). None of them mutates anything: each builds an F19
 * change set with `metadata.createdBy: "mcp"`, validates it with
 * `parseChangeSet`, and puts it up for the user's review on the open canvas.
 * Only the user's Accept writes it (one transaction, one undo step), so the
 * tool reports `status: "proposed"` — or `"applied"` for a Project-profile
 * write in a session the user switched to auto-accept (D44, Phase 7B tools).
 * Each proposal waits in its MCP session's own slot (D40) and carries the
 * session, the client's reported name and an args summary (D32, D46).
 *
 * - `create_block` / `create_page` / `create_table` / `create_todo` build a
 *   one-node VisualPlan and render it through the same path as Visualize
 *   (F29 `validateVisualPlan` → F30 `renderVisualPlan` with the live canvas's
 *   render context), so placement avoids existing objects exactly as it does
 *   for in-app AI output.
 * - `render_visual_plan` takes a whole VisualPlan through that same path and
 *   returns the validator's warnings.
 * - `create_connection` → one `connect` between existing objects;
 *   `move_object` → one `move`.
 * - `update_block` → one `update_block` (new Markdown content for an existing
 *   rich block or page preview), with no `stableNodeKey`: the writer then
 *   keeps the target document's own provenance and reconciliation link, so an
 *   accepted MCP edit counts as the user's own edit.
 *
 * The review bar's title names the connected client ("Claude Code: Add
 * to-do list"), and the client's name is recorded as the set's `provider`.
 *
 * Refused (as tool errors, nothing proposed): writes turned off by policy, no
 * canvas of this workspace open, a canvas id other than the open one, or a
 * change set already under review there (it is never replaced).
 *
 * No delete tool: see the F21 tracker notes.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describeChanges, InvalidChangeSetError, parseChangeSet, type ChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { autoAcceptable, summarizeArgs } from "@/ai/changes/agentState";
import { AUTO_ACCEPT_TOOLS, sessionAutoAccept } from "@/ai/changes/autoAccept";
import { describeLayout } from "@/ai/changes/layoutCheck";
import { PendingReviewError } from "@/ai/changes/pendingChanges";
import { checkProposal } from "@/ai/changes/proposalGeometry";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import { loadDefaultParser, renderVisualPlan } from "@/ai/renderer/render";
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import { templateFor } from "@/ai/visual-plan/templates";
import { VISUAL_TEMPLATES } from "@/ai/visual-plan/types";
import { InvalidVisualPlanError, MAX_PLAN_NODES, validateVisualPlan } from "@/ai/visual-plan/validate";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { COMPOSITE_SHAPES_DESCRIBED } from "@/domain/canvas/compositeShapes";
import { newId } from "@/domain/ids";
import { RELATION_TYPES } from "@/domain/types";
import { cut, isStandalone } from "../context/currentContext";
import { DELETE_ANNOTATIONS, guarded, plural, ToolFailure, toolResult, WRITE_ANNOTATIONS, type ToolPolicy } from "./common";
import type { LiveCanvasActions } from "./liveCanvas";

export const WRITE_TOOL_NAMES = ["create_block", "create_page", "create_table", "create_todo", "create_connection", "move_object", "update_block", "render_visual_plan", "delete_object"] as const;

/** At most this many objects per `delete_object` proposal. */
export const DELETE_LIMIT = 50;
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

export interface WriteToolDeps {
  workspaceId: string;
  liveCanvas(): LiveCanvasActions | null;
  policy(): ToolPolicy;
  /** Markdown → rich content for text and page nodes; defaults to the app's own parser (tests inject a stub). */
  parseMarkdown?: ParseMarkdown;
  /** The connected client's self-reported name (MCP `clientInfo.name`), when known. */
  clientName?(): string | undefined;
  /** This MCP connection's session id (D40: its proposals wait in their own slot; D32: they're attributed to it). */
  sessionId?(): string;
  /** The tools auto-accept may write for (D44); defaults to `AUTO_ACCEPT_TOOLS` (tests inject their own). */
  autoAcceptTools?: ReadonlySet<string>;
}

/** A client name fit for the review bar: control/format characters stripped, whitespace collapsed, at most 40 characters; undefined when empty. */
export function sanitizeClientName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const clean = raw.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return clean ? cut(clean, 40).text : undefined;
}

export const MESSAGES = {
  writesDisabled: "This workspace is read-only for MCP clients — change it in ⋮ → MCP access. Read tools still work.",
  noCanvas: "No canvas of this workspace is open in Acute-Notes; ask the user to open one.",
  reviewing: "The user is still reviewing this session's previous proposal on this canvas; ask them to accept or reject it first.",
  canvasChanged: "The open canvas changed while the proposal was being prepared; nothing was proposed.",
} as const;

/** What every write tool returns. */
const proposedShape = {
  /** "applied": written at once, for a session the user switched to auto-accept (D44); otherwise waiting for review. */
  status: z.enum(["proposed", "applied"]),
  operationId: z.string(),
  canvasId: z.string(),
  /** The review bar's title. */
  title: z.string(),
  /** "1 block", "3 objects · 2 connections · 1 move". */
  summary: z.string(),
  /** Change kinds and how many of each, e.g. { create_block: 1 }. */
  changes: z.record(z.string(), z.number()),
  warnings: z.array(z.string()),
  /** Layout checks on the proposal as it will be drawn (Wave 1b item 4). */
  layout: z
    .object({
      issues: z.array(
        z.object({ code: z.string(), severity: z.enum(["fatal", "warning"]), subject: z.array(z.string()), evidence: z.string(), fixes: z.array(z.string()) }),
      ),
      counts: z.record(z.string(), z.number()),
      score: z.number(),
      truncated: z.boolean(),
    })
    .optional(),
};
export type ProposedResult = z.infer<z.ZodObject<typeof proposedShape>> & Record<string, unknown>;

/** What a tool's builder hands the write path: the set, warnings for the agent, and extra result fields (e.g. created keys). */
export interface BuiltProposal {
  set: ChangeSet;
  warnings: string[];
  extra?: Record<string, unknown>;
}

/** The write tools' shared result shape, for other tool groups that propose through `proposeChangeSet`. */
export const PROPOSED_SHAPE = proposedShape;

const id = z.string().min(1).max(200);
const canvasIdArg = id.optional().describe("The canvas to propose on; must be the open canvas (the default).");
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const markdown = (max: number) => z.string().trim().min(1).max(max);


/** The open canvas of this workspace, ready to take a proposal from `session`; throws a `ToolFailure` otherwise. */
function openCanvas(deps: WriteToolDeps, canvasId: string | undefined, session: string | undefined): LiveCanvasActions {
  if (!deps.policy().allowWrites) throw new ToolFailure(MESSAGES.writesDisabled);
  const live = deps.liveCanvas();
  if (!live || live.workspaceId !== deps.workspaceId) throw new ToolFailure(MESSAGES.noCanvas);
  if (canvasId && canvasId !== live.canvasId) throw new ToolFailure(`Canvas ${canvasId} isn't the open canvas; changes can only be proposed on the open canvas (${live.canvasId}).`);
  if (live.isReviewing(session)) throw new ToolFailure(MESSAGES.reviewing);
  return live;
}

function liveObject(live: LiveCanvasActions, objectId: string): SceneElement {
  const el = live.elements().find((e) => e.id === objectId && !e.isDeleted);
  if (!el || !isStandalone(el)) throw new ToolFailure(`Object not found on the open canvas: ${objectId}`);
  return el;
}

function countKinds(changes: readonly ProposedChange[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of changes) out[c.kind] = (out[c.kind] ?? 0) + 1;
  return out;
}

/**
 * The one write path: check the boundary, build, validate, re-check (the
 * build may await), propose. Nothing reaches the canvas. Every proposal is
 * attributed (D32, E3): its session, the client's reported name, the tool
 * (`metadata.task`) and a bounded summary of `input` (D46).
 */
export async function proposeChangeSet(
  deps: WriteToolDeps,
  input: { canvasId?: string } & Record<string, unknown>,
  build: (live: LiveCanvasActions, operationId: string) => Promise<BuiltProposal> | BuiltProposal,
) {
  const { canvasId, ...rest } = input;
  const session = deps.sessionId?.();
  const live = openCanvas(deps, canvasId, session);
  const operationId = newId("op");
  let built: BuiltProposal;
  try {
    built = await build(live, operationId);
  } catch (err) {
    if (err instanceof InvalidVisualPlanError) throw new ToolFailure(`The visual plan can't be rendered: ${err.problems.join("; ")}`);
    throw err;
  }
  const agent = sanitizeClientName(deps.clientName?.());
  const args = summarizeArgs(rest);
  let set: ChangeSet;
  try {
    set = parseChangeSet({ ...built.set, ...(session ? { session } : {}), ...(agent ? { agent } : {}), ...(args ? { args } : {}) });
  } catch (err) {
    if (err instanceof InvalidChangeSetError) throw new ToolFailure(`The proposal is invalid: ${err.problems.join("; ")}`);
    throw err;
  }
  if (deps.liveCanvas() !== live || !deps.policy().allowWrites) throw new ToolFailure(MESSAGES.canvasChanged);
  if (live.isReviewing(session)) throw new ToolFailure(MESSAGES.reviewing);
  // Measured before proposing, against the scene the proposal was built for.
  const layout = checkProposal(set.changes, live.elements());
  try {
    live.propose(set);
  } catch (err) {
    // Another session's proposal under review changes the same objects (D40).
    if (err instanceof PendingReviewError) throw new ToolFailure(`${err.message} (That proposal is from another session; this one wasn't proposed.)`);
    throw err;
  }
  // D44: a Project-profile write for a session the user switched to auto-accept, unless it removes, reverts, adds a
  // constraint or enforces a decision. Written exactly as Accept would, and logged with its inverse.
  const tool = set.metadata.task;
  const auto =
    !!session && !!tool && (deps.autoAcceptTools ?? AUTO_ACCEPT_TOOLS).has(tool) && sessionAutoAccept.isSessionOn(live.canvasId, session) && autoAcceptable(set) && !!live.acceptSet?.(set.operationId);
  if (auto) sessionAutoAccept.countAccepted(live.canvasId, session!);

  const result: ProposedResult = {
    status: auto ? "applied" : "proposed",
    operationId: set.operationId,
    canvasId: live.canvasId,
    title: set.title,
    summary: describeChanges(set.changes),
    changes: countKinds(set.changes),
    warnings: built.warnings,
    ...(layout.issues.length ? { layout: { ...layout, counts: { ...layout.counts } } } : {}),
    ...(built.extra ?? {}),
  };
  const found = describeLayout(layout.counts);
  const text =
    (auto
      ? `Applied ${result.summary} on the open canvas (${result.title}): the user set this session to auto-accept. They can revert it from the agent log.`
      : `Proposed ${result.summary} on the open canvas for the user's review (${result.title}). Nothing changes until they accept it.`) +
    (result.warnings.length ? ` ${plural(result.warnings.length, "warning")}: ${result.warnings.join("; ")}` : "") +
    (found ? ` Layout: ${found} (see layout.issues).` : "");
  return toolResult(text, result);
}

/** A raw plan through F29 validation and F30 rendering against the live canvas. */
async function renderPlan(deps: WriteToolDeps, live: LiveCanvasActions, operationId: string, rawPlan: unknown, setTitle: string, metadata: ChangeSet["metadata"]) {
  const { plan, warnings } = validateVisualPlan(rawPlan);
  const set = await renderVisualPlan(plan, {
    operationId,
    title: setTitle,
    metadata: { ...metadata, template: plan.template },
    context: live.renderContext(),
    ...(deps.parseMarkdown ? { parseMarkdown: deps.parseMarkdown } : {}),
  });
  return { set, warnings };
}

/** A one-node plan (the `action_plan` template takes text, page, table and todo nodes). */
const onePlan = (node: Record<string, unknown>) => ({ version: 1, template: "action_plan", nodes: [node], relationships: [] });

export function registerWriteTools(server: McpServer, deps: WriteToolDeps): void {
  const client = () => sanitizeClientName(deps.clientName?.());
  /** The review bar's title: "<client>: <what>", or "MCP: <what>" when the client didn't say who it is. */
  const title = (what: string) => cut(`${client() ?? "MCP"}: ${what}`, 200).text;
  const meta = (task: WriteToolName): ChangeSet["metadata"] => {
    const name = client();
    return { createdBy: "mcp", task, ...(name ? { provider: name } : {}) };
  };
  const register = <Shape extends z.ZodRawShape>(
    name: WriteToolName,
    meta: { title: string; description: string; destructive?: boolean },
    inputSchema: Shape,
    run: (args: z.infer<z.ZodObject<Shape>>) => ReturnType<typeof proposeChangeSet>,
  ) =>
    server.registerTool(
      name,
      {
        title: meta.title,
        description: `${meta.description} Proposes a change for the user's review; nothing changes until they accept it. Fails while other changes are under review.`,
        inputSchema,
        outputSchema: proposedShape,
        annotations: meta.destructive ? DELETE_ANNOTATIONS : WRITE_ANNOTATIONS,
      },
      // The SDK validates `args` against `inputSchema` first; its generic callback type can't follow `Shape` through this helper, hence the cast.
      ((args: z.infer<z.ZodObject<Shape>>) => guarded(() => run(args))) as never,
    );

  register(
    "create_block",
    { title: "Create text block", description: "Adds a text block with Markdown content to the open canvas, placed clear of existing objects (beside the selection, if any)." },
    { markdown: markdown(TEXT_LIMITS.markdown).describe("The block's content, GFM Markdown."), title: z.string().trim().min(1).max(TEXT_LIMITS.title).optional(), canvasId: canvasIdArg },
    (args) =>
      proposeChangeSet(deps, args, (live, op) =>
        renderPlan(deps, live, op, onePlan({ id: "block", type: "text", ...(args.title ? { title: args.title } : {}), content: { markdown: args.markdown } }), title("Add text block"), meta("create_block")),
      ),
  );

  register(
    "create_page",
    { title: "Create page", description: "Adds a new page (with its preview card on the open canvas) with a title and Markdown content." },
    { title: z.string().trim().min(1).max(TEXT_LIMITS.title), markdown: markdown(TEXT_LIMITS.markdown).describe("The page's content, GFM Markdown."), canvasId: canvasIdArg },
    (args) =>
      proposeChangeSet(deps, args, (live, op) =>
        renderPlan(deps, live, op, onePlan({ id: "page", type: "page", content: { title: args.title, markdown: args.markdown } }), title(`Add page "${cut(args.title, 60).text}"`), meta("create_page")),
      ),
  );

  const cell = z.string().max(TEXT_LIMITS.tableCell);
  register(
    "create_table",
    { title: "Create table", description: "Adds a table block to the open canvas: a header row of column names, then rows of plain-text cells." },
    {
      columns: z.array(cell).min(1).max(TEXT_LIMITS.tableColumns).describe("Column names (the header row)."),
      rows: z.array(z.array(cell).max(TEXT_LIMITS.tableColumns)).max(TEXT_LIMITS.tableRows).describe("Rows of cells; shorter rows are padded, longer ones are rejected."),
      title: z.string().trim().min(1).max(TEXT_LIMITS.title).optional(),
      canvasId: canvasIdArg,
    },
    (args) =>
      proposeChangeSet(deps, args, (live, op) => {
        const long = args.rows.findIndex((r) => r.length > args.columns.length);
        if (long >= 0) throw new ToolFailure(`rows.${long} has ${args.rows[long]!.length} cells but there are only ${args.columns.length} columns.`);
        const rows = args.rows.map((r) => args.columns.map((_, i) => r[i] ?? ""));
        return renderPlan(deps, live, op, onePlan({ id: "table", type: "table", ...(args.title ? { title: args.title } : {}), content: { columns: args.columns, rows } }), title("Add table"), meta("create_table"));
      }),
  );

  register(
    "create_todo",
    { title: "Create to-do list", description: "Adds a to-do list block to the open canvas." },
    {
      items: z
        .array(z.object({ text: z.string().trim().min(1).max(TEXT_LIMITS.todoItem), checked: z.boolean().optional() }))
        .min(1)
        .max(TEXT_LIMITS.todoItems),
      title: z.string().trim().min(1).max(TEXT_LIMITS.title).optional(),
      canvasId: canvasIdArg,
    },
    (args) =>
      proposeChangeSet(deps, args, (live, op) =>
        renderPlan(
          deps,
          live,
          op,
          onePlan({ id: "todo", type: "todo", ...(args.title ? { title: args.title } : {}), content: { items: args.items.map((i) => ({ text: i.text, checked: i.checked ?? false })) } }),
          title("Add to-do list"),
          meta("create_todo"),
        ),
      ),
  );

  register(
    "create_connection",
    { title: "Connect objects", description: "Draws an arrow from one existing object on the open canvas to another, optionally with a relation type and a label." },
    {
      from: id.describe("The object the arrow starts at."),
      to: id.describe("The object the arrow points to."),
      relation: z.enum(RELATION_TYPES).optional().describe("What the connection means, e.g. depends_on or flows_to."),
      label: z.string().trim().min(1).max(TEXT_LIMITS.relationshipLabel).optional(),
      canvasId: canvasIdArg,
    },
    (args) =>
      proposeChangeSet(deps, args, (live, operationId) => {
        if (args.from === args.to) throw new ToolFailure("An object can't be connected to itself.");
        liveObject(live, args.from);
        liveObject(live, args.to);
        const change: ProposedChange = {
          kind: "connect",
          key: "connection",
          from: { existing: args.from },
          to: { existing: args.to },
          ...(args.relation ? { relation: args.relation } : {}),
          ...(args.label ? { label: args.label } : {}),
        };
        return { set: { operationId, title: title("Connect objects"), metadata: meta("create_connection"), changes: [change] }, warnings: [] };
      }),
  );

  register(
    "move_object",
    { title: "Move object", description: "Moves an existing object on the open canvas so its top-left corner is at (x, y), in scene coordinates. Its label and arrows follow it." },
    { id: id.describe("The object to move."), x: coordinate, y: coordinate, canvasId: canvasIdArg },
    (args) =>
      proposeChangeSet(deps, args, (live, operationId) => {
        const el = liveObject(live, args.id);
        if (el.locked) throw new ToolFailure(`Object ${args.id} is locked by the user and can't be moved.`);
        return {
          set: { operationId, title: title("Move object"), metadata: meta("move_object"), changes: [{ kind: "move", target: args.id, to: { x: args.x, y: args.y } }] },
          warnings: [],
        };
      }),
  );

  register(
    "update_block",
    {
      title: "Update block",
      description:
        "Replaces the content of an existing rich block (text, to-do, table or code) or page preview on the open canvas with Markdown; " +
        "`title` renames a page. The object keeps its id, place and origin; the user can undo the accepted edit.",
    },
    {
      objectId: id.describe("The block or page preview to update (from get_canvas, search_workspace or get_selected_content)."),
      markdown: markdown(TEXT_LIMITS.markdown).describe("The new content, GFM Markdown."),
      title: z.string().trim().min(1).max(TEXT_LIMITS.title).optional().describe("A new page title (page previews only)."),
      canvasId: canvasIdArg,
    },
    (args) =>
      proposeChangeSet(deps, args, async (live, operationId) => {
        const el = live.elements().find((e) => e.id === args.objectId && !e.isDeleted);
        const ref = el ? getEmbedRef(el) : null;
        if (!el || !ref) throw new ToolFailure(`No block or page preview with id ${args.objectId} on the open canvas; update_block changes only those (not shapes, text or arrows).`);
        if (args.title && ref.kind !== "page-preview") throw new ToolFailure("`title` applies only to page previews; a block's title is part of its Markdown.");
        const parse = deps.parseMarkdown ?? (await loadDefaultParser());
        // No stableNodeKey: the writer keeps the target document's own provenance and reconciliation link.
        const change: ProposedChange = { kind: "update_block", target: el.id, content: parse(args.markdown), ...(args.title ? { title: args.title } : {}) };
        const what = ref.kind === "page-preview" ? "Update page" : "Update block";
        return { set: { operationId, title: title(what), metadata: meta("update_block"), changes: [change] }, warnings: [] };
      }),
  );

  register(
    "render_visual_plan",
    {
      title: "Render visual plan",
      description:
        `Renders a VisualPlan onto the open canvas with Acute-Notes' own layout: you describe content and relationships, Acute-Notes decides ids, positions, sizes and styling. ` +
        `Templates: ${VISUAL_TEMPLATES.join(", ")}. Node: { id, type, content, role?, title?, importance?, parent? } where type/content is ` +
        `heading {text} | text {markdown} | todo {items:[{text,checked}]} | table {columns,rows} | code {language?,source} | page {title,markdown} | ` +
        `shape {shape: rectangle|diamond|ellipse or a diagram shape: ${COMPOSITE_SHAPES_DESCRIBED}; label} | group {label, arrangement} (sectioned template only; members name it as parent). ` +
        `Relationship: { from, to, type, label? } with type one of ${RELATION_TYPES.join(", ")}. At most ${MAX_PLAN_NODES} nodes. ` +
        `Invalid nodes or relationships are dropped and reported as warnings; the plan fails only when nothing usable is left.`,
    },
    {
      plan: z.object({
        version: z.literal(1),
        template: z.enum(VISUAL_TEMPLATES),
        nodes: z.array(z.record(z.string(), z.unknown())).min(1).max(1000),
        relationships: z.array(z.record(z.string(), z.unknown())).max(1000).optional(),
        metadata: z.object({ title: z.string().max(TEXT_LIMITS.planTitle).optional(), summary: z.string().max(TEXT_LIMITS.planSummary).optional() }).optional(),
      }),
      canvasId: canvasIdArg,
    },
    (args) =>
      proposeChangeSet(deps, args, (live, op) =>
        renderPlan(deps, live, op, args.plan, title(args.plan.metadata?.title?.trim() || templateFor(args.plan.template).name), meta("render_visual_plan")),
      ),
  );

  register(
    "delete_object",
    {
      title: "Delete objects",
      destructive: true,
      description:
        `Deletes objects (blocks, shapes, text, page previews) or connections from the open canvas — only after the user confirms it in the review; ` +
        `it is never applied on its own. A deleted object's label goes with it; arrows bound to it stay. A page preview's page stays in the workspace. ` +
        `Frames and locked objects can't be deleted here. At most ${DELETE_LIMIT} ids per call.`,
    },
    {
      objectIds: z.array(id).min(1).max(DELETE_LIMIT).describe("The objects or connections to delete (ids from get_canvas, search_workspace or get_selected_content)."),
      canvasId: canvasIdArg,
    },
    (args) =>
      proposeChangeSet(deps, args, (live, operationId) => {
        const ids = [...new Set(args.objectIds)];
        const elements = live.elements();
        const problems: string[] = [];
        for (const objectId of ids) {
          const el = elements.find((e) => e.id === objectId && !e.isDeleted);
          if (!el || !(isStandalone(el) || el.type === "arrow")) problems.push(`${objectId}: not on the open canvas`);
          else if (el.type === "frame") problems.push(`${objectId}: a frame — delete its objects instead`);
          else if (el.locked) problems.push(`${objectId}: locked by the user`);
        }
        // All or nothing: a partial delete would surprise the user more than a clear refusal.
        if (problems.length) throw new ToolFailure(`Nothing was proposed. ${problems.slice(0, 10).join("; ")}${problems.length > 10 ? "; …" : ""}.`);
        const changes: ProposedChange[] = ids.map((target) => ({ kind: "remove", target }));
        return { set: { operationId, title: title(`Delete ${plural(ids.length, "object")}`), metadata: meta("delete_object"), changes }, warnings: [] };
      }),
  );
}
