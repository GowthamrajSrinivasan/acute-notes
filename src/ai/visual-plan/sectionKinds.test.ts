/**
 * Section kind registry sanity, plus two Wave E additions: `metrics`'s optional chart companion (bar/line charts
 * for numeric tables — the table stays mandatory) and the new `annotated` kind (prose with footnote markers).
 */
import { describe, expect, it } from "vitest";
import { renderVisualPlan } from "@/ai/renderer/render";
import type { VisualPlan } from "./types";
import { validateVisualPlan } from "./validate";
import { frameName, SECTION_KIND_REGISTRY, SECTION_KINDS, sectionKind } from "./sectionKinds";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const renderOptions = { operationId: "op", title: "t", metadata: { createdBy: "ai" as const, task: "generate_visual_plan", operationId: "op" }, context, parseMarkdown: parse };

describe("SECTION_KIND_REGISTRY", () => {
  it("every kind has a complete definition, and frameName labels it", () => {
    for (const id of SECTION_KINDS) {
      const def = sectionKind(id);
      expect(def.id).toBe(id);
      expect(def.when.length).toBeGreaterThan(0);
      expect(def.nodeTypes.length).toBeGreaterThan(0);
      expect(def.rules.length).toBeGreaterThan(0);
      expect(def.analysis.length).toBeGreaterThan(0);
      const name = frameName(id, 3);
      expect(name.startsWith("3 · ")).toBe(true);
      expect(name).not.toBe("3 · Section"); // a known kind always gets its own label, never the local-tier fallback
    }
    expect(frameName(undefined, 1)).toBe("1 · Section");
    expect(frameName("not-a-kind", 1)).toBe("1 · Section");
  });

  it("has exactly the registered kinds, keyed consistently", () => {
    expect(Object.keys(SECTION_KIND_REGISTRY).sort()).toEqual([...SECTION_KINDS].sort());
  });
});

describe("metrics — optional chart companion (Wave E)", () => {
  it("the rule keeps the table mandatory and primary, and offers an additional acute-chart code node", () => {
    const rules = sectionKind("metrics").rules;
    expect(rules).toContain("the table is mandatory, always the primary record, and is never replaced");
    expect(rules).toContain('"code" node with "language":"acute-chart"');
    expect(rules).toContain('"chartType":"bar"|"line"');
    expect(sectionKind("metrics").nodeTypes).toContain("code");
  });

  it("a table with a linked acute-chart companion renders both — the table never dropped", async () => {
    const plan: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "g0", type: "group", content: { label: "Metrics", arrangement: "compare" } },
        { id: "t1", type: "table", parent: "g0", content: { columns: ["Metric", "Jan", "Feb"], rows: [["Signups", "10", "20"]] } },
        {
          id: "c1",
          type: "code",
          parent: "g0",
          content: { language: "acute-chart", source: JSON.stringify({ chartType: "bar", categories: ["Jan", "Feb"], series: [{ name: "Signups", values: [10, 20] }] }) },
        },
      ],
      relationships: [{ from: "t1", to: "c1", type: "explained_by" }],
    };
    const validated = validateVisualPlan(plan);
    expect(validated.plan.nodes).toHaveLength(3); // nothing dropped, including the chart
    const set = await renderVisualPlan(validated.plan, renderOptions);
    const blocks = set.changes.filter((c) => c.kind === "create_block" && (c.key === "t1" || c.key === "c1")) as { key: string; blockType: string }[];
    expect(blocks.map((b) => [b.key, b.blockType]).sort()).toEqual([
      ["c1", "code"],
      ["t1", "table"],
    ]);
    expect(set.changes.some((c) => c.kind === "connect")).toBe(true);
  });
});

describe("annotated (Wave E)", () => {
  it("is a stack of prose + a linked notes card — reuses the existing stack arrangement, no new node type", () => {
    const def = sectionKind("annotated");
    expect(def.arrangement).toBe("stack");
    expect(def.nodeTypes).toEqual(["text"]);
    expect(def.rules).toContain("explained_by");
  });

  it("renders the annotated prose and its notes card, linked", async () => {
    const plan: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "g0", type: "group", content: { label: "Rollout plan", arrangement: "stack" } },
        { id: "p1", type: "text", parent: "g0", content: { markdown: "We will merge¹ the v3 branch and await the engineer's assets² before shipping." } },
        { id: "n1", type: "text", parent: "g0", content: { markdown: "¹ Formalizes the answer headings.\n² Blocks the final push." } },
      ],
      relationships: [{ from: "p1", to: "n1", type: "explained_by" }],
    };
    const validated = validateVisualPlan(plan);
    expect(validated.plan.nodes).toHaveLength(3);
    const set = await renderVisualPlan(validated.plan, renderOptions);
    const blocks = set.changes.filter((c) => c.kind === "create_block" && (c.key === "p1" || c.key === "n1"));
    expect(blocks).toHaveLength(2);
    expect(set.changes.some((c) => c.kind === "connect")).toBe(true);
  });
});
