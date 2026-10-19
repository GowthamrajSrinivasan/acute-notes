import { describe, expect, it } from "vitest";
import { boundsOf, findPlacement } from "./place";
import type { Box, RenderContext } from "./types";

const box = (x: number, y: number, width = 100, height = 50): Box => ({ x, y, width, height });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function placed(layoutBounds: Box, context: RenderContext): Box {
  const { dx, dy } = findPlacement(layoutBounds, context);
  return { x: layoutBounds.x + dx, y: layoutBounds.y + dy, width: layoutBounds.width, height: layoutBounds.height };
}

describe("boundsOf", () => {
  it("bounds a set of boxes, and is empty (but defined) for none", () => {
    expect(boundsOf([box(0, 0, 10, 10), box(50, -20, 10, 10)])).toEqual({ x: 0, y: -20, width: 60, height: 30 });
    expect(boundsOf([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("findPlacement", () => {
  const viewport = box(0, 0, 1200, 800);

  it("with an empty canvas, places the layout at the viewport centre", () => {
    const layout = box(0, 0, 200, 100);
    const result = placed(layout, { existing: [], viewport });
    expect(result).toEqual({ x: 500, y: 350, width: 200, height: 100 });
  });

  it("prefers beside the anchor (e.g. the selection) over the viewport centre", () => {
    const layout = box(0, 0, 200, 100);
    const anchor = box(300, 300, 150, 80);
    const result = placed(layout, { existing: [], viewport, anchor });
    expect(result.x).toBe(anchor.x + anchor.width + 64);
    expect(result.y).toBe(anchor.y);
  });

  it("a child explanation (anchorSide below): directly below its parent, else beside it top-aligned, else the usual search — never overlapping", () => {
    const layout = box(0, 0, 200, 100);
    const parent = box(300, 300, 150, 80);
    expect(placed(layout, { existing: [parent], viewport, anchor: parent, anchorSide: "below" })).toMatchObject({ x: 300, y: 300 + 80 + 64 });
    // The note continues below the parent (a stacked note): beside it instead, at the same height.
    const next = box(300, 450, 150, 80);
    expect(placed(layout, { existing: [parent, next], viewport, anchor: parent, anchorSide: "below" })).toMatchObject({ x: 300 + 150 + 64, y: 300 });
    // Both taken: still somewhere free.
    const side = box(514, 300, 200, 100);
    const result = placed(layout, { existing: [parent, next, side], viewport, anchor: parent, anchorSide: "below" });
    for (const b of [parent, next, side]) expect(overlaps(result, b)).toBe(false);
  });

  it("never overlaps an existing object, stepping away from the natural start until it finds free space", () => {
    const layout = box(0, 0, 200, 100);
    const blocking = box(500, 350, 200, 100); // sits exactly where the empty-canvas case would place it
    const result = placed(layout, { existing: [blocking], viewport });
    expect(overlaps(result, blocking)).toBe(false);
  });

  it("is deterministic: the same layout + the same existing boxes try the same position", () => {
    const layout = box(0, 0, 200, 100);
    const existing = [box(500, 350, 200, 100), box(700, 350, 200, 100)];
    expect(placed(layout, { existing, viewport })).toEqual(placed(layout, { existing, viewport }));
  });

  it("falls back to guaranteed-clear space past everything else when the whole grid search is blocked", () => {
    const layout = box(0, 0, 100, 100);
    // Pack the entire search grid solid.
    const existing: Box[] = [];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 10; col++) existing.push(box(-2000 + col * 164, -2000 + row * 164, 164, 164));
    const result = placed(layout, { existing, viewport: box(-2000, -2000, 4000, 4000) });
    expect(existing.some((b) => overlaps(result, b))).toBe(false);
  });

  it("keeps a layout's own internal spacing: the translation is rigid, not a re-layout", () => {
    const layout: Box = { x: 10, y: -5, width: 300, height: 150 }; // an off-origin local layout, as layoutPlan can produce
    const { dx, dy } = findPlacement(layout, { existing: [], viewport });
    // Placed at the viewport centre regardless of the layout's own (arbitrary) local origin.
    expect(layout.x + dx).toBe(viewport.width / 2 - layout.width / 2);
    expect(layout.y + dy).toBe(viewport.height / 2 - layout.height / 2);
  });
});
