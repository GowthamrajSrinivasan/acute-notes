import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { geometryOf } from "@/ai/renderer/geometry";
import { layoutPlanWithParts } from "@/ai/renderer/layout";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { planRearrange, rearrangeSource } from "./rearrange";
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

describe("rearrangeSource finds each section's frame by its title (F6)", () => {
  // Sections A and B, each with a title object and three cards in its own frame.
  const secs = ["A", "B"];
  const planNodes = secs.flatMap((s) => [
    { id: `g${s}`, type: "group", stableKey: `${s} § group#0`, role: "notes", content: { label: `Section ${s}`, arrangement: "grid" } },
    ...[0, 1, 2].map((i) => ({ id: `${s}t${i}`, type: "text", stableKey: `${s} § text#${i}`, parent: `g${s}`, content: { markdown: `${s} point ${i}` } })),
  ]);
  const plan = { version: 1, template: "sectioned", nodes: planNodes, relationships: [] };
  const frameAt = { A: { x: 0, y: 0 }, B: { x: 3000, y: 0 } } as const;
  const scene = [
    { id: "fA", type: "frame", ...frameAt.A, width: 1500, height: 900, isDeleted: false },
    { id: "fB", type: "frame", ...frameAt.B, width: 1500, height: 900, isDeleted: false },
  ] as unknown as SceneElement[];
  /** Every object away from its layout spot; `dragged` cards sit in the other section's frame. */
  const objects = (dragged: Record<string, "fA" | "fB">): ExistingObject[] =>
    planNodes.map((n, i) => {
      const own = `f${n.stableKey[0]}`;
      const frameId = dragged[n.id] ?? own;
      const at = frameId === "fA" ? frameAt.A : frameAt.B;
      return { objectId: `o_${n.id}`, stableNodeKey: n.stableKey, baseline: "b", current: "b", excluded: false, shape: "block", box: { x: at.x + 700 + i * 13, y: at.y + 600 + i * 7, width: 200, height: 80 }, frameId };
    });
  const moved = (set: ReturnType<typeof rearrangeSource>) => (set?.changes ?? []).flatMap((c) => (c.kind === "move" ? [c.target] : []));

  it("re-arranging B never moves a card of A that the user dragged into B's frame", () => {
    const set = rearrangeSource({ plan, existing: objects({ At0: "fB" }), scene, operationId: "op_f6b", frames: new Set(["fB"]) });
    expect(moved(set)).not.toContain("o_At0");
    expect(moved(set)).toEqual(expect.arrayContaining(["o_Bt0", "o_Bt1", "o_Bt2"]));
    for (const id of moved(set)) expect(id.startsWith("o_B")).toBe(true);
  });

  it("re-arranging A leaves that card in B, and arranges A without it", () => {
    const set = rearrangeSource({ plan, existing: objects({ At0: "fB" }), scene, operationId: "op_f6a", frames: new Set(["fA"]) });
    expect(moved(set)).not.toContain("o_At0");
    expect(moved(set)).toEqual(expect.arrayContaining(["o_At1", "o_At2"]));
    // A is laid out with its two remaining cards: the first of them takes the first slot (the frame's left).
    const to = new Map(set!.changes.flatMap((c) => (c.kind === "move" ? [[c.target, c.to] as const] : [])));
    expect(to.get("o_At1")!.x).toBeLessThan(to.get("o_At2")!.x);
  });

  it("the title's frame wins even when most of the section's cards were dragged elsewhere", () => {
    // Two of A's three cards dragged into B: without the title rule, A's frame would be B's and re-arranging B would move them.
    const set = rearrangeSource({ plan, existing: objects({ At0: "fB", At1: "fB" }), scene, operationId: "op_f6t", frames: new Set(["fB"]) });
    for (const id of moved(set)) expect(id.startsWith("o_B")).toBe(true);
    const own = rearrangeSource({ plan, existing: objects({ At0: "fB", At1: "fB" }), scene, operationId: "op_f6t2", frames: new Set(["fA"]) });
    // Re-arranging A moves only the card still in A's frame; the two dragged into B stay where the user put them.
    expect(moved(own)).toEqual(["o_At2"]);
  });

  it("without a title object, the frame most members are in wins", () => {
    const noTitles = objects({ At0: "fB" }).filter((o) => !o.stableNodeKey.includes("group"));
    const set = rearrangeSource({ plan, existing: noTitles, scene, operationId: "op_f6m", frames: new Set(["fB"]) });
    for (const id of moved(set)) expect(id.startsWith("o_B")).toBe(true);
  });
});

describe("rearrangeSource lays out with real sizes (F8)", () => {
  // One section, six cards in a 3-column grid; the first card was resized by the user to be much taller than estimated.
  const planNodes = [
    { id: "g", type: "group", stableKey: "S § group#0", role: "notes", content: { label: "Section", arrangement: "grid" } },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, type: "text", stableKey: `S § text#${i}`, parent: "g", content: { markdown: `A point that is long enough to fill a card, number ${i}, and a little more text` } })),
  ];
  const plan = { version: 1, template: "sectioned", nodes: planNodes, relationships: [] };
  const frame = { id: "f", type: "frame", x: 0, y: 0, width: 2000, height: 1500, isDeleted: false };
  const objects = (tall: number): ExistingObject[] =>
    planNodes.map((n, i) => ({ objectId: `o_${n.id}`, stableNodeKey: n.stableKey, baseline: "b", current: "b", excluded: false, shape: "block", box: { x: 9000 + i * 17, y: 9000 + i * 11, width: 420, height: n.id === "t0" ? tall : 90 }, frameId: "f" }));
  const sceneOf = (existing: readonly ExistingObject[]) =>
    [frame, ...existing.map((o) => ({ id: o.objectId, type: "rectangle", ...o.box!, frameId: "f", isDeleted: false, customData: { acuteLayout: { x: o.box!.x, y: o.box!.y } } }))] as unknown as SceneElement[];

  it("a resized card no longer overlaps the card below it after re-arrange", () => {
    const existing = objects(700);
    const scene = sceneOf(existing);
    const set = rearrangeSource({ plan, existing, scene, operationId: "op_f8" });
    expect(geometryOf(set!.changes, scene).cardOverlaps).toEqual([]);
    // Not vacuous: the moves a layout at the estimated sizes proposes (what re-arrange did before) overlap the tall card.
    const estimated = rearrangeSource({ plan, existing: objects(90), scene: sceneOf(objects(90)), operationId: "op_f8_old" });
    expect(geometryOf(estimated!.changes, scene).cardOverlaps.length).toBeGreaterThan(0);
  });

  it("only proposes moves, never a resize", () => {
    const existing = objects(700);
    const set = rearrangeSource({ plan, existing, scene: sceneOf(existing), operationId: "op_f8m" });
    expect(new Set(set!.changes.map((c) => c.kind))).toEqual(new Set(["move"]));
  });
});

describe("rearrangeSource keeps the cards the user placed (F3)", () => {
  // One section, six cards in a grid inside frame "f". Every card is still where Acute put it except where a test says otherwise.
  const planNodes = [
    { id: "g", type: "group", stableKey: "S § group#0", role: "notes", content: { label: "Section", arrangement: "grid" } },
    ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: `t${i}`, type: "text", stableKey: `S § text#${i}`, parent: "g", content: { markdown: `Point number ${i}, with enough words to make a card` } })),
  ];
  const plan = { version: 1, template: "sectioned", nodes: planNodes, relationships: [] };
  const frame = { id: "f", type: "frame", x: 0, y: 0, width: 2400, height: 1600, isDeleted: false };
  /** `moved`: cards the user dragged to a new spot (their layout hint still says where Acute put them). */
  const setup = (moved: Record<string, { x: number; y: number }> = {}) => {
    const existing: ExistingObject[] = planNodes
      .filter((n) => n.type !== "group")
      .map((n, i) => ({ objectId: `o_${n.id}`, stableNodeKey: n.stableKey, baseline: "b", current: "b", excluded: false, shape: "block", box: { x: 3000 + i * 300, y: 3000, width: 420, height: 90 }, frameId: "f" }));
    const scene = [
      frame,
      ...existing.map((o) => {
        const to = moved[o.objectId];
        return { id: o.objectId, type: "rectangle", ...o.box!, ...(to ?? {}), frameId: "f", isDeleted: false, customData: { acuteLayout: { x: o.box!.x, y: o.box!.y } } };
      }),
    ] as unknown as SceneElement[];
    // What reconciliation reports: where each object is now.
    for (const o of existing) if (moved[o.objectId]) o.box = { ...o.box!, ...moved[o.objectId]! };
    return { existing, scene };
  };
  const movedIds = (set: ReturnType<typeof rearrangeSource>) => (set?.changes ?? []).flatMap((c) => (c.kind === "move" ? [c.target] : []));

  it("a card the user moved within its frame is not moved, and no laid-out card overlaps it", () => {
    const { existing, scene } = setup({ o_t1: { x: 60, y: 120 } });
    const result = planRearrange({ plan, existing, scene, operationId: "op_f3" });
    expect(movedIds(result.set)).not.toContain("o_t1");
    expect(movedIds(result.set)).toEqual(expect.arrayContaining(["o_t0", "o_t2", "o_t3", "o_t4", "o_t5"]));
    expect(result.kept).toEqual(["o_t1"]);
    const g = geometryOf(result.set!.changes, scene);
    expect(g.cardOverlaps).toEqual([]);
    expect(g.movedUserPlaced).toEqual([]);
  });

  it('"Also move cards I placed" moves it too, as before', () => {
    const { existing, scene } = setup({ o_t1: { x: 60, y: 120 } });
    const result = planRearrange({ plan, existing, scene, operationId: "op_f3b", moveUserPlaced: true });
    expect(movedIds(result.set)).toContain("o_t1");
    expect(result.kept).toEqual([]);
    expect(geometryOf(result.set!.changes, scene).movedUserPlaced).toEqual(["o_t1"]);
  });

  it("a card of the user's own in the frame (no link to the source) is never overlapped", () => {
    const { existing, scene } = setup();
    const own = { id: "mine", type: "rectangle", x: 40, y: 100, width: 600, height: 200, frameId: "f", isDeleted: false } as unknown as SceneElement;
    const set = rearrangeSource({ plan, existing, scene: [...scene, own], operationId: "op_f3c" });
    expect(movedIds(set)).not.toContain("mine");
    expect(geometryOf(set!.changes, [...scene, own]).cardOverlaps).toEqual([]);
  });

  it("a pinned card stops being pinned once it is back where Acute put it", () => {
    const { existing, scene } = setup();
    expect(planRearrange({ plan, existing, scene, operationId: "op_f3d" }).kept).toEqual([]);
  });

  it("stays scoped: on a selection, a pinned card in another section changes nothing there", () => {
    const { existing, scene } = setup({ o_t1: { x: 60, y: 120 } });
    expect(rearrangeSource({ plan, existing, scene, operationId: "op_f3e", frames: new Set(["elsewhere"]) })).toBeNull();
    const set = rearrangeSource({ plan, existing, scene, operationId: "op_f3f", frames: new Set(["f"]) });
    expect(geometryOf(set!.changes, scene, { scope: new Set(["f"]) }).outsideScope).toEqual([]);
  });
});

describe("rearrangeSource with sub-groups (organisation v2)", () => {
  const planNodes = [
    { id: "g", type: "group", stableKey: "P § group#0", role: "notes", content: { label: "Persistence", arrangement: "grid" } },
    { id: "ext", type: "group", parent: "g", stableKey: "P § group#1", content: { label: "External", arrangement: "grid" } },
    { id: "db", type: "shape", parent: "g", stableKey: "P § shape#0", content: { shape: "rectangle", label: "Orders DB" } },
    { id: "sup", type: "shape", parent: "ext", stableKey: "P § shape#1", content: { shape: "rectangle", label: "Supplier API" } },
    { id: "pay", type: "shape", parent: "ext", stableKey: "P § shape#2", content: { shape: "rectangle", label: "Payments API" } },
  ];
  const plan = { version: 1, template: "sectioned", nodes: planNodes, relationships: [] };
  const existing: ExistingObject[] = planNodes
    .filter((n) => n.type !== "group" || n.id === "ext")
    .map((n, i) => ({ objectId: `o_${n.id}`, stableNodeKey: n.stableKey, baseline: "b", current: "b", excluded: false, shape: "block", box: { x: 5000 + i * 250, y: 5000, width: 160, height: 60 }, frameId: "f" }));
  const scene = [{ id: "f", type: "frame", x: 0, y: 0, width: 1500, height: 900, isDeleted: false }] as unknown as SceneElement[];

  it("moves the sub-group's members and its title inside the section's frame, and draws its backdrop there", () => {
    const set = rearrangeSource({ plan, existing, scene, operationId: "op_v2", organisation: "v2" });
    const to = new Map(set!.changes.flatMap((c) => (c.kind === "move" ? [[c.target, c.to] as const] : [])));
    expect([...to.keys()]).toEqual(expect.arrayContaining(["o_db", "o_sup", "o_pay", "o_ext"]));
    const backdrop = set!.changes.find((c) => c.kind === "create_shape" && c.key === "g::sub0");
    expect(backdrop).toBeDefined();
    const b = backdrop!.kind === "create_shape" ? backdrop!.box : { x: 0, y: 0, width: 0, height: 0 };
    for (const id of ["o_sup", "o_pay", "o_ext"]) {
      const p = to.get(id)!;
      expect(p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height, id).toBe(true);
    }
    expect(set!.changes).toContainEqual({ kind: "update_frame", target: "f", add: ["g::sub0"] });
  });
});

describe("rearrange's own geometry check (§3.4.4)", () => {
  it("measures every proposal; on a selection nothing is outside it", () => {
    const sections = ["A", "B"];
    const twoNodes = sections.flatMap((s) => [
      { id: `g${s}`, type: "group", stableKey: `${s} § group#0`, role: "notes", content: { label: `Section ${s}`, arrangement: "grid" } },
      ...[0, 1].map((i) => ({ id: `${s}t${i}`, type: "text", stableKey: `${s} § text#${i}`, parent: `g${s}`, content: { markdown: `${s} point ${i}` } })),
    ]);
    const existing: ExistingObject[] = twoNodes
      .filter((n) => n.type !== "group")
      .map((n, i) => ({ objectId: `o_${n.id}`, stableNodeKey: n.stableKey, baseline: "b", current: "b", excluded: false, shape: "block", box: { x: 9000 + i * 11, y: 9000, width: 200, height: 80 }, frameId: `f${n.stableKey[0]}` }));
    const scene = [
      { id: "fA", type: "frame", x: 0, y: 0, width: 900, height: 900, isDeleted: false },
      { id: "fB", type: "frame", x: 2000, y: 0, width: 900, height: 900, isDeleted: false },
    ] as unknown as SceneElement[];
    const result = planRearrange({ plan: { version: 1, template: "sectioned", nodes: twoNodes, relationships: [] }, existing, scene, operationId: "op_g", frames: new Set(["fA"]) });
    expect(result.geometry).not.toBeNull();
    expect(result.geometry!.outsideScope).toEqual([]);
    expect(result.geometry!.cardOverlaps).toEqual([]);
  });
});

describe("rearrangeSource on a split section (organisation v2, F6)", () => {
  // One section of 3 sub-topics with long cards: v2 draws it as 3 frames (part 1 the section's, then `g::part2`, `g::part3`).
  const LONG = "A card body long enough to wrap over several lines, so that the section grows the way distilled notes do. ".repeat(3);
  const nodes: VisualNode[] = [{ id: "g", type: "group", stableKey: "doc § group#0", content: { label: "Big section", arrangement: "grid", takeaway: "One long section." } } as VisualNode];
  const relationships: VisualPlan["relationships"] = [];
  for (let t = 1; t <= 3; t++) {
    nodes.push({ id: `h${t}`, type: "heading", parent: "g", stableKey: `doc § h${t}`, content: { text: `Topic ${"ABC"[t - 1]}` } } as VisualNode);
    for (let c = 1; c <= 4; c++) nodes.push({ id: `t${t}c${c}`, type: "text", parent: "g", stableKey: `doc § t${t}c${c}`, title: `Topic ${t} card ${c}`, content: { markdown: LONG } } as VisualNode);
    nodes.push({ id: `t${t}x`, type: "text", parent: "g", stableKey: `doc § t${t}x`, title: `Why ${t}`, content: { markdown: "Because the source says so." } } as VisualNode);
    relationships.push({ from: `t${t}c1`, to: `t${t}x`, type: "explained_by", label: "why" });
  }
  const plan: VisualPlan = { version: 1, template: "sectioned", nodes, relationships };
  // The canvas as a v2 first run left it, shifted, with every card nudged off its place so that a re-arrange moves it back.
  const laid = layoutPlanWithParts(validateVisualPlan(plan, { stored: true }).plan, { organisation: "v2" });
  const parts = laid.parts.get("g")!;
  const SHIFT = { x: 1000, y: 500 };
  const frameIdOf = (i: number) => `fP${i + 1}`;
  const partOf = new Map(parts.flatMap((p, i) => p.children.map((k) => [k, i] as const)));
  const scene = parts.map((p, i) => {
    const b = laid.boxes.get(p.key)!;
    return { id: frameIdOf(i), type: "frame", x: b.x + SHIFT.x, y: b.y + SHIFT.y, width: b.width, height: b.height, isDeleted: false };
  }) as unknown as SceneElement[];
  const existing: ExistingObject[] = nodes.flatMap((n) => {
    const at = n.type === "group" ? "g::title" : n.id;
    const b = laid.boxes.get(at);
    const part = partOf.get(at) ?? (n.type === "group" ? 0 : undefined);
    if (!b || part === undefined) return [];
    return [{ objectId: `o_${n.id}`, stableNodeKey: n.stableKey!, baseline: "b", current: "b", excluded: false, shape: "block" as const, box: { x: b.x + SHIFT.x + 40, y: b.y + SHIFT.y + 30, width: b.width, height: b.height }, frameId: frameIdOf(part) }];
  });
  const moves = (set: ReturnType<typeof rearrangeSource>) => new Map((set?.changes ?? []).flatMap((c) => (c.kind === "move" ? [[c.target, c.to] as const] : [])));
  const frameOf = new Map(existing.map((o) => [o.objectId, o.frameId!] as const));

  it("the fixture is split into 3 parts, each part's cards in their own frame", () => {
    expect(parts.map((p) => p.key)).toEqual(["g", "g::part2", "g::part3"]);
    expect(new Set(existing.map((o) => o.frameId))).toEqual(new Set(["fP1", "fP2", "fP3"]));
  });

  it("cards in later parts belong to the section: they move back to their place inside their own part's frame", () => {
    const result = planRearrange({ plan, existing, scene, operationId: "op_parts", organisation: "v2" });
    const to = moves(result.set);
    const inLater = existing.filter((o) => o.frameId !== "fP1" && o.stableNodeKey !== "doc § group#0");
    expect(inLater.length).toBeGreaterThan(0);
    for (const o of inLater) {
      const p = to.get(o.objectId);
      expect(p, o.objectId).toEqual({ x: Math.round(o.box!.x - 40), y: Math.round(o.box!.y - 30) });
    }
    // Every move stays inside the frame the card is in.
    const frameBox = new Map(scene.map((f) => [f.id, f] as const));
    for (const [id, p] of to) {
      const f = frameBox.get(frameOf.get(id)!)!;
      expect(p.x >= f.x && p.y >= f.y && p.x < f.x + f.width && p.y < f.y + f.height, id).toBe(true);
    }
    expect(result.kept).toEqual([]);
    expect(result.geometry!.outsideScope).toEqual([]);
  });

  it("stays scoped: selecting one part's frame moves only the cards in that frame", () => {
    const set = rearrangeSource({ plan, existing, scene, operationId: "op_part2", organisation: "v2", frames: new Set(["fP2"]) });
    const targets = (set?.changes ?? []).flatMap((c) => ("target" in c ? [c.target] : []));
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t === "fP2" || frameOf.get(t) === "fP2", t).toBe(true);
    expect(targets).toEqual(expect.arrayContaining(existing.filter((o) => o.frameId === "fP2").map((o) => o.objectId)));
  });
});
