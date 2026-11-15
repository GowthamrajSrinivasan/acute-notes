import { describe, expect, it, vi } from "vitest";

// Excalidraw cannot load under node; these paths only need these few helpers.
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY" },
  newElementWith: (el: object, patch: object) => ({ ...el, ...patch }),
  restoreElements: (els: unknown[]) => els,
  convertToExcalidrawElements: (els: unknown[]) => els,
}));
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { changeSetCanvas } from "./changeSetWriter";

/** A shape linked to a content source, as a first Visualize stamps it. */
function card(id: string, extra: Record<string, unknown> = {}) {
  const ai = { createdBy: "ai", operationId: "op_1", contentSourceId: "src_1", contentSourceVersion: 1, stableNodeKey: `k_${id}`, contentFingerprint: "f", sourceUnits: ["u1"] };
  return { id, type: "rectangle", x: 0, y: 0, width: 100, height: 50, isDeleted: false, boundElements: null, groupIds: [], frameId: "fA", customData: { acuteMeta: { ai } }, version: 1, versionNonce: 1, ...extra };
}
const frame = (id: string, x: number) => ({ id, type: "frame", x, y: 0, width: 400, height: 400, isDeleted: false, boundElements: null, groupIds: [], frameId: null, version: 1, versionNonce: 1 });

function run(elements: unknown[], changes: ProposedChange[]) {
  let scene = elements as Record<string, unknown>[];
  const api = {
    getSceneElementsIncludingDeleted: () => scene,
    getSceneElements: () => scene.filter((e) => !e.isDeleted),
    updateScene: (u: { elements: Record<string, unknown>[] }) => {
      scene = u.elements;
    },
  };
  const set = { operationId: "op_2", title: "Update from new content", metadata: { createdBy: "ai" }, changes } as unknown as ChangeSet;
  changeSetCanvas(api as never, { workspaceId: "w", canvasId: "c" } as never).write(set, changes);
  return scene;
}
const byId = (scene: Record<string, unknown>[], id: string) => scene.find((e) => e.id === id) as ReturnType<typeof card>;

describe("the writer's knowledge-notes changes (§6.1)", () => {
  it("mark_review sets only the card's review; its content link and baseline stay", () => {
    const review = { reasons: ["the source changed a passage this card cites"] };
    const el = byId(run([frame("fA", 0), card("a")], [{ kind: "mark_review", target: "a", stableNodeKey: "k_a", review }]), "a");
    const ai = (el.customData.acuteMeta as { ai: Record<string, unknown> }).ai;
    expect(ai.review).toEqual(review);
    expect(ai).toMatchObject({ contentFingerprint: "f", contentSourceVersion: 1, stableNodeKey: "k_a", sourceUnits: ["u1"] });
  });

  it("a move with a frame puts the card in that section's frame (a move, never remove + add)", () => {
    const out = run([frame("fA", 0), frame("fB", 500), card("a")], [{ kind: "move", target: "a", to: { x: 520, y: 40 }, frame: "fB" }]);
    const el = byId(out, "a");
    expect(el.frameId).toBe("fB");
    expect([el.x, el.y]).toEqual([520, 40]);
    expect(el.isDeleted).toBe(false);
  });

  it("a plain move keeps the card's frame", () => {
    const el = byId(run([frame("fA", 0), card("a")], [{ kind: "move", target: "a", to: { x: 10, y: 10 } }]), "a");
    expect(el.frameId).toBe("fA");
  });
});
