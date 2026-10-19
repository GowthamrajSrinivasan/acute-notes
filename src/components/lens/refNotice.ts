"use client";

/**
 * D59's notice: when a node or frame that other nodes `refs` is deleted or cut, say how many refer to it and point
 * at "Move to canvas…" (a cut-and-paste is a copy, so it drops the key and those references would go unresolved).
 * A notice only — the delete itself goes ahead, and undo brings the node back with its key. "Move to canvas…"
 * removes its originals on purpose, so it announces them first (`expectMove`) and they aren't reported.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { SceneElement } from "@/domain/canvas/adapter";
import { inboundRefs, keysRemoved, liveKeys } from "@/domain/lens/refs";
import { getDocumentStore } from "@/state/documents";
import { invalidateKeyIndex, loadKeyIndex } from "./keyIndex";

const moving = new Set<string>();

/** Element ids "Move to canvas…" is about to remove from this canvas: not a delete, so no notice. */
export function expectMove(elementIds: Iterable<string>): void {
  for (const id of elementIds) moving.add(id);
}

/** Watches the open canvas for removed keyed nodes that others refer to; returns the unsubscriber (on leaving the canvas). */
export function watchReferencedRemovals(api: ExcalidrawImperativeAPI, home: { workspaceId: string; canvasId: string }): () => void {
  const getDocument = (id: string) => getDocumentStore().get(id);
  let before = liveKeys(api.getSceneElements() as unknown as readonly SceneElement[], getDocument);
  let lastElements: readonly unknown[] | null = null;
  const off = api.onChange((elements) => {
    if (elements === lastElements) return;
    lastElements = elements;
    const scene = elements as unknown as readonly SceneElement[];
    const after = liveKeys(scene, getDocument);
    const removed = keysRemoved(before, after).filter((r) => !moving.delete(r.elementId));
    before = after;
    if (!removed.length) return;
    void loadKeyIndex(home.workspaceId, home.canvasId, scene).then(
      (index) => {
        const removedIds = new Set(removed.map((r) => r.elementId));
        // A ref may name the node by its key or its id (D53).
        const holders = inboundRefs(index, removed.flatMap((r) => [r.key, r.elementId])).filter((h) => !removedIds.has(h.elementId));
        if (!holders.length) return;
        const what = removed.length === 1 ? `“${removed[0]!.label}” is` : `${removed.length} removed nodes are`;
        api.setToast({
          message: `${what} referenced by ${holders.length} node${holders.length === 1 ? "" : "s"}, which now show it as unresolved. Undo brings it back; to move it to another canvas and keep those references, use “Move to canvas…”.`,
          duration: 8000,
        });
      },
      (err: unknown) => console.error("[acute-notes] Couldn't check references to a removed node", err),
    );
  });
  return () => {
    off();
    // The canvas being left changes under the key index's cache once it is persisted: read it afresh next time.
    invalidateKeyIndex(home.workspaceId);
  };
}
