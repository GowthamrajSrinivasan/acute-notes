import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { el } from "@/search/testFixtures";
import { OPEN_FRAME_SHARE, placementContextOf } from "./placementContext";

const frame = (id: string, x: number, y: number, width = 600, height = 400) => el({ id, type: "frame", x, y, width, height });
const card = (id: string, frameId: string | null, x = 20, y = 40) => el({ id, type: "rectangle", frameId, x, y, width: 200, height: 80 });
const scene: SceneElement[] = [
  frame("f_a", 0, 0),
  frame("f_b", 1000, 0),
  card("c1", "f_a"),
  card("c2", "f_a", 20, 200),
  card("c3", "f_b", 1020, 40),
  card("loose", null, 2000, 0),
  el({ id: "label", type: "text", containerId: "c1", x: 30, y: 50 }),
  el({ id: "link", type: "arrow", x: 220, y: 80, frameId: "f_a" }),
];

describe("placementContextOf: the selection first", () => {
  it("one card → that card and its section; its label counts as the card", () => {
    expect(placementContextOf(scene, ["c1"])).toEqual({ card: "c1", section: "f_a", source: "selection" });
    expect(placementContextOf(scene, ["label"])).toEqual({ card: "c1", section: "f_a", source: "selection" });
    expect(placementContextOf(scene, ["label", "c1", "link"])).toEqual({ card: "c1", section: "f_a", source: "selection" }); // an arrow says nothing
    expect(placementContextOf(scene, ["loose"])).toEqual({ card: "loose", source: "selection" });
  });

  it("a frame → that section; several cards in one frame → that section only", () => {
    expect(placementContextOf(scene, ["f_b"])).toEqual({ section: "f_b", source: "selection" });
    expect(placementContextOf(scene, ["f_a", "c2"])).toEqual({ section: "f_a", source: "selection" });
    expect(placementContextOf(scene, ["c1", "c2"])).toEqual({ section: "f_a", source: "selection" });
  });

  it("a selection across sections, or of several frames, says nothing", () => {
    expect(placementContextOf(scene, ["c1", "c3"])).toBeNull();
    expect(placementContextOf(scene, ["f_a", "f_b"])).toBeNull();
    expect(placementContextOf(scene, ["f_a", "c3"])).toBeNull();
    expect(placementContextOf(scene, ["c1", "loose"])).toBeNull();
    expect(placementContextOf(scene, ["loose", el({ id: "x", type: "rectangle" }).id])).toEqual({ card: "loose", source: "selection" }); // unknown ids ignored
  });
});

describe("placementContextOf: else the frame filling the view", () => {
  it("the frame holding the view's centre and covering enough of it", () => {
    expect(placementContextOf(scene, [], { x: 50, y: 50, width: 500, height: 300 })).toEqual({ section: "f_a", source: "frame_in_view" });
    expect(placementContextOf(scene, [], { x: 900, y: -50, width: 700, height: 500 })).toEqual({ section: "f_b", source: "frame_in_view" });
  });

  it("a canvas seen from afar, or a view centred outside any frame, says nothing", () => {
    expect(placementContextOf(scene, [], { x: -500, y: -500, width: 3000, height: 2000 })).toBeNull(); // f_a is a small part of the view
    expect(placementContextOf(scene, [], { x: 600, y: 0, width: 300, height: 300 })).toBeNull(); // between the frames
    expect(placementContextOf(scene, [])).toBeNull();
    expect(OPEN_FRAME_SHARE).toBe(0.5);
  });

  it("a selection wins over the view", () => {
    expect(placementContextOf(scene, ["c3"], { x: 50, y: 50, width: 500, height: 300 })).toEqual({ card: "c3", section: "f_b", source: "selection" });
  });
});
