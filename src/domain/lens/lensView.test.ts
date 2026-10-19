import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { frameLevels, lensRootFrames, lensTree, lensView, reachableLevels, singleScene, type SceneSource } from "./lensView";

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

const node = (id: string, label: string, kind: string, frameId: string, x = 10, extra: Record<string, unknown> = {}) => [
  el({ id, type: "rectangle", frameId, x, customData: { acuteNode: { kind, ...extra } } }),
  el({ id: `${id}_t`, type: "text", text: label, containerId: id, frameId }),
];

function frame(id: string, name: string, opts: Record<string, unknown> = {}) {
  return { ...el({ id, type: "frame", x: 0, y: 0, width: 400, height: 200, customData: Object.keys(opts).length ? { acuteDiagram: opts } : undefined }), name } as SceneElement;
}

const s = (elements: readonly SceneElement[]): SceneSource => singleScene("c1", elements);

describe("lensView (path, crumbs)", () => {
  const scene: SceneElement[] = [
    frame("f1", "Payments"),
    ...node("ui", "Frontend", "frontend", "f1"),
    ...node("api", "API", "backend", "f1", 200, { expandsTo: { frameKey: "f2" } }),
    el({ id: "a1", type: "arrow", x: 110, y: 25, points: [[0, 0], [90, 0]], startBinding: { elementId: "ui" }, endBinding: { elementId: "api" } }),
    frame("f2", "API detail", { level: 2 }),
    ...node("handler", "Handler", "backend", "f2"),
  ];

  it("builds the root level with no path", () => {
    const view = lensView(s(scene), { canvasId: "c1", frameId: "f1" });
    expect(view?.level).toBe(1);
    expect(view?.key).toBe("f1");
    expect(view?.crumbs).toEqual([{ frame: { canvasId: "c1", frameId: "f1" }, key: "f1", title: "Payments", level: 1 }]);
    expect(view?.loop).toBe(false);
    expect(view?.nodes.find((n) => n.id === "api")?.childFrame).toEqual({ canvasId: "c1", frameId: "f2", via: "expandsTo" });
    expect(view?.nodes.find((n) => n.id === "ui")?.childFrame).toBeUndefined();
  });

  it("drills by node key (falling back to the element id) and builds the crumb trail", () => {
    const view = lensView(s(scene), { canvasId: "c1", frameId: "f1" }, ["api"]);
    expect(view?.title).toBe("API detail");
    expect(view?.level).toBe(2);
    expect(view?.crumbs.map((c) => c.title)).toEqual(["Payments", "API detail"]);
  });

  it("resolves an explained_by arrow and a title-match suggestion when expandsTo is absent", () => {
    const withLinks: SceneElement[] = [
      frame("root", "Root"),
      ...node("a", "Has Explained", "backend", "root"),
      ...node("b", "Webhook Handler", "backend", "root", 200),
      el({ id: "arrow1", type: "arrow", startBinding: { elementId: "a" }, endBinding: { elementId: "explained" }, customData: { acuteRelation: "explained_by" } }),
      frame("explained", "Explained target"),
      frame("Webhook Handler", "Webhook Handler", { interactive: true }), // title-match suggestion for node b
    ];
    // interactive flag belongs on type: architecture per getDiagramMeta; fix fixture:
    (withLinks[withLinks.length - 1] as SceneElement).customData = { acuteDiagram: { type: "architecture", interactive: true } };
    const view = lensView(s(withLinks), { canvasId: "c1", frameId: "root" });
    expect(view?.nodes.find((n) => n.id === "a")?.childFrame).toEqual({ canvasId: "c1", frameId: "explained", via: "explained_by" });
    expect(view?.nodes.find((n) => n.id === "b")?.childFrame).toEqual({ canvasId: "c1", frameId: "Webhook Handler", via: "suggested" });
  });

  it("stops and marks a loop instead of drilling forever", () => {
    const looped: SceneElement[] = [
      frame("x", "X"),
      ...node("toY", "To Y", "backend", "x", 10, { expandsTo: { frameKey: "y" } }),
      frame("y", "Y"),
      ...node("toX", "To X", "backend", "y", 10, { expandsTo: { frameKey: "x" } }),
    ];
    const view = lensView(s(looped), { canvasId: "c1", frameId: "x" }, ["toY", "toX"]);
    expect(view?.loop).toBe(true);
    expect(view?.crumbs.map((c) => c.frame.frameId)).toEqual(["x", "y", "x"]);
  });

  it("breaks the path where a key or its child frame no longer exists, instead of failing outright", () => {
    const view = lensView(s(scene), { canvasId: "c1", frameId: "f1" }, ["api", "missing-key"]);
    expect(view?.title).toBe("API detail"); // stayed at the last level it could reach
  });

  it("returns undefined only when the root frame itself is gone", () => {
    expect(lensView(s(scene), { canvasId: "c1", frameId: "missing" })).toBeUndefined();
  });

  it("infers a drilled-into frame's level as one past its parent's, when it has none of its own", () => {
    const noExplicitLevels: SceneElement[] = [
      frame("r", "Root"),
      ...node("a", "A", "backend", "r", 10, { expandsTo: { frameKey: "mid" } }),
      frame("mid", "Mid"),
      ...node("b", "B", "backend", "mid", 10, { expandsTo: { frameKey: "deep" } }),
      frame("deep", "Deep"),
    ];
    expect(lensView(s(noExplicitLevels), { canvasId: "c1", frameId: "r" })?.level).toBe(1);
    expect(lensView(s(noExplicitLevels), { canvasId: "c1", frameId: "r" }, ["a"])?.level).toBe(2);
    expect(lensView(s(noExplicitLevels), { canvasId: "c1", frameId: "r" }, ["a", "b"])?.level).toBe(3);
  });
});

describe("lensTree / reachableLevels", () => {
  const scene: SceneElement[] = [
    frame("f1", "Payments"),
    ...node("ui", "Frontend", "frontend", "f1"),
    ...node("api", "API", "backend", "f1", 200, { expandsTo: { frameKey: "f2" } }),
    frame("f2", "API detail", { level: 2 }),
    ...node("handler", "Handler", "backend", "f2", 10, { expandsTo: { frameKey: "f3" } }),
    frame("f3", "Handler detail", { level: 3 }),
    ...node("op", "Operation", "backend", "f3"),
  ];

  it("recurses downward through every resolvable child frame", () => {
    const tree = lensTree(s(scene), { canvasId: "c1", frameId: "f1" });
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0]?.title).toBe("API detail");
    expect(tree?.children[0]?.children[0]?.title).toBe("Handler detail");
    expect(reachableLevels(tree!)).toEqual(new Set([1, 2, 3]));
  });

  it("stops at a cycle instead of recursing forever", () => {
    const looped: SceneElement[] = [
      frame("x", "X"),
      ...node("toY", "To Y", "backend", "x", 10, { expandsTo: { frameKey: "y" } }),
      frame("y", "Y"),
      ...node("toX", "To X", "backend", "y", 10, { expandsTo: { frameKey: "x" } }),
    ];
    const tree = lensTree(s(looped), { canvasId: "c1", frameId: "x" });
    const child = tree?.children[0];
    const grandchild = child?.children[0];
    expect(child?.title).toBe("Y");
    expect(grandchild?.loop).toBe(true);
    expect(grandchild?.frame.frameId).toBe("x");
  });
});

describe("lensView across canvases (Phase 1B, SceneSource)", () => {
  const home: SceneElement[] = [frame("f1", "Payments"), ...node("api", "API", "backend", "f1", 10, { expandsTo: { frameKey: "d1", canvasId: "c2" } })];
  const detail: SceneElement[] = [frame("d1", "API detail"), ...node("h", "Handler", "backend", "d1")];
  const two = (loading = false): SceneSource => ({
    elements: (id) => (id === "c1" ? home : id === "c2" && !loading ? detail : undefined),
    isLoading: (id) => loading && id === "c2",
  });

  it("drills into a frame on another canvas, keeping that canvas in the crumb", () => {
    const view = lensView(two(), { canvasId: "c1", frameId: "f1" }, ["api"]);
    expect(view?.title).toBe("API detail");
    expect(view?.frame).toEqual({ canvasId: "c2", frameId: "d1" });
    expect(view?.crumbs.map((c) => c.frame.canvasId)).toEqual(["c1", "c2"]);
    expect(view?.level).toBe(2);
  });

  it("marks the link pending and the view loading while the other canvas loads", () => {
    const root = lensView(two(true), { canvasId: "c1", frameId: "f1" });
    expect(root?.nodes[0]?.childFrame).toEqual({ canvasId: "c2", frameId: "d1", via: "expandsTo", pending: true });
    const view = lensView(two(true), { canvasId: "c1", frameId: "f1" }, ["api"]);
    expect(view?.title).toBe("Payments");
    expect(view?.loading).toBe(true);
  });

  it("drops a link into a canvas that isn't available", () => {
    const missing: SceneSource = { elements: (id) => (id === "c1" ? home : undefined) };
    expect(lensView(missing, { canvasId: "c1", frameId: "f1" })?.nodes[0]?.childFrame).toBeUndefined();
  });

  it("includes the other canvas in lensTree", () => {
    const tree = lensTree(two(), { canvasId: "c1", frameId: "f1" });
    expect(tree?.children.map((c) => c.frame)).toEqual([{ canvasId: "c2", frameId: "d1" }]);
  });
});

describe("lensView source level (L5)", () => {
  const scene: SceneElement[] = [
    frame("op", "Verify Operation", { type: "architecture", interactive: true, level: 4 }),
    ...node("upd", "updateStatus", "backend", "op", 10, { sources: [{ path: "src/payment.service.ts", lines: [143, 158], role: "implementation" }, { path: "src/payment.test.ts", role: "test" }] }),
    ...node("plain", "No source", "backend", "op", 200),
  ];

  it("drills a node with code and no child frame into a source card at L5", () => {
    const view = lensView(s(scene), { canvasId: "c1", frameId: "op" }, ["upd"]);
    expect(view?.level).toBe(5);
    expect(view?.source?.node.label).toBe("updateStatus");
    expect(view?.source?.evidence.map((e) => e.label)).toEqual(["src/payment.service.ts:143-158", "src/payment.test.ts"]);
    expect(view?.crumbs.at(-1)).toMatchObject({ title: "updateStatus", level: 5, source: true });
    expect(view?.nodes).toEqual([]);
  });

  it("stops at the source card: nothing is below L5", () => {
    expect(lensView(s(scene), { canvasId: "c1", frameId: "op" }, ["upd", "anything"])?.source?.node.key).toBe("upd");
  });

  it("doesn't drill a node with neither a child frame nor code", () => {
    expect(lensView(s(scene), { canvasId: "c1", frameId: "op" }, ["plain"])?.source).toBeUndefined();
  });

  it("makes L5 reachable on the level rail", () => {
    const tree = lensTree(s(scene), { canvasId: "c1", frameId: "op" });
    expect([...reachableLevels(tree!)].sort()).toEqual([4, 5]);
  });
});

describe("lensRootFrames / frameLevels", () => {
  const scene: SceneElement[] = [
    frame("f1", "Payments", { type: "architecture", interactive: true }),
    ...node("api", "API", "backend", "f1", 10, { expandsTo: { frameKey: "f2" } }),
    frame("f2", "API detail", { type: "architecture", interactive: true }),
    ...node("h", "Handler", "backend", "f2"),
    frame("plain", "Not interactive"),
  ];

  it("lists interactive frames nothing on the canvas drills into", () => {
    expect(lensRootFrames(s(scene), "c1")).toEqual([{ frameId: "f1", title: "Payments", level: 1 }]);
  });

  it("infers each frame's level from its root", () => {
    expect(Object.fromEntries(frameLevels(s(scene), "c1"))).toEqual({ f1: 1, f2: 2 });
  });
});

describe("lensView on a project frame (D25, §3.6)", () => {
  const pnode = (id: string, label: string, kind: string, project: Record<string, unknown> = {}, y = 10) => [
    el({ id, type: "rectangle", frameId: "p", x: 10, y, customData: { acuteNode: { kind, key: `p.${id}`, ...project } } }),
    el({ id: `${id}_t`, type: "text", text: label, containerId: id, frameId: "p" }),
  ];
  const scene: SceneElement[] = [
    frame("p", "Project state", { interactive: true, profile: "project" }),
    ...pnode("proj", "Acme API", "project", { focus: "auth", style: "modular" }),
    ...pnode("m1", "Auth", "milestone", { order: 1 }),
    ...pnode("i1", "Login", "progress_item", { status: "done", refs: ["p.m1"], order: 1 }),
    ...pnode("d1", "Use Redis", "decision", { status: "accepted", options: [{ label: "Redis" }, { label: "Memcached" }], chosen: "Redis" }),
    ...pnode("c1", "No PII in logs", "constraint", { status: "accepted" }),
  ];

  it("uses the project profile and clamps the level to its two levels", () => {
    const view = lensView(s(scene), { canvasId: "c1", frameId: "p" });
    expect(view?.profile.id).toBe("project");
    expect(view?.level).toBe(1);
    // reached by drilling from a deeper architecture level, the level still stays inside the profile
    const arch: SceneElement[] = [frame("a", "Arch", { level: 4 }), ...node("n", "Node", "backend", "a", 10, { expandsTo: { frameKey: "p" } }), ...scene];
    expect(lensView(s(arch), { canvasId: "c1", frameId: "a" }, ["n"])?.level).toBe(1);
  });

  it("returns the four lanes, the banner counts and project fields with badges", () => {
    const view = lensView(s(scene), { canvasId: "c1", frameId: "p" })!;
    expect(view.lanes?.map((l) => l.id)).toEqual(["plan", "decisions", "knowledge", "notes"]);
    expect(view.summary).toMatchObject({ project: { key: "p.proj", label: "Acme API", focus: "auth" }, milestones: { total: 1, done: 1 }, warnings: 1 });
    const decision = view.nodes.find((x) => x.id === "d1")!;
    expect(decision.project).toMatchObject({ status: "accepted", chosen: "Redis" });
    expect(decision.badge).toBe("✓ Redis");
    expect(view.nodes.find((x) => x.id === "i1")?.badge).toBe("Done");
  });

  it("leaves an architecture frame untouched: no lanes, its own geometry", () => {
    const arch = lensView(s([frame("a", "Arch"), ...node("n", "Node", "backend", "a", 30)]), { canvasId: "c1", frameId: "a" })!;
    expect(arch.profile.id).toBe("architecture");
    expect(arch.lanes).toBeUndefined();
    expect(arch.summary).toBeUndefined();
    expect(arch.nodes[0]!.box.x).toBe(30);
    expect(arch.nodes[0]!.project).toBeUndefined();
  });
});
