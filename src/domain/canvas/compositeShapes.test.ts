import { describe, expect, it } from "vitest";
import { sceneToAcuteObjects, type SceneElement } from "./adapter";
import {
  COMPOSITE_PARTS,
  COMPOSITE_SHAPES,
  compositeLabelRoom,
  compositeOutline,
  cylinderOutline,
  cylinderRimHeight,
  normalizeComposites as normalizeWithIds,
  partGeometry,
  shapeKindOf,
  type CompositePatch,
} from "./compositeShapes";

let ids = 0;
const normalize = (scene: readonly SceneElement[]) => normalizeWithIds(scene, () => `new${++ids}`);
const normalizeComposites = (scene: readonly SceneElement[]) => normalize(scene).patches;

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    locked: false,
    opacity: 100,
    isDeleted: false,
    groupIds: [],
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    strokeWidth: 2,
    strokeStyle: "solid",
    ...partial,
  };
}

const HOST = { x: 100, y: 200, width: 160, height: 120, angle: 0 };

/** A consistent cylinder: host (+ label) and both parts where `partGeometry` puts them. */
function cylinder(host: Partial<SceneElement> = {}): SceneElement[] {
  const h = el({ id: "h", type: "rectangle", ...HOST, strokeColor: "transparent", groupIds: ["g"], customData: { acuteShape: "cylinder", acuteShapeStyle: { strokeColor: "#1e1e1e", backgroundColor: "#e7f5ff" } }, ...host });
  const part = (id: string, role: "body" | "rim") =>
    el({ id, type: "line", ...partGeometry("cylinder", role, h), backgroundColor: role === "body" ? "#e7f5ff" : "transparent", groupIds: ["g"], customData: { acuteShapePart: role } });
  return [part("b", "body"), part("r", "rim"), h, el({ id: "t", type: "text", text: "Orders DB", containerId: "h", groupIds: ["g"] })];
}

const patchOf = (patches: CompositePatch[], id: string) => patches.find((p) => p.id === id)?.fields;

describe("cylinder outline", () => {
  it("is a closed body spanning the whole box, and an open rim across the top ellipse", () => {
    const { body, rim } = cylinderOutline(160, 120);
    const ry = cylinderRimHeight(160, 120) / 2;
    expect(body[0]).toEqual(body.at(-1));
    expect(Math.min(...body.map((p) => p[0]))).toBeCloseTo(0);
    expect(Math.max(...body.map((p) => p[0]))).toBeCloseTo(160);
    expect(Math.min(...body.map((p) => p[1]))).toBeCloseTo(0);
    expect(Math.max(...body.map((p) => p[1]))).toBeCloseTo(120);
    expect(rim[0]![0]).toBeCloseTo(0);
    expect(rim.at(-1)![0]).toBeCloseTo(160);
    expect(Math.max(...rim.map((p) => p[1]))).toBeCloseTo(2 * ry);
  });

  it("keeps the rim a sensible height however tall the cylinder gets", () => {
    expect(cylinderRimHeight(160, 120)).toBe(30);
    expect(cylinderRimHeight(160, 1200)).toBe(32);
    expect(cylinderRimHeight(2000, 1200)).toBe(36);
  });

  it("places a part's points relative to its first point", () => {
    const g = partGeometry("cylinder", "body", HOST);
    expect(g.points[0]).toEqual([0, 0]);
    expect(g.width).toBeCloseTo(160);
    expect(g.height).toBeCloseTo(120);
  });

  it("rotates parts about the host's centre", () => {
    const rim = partGeometry("cylinder", "rim", { ...HOST, angle: Math.PI });
    const upright = partGeometry("cylinder", "rim", HOST);
    // Upside down, the rim's centre mirrors through the host's centre (180, 260).
    const centre = (g: typeof rim) => [g.x + g.width / 2, g.y + g.height / 2];
    const [ux, uy] = centre(upright);
    const [rx, ry] = centre(rim);
    expect(rx).toBeCloseTo(360 - ux!);
    expect(ry).toBeCloseTo(520 - uy!);
    expect(rim.angle).toBe(Math.PI);
  });
});

describe("normalizeComposites", () => {
  it("leaves a consistent cylinder alone", () => {
    expect(normalizeComposites(cylinder())).toEqual([]);
  });

  it("re-derives the parts after the host is resized, keeping the rim height", () => {
    const scene = cylinder();
    const host = scene.find((e) => e.id === "h")!;
    // What a group resize does: every element scaled, the rim stretched with it.
    const resized = { ...host, width: 320, height: 480 };
    const patches = normalizeComposites(scene.map((e) => (e.id === "h" ? resized : e)));
    const body = patchOf(patches, "b")!;
    const rim = patchOf(patches, "r")!;
    expect(body.width).toBeCloseTo(320);
    expect(body.height).toBeCloseTo(480);
    expect(rim.height).toBeCloseTo(cylinderRimHeight(320, 480) / 2);
    expect(patchOf(patches, "h")).toBeUndefined();
    // …and once applied, it is consistent.
    const applied = scene.map((e) => (e.id === "h" ? resized : { ...e, ...patchOf(patches, e.id) }));
    expect(normalizeComposites(applied)).toEqual([]);
  });

  it("moves a stroke or fill set on the host to the parts, and keeps the host invisible", () => {
    const patches = normalizeComposites(cylinder({ strokeColor: "#7c3aed", backgroundColor: "#ede9fe" }));
    expect(patchOf(patches, "h")).toMatchObject({
      strokeColor: "transparent",
      backgroundColor: "transparent",
      customData: { acuteShapeStyle: { strokeColor: "#7c3aed", backgroundColor: "#ede9fe" } },
    });
    expect(patchOf(patches, "b")).toEqual({ strokeColor: "#7c3aed", backgroundColor: "#ede9fe" });
    expect(patchOf(patches, "r")).toEqual({ strokeColor: "#7c3aed" });
  });

  it("deletes the parts with a deleted host", () => {
    const patches = normalizeComposites(cylinder({ isDeleted: true }));
    expect(patches).toEqual([
      { id: "b", fields: { isDeleted: true } },
      { id: "r", fields: { isDeleted: true } },
    ]);
  });

  it("draws the parts again for a host copied or pasted on its own, in its recorded style", () => {
    const [, , host] = cylinder();
    const { patches, created } = normalize([host!]);
    expect(patches).toEqual([]);
    expect(created.map((c) => [c.part, c.hostId, c.groupIds, c.strokeColor, c.backgroundColor])).toEqual([
      ["body", "h", ["g"], "#1e1e1e", "#e7f5ff"],
      ["rim", "h", ["g"], "#1e1e1e", "transparent"],
    ]);
    expect(created[0]).toMatchObject(partGeometry("cylinder", "body", host!));
  });

  it("gives a host duplicated into its original's group a group and parts of its own", () => {
    const scene = cylinder();
    const dup = el({ ...scene[2]!, id: "h2", x: 400 });
    const label = el({ id: "t2", type: "text", text: "Copy", containerId: "h2", groupIds: ["g"] });
    const { patches, created } = normalize([...scene, dup, label]);
    const group = patchOf(patches, "h2")!.groupIds![0]!;
    expect(group).not.toBe("g");
    expect(patchOf(patches, "t2")).toEqual({ groupIds: [group] });
    expect(created.every((c) => c.hostId === "h2" && c.groupIds[0] === group)).toBe(true);
    expect(created[0]!.x).toBeCloseTo(400);
    // The original is untouched.
    expect(patchOf(patches, "h")).toBeUndefined();
    expect(patchOf(patches, "b")).toBeUndefined();
  });

  it("breaks an ungrouped cylinder apart into a plain rectangle and plain lines", () => {
    const scene = cylinder().map((e) => ({ ...e, groupIds: [] }));
    const patches = normalizeComposites(scene);
    expect(patchOf(patches, "h")).toEqual({ strokeColor: "#1e1e1e", backgroundColor: "#e7f5ff", customData: {} });
    expect(patchOf(patches, "b")).toEqual({ customData: {} });
    expect(patchOf(patches, "r")).toEqual({ customData: {} });
  });

  it("re-derives the parts after the host is rotated, however slightly", () => {
    const scene = cylinder();
    const turned = scene.map((e) => (e.id === "h" ? { ...e, angle: 0.3 } : e));
    const patches = normalizeComposites(turned);
    expect(patchOf(patches, "b")?.angle).toBe(0.3);
    expect(patchOf(patches, "r")?.angle).toBe(0.3);
  });

  it("mirrors the host's line look onto the parts, so Excalidraw's own panel controls apply", () => {
    const patches = normalizeComposites(cylinder({ strokeWidth: 4, strokeStyle: "dashed", roughness: 0, fillStyle: "hachure", opacity: 60 }));
    const look = { strokeWidth: 4, strokeStyle: "dashed", roughness: 0, fillStyle: "hachure", opacity: 60 };
    expect(patchOf(patches, "b")).toEqual(look);
    expect(patchOf(patches, "r")).toEqual(look);
    expect(patchOf(patches, "h")).toBeUndefined();
  });

  it("keeps the parts in the host's frame", () => {
    const scene = cylinder({ frameId: "f1" });
    expect(patchOf(normalizeComposites(scene), "b")).toEqual({ frameId: "f1" });
  });

  it("makes an ungrouped or separately copied part a plain line", () => {
    const [body] = cylinder();
    expect(normalizeComposites([{ ...body!, groupIds: ["other"] }])).toEqual([{ id: "b", fields: { customData: {} } }]);
  });
});

describe("reading a cylinder back", () => {
  it("is one shape object with its label; its outline parts are not objects", () => {
    const objs = sceneToAcuteObjects(cylinder());
    expect(objs.map((o) => o.type)).toEqual(["shape", "text"]);
    expect(objs[0]).toMatchObject({ id: "h", type: "shape", shape: "cylinder", label: "Orders DB" });
  });

  it("only a marked rectangle is a cylinder", () => {
    expect(shapeKindOf({ type: "rectangle", customData: { acuteShape: "cylinder" } })).toBe("cylinder");
    expect(shapeKindOf({ type: "ellipse", customData: { acuteShape: "cylinder" } })).toBe("ellipse");
    expect(shapeKindOf({ type: "rectangle" })).toBe("rectangle");
    expect(shapeKindOf({ type: "line", customData: { acuteShapePart: "body" } })).toBeNull();
  });
});

describe("every diagram shape", () => {
  const bounds = (points: readonly (readonly [number, number])[]) => {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map((n) => Math.round(n * 100) / 100);
  };

  it.each(COMPOSITE_SHAPES)("%s: a closed body that fills its box, plus its own parts", (kind) => {
    const outline = compositeOutline(kind, 200, 100);
    expect(Object.keys(outline).sort()).toEqual([...COMPOSITE_PARTS[kind]].sort());
    const body = outline.body!;
    expect(body[0]).toEqual(body.at(-1));
    expect(bounds(body)).toEqual([0, 0, 200, 100]);
    for (const points of Object.values(outline)) {
      const [x1, y1, x2, y2] = bounds(points!);
      expect(x1).toBeGreaterThanOrEqual(0);
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(x2).toBeLessThanOrEqual(200);
      expect(y2).toBeLessThanOrEqual(100);
    }
  });

  it.each(COMPOSITE_SHAPES)("%s: its slant, rim, wave or bars stay a sensible size on a big shape", (kind) => {
    const small = compositeLabelRoom(kind, 200, 100);
    const big = compositeLabelRoom(kind, 2000, 1000);
    expect(big.width + big.height).toBeLessThanOrEqual(72);
    expect(big.width + big.height).toBeGreaterThanOrEqual(small.width + small.height);
  });

  it.each(COMPOSITE_SHAPES)("%s: a host on its own gets all its parts drawn, the body alone filled", (kind) => {
    const host = el({
      id: "h",
      type: "rectangle",
      ...HOST,
      strokeColor: "transparent",
      groupIds: ["g"],
      customData: { acuteShape: kind, acuteShapeStyle: { strokeColor: "#1971c2", backgroundColor: "#a5d8ff" } },
    });
    const { patches, created } = normalize([host]);
    expect(patches).toEqual([]);
    expect(created.map((c) => [c.part, c.backgroundColor])).toEqual(COMPOSITE_PARTS[kind].map((p) => [p, p === "body" ? "#a5d8ff" : "transparent"]));
    expect(created.every((c) => c.strokeColor === "#1971c2" && c.groupIds[0] === "g")).toBe(true);
  });

  it("the parallelogram leans right and the trapezoid is wider at the top, as the flowchart symbols are", () => {
    const parallelogram = compositeOutline("parallelogram", 200, 100).body!;
    expect(parallelogram[0]![0]).toBeGreaterThan(0); // top-left corner inset
    const trapezoid = compositeOutline("trapezoid", 200, 100).body!;
    expect(trapezoid.slice(0, 2)).toEqual([
      [0, 0],
      [200, 0],
    ]);
  });
});
