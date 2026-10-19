/**
 * Persisted canvases, scenes and documents of one workspace: the one loader
 * behind `ResourceReader` and the MCP tools that look across objects
 * (`search_workspace`, `get_related_objects`). Another workspace's canvas or
 * document is invisible, and only the repositories resources may use are
 * reachable.
 */
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { CanvasDocument, DocumentRecord } from "@/domain/types";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { SceneBinding } from "@/sync/sceneBinding";

/** The repositories MCP reads may use (and nothing else). */
export type McpReadServices = Pick<PersistenceServices, "workspaces" | "canvases" | "documents" | "yupdates">;

export type VersionedSceneElement = SceneElement & { version: number; index?: string | null };

export class WorkspaceScan {
  constructor(
    private readonly services: McpReadServices,
    readonly workspaceId: string,
  ) {}

  /** This workspace's canvases, in its canvas order, at most `limit`. */
  async canvases(limit = Infinity): Promise<CanvasDocument[]> {
    const ws = await this.services.workspaces.get(this.workspaceId);
    if (!ws) return [];
    const all = await this.services.canvases.listByWorkspace(this.workspaceId);
    const byId = new Map(all.filter((c) => c.workspaceId === this.workspaceId).map((c) => [c.id, c] as const));
    return ws.canvasIds
      .map((id) => byId.get(id))
      .filter((c): c is CanvasDocument => !!c)
      .slice(0, limit);
  }

  /** This workspace's canvas `id`, or null. */
  async canvas(id: string): Promise<CanvasDocument | null> {
    const canvas = await this.services.canvases.get(id);
    return canvas && canvas.workspaceId === this.workspaceId ? canvas : null;
  }

  /** A canvas's persisted scene in z-order (deleted elements included). */
  async scene(canvasId: string): Promise<VersionedSceneElement[]> {
    const doc = new Y.Doc();
    try {
      const { updates } = await this.services.yupdates.load(canvasDocId(canvasId));
      for (const u of updates) Y.applyUpdate(doc, u);
      return new SceneBinding(doc.getMap<VersionedSceneElement>("elements")).readScene();
    } finally {
      doc.destroy();
    }
  }

  /** Documents by id, keeping only this workspace's. */
  async documents(ids: Iterable<string>): Promise<Map<string, DocumentRecord>> {
    const unique = [...new Set(ids)];
    const recs = unique.length ? await this.services.documents.getMany(unique) : [];
    const out = new Map<string, DocumentRecord>();
    for (const rec of recs) if (rec && rec.workspaceId === this.workspaceId) out.set(rec.id, rec);
    return out;
  }

  /** This workspace's pages. */
  async pages(): Promise<DocumentRecord[]> {
    return (await this.services.documents.listByWorkspace(this.workspaceId, "page")).filter((p) => p.kind === "page" && p.workspaceId === this.workspaceId);
  }
}
