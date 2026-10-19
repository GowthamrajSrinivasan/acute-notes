import { describe, expect, it } from "vitest";
import { VALID_PLAN_FIXTURES } from "./fixtures";
import { visualPlanJsonSchema, visualPlanSchema } from "./schema";

describe("visualPlanSchema", () => {
  it("parses every valid fixture as is", () => {
    for (const plan of Object.values(VALID_PLAN_FIXTURES)) expect(visualPlanSchema.parse(plan)).toEqual(plan);
  });

  it("strips unknown fields (sanitization) rather than passing them through", () => {
    const parsed = visualPlanSchema.parse({
      ...VALID_PLAN_FIXTURES.action_plan,
      nodes: [{ id: "n1", type: "text", content: { markdown: "hi", htmlPayload: "<script>evil()</script>" }, apiKey: "sk-live" }],
      relationships: [],
      rogueTopLevelField: "x",
    });
    expect(JSON.stringify(parsed)).not.toMatch(/apiKey|rogueTopLevelField|htmlPayload|script/);
  });

  it("rejects a node whose content doesn't match its declared type (no `unknown` content reaches the renderer)", () => {
    expect(visualPlanSchema.safeParse({ ...VALID_PLAN_FIXTURES.flow, nodes: [{ id: "n1", type: "shape", content: { markdown: "wrong shape of content" } }] }).success).toBe(false);
  });
});

describe("visualPlanJsonSchema", () => {
  it("generates a JSON Schema describing every node type, cached across calls", () => {
    const schema = visualPlanJsonSchema() as { $schema: string; properties: { nodes: { items: { anyOf?: unknown[]; oneOf?: unknown[] } } } };
    expect(schema.$schema).toMatch(/json-schema\.org/);
    const variants = schema.properties.nodes.items.oneOf ?? schema.properties.nodes.items.anyOf;
    expect(variants).toHaveLength(9); // the PRD's 8 node types + F42's group
    expect(visualPlanJsonSchema()).toBe(visualPlanJsonSchema());
  });
});
