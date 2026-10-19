/**
 * Free-space placement (F30, PRD: "place the result in free canvas space near
 * the current viewport/selection without overlapping existing objects").
 *
 * Deterministic: the same layout bounds + the same existing boxes always try
 * the same candidate positions in the same order, so "same plan + same free
 * space → same positions" holds for the whole pipeline, not only the local
 * layout step. A bounded grid search (at most `MAX_COLS * MAX_ROWS` overlap
 * checks) keeps this cheap even against a large scene; a guaranteed-clear
 * fallback (just past the rightmost existing content) means it always
 * terminates.
 */
import type { Box, RenderContext } from "./types";

/** Space between placed content and what is already on the canvas (also local reflow's, F41). */
export const PLACEMENT_GAP = 64;
const GAP = PLACEMENT_GAP;
const MAX_COLS = 8;
const MAX_ROWS = 6;

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function isFree(candidate: Box, existing: readonly Box[]): boolean {
  return !existing.some((b) => overlaps(candidate, b));
}

function unionBounds(boxes: readonly Box[]): Box | null {
  if (!boxes.length) return null;
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  return { x: minX, y: minY, width: Math.max(...boxes.map((b) => b.x + b.width)) - minX, height: Math.max(...boxes.map((b) => b.y + b.height)) - minY };
}

/** Where to start looking: beside the anchor (like a single Insert), else the viewport centre. */
export function startingPoint(layoutBounds: Box, context: RenderContext): { x: number; y: number } {
  if (context.anchor && context.anchorSide === "below") return { x: context.anchor.x, y: context.anchor.y + context.anchor.height + GAP };
  if (context.anchor) return { x: context.anchor.x + context.anchor.width + GAP, y: context.anchor.y };
  const v = context.viewport;
  return { x: v.x + v.width / 2 - layoutBounds.width / 2, y: v.y + v.height / 2 - layoutBounds.height / 2 };
}

/**
 * The translation that places `layoutBounds` (the local layout's own bounding
 * box) clear of every existing object, closest to the natural starting point.
 * `layoutBounds` uses the same coordinate space as the boxes passed to
 * `translate` (see `render.ts`): the offset returned here is added to every
 * node's local position.
 */
export function findPlacement(layoutBounds: Box, context: RenderContext): { dx: number; dy: number } {
  const at = (x: number, y: number): Box => ({ x, y, width: layoutBounds.width, height: layoutBounds.height });
  // A child explanation (F38b): directly below its parent, else beside it at the same height — then the usual search from beside it.
  if (context.anchor && context.anchorSide === "below") {
    const a = context.anchor;
    for (const c of [at(a.x, a.y + a.height + GAP), at(a.x + a.width + GAP, a.y)]) {
      if (isFree(c, context.existing)) return { dx: c.x - layoutBounds.x, dy: c.y - layoutBounds.y };
    }
    context = { ...context, anchorSide: "right" };
  }
  const start = startingPoint(layoutBounds, context);

  for (let row = 0; row < MAX_ROWS; row++) {
    for (let col = 0; col < MAX_COLS; col++) {
      const x = start.x + col * (layoutBounds.width + GAP);
      const y = start.y + row * (layoutBounds.height + GAP);
      if (isFree(at(x, y), context.existing)) return { dx: x - layoutBounds.x, dy: y - layoutBounds.y };
    }
  }
  // Guaranteed clear: past the rightmost edge of everything already on the canvas.
  const bounds = unionBounds(context.existing) ?? at(start.x, start.y);
  const x = bounds.x + bounds.width + GAP;
  return { dx: x - layoutBounds.x, dy: start.y - layoutBounds.y };
}

/** Bounding box of a set of local node boxes. */
export function boundsOf(boxes: readonly Box[]): Box {
  return (
    unionBounds(boxes) ?? {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }
  );
}
