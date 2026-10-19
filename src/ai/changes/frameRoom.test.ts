import { describe, expect, it } from "vitest";
import { MIN_FRAME_GAP, roomForGrownFrame } from "./frameRoom";

const f = (id: string, x: number, y: number, width = 300, height = 200) => ({ id, x, y, width, height });

describe("roomForGrownFrame", () => {
  it("does nothing when the grown frame still clears its neighbours", () => {
    const frames = [f("a", 0, 0, 300, 220), f("b", 396, 0)];
    expect(roomForGrownFrame(frames, "a", { x: 0, y: 0, width: 300, height: 200 }).size).toBe(0);
  });

  it("pushes the frame to its right just enough to keep their gap, and the next one along", () => {
    const frames = [f("a", 0, 0, 380), f("b", 396, 0), f("c", 792, 0)];
    const moves = roomForGrownFrame(frames, "a", { x: 0, y: 0, width: 300, height: 200 });
    expect(moves.get("b")).toEqual({ dx: 80, dy: 0 });
    expect(moves.get("c")).toEqual({ dx: 80, dy: 0 });
  });

  it("pushes the row below down as a whole, keeping its gap (the overlapping sections in a live run)", () => {
    const frames = [f("a", 0, 0, 300, 400), f("b", 396, 0), f("d", 0, 296), f("e", 396, 296), f("g", 792, 296)];
    const moves = roomForGrownFrame(frames, "a", { x: 0, y: 0, width: 300, height: 200 });
    for (const id of ["d", "e", "g"]) expect(moves.get(id)).toEqual({ dx: 0, dy: 200 });
    expect(moves.has("b")).toBe(false);
  });

  it("keeps at least the minimum gap when frames were touching", () => {
    const frames = [f("a", 0, 0, 310), f("b", 300, 0)];
    expect(roomForGrownFrame(frames, "a", { x: 0, y: 0, width: 300, height: 200 }).get("b")).toEqual({ dx: 10 + MIN_FRAME_GAP, dy: 0 });
  });
});
