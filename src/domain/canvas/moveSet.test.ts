import { describe, expect, it } from "vitest";
import { buildKeyIndex, inboundRefs, resolveRef } from "@/domain/lens/refs";
import { lensView, type SceneSource } from "@/domain/lens/lensView";
import type { SceneElement } from "./adapter";
import { getFrameLens, getNodeLens } from "./diagram";
import { planMove, type MoveElement } from "./moveSet";

function el(partial: Partial<MoveElement> & Pick<MoveElement, "id" | "type">): MoveElement {
  return { x: 0, y: 0, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 2, strokeStyle: "solid", version: 1, ...partial };
}
const shape = (id: string, label: string, acuteNode: Record<string, unknown> | undefined, frameId?: string, x = 10) => [
  el({ id, type: "rectangle", x, ...(frameId ? { frameId } : {}), boundElements: [{ id: `${id}_t`, type: "text" }], ...(acuteNode ? { customData: { acuteNode } } : {}) }),
  el({ id: `${id}_t`, type: "text", text: label, containerId: id, ...(frameId ? { frameId } : {}) }),
];
const frame = (id: string, name: string, acuteDiagram?: Record<string, unknown>) => ({ ...el({ id, type: "frame", width: 400, height: 200, customData: acuteDiagram ? { acuteDiagram } : undefined }), name }) as MoveElement;

const sceneSource = (scenes: Record<string, readonly MoveElement[]>): SceneSource => ({ elements: (id) => scenes[id] as readonly SceneElement[] | undefined });

describe("Move to canvas (D59): a move keeps the key, so refs still resolve", () => {
  // Canvas c1 holds architecture node A (key K); canvas c2 holds decision B whose refs name K.
  const c1: MoveElement[] = [frame("fa", "Architecture"), ...shape("A", "Cache", { kind: "backend", key: "fa.cache" }, "fa"), ...shape("other", "Other", { key: "fa.other" }, "fa", 200)];
  const c2: MoveElement[] = [frame("fp", "Project state", { profile: "project", interactive: true }), ...shape("B", "Use Redis", { kind: "decision", key: "fp.use-redis", refs: ["fa.cache"] }, "fp")];
  const c3: MoveElement[] = [frame("fz", "Elsewhere")];

  it("node A moves from c1 to c3: K is unchanged and B's ref still resolves, on the new canvas", () => {
    const plan = planMove({ elements: c1, selectedIds: ["A"], sourceCanvasId: "c1", targetCanvasId: "c3", targetElements: c3 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const movedA = plan.additions.find((e) => e.id === "A")!;
    expect(getNodeLens(movedA)?.key).toBe("fa.cache"); // K unchanged
    expect(plan.keys).toContain("fa.cache");

    const index = buildKeyIndex([
      { canvasId: "c1", elements: plan.sourceElements },
      { canvasId: "c2", elements: c2 },
      { canvasId: "c3", elements: [...c3, ...plan.additions] },
    ]);
    const r = resolveRef(index, "fa.cache");
    expect(r).toMatchObject({ status: "resolved", target: { canvasId: "c3", elementId: "A", label: "Cache" } });
    expect(inboundRefs(index, ["fa.cache"]).map((h) => h.label)).toEqual(["Use Redis"]); // B still points at K
    // the source no longer has it (so the key is not ambiguous), and its label text went with it
    expect(plan.sourceElements.find((e) => e.id === "A")?.isDeleted).toBe(true);
    expect(plan.sourceElements.find((e) => e.id === "A_t")?.isDeleted).toBe(true);
    expect(plan.sourceElements.find((e) => e.id === "other")?.isDeleted).toBe(false);
  });

  it("moving A and then moving it back keeps K the whole way", () => {
    const there = planMove({ elements: c1, selectedIds: ["A"], sourceCanvasId: "c1", targetCanvasId: "c3", targetElements: c3 });
    if (!there.ok) throw new Error(there.reason);
    const back = planMove({ elements: [...c3, ...there.additions], selectedIds: ["A"], sourceCanvasId: "c3", targetCanvasId: "c1", targetElements: there.sourceElements });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(getNodeLens(back.additions.find((e) => e.id === "A")!)?.key).toBe("fa.cache");
  });

  it("a node with no key gets one when it moves, so it can be referenced afterwards", () => {
    const keyless: MoveElement[] = [frame("f9", "F"), ...shape("n", "Webhook handler", { kind: "backend" }, "f9")];
    const plan = planMove({ elements: keyless, selectedIds: ["n"], sourceCanvasId: "c1", targetCanvasId: "c3", targetElements: c3 });
    if (!plan.ok) throw new Error(plan.reason);
    expect(getNodeLens(plan.additions.find((e) => e.id === "n")!)?.key).toBe("f9.webhook-handler");
  });

  it("refuses a move that would put a key on a canvas that already uses it (ambiguous refs)", () => {
    const target: MoveElement[] = [...c3, ...shape("dup", "Cache too", { key: "fa.cache" }, "fz")];
    const plan = planMove({ elements: c1, selectedIds: ["A"], sourceCanvasId: "c1", targetCanvasId: "c3", targetElements: target });
    expect(plan).toMatchObject({ ok: false });
    expect(!plan.ok && plan.reason).toContain("fa.cache");
  });
});

describe("Move to canvas: frames keep their key and drill links resolve", () => {
  const source: MoveElement[] = [
    frame("root", "Root", { interactive: true }),
    ...shape("pay", "Payments", { kind: "backend", key: "root.payments", expandsTo: { frameKey: "detail" } }, "root"),
    frame("detail", "Payments detail", { interactive: true }),
    ...shape("hook", "Webhook", { kind: "backend", key: "detail.webhook" }, "detail"),
  ];
  const target: MoveElement[] = [frame("tf", "Target")];

  it("moving a frame pins its lensKey to the id it had, and re-points the link that named it", () => {
    const plan = planMove({ elements: source, selectedIds: ["detail"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: target });
    if (!plan.ok) throw new Error(plan.reason);
    const movedFrame = plan.additions.find((e) => e.id === "detail")!;
    expect(getFrameLens(movedFrame)?.lensKey).toBe("detail");
    // its members travelled with it, with their keys
    expect(getNodeLens(plan.additions.find((e) => e.id === "hook")!)?.key).toBe("detail.webhook");
    expect(plan.additions.find((e) => e.id === "hook")?.frameId).toBe("detail");
    // the node left behind now names the frame on the other canvas
    const pay = plan.sourceElements.find((e) => e.id === "pay")!;
    expect(getNodeLens(pay)?.expandsTo).toEqual({ frameKey: "detail", canvasId: "c2" });

    // and the drill still resolves, across the two canvases
    const scenes = { c1: plan.sourceElements, c2: [...target, ...plan.additions] };
    const view = lensView(sceneSource(scenes), { canvasId: "c1", frameId: "root" });
    expect(view?.nodes.find((n) => n.id === "pay")?.childFrame).toEqual({ canvasId: "c2", frameId: "detail", via: "expandsTo" });
    expect(lensView(sceneSource(scenes), { canvasId: "c1", frameId: "root" }, ["root.payments"])?.title).toBe("Payments detail");
  });

  it("moving the node and its target frame together keeps the link local to the new canvas", () => {
    const plan = planMove({ elements: source, selectedIds: ["root", "detail"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: target });
    if (!plan.ok) throw new Error(plan.reason);
    expect(getNodeLens(plan.additions.find((e) => e.id === "pay")!)?.expandsTo).toEqual({ frameKey: "detail" });
    expect(plan.additions.filter((e) => e.type === "frame").map((e) => getFrameLens(e)?.lensKey).sort()).toEqual(["detail", "root"]);
  });

  it("a node moved out of its frame alone loses the frame membership but keeps its link to a frame left behind", () => {
    const plan = planMove({ elements: source, selectedIds: ["pay"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: target });
    if (!plan.ok) throw new Error(plan.reason);
    const moved = plan.additions.find((e) => e.id === "pay")!;
    expect(moved.frameId).toBeNull();
    expect(getNodeLens(moved)?.expandsTo).toEqual({ frameKey: "detail", canvasId: "c1" });
  });
});

describe("Move to canvas: what travels together and what is refused", () => {
  const target: MoveElement[] = [el({ id: "t1", type: "rectangle", x: 500, y: 40, width: 100 })];

  it("takes the bound text, and an arrow only when both ends move", () => {
    const scene: MoveElement[] = [
      ...shape("a", "A", { key: "k.a" }),
      ...shape("b", "B", { key: "k.b" }, undefined, 300),
      ...shape("c", "C", { key: "k.c" }, undefined, 600),
      el({ id: "ab", type: "arrow", startBinding: { elementId: "a" }, endBinding: { elementId: "b" } }),
      el({ id: "bc", type: "arrow", startBinding: { elementId: "b" }, endBinding: { elementId: "c" } }),
    ];
    const plan = planMove({ elements: scene, selectedIds: ["a", "b"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: [] });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.additions.map((e) => e.id).sort()).toEqual(["a", "a_t", "ab", "b", "b_t"]);
    // the arrow left behind loses the end that moved, and the shape that stays drops the moved arrow from its bindings
    const bc = plan.sourceElements.find((e) => e.id === "bc")!;
    expect(bc.startBinding).toBeNull();
    expect(bc.endBinding).toEqual({ elementId: "c" });
    expect(plan.sourceElements.find((e) => e.id === "c")?.isDeleted).toBe(false);
  });

  it("unbinds a moved arrow's end that stays behind", () => {
    const scene: MoveElement[] = [...shape("a", "A", { key: "k.a" }), ...shape("c", "C", { key: "k.c" }, undefined, 600), el({ id: "ac", type: "arrow", startBinding: { elementId: "a" }, endBinding: { elementId: "c" } })];
    const plan = planMove({ elements: scene, selectedIds: ["ac"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: [] });
    if (!plan.ok) throw new Error(plan.reason);
    const arrow = plan.additions.find((e) => e.id === "ac")!;
    expect(arrow.startBinding).toBeNull();
    expect(arrow.endBinding).toBeNull();
  });

  it("lands clear of what the target already holds", () => {
    const scene = [...shape("a", "A", { key: "k.a" })];
    const plan = planMove({ elements: scene, selectedIds: ["a"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: target });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.additions.find((e) => e.id === "a")!.x).toBeGreaterThan(600);
  });

  it("refuses rich blocks, page previews and images rather than half-moving them", () => {
    const scene: MoveElement[] = [el({ id: "rb", type: "embeddable" }), el({ id: "im", type: "image" })];
    expect(planMove({ elements: scene, selectedIds: ["rb"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: [] })).toMatchObject({ ok: false });
    expect(planMove({ elements: scene, selectedIds: ["im"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: [] })).toMatchObject({ ok: false });
  });

  it("refuses an empty selection, the same canvas, and an id that already exists on the target", () => {
    const scene = [...shape("a", "A", { key: "k.a" })];
    expect(planMove({ elements: scene, selectedIds: [], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: [] })).toMatchObject({ ok: false });
    expect(planMove({ elements: scene, selectedIds: ["a"], sourceCanvasId: "c1", targetCanvasId: "c1", targetElements: [] })).toMatchObject({ ok: false });
    expect(planMove({ elements: scene, selectedIds: ["a"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: [el({ id: "a", type: "rectangle" })] })).toMatchObject({ ok: false });
  });

  it("deleting the moved elements bumps their version so a synced scene sees it", () => {
    const scene = [...shape("a", "A", { key: "k.a" })];
    const plan = planMove({ elements: scene, selectedIds: ["a"], sourceCanvasId: "c1", targetCanvasId: "c2", targetElements: [] });
    if (!plan.ok) throw new Error(plan.reason);
    const gone = plan.sourceElements.find((e) => e.id === "a")!;
    expect(gone.isDeleted).toBe(true);
    expect(gone.version).toBe(2);
  });
});
