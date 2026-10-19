import { describe, expect, it } from "vitest";
import { RELATION_TYPES } from "@/domain/types";
import { LAYOUT_STRATEGIES, listTemplates, templateFor, VISUAL_TEMPLATE_REGISTRY } from "./templates";
import { VISUAL_TEMPLATES } from "./types";

describe("VISUAL_TEMPLATE_REGISTRY", () => {
  it("has exactly the registered templates (the PRD's 8, plus sectioned and causal_map), each with a layout strategy from the declared set", () => {
    expect(Object.keys(VISUAL_TEMPLATE_REGISTRY).sort()).toEqual([...VISUAL_TEMPLATES].sort());
    const layouts = listTemplates().map((t) => t.layout);
    expect(new Set(layouts).size).toBe(layouts.length);
    for (const l of layouts) expect(LAYOUT_STRATEGIES).toContain(l);
  });

  it("every entry declares allowed node types, allowed relation types (a real subset), and its own id/layout consistently", () => {
    for (const t of listTemplates()) {
      expect(t.allowedNodeTypes.length).toBeGreaterThan(0);
      expect(t.allowedRelationTypes.length).toBeGreaterThan(0);
      for (const r of t.allowedRelationTypes) expect(RELATION_TYPES).toContain(r);
      expect(templateFor(t.id)).toBe(t);
      expect(t.allowSelfLoops).not.toBe(true); // none of the initial 8 need it
    }
  });

  it("action_plan matches what F28's local planner actually produces (heading/todo/text/table/code/page)", () => {
    expect(templateFor("action_plan").allowedNodeTypes).toEqual(expect.arrayContaining(["heading", "todo", "text", "table", "code", "page"]));
  });

  it("flow matches F28's flow output (shape nodes) and comparison matches its table output", () => {
    expect(templateFor("flow").allowedNodeTypes).toContain("shape");
    expect(templateFor("comparison").allowedNodeTypes).toContain("table");
  });
});
