import { describe, expect, it } from "vitest";
import { median, time } from "@/testUtils/timing";
import { placeWithReflow, MAX_MOVED_UNITS, type ReflowResult } from "./reflow";
import type { Box, SceneObject } from "./types";

const W = 200;
const H = 100;
const STEP_X = W + 64;
const STEP_Y = H + 64;
const viewport: Box = { x: 0, y: 0, width: 1600, height: 900 };

const obj = (id: string, x: number, y: number, extra: Partial<SceneObject> = {}): SceneObject => ({
  id,
  box: { x, y, width: W, height: H },
  unit: id,
  locked: false,
  placedByAcute: true,
  ...extra,
});

/** A dense grid of blocks, `cols` × `rows`, 64 apart, ids `r{row}c{col}`. */
function grid(cols: number, rows: number, extra: (row: number, col: number) => Partial<SceneObject> = () => ({})): SceneObject[] {
  const out: SceneObject[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(obj(`r${r}c${c}`, c * STEP_X, r * STEP_Y, extra(r, c)));
  return out;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Runs a placement and checks the invariants every result must hold. */
function run(layout: { width: number; height: number }, objects: SceneObject[], anchorId: string, side: "below" | "right" = "below", anchorIds = [anchorId]) {
  const anchor = objects.find((o) => o.id === anchorId)!.box;
  const bounds: Box = { x: 0, y: 0, ...layout };
  const r = placeWithReflow(bounds, { existing: [], viewport, anchor, anchorSide: side, anchorIds, objects });
  const placed: Box = { x: r.dx, y: r.dy, ...layout };
  const moved = new Map(r.moves.map((m) => [m.id, m.to] as const));
  const final = objects.map((o) => ({ ...o, box: { ...o.box, ...(moved.get(o.id) ?? {}) } }));
  // No overlaps anywhere (objects that enclose the anchor are where the insertion happens, not in its way).
  const encloses = (o: SceneObject) => o.box.x <= anchor.x && o.box.y <= anchor.y && o.box.x + o.box.width >= anchor.x + anchor.width && o.box.y + o.box.height >= anchor.y + anchor.height && !anchorIds.includes(o.id);
  const solid = final.filter((o) => !encloses(o));
  for (const o of solid) expect(overlaps(placed, o.box), `new content overlaps ${o.id}`).toBe(false);
  for (const id of moved.keys()) {
    const o = final.find((f) => f.id === id)!;
    for (const p of solid) if (p.id !== id && p.unit !== o.unit) expect(overlaps(o.box, p.box), `${id} overlaps ${p.id}`).toBe(false);
  }
  // Locked objects and the anchor never move.
  for (const o of objects) if (o.locked || anchorIds.includes(o.id)) expect(moved.has(o.id), `${o.id} moved`).toBe(false);
  return { ...r, placed, moved };
}

const dyOf = (r: ReflowResult, id: string, objects: SceneObject[]) => {
  const m = r.moves.find((x) => x.id === id);
  return m ? m.to.y - objects.find((o) => o.id === id)!.box.y : 0;
};

describe("placeWithReflow (F41)", () => {
  it("where the natural slot is free, places there and moves nothing", () => {
    const objects = [obj("a", 0, 0), obj("far", 0, 1000)];
    const r = run({ width: W, height: 300 }, objects, "a");
    expect(r.strategy).toBe("free");
    expect(r.moves).toEqual([]);
    expect(r.placed).toMatchObject({ x: 0, y: H + 64 });
  });

  it("in a dense grid: goes directly below the anchor, pushing only its own column, by exactly the room needed", () => {
    const objects = grid(8, 6);
    const r = run({ width: W, height: 300 }, objects, "r0c0");
    expect(r.strategy).toBe("push");
    expect(r.placed).toMatchObject({ x: 0, y: STEP_Y });
    // Room needed: the new block (300) + a gap (64), minus the gap already there — every block below moves down 364.
    for (let row = 1; row < 6; row++) expect(dyOf(r, `r${row}c0`, objects)).toBe(364);
    // Nothing beside the column moves.
    expect(r.moves.every((m) => m.id.endsWith("c0"))).toBe(true);
    expect(r.moves).toHaveLength(5);
  });

  it("slack absorbs the push: a partly open gap moves less, a wide enough gap stops it", () => {
    // Column: anchor, C right below, then E after a 236 px gap (172 of slack beyond the 64 gap), then G after enough slack to absorb the rest.
    const objects = [obj("a", 0, 0), obj("c", 0, STEP_Y), obj("e", 0, STEP_Y + H + 236), obj("g", 0, STEP_Y + H + 236 + H + 64 + 400), ...blockers()];
    const r = run({ width: W, height: 300 }, objects, "a");
    expect(r.strategy).toBe("push");
    expect(dyOf(r, "c", objects)).toBe(364);
    expect(dyOf(r, "e", objects)).toBe(364 - 172);
    expect(dyOf(r, "g", objects)).toBe(0);
  });

  it("a locked block in the way is a wall: never moved, and the result still overlaps nothing", () => {
    const objects = grid(8, 6, (r, c) => (r === 2 && c === 0 ? { locked: true } : {}));
    const r = run({ width: W, height: 300 }, objects, "r0c0");
    expect(r.moved.has("r2c0")).toBe(false);
    expect(r.strategy).not.toBe("push");
  });

  it("prefers a free slot nearby over moving an arrangement the user placed", () => {
    const acute = grid(8, 6);
    expect(run({ width: W, height: 300 }, acute, "r0c0").strategy).toBe("push");
    const user = grid(8, 6, () => ({ placedByAcute: false }));
    const r = run({ width: W, height: 300 }, user, "r0c0");
    expect(r.strategy).toBe("free");
    expect(r.moves).toEqual([]);
  });

  it("moves a group whole", () => {
    // r1c0 and r1c1 are grouped: pushing r1c0 moves r1c1 by the same amount (and so what is below r1c1 too).
    const objects = grid(8, 6, (r, c) => (r === 1 && c < 2 ? { unit: "g" } : {}));
    const r = run({ width: W, height: 300 }, objects, "r0c0");
    expect(r.strategy).toBe("push");
    expect(dyOf(r, "r1c0", objects)).toBe(364);
    expect(dyOf(r, "r1c1", objects)).toBe(364);
    expect(dyOf(r, "r2c1", objects)).toBe(364);
    expect(dyOf(r, "r2c2", objects)).toBe(0);
  });

  it("inside the anchor's own frame: its siblings are pushed one by one, and the enclosing frame itself stays put", () => {
    const inFrame = grid(3, 4, () => ({ unit: "frame" }));
    const frame: SceneObject = { id: "frame", box: { x: -40, y: -40, width: 3 * STEP_X + 16, height: 4 * STEP_Y + 16 }, unit: "frame", locked: false, placedByAcute: true };
    const objects = [frame, ...inFrame, ...blockers(3 * STEP_X + 100)];
    const r = run({ width: W, height: 300 }, objects, "r0c0");
    expect(r.moved.has("frame")).toBe(false);
    expect(dyOf(r, "r1c0", objects)).toBe(364);
    expect(dyOf(r, "r1c1", objects)).toBe(0);
  });

  it("a new flow step in line: pushes its successors along the row, and nothing below the row", () => {
    const row = [obj("a", 0, 0), obj("s", STEP_X, 0), obj("t", 2 * STEP_X, 0)];
    const below = [obj("under", STEP_X, 400)];
    const objects = [...row, ...below];
    const r = run({ width: W, height: H }, objects, "a", "right");
    expect(r.strategy).toBe("push");
    expect(r.placed).toMatchObject({ x: STEP_X, y: 0 });
    expect(r.moves.map((m) => m.id)).toEqual(["s", "t"]);
    expect(r.moves.map((m) => m.to.x - objects.find((o) => o.id === m.id)!.box.x)).toEqual([STEP_X, STEP_X]);
    expect(r.moved.has("under")).toBe(false);
  });

  it("a push that would move too much is not a local change: something else is chosen", () => {
    const objects = grid(1, MAX_MOVED_UNITS + 5);
    const r = run({ width: W, height: 300 }, objects, "r0c0");
    expect(r.moves.length).toBeLessThanOrEqual(MAX_MOVED_UNITS);
    expect(r.strategy).not.toBe("push");
  });

  it("an object reaching into the slot from beside (not ahead of it) is never pushed through: the result still overlaps nothing", () => {
    const tall: SceneObject = { id: "tall", box: { x: 150, y: 0, width: 200, height: 800 }, unit: "tall", locked: false, placedByAcute: true };
    const objects = [obj("a", 0, 0, { box: { x: 0, y: 0, width: 140, height: H } }), tall, obj("c", 0, STEP_Y)];
    run({ width: W, height: 300 }, objects, "a");
  });

  it("is deterministic", () => {
    const objects = grid(8, 6);
    expect(run({ width: W, height: 300 }, objects, "r0c0")).toEqual(run({ width: W, height: 300 }, objects, "r0c0"));
  });

  it("stays fast and local on a dense 1,000-object canvas", () => {
    const objects = grid(40, 25);
    const anchors = ["r3c5", "r10c20", "r20c33"];
    // Each anchor timed on its own (median across them), so one slow tick under full-suite load doesn't sink a
    // combined total — the same budget as before (~33ms/call), widened since only 3 samples feed the median.
    const runs = anchors.map((id) => {
      const anchor = objects.find((o) => o.id === id)!.box;
      return time(() => placeWithReflow({ x: 0, y: 0, width: W, height: 300 }, { existing: [], viewport, anchor, anchorSide: "below", anchorIds: [id], objects }));
    });
    expect(median(runs)).toBeLessThan(50);
    const results = anchors.map((id) => run({ width: W, height: 300 }, objects, id));
    for (const [i, r] of results.entries()) {
      const col = ["c5", "c20", "c33"][i]!;
      expect(r.strategy).toBe("push");
      expect(r.moves.every((m) => m.id.endsWith(col))).toBe(true);
    }
  });
});

/** A wall of blocks to the right of x, so free space nearby is scarce and a push is the cheaper choice. */
function blockers(x = STEP_X): SceneObject[] {
  const out: SceneObject[] = [];
  for (let r = 0; r < 12; r++) for (let c = 0; c < 8; c++) out.push(obj(`b${r}_${c}`, x + c * STEP_X, r * STEP_Y));
  return out;
}
