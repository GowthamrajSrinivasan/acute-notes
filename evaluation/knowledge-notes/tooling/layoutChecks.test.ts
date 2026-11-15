/**
 * Lane I (organisation-layout plan §4.3, §5.1): the render checks read from the geometry report (`reading_order_max`,
 * `frames_fit_screen`, `links_over_frames_max`, `rendered_frame_count`, `subgroup_contains`) and the mutation ops
 * `shuffle_groups` and `move_to_group`. Each check passes on a good input and fails, with a reason, on a bad one.
 */
import { describe, expect, it } from "vitest";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { evaluate } from "./evaluate";
import { shuffledGroupOrders } from "./frameOrder";
import { loadDataset } from "./load";
import { mutatePlan } from "./mutate";
import { renderFacts, type RenderFacts } from "./render";
import type { Assertion, Check, ExpectedCanvas } from "./schemas";

const canvas: ExpectedCanvas = {
  datasetVersion: "1.0.0",
  caseId: "kn-99-test",
  template: "sectioned",
  frames: [
    { id: "f.a", title: "Retrieval", titleMatch: { all: [["retrieval"]] }, purpose: "p", rationale: "r", children: ["e.claim", "e.example", "e.code"], requirement: "mandatory", support: "implemented" },
    { id: "f.b", title: "Ranking", titleMatch: { all: [["ranking"]] }, purpose: "p", rationale: "r", children: ["e.rerank"], requirement: "mandatory", support: "implemented" },
  ],
  elements: [
    { id: "e.claim", element: "text_card", planNodeTypes: ["text"], role: "main", content: "c", knowledge: ["ku.x"], match: { all: [["hybrid"]] }, hierarchy: "primary", frame: "f.a", requirement: "mandatory", support: "implemented" },
    { id: "e.example", element: "text_card", planNodeTypes: ["text"], role: "example", content: "c", knowledge: ["ku.x"], match: { all: [["for example"]] }, hierarchy: "detail", frame: "f.a", requirement: "mandatory", support: "implemented" },
    { id: "e.code", element: "text_card", planNodeTypes: ["text"], role: "example", content: "c", knowledge: ["ku.x"], match: { all: [["error code"]] }, hierarchy: "detail", frame: "f.a", requirement: "mandatory", support: "implemented" },
    { id: "e.rerank", element: "shape", planNodeTypes: ["shape"], role: "component", content: "c", knowledge: ["ku.x"], match: { all: [["reranker"]] }, hierarchy: "secondary", frame: "f.b", requirement: "mandatory", support: "implemented" },
  ],
  relationships: [],
};

/** Retrieval holds a claim and an "Examples" sub-group of two cards; Ranking holds the reranker. */
function plan(sub: "both" | "split" | "none" = "both"): VisualPlan {
  return {
    version: 1,
    template: "sectioned",
    nodes: [
      { id: "g1", type: "group", content: { label: "Retrieval", arrangement: "grid" } },
      { id: "g2", type: "group", content: { label: "Ranking", arrangement: "grid" } },
      ...(sub === "none" ? [] : [{ id: "s1", type: "group", parent: "g1", content: { label: "Examples", arrangement: "grid" } }]),
      ...(sub === "split" ? [{ id: "s2", type: "group", parent: "g1", content: { label: "Codes", arrangement: "grid" } }] : []),
      { id: "n1", type: "text", parent: "g1", content: { markdown: "Hybrid search can improve recall." } },
      { id: "n2", type: "text", parent: sub === "none" ? "g1" : "s1", content: { markdown: "For example, a product name." } },
      { id: "n3", type: "text", parent: sub === "none" ? "g1" : sub === "split" ? "s2" : "s1", content: { markdown: "An exact error code." } },
      { id: "n4", type: "shape", parent: "g2", content: { shape: "rectangle", label: "Reranker", kind: "backend" } },
    ],
    relationships: [],
  } as VisualPlan;
}

const assertion = (check: Check): Assertion => ({ id: "a.t", dimension: "visual", severity: "critical", method: "deterministic", target: "render", support: "implemented", description: "t", check });
const run = (check: Check, render: RenderFacts, p: VisualPlan = plan()) => evaluate([assertion(check)], { canvas }, { plan: p, render })[0]!;

/** Facts with only the geometry fields these checks read set; everything else empty. */
function facts(
  over: { frames?: number; inversions?: string[]; oversized?: string[]; linksOver?: string[]; outsideSubGroups?: string[]; subGroups?: RenderFacts["subGroups"]; organisation?: RenderFacts["organisation"]; drawnFrames?: RenderFacts["drawnFrames"] } = {},
): RenderFacts {
  const layout = { issues: [], counts: { crossings: 0, throughCards: 0 } } as unknown as RenderFacts["layout"];
  return {
    organisation: over.organisation ?? "v1",
    drawnFrames: over.drawnFrames ?? [],
    layout,
    cardOverlaps: [],
    outsideFrames: [],
    frameOverlaps: [],
    frames: over.frames ?? 2,
    cards: 4,
    subGroups: over.subGroups ?? [],
    geometry: {
      layout,
      cardOverlaps: [],
      frameOverlaps: [],
      outsideFrames: [],
      outsideSubGroups: over.outsideSubGroups ?? [],
      linksOverFrames: over.linksOver ?? [],
      readingOrder: { inversions: over.inversions?.length ?? 0, detail: over.inversions ?? [] },
      oversizedFrames: over.oversized ?? [],
      movedUserPlaced: [],
      outsideScope: [],
    },
  };
}

describe("render checks from the geometry report", () => {
  it("reading_order_max: at most `max` frames out of reading order", () => {
    expect(run({ check: "reading_order_max", max: 0 }, facts()).status).toBe("pass");
    const r = run({ check: "reading_order_max", max: 0 }, facts({ inversions: ["g2 reads before g1"] }));
    expect(r).toMatchObject({ status: "fail", gate: 3 });
    expect(r.detail).toContain("g2 reads before g1");
    expect(run({ check: "reading_order_max", max: 1 }, facts({ inversions: ["g2 reads before g1"] })).status).toBe("pass");
  });

  it("frames_fit_screen: no frame too large to read whole", () => {
    expect(run({ check: "frames_fit_screen" }, facts()).status).toBe("pass");
    const r = run({ check: "frames_fit_screen" }, facts({ oversized: ["g1 (4000 × 900)"] }));
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("g1 (4000 × 900)");
  });

  it("links_over_frames_max: at most `max` links over a third frame", () => {
    expect(run({ check: "links_over_frames_max", max: 1 }, facts({ linksOver: ["__rel0 over g3"] })).status).toBe("pass");
    const r = run({ check: "links_over_frames_max", max: 0 }, facts({ linksOver: ["__rel0 over g3"] }));
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("__rel0 over g3");
  });

  it("rendered_frame_count: the frames drawn, within bounds", () => {
    expect(run({ check: "rendered_frame_count", min: 2, max: 2 }, facts()).status).toBe("pass");
    expect(run({ check: "rendered_frame_count", min: 3, max: 5 }, facts()).detail).toBe("2 frames drawn, expected 3–5");
  });

  it("a render check without a rendered plan is no_input, never a pass", () => {
    expect(evaluate([assertion({ check: "frames_fit_screen" })], { canvas }, { plan: plan() })[0]!.status).toBe("no_input");
  });
});

describe("subgroup_contains", () => {
  const check: Check = { check: "subgroup_contains", frame: "f.a", elements: ["e.example", "e.code"], why: "examples stay together" };

  it("passes when the elements share a sub-group of the frame and are drawn inside its backdrop (v2)", async () => {
    const v2 = await renderFacts(plan(), { organisation: "v2" });
    expect(v2.subGroups).toEqual([{ id: "s1", backdrop: "g1::sub0", members: ["n2", "n3"] }]);
    expect(v2.geometry.outsideSubGroups).toEqual([]);
    expect(run(check, v2)).toMatchObject({ status: "pass", detail: "together in sub-group s1" });
    expect(run({ ...check, label: [["examples"]] }, v2).status).toBe("pass");
  });

  it("fails when the sub-group isn't drawn (v1 draws none)", async () => {
    const v1 = await renderFacts(plan());
    expect(v1.subGroups).toEqual([]);
    expect(run(check, v1).detail).toContain("isn't drawn");
  });

  it("fails on different sub-groups, no sub-group, the wrong label, or the wrong frame", async () => {
    const split = plan("split");
    expect(run(check, await renderFacts(split, { organisation: "v2" }), split).detail).toContain("different sub-groups");
    const flat = plan("none");
    expect(run(check, await renderFacts(flat, { organisation: "v2" }), flat).detail).toContain("not in a sub-group of f.a");
    const v2 = await renderFacts(plan(), { organisation: "v2" });
    expect(run({ ...check, label: [["codes"]] }, v2).status).toBe("fail");
    expect(run({ ...check, frame: "f.b" }, v2).status).toBe("fail");
  });

  it("fails when a member is drawn outside its backdrop", () => {
    const drawn = facts({ subGroups: [{ id: "s1", backdrop: "g1::sub0", members: ["n2", "n3"] }], outsideSubGroups: ["n3 outside g1::sub0"] });
    expect(run(check, drawn).detail).toContain("n3 outside g1::sub0");
  });
});

describe("mutation ops", () => {
  it("shuffle_groups with an order: the top-level groups swap slots; everything else stays", () => {
    const out = mutatePlan(plan(), [{ op: "shuffle_groups", order: ["g2", "g1"] }]);
    expect(out.nodes.map((n) => n.id)).toEqual(["g2", "g1", "s1", "n1", "n2", "n3", "n4"]);
    expect(out.nodes.find((n) => n.id === "n2")!.parent).toBe("s1");
  });

  it("shuffle_groups with a seed: the robustness report's own order", () => {
    expect(mutatePlan(plan(), [{ op: "shuffle_groups", seed: 7 }]).nodes).toEqual(shuffledGroupOrders(plan(), 1, 7)[0]!.nodes);
  });

  it("shuffle_groups refuses an order that isn't the top-level groups once each, and needs exactly one of order, seed", () => {
    expect(() => mutatePlan(plan(), [{ op: "shuffle_groups", order: ["g2", "s1"] }])).toThrow(/each top-level group once/);
    expect(() => mutatePlan(plan(), [{ op: "shuffle_groups", order: ["g2", "g2"] }])).toThrow(/each top-level group once/);
    expect(() => mutatePlan(plan(), [{ op: "shuffle_groups" }])).toThrow(/exactly one/);
    expect(() => mutatePlan(plan(), [{ op: "shuffle_groups", order: ["g2", "g1"], seed: 1 }])).toThrow(/exactly one/);
  });

  it("move_to_group sets the node's parent, and refuses what can't be moved", () => {
    expect(mutatePlan(plan(), [{ op: "move_to_group", node: "n4", group: "g1" }]).nodes.find((n) => n.id === "n4")!.parent).toBe("g1");
    expect(() => mutatePlan(plan(), [{ op: "move_to_group", node: "nx", group: "g1" }])).toThrow(/no node nx/);
    expect(() => mutatePlan(plan(), [{ op: "move_to_group", node: "n4", group: "n1" }])).toThrow(/no group n1/);
    expect(() => mutatePlan(plan(), [{ op: "move_to_group", node: "s1", group: "g2" }])).toThrow(/is a group/);
    expect(() => mutatePlan(plan(), [{ op: "move_to_group", node: "n4", group: "g2" }])).toThrow(/already in g2/);
  });

  it("the input plan is never changed", () => {
    const p = plan();
    const before = JSON.stringify(p);
    mutatePlan(p, [{ op: "shuffle_groups", order: ["g2", "g1"] }, { op: "move_to_group", node: "n4", group: "g1" }]);
    expect(JSON.stringify(p)).toBe(before);
  });
});

/**
 * What the references measure today, per organisation: frames out of reading order, links over a third frame.
 * Pinned so a layout change that moves them shows up here (and can become a case cap after review). v2 reorders
 * frames by their links (Lane F, F4), so a frame can read out of the plan's order there.
 */
const MEASURED: Record<string, { v1: [number, number]; v2: [number, number] }> = {
  "kn-06-hybrid-search-reranking": { v1: [0, 2], v2: [0, 2] },
  "kn-07-photo-sharing-hld": { v1: [0, 4], v2: [1, 3] },
  "kn-10-inventory-architecture-frames": { v1: [0, 1], v2: [1, 2] },
};

/** References with a section split in organisation v2: the parts it is drawn as. */
const SPLIT_PARTS: Readonly<Record<string, number>> = { "kn-13-connection-pool-runbook": 5 };

describe("the new checks on the references (what a case could assert today)", () => {
  const { cases } = loadDataset();
  it.each(cases.map((c) => [c.id, c] as const))("%s: frames drawn as planned, fit the screen, reading order and links over frames as measured", async (_id, c) => {
    const p = validateVisualPlan(c.referencePlan).plan;
    const groups = p.nodes.filter((n) => n.type === "group").length;
    for (const organisation of ["v1", "v2"] as const) {
      const f = await renderFacts(p, { organisation });
      const [inversions, over] = MEASURED[c.id]?.[organisation] ?? [0, 0];
      expect([f.geometry.readingOrder.inversions, f.geometry.linksOverFrames.length], organisation).toEqual([inversions, over]);
      expect(run({ check: "reading_order_max", max: inversions }, f, p).status).toBe("pass");
      expect(run({ check: "links_over_frames_max", max: over }, f, p).status).toBe("pass");
      // kn-13 is written to need a split: in v1 its operating section is one frame too large to read whole, and v2
      // draws it as parts (frame splitting, organisation-layout plan §3.3), the only reference that splits.
      const split = SPLIT_PARTS[c.id];
      expect(run({ check: "frames_fit_screen" }, f, p).status).toBe(split && organisation === "v1" ? "fail" : "pass");
      const extra = split && organisation === "v2" ? split - 1 : 0;
      // An ungrouped plan is drawn without frames, unless the renderer frames it as one diagram.
      expect(f.frames === groups + extra || (groups === 0 && f.frames <= 1)).toBe(true);
    }
  });
});

describe("frame_part_contains and organisation-scoped assertions (frame splitting, F6)", () => {
  /** Retrieval drawn as two parts: the claim in part 1, the example and the code in part 2. */
  const parts = facts({
    organisation: "v2",
    frames: 3,
    drawnFrames: [
      { key: "g1", title: "Retrieval", children: ["g1::title", "n1"] },
      { key: "g1::part2", title: "Retrieval — Examples", children: ["g1::part2::title", "n2", "n3"] },
      { key: "g2", title: "Ranking", children: ["g2::title", "n4"] },
    ],
  });
  const flat = plan("none");

  it("passes when the elements share one drawn frame of the section, titled as asked", () => {
    const r = run({ check: "frame_part_contains", frame: "f.a", elements: ["e.example", "e.code"], title: [["retrieval"], ["example"]], why: "w" }, parts, flat);
    expect(r.status).toBe("pass");
    expect(r.detail).toContain("g1::part2");
    // Without a title, part 1 (the section's own frame) counts too.
    expect(run({ check: "frame_part_contains", frame: "f.a", elements: ["e.claim"], why: "w" }, parts, flat).status).toBe("pass");
  });

  it("fails, saying where, when the elements are drawn in different parts, or no part has that title", () => {
    const apart = run({ check: "frame_part_contains", frame: "f.a", elements: ["e.claim", "e.example"], why: "the example explains the claim" }, parts, flat);
    expect(apart.status).toBe("fail");
    expect(apart.detail).toContain("e.claim in g1; e.example in g1::part2");
    const untitled = run({ check: "frame_part_contains", frame: "f.a", elements: ["e.example"], title: [["codes"]], why: "w" }, parts, flat);
    expect(untitled.status).toBe("fail");
    expect(untitled.detail).toContain('drawn: "Retrieval", "Retrieval — Examples"');
    // Another section's frame never counts.
    expect(run({ check: "frame_part_contains", frame: "f.a", elements: ["e.rerank"], why: "w" }, parts, flat).status).toBe("fail");
  });

  it("an assertion scoped to organisation v2 is decided on a v2 render only", () => {
    const scoped: Assertion = { ...assertion({ check: "frames_fit_screen" }), organisation: "v2" };
    const oversized = (organisation: "v1" | "v2") => facts({ organisation, oversized: ["g1 (3270 × 1879)"] });
    expect(evaluate([scoped], { canvas }, { plan: flat, render: oversized("v1") })[0]!.status).toBe("not_evaluable");
    expect(evaluate([scoped], { canvas }, { plan: flat, render: oversized("v2") })[0]!.status).toBe("fail");
    expect(evaluate([assertion({ check: "frames_fit_screen" })], { canvas }, { plan: flat, render: oversized("v1") })[0]!.status).toBe("fail");
  });

  it("kn-13: the operating section is one oversized frame in v1 and five parts that fit in v2", async () => {
    const kn13 = loadDataset().cases.find((c) => c.id.startsWith("kn-13"))!;
    const p = validateVisualPlan(kn13.referencePlan).plan;
    const v1 = await renderFacts(p);
    const v2 = await renderFacts(p, { organisation: "v2" });
    expect(v1.geometry.oversizedFrames).toHaveLength(1);
    expect(v2.geometry.oversizedFrames).toEqual([]);
    const titles = v2.drawnFrames.map((f) => f.title);
    expect(titles).toEqual([
      "Why pool connections",
      "Operating the pool",
      "Operating the pool — Timeouts",
      "Operating the pool — Health checks and failover",
      "Operating the pool — Connection leaks",
      "Operating the pool — Watching the pool",
      "Takeaway",
    ]);
  });
});
