/**
 * Links inside a section (content fidelity Wave D): members a link joins are placed next to each other, so the link
 * is short and crosses no card — measured with the layout check the review bar reports.
 */
import { describe, expect, it } from "vitest";
import { checkProposal } from "@/ai/changes/proposalGeometry";
import { renderVisualPlan } from "@/ai/renderer/render";
import type { GroupArrangement } from "@/ai/visual-plan/types";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { wrapSections } from "@/ai/visual-plan/groups";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const metadata = { createdBy: "ai" as const, task: "generate_visual_plan", operationId: "op" };

/** The decision reply as the live run of 2026-09-30 laid it out: an analysis card linked to blocks spread over the section. */
function decisionSection(arrangement: GroupArrangement) {
  const text = (id: string, words: number) => ({ id, type: "text", parent: "g", content: { markdown: `${id} `.repeat(words) } });
  return validateVisualPlan({
    version: 1,
    template: "sectioned",
    nodes: [
      { id: "g", type: "group", content: { label: "Decisions", arrangement } },
      text("intro", 30),
      { id: "table", type: "table", parent: "g", content: { columns: ["", "Decision", "My proposal"], rows: Array.from({ length: 6 }, (_, i) => [`D${i + 1}`, "A decision to take here", "The proposal for it, in a few words"]) } },
      text("requests", 40),
      text("summary", 25),
      { id: "status", type: "text", parent: "g", origin: "analysis", title: "Status", content: { markdown: "D1 proposed · D2 needs the engineer · D5 deferred" } },
    ],
    relationships: [
      { from: "intro", to: "table", type: "relates_to" },
      { from: "status", to: "table", type: "supports" },
      { from: "summary", to: "requests", type: "supports" },
      { from: "status", to: "intro", type: "supports" },
    ],
  }).plan;
}

async function issues(arrangement: GroupArrangement) {
  const set = await renderVisualPlan(decisionSection(arrangement), { operationId: "op", title: "t", metadata, context, parseMarkdown: parse });
  const report = checkProposal(set.changes, []);
  return report.counts;
}

describe("links inside a section are short (Wave D)", () => {
  for (const arrangement of ["stack", "grid"] as const) {
    it(`${arrangement}: no link runs through a card, none crosses another`, async () => {
      const counts = await issues(arrangement);
      expect(counts.throughCards).toBe(0);
      expect(counts.crossings).toBe(0);
    });
  }
});

/** A larger section, as the live hand-off note's: six cards in a grid, linked across rows and diagonally. */
function largeGrid() {
  const card = (id: string, words: number) => ({ id, type: "text", parent: "g", content: { markdown: `${id} `.repeat(words) } });
  return validateVisualPlan({
    version: 1,
    template: "sectioned",
    nodes: [
      { id: "g", type: "group", content: { label: "Features", arrangement: "grid" } },
      card("a", 60),
      card("b", 20),
      card("c", 90),
      card("d", 40),
      card("e", 70),
      card("f", 30),
      card("h", 50),
    ],
    relationships: [
      { from: "a", to: "e", type: "supports" },
      { from: "b", to: "f", type: "supports" },
      { from: "c", to: "d", type: "depends_on" },
      { from: "h", to: "a", type: "relates_to" },
      { from: "f", to: "c", type: "flows_to" },
    ],
  }).plan;
}

describe("a larger grid section keeps its links clear of its cards", () => {
  it("no link through a card, even across rows and diagonally", async () => {
    const set = await renderVisualPlan(largeGrid(), { operationId: "op", title: "t", metadata, context, parseMarkdown: parse });
    const report = checkProposal(set.changes, []);
    expect(report.counts.throughCards).toBe(0);
  });
});

describe("the C-shaped route is only for a link that skips a box", () => {
  it("between two stacked boxes it goes around the side; with nothing between, the facing sides stay", async () => {
    const { routeConnectors } = await import("@/ai/changes/routing");
    const top = { id: "top", x: 0, y: 0, width: 300, height: 100 };
    const mid = { id: "mid", x: 0, y: 150, width: 300, height: 100 };
    const bottom = { id: "bottom", x: 0, y: 300, width: 300, height: 100 };
    const skipping = routeConnectors([{ key: "k", from: top, to: bottom }], [mid]).get("k")!;
    expect([skipping.fromSide, skipping.toSide]).toEqual(["left", "left"]);
    // A box off to the side, not between them, is no reason to leave the facing sides.
    const beside = { id: "beside", x: 400, y: 150, width: 300, height: 100 };
    const direct = routeConnectors([{ key: "k", from: top, to: mid }], [beside]).get("k")!;
    expect([direct.fromSide, direct.toSide]).toEqual(["bottom", "top"]);
  });
});

/** A tree section with explanations, as the live "Structure" sections: a root, its children, a detail card on each. */
function treeWithDetails() {
  const shape = (id: string) => ({ id, type: "shape", parent: "g", content: { shape: "rectangle", label: `Node ${id}` } });
  const detail = (id: string, words: number) => ({ id, type: "text", parent: "g", content: { markdown: `${id} `.repeat(words) } });
  return validateVisualPlan({
    version: 1,
    template: "sectioned",
    nodes: [
      { id: "g", type: "group", content: { label: "Structure", arrangement: "tree" } },
      shape("root"),
      shape("c1"),
      shape("c2"),
      shape("c3"),
      detail("root-detail", 40),
      detail("c1-detail", 30),
      detail("c3-detail", 50),
    ],
    relationships: [
      { from: "root", to: "c1", type: "relates_to" },
      { from: "root", to: "c2", type: "relates_to" },
      { from: "root", to: "c3", type: "relates_to" },
      { from: "root", to: "root-detail", type: "explained_by" },
      { from: "c1", to: "c1-detail", type: "explained_by" },
      { from: "c3", to: "c3-detail", type: "explained_by" },
    ],
  }).plan;
}

describe("a tree section's explanations don't put links through its cards", () => {
  it("no link through a card", async () => {
    const set = await renderVisualPlan(treeWithDetails(), { operationId: "op", title: "t", metadata, context, parseMarkdown: parse });
    const report = checkProposal(set.changes, []);
    expect(report.counts.throughCards).toBe(0);
    expect(report.counts.crossings).toBe(0);
  });

  it("a parent is centred over its children, and its explanation sits beside it, not under the children", async () => {
    const { layoutPlan } = await import("@/ai/renderer/layout");
    const boxes = layoutPlan(treeWithDetails());
    const [root, c1, c3Detail, detail] = ["root", "c1", "c3-detail", "root-detail"].map((id) => boxes.get(id)!);
    // The children's span, c3's explanation column included (it is part of c3's room in the tree).
    const kidsCentre = (c1!.x + c3Detail!.x + c3Detail!.width) / 2;
    const rootRoomCentre = (root!.x + detail!.x + detail!.width) / 2;
    expect(Math.abs(rootRoomCentre - kidsCentre)).toBeLessThan(2);
    expect(detail!.y).toBe(root!.y);
    expect(detail!.x).toBeGreaterThan(root!.x + root!.width);
    expect(c1!.y).toBeGreaterThanOrEqual(detail!.y + detail!.height);
  });
});

/** The live hand-off "Decision" section: shapes with two or three detail cards each, linked to each other. */
function shapesWithSeveralDetails() {
  // Through the Visualize section step (wrapSections), as a model's reply goes: it frames the section.
  const shape = (id: string) => ({ id, type: "shape", stableKey: `S § ${id}`, content: { shape: "rectangle", label: `Decision ${id}` } });
  const detail = (id: string, words: number) => ({ id, type: "text", stableKey: `S § ${id}`, title: `About ${id}`, content: { markdown: `${id} `.repeat(words) } });
  const raw = {
    version: 1,
    template: "sectioned",
    nodes: [
      shape("a"),
      shape("b"),
      shape("c"),
      shape("d"),
      detail("a1", 20),
      detail("a2", 25),
      detail("b1", 20),
      detail("b2", 15),
      detail("b3", 20),
      detail("c1", 30),
      detail("d1", 20),
      detail("d2", 20),
    ],
    relationships: [
      { from: "a", to: "b", type: "relates_to" },
      { from: "a", to: "c", type: "relates_to" },
      { from: "b", to: "d", type: "depends_on" },
      ...[["a", "a1"], ["a", "a2"], ["b", "b1"], ["b", "b2"], ["b", "b3"], ["c", "c1"], ["d", "d1"], ["d", "d2"]].map(([from, to]) => ({ from: from!, to: to!, type: "explained_by" as const })),
    ],
  };
  return validateVisualPlan(wrapSections(raw, [{ key: "S", label: "Decisions", arrangement: "grid", kind: "decision" }])).plan;
}

describe("shapes with several detail cards keep their links apart", () => {
  it("no link through a card, none crossing another", async () => {
    const set = await renderVisualPlan(shapesWithSeveralDetails(), { operationId: "op", title: "t", metadata, context, parseMarkdown: parse });
    const report = checkProposal(set.changes, []);
    expect(report.counts.throughCards).toBe(0);
    expect(report.counts.crossings).toBe(0);
  });

  it("a node's short details become one card, every detail kept under its own title", () => {
    const plan = shapesWithSeveralDetails();
    const texts = plan.nodes.filter((n) => n.type === "text");
    expect(texts.map((n) => n.id)).toEqual(["a1", "b1", "c1", "d1"]);
    const b = texts.find((n) => n.id === "b1")!;
    expect(b.type === "text" && b.content.markdown).toBe(`**About b1**

${"b1 ".repeat(20)}

**About b2**

${"b2 ".repeat(15)}

**About b3**

${"b3 ".repeat(20)}`);
    expect(plan.relationships.filter((r) => r.type === "explained_by").map((r) => `${r.from}>${r.to}`)).toEqual(["a>a1", "b>b1", "c>c1", "d>d1"]);
  });
});
