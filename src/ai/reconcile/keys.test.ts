import { describe, expect, it } from "vitest";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { ensureStableKeys, mergeUnitPlans, unitOfKey, UNIT_SEPARATOR } from "./keys";

const shape = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "shape", content: { shape: "rectangle", label: id }, ...extra });

describe("mergeUnitPlans", () => {
  it("namespaces every key with its unit and prefixes ids per unit, so units never collide", () => {
    const merged = mergeUnitPlans("flow", [
      { unitKey: "A", raw: { version: 1, template: "flow", nodes: [shape("n1"), shape("n2")], relationships: [{ from: "n1", to: "n2", type: "relates_to" }] } },
      { unitKey: "B", raw: { version: 1, template: "flow", nodes: [shape("n1", { stableKey: "step#0" })] } },
    ]) as { nodes: { id: string; stableKey: string }[]; relationships: { from: string; to: string }[] };
    expect(merged.nodes.map((n) => n.id)).toEqual(["u0_n1", "u0_n2", "u1_n1"]);
    expect(merged.nodes.map((n) => n.stableKey)).toEqual([`A${UNIT_SEPARATOR}shape#0`, `A${UNIT_SEPARATOR}shape#1`, `B${UNIT_SEPARATOR}step#0`]);
    expect(merged.relationships).toEqual([{ from: "u0_n1", to: "u0_n2", type: "relates_to" }]);
  });

  it("uses role ordinals for the fallback key, and makes repeated keys unique", () => {
    const merged = mergeUnitPlans("problem_cause_solution", [
      { unitKey: "U", raw: { nodes: [shape("a", { role: "cause" }), shape("b", { role: "cause" }), shape("c", { stableKey: "x" }), shape("d", { stableKey: "x" })] } },
    ]) as { nodes: { stableKey: string }[] };
    expect(merged.nodes.map((n) => n.stableKey)).toEqual(["U § cause#0", "U § cause#1", "U § x", "U § x ~2"]);
  });

  it("leaves unknown relationship endpoints for validateVisualPlan to report, and skips a unit that isn't a plan", () => {
    const merged = mergeUnitPlans("flow", [
      { unitKey: "A", raw: { nodes: [shape("n1")], relationships: [{ from: "n1", to: "ghost", type: "relates_to" }] } },
      { unitKey: "B", raw: "not a plan" },
    ]) as { nodes: unknown[]; relationships: { from: string; to: string }[] };
    expect(merged.nodes).toHaveLength(1);
    expect(merged.relationships).toEqual([{ from: "u0_n1", to: "ghost", type: "relates_to" }]);
  });
});

describe("unitOfKey", () => {
  it("reads the unit back from a namespaced key, and null for local-tier keys", () => {
    expect(unitOfKey("Checkout › Part 2 § step#0")).toBe("Checkout › Part 2");
    expect(unitOfKey("Launch#todo0")).toBeNull();
  });
});

describe("ensureStableKeys", () => {
  it("keeps existing keys, fills missing ones structurally, and de-duplicates", () => {
    const plan: VisualPlan = {
      version: 1,
      template: "concept_map",
      nodes: [
        { id: "a", type: "shape", stableKey: "k", content: { shape: "ellipse", label: "A" } },
        { id: "b", type: "shape", content: { shape: "ellipse", label: "B" } },
        { id: "c", type: "shape", role: "center", content: { shape: "ellipse", label: "C" } },
        { id: "d", type: "shape", stableKey: "k", content: { shape: "ellipse", label: "D" } },
      ],
      relationships: [],
    };
    expect(ensureStableKeys(plan).nodes.map((n) => n.stableKey)).toEqual(["k", "shape#0", "center#0", "k ~2"]);
    expect(ensureStableKeys(plan)).toEqual(ensureStableKeys(plan));
  });
});
