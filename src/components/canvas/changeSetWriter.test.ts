import { describe, expect, it, vi } from "vitest";

// Excalidraw cannot load under node; the update_node path only needs these few helpers.
vi.mock("@excalidraw/excalidraw", () => ({
  CaptureUpdateAction: { NEVER: "NEVER", IMMEDIATELY: "IMMEDIATELY" },
  newElementWith: (el: object, patch: object) => ({ ...el, ...patch }),
  restoreElements: (els: unknown[]) => els,
  convertToExcalidrawElements: (els: unknown[]) => els,
}));
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { getNodeLens, getNodeProject, getNodeSemantics, withNodeLens, withNodeProject, withNodeSemantics } from "@/domain/canvas/diagram";
import { NODE_KIND_STYLES } from "@/domain/canvas/nodeKindStyle";
import { changeSetCanvas } from "./changeSetWriter";

const lens = { key: "k1", expandsTo: { frameKey: "f1" }, sources: [{ path: "a.ts" }] };

function shape(id: string, kind: string, project: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  let cd = withNodeSemantics({}, { kind: kind as never });
  cd = withNodeLens(cd, lens);
  cd = withNodeProject(cd, project);
  return { id, type: "rectangle", x: 0, y: 0, width: 100, height: 50, isDeleted: false, boundElements: null, groupIds: [], frameId: null, strokeColor: "#1e1e1e", backgroundColor: "transparent", customData: cd, version: 1, versionNonce: 1, ...extra };
}

function run(elements: unknown[], change: ProposedChange) {
  let scene = elements as Record<string, unknown>[];
  const api = {
    getSceneElementsIncludingDeleted: () => scene,
    getSceneElements: () => scene.filter((e) => !e.isDeleted),
    updateScene: (u: { elements: Record<string, unknown>[] }) => {
      scene = u.elements;
    },
  };
  const set = { operationId: "op", title: "t", metadata: { createdBy: "mcp" }, changes: [change] } as unknown as ChangeSet;
  const home = { workspaceId: "w", canvasId: "c" } as never;
  changeSetCanvas(api as never, home).write(set, [change]);
  return scene;
}

const patch = (target: string, semantics: Record<string, unknown>): ProposedChange => ({ kind: "update_node", target, semantics: semantics as never });
const byId = (scene: Record<string, unknown>[], id: string) => scene.find((e) => e.id === id) as ReturnType<typeof shape>;

describe("update_node in the writer", () => {
  it("merges a patch, keeping Lens fields and other project fields", () => {
    const out = run([shape("a", "progress_item", { project: "p1", refs: ["x"], status: "in_progress" })], patch("a", { status: "done" }));
    const el = byId(out, "a");
    expect(getNodeProject(el)).toEqual({ project: "p1", refs: ["x"], status: "done" });
    expect(getNodeLens(el)).toEqual(lens);
  });

  it("clears a field with null", () => {
    const el = byId(run([shape("a", "progress_item", { refs: ["x"], status: "blocked" })], patch("a", { refs: null })), "a");
    expect(getNodeProject(el)).toEqual({ status: "blocked" });
  });

  it("promotes a finding to a decision and restyles it", () => {
    const el = byId(run([shape("a", "finding", { refs: ["r"], stage: "validated" })], patch("a", { kind: "decision", status: "proposed", reason: "why" })), "a");
    expect(getNodeSemantics(el)?.kind).toBe("decision");
    expect(getNodeProject(el)).toEqual({ refs: ["r"], status: "proposed", reason: "why" });
    expect(getNodeLens(el)?.key).toBe("k1");
    expect(el.strokeColor).toBe(NODE_KIND_STYLES.decision.strokeColor);
    expect(el.backgroundColor).toBe(NODE_KIND_STYLES.decision.backgroundColor);
  });

  it("drops only a chosen that is not one of the options", () => {
    const el = byId(run([shape("a", "decision", { options: [{ label: "A" }] })], patch("a", { chosen: "Z", status: "accepted" })), "a");
    expect(getNodeProject(el)).toEqual({ options: [{ label: "A" }], status: "accepted" });
  });

  it("skips a missing, deleted or non-shape target without throwing", () => {
    const scene = [shape("gone", "risk", {}, { isDeleted: true }), shape("t", "risk", {}, { type: "text" })];
    for (const target of ["nope", "gone", "t"]) {
      const out = run(scene, patch(target, { severity: "high" }));
      expect(getNodeProject(byId(out, target === "nope" ? "gone" : target))).toBeUndefined();
    }
  });
});

describe("restore in the writer (D43)", () => {
  const restore = (element: Record<string, unknown>): ProposedChange => ({ kind: "restore", target: element.id as string, element: element as never });

  it("resets an element still in the scene to its snapshot, undeleting it, keeping its id and bindings", () => {
    const now = shape("a", "decision", { status: "accepted" }, { x: 300, isDeleted: true, version: 9, boundElements: null });
    const before = shape("a", "decision", { status: "proposed" }, { x: 10, isDeleted: false, version: 4, boundElements: [{ id: "arrow1", type: "arrow" }] });
    const out = run([now], restore(before));
    const el = byId(out, "a");
    expect(el.isDeleted).toBe(false);
    expect(el.x).toBe(10);
    expect(el.boundElements).toEqual([{ id: "arrow1", type: "arrow" }]);
    expect(getNodeProject(el)?.status).toBe("proposed");
    // The snapshot's own version isn't written back: the element keeps moving forward.
    expect(el.version).toBe(9);
    expect(out).toHaveLength(1);
  });

  it("re-creates an element gone from the scene entirely, with its own id", () => {
    const gone = shape("b", "risk", { severity: "high" }, { x: 42 });
    const out = run([shape("a", "decision", {})], restore(gone));
    expect(out.map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(byId(out, "b").x).toBe(42);
  });
});
