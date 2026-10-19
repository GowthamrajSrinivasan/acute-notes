"use client";

/**
 * The one browser loader for canvases other than the open one (plan §4, D41, D53): Lens's drills into another canvas
 * (`LensSceneCache`), the workspace-wide key index (`keyIndex.ts`) and "Link to detail frame…"'s "On other canvases"
 * all read through it, so a canvas is loaded once and every reader sees the same copy.
 *
 * A canvas is read read-only from its persisted Yjs updates (`WorkspaceScan.scene`, the loader MCP reads use),
 * together with the documents its embeds point at (rich blocks, page previews), so provenance kept on a document
 * reads right for an object on that canvas (`evidenceOriginOf`), not through the open canvas's document store.
 *
 * Only one canvas is open at a time, so another canvas changes only once the open one is left (its edits are then
 * persisted), through "Move to canvas…", or by a write that isn't this tab's. Leaving a canvas and a move drop the
 * workspace's entries (`invalidateWorkspaceScenes`); anything older than `TTL_MS` is re-read on the next full scan.
 * Nothing is ever written.
 */
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { WorkspaceScan } from "@/mcp/resources/workspaceScan";
import { getPersistence } from "@/persistence";

export interface LoadedCanvas {
  canvasId: string;
  title: string;
  elements: readonly SceneElement[];
  /** The documents this canvas's embeds point at. */
  documents: ReadonlyMap<string, DocumentRecord>;
}

const TTL_MS = 30_000;

interface WorkspaceEntry {
  /** null: the canvas is missing (deleted, or not in this workspace). */
  canvases: Map<string, { at: number; canvas: LoadedCanvas | null }>;
  inflight: Map<string, Promise<LoadedCanvas | null>>;
}

const workspaces = new Map<string, WorkspaceEntry>();

function entry(workspaceId: string): WorkspaceEntry {
  let e = workspaces.get(workspaceId);
  if (!e) workspaces.set(workspaceId, (e = { canvases: new Map(), inflight: new Map() }));
  return e;
}

function embeddedDocumentIds(elements: readonly SceneElement[]): string[] {
  return elements.flatMap((el) => {
    if (el.isDeleted) return [];
    const ref = getEmbedRef(el);
    return ref?.kind === "rich-block" ? [ref.documentId] : ref?.kind === "page-preview" ? [ref.pageId] : [];
  });
}

async function read(scan: WorkspaceScan, canvasId: string, title?: string): Promise<LoadedCanvas | null> {
  const canvas = title === undefined ? await scan.canvas(canvasId) : { title };
  if (!canvas) return null;
  const elements = await scan.scene(canvasId);
  const documents = await scan.documents(embeddedDocumentIds(elements));
  return { canvasId, title: canvas.title, elements, documents };
}

function load(workspaceId: string, canvasId: string, scan: WorkspaceScan, title?: string): Promise<LoadedCanvas | null> {
  const e = entry(workspaceId);
  const running = e.inflight.get(canvasId);
  if (running) return running;
  const job = read(scan, canvasId, title)
    .catch((err: unknown) => {
      // A canvas that won't load reads as missing: drills stop there, its keys read as unresolved.
      console.error("[acute-notes] Couldn't read a canvas", err);
      return null;
    })
    .then((canvas) => {
      // Dropped by an invalidation while loading: don't store what may already be stale.
      if (workspaces.get(workspaceId) === e && e.inflight.get(canvasId) === job) e.canvases.set(canvasId, { at: Date.now(), canvas });
      e.inflight.delete(canvasId);
      return canvas;
    });
  e.inflight.set(canvasId, job);
  return job;
}

/** What is cached for `canvasId` right now: the canvas, `null` when it is missing, `undefined` when not loaded. */
export function peekCanvas(workspaceId: string, canvasId: string): LoadedCanvas | null | undefined {
  return workspaces.get(workspaceId)?.canvases.get(canvasId)?.canvas;
}

/** Whether `canvasId` is cached but older than `TTL_MS` (a caller may show it while `loadCanvas` re-reads it). */
export function isStale(workspaceId: string, canvasId: string): boolean {
  const hit = workspaces.get(workspaceId)?.canvases.get(canvasId);
  return !!hit && Date.now() - hit.at >= TTL_MS;
}

/** One canvas, loaded once and re-read once older than `TTL_MS` (concurrent callers share the load). */
export function loadCanvas(workspaceId: string, canvasId: string): Promise<LoadedCanvas | null> {
  const hit = workspaces.get(workspaceId)?.canvases.get(canvasId);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.canvas);
  return load(workspaceId, canvasId, new WorkspaceScan(getPersistence(), workspaceId));
}

/**
 * Every canvas of the workspace except `exceptCanvasId` (the open one, which callers read live), in workspace order,
 * at most `limit`. Entries older than `TTL_MS` are re-read.
 */
export async function loadOtherCanvases(workspaceId: string, exceptCanvasId: string, limit = Infinity): Promise<LoadedCanvas[]> {
  const scan = new WorkspaceScan(getPersistence(), workspaceId);
  const list = (await scan.canvases()).filter((c) => c.id !== exceptCanvasId).slice(0, limit);
  const now = Date.now();
  const loaded = await Promise.all(
    list.map((c) => {
      const hit = workspaces.get(workspaceId)?.canvases.get(c.id);
      return hit && now - hit.at < TTL_MS ? hit.canvas : load(workspaceId, c.id, scan, c.title);
    }),
  );
  return loaded.filter((c): c is LoadedCanvas => !!c);
}

/** Drops the workspace's loaded canvases (a canvas was left, or something moved between canvases). */
export function invalidateWorkspaceScenes(workspaceId: string): void {
  workspaces.delete(workspaceId);
}
