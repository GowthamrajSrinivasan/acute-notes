import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { frameGraph } from "@/domain/canvas/diagram";
import { detailDepth, nodeDetails, placeDetails, SUBLABEL_LINE, TAG_LINE } from "./nodeDetails";

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return { x: 0, y: 0, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeWidth: 2, strokeStyle: "solid", ...partial };
}

describe("node details by zoom", () => {
  it("reads depth from zoom: nothing, then the sublabel, then the tag too", () => {
    expect(detailDepth(0.4)).toBe("none");
    expect(detailDepth(0.6)).toBe("sublabel");
    expect(detailDepth(1)).toBe("sublabel");
    expect(detailDepth(1.25)).toBe("full");
  });

  it("places details inside under the label when there's room, else just below the shape", () => {
    const box = { x: 100, y: 100, width: 170, height: 110 };
    const label = { x: 140, y: 143, width: 90, height: 25 };
    // 210 − 6 = 204 bottom; 168 below the label: 36 px, room for a sublabel and a tag (29).
    expect(placeDetails(box, label, { sublabel: true, tag: true })).toEqual({ x: 106, y: 204 - SUBLABEL_LINE - TAG_LINE, width: 158, inside: true });
    const tall = { ...label, y: 120, height: 80 };
    expect(placeDetails(box, tall, { sublabel: true, tag: false })).toEqual({ x: 100, y: 214, width: 170, inside: false });
    expect(placeDetails(box, label, { sublabel: false, tag: false })).toBeNull();
  });

  it("lists details only for nodes that have them, and the tag only at full depth", () => {
    const scene: SceneElement[] = [
      { ...el({ id: "f", type: "frame", width: 800, height: 600, customData: { acuteDiagram: { type: "architecture", interactive: true } } }), name: "F" } as SceneElement,
      el({ id: "a", type: "rectangle", frameId: "f", x: 10, y: 10, width: 170, height: 110, customData: { acuteNode: { kind: "backend", sublabel: "FastAPI :8000", tag: "stateless" } } }),
      el({ id: "a_t", type: "text", frameId: "f", containerId: "a", x: 50, y: 52, width: 90, height: 25, text: "API" }),
      el({ id: "b", type: "rectangle", frameId: "f", x: 300, y: 10, customData: { acuteNode: { kind: "database" } } }),
    ];
    const graph = frameGraph(scene, "f")!;
    expect(nodeDetails(scene, graph, "none")).toEqual([]);
    expect(nodeDetails(scene, graph, "sublabel")).toEqual([expect.objectContaining({ id: "a", sublabel: "FastAPI :8000", inside: true })]);
    expect(nodeDetails(scene, graph, "sublabel")[0]).not.toHaveProperty("tag");
    expect(nodeDetails(scene, graph, "full")[0]).toMatchObject({ sublabel: "FastAPI :8000", tag: "stateless" });
  });
});
