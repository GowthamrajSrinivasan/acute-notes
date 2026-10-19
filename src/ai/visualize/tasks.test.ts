import { describe, expect, it } from "vitest";
import { createTaskRegistry } from "@/ai/tasks";
import { SECTION_KINDS } from "@/ai/visual-plan/sectionKinds";
import { generateVisualPlanTask, registerVisualizeTasks } from "./tasks";
import { outlineDocumentTask } from "./outline";

describe("generateVisualPlanTask", () => {
  it("always uses the primary provider (authoring, never routed to a decision model)", () => {
    expect(generateVisualPlanTask.policy).toEqual({ limitConcurrency: true });
  });

  it("describes the given template's allowed node/relation types and roles, and includes the source text", () => {
    const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "problem_cause_solution", text: "The checkout is failing." } });
    expect(prompt).toContain('"problem_cause_solution"');
    expect(prompt).toContain("The checkout is failing.");
    const allowedLine = prompt.split("\n").find((l) => l.startsWith("Node types this template uses"))!;
    expect(allowedLine).toContain('"todo"');
    expect(allowedLine).not.toContain('"code"'); // not allowed for this template, even though the JSON shape reference below still shows it
    expect(allowedLine).toContain("problem"); // a recommended role, on the same line
    const relationsLine = prompt.split("\n").find((l) => l.startsWith("Relationship types"))!;
    expect(relationsLine).toContain('"caused_by"');
  });

  it("omits the role sentence for a template with none (comparison)", () => {
    const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "comparison", text: "A vs B" } });
    expect(prompt).not.toMatch(/Roles it's usually built around/);
  });

  it("only checks the plan is envelope-shaped, not full node-by-node validity — that's validateVisualPlan's job", () => {
    const shapeless = { version: 1, template: "flow", nodes: [{ anything: "goes here, schema-wise" }] };
    expect(generateVisualPlanTask.outputSchema.safeParse(shapeless).success).toBe(true);
    expect(generateVisualPlanTask.outputSchema.safeParse({ version: 1, template: "flow" }).success).toBe(false); // still needs a nodes array
    expect(generateVisualPlanTask.outputSchema.safeParse("not even an object").success).toBe(false);
  });
});

describe("generateVisualPlanTask — concepts vs. explanations (F38b)", () => {
  it("asks to visualize, not summarize: short concepts, every detail kept as a linked explained_by child", () => {
    const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "flow", text: "Some content" } });
    expect(prompt).toMatch(/do not summarize it/);
    expect(prompt).toMatch(/missing information is not/);
    expect(prompt).toContain('"type":"explained_by"');
    expect(prompt).toMatch(/Never folded into the concept node's label/);
    expect(prompt).toMatch(/Represent only what the content says/);
    expect(prompt).not.toContain("Current representation"); // a first run has nothing to preserve
  });

  it("never asks to condense or cap the plan, for any section kind (content fidelity)", () => {
    for (const kind of SECTION_KINDS) {
      const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "sectioned", text: "Some content", section: { label: "S", kind } } });
      for (const phrase of [/at most 60 nodes/, /concise/, /compact/i, /key points/, /a few words or bullets/, /short bullet list/, /short "text"/]) {
        expect(prompt, `${kind}: ${phrase}`).not.toMatch(phrase);
      }
    }
  });

  it("on an update, shows the current representation and asks for conceptual changes only", () => {
    const current = { nodes: [{ id: "p1", stableKey: "firebase", type: "shape", content: { shape: "rectangle", label: "Firebase Auth" } }], relationships: [] };
    const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "flow", text: "Some content", current } });
    expect(prompt).toContain('Current representation:\n{"nodes":[{"id":"p1","stableKey":"firebase"');
    expect(prompt).toMatch(/in \*meaning\*, not in wording/);
    expect(prompt).toContain('{"id":"<its id>","unchanged":true}');
    expect(prompt.indexOf("Current representation")).toBeLessThan(prompt.indexOf("Content to visualize:")); // the content stays last
  });
});

describe("registerVisualizeTasks", () => {
  it("registers the Visualize tasks, idempotently — and no longer select_template", () => {
    const registry = createTaskRegistry();
    registerVisualizeTasks(registry);
    registerVisualizeTasks(registry); // second call: no throw
    expect(registry.has("outline_document")).toBe(true);
    expect(registry.has("generate_visual_plan")).toBe(true);
    expect(registry.has("select_template" as never)).toBe(false);
  });
});

describe("generateVisualPlanTask — the text's changes as facts (F38b)", () => {
  const current = { nodes: [{ id: "p1", type: "table", content: { columns: ["Role"], rows: [["DBA"]] } }], relationships: [] };

  it("an edit with nothing added says so: update the node that shows it, add no node", () => {
    const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "action_plan", text: "x", current, changes: { edited: ["The DBA and the security lead approve it."], added: [] } } });
    expect(prompt).toContain("«The DBA and the security lead approve it.»");
    expect(prompt).toContain("never add a node for it");
    expect(prompt).toContain("No paragraph was added to this section");
  });

  it("an added paragraph is quoted as new detail or a new concept", () => {
    const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "action_plan", text: "x", current, changes: { edited: [], added: ["Mitigation: roll back."] } } });
    expect(prompt).toContain("«Mitigation: roll back.»");
    expect(prompt).toMatch(/linked explained_by, or a genuinely new concept/);
  });
});

describe("outlineDocumentTask", () => {
  it("is routing, not authoring: a configured decision model answers it, and it has room to finish on a loaded provider", () => {
    expect(outlineDocumentTask.policy).toEqual({ preferDecisionModel: true });
    expect(outlineDocumentTask.timeoutMs).toBeGreaterThanOrEqual(120_000);
  });
});
