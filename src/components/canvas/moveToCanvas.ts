/**
 * "Move to canvas…" (plan D59): relocates the selection to another canvas of the workspace, keeping every node's and
 * frame's key so `refs` and drill links aimed at them still resolve. The planning (what travels, key pinning, link
 * re-pointing) is pure and tested in `domain/canvas/moveSet.ts`; this writes it.
 *
 * Order matters: the target canvas's persisted scene is written first, and the source is only changed once that
 * succeeded, so a failure loses nothing. The target isn't open, so it is edited as a Yjs document (the way the
 * workspace importer and integrity repair do) and an incremental update is appended.
 *
 * The source change is deliberately NOT an undo step: undoing it would bring the originals back while the copies
 * stay on the target, and two nodes with one key would make every ref to it ambiguous (D53). To reverse a move, move
 * the selection back.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import * as Y from "yjs";
import { planMove, type MoveElement } from "@/domain/canvas/moveSet";
import type { VersionedSceneElement } from "@/mcp/resources/workspaceScan";
import { getPersistence } from "@/persistence";
import { sanitizeElement } from "@/portability/sanitize";
import { canvasDocId } from "@/sync/docIds";
import { SceneBinding } from "@/sync/sceneBinding";
import { invalidateKeyIndex } from "@/components/lens/keyIndex";
import { expectMove } from "@/components/lens/refNotice";

export type MoveOutcome = { ok: true; count: number; targetTitle: string } | { ok: false; reason: string };

/** The canvases of `workspaceId` other than `exceptCanvasId`, in workspace order, for the target picker. */
export async function moveTargets(workspaceId: string, exceptCanvasId: string): Promise<{ id: string; title: string }[]> {
  const { workspaces, canvases } = getPersistence();
  const ws = await workspaces.get(workspaceId);
  if (!ws) return [];
  const all = await canvases.listByWorkspace(workspaceId);
  const byId = new Map(all.map((c) => [c.id, c] as const));
  return ws.canvasIds.flatMap((id) => {
    const c = byId.get(id);
    return c && c.id !== exceptCanvasId ? [{ id: c.id, title: c.title }] : [];
  });
}

/** Moves the canvas's current selection to `targetCanvasId`. Reports why when it can't; changes nothing then. */
export async function moveSelectionToCanvas(api: ExcalidrawImperativeAPI, home: { workspaceId: string; canvasId: string }, targetCanvasId: string): Promise<MoveOutcome> {
  const services = getPersistence();
  const target = await services.canvases.get(targetCanvasId);
  if (!target || target.workspaceId !== home.workspaceId) return { ok: false, reason: "That canvas isn't in this workspace." };

  const selectedIds = Object.keys(api.getAppState().selectedElementIds);
  const scene = api.getSceneElementsIncludingDeleted() as unknown as readonly MoveElement[];

  const key = canvasDocId(targetCanvasId);
  const doc = new Y.Doc();
  let written = false;
  try {
    const { updates } = await services.yupdates.load(key);
    for (const u of updates) Y.applyUpdate(doc, u);
    const map = doc.getMap<VersionedSceneElement>("elements");
    const targetElements = new SceneBinding(map).readScene();

    const plan = planMove({ elements: scene, selectedIds, sourceCanvasId: home.canvasId, targetCanvasId, targetElements });
    if (!plan.ok) return plan;

    // 1. The target first.
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      for (const el of plan.additions) map.set(el.id, sanitizeElement(el as unknown as Record<string, unknown>) as unknown as VersionedSceneElement);
    });
    await services.yupdates.append(key, Y.encodeStateAsUpdate(doc, before));
    written = true;

    // 2. Then the source: not an undo step (see the file comment). Moved, not deleted: no "referenced" notice.
    const remaining = new Set(plan.sourceElements.filter((el) => !el.isDeleted).map((el) => el.id));
    expectMove(scene.filter((el) => !el.isDeleted && !remaining.has(el.id)).map((el) => el.id));
    api.updateScene({
      elements: plan.sourceElements as unknown as ExcalidrawElement[],
      appState: { selectedElementIds: {} },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    invalidateKeyIndex(home.workspaceId);
    return { ok: true, count: plan.count, targetTitle: target.title };
  } catch (err) {
    console.error("[acute-notes] Move to canvas failed", err);
    return { ok: false, reason: written ? "The selection reached the other canvas but couldn't be removed from this one. Delete the originals by hand." : "Couldn't move the selection. Nothing was changed." };
  } finally {
    doc.destroy();
  }
}
