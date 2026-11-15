import { describe, expect, it } from "vitest";
import { PIN_GAP, resolvePins, rowsOf } from "./pins";
import { rowMajorOrder } from "./geometry";
import type { Box } from "./types";

const box = (x: number, y: number, width = 200, height = 80): Box => ({ x, y, width, height });
/** A 3 × 3 grid of cards, 248 px apart across and 112 px down. */
const grid = new Map<string, Box>(Array.from({ length: 9 }, (_, i) => [`c${i}`, box((i % 3) * 248, Math.floor(i / 3) * 112)] as const));
const near = (a: Box, b: Box) => a.x < b.x + b.width + PIN_GAP && b.x < a.x + a.width + PIN_GAP && a.y < b.y + b.height + PIN_GAP && b.y < a.y + a.height + PIN_GAP;

describe("resolvePins", () => {
  it("moves nothing when no pin is in the way", () => {
    expect(resolvePins(grid, [box(2000, 2000)])).toEqual(grid);
    expect(resolvePins(grid, [])).toEqual(grid);
  });

  it("no laid-out card comes near a pin, whatever pins there are", () => {
    const pinSets = [[box(10, 10)], [box(300, 130, 300, 300)], [box(0, 0, 50, 50), box(500, 240)], [box(-100, 50, 1200, 20)]];
    for (const pins of pinSets) {
      const out = resolvePins(grid, pins);
      for (const [id, b] of out) for (const p of pins) expect(near(b, p), `${id} near ${JSON.stringify(p)}`).toBe(false);
    }
  });

  it("keeps reading order and each card's size: rows move down whole, in order, never sideways", () => {
    const out = resolvePins(grid, [box(260, 120, 200, 80)]);
    const ids = [...grid.keys()];
    expect(rowMajorOrder(ids.map((id) => ({ id, box: out.get(id)! })))).toEqual(rowMajorOrder(ids.map((id) => ({ id, box: grid.get(id)! }))));
    for (const id of ids) {
      expect(out.get(id)!.x).toBe(grid.get(id)!.x);
      expect(out.get(id)!.width).toBe(grid.get(id)!.width);
      expect(out.get(id)!.y).toBeGreaterThanOrEqual(grid.get(id)!.y);
    }
    // The first row is above the pin and stays; the pin's row and everything below move down together.
    for (const id of ["c0", "c1", "c2"]) expect(out.get(id)).toEqual(grid.get(id));
    const shift = out.get("c3")!.y - grid.get("c3")!.y;
    expect(shift).toBeGreaterThan(0);
    for (const id of ["c4", "c5", "c6", "c7", "c8"]) expect(out.get(id)!.y - grid.get(id)!.y).toBe(shift);
  });

  it("is deterministic", () => {
    const pins = [box(260, 120), box(10, 300)];
    expect(resolvePins(grid, pins)).toEqual(resolvePins(grid, pins));
  });

  it("reads a backdrop and the cards inside it as one row", () => {
    const withBackdrop = new Map([["bd", box(0, 0, 500, 300)], ["a", box(20, 20)], ["b", box(20, 150)], ["c", box(0, 400)]]);
    expect(rowsOf(withBackdrop)).toEqual([["bd", "a", "b"], ["c"]]);
  });
});
