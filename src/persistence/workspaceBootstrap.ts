import type { CanvasDocument, DocumentRecord, Workspace } from "@/domain/types";
import { createCanvas, createWorkspace, DEFAULT_WORKSPACE_NAME } from "@/workspaces/hierarchy";
import { ensureDocumentIntegrity } from "@/workspaces/integrity";
import type { PersistenceServices } from "./repositories/types";

export interface OpenedWorkspace {
  workspace: Workspace;
  /** The open canvas. */
  canvas: CanvasDocument;
  /** Documents repaired in storage while opening (refresh cached copies). */
  repairedDocuments: string[];
  /** Records of the blocks/pages the canvas shows, already read while opening (seed caches). */
  documents: DocumentRecord[];
}

const lastCanvasKey = (workspaceId: string) => `ui.lastCanvas/${workspaceId}`;

const inFlight = new WeakMap<PersistenceServices, Map<string, Promise<OpenedWorkspace>>>();

/**
 * Loads a workspace and one of its canvases, creating both on first use.
 * Opens `canvasId` when it belongs to the workspace, otherwise the canvas
 * opened last, otherwise the first one. Concurrent calls for the same target
 * share one promise so that React strict-mode double effects can never create
 * duplicate canvases; settled calls are not cached (the hierarchy can change).
 */
export function openWorkspace(services: PersistenceServices, workspaceId: string, canvasId?: string): Promise<OpenedWorkspace> {
  let byKey = inFlight.get(services);
  if (!byKey) inFlight.set(services, (byKey = new Map()));
  const key = `${workspaceId} ${canvasId ?? ""}`;
  const existing = byKey.get(key);
  if (existing) return existing;

  const promise = loadOrCreate(services, workspaceId, canvasId);
  byKey.set(key, promise);
  void promise.finally(() => byKey.delete(key)).catch(() => undefined);
  return promise;
}

/** Remembers the canvas to reopen when the workspace is opened without one. */
export function rememberCanvas(services: PersistenceServices, workspaceId: string, canvasId: string): Promise<void> {
  return services.meta.set(lastCanvasKey(workspaceId), canvasId);
}

async function loadOrCreate(services: PersistenceServices, workspaceId: string, canvasId?: string): Promise<OpenedWorkspace> {
  let workspace = await services.workspaces.get(workspaceId);
  if (!workspace) {
    const created = await createWorkspace(services, DEFAULT_WORKSPACE_NAME, workspaceId);
    return { workspace: created.workspace, canvas: created.canvas, repairedDocuments: [], documents: [] };
  }

  const last = canvasId ? undefined : await services.meta.get<string>(lastCanvasKey(workspaceId));
  const candidates = [canvasId, last, ...workspace.canvasIds].filter(
    (id): id is string => !!id && workspace!.canvasIds.includes(id),
  );
  let canvas: CanvasDocument | null = null;
  for (const id of candidates) {
    canvas = await services.canvases.get(id);
    if (canvas) break;
  }

  if (!canvas) {
    canvas = await createCanvas(services, workspaceId);
    workspace = (await services.workspaces.get(workspaceId)) ?? workspace;
  }

  // Before the canvas opens: every block/page it shows must be its own.
  const { changed, documents } = await ensureDocumentIntegrity(services, workspace, canvas.id);
  return { workspace, canvas, repairedDocuments: changed, documents };
}
