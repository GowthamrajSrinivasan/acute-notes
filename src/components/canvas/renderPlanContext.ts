/**
 * Gathers F30's `RenderContext` from a real Excalidraw instance: every live
 * object's box (so the plan is placed clear of them), the visible viewport,
 * and — when something is selected — its bounding box as the placement
 * anchor, plus the scene's movable objects for local reflow (F41). The only
 * place F30's renderer touches anything Excalidraw-shaped.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RenderContext, SceneObject } from "@/ai/renderer/render";
import { isWhereAcutePlacedIt, type SceneElement } from "@/domain/canvas/adapter";

export function gatherRenderContext(api: ExcalidrawImperativeAPI): RenderContext {
  const elements = api.getSceneElements() as unknown as readonly SceneElement[];
  const existing = elements.map((el) => ({ x: el.x, y: el.y, width: el.width, height: el.height }));
  const s = api.getAppState();
  const viewport = { x: -s.scrollX, y: -s.scrollY, width: s.width / s.zoom.value, height: s.height / s.zoom.value };
  const selected = elements.filter((el) => s.selectedElementIds[el.id]);
  const anchor = selected.length
    ? {
        x: Math.min(...selected.map((el) => el.x)),
        y: Math.min(...selected.map((el) => el.y)),
        width: Math.max(...selected.map((el) => el.x + el.width)) - Math.min(...selected.map((el) => el.x)),
        height: Math.max(...selected.map((el) => el.y + el.height)) - Math.min(...selected.map((el) => el.y)),
      }
    : undefined;
  return { existing, viewport, objects: sceneObjects(elements), ...(anchor ? { anchor, anchorIds: selected.map((el) => el.id) } : {}) };
}

/**
 * The objects local reflow may move, each with the unit it moves with (its
 * frame, else its outermost group — Excalidraw orders `groupIds` innermost
 * first — else itself). Labels and connectors are left out: they follow
 * their container and the objects they are bound to.
 */
export function sceneObjects(elements: readonly SceneElement[]): SceneObject[] {
  return elements.flatMap((el) => {
    if (el.isDeleted) return [];
    if (el.type === "text" && el.containerId) return [];
    if ((el.type === "arrow" || el.type === "line") && (el.startBinding || el.endBinding)) return [];
    const frame = el.type === "frame" || el.type === "magicframe" ? el.id : el.frameId;
    return [
      {
        id: el.id,
        box: { x: el.x, y: el.y, width: el.width, height: el.height },
        unit: frame ?? el.groupIds.at(-1) ?? el.id,
        locked: el.locked,
        placedByAcute: isWhereAcutePlacedIt(el),
      },
    ];
  });
}
