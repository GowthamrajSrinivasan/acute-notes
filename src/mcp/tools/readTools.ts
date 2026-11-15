/**
 * Read tools (F21): safe, bounded, scoped to one workspace. `get_canvas` and
 * `get_page` return exactly the payloads of `acute://canvas/{id}` and
 * `acute://page/{id}` (same reader, same serializers), so a client sees the
 * same shapes whichever way it asks.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { labelsOf } from "@/ai/context/selectionContext";
import { getArrowRelation, getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { RELATION_TYPES, type RelationType } from "@/domain/types";
import { cut, describeObject, isStandalone, type ContextObject, type CurrentContext } from "../context/currentContext";
import type { ResourceReader } from "../resources/reader";
import { RESOURCE_LIMITS } from "../resources/serializers";
import { resourceUri } from "../resources/uris";
import { guarded, plural, READ_ANNOTATIONS, ToolFailure, toolResult } from "./common";
import { McpSearchIndex, SEARCH_KINDS, SEARCH_LIMITS } from "./search";
import { registerStudyTools } from "./studyTools";
import type { WorkspaceScan } from "../resources/workspaceScan";
import type { MetaRepository } from "@/persistence/repositories/types";

export const READ_TOOL_NAMES = ["search_workspace", "get_canvas", "get_page", "get_selected_content", "get_related_objects", "suggest_placement", "get_consistency", "get_weak_concepts"] as const;

export const PLACEMENT_LIMITS = { contentChars: 4_000, defaultResults: 5, maxResults: 10 } as const;

export const RELATED_LIMITS = { defaultResults: 25, maxResults: 50, canvases: 100 } as const;

export interface ReadToolDeps {
  reader: ResourceReader;
  scan: WorkspaceScan;
  workspaceId: string;
  /** The current context, already scoped: null unless it is this workspace's. */
  currentContext(): Promise<CurrentContext | null>;
  /** The device's meta store, read-only (`get_consistency`, `get_weak_concepts`). Absent: those tools say so. */
  meta?: Pick<MetaRepository, "get">;
}

const id = z.string().min(1).max(200);
const quote = (s: string | undefined, fallback = "Untitled") => `"${cut((s ?? "").trim() || fallback, 60).text}"`;
const nameOf = (o: ContextObject) => (o.title ? quote(o.title) : o.excerpt ? quote(o.excerpt.split("\n")[0]) : `a ${o.kind}`);

export interface RelatedObject {
  /** "outgoing": the arrow starts at the given object; "incoming": it ends there. */
  direction: "outgoing" | "incoming";
  arrowId: string;
  relation?: RelationType;
  label?: string;
  object: ContextObject;
}

export interface RelatedObjectsResult {
  objectId: string;
  canvasId: string;
  canvasUri: string;
  object: ContextObject;
  related: RelatedObject[];
  counts: { related: number };
  truncated: boolean;
}

/** Objects connected to `objectId` by arrows bound at both ends, in z-order of the arrows. */
async function relatedObjects(
  scan: WorkspaceScan,
  input: { objectId: string; canvasId?: string; relation?: RelationType; limit?: number },
): Promise<RelatedObjectsResult | null> {
  const limit = Math.min(input.limit ?? RELATED_LIMITS.defaultResults, RELATED_LIMITS.maxResults);
  const canvases = input.canvasId ? [await scan.canvas(input.canvasId)].filter((c) => !!c) : await scan.canvases(RELATED_LIMITS.canvases);
  for (const canvas of canvases) {
    const elements = await scan.scene(canvas!.id);
    const live = new Map(elements.filter((el) => !el.isDeleted).map((el) => [el.id, el] as const));
    const target = live.get(input.objectId);
    if (!target || !isStandalone(target)) continue;

    const links: { el: SceneElement; direction: RelatedObject["direction"]; arrow: SceneElement }[] = [];
    for (const a of live.values()) {
      if (a.type !== "arrow") continue;
      const from = a.startBinding?.elementId;
      const to = a.endBinding?.elementId;
      if (!from || !to || from === to) continue;
      const otherId = from === target.id ? to : to === target.id ? from : null;
      const other = otherId ? live.get(otherId) : undefined;
      if (!other || !isStandalone(other)) continue;
      if (input.relation && getArrowRelation(a) !== input.relation) continue;
      links.push({ el: other, direction: from === target.id ? "outgoing" : "incoming", arrow: a });
    }
    const listed = links.slice(0, limit);

    const docIds: string[] = [];
    for (const el of [target, ...listed.map((l) => l.el)]) {
      const ref = getEmbedRef(el);
      if (ref) docIds.push(ref.kind === "rich-block" ? ref.documentId : ref.pageId);
    }
    const docs = await scan.documents(docIds);
    const labels = labelsOf(elements);
    let truncated = links.length > limit;
    const describe = (el: SceneElement) => {
      const d = describeObject(el, labels, (docId) => docs.get(docId), RESOURCE_LIMITS.objectExcerpt);
      truncated ||= d.truncated;
      return d.object;
    };
    const object = describe(target);
    const related = listed.map(({ el, direction, arrow }): RelatedObject => {
      const relation = getArrowRelation(arrow);
      const label = labels.get(arrow.id)?.trim();
      return {
        direction,
        arrowId: arrow.id,
        ...(relation ? { relation } : {}),
        ...(label ? { label: cut(label, RESOURCE_LIMITS.title).text } : {}),
        object: describe(el),
      };
    });
    return { objectId: target.id, canvasId: canvas!.id, canvasUri: resourceUri("canvas", canvas!.id), object, related, counts: { related: links.length }, truncated };
  }
  return null;
}

export function registerReadTools(server: McpServer, deps: ReadToolDeps): void {
  const { reader, scan } = deps;
  // One index per session: each search re-indexes only what changed since the last one.
  const search = new McpSearchIndex(scan);

  server.registerTool(
    "search_workspace",
    {
      title: "Search workspace",
      description:
        "Deterministic text search across this workspace: page titles and bodies, canvas titles, block text (text, todo items, table cells, code), " +
        "shape labels and free canvas text. Every word of the query must appear (case-insensitive). Returns stable ids, kinds, " +
        "a snippet, and the resource URI to read each hit in full, best first.",
      inputSchema: {
        query: z.string().trim().min(1).max(SEARCH_LIMITS.queryChars).describe("Words to find; all must appear."),
        limit: z.number().int().min(1).max(SEARCH_LIMITS.maxResults).optional().describe(`At most this many hits (default ${SEARCH_LIMITS.defaultResults}).`),
        kinds: z.array(z.enum(SEARCH_KINDS)).max(SEARCH_KINDS.length).optional().describe("Only these kinds of results."),
      },
      annotations: READ_ANNOTATIONS,
    },
    (args) =>
      guarded(async () => {
        const result = await search.search(args.query, { ...(args.limit ? { limit: args.limit } : {}), ...(args.kinds ? { kinds: args.kinds } : {}) });
        const top = result.hits
          .slice(0, 5)
          .map((h) => `${h.kind} ${quote(h.title ?? h.snippet)} (${h.id})`)
          .join("; ");
        const summary = result.total
          ? `${plural(result.total, "match", "matches")} for ${quote(args.query)}${result.truncated ? ` (showing ${result.hits.length})` : ""}: ${top}${result.hits.length > 5 ? "; …" : ""}`
          : `No matches for ${quote(args.query)}.`;
        return toolResult(summary, result);
      }),
  );

  server.registerTool(
    "suggest_placement",
    {
      title: "Suggest placement",
      description:
        "Where new content with no source (a note, a finding, a pasted line) belongs on a canvas: the cards it fits with, best first, each with " +
        "what to do there (`update`: the card already makes this claim — edit that sentence; `insert_near`: add a new card beside it, in its section; " +
        "`none`: it already says this), the claim and its intent (SUPERSEDES, EXTENDS, CONTRADICTS…), the evidence, and two separate confidences: " +
        "`routing` (is this the right place?) and `update` (does the edit take the new information in correctly?). `decision` is `route`, " +
        "`NEEDS_CLARIFICATION` (two places fit about equally — ask the user) or `NEW` (no card is close: create one). Deterministic, no model, " +
        "read-only: apply a choice with update_block (an update) or create_block (a new card), which the user reviews. A CONTRADICTS claim needs the " +
        "user's decision; never apply it on your own.",
      inputSchema: {
        content: z.string().trim().min(1).max(PLACEMENT_LIMITS.contentChars).describe("The content to place."),
        canvasId: id.optional().describe("Defaults to the open canvas."),
        limit: z.number().int().min(1).max(PLACEMENT_LIMITS.maxResults).optional().describe(`At most this many candidates (default ${PLACEMENT_LIMITS.defaultResults}).`),
      },
      annotations: READ_ANNOTATIONS,
    },
    (args) =>
      guarded(async () => {
        const canvasId = args.canvasId ?? (await deps.currentContext())?.canvas.id;
        if (!canvasId) throw new ToolFailure("No canvasId was given and no canvas of this workspace is open.");
        const r = await search.route(args.content, canvasId, args.limit ?? PLACEMENT_LIMITS.defaultResults);
        const candidates = r.candidates.map((c) => ({
          id: c.id,
          title: c.descriptor.title,
          ...(c.descriptor.section ? { section: c.descriptor.section.name } : {}),
          summary: c.descriptor.summary,
          action: c.action,
          routingConfidence: c.routing,
          updateConfidence: c.update,
          ...(c.claim ? { claim: { sentence: c.claim.sentence, intent: c.claim.intent, needsDecision: c.claim.escalate } } : {}),
          evidence: c.evidence,
        }));
        const top = r.candidates[0];
        const summary =
          r.decision === "NEW"
            ? `No card on this canvas is close to this content: create a new card.`
            : r.decision === "NEEDS_CLARIFICATION"
              ? `More than one place fits about equally (${r.reason}): ask the user which.`
              : `Best fit: ${quote(top!.descriptor.title)} (${top!.id}) — ${top!.action === "update" ? "update the card" : top!.action === "none" ? "it already says this" : "add a card beside it"}; routing ${top!.routing}, update ${top!.update}.`;
        return toolResult(summary, { canvasId, decision: r.decision, reason: r.reason, candidates, sections: r.sections.slice(0, 5).map((s) => ({ id: s.section.id, name: s.section.name, score: s.score })) });
      }),
  );

  server.registerTool(
    "get_consistency",
    {
      title: "Get consistency",
      description:
        "Cards on a canvas that may disagree with each other (the consistency check after each accepted change, Stage 4): each pair's two " +
        "statements and cards, why (`reason`), how sure the rules are (`strength`: `conflict` = they can't both be true, `possible` = needs a " +
        "look, e.g. a different environment or time), and its status (`possible`, `confirmed` by the user, `deferred`). Read-only: only the user " +
        "decides or resolves a conflict. Don't edit a card to settle one unless the user asks; a fix goes through update_block, which they review.",
      inputSchema: {
        canvasId: id.optional().describe("Defaults to the open canvas."),
        includeDeferred: z.boolean().optional().describe("Also list deferred ones (default false)."),
      },
      annotations: READ_ANNOTATIONS,
    },
    (args) =>
      guarded(async () => {
        const canvasId = args.canvasId ?? (await deps.currentContext())?.canvas.id;
        if (!canvasId) throw new ToolFailure("No canvasId was given and no canvas of this workspace is open.");
        if (!deps.meta) throw new ToolFailure("Consistency records aren't available in this connection.");
        const stored = (await deps.meta.get<unknown[]>(`consistency.${canvasId}`)) ?? [];
        type Stored = { id: string; status: string; strength: string; kind: string; a: { elementId: string; cardName: string; sentence: string }; b: { elementId: string; cardName: string; sentence: string }; evidence?: { reason?: string } };
        const wanted = new Set(["possible", "confirmed", ...(args.includeDeferred ? ["deferred"] : [])]);
        const conflicts = (Array.isArray(stored) ? (stored as Stored[]) : [])
          .filter((c) => c && wanted.has(c.status))
          .slice(0, 50)
          .map((c) => ({ id: c.id, status: c.status, strength: c.strength, kind: c.kind, reason: c.evidence?.reason ?? "", a: c.a, b: c.b }));
        const confirmed = conflicts.filter((c) => c.status === "confirmed").length;
        const summary = conflicts.length
          ? `${plural(conflicts.length, "possible conflict", "possible conflicts")} on this canvas (${confirmed} confirmed by the user). Tell the user; don't resolve them yourself.`
          : "No open conflicts on this canvas.";
        return toolResult(summary, { canvasId, conflicts });
      }),
  );

  server.registerTool(
    "get_canvas",
    {
      title: "Get canvas",
      description:
        "A canvas's objects in z-order (stable id, typed kind, bounds, excerpt, provenance, resource URI) and the typed relations between them; " +
        "the same payload as acute://canvas/{canvasId}. Defaults to the canvas the user has open. " +
        `Paged: at most ${RESOURCE_LIMITS.objects} objects per call (\`limit\` for fewer); when \`page.nextCursor\` is set, pass it as \`cursor\` (with the same canvasId and limit) for the next objects. ` +
        "A cursor is tied to the canvas version: after an edit it is refused, and you start again without it.",
      inputSchema: {
        canvasId: id.optional().describe("Defaults to the open canvas."),
        limit: z.number().int().min(1).max(RESOURCE_LIMITS.objects).optional().describe(`Objects per page (default ${RESOURCE_LIMITS.objects}).`),
        cursor: z.string().min(1).max(500).optional().describe("page.nextCursor from the previous page."),
      },
      annotations: READ_ANNOTATIONS,
    },
    (args) =>
      guarded(async () => {
        const canvasId = args.canvasId ?? (await deps.currentContext())?.canvas.id;
        if (!canvasId) throw new ToolFailure("No canvasId was given and no canvas of this workspace is open.");
        const canvas = await reader.canvas(canvasId, { ...(args.cursor ? { cursor: args.cursor } : {}), ...(args.limit ? { limit: args.limit } : {}) });
        if (!canvas) throw new ToolFailure(`Canvas not found: ${canvasId}`);
        const shown = canvas.page && (canvas.page.offset > 0 || canvas.page.nextCursor) ? ` (objects ${canvas.page.offset + 1}–${canvas.page.offset + canvas.objects.length}${canvas.page.nextCursor ? "; more with page.nextCursor" : ""})` : "";
        const summary = `Canvas ${quote(canvas.title)} (${canvas.id}): ${plural(canvas.counts.objects, "object")}, ${plural(canvas.counts.relations, "relation")}${shown || (canvas.truncated ? " (truncated)" : "")}.`;
        return toolResult(summary, canvas);
      }),
  );

  server.registerTool(
    "get_page",
    {
      title: "Get page",
      description: "A page's content as GFM Markdown, with its title and provenance; the same payload as acute://page/{pageId}.",
      inputSchema: { pageId: id },
      annotations: READ_ANNOTATIONS,
    },
    (args) =>
      guarded(async () => {
        const page = await reader.page(args.pageId);
        if (!page) throw new ToolFailure(`Page not found: ${args.pageId}`);
        return toolResult(`Page ${quote(page.title)} (${page.id}): ${plural(page.counts.characters, "character")}${page.truncated ? " (truncated)" : ""}.`, page);
      }),
  );

  server.registerTool(
    "get_selected_content",
    {
      title: "Get selected content",
      description:
        "What the user has selected on the open canvas: each object's id, kind, bounds and excerpt (read its URI for more), " +
        "the relations among them, and the open page. `available: false` when no canvas of this workspace is open.",
      inputSchema: {},
      annotations: READ_ANNOTATIONS,
    },
    () =>
      guarded(async () => {
        const ctx = await deps.currentContext();
        if (!ctx) return toolResult("No canvas of this workspace is open.", { available: false });
        const selected = new Set(ctx.selection.map((o) => o.id));
        const payload = {
          available: true,
          workspace: ctx.workspace,
          canvas: ctx.canvas,
          selection: ctx.selection,
          relations: ctx.relations.filter((r) => selected.has(r.from) && selected.has(r.to)),
          openPage: ctx.openPage,
          truncated: ctx.truncated,
        };
        const summary = ctx.selection.length
          ? `${plural(ctx.selection.length, "object")} selected on ${quote(ctx.canvas.title)}: ${ctx.selection.slice(0, 5).map(nameOf).join(", ")}${ctx.selection.length > 5 ? ", …" : ""}.`
          : `Nothing is selected on ${quote(ctx.canvas.title)}.`;
        return toolResult(summary, payload);
      }),
  );

  server.registerTool(
    "get_related_objects",
    {
      title: "Get related objects",
      description:
        "Objects connected to a canvas object by arrows, with each connection's direction, relation type (e.g. depends_on, flows_to) and label. " +
        "Searches this workspace's canvases for the object unless canvasId is given.",
      inputSchema: {
        objectId: id.describe("A canvas object id (from get_canvas, search_workspace or get_selected_content)."),
        canvasId: id.optional(),
        relation: z.enum(RELATION_TYPES).optional().describe("Only connections of this relation type."),
        limit: z.number().int().min(1).max(RELATED_LIMITS.maxResults).optional().describe(`At most this many (default ${RELATED_LIMITS.defaultResults}).`),
      },
      annotations: READ_ANNOTATIONS,
    },
    (args) =>
      guarded(async () => {
        const result = await relatedObjects(scan, args);
        if (!result) throw new ToolFailure(`Object not found: ${args.objectId}`);
        const list = result.related
          .slice(0, 5)
          .map((r) => `${r.direction === "outgoing" ? "→" : "←"} ${r.relation ?? "connected"} ${nameOf(r.object)}`)
          .join("; ");
        const summary = result.counts.related
          ? `${nameOf(result.object)} has ${plural(result.counts.related, "connection")}: ${list}${result.related.length > 5 ? "; …" : ""}`
          : `${nameOf(result.object)} has no connections.`;
        return toolResult(summary, result);
      }),
  );

  // Study Mode Phase 4 (study-mode plan §6): `get_weak_concepts`, read-only, same workspace scope and meta reader.
  registerStudyTools(server, { scan, workspaceId: deps.workspaceId, currentContext: deps.currentContext, ...(deps.meta ? { meta: deps.meta } : {}) });
}
