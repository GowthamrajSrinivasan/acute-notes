import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { rearrangeSource } from "./rearrange";
import type { ExistingObject } from "./classify";

const labels = ["Finance", "Fitness", "Learning", "Family"];
const nodes = [
  { id: "g", type: "group", stableKey: "s § group#0", role: "notes", content: { label: "Ecosystem", arrangement: "grid" } },
  ...labels.flatMap((l, i) => [
    { id: `h${i}`, type: "heading", stableKey: `s#h${i}`, parent: "g", content: { text: l } },
    { id: `t${i}`, type: "text", stableKey: `s#t${i}`, parent: "g", content: { markdown: `${l} tracker\nBudget` } },
  ]),
];
const existing: ExistingObject[] = nodes
  .filter((n) => n.type !== "group")
  .map((n, i) => ({ objectId: `o_${n.id}`, stableNodeKey: n.stableKey!, baseline: "b", current: "b", excluded: false, shape: "block", box: { x: 5000 + i * 7, y: 5000 + i * 3, width: 200, height: 80 }, frameId: "frame" }));
const scene = [{ id: "frame", type: "frame", x: 100, y: 200, width: 900, height: 900, isDeleted: false }] as unknown as SceneElement[];

describe("rearrangeSource", () => {
  it("keeps each label with its block", () => {
    const set = rearrangeSource({ plan: { version: 1, template: "sectioned", nodes, relationships: [] }, existing, scene, operationId: "op_1" });
    expect(set).not.toBeNull();
    const to = new Map(set!.changes.flatMap((c) => (c.kind === "move" ? [[c.target, c.to] as const] : [])));
    for (let i = 0; i < labels.length; i++) {
      const head = to.get(`o_h${i}`)!;
      const block = to.get(`o_t${i}`)!;
      expect(Math.abs(block.x - head.x)).toBeLessThan(150);
      expect(block.y).toBeGreaterThan(head.y);
      expect(head.x).toBeGreaterThanOrEqual(100);
    }
  });

  it("proposes nothing for a plan without sections", () => {
    expect(rearrangeSource({ plan: { version: 1, template: "flow", nodes: [nodes[1]!], relationships: [] }, existing, scene, operationId: "op_2" })).toBeNull();
  });
});

describe("rearrangeSource on a selection", () => {
  // Two sections of one source, each in its own frame, every card away from where the layout puts it, and each frame with a backdrop an
  // earlier arrangement drew (which a full re-arrange replaces).
  const sections = ["A", "B"];
  const twoNodes = sections.flatMap((s) => [
    { id: `g${s}`, type: "group", stableKey: `${s} § group#0`, role: "notes", content: { label: `Section ${s}`, arrangement: "grid" } },
    ...[0, 1, 2].map((i) => ({ id: `${s}t${i}`, type: "text", stableKey: `${s} § text#${i}`, parent: `g${s}`, content: { markdown: `${s} point ${i}` } })),
  ]);
  const twoPlan = { version: 1, template: "sectioned", nodes: twoNodes, relationships: [] };
  const twoExisting: ExistingObject[] = twoNodes
    .filter((n) => n.type !== "group")
    .map((n, i) => ({ objectId: `o_${n.id}`, stableNodeKey: n.stableKey, baseline: "b", current: "b", excluded: false, shape: "block", box: { x: 9000 + i * 11, y: 9000 + i * 5, width: 200, height: 80 }, frameId: `f${n.stableKey[0]}` }));
  const twoScene = [
    { id: "fA", type: "frame", x: 0, y: 0, width: 900, height: 900, isDeleted: false },
    { id: "fB", type: "frame", x: 2000, y: 0, width: 900, height: 900, isDeleted: false },
    { id: "bdA", type: "rectangle", x: 10, y: 10, width: 50, height: 50, frameId: "fA", isDeleted: false, customData: { acuteBackdrop: true } },
    { id: "bdB", type: "rectangle", x: 2010, y: 10, width: 50, height: 50, frameId: "fB", isDeleted: false, customData: { acuteBackdrop: true } },
  ] as unknown as SceneElement[];
  const inB = new Set(["o_Bt0", "o_Bt1", "o_Bt2", "bdB", "fB"]);
  const targets = (set: ReturnType<typeof rearrangeSource>) => (set?.changes ?? []).flatMap((c) => ("target" in c ? [c.target] : []));

  it("changes nothing outside the selected frame", () => {
    const set = rearrangeSource({ plan: twoPlan, existing: twoExisting, scene: twoScene, operationId: "op_3", frames: new Set(["fA"]) });
    expect(set).not.toBeNull();
    expect(targets(set).filter((t) => inB.has(t))).toEqual([]);
    // No backdrop is drawn into the other section either.
    for (const c of set!.changes) if (c.kind === "create_shape") expect(c.key.startsWith("gB::")).toBe(false);
    // Not vacuous: the selected section's own cards move, and its old backdrop is replaced.
    expect(targets(set)).toEqual(expect.arrayContaining(["o_At0", "o_At1", "o_At2", "bdA"]));
  });

  it("re-arranges every section when no selection is given", () => {
    const set = rearrangeSource({ plan: twoPlan, existing: twoExisting, scene: twoScene, operationId: "op_4" });
    expect(targets(set)).toEqual(expect.arrayContaining(["o_At0", "o_Bt0", "bdA", "bdB"]));
  });

  it("proposes nothing when the selection holds no section of this source", () => {
    expect(rearrangeSource({ plan: twoPlan, existing: twoExisting, scene: twoScene, operationId: "op_5", frames: new Set(["elsewhere"]) })).toBeNull();
  });
});
