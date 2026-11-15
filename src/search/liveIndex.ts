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
 *
 * Stage 4b (intelligent-update-engine-plan §12.9 A): the index's health per
 * canvas (`IndexHealth`) — a failed plan or work unit, or a verification that
 * finds objects out of date, makes the canvas `stale` and rebuilds it from the
 * scene; `syncCommitted` brings it up to date and verifies it right after a
 * commit; `whenIndexFresh` gates anything that must not read a stale index.
 * With AI mode off there is no live index: the on-demand indexes (the router's,
 * MCP search) sync from the committed scene before every read.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useSyncExternalStore } from "react";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentHome } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";
import { IndexHealth, type IndexState } from "./indexHealth";
import { browserSchedulerHost, IndexScheduler } from "./indexScheduler";
import { WorkspaceIndex } from "./workspaceIndex";

interface LiveIndex {
  index: WorkspaceIndex;
  scheduler: IndexScheduler;
  /** Re-marks every source dirty (the registered sources' current state). */
  markAll: () => void;
  health: IndexHealth;
  /** The open canvas's scene, while it is indexed (for rebuild and verification). */
  canvases: Map<string, { elements: () => readonly SceneElement[]; getDocument: (id: string) => ReturnType<ReturnType<typeof getDocumentStore>["get"]> }>;
}

/**
 * Simulated failures (tests and the dev hook `__acuteDev.failIndex`): the next `n` index work units — live updates and
 * rebuilds alike — throw, as a real failure would.
 */
export const indexFaults = {
  remaining: 0,
  failNext(n = 1): void {
    this.remaining = Math.max(0, n);
  },
  take(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining--;
    return true;
  },
};
const faulty = (unit: () => void) => () => {
  if (indexFaults.take()) throw new Error("Simulated index failure");
  unit();
};

const live = new Map<string, LiveIndex>();

function liveFor(workspaceId: string): LiveIndex {
  let entry = live.get(workspaceId);
  if (!entry) {
    // One workspace is open at a time: drop the others' indexes.
    for (const [id, other] of live) {
      other.scheduler.dispose();
      live.delete(id);
    }
    const index = new WorkspaceIndex(workspaceId);
    const scheduler = new IndexScheduler(browserSchedulerHost());
    const canvases: LiveIndex["canvases"] = new Map();
    const health = new IndexHealth({
      rebuild: (canvasId) => {
        const c = canvases.get(canvasId);
        if (!c) return;
        index.removeScene(canvasId);
        for (const unit of index.planScene(canvasId, c.elements(), c.getDocument)) faulty(unit)();
      },
      verify: (canvasId) => {
        const c = canvases.get(canvasId);
        return c ? index.verifyScene(canvasId, c.elements(), c.getDocument) : null;
      },
      now: () => Date.now(),
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });
    // A failed plan or unit: the canvas it was for (or, for documents, every indexed canvas) is stale.
    scheduler.onError = (key, err) => {
      const reason = err instanceof Error ? err.message : String(err);
      const targets = key.startsWith("scene:") ? [key.slice("scene:".length)] : [...canvases.keys()];
      for (const canvasId of targets) health.markStale(canvasId, reason);
    };
    entry = { index, scheduler, markAll: () => undefined, health, canvases };
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
    const elements = () => api.getSceneElements() as unknown as readonly SceneElement[];
    entry.canvases.set(canvasId, { elements, getDocument });
    const planScene = () => index.planScene(canvasId, elements(), getDocument).map(faulty);
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
      entry.canvases.delete(canvasId);
      entry.health.forget(canvasId);
    };
  }, [api, workspaceId, canvasId, enabled]);
}

/** What a commit's index sync found: the canvas's health, or `on_demand` when no live index runs (AI mode off). */
export type CommitIndexState = IndexState | { state: "on_demand" };

/**
 * Right after a commit (Stage 4b): runs the pending index work now and verifies the canvas against its scene. A failure
 * makes it `stale` (and rebuilds it); it never throws — the commit stands whatever happens here.
 */
export function syncCommitted(workspaceId: string, canvasId: string): CommitIndexState {
  const entry = live.get(workspaceId);
  if (!entry || !entry.canvases.has(canvasId)) return { state: "on_demand" };
  try {
    entry.markAll();
    entry.scheduler.flush();
    return entry.health.check(canvasId);
  } catch (err) {
    entry.health.markStale(canvasId, err instanceof Error ? err.message : String(err));
    return entry.health.status(canvasId);
  }
}

/** Resolves true when the canvas's live index is fresh (at once with no live index: on-demand indexes sync on read). */
export function whenIndexFresh(workspaceId: string, canvasId: string, timeoutMs?: number): Promise<boolean> {
  const entry = live.get(workspaceId);
  if (!entry || !entry.canvases.has(canvasId)) return Promise.resolve(true);
  return entry.health.whenFresh(canvasId, timeoutMs);
}

/** Rebuilds a failed (or stale) canvas index now — the badge's Retry. */
export function retryIndex(workspaceId: string, canvasId: string): void {
  live.get(workspaceId)?.health.retry(canvasId);
}

const FRESH: IndexState = { state: "fresh", verifiedAt: 0 };

/** The canvas's index health for the UI (fresh when no live index runs). */
export function useIndexState(workspaceId: string, canvasId: string): IndexState {
  return useSyncExternalStore(
    (cb) => {
      // The workspace's live index may start after this subscribes (AI mode turned on): re-check on a short poll then.
      const entry = live.get(workspaceId);
      if (entry) return entry.health.subscribe(cb);
      const t = setInterval(() => live.has(workspaceId) && cb(), 1_000);
      return () => clearInterval(t);
    },
    () => live.get(workspaceId)?.health.status(canvasId) ?? FRESH,
    () => FRESH,
  );
}

/** The canvas's index health now (dev hook and tests); `on_demand` when no live index runs. */
export function getLiveIndexState(workspaceId: string, canvasId: string): CommitIndexState {
  const entry = live.get(workspaceId);
  return entry?.canvases.has(canvasId) ? entry.health.status(canvasId) : { state: "on_demand" };
}

/** Dev hook and e2e: the texts the live index holds for a canvas (null with no live index). */
export function liveIndexTexts(workspaceId: string, canvasId: string): string[] | null {
  const entry = live.get(workspaceId);
  return entry?.canvases.has(canvasId) ? entry.index.objects({ canvasId }).map((o) => o.text) : null;
}

/** Dev hook and e2e: runs pending index work, then verifies the canvas against its scene (as after a commit). */
export function verifyLiveIndex(workspaceId: string, canvasId: string): CommitIndexState {
  return syncCommitted(workspaceId, canvasId);
}

