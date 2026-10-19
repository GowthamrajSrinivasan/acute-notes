"use client";

/**
 * The browser's workspace-wide key lookup (plan D53, Phase 6): loads every canvas read-only, the open one live, and
 * indexes the keys on them (`domain/lens/refs.ts`). It resolves a Lens key to its node or frame and nothing else — no
 * drill UI, no evidence, no navigation (those are Phase 1B's). Nothing is ever written.
 *
 * Other canvases come from the shared workspace loader (`workspaceScenes.ts`), the same copy Lens's drills read.
 */
import { useEffect, useState } from "react";
import type { SceneElement } from "@/domain/canvas/adapter";
import { buildKeyIndex, type KeyIndex } from "@/domain/lens/refs";
import { getDocumentStore } from "@/state/documents";
import { invalidateWorkspaceScenes, loadOtherCanvases } from "./workspaceScenes";

/** Drops the loaded scenes of `workspaceId` (after a move, or once a canvas is left). */
export function invalidateKeyIndex(workspaceId: string): void {
  invalidateWorkspaceScenes(workspaceId);
}

/** The index over this workspace: `openElements` live for the open canvas, every other canvas as persisted. */
export async function loadKeyIndex(workspaceId: string, openCanvasId: string, openElements: readonly SceneElement[]): Promise<KeyIndex> {
  const others = await loadOtherCanvases(workspaceId, openCanvasId);
  // Documents: the open canvas's from the store; another's came with it (cards' titles and map identities, D21).
  return buildKeyIndex([
    { canvasId: openCanvasId, elements: openElements, getDocument: (id) => getDocumentStore().get(id) },
    ...others.map((c) => ({ canvasId: c.canvasId, elements: c.elements, getDocument: (id: string) => c.documents.get(id) })),
  ]);
}

/**
 * The key index for the UI, rebuilt when `revision` changes (bump it when the open scene changes). `undefined` until
 * the first load finishes; the previous index is kept while a newer one loads, so the UI doesn't flicker.
 */
export function useKeyIndex(home: { workspaceId: string; canvasId: string } | undefined, getElements: () => readonly SceneElement[], revision: unknown): KeyIndex | undefined {
  const [index, setIndex] = useState<KeyIndex>();
  const workspaceId = home?.workspaceId;
  const canvasId = home?.canvasId;
  useEffect(() => {
    if (!workspaceId || !canvasId) return;
    let live = true;
    void loadKeyIndex(workspaceId, canvasId, getElements()).then(
      (next) => live && setIndex(next),
      (err: unknown) => console.error("[acute-notes] Couldn't build the key index", err),
    );
    return () => {
      live = false;
    };
    // `getElements` is read when the effect runs; `revision` is what says the scene changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, canvasId, revision]);
  return index;
}
