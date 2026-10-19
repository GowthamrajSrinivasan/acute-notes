/** Shared geometry types for the renderer (F30). Renderer-agnostic: no Excalidraw/React import anywhere in this package. */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A movable object of the scene, as local reflow (F41) sees it. */
export interface SceneObject {
  id: string;
  box: Box;
  /** The rigid unit it moves with: its frame, else its outermost group, else its own id. */
  unit: string;
  /** Never moved automatically. */
  locked: boolean;
  /** Still where Acute last placed it (cheap to move). False for anything the user placed or has moved since. */
  placedByAcute: boolean;
}

export interface RenderContext {
  /** Every live object's box, of any type, so the plan is placed clear of them. */
  existing: readonly Box[];
  /** The current viewport, in scene coordinates. */
  viewport: Box;
  /** Place near this box (e.g. the current selection) instead of the viewport centre, when given. */
  anchor?: Box;
  /** Which side of the anchor to start from: beside it (default, like an Insert) or below it (a child explanation, F38b). */
  anchorSide?: "right" | "below";
  /** The objects `anchor` is made of, when known (they are never moved; otherwise, objects inside `anchor` are taken as it). */
  anchorIds?: readonly string[];
  /**
   * The scene's movable objects (F41). Given together with `anchor`, placement
   * may make room beside the anchor by moving some of them (and then ignores
   * `existing`); without, it only looks for free space.
   */
  objects?: readonly SceneObject[];
}
