"use client";

/**
 * The browser's `SceneSource` for Acute Lens (plan §4, D41): the open canvas is read live; any other canvas a drill
 * link points into comes from the shared workspace loader (`workspaceScenes.ts`, also behind the key index), the
 * first time Lens asks for it. Nothing is opened in the canvas area and nothing is ever written.
 *
 * The plan sketched this over `documentRegistry`; that registry holds rich-text documents, not canvas scenes. A
 * loaded canvas brings the documents its embeds point at, so `getDocument` answers for objects on that canvas too.
 */
import type { SceneElement } from "@/domain/canvas/adapter";
import { frameTitleOf, getDiagramMeta, getFrameLens } from "@/domain/canvas/diagram";
import type { SceneSource } from "@/domain/lens/lensView";
import { getDocumentStore } from "@/state/documents";
import { isStale, loadCanvas, loadOtherCanvases, peekCanvas } from "./workspaceScenes";

export class LensSceneCache {
  /** Canvases this cache has asked for; `getDocument` looks in their documents first. */
  private readonly requested = new Set<string>();
  private readonly refreshing = new Set<string>();

  constructor(
    private readonly workspaceId: string,
    private readonly onLoad: () => void,
  ) {}

  /** A source over the open canvas's live `elements` plus whatever has been loaded for the other canvases. */
  source(openCanvasId: string, elements: readonly SceneElement[]): SceneSource {
    return {
      elements: (id) => (id === openCanvasId ? elements : this.get(id)),
      isLoading: (id) => id !== openCanvasId && peekCanvas(this.workspaceId, id) === undefined,
      getDocument: (id) => {
        for (const canvasId of this.requested) {
          const doc = peekCanvas(this.workspaceId, canvasId)?.documents.get(id);
          if (doc) return doc;
        }
        return getDocumentStore().get(id);
      },
    };
  }

  private get(canvasId: string): readonly SceneElement[] | undefined {
    this.requested.add(canvasId);
    const hit = peekCanvas(this.workspaceId, canvasId);
    // Not loaded yet, or loaded a while ago: (re-)read it; a stale copy is shown meanwhile rather than "loading".
    if ((hit === undefined || isStale(this.workspaceId, canvasId)) && !this.refreshing.has(canvasId)) {
      this.refreshing.add(canvasId);
      void loadCanvas(this.workspaceId, canvasId).then(() => {
        this.refreshing.delete(canvasId);
        this.onLoad();
      });
    }
    return hit?.elements;
  }
}

export interface LinkableFrame {
  canvasId: string;
  canvasTitle: string;
  /** The frame's `lensKey`, else its id: what `expandsTo.frameKey` stores. */
  frameKey: string;
  title: string;
}

const MAX_CANVASES = 30;

/**
 * Interactive frames on this workspace's other canvases, for "Link to detail frame…" (read-only; loaded when the
 * menu opens). At most `MAX_CANVASES` canvases are scanned, in the workspace's order.
 */
export async function linkableFramesElsewhere(workspaceId: string, openCanvasId: string): Promise<LinkableFrame[]> {
  const out: LinkableFrame[] = [];
  for (const canvas of await loadOtherCanvases(workspaceId, openCanvasId, MAX_CANVASES)) {
    for (const el of canvas.elements) {
      if (el.isDeleted || el.type !== "frame" || !getDiagramMeta(el)?.interactive) continue;
      out.push({ canvasId: canvas.canvasId, canvasTitle: canvas.title, frameKey: getFrameLens(el)?.lensKey ?? el.id, title: frameTitleOf(el as SceneElement & { name?: string | null }) });
    }
  }
  return out;
}
