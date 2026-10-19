"use client";

/**
 * The workspace graph for Lens's Trace and Impact actions (plan §4, Phase 3): every canvas, the open one live and the
 * others read-only through the shared loader (`workspaceScenes.ts`), as the pure `buildWorkspaceGraph` the MCP tools
 * read. Built only while Trace or Impact is in use, and rebuilt when the open scene changes. Nothing is written.
 */
import { useEffect, useState } from "react";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { SceneSource } from "@/domain/lens/lensView";
import { buildWorkspaceGraph, type WorkspaceGraph } from "@/domain/project/workspaceGraph";
import { getDocumentStore } from "@/state/documents";
import { loadOtherCanvases } from "./workspaceScenes";

export interface LensWorkspace {
  g: WorkspaceGraph;
  /** The same canvases, for locating a node's level (`locateInLens`). */
  scenes: SceneSource;
}

async function loadLensWorkspace(workspaceId: string, openCanvasId: string, openElements: readonly SceneElement[]): Promise<LensWorkspace> {
  const others = await loadOtherCanvases(workspaceId, openCanvasId);
  const store = getDocumentStore();
  const canvases = [
    { canvasId: openCanvasId, elements: openElements, getDocument: (id: string) => store.get(id) },
    ...others.map((c) => ({ canvasId: c.canvasId, title: c.title, elements: c.elements, getDocument: (id: string) => c.documents.get(id) })),
  ];
  const byId = new Map(canvases.map((c) => [c.canvasId, c] as const));
  return {
    g: buildWorkspaceGraph(canvases),
    scenes: {
      elements: (id) => byId.get(id)?.elements,
      getDocument: (id) => {
        for (const c of others) {
          const doc = c.documents.get(id);
          if (doc) return doc;
        }
        return store.get(id);
      },
    },
  };
}

/**
 * The workspace graph while `enabled`, rebuilt when `revision` changes (bump it when the open scene changes);
 * `undefined` until the first build. The previous one is kept while a newer one loads, so the UI doesn't flicker.
 */
export function useLensWorkspace(
  home: { workspaceId: string; canvasId: string },
  getElements: () => readonly SceneElement[],
  revision: unknown,
  enabled: boolean,
): LensWorkspace | undefined {
  const [workspace, setWorkspace] = useState<LensWorkspace>();
  const { workspaceId, canvasId } = home;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadLensWorkspace(workspaceId, canvasId, getElements()).then(
      (next) => live && setWorkspace(next),
      (err: unknown) => console.error("[acute-notes] Couldn't read the workspace for Lens", err),
    );
    return () => {
      live = false;
    };
    // `getElements` is read when the effect runs; `revision` is what says the scene changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, canvasId, revision, enabled]);
  return enabled ? workspace : undefined;
}
