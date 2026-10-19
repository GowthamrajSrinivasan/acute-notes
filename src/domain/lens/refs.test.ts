import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { buildKeyIndex, inboundRefs, indexScene, keysRemoved, liveKeys, resolveRef, resolveRefs } from "./refs";

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return { x: 0, y: 0, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 2, strokeStyle: "solid", ...partial };
}
const shape = (id: string, label: string, acuteNode: Record<string, unknown>, frameId = "f") => [
  el({ id, type: "rectangle", frameId, customData: { acuteNode } }),
  el({ id: `${id}_t`, type: "text", text: label, containerId: id, frameId }),
];
const frame = (id: string, name: string, acuteDiagram?: Record<string, unknown>) => ({ ...el({ id, type: "frame", customData: acuteDiagram ? { acuteDiagram } : undefined }), name }) as SceneElement;

describe("workspace-wide key resolution (D53)", () => {
  const arch = [frame("fa", "Architecture"), ...shape("cache", "Cache", { kind: "backend", key: "fa.cache" }, "fa")];
  const project = [
    frame("fp", "Project state", { profile: "project" }),
    ...shape("d1", "Use Redis", { kind: "decision", key: "fp.use-redis", refs: ["fa.cache", "gone.key"], project: "acme" }, "fp"),
    ...shape("q1", "Why?", { kind: "open_question", refs: ["fa.cache"] }, "fp"),
  ];
  const index = buildKeyIndex([
    { canvasId: "arch", elements: arch },
    { canvasId: "proj", elements: project },
  ]);

  it("resolves a key to its node on another canvas", () => {
    const r = resolveRef(index, "fa.cache");
    expect(r).toMatchObject({ status: "resolved", target: { canvasId: "arch", elementId: "cache", what: "node", label: "Cache", kind: "backend" } });
  });

  it("resolves a frame by its id and by its lensKey", () => {
    const withKey = buildKeyIndex([{ canvasId: "c", elements: [frame("f9", "Detail", { lensKey: "payments.detail" })] }]);
    expect(resolveRef(withKey, "payments.detail")).toMatchObject({ status: "resolved", target: { elementId: "f9", what: "frame" } });
    expect(resolveRef(withKey, "f9")).toMatchObject({ status: "resolved", target: { elementId: "f9" } });
    expect(resolveRef(index, "fa")).toMatchObject({ status: "resolved", target: { what: "frame", label: "Architecture" } });
  });

  it("keeps a ref whose target is gone as unresolved, and resolves it again when the key reappears (D53 (4))", () => {
    expect(resolveRef(index, "gone.key")).toEqual({ key: "gone.key", status: "unresolved" });
    const back = buildKeyIndex([{ canvasId: "arch", elements: [...arch, ...shape("x", "Back", { key: "gone.key" }, "fa")] }]);
    expect(resolveRef(back, "gone.key").status).toBe("resolved");
  });

  it("treats a deleted node as unresolved without losing the holder's ref", () => {
    const deleted = arch.map((e) => (e.id === "cache" ? ({ ...e, isDeleted: true } as SceneElement) : e));
    const idx = buildKeyIndex([
      { canvasId: "arch", elements: deleted },
      { canvasId: "proj", elements: project },
    ]);
    expect(resolveRef(idx, "fa.cache").status).toBe("unresolved");
    expect(inboundRefs(idx, ["fa.cache"])).toHaveLength(2); // the decision still holds the ref
  });

  it("reports a key found on two nodes as ambiguous instead of picking one", () => {
    const dup = buildKeyIndex([
      { canvasId: "a", elements: shape("n1", "One", { key: "same" }, "f") },
      { canvasId: "b", elements: shape("n2", "Two", { key: "same" }, "f") },
    ]);
    const r = resolveRef(dup, "same");
    expect(r.status).toBe("ambiguous");
    expect(r.status === "ambiguous" && r.targets.map((t) => t.canvasId)).toEqual(["a", "b"]);
  });

  it("answers 'which decisions affect this node?' through refs, across canvases (D53 (1))", () => {
    const holders = inboundRefs(index, ["fa.cache"]);
    expect(holders.map((h) => [h.canvasId, h.kind, h.label])).toEqual([
      ["proj", "decision", "Use Redis"],
      ["proj", "open_question", "Why?"],
    ]);
    expect(inboundRefs(index, ["nothing"])).toEqual([]);
  });

  it("resolves a list of refs in order", () => {
    expect(resolveRefs(index, ["fa.cache", "gone.key"]).map((r) => r.status)).toEqual(["resolved", "unresolved"]);
  });

  it("is not fooled by a drawn arrow: an arrow is not a ref (D53 (2))", () => {
    const arrowOnly = [
      ...shape("a", "A", { kind: "decision", key: "k.a" }),
      ...shape("b", "B", { key: "k.b" }),
      el({ id: "ar", type: "arrow", startBinding: { elementId: "a" }, endBinding: { elementId: "b" }, customData: { acuteRelation: "references" } }),
    ];
    const idx = buildKeyIndex([{ canvasId: "c", elements: arrowOnly }]);
    expect(inboundRefs(idx, ["k.b"])).toEqual([]);
  });

  it("indexes a keyless node under its id only, and as a holder of its refs", () => {
    const s = indexScene("c", shape("n", "N", { kind: "finding", refs: ["k"] }));
    expect(s.targets).toEqual([{ key: "n", canvasId: "c", elementId: "n", what: "node", label: "N", kind: "finding" }]);
    expect(s.holders).toEqual([expect.objectContaining({ elementId: "n", refs: ["k"], kind: "finding" })]);
  });
});

describe("keysRemoved (D59's referenced-node notice)", () => {
  const scene = [frame("f", "Payments"), ...shape("a", "API", { kind: "backend", key: "f.api" }), ...shape("b", "DB", { kind: "database" })];
  const before = liveKeys(scene);

  it("reports deleted nodes by key, or by id when keyless (a ref may name either, D53)", () => {
    const after = liveKeys(scene.map((e) => (e.id === "a" || e.id === "b" ? { ...e, isDeleted: true } : e)));
    expect(keysRemoved(before, after)).toEqual([
      { key: "f.api", label: "API", elementId: "a" },
      { key: "b", label: "DB", elementId: "b" },
    ]);
  });

  it("reports a node removed outright (a cut that dropped it from the scene)", () => {
    expect(keysRemoved(before, liveKeys(scene.filter((e) => e.id !== "a")))).toEqual([{ key: "f.api", label: "API", elementId: "a" }]);
  });

  it("doesn't report a key another live element still carries", () => {
    const moved = [...scene.filter((e) => e.id !== "a"), ...shape("a2", "API", { kind: "backend", key: "f.api" })];
    expect(keysRemoved(before, liveKeys(moved))).toEqual([]);
  });
});
