/**
 * Reads MCP resources from persisted state (F20), written purely against the
 * repository interfaces, so it works over IndexedDB or the in-memory
 * repositories alike.
 *
 * Scoped: a reader serves exactly one workspace. Anything that belongs to
 * another workspace (a canvas moved away, a document id guessed from outside)
 * is "not found", exactly like something that doesn't exist, so the answer
 * never reveals that other workspaces exist.
 *
 * Takes only the repositories it needs. AI connections, conversations,
 * content sources, assets and meta are not reachable from here.
 */
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { WorkspaceScan, type McpReadServices } from "./workspaceScan";
import { isStandalone } from "../context/currentContext";
import {
  canvasLink,
  pageLink,
  RESOURCE_LIMITS,
  serializeCanvas,
  serializePage,
  serializeTable,
  serializeTodo,
  serializeWorkspace,
  sortPages,
  type BlockObject,
  type CanvasResource,
  type PageResource,
  type ResourceLink,
  type TableResource,
  type TodoResource,
  type WorkspaceResource,
} from "./serializers";
import { resourceUri } from "./uris";
import { encodeCursor, pageStart, queryHash, sceneVersion } from "@/domain/lens/paging";

export type { McpReadServices } from "./workspaceScan";

/** A page cursor that doesn't continue this listing at this version (G2): the caller starts again. */
export class PageCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PageCursorError";
  }
}

export class ResourceReader {
  private readonly scan: WorkspaceScan;

  constructor(
    private readonly services: McpReadServices,
    readonly workspaceId: string,
  ) {
    this.scan = new WorkspaceScan(services, workspaceId);
  }

  async workspace(id: string): Promise<WorkspaceResource | null> {
    if (id !== this.workspaceId) return null;
    const ws = await this.services.workspaces.get(id);
    if (!ws) return null;
    const [canvases, pages] = await Promise.all([this.scan.canvases(), this.services.documents.listByWorkspace(id, "page")]);
    return serializeWorkspace(ws, canvases, pages);
  }

  /**
   * A canvas's objects, a page at a time (Lens Phase 3, G2): the first `limit` objects (default
   * `RESOURCE_LIMITS.objects`), or the page `cursor` continues. A cursor is tied to the scene version it was cut
   * from; one from before an edit (or from another query) throws `PageCursorError` rather than mixing two versions.
   */
  async canvas(id: string, paging: { cursor?: string; limit?: number } = {}): Promise<CanvasResource | null> {
    const canvas = await this.scan.canvas(id);
    if (!canvas) return null;
    const elements = await this.scan.scene(canvas.id);
    const limit = Math.min(Math.max(1, paging.limit ?? RESOURCE_LIMITS.objects), RESOURCE_LIMITS.objects);
    const version = sceneVersion([{ canvasId: canvas.id, elements }]);
    const query = queryHash({ canvasId: canvas.id, limit });
    const start = pageStart(paging.cursor, "canvas", version, query);
    if (!start.ok) throw new PageCursorError(start.message);
    const standalone = elements.filter(isStandalone);
    // Only the documents the listed objects embed, and only this workspace's.
    const ids = new Set<string>();
    for (const el of standalone.slice(start.offset, start.offset + limit)) {
      const ref = getEmbedRef(el);
      if (ref) ids.add(ref.kind === "rich-block" ? ref.documentId : ref.pageId);
    }
    const docs = await this.scan.documents(ids);
    const out = serializeCanvas(canvas, elements, (docId) => docs.get(docId), { offset: start.offset, limit });
    const next = start.offset + limit;
    return { ...out, page: { offset: start.offset, limit, version, ...(next < standalone.length ? { nextCursor: encodeCursor({ k: "canvas", v: version, o: next, q: query }) } : {}) } };
  }

  async page(id: string): Promise<PageResource | null> {
    const rec = await this.services.documents.get(id);
    return rec && rec.kind === "page" && rec.workspaceId === this.workspaceId ? serializePage(rec) : null;
  }

  async todo(objectId: string): Promise<TodoResource | null> {
    const obj = await this.blockObject("todo", objectId);
    return obj ? serializeTodo(obj) : null;
  }

  async table(objectId: string): Promise<TableResource | null> {
    const obj = await this.blockObject("table", objectId);
    return obj ? serializeTable(obj) : null;
  }

  // -------------------------------------------------------------------------
  // Listing (MCP `resources/list`), each capped
  // -------------------------------------------------------------------------

  async listWorkspaces(): Promise<ResourceLink[]> {
    const ws = await this.services.workspaces.get(this.workspaceId);
    return ws ? [{ id: ws.id, title: ws.name, uri: resourceUri("workspace", ws.id), updatedAt: ws.updatedAt }] : [];
  }

  async listCanvases(): Promise<ResourceLink[]> {
    return (await this.scan.canvases(RESOURCE_LIMITS.canvases)).map(canvasLink);
  }

  async listPages(): Promise<ResourceLink[]> {
    return sortPages(await this.services.documents.listByWorkspace(this.workspaceId, "page"))
      .slice(0, RESOURCE_LIMITS.pages)
      .map(pageLink);
  }

  /** Todo or table blocks across the workspace's canvases, in canvas then z-order. */
  async listBlocks(kind: "todo" | "table", limit: number = RESOURCE_LIMITS.objects): Promise<ResourceLink[]> {
    const found: { el: SceneElement; documentId: string }[] = [];
    for (const canvas of await this.scan.canvases()) {
      for (const el of await this.scan.scene(canvas.id)) {
        const ref = el.isDeleted ? null : getEmbedRef(el);
        if (ref?.kind === "rich-block" && ref.blockType === kind) found.push({ el, documentId: ref.documentId });
        if (found.length >= limit) break;
      }
      if (found.length >= limit) break;
    }
    const docs = await this.scan.documents(found.map((f) => f.documentId));
    return found.flatMap(({ el, documentId }) => {
      const rec = docs.get(documentId);
      return rec ? [{ id: el.id, title: rec.title.trim() || (kind === "todo" ? "To-do list" : "Table"), uri: resourceUri(kind, el.id), updatedAt: rec.updatedAt }] : [];
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** The todo/table block whose canvas element is `objectId`, on one of this workspace's canvases. */
  private async blockObject(kind: "todo" | "table", objectId: string): Promise<BlockObject | null> {
    for (const canvas of await this.scan.canvases()) {
      const element = (await this.scan.scene(canvas.id)).find((el) => el.id === objectId && !el.isDeleted);
      if (!element) continue;
      const ref = getEmbedRef(element);
      if (ref?.kind !== "rich-block" || ref.blockType !== kind) return null;
      const record = (await this.scan.documents([ref.documentId])).get(ref.documentId);
      return record ? { canvas, element, record } : null;
    }
    return null;
  }
}
