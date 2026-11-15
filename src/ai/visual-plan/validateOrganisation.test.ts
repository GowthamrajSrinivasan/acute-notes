/**
 * Organisation v2 in validation (organisation-layout plan §3.2, Lane F's F5 request): `sanitizeGroups` keeps one level of
 * sub-groups inside a section and applies the sub-group rule (`normalizeSubGroups`); v1 flattens nesting exactly as before.
 */
import { describe, expect, it } from "vitest";
import { validateVisualPlan } from "./validate";

const card = (id: string, parent?: string) => ({ id, type: "text", content: { markdown: `Card ${id}` }, ...(parent ? { parent } : {}) });
const group = (id: string, parent?: string) => ({ id, type: "group", content: { label: id, arrangement: "grid" }, ...(parent ? { parent } : {}) });
const plan = (nodes: unknown[]) => ({ version: 1, template: "sectioned", nodes, relationships: [] });

const nested = plan([group("s"), group("sub", "s"), card("a", "sub"), card("b", "sub"), card("c", "s")]);

describe("validateVisualPlan — sub-groups (organisation v2)", () => {
  it("v1 (default) makes a nested group top-level, as before", () => {
    const { plan: out, warnings } = validateVisualPlan(nested);
    expect(out.nodes.find((n) => n.id === "sub")!.parent).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/can't be nested/);
    expect(validateVisualPlan(nested, { organisation: "v1" })).toEqual(validateVisualPlan(nested));
  });

  it("v2 keeps a group whose parent is a live top-level group", () => {
    const { plan: out, warnings } = validateVisualPlan(nested, { organisation: "v2" });
    expect(out.nodes.find((n) => n.id === "sub")!.parent).toBe("s");
    expect(out.nodes.find((n) => n.id === "a")!.parent).toBe("sub");
    expect(warnings.join(" ")).not.toMatch(/can't be nested/);
  });

  it("v2 dissolves a sub-group of one card into its section, keeping the card", () => {
    const { plan: out, warnings } = validateVisualPlan(plan([group("s"), group("sub", "s"), card("a", "sub"), card("c", "s")]), { organisation: "v2" });
    expect(out.nodes.some((n) => n.id === "sub")).toBe(false);
    expect(out.nodes.find((n) => n.id === "a")!.parent).toBe("s");
    expect(warnings.join(" ")).toMatch(/single card/);
  });

  it("v2 flattens a group under a sub-group (depth stays 2) and one whose parent isn't a top-level group", () => {
    const deep = plan([group("s"), group("sub", "s"), group("deeper", "sub"), card("a", "deeper"), card("b", "deeper"), card("c", "sub"), group("orphan", "nowhere"), card("d", "orphan")]);
    const { plan: out } = validateVisualPlan(deep, { organisation: "v2" });
    expect(out.nodes.find((n) => n.id === "deeper")?.parent).not.toBe("sub");
    expect(out.nodes.find((n) => n.id === "orphan")!.parent).toBeUndefined();
    // Every card is kept.
    expect(out.nodes.filter((n) => n.type === "text").map((n) => n.id).sort()).toEqual(["a", "b", "c", "d"]);
  });
});
