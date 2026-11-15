"use client";

/**
 * Writes a promotion (`promotion.ts`) onto the live canvas: one undoable step, the camera on the new card. A note already
 * pinned (a live card with its key) is shown, not pinned again: the Notes view's own memory of its pins is lost on a reload.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { TransactionHistory } from "@/ai/changes/accept";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { liveObjectWithKey, promotionKey } from "@/ai/reconcile/tracking";
import { commitSetOnCanvas } from "@/components/ai/commitOnCanvas";
import { gatherRenderContext } from "@/components/canvas/renderPlanContext";
import { showObjects } from "@/components/review/knowledgeActions";
import { knowledgeUI } from "@/components/review/knowledgeStore";
import type { DocumentHome } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";
import { promotionSet, type PromotableNote } from "./promotion";

export type { PromotableNote };

/** Pins `note` on the canvas next to what's in view; returns the new card's id (or the live one already pinned), or null when nothing was written. */
export async function promoteNote(env: { api: ExcalidrawImperativeAPI; home: DocumentHome; history: TransactionHistory }, note: PromotableNote): Promise<string | null> {
  const pinned = liveObjectWithKey(env.api.getSceneElements(), (id) => getDocumentStore().get(id), promotionKey(note.generationId, note.key));
  if (pinned) {
    showObjects(env.api, [pinned]);
    return pinned;
  }
  const { set, key } = await promotionSet(note, gatherRenderContext(env.api));
  const result = commitSetOnCanvas(env.api, env.home, env.history, parseChangeSet(set));
  const id = key && result ? (result.created.get(key) ?? null) : null;
  if (id) showObjects(env.api, [id]);
  knowledgeUI.changed(env.home.canvasId);
  return id;
}
