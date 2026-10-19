import { describe, expect, it } from "vitest";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { clusterKey } from "@/ai/visual-plan/groups";
import { layoutPlan } from "./layout";

const head = (id: string, text: string) => ({ id, type: "heading", parent: "g", content: { text } });
const body = (id: string, text: string) => ({ id, type: "text", parent: "g", content: { markdown: text } });
const plan = (nodes: unknown[]) =>
  ({ version: 1, template: "sectioned", relationships: [], nodes: [{ id: "g", type: "group", content: { label: "Context", arrangement: "grid" } }, ...nodes] }) as unknown as VisualPlan;

describe("sub-topics inside a section", () => {
  const boxes = layoutPlan(plan([head("h2", "Shift 2: About Context Engineering"), body("b2", "two"), head("h1", "Shift 1: Prompt Engineering"), body("b1", "one"), head("h3", "Shift 3: Harness Engineering"), body("b3", "three")]));

  it("draws a backdrop per sub-topic, in numbered order", () => {
    const [c0, c1, c2] = [0, 1, 2].map((i) => boxes.get(clusterKey("g", i))!);
    expect(c0 && c1 && c2).toBeTruthy();
    expect(boxes.has(clusterKey("g", 3))).toBe(false);
    // Reading order: Shift 1, then Shift 2 beside it, then Shift 3 on the next row.
    expect(boxes.get("h1")!.y).toBe(boxes.get("h2")!.y);
    expect(boxes.get("h1")!.x).toBeLessThan(boxes.get("h2")!.x);
    expect(boxes.get("h3")!.y).toBeGreaterThan(boxes.get("h1")!.y);
  });

  it("holds each heading and its block inside its backdrop", () => {
    const inside = (outer: string, id: string) => {
      const o = boxes.get(outer)!;
      const b = boxes.get(id)!;
      return b.x >= o.x && b.y >= o.y && b.x + b.width <= o.x + o.width && b.y + b.height <= o.y + o.height;
    };
    expect(inside(clusterKey("g", 0), "h1") && inside(clusterKey("g", 0), "b1")).toBe(true);
    expect(inside(clusterKey("g", 1), "h2") && inside(clusterKey("g", 1), "b2")).toBe(true);
  });

  it("leaves a section with one heading as it was", () => {
    const one = layoutPlan(plan([head("h1", "Only"), body("b1", "x")]));
    expect(one.has(clusterKey("g", 0))).toBe(false);
  });
});
