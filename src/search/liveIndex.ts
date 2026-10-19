"use client";

/**
 * The open workspace's search index, kept current in the background (F22).
 *
 * `useWorkspaceIndexer` subscribes to the scene (`api.onChange`) and to the
 * document cache (pages and blocks); each notification only marks a source
 * dirty on the `IndexScheduler` — nothing is read, diffed or tokenized on
 * the input path. Planning and indexing run after input has been quiet, in
 * idle-time slices. Workspace documents are listed once, also in idle time.
 *
 * `freshIndex(workspaceId)` is for explicit user actions (✨ Ask AI): it
 * runs any pending work, then returns the index.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect } from "react";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentHome } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";
import { browserSchedulerHost, IndexScheduler } from "./indexScheduler";
import { WorkspaceIndex } from "./workspaceIndex";

interface LiveIndex {
  index: WorkspaceIndex;
  scheduler: IndexScheduler;
  /** Re-marks every source dirty (the registered sources' current state). */
  markAll: () => void;
}

const live = new Map<string, LiveIndex>();

function liveFor(workspaceId: string): LiveIndex {
  let entry = live.get(workspaceId);
  if (!entry) {
    // One workspace is open at a time: drop the others' indexes.
    for (const [id, other] of live) {
      other.scheduler.dispose();
      live.delete(id);
    }
    entry = { index: new WorkspaceIndex(workspaceId), scheduler: new IndexScheduler(browserSchedulerHost()), markAll: () => undefined };
    live.set(workspaceId, entry);
  }
  return entry;
}

/** The workspace's index after running pending work (null when nothing indexes this workspace). */
export function freshIndex(workspaceId: string): WorkspaceIndex | null {
  const entry = live.get(workspaceId);
  if (!entry) return null;
  entry.markAll();
  entry.scheduler.flush();
  return entry.index;
}

/** Keeps the index of `home`'s workspace current while `enabled` (AI mode on). */
export function useWorkspaceIndexer(api: ExcalidrawImperativeAPI, home: DocumentHome, enabled: boolean): void {
  const { workspaceId, canvasId } = home;
  useEffect(() => {
    if (!enabled) return;
    const { index, scheduler } = liveFor(workspaceId);
    const entry = live.get(workspaceId)!;
    const docs = getDocumentStore();
    const getDocument = (id: string) => docs.get(id);

    const sceneKey = `scene:${canvasId}`;
    const planScene = () => index.planScene(canvasId, api.getSceneElements() as unknown as readonly SceneElement[], getDocument);
    const planDocs = () => index.planDocuments([...docs.list(workspaceId, "page"), ...docs.list(workspaceId, "block")]);
    const markScene = () => scheduler.markDirty(sceneKey, planScene);
    const markDocs = () => {
      scheduler.markDirty("documents", planDocs);
      // A block's text lives in its document: its canvas element is re-stamped too.
      scheduler.markDirty(sceneKey, planScene);
    };
    entry.markAll = () => {
      scheduler.markDirty("documents", planDocs);
      scheduler.markDirty(sceneKey, planScene);
    };

    const offScene = api.onChange(markScene);
    const offPages = docs.subscribeKind("page", markDocs);
    const offBlocks = docs.subscribeKind("block", markDocs);
    entry.markAll();

    // Workspace pages and blocks (other canvases included), listed once in idle time.
    const host = browserSchedulerHost();
    const listing = host.requestIdle(() => {
      void docs.loadKind(workspaceId, "page");
      void docs.loadKind(workspaceId, "block");
    }, 5_000);

    return () => {
      host.cancelIdle(listing);
      offScene();
      offPages();
      offBlocks();
      entry.markAll = () => undefined;
      scheduler.forget(sceneKey);
      index.removeScene(canvasId);
    };
  }, [api, workspaceId, canvasId, enabled]);
}
