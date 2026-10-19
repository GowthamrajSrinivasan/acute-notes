/**
 * Content fidelity Waves C/D (first round): what the canvas signals and how large results read — relation types
 * drawn differently, numbered flow steps, the accent kept for what matters, tables sized to be read, the overview
 * shown over sections when zoomed out, and section-to-section links included in the layout check.
 */
import { describe, expect, it } from "vitest";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { proposalGeometry } from "@/ai/changes/proposalGeometry";
import { relationStyle } from "@/ai/changes/relationStyle";
import { DEFAULT_RESPONSE_STYLE, withResponseStyle } from "@/ai/changes/responseStyle";
import { tableColumnWidths } from "@/ai/renderer/measure";
import { renderVisualPlan } from "@/ai/renderer/render";
import { unnumbered, wrapSections } from "@/ai/visual-plan/groups";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { overviewCards } from "@/components/ai/SectionOverview";
import { RELATION_TYPES } from "@/domain/types";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const metadata = { createdBy: "ai" as const, task: "generate_visual_plan", operationId: "op" };
const render = (raw: unknown) => renderVisualPlan(validateVisualPlan(raw).plan, { operationId: "op", title: "t", metadata, context, parseMarkdown: parse });

describe("relation types look different (Wave C)", () => {
  it("each relation has its own look; an unknown one is a plain association, no relation keeps the plain arrow", () => {
    expect(relationStyle("depends_on")).toEqual({ strokeStyle: "dashed", endArrowhead: "arrow" });
    expect(relationStyle("blocks").endArrowhead).toBe("bar");
    expect(relationStyle("explained_by")).toEqual({ strokeStyle: "dotted", endArrowhead: "dot" });
    expect(relationStyle("caused_by").defaultLabel).toBe("caused by");
    expect(relationStyle("relates_to").endArrowhead).toBeNull();
    expect(relationStyle(undefined)).toEqual({ strokeStyle: "solid", endArrowhead: "arrow" });
    // Every relation type is covered; "flows_to" alone is the plain arrow of a sequence.
    for (const t of RELATION_TYPES) expect(relationStyle(t)).toBeDefined();
    expect(RELATION_TYPES.filter((t) => JSON.stringify(relationStyle(t)) === JSON.stringify(relationStyle(undefined)))).toEqual(["flows_to"]);
  });
});

describe("flow steps are numbered, in the plan itself (Wave C)", () => {
  const shape = (id: string, label: string) => ({ id, type: "shape", stableKey: `S § ${id}`, content: { shape: "rectangle", label } });
  const sections = [{ key: "S", label: "Steps", arrangement: "chain" as const, kind: "flow" as const }];

  it("numbers a flow section's steps along its flows_to links (plan order breaks ties), not the explanations", () => {
    const raw = {
      version: 1,
      template: "sectioned",
      nodes: [shape("c", "Charge"), shape("a", "Order"), shape("b", "Validate"), { id: "d", type: "text", stableKey: "S § d", content: { markdown: "detail" } }],
      relationships: [
        { from: "a", to: "b", type: "flows_to" },
        { from: "b", to: "c", type: "flows_to" },
        { from: "a", to: "d", type: "explained_by" },
      ],
    };
    const out = wrapSections(raw, sections) as { nodes: { id: string; content: { label?: string } }[] };
    const label = (id: string) => out.nodes.find((n) => n.id === id)!.content.label;
    expect([label("a"), label("b"), label("c")]).toEqual(["1 · Order", "2 · Validate", "3 · Charge"]);
  });

  it("an earlier number is replaced, never stacked; other kinds and a single shape aren't numbered", () => {
    const again = wrapSections({ version: 1, nodes: [shape("a", "2 · Order"), shape("b", "1. Validate")], relationships: [] }, sections) as { nodes: { id: string; type: string; content: { label?: string } }[] };
    expect(again.nodes.filter((n) => n.type === "shape").map((n) => n.content.label)).toEqual(["1 · Order", "2 · Validate"]);
    const tree = wrapSections({ version: 1, nodes: [shape("a", "Root"), shape("b", "Leaf")], relationships: [] }, [{ ...sections[0]!, kind: "hierarchy" as const }]) as { nodes: { type: string; content: { label?: string } }[] };
    expect(tree.nodes.flatMap((n) => (n.type === "shape" ? [n.content.label] : []))).toEqual(["Root", "Leaf"]);
    const one = wrapSections({ version: 1, nodes: [shape("a", "Only")], relationships: [] }, sections) as { nodes: { type: string; content: { label?: string } }[] };
    expect(one.nodes.flatMap((n) => (n.type === "shape" ? [n.content.label] : []))).toEqual(["Only"]);
    expect(unnumbered("12 · Deploy")).toBe("Deploy");
    expect(unnumbered("Phase 2 · Deploy")).toBe("Phase 2 · Deploy");
  });
});

describe("the accent is kept for what matters (Wave C)", () => {
  it("an ordinary card's title is plain; the model's analysis and a high-importance card keep the accent", async () => {
    const set = await render({
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "plain", type: "text", title: "Notes", content: { markdown: "x" } },
        { id: "analysis", type: "text", origin: "analysis", title: "Status", content: { markdown: "y" } },
        { id: "key", type: "text", importance: "high", title: "Recommendation", content: { markdown: "z" } },
      ],
      relationships: [],
    });
    const styled = withResponseStyle(set, DEFAULT_RESPONSE_STYLE);
    const titleBg = (key: string) => {
      const c = styled.changes.find((x) => x.kind === "create_block" && x.key === key) as Extract<ChangeSet["changes"][number], { kind: "create_block" }>;
      return (c.content[0]!.props as { backgroundColor?: string } | undefined)?.backgroundColor;
    };
    expect(titleBg("plain")).toBeUndefined();
    expect(titleBg("analysis")).toBe("orange");
    expect(titleBg("key")).toBe("orange");
  });
});

describe("tables are sized to be read (Wave D)", () => {
  it("a long-text column gets room (up to 360 px), short ones stay narrow, and the drawn table uses the same widths", async () => {
    const long = "A pattern-membership claim: confirm the named wells, state it as unverified, or remove the claim altogether.";
    const widths = tableColumnWidths(["Code", "Meaning"], [["A5", long]]);
    expect(widths[0]).toBe(80);
    expect(widths[1]).toBe(360);
    const set = await render({ version: 1, template: "sectioned", nodes: [{ id: "t", type: "table", content: { columns: ["Code", "Meaning"], rows: [["A5", long]] } }], relationships: [] });
    const block = set.changes.find((c) => c.kind === "create_block") as { content: { content: { columnWidths?: number[] } }[] };
    expect(block.content[0]!.content.columnWidths).toEqual(widths);
  });

  it("a very wide table is scaled down to 1,200 px overall", () => {
    const cell = "word ".repeat(40);
    const widths = tableColumnWidths(["a", "b", "c", "d", "e"], [[cell, cell, cell, cell, cell]]);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1200);
  });
});

describe("the overview shown over sections when zoomed out (Wave D)", () => {
  it("each section frame carries its title and takeaway; the overlay lists Visualize frames only", async () => {
    const set = await render({
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "g0", type: "group", content: { label: "Decisions", arrangement: "grid", takeaway: "Merge v3; D2 waits on the engineer" } },
        { id: "n1", type: "text", parent: "g0", content: { markdown: "x" } },
      ],
      relationships: [],
    });
    expect(set.changes.find((c) => c.kind === "create_frame")).toMatchObject({ overview: { title: "Decisions", takeaway: "Merge v3; D2 waits on the engineer" } });
    const cards = overviewCards([
      { id: "f1", type: "frame", x: 0, y: 0, width: 800, height: 600, customData: { acuteOverview: { title: "Decisions", takeaway: "Merge v3" } } },
      { id: "f2", type: "frame", x: 900, y: 0, width: 400, height: 300 },
      { id: "f3", type: "frame", x: 0, y: 700, width: 400, height: 300, isDeleted: true, customData: { acuteOverview: { title: "Gone" } } },
    ]);
    // f2 sits 100 px to its right, level with it: the card may overhang by up to that gap (less a margin), each side.
    expect(cards).toEqual([{ id: "f1", x: 0, y: 0, width: 800, height: 600, title: "Decisions", takeaway: "Merge v3", room: 800 + 2 * (100 - 16) }]);
    // A frame alone in its row has room to spare.
    expect(overviewCards([{ id: "f", type: "frame", x: 0, y: 0, width: 90, height: 600, customData: { acuteOverview: { title: "Narrow" } } }])[0]!.room).toBeGreaterThan(10_000);
  });
});

describe("section links are part of the layout check (Wave D)", () => {
  it("a link between two frames is judged like any other link", () => {
    const changes: ChangeSet["changes"] = [
      { kind: "create_block", key: "a", blockType: "text", content: [{ type: "paragraph", content: "a" }], box: { x: 0, y: 0, width: 200, height: 100 } },
      { kind: "create_block", key: "b", blockType: "text", content: [{ type: "paragraph", content: "b" }], box: { x: 600, y: 0, width: 200, height: 100 } },
      { kind: "create_frame", key: "f1", title: "1", box: { x: -20, y: -20, width: 240, height: 140 }, children: ["a"] },
      { kind: "create_frame", key: "f2", title: "2", box: { x: 580, y: -20, width: 240, height: 140 }, children: ["b"] },
      { kind: "connect", key: "link", from: { created: "f1" }, to: { created: "f2" }, relation: "supports" },
    ];
    expect(proposalGeometry(changes, []).links.map((l) => l.key)).toEqual(["link"]);
  });
});

describe("large results are laid out to read (Wave D round 2)", () => {
  const shape = (id: string, parent: string) => ({ id, type: "shape", parent, content: { shape: "rectangle", label: `Step ${id} with a long enough label to be wide` } });

  it("a wrapped chain snakes, in its flows_to order: every step's next one is beside or right below it", async () => {
    const ids = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
    // Listed out of order: the layout follows the links, as the step numbers do.
    const listed = ["s3", "s1", "s2", "s7", "s4", "s6", "s5"];
    const plan = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [{ id: "g", type: "group", role: "flow", content: { label: "Steps", arrangement: "chain" } }, ...listed.map((id) => shape(id, "g"))],
      relationships: ids.slice(1).map((id, i) => ({ from: ids[i]!, to: id, type: "flows_to" })),
    }).plan;
    const { layoutPlan } = await import("@/ai/renderer/layout");
    const boxes = layoutPlan(plan);
    const at = (id: string) => boxes.get(id)!;
    // Row 1 left to right, row 2 right to left (3 per row).
    expect(at("s1").x).toBeLessThan(at("s2").x);
    expect(at("s2").x).toBeLessThan(at("s3").x);
    expect(at("s4").y).toBeGreaterThan(at("s3").y);
    expect(at("s4").x).toBe(at("s3").x); // right below the row's last step
    expect(at("s5").x).toBeLessThan(at("s4").x);
    expect(at("s6").x).toBeLessThan(at("s5").x);
    expect(at("s7").x).toBe(at("s6").x); // row 3 turns again, under s6
  });

  it("wide sections go side by side, so the result fits a screen at a higher zoom than one tall column", async () => {
    // Six sections, each one wide table (as a large document with wide tables has).
    const cell = "a long table cell of words ".repeat(6);
    const nodes = Array.from({ length: 6 }, (_, i) => [
      { id: `g${i}`, type: "group", content: { label: `Section ${i}`, arrangement: "compare" } },
      { id: `t${i}`, type: "table", parent: `g${i}`, content: { columns: ["a", "b", "c", "d"], rows: Array.from({ length: 6 }, () => [cell, cell, cell, cell]) } },
    ]).flat();
    const plan = validateVisualPlan({ version: 1, template: "sectioned", nodes, relationships: [] }).plan;
    const { layoutPlan } = await import("@/ai/renderer/layout");
    const boxes = layoutPlan(plan);
    const groups = [0, 1, 2, 3, 4, 5].map((i) => boxes.get(`g${i}`)!);
    const width = Math.max(...groups.map((b) => b.x + b.width)) - Math.min(...groups.map((b) => b.x));
    const height = Math.max(...groups.map((b) => b.y + b.height)) - Math.min(...groups.map((b) => b.y));
    const rows = new Set(groups.map((b) => b.y)).size;
    expect(rows).toBeLessThan(6); // not one per row
    const fit = Math.min(1600 / width, 900 / height);
    const column = Math.min(1600 / groups[0]!.width, 900 / (groups.reduce((n, b) => n + b.height, 0) + 96 * 5));
    expect(fit).toBeGreaterThan(column * 1.5);
  });
});

describe("links between sections run in the gutters (Wave D round 2)", () => {
  it("a link from the first section to the third goes around the middle one, not across its cards", async () => {
    const { routeConnectors } = await import("@/ai/changes/routing");
    const a = { id: "A", x: 0, y: 0, width: 400, height: 300 };
    const b = { id: "B", x: 500, y: 0, width: 400, height: 300 };
    const c = { id: "C", x: 1000, y: 0, width: 400, height: 300 };
    // Without `avoid`, B (a frame, not a shared obstacle) is crossed straight through.
    const plain = routeConnectors([{ key: "k", from: a, to: c }], []).get("k")!;
    const crosses = (pts: { x: number; y: number }[]) => pts.some((p, i) => i > 0 && Math.min(p.y, pts[i - 1]!.y) < b.y + b.height && Math.max(p.y, pts[i - 1]!.y) > b.y && Math.min(p.x, pts[i - 1]!.x) < b.x + b.width && Math.max(p.x, pts[i - 1]!.x) > b.x);
    expect(crosses(plain.points)).toBe(true);
    const around = routeConnectors([{ key: "k", from: a, to: c, avoid: [b] }], []).get("k")!;
    expect(crosses(around.points)).toBe(false);
  });
});

describe("a flow section's other members sit below its steps (Wave D round 2)", () => {
  it("the source's table is not one of the steps' cells: the steps come first, the table in a row below", async () => {
    const step = (id: string) => ({ id, type: "shape", parent: "g", content: { shape: "rectangle", label: `Step ${id}` } });
    const plan = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "g", type: "group", role: "flow", content: { label: "Hooks", arrangement: "chain" } },
        { id: "t", type: "table", parent: "g", content: { columns: ["When", "What runs"], rows: [["Before the prompt", "Case card"], ["After each call", "Layer A notes"]] } },
        step("a"),
        step("b"),
        step("c"),
      ],
      relationships: [
        { from: "a", to: "b", type: "flows_to" },
        { from: "b", to: "c", type: "flows_to" },
      ],
    }).plan;
    const { layoutPlan } = await import("@/ai/renderer/layout");
    const boxes = layoutPlan(plan);
    const steps = ["a", "b", "c"].map((id) => boxes.get(id)!);
    expect(new Set(steps.map((b) => b.y)).size).toBe(1); // one row of steps
    expect(steps[0]!.x).toBeLessThan(steps[1]!.x);
    expect(boxes.get("t")!.y).toBeGreaterThan(Math.max(...steps.map((b) => b.y + b.height)));
  });
});

describe("a document's only section is never supporting detail (live run, 2026-09-29)", () => {
  it("is reclassified as notes, so it is held to the full analysis check", async () => {
    const { validateOutline } = await import("./outline");
    const { outline, warnings } = validateOutline({ sections: [{ id: "s1", label: "Decisions", kind: "supporting", prominence: "supporting", parts: ["u1"] }] }, [{ key: "u1", text: "D1 …" }]);
    expect(outline.sections[0]).toMatchObject({ kind: "notes", prominence: "primary" });
    expect(warnings.join()).toMatch(/only section can't be supporting/);
    // With another section to support, it stays supporting.
    const two = validateOutline(
      { sections: [{ id: "s1", label: "Main", kind: "decision", parts: ["u1"] }, { id: "s2", label: "Why", kind: "supporting", parts: ["u2"] }] },
      [{ key: "u1", text: "a" }, { key: "u2", text: "b" }],
    ).outline;
    expect(two.sections.map((s) => s.kind)).toEqual(["decision", "supporting"]);
  });
});
