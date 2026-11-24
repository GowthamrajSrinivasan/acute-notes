/**
 * Flow sections as one card (note-taking-modes plan Step 6): only a plain linear flow collapses; anything the native shapes
 * would show that a FlowDiagram can't (a branch, a cycle, a labelled link) leaves the section native; an unlabelled link
 * between a step and another node is kept, ending at the card. Updates collapse only the sections that were already a card.
 */
import { describe, expect, it } from "vitest";
import { ungroup } from "./groups";
import { collapseFlowSections, collapseFlowsLike, flowCardKey, FLOW_CARD_ROLE, hasFlowCards } from "./flowCards";
import type { VisualNode, VisualPlan, VisualRelationship } from "./types";

const group = (id: string, role: string, label = "Release"): VisualNode => ({ id, type: "group", role, stableKey: `s1 § group#0`, content: { label, arrangement: "chain" } });
const step = (id: string, label: string, parent = "g"): VisualNode => ({ id, type: "shape", parent, stableKey: `s1 § ${id}`, content: { shape: "rectangle", label } });
const text = (id: string, markdown: string, extra: Partial<VisualNode> = {}): VisualNode => ({ id, type: "text", parent: "g", stableKey: `s1 § ${id}`, content: { markdown }, ...extra }) as VisualNode;
const rel = (from: string, to: string, type: VisualRelationship["type"] = "flows_to", label?: string): VisualRelationship => ({ from, to, type, ...(label ? { label } : {}) });

/** Steps listed out of order on purpose: the chain decides the order. */
function flowPlan(extraRels: VisualRelationship[] = [], extraNodes: VisualNode[] = []): VisualPlan {
  return {
    version: 1,
    template: "sectioned",
    nodes: [
      group("g", "flow"),
      step("c", "Deploy"),
      step("a", "Build"),
      text("ta", "CI builds and tests."),
      step("b", "QA sign-off"),
      text("tb", "A QA engineer signs off."),
      text("an", "Where it can fail.", { origin: "analysis", title: "Analysis" }),
      ...extraNodes,
    ],
    relationships: [rel("a", "b"), rel("b", "c"), rel("a", "ta", "explained_by"), rel("b", "tb", "explained_by"), ...extraRels],
  };
}

describe("collapseFlowSections", () => {
  it("a plain linear flow becomes one card: steps in chain order, explanations under them, analysis kept", () => {
    const { plan, rename, cards } = collapseFlowSections(flowPlan());
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card).toMatchObject({ type: "text", role: FLOW_CARD_ROLE, parent: "g", title: "Release", stableKey: "s1 § flow-card#0" });
    expect(card.type === "text" && card.content.markdown).toBe("1. **Build**\n\n   CI builds and tests.\n\n2. **QA sign-off**\n\n   A QA engineer signs off.\n\n3. **Deploy**");
    expect(plan.nodes.map((n) => n.id)).toEqual(["g", "g::flow", "an"]);
    expect(plan.relationships).toEqual([]);
    expect([...rename.keys()].sort()).toEqual(["a", "b", "c", "ta", "tb"]);
    expect(new Set(rename.values())).toEqual(new Set(["g::flow"]));
  });

  it("unlinked steps keep the plan's order", () => {
    const plan: VisualPlan = { version: 1, template: "sectioned", nodes: [group("g", "flow"), step("a", "One"), step("b", "Two")], relationships: [] };
    const { cards } = collapseFlowSections(plan);
    expect(cards[0]!.type === "text" && cards[0]!.content.markdown).toBe("1. **One**\n\n2. **Two**");
  });

  it.each([
    ["a branch", [rel("a", "c")]],
    ["a labelled link", [rel("c", "a", "flows_to", "on failure")]],
    ["a cycle back to the start", [rel("c", "a")]],
    ["a labelled link out of the section", [rel("b", "elsewhere", "relates_to", "see")]],
  ])("%s leaves the section native", (_name, extra) => {
    const input = flowPlan(extra as VisualRelationship[]);
    expect(collapseFlowSections(input).plan).toBe(input);
  });

  it("other kinds, one step, a shape with architecture semantics, or no section key: native", () => {
    const notFlow = { ...flowPlan(), nodes: flowPlan().nodes.map((n) => (n.id === "g" ? group("g", "hierarchy") : n)) };
    expect(collapseFlowSections(notFlow).cards).toHaveLength(0);
    const one: VisualPlan = { version: 1, template: "sectioned", nodes: [group("g", "flow"), step("a", "Only")], relationships: [] };
    expect(collapseFlowSections(one).cards).toHaveLength(0);
    const kinded = { ...flowPlan(), nodes: flowPlan().nodes.map((n) => (n.id === "a" && n.type === "shape" ? { ...n, content: { ...n.content, kind: "backend" as const } } : n)) };
    expect(collapseFlowSections(kinded).cards).toHaveLength(0);
    const unkeyed = { ...flowPlan(), nodes: flowPlan().nodes.map((n) => (n.id === "g" ? { ...n, stableKey: undefined } : n)) };
    expect(collapseFlowSections(unkeyed).cards).toHaveLength(0);
  });

  it("unlabelled links between a step and another node are kept, ending at the card, once (live run 2026-11-24)", () => {
    // The model's analysis relating to steps, a link out of the section, an explained analysis.
    const { plan, cards } = collapseFlowSections(flowPlan([rel("an", "a", "relates_to"), rel("an", "b", "relates_to"), rel("b", "elsewhere"), rel("c", "an", "explained_by")]));
    expect(cards).toHaveLength(1);
    expect(plan.relationships).toEqual([
      { from: "an", to: "g::flow", type: "relates_to" },
      { from: "g::flow", to: "elsewhere", type: "flows_to" },
      { from: "g::flow", to: "an", type: "explained_by" },
    ]);
  });

  it("an explanation linked from two steps, or a table explaining a step: kept as its own node, linked from the card", () => {
    const shared = collapseFlowSections(flowPlan([rel("c", "ta", "explained_by")]));
    expect(shared.plan.nodes.map((n) => n.id)).toContain("ta");
    expect(shared.plan.relationships).toEqual([{ from: "g::flow", to: "ta", type: "explained_by" }]);
    const table = collapseFlowSections(flowPlan([rel("c", "t", "explained_by")], [{ id: "t", type: "table", parent: "g", content: { columns: ["x"], rows: [] } }]));
    expect(table.plan.relationships).toEqual([{ from: "g::flow", to: "t", type: "explained_by" }]);
  });

  it("an explanation's title is kept, in bold, above its text", () => {
    const plan = flowPlan();
    plan.nodes = plan.nodes.map((n) => (n.id === "ta" ? { ...n, title: "What CI does" } : n));
    const card = collapseFlowSections(plan).cards[0]!;
    expect(card.type === "text" && card.content.markdown).toContain("1. **Build**\n\n   **What CI does**\n\n   CI builds and tests.");
  });
});

describe("collapseFlowsLike (updates)", () => {
  it("collapses only the sections that were a card before; the flat plan matches the grouped one", () => {
    const previous = collapseFlowSections(flowPlan()).plan;
    expect(hasFlowCards(previous)).toBe(true);
    const next = flowPlan();
    const { flat, grouped, rename } = collapseFlowsLike(ungroup(next), next, previous);
    expect(grouped.nodes.map((n) => n.id)).toEqual(["g", "g::flow", "an"]);
    expect(flat.nodes.map((n) => n.id)).toEqual(["g", "g::flow", "an"]);
    expect(flat.nodes.every((n) => n.parent === undefined)).toBe(true);
    expect(flat.nodes.find((n) => n.id === "g::flow")!.stableKey).toBe(flowCardKey("s1 § group#0"));
    expect(rename.size).toBe(5);
  });

  it("a section that wasn't a card stays native; nothing changes without any card", () => {
    const next = flowPlan();
    const flatNext = ungroup(next);
    const none = collapseFlowsLike(flatNext, next, flowPlan());
    expect(none.flat).toBe(flatNext);
    expect(none.grouped).toBe(next);
  });

  it("a section that was a card but is no longer a plain flow stays native (the review shows the swap)", () => {
    const previous = collapseFlowSections(flowPlan()).plan;
    const branched = flowPlan([rel("a", "c")]);
    const r = collapseFlowsLike(ungroup(branched), branched, previous);
    expect(r.grouped).toBe(branched);
  });
});
