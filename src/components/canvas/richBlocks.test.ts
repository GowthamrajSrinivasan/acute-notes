import { describe, expect, it, vi } from "vitest";

// Excalidraw cannot load under node; handleDuplicate only needs newElementWith for shapes, frames and arrows.
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY" },
  newElementWith: (el: object, patch: object) => ({ ...el, ...patch }),
  restoreElements: (els: unknown[]) => els,
}));
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { getFrameLens, getNodeLens } from "@/domain/canvas/diagram";
import { handleDuplicate } from "./richBlocks";

const el = (partial: Record<string, unknown>) => ({ isDeleted: false, customData: undefined, ...partial }) as unknown as ExcalidrawElement;

describe("handleDuplicate: copies never inherit a Lens key (D59)", () => {
  const original = el({ id: "a", type: "rectangle", customData: { acuteNode: { kind: "backend", key: "f.api" } } });
  const frame = el({ id: "f", type: "frame", customData: { acuteDiagram: { type: "architecture", interactive: true, lensKey: "f" } } });
  const prev = [original, frame];

  it("a duplicated or pasted node and frame drop their keys; the originals keep theirs", () => {
    const copyNode = el({ id: "a2", type: "rectangle", customData: original.customData });
    const copyFrame = el({ id: "f2", type: "frame", customData: frame.customData });
    const next = handleDuplicate([...prev, copyNode, copyFrame], prev)!;
    expect(next).toBeDefined();
    const byId = new Map(next.map((e) => [e.id, e]));
    expect(getNodeLens(byId.get("a2")!)).toBeUndefined();
    expect(getFrameLens(byId.get("f2")!)?.lensKey).toBeUndefined();
    expect(getNodeLens(byId.get("a")!)?.key).toBe("f.api");
    expect(byId.get("a")).toBe(original);
  });

  it("a paste onto another canvas (no previous elements in common) is a copy too", () => {
    const pasted = el({ id: "p1", type: "rectangle", customData: original.customData });
    const next = handleDuplicate([pasted], [])!;
    expect(getNodeLens(next[0]!)).toBeUndefined();
  });

  it("returns nothing to change when no copy carries a key", () => {
    expect(handleDuplicate([...prev, el({ id: "b", type: "rectangle" })], prev)).toBeUndefined();
  });
});

describe("handleDuplicate: a copied map node doesn't take its map identity (D21)", () => {
  it("marks the copy ownIdentity, so Lens gives it its own key", () => {
    const map = el({ id: "m", type: "rectangle", customData: { acuteMeta: { ai: { createdBy: "mcp", contentSourceId: "s", contentSourceVersion: 1, stableNodeKey: "mod:x", contentFingerprint: "f" } } } });
    const copy = el({ id: "m2", type: "rectangle", customData: map.customData });
    const next = handleDuplicate([map, copy], [map])!;
    const byId = new Map(next.map((e) => [e.id, e]));
    expect(getNodeLens(byId.get("m2")!)?.ownIdentity).toBe(true);
    expect(getNodeLens(byId.get("m")!)).toBeUndefined();
  });
});
