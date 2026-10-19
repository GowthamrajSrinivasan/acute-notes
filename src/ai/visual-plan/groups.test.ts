import { describe, expect, it } from "vitest";
import { analyzeContent } from "@/ai/content/analyze";
import { layoutPlan } from "@/ai/renderer/layout";
import { groupByUnit, groupTitleKey, ungroup, withoutUnitSections } from "./groups";
import type { VisualPlan } from "./types";
import { validateVisualPlan } from "./validate";

const text = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "text", content: { markdown: `Note ${id}` }, ...extra });

describe("validateVisualPlan — sections (F42)", () => {
  it("keeps groups and membership in a sectioned plan", () => {
    const { plan, warnings } = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [{ id: "g", type: "group", content: { label: "A", arrangement: "chain" } }, text("a", { parent: "g" })],
      relationships: [],
    });
    expect(warnings).toEqual([]);
    expect(plan.nodes.map((n) => n.parent)).toEqual([undefined, "g"]);
  });

  it("is lenient: a dangling parent becomes top-level, nesting is flattened, empty groups go, a bad arrangement is a grid", () => {
    const { plan, warnings } = validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "g1", type: "group", content: { label: "Outer", arrangement: "spiral" } },
        { id: "g2", type: "group", parent: "g1", content: { label: "Inner", arrangement: "grid" } },
        { id: "empty", type: "group", content: { label: "Nothing here", arrangement: "grid" } },
        text("a", { parent: "g1" }),
        text("b", { parent: "g2" }),
        text("c", { parent: "missing" }),
      ],
      relationships: [{ from: "empty", to: "a", type: "relates_to" }],
    });
    const byId = new Map(plan.nodes.map((n) => [n.id, n] as const));
    expect(byId.has("empty")).toBe(false);
    expect(byId.get("g2")!.parent).toBeUndefined();
    expect(byId.get("c")!.parent).toBeUndefined();
    expect(byId.get("g1")).toMatchObject({ content: { arrangement: "grid" } });
    expect(plan.relationships).toEqual([]); // its endpoint was the dropped empty group
    expect(warnings.join("\n")).toMatch(/can't be nested/);
    expect(warnings.join("\n")).toMatch(/"missing" isn't in the plan/);
    expect(warnings.join("\n")).toMatch(/no members/);
  });

  it("groups aren't content: they don't count toward the node limit, and a plan of only groups is unusable", () => {
    const nodes = [{ id: "g", type: "group", content: { label: "A", arrangement: "grid" } }, ...Array.from({ length: 60 }, (_, i) => text(`n${i}`, { parent: "g" }))];
    expect(validateVisualPlan({ version: 1, template: "sectioned", nodes, relationships: [] }).plan.nodes).toHaveLength(61);
    expect(() => validateVisualPlan({ version: 1, template: "sectioned", nodes: [nodes[0]], relationships: [] })).toThrow(/no usable nodes/);
  });

  it("another template shows a group as a section heading, and its members become top-level", () => {
    const { plan } = validateVisualPlan({ version: 1, template: "action_plan", nodes: [{ id: "g", type: "group", content: { label: "A", arrangement: "grid" } }, text("a", { parent: "g" })], relationships: [] });
    expect(plan.nodes).toEqual([
      { id: "g", type: "heading", role: "section", content: { text: "A" } },
      { id: "a", type: "text", content: { markdown: "Note a" } },
    ]);
  });
});

describe("groupByUnit / ungroup", () => {
  const merged = {
    version: 1,
    template: "action_plan",
    nodes: [
      { id: "u0_h1", type: "heading", stableKey: "(lead) § heading#0", content: { text: "Database migration plan" } },
      { id: "u1_n1", type: "heading", stableKey: "Rollout Steps § heading#0", content: { text: "Rollout Steps" } },
      { id: "u1_n2", type: "todo", stableKey: "Rollout Steps § todo#0", content: { items: [{ text: "Take a backup", checked: false }] } },
      { id: "u2_n1", type: "text", stableKey: "Risks § text#0", content: { markdown: "May lock the users table." } },
    ],
    relationships: [],
  };
  const units = [
    { key: "(lead)", headingOnly: true },
    { key: "Rollout Steps", headingOnly: false },
    { key: "Risks", headingOnly: false },
  ];

  it("frames each section, drops a heading that repeats the section's title, and titles the document", () => {
    const { plan } = validateVisualPlan(groupByUnit(merged, "action_plan", units));
    expect(plan.template).toBe("sectioned");
    expect(plan.nodes.map((n) => `${n.type}${n.parent ? `<${n.parent}` : ""}`)).toEqual(["heading", "group", "todo<g0", "group", "text<g1"]);
    expect(plan.nodes[0]).toMatchObject({ role: "title" });
    expect(plan.nodes[1]).toMatchObject({ stableKey: "Rollout Steps § group#0", content: { label: "Rollout Steps", arrangement: "grid" } });
  });

  it("leaves heading-less content alone, keeping its template's own layout", () => {
    const lead = { version: 1, template: "flow", nodes: [{ id: "u0_n1", type: "shape", stableKey: "(lead) § shape#0", content: { shape: "rectangle", label: "A" } }], relationships: [] };
    expect(groupByUnit(lead, "flow", [{ key: "(lead)", headingOnly: false }])).toBe(lead);
  });

  it("ungroup turns each section into the heading its title object is, with the same id and key", () => {
    const { plan } = validateVisualPlan(groupByUnit(merged, "action_plan", units));
    const flat = ungroup(plan);
    expect(flat.nodes.some((n) => n.type === "group" || n.parent)).toBe(false);
    expect(flat.nodes[1]).toEqual({ id: "g0", type: "heading", role: "section", stableKey: "Rollout Steps § group#0", content: { text: "Rollout Steps" } });
    // The flat form a later update builds is the same thing.
    const flatRaw = groupByUnit(merged, "action_plan", units, { flat: true }) as { nodes: unknown[] };
    expect(flatRaw.nodes[1]).toEqual(flat.nodes[1]);
    expect(withoutUnitSections(flat).nodes.map((n) => n.id)).toEqual(["u0_h1", "u1_n2", "u2_n1"]);
  });
});

describe("local tier: a structured note becomes framed sections, read left to right (F42)", () => {
  const NOTE = `# Database migration plan

## Rollout Steps

- [ ] Take a backup
- [ ] Run the migration
- [ ] Verify the users table

## Risks

The database migration may lock the users table during off-peak hours.

## Owners

The platform team owns the migration; the on-call DBA approves it.
`;

  it("one frame per section with the title above them, members inside, sections side by side", async () => {
    const { local } = await analyzeContent(NOTE);
    const plan = validateVisualPlan(local.plan).plan as VisualPlan;
    expect(plan.template).toBe("sectioned");
    const groups = plan.nodes.filter((n) => n.type === "group");
    expect(groups.map((g) => g.type === "group" && g.content.label)).toEqual(["Rollout Steps", "Risks", "Owners"]);
    // The checklist stays one block (not a card per step), and carries no repeated "Rollout Steps" title.
    const todo = plan.nodes.find((n) => n.type === "todo")!;
    expect(todo.type === "todo" && todo.content.items).toHaveLength(3);
    expect(todo.title).toBeUndefined();

    const layout = layoutPlan(plan);
    const [a, b] = groups.map((g) => layout.get(g.id)!);
    expect(a!.y).toBe(b!.y); // side by side, not stacked
    const title = layout.get(plan.nodes.find((n) => n.role === "title")!.id)!;
    for (const g of groups) expect(layout.get(g.id)!.y).toBeGreaterThan(title.y + title.height);
    for (const g of groups) expect(layout.get(groupTitleKey(g.id))).toBeDefined();
    // A one-line checklist item makes a short block, not a fixed-size card.
    expect(layout.get(todo.id)!.height).toBeLessThan(160);
  });
});

describe("local tier: a numbered list of steps in a section is a chain of connected shapes (F42)", () => {
  it("steps read left to right, linked in order, and the section is a chain", async () => {
    const { local } = await analyzeContent("# Deploy\n\n## Rollout\n\n1. Take a backup\n2. Run the migration\n3. Verify the users table\n\n## Risks\n\nLocks.\n");
    const plan = validateVisualPlan(local.plan).plan;
    const rollout = plan.nodes.find((n) => n.type === "group" && n.content.label === "Rollout")!;
    expect(rollout).toMatchObject({ content: { arrangement: "chain" } });
    const steps = plan.nodes.filter((n) => n.parent === rollout.id);
    expect(steps.map((n) => n.type === "shape" && n.content.label)).toEqual(["Take a backup", "Run the migration", "Verify the users table"]);
    expect(plan.relationships).toEqual([
      { from: steps[0]!.id, to: steps[1]!.id, type: "flows_to" },
      { from: steps[1]!.id, to: steps[2]!.id, type: "flows_to" },
    ]);
    const layout = layoutPlan(plan);
    expect(layout.get(steps[0]!.id)!.y).toBe(layout.get(steps[1]!.id)!.y);
    expect(layout.get(steps[0]!.id)!.x).toBeLessThan(layout.get(steps[1]!.id)!.x);
  });
});
