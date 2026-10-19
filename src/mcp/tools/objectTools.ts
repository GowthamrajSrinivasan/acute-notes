/**
 * Phase 7C's core object tools (plan D50, D62): `update_connection`, `delete_connection`, `group_blocks` on the
 * change-set path, and the bounded reads `list_blocks` and `get_block`. (`delete_object`, the one delete tool, is in
 * `writeTools.ts` and already takes a list of ids.) Every write is a reviewed change set in this MCP session's slot,
 * attributed and logged with its inverse like any other (D30, D32, D40), so it can be reverted; none is auto-accepted.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { getArrowRelation, getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { getEdgeSemantics, getNodeLens, getNodeProject, getNodeSemantics } from "@/domain/canvas/diagram";
import { contentToMarkdown } from "@/domain/content/markdown";
import { RELATION_TYPES } from "@/domain/types";
import { cut, isStandalone } from "../context/currentContext";
import type { WorkspaceScan } from "../resources/workspaceScan";
import { DELETE_ANNOTATIONS, guarded, READ_ANNOTATIONS, ToolFailure, toolResult, WRITE_ANNOTATIONS, type ToolPolicy } from "./common";
import type { LiveCanvasActions } from "./liveCanvas";
import { PROPOSED_SHAPE, proposeChangeSet, sanitizeClientName, type WriteToolDeps } from "./writeTools";

export const OBJECT_READ_TOOLS = ["list_blocks", "get_block"] as const;
export const OBJECT_WRITE_TOOLS = ["update_connection", "delete_connection", "group_blocks"] as const;

export const OBJECT_LIMITS = { list: 200, groupMembers: 100, deleteConnections: 50, content: 8_000 } as const;

export interface ObjectToolDeps {
  workspaceId: string;
  scan: WorkspaceScan;
  liveCanvas(): LiveCanvasActions | null;
  policy(): ToolPolicy;
  clientName(): string | undefined;
  sessionId(): string;
}

const id = z.string().trim().min(1).max(200);
const canvasArg = id.optional().describe("The canvas; defaults to the open one.");

/** A canvas's elements: the open one live, another as persisted (read-only). */
async function sceneOf(deps: ObjectToolDeps, canvasId: string | undefined): Promise<{ canvasId: string; elements: readonly SceneElement[] }> {
  const live = deps.liveCanvas();
  const open = live && live.workspaceId === deps.workspaceId ? live : null;
  const target = canvasId ?? open?.canvasId;
  if (!target) throw new ToolFailure("No canvas of this workspace is open; pass `canvasId`.");
  if (open && target === open.canvasId) return { canvasId: target, elements: open.elements() };
  if (!(await deps.scan.canvas(target))) throw new ToolFailure(`No canvas ${target} in this workspace.`);
  return { canvasId: target, elements: await deps.scan.scene(target) };
}

const labelsOf = (elements: readonly SceneElement[]) => {
  const m = new Map<string, string>();
  for (const el of elements) if (!el.isDeleted && el.type === "text" && el.containerId) m.set(el.containerId, (el.originalText ?? el.text ?? "").trim());
  return m;
};

/** What a block is, in one word: its rich-block type, "page", the shape, "note" for free text. */
function kindOf(el: SceneElement): string {
  const ref = getEmbedRef(el);
  if (ref?.kind === "rich-block") return ref.blockType;
  if (ref?.kind === "page-preview") return "page";
  if (el.type === "text") return "note";
  return el.type;
}

export function registerObjectTools(server: McpServer, deps: ObjectToolDeps): void {
  const client = () => sanitizeClientName(deps.clientName());
  const title = (what: string) => `${client() ?? "MCP"}: ${what}`.slice(0, 200);
  const meta = (task: string): ChangeSet["metadata"] => ({ createdBy: "mcp", task, ...(client() ? { provider: client()! } : {}) });
  const writeDeps: WriteToolDeps = { workspaceId: deps.workspaceId, liveCanvas: deps.liveCanvas, policy: deps.policy, clientName: deps.clientName, sessionId: deps.sessionId };

  const write = <S extends z.ZodRawShape>(name: (typeof OBJECT_WRITE_TOOLS)[number], t: string, description: string, inputSchema: S, destructive: boolean, run: (args: z.infer<z.ZodObject<S>>) => Promise<ReturnType<typeof toolResult>>) =>
    server.registerTool(
      name,
      {
        title: t,
        description: `${description} Proposes a change for the user's review; nothing changes until they accept it. Logged and revertible (revert_agent_changes). Never auto-accepted.`,
        inputSchema,
        outputSchema: PROPOSED_SHAPE,
        annotations: destructive ? DELETE_ANNOTATIONS : WRITE_ANNOTATIONS,
      },
      ((args: z.infer<z.ZodObject<S>>) => guarded(() => run(args))) as never,
    );
  const read = <S extends z.ZodRawShape>(name: (typeof OBJECT_READ_TOOLS)[number], t: string, description: string, inputSchema: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<ReturnType<typeof toolResult>>) =>
    server.registerTool(name, { title: t, description, inputSchema, annotations: READ_ANNOTATIONS }, ((args: z.infer<z.ZodObject<S>>) => guarded(() => run(args))) as never);

  const liveArrow = (live: LiveCanvasActions, arrowId: string) => {
    const el = live.elements().find((e) => e.id === arrowId && !e.isDeleted);
    if (!el || el.type !== "arrow") throw new ToolFailure(`No connection ${arrowId} on the open canvas (get_canvas lists its relations by arrowId).`);
    if (el.locked) throw new ToolFailure(`Connection ${arrowId} is locked by the user.`);
    return el;
  };

  write(
    "update_connection",
    "Update connection",
    `Changes an existing connection on the open canvas: its relation type (${RELATION_TYPES.join(", ")}; the line style follows), its label, its explanation. A field given replaces, null clears, omitted is left as is.`,
    {
      connectionId: id.describe("The arrow's id (get_canvas → relations[].arrowId)."),
      relation: z.enum(RELATION_TYPES).nullable().optional(),
      label: z.string().trim().max(200).nullable().optional(),
      explanation: z.string().trim().max(300).nullable().optional(),
      canvasId: canvasArg,
    },
    false,
    (args) =>
      proposeChangeSet(writeDeps, args, (live, operationId) => {
        liveArrow(live, args.connectionId);
        if (args.relation === undefined && args.label === undefined && args.explanation === undefined) throw new ToolFailure("Nothing to change: pass relation, label or explanation.");
        const change: ProposedChange = {
          kind: "update_connection",
          target: args.connectionId,
          ...(args.relation !== undefined ? { relation: args.relation } : {}),
          ...(args.label !== undefined ? { label: args.label } : {}),
          ...(args.explanation !== undefined ? { explanation: args.explanation } : {}),
        };
        return { set: { operationId, title: title("Update connection"), metadata: meta("update_connection"), changes: [change] }, warnings: [] };
      }),
  );

  write(
    "delete_connection",
    "Delete connections",
    `Deletes connections (arrows) from the open canvas, with their labels; the objects they joined stay. At most ${OBJECT_LIMITS.deleteConnections} per call. (delete_object deletes objects.)`,
    { connectionIds: z.array(id).min(1).max(OBJECT_LIMITS.deleteConnections), canvasId: canvasArg },
    true,
    (args) =>
      proposeChangeSet(writeDeps, args, (live, operationId) => {
        const ids = [...new Set(args.connectionIds)];
        for (const a of ids) liveArrow(live, a);
        return { set: { operationId, title: title(`Delete ${ids.length} connection${ids.length === 1 ? "" : "s"}`), metadata: meta("delete_connection"), changes: ids.map((target) => ({ kind: "remove", target })) }, warnings: [] };
      }),
  );

  write(
    "group_blocks",
    "Group blocks",
    `Puts existing objects of the open canvas in a new titled section (a frame around them). Frames can't nest: objects already in a section, arrows and frames are refused. At most ${OBJECT_LIMITS.groupMembers} objects.`,
    { objectIds: z.array(id).min(1).max(OBJECT_LIMITS.groupMembers), title: z.string().trim().min(1).max(200), canvasId: canvasArg },
    false,
    (args) =>
      proposeChangeSet(writeDeps, args, (live, operationId) => {
        const elements = live.elements();
        const problems: string[] = [];
        const ids = [...new Set(args.objectIds)];
        for (const objectId of ids) {
          const el = elements.find((e) => e.id === objectId && !e.isDeleted);
          if (!el || !isStandalone(el)) problems.push(`${objectId}: not an object on the open canvas`);
          else if (el.type === "frame") problems.push(`${objectId}: a section itself`);
          else if (el.frameId) problems.push(`${objectId}: already in a section`);
          else if (el.locked) problems.push(`${objectId}: locked by the user`);
        }
        if (problems.length) throw new ToolFailure(`Nothing was proposed. ${problems.slice(0, 10).join("; ")}.`);
        return { set: { operationId, title: title(`Group ${ids.length} objects as "${cut(args.title, 60).text}"`), metadata: meta("group_blocks"), changes: [{ kind: "group_objects", key: "group", title: args.title, targets: ids }] }, warnings: [] };
      }),
  );

  read(
    "list_blocks",
    "List blocks",
    `The objects on a canvas (the open one by default): id, kind, title or label, its section, its Lens key when it has one, bounds. Filter by \`kind\` (text, todo, table, code, page, note, rectangle, ellipse, diamond, image, frame). At most ${OBJECT_LIMITS.list}; \`truncated\` says when there were more. Read get_block for one object's content.`,
    { canvasId: canvasArg, kind: z.string().trim().min(1).max(40).optional(), limit: z.number().int().min(1).max(OBJECT_LIMITS.list).optional() },
    async (args) => {
      const { canvasId, elements } = await sceneOf(deps, args.canvasId);
      const labels = labelsOf(elements);
      const all = elements.filter((el) => isStandalone(el) && (!args.kind || kindOf(el) === args.kind));
      const limit = args.limit ?? OBJECT_LIMITS.list;
      const blocks = all.slice(0, limit).map((el) => {
        const frameName = el.type === "frame" ? (el as { name?: string | null }).name ?? undefined : undefined;
        const label = labels.get(el.id) ?? (el.type === "text" ? (el.originalText ?? el.text ?? "").trim() : frameName);
        const key = getNodeLens(el)?.key;
        return {
          id: el.id,
          kind: kindOf(el),
          ...(label ? { title: cut(label, 120).text } : {}),
          ...(el.frameId ? { section: el.frameId } : {}),
          ...(key ? { key } : {}),
          bounds: { x: Math.round(el.x), y: Math.round(el.y), width: Math.round(el.width), height: Math.round(el.height) },
        };
      });
      return toolResult(`${blocks.length} object${blocks.length === 1 ? "" : "s"} on ${canvasId}.`, { canvasId, blocks, total: all.length, truncated: all.length > blocks.length });
    },
  );

  read(
    "get_block",
    "Get block",
    `One object's content: a block's or page's Markdown (at most ${OBJECT_LIMITS.content} characters, \`truncated\` when cut), a shape's label with its node fields (kind, project fields, Lens key), a note's text; and its connections in and out.`,
    { id, canvasId: canvasArg },
    async (args) => {
      const { canvasId, elements } = await sceneOf(deps, args.canvasId);
      const el = elements.find((e) => e.id === args.id && !e.isDeleted);
      if (!el || !isStandalone(el)) throw new ToolFailure(`No object ${args.id} on canvas ${canvasId}.`);
      const labels = labelsOf(elements);
      const ref = getEmbedRef(el);
      let content: string | undefined;
      let titleText: string | undefined;
      if (ref?.kind === "rich-block" || ref?.kind === "page-preview") {
        const docId = ref.kind === "rich-block" ? ref.documentId : ref.pageId;
        const doc = (await deps.scan.documents([docId])).get(docId);
        if (doc) {
          content = contentToMarkdown(doc.snapshot);
          if (ref.kind === "page-preview") titleText = doc.title;
        }
      } else if (el.type === "text") content = (el.originalText ?? el.text ?? "").trim();
      else titleText = labels.get(el.id);
      const clipped = content !== undefined ? cut(content, OBJECT_LIMITS.content) : undefined;
      const relation = (a: SceneElement) => ({ arrowId: a.id, ...(getArrowRelation(a) ? { type: getArrowRelation(a) } : {}), ...(labels.get(a.id) ? { label: labels.get(a.id) } : {}), ...(getEdgeSemantics(a)?.explanation ? { explanation: getEdgeSemantics(a)!.explanation } : {}) });
      const arrows = elements.filter((a) => !a.isDeleted && a.type === "arrow");
      const semantics = getNodeSemantics(el);
      const project = getNodeProject(el);
      const key = getNodeLens(el)?.key;
      const payload = {
        id: el.id,
        canvasId,
        kind: kindOf(el),
        ...(titleText ? { title: titleText } : {}),
        ...(clipped ? { content: clipped.text, truncated: clipped.cut } : {}),
        ...(key ? { key } : {}),
        ...(semantics ? { node: semantics } : {}),
        ...(project ? { project } : {}),
        ...(el.frameId ? { section: el.frameId } : {}),
        outgoing: arrows.filter((a) => a.startBinding?.elementId === el.id).map((a) => ({ ...relation(a), to: a.endBinding?.elementId })),
        incoming: arrows.filter((a) => a.endBinding?.elementId === el.id).map((a) => ({ ...relation(a), from: a.startBinding?.elementId })),
      };
      return toolResult(`${payload.kind} ${el.id}${titleText ? ` "${cut(titleText, 60).text}"` : ""}.`, payload);
    },
  );
}
