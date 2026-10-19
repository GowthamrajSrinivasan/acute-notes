import { describe, expect, it } from "vitest";
import { isWhereAcutePlacedIt, withLayoutHint, type SceneElement } from "@/domain/canvas/adapter";
import { sceneObjects } from "./renderPlanContext";

const el = (id: string, extra: Partial<SceneElement> = {}): SceneElement =>
  ({ id, type: "rectangle", x: 10, y: 20, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "", backgroundColor: "", strokeWidth: 1, strokeStyle: "solid", ...extra }) as SceneElement;

describe("layout hint (F41)", () => {
  it("an object is 'placed by Acute' only while it is still where Acute put it", () => {
    const placed = el("a", { customData: withLayoutHint({ acute: { kind: "rich-block" } }, { x: 10, y: 20 }) });
    expect(isWhereAcutePlacedIt(placed)).toBe(true);
    expect(placed.customData?.acute).toEqual({ kind: "rich-block" }); // the rest of customData is kept
    expect(isWhereAcutePlacedIt({ ...placed, x: 300 })).toBe(false); // the user moved it
    expect(isWhereAcutePlacedIt(el("b"))).toBe(false); // the user placed it
  });
});

describe("sceneObjects (F41)", () => {
  it("leaves out labels, bound connectors and deleted elements; keeps free arrows and lines as objects", () => {
    const objects = sceneObjects([
      el("shape"),
      el("label", { type: "text", containerId: "shape" }),
      el("bound", { type: "arrow", startBinding: { elementId: "shape" } }),
      el("free", { type: "arrow" }),
      el("gone", { isDeleted: true }),
    ]);
    expect(objects.map((o) => o.id)).toEqual(["shape", "free"]);
  });

  it("units: a frame with its children, else the outermost group, else the object itself", () => {
    const objects = sceneObjects([
      el("frame", { type: "frame" }),
      el("child", { frameId: "frame", groupIds: ["g1"] }),
      el("grouped", { groupIds: ["inner", "outer"] }),
      el("alone"),
    ]);
    expect(Object.fromEntries(objects.map((o) => [o.id, o.unit]))).toEqual({ frame: "frame", child: "frame", grouped: "outer", alone: "alone" });
  });

  it("carries locks and whether Acute placed the object", () => {
    const [locked, acute] = sceneObjects([el("l", { locked: true }), el("a", { customData: withLayoutHint(undefined, { x: 10, y: 20 }) })]);
    expect(locked).toMatchObject({ locked: true, placedByAcute: false });
    expect(acute).toMatchObject({ locked: false, placedByAcute: true });
  });
});
