import { describe, expect, it } from "vitest";
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { GeometryReport } from "@/ai/renderer/geometry";
import type { SceneElement } from "@/domain/canvas/adapter";
import { overlapsIn, rearrangeNotes } from "./rearrangeReview";

const el = (id: string, x: number, y: number, frameId = "f1", extra: Partial<SceneElement> = {}) =>
  ({ id, type: "rectangle", x, y, width: 100, height: 50, frameId, isDeleted: false, ...extra }) as unknown as SceneElement;
const frame = { id: "f1", type: "frame", x: 0, y: 0, width: 1000, height: 1000, isDeleted: false } as unknown as SceneElement;
const set = (moves: [string, number, number][]): ChangeSet => ({
  operationId: "op",
  title: "Re-arrange layout",
  metadata: { createdBy: "ai", operationId: "op" },
  changes: moves.map(([target, x, y]) => ({ kind: "move", target, to: { x, y } })),
});
const geometry = (over: Partial<GeometryReport> = {}) => ({ movedUserPlaced: [], outsideFrames: [], ...over }) as unknown as GeometryReport;
const frames = new Set(["f1"]);

describe("Re-arrange review notes (organisation-layout plan §3.4.3–3.4.4)", () => {
  it("says how many cards the user placed were left where they are", () => {
    const scene = [frame, el("a", 0, 0), el("b", 0, 200)];
    expect(rearrangeNotes({ kept: ["a"], geometry: geometry(), set: set([["b", 0, 100]]) }, scene, frames)).toEqual(["1 card you placed was left where it is."]);
    expect(rearrangeNotes({ kept: ["a", "b"], geometry: geometry(), set: set([]) }, scene, frames)[0]).toBe("2 cards you placed were left where they are.");
  });

  it("with the option on, says how many of the user's cards it moves instead", () => {
    const scene = [frame, el("a", 0, 0)];
    expect(rearrangeNotes({ kept: [], geometry: geometry({ movedUserPlaced: ["a"] }), set: set([["a", 0, 100]]) }, scene, frames, true)).toEqual(["1 card you placed moves too."]);
  });

  it("warns when the proposal overlaps more cards than the canvas now, and not otherwise", () => {
    const scene = [frame, el("a", 0, 0), el("b", 0, 200), el("c", 300, 0, "other")];
    expect(overlapsIn(scene, frames)).toBe(0);
    const worse = rearrangeNotes({ kept: [], geometry: geometry(), set: set([["b", 10, 10]]) }, scene, frames);
    expect(worse).toEqual(["This layout overlaps more cards than the canvas does now (1 pair, now 0)."]);
    expect(rearrangeNotes({ kept: [], geometry: geometry(), set: set([["b", 0, 300]]) }, scene, frames)).toEqual([]);
  });

  it("ignores backdrops, frames and objects outside the selected frames", () => {
    const scene = [frame, el("a", 0, 0), el("bd", 0, 0, "f1", { customData: { acuteBackdrop: true } } as Partial<SceneElement>), el("x", 0, 0, "f2")];
    expect(overlapsIn(scene, frames)).toBe(0);
  });
});
