/**
 * Workspace → canvas → page hierarchy commands, written purely against the
 * repository interfaces (no UI state), so they are testable with the memory
 * repositories and reusable by import, AI or MCP later.
 *
 * - A workspace owns an ordered list of canvases (`Workspace.canvasIds`).
 * - A canvas's blocks and pages are the documents whose `canvasId` is the
 *   canvas (see `integrity.ts` for the invariants).
 *
 * Callers must close an open canvas (unmount it and flush editors)
 * before deleting or moving it; these functions only touch storage.
 */
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";
import type { CanvasDocument, DocumentRecord, Workspace } from "@/domain/types";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { richDocKey } from "@/state/documentClone";

export const DEFAULT_WORKSPACE_NAME = "My workspace";
export const DEFAULT_CANVAS_TITLE = "Untitled canvas";

export interface WorkspaceNode {
  workspace: Workspace;
  /** In the workspace's canvas order. */
  canvases: CanvasDocument[];
}

export class HierarchyError extends Error {
  override name = "HierarchyError";
}

const clean = (value: string, fallback: string) => value.trim() || fallback;

/** Every workspace (oldest first) with its canvases. */
export async function listHierarchy(services: PersistenceServices): Promise<WorkspaceNode[]> {
  const workspaces = (await services.workspaces.list()).sort((a, b) => a.createdAt - b.createdAt);
  return Promise.all(
    workspaces.map(async (workspace) => {
      const byId = new Map((await services.canvases.listByWorkspace(workspace.id)).map((c) => [c.id, c]));
      const canvases = workspace.canvasIds.map((id) => byId.get(id)).filter((c): c is CanvasDocument => !!c);
      return { workspace, canvases };
    }),
  );
}

async function requireWorkspace(services: PersistenceServices, id: string): Promise<Workspace> {
  const workspace = await services.workspaces.get(id);
  if (!workspace) throw new HierarchyError(`Workspace ${id} not found`);
  return workspace;
}

async function requireCanvas(services: PersistenceServices, id: string): Promise<CanvasDocument> {
  const canvas = await services.canvases.get(id);
  if (!canvas) throw new HierarchyError(`Canvas ${id} not found`);
  return canvas;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

/** Creates a workspace with one empty canvas (a workspace is never empty). */
export async function createWorkspace(
  services: PersistenceServices,
  name = DEFAULT_WORKSPACE_NAME,
  id: string = newId("ws"),
): Promise<{ workspace: Workspace; canvas: CanvasDocument }> {
  const now = Date.now();
  const canvas: CanvasDocument = { id: newId("cv"), workspaceId: id, title: DEFAULT_CANVAS_TITLE, createdAt: now, updatedAt: now };
  const workspace: Workspace = { id, name: clean(name, DEFAULT_WORKSPACE_NAME), canvasIds: [canvas.id], createdAt: now, updatedAt: now };
  // Content first, then the workspace that references it.
  await services.canvases.put(canvas);
  await services.workspaces.put(workspace);
  return { workspace, canvas };
}

export async function renameWorkspace(services: PersistenceServices, id: string, name: string): Promise<Workspace> {
  const workspace = await requireWorkspace(services, id);
  const next = { ...workspace, name: clean(name, DEFAULT_WORKSPACE_NAME), updatedAt: Date.now() };
  await services.workspaces.put(next);
  return next;
}

/** Deletes a workspace with all its canvases, pages and blocks. Returns the deleted document ids. */
export async function deleteWorkspace(services: PersistenceServices, id: string): Promise<string[]> {
  const workspace = await requireWorkspace(services, id);
  // Unlist it first so a failure part-way never leaves a half-empty workspace visible.
  await services.workspaces.delete(id);
  const canvasIds = new Set([...workspace.canvasIds, ...(await services.canvases.listByWorkspace(id)).map((c) => c.id)]);
  const deleted: string[] = [];
  for (const canvasId of canvasIds) deleted.push(...(await deleteCanvasContent(services, canvasId)));
  // Anything left (orphaned blocks, pages of deleted canvases).
  for (const doc of await services.documents.listByWorkspace(id)) {
    await deleteDocument(services, doc.id);
    deleted.push(doc.id);
  }
  // The agent change log and its sessions (Lens Phase 7A) belong to the workspace too.
  await services.agentState.deleteByWorkspace(id);
  return deleted;
}

// ---------------------------------------------------------------------------
// Canvases
// ---------------------------------------------------------------------------

export async function createCanvas(
  services: PersistenceServices,
  workspaceId: string,
  title = DEFAULT_CANVAS_TITLE,
): Promise<CanvasDocument> {
  const workspace = await requireWorkspace(services, workspaceId);
  const now = Date.now();
  const canvas: CanvasDocument = { id: newId("cv"), workspaceId, title: clean(title, DEFAULT_CANVAS_TITLE), createdAt: now, updatedAt: now };
  await services.canvases.put(canvas);
  await services.workspaces.put({ ...workspace, canvasIds: [...workspace.canvasIds, canvas.id], updatedAt: now });
  return canvas;
}

export async function renameCanvas(services: PersistenceServices, id: string, title: string): Promise<CanvasDocument> {
  const canvas = await requireCanvas(services, id);
  const next = { ...canvas, title: clean(title, DEFAULT_CANVAS_TITLE), updatedAt: Date.now() };
  await services.canvases.put(next);
  return next;
}

/**
 * Deletes a canvas with its scene, pages and blocks. The last canvas of a
 * workspace cannot be deleted (delete the workspace instead). Returns the
 * deleted document ids.
 */
export async function deleteCanvas(services: PersistenceServices, id: string): Promise<string[]> {
  const canvas = await requireCanvas(services, id);
  const workspace = await services.workspaces.get(canvas.workspaceId);
  if (workspace) {
    const remaining = workspace.canvasIds.filter((c) => c !== id);
    if (!remaining.length) throw new HierarchyError("A workspace needs at least one canvas.");
    await services.workspaces.put({ ...workspace, canvasIds: remaining, updatedAt: Date.now() });
  }
  return deleteCanvasContent(services, id);
}

/**
 * Moves a canvas (with its pages and blocks) to another workspace, appended
 * to that workspace's canvases. Returns the ids of the documents that moved.
 */
export async function moveCanvas(services: PersistenceServices, id: string, targetWorkspaceId: string): Promise<string[]> {
  const canvas = await requireCanvas(services, id);
  if (canvas.workspaceId === targetWorkspaceId) return [];
  const [source, target] = await Promise.all([
    services.workspaces.get(canvas.workspaceId),
    requireWorkspace(services, targetWorkspaceId),
  ]);
  if (source && source.canvasIds.length <= 1) {
    throw new HierarchyError("A workspace needs at least one canvas.");
  }

  const now = Date.now();
  const docs = await canvasDocuments(services, canvas);
  for (const doc of docs) await services.documents.put({ ...doc, workspaceId: targetWorkspaceId });
  await services.canvases.put({ ...canvas, workspaceId: targetWorkspaceId, updatedAt: now });
  // Reference it from the target before unlisting it from the source, so it is never unreachable.
  await services.workspaces.put({ ...target, canvasIds: [...target.canvasIds, id], updatedAt: now });
  if (source) await services.workspaces.put({ ...source, canvasIds: source.canvasIds.filter((c) => c !== id), updatedAt: now });
  return docs.map((d) => d.id);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Ids of the rich-block documents a canvas's scene embeds (deleted elements too: undo may restore them). */
async function canvasBlockIds(services: PersistenceServices, canvasId: string): Promise<Set<string>> {
  const doc = new Y.Doc();
  try {
    const { updates } = await services.yupdates.load(canvasDocId(canvasId));
    for (const u of updates) Y.applyUpdate(doc, u);
    const ids = new Set<string>();
    for (const el of doc.getMap<SceneElement>("elements").values()) {
      const ref = el.type === "embeddable" ? getEmbedRef(el) : null;
      if (ref?.kind === "rich-block") ids.add(ref.documentId);
    }
    return ids;
  } finally {
    doc.destroy();
  }
}

/**
 * The block and page documents that belong to a canvas: those it owns, plus
 * blocks its scene embeds that predate ownership (no `canvasId`).
 */
async function canvasDocuments(services: PersistenceServices, canvas: CanvasDocument): Promise<DocumentRecord[]> {
  const [blockIds, docs] = await Promise.all([
    canvasBlockIds(services, canvas.id),
    services.documents.listByWorkspace(canvas.workspaceId),
  ]);
  return docs.filter((d) => d.canvasId === canvas.id || (!d.canvasId && d.kind === "block" && blockIds.has(d.id)));
}

async function deleteDocument(services: PersistenceServices, id: string): Promise<void> {
  await services.documents.delete(id);
  await services.yupdates.clear(richDocKey(id));
}

async function deleteCanvasContent(services: PersistenceServices, canvasId: string): Promise<string[]> {
  const canvas = await services.canvases.get(canvasId);
  const docs = canvas ? await canvasDocuments(services, canvas) : [];
  for (const doc of docs) await deleteDocument(services, doc.id);
  await services.canvases.delete(canvasId);
  await services.yupdates.clear(canvasDocId(canvasId));
  return docs.map((d) => d.id);
}
