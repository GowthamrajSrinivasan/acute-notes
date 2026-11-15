import { describe, expect, it } from "vitest";
import { MIN_SUBGROUP_MEMBERS, normalizeSubGroups, restoreSubGroups, subGroupsOf, topLevelGroupOf } from "./grouping";
import type { VisualNode } from "./types";
import { validateVisualPlan } from "./validate";

const group = (id: string, parent?: string): VisualNode => ({ id, type: "group", ...(parent ? { parent } : {}), content: { label: id, arrangement: "grid" } });
const card = (id: string, parent?: string): VisualNode => ({ id, type: "text", ...(parent ? { parent } : {}), content: { markdown: id } });
const parents = (nodes: readonly VisualNode[]) => Object.fromEntries(nodes.map((n) => [n.id, n.parent ?? null]));

describe("normalizeSubGroups (organisation v2, plan §3.2)", () => {
  it("keeps a sub-group of two or more cards inside its section", () => {
    const nodes = [group("s"), group("ext", "s"), card("a", "s"), card("b", "ext"), card("c", "ext")];
    const { nodes: out, warnings } = normalizeSubGroups(nodes);
    expect(warnings).toEqual([]);
    expect(parents(out)).toEqual({ s: null, ext: "s", a: "s", b: "ext", c: "ext" });
  });

  it("flattens anything deeper than a sub-group into the sub-group", () => {
    const nodes = [group("s"), group("sub", "s"), group("deep", "sub"), group("deeper", "deep"), card("a", "sub"), card("b", "deep"), card("c", "deeper")];
    const { nodes: out, warnings } = normalizeSubGroups(nodes);
    expect(out.map((n) => n.id)).toEqual(["s", "sub", "a", "b", "c"]);
    expect(parents(out)).toEqual({ s: null, sub: "s", a: "sub", b: "sub", c: "sub" });
    expect(warnings).toHaveLength(2);
  });

  it(`dissolves a sub-group with fewer than ${MIN_SUBGROUP_MEMBERS} cards into its section; every card stays`, () => {
    const nodes = [group("s"), group("one", "s"), group("none", "s"), card("a", "one"), card("b", "s")];
    const { nodes: out, warnings } = normalizeSubGroups(nodes);
    expect(out.map((n) => n.id)).toEqual(["s", "a", "b"]);
    expect(parents(out)).toEqual({ s: null, a: "s", b: "s" });
    expect(warnings).toEqual(['sub-group "one" has a single card, so its cards joined "s"', 'sub-group "none" has no cards, so its cards joined "s"']);
  });

  it("counts sub-groups against the group cap, dissolving the last ones past it", () => {
    const nodes = [group("s"), group("x", "s"), group("y", "s"), card("x1", "x"), card("x2", "x"), card("y1", "y"), card("y2", "y")];
    const { nodes: out } = normalizeSubGroups(nodes, { maxGroups: 2 });
    expect(out.filter((n) => n.type === "group").map((n) => n.id)).toEqual(["s", "x"]);
    expect(parents(out)).toMatchObject({ y1: "s", y2: "s", x1: "x" });
  });

  it("leaves a plan without sub-groups as it is, and never mutates its input", () => {
    const nodes = [group("s"), card("a", "s"), card("b")];
    const before = JSON.stringify(nodes);
    expect(normalizeSubGroups(nodes)).toEqual({ nodes, warnings: [] });
    normalizeSubGroups([group("s"), group("one", "s"), card("a", "one")]);
    expect(JSON.stringify(nodes)).toBe(before);
  });
});

describe("plan lookups", () => {
  const plan = { nodes: [group("s"), group("ext", "s"), card("a", "s"), card("b", "ext"), card("loose")] };

  it("topLevelGroupOf walks up through a sub-group to its section", () => {
    expect(topLevelGroupOf(plan, "b")).toBe("s");
    expect(topLevelGroupOf(plan, "a")).toBe("s");
    expect(topLevelGroupOf(plan, "loose")).toBeUndefined();
  });

  it("subGroupsOf lists each section's sub-groups", () => {
    expect(subGroupsOf(plan)).toEqual(new Map([["s", ["ext"]]]));
  });
});

describe("restoreSubGroups (bridge until validation keeps sub-groups in v2)", () => {
  it("puts back a sub-group validation made top-level, and leaves a plan without nesting alone", () => {
    const raw = { version: 1, template: "sectioned", nodes: [group("s"), group("ext", "s"), card("a", "s"), card("b", "ext"), card("c", "ext")], relationships: [] };
    const validated = validateVisualPlan(raw, { stored: true }).plan;
    expect(validated.nodes.find((n) => n.id === "ext")!.parent).toBeUndefined();
    const restored = restoreSubGroups(raw, validated);
    expect(parents(restored.nodes)).toEqual({ s: null, ext: "s", a: "s", b: "ext", c: "ext" });
    const flat = { version: 1, template: "sectioned", nodes: [group("s"), card("a", "s")], relationships: [] };
    const plain = validateVisualPlan(flat, { stored: true }).plan;
    expect(restoreSubGroups(flat, plain)).toBe(plain);
  });
});
