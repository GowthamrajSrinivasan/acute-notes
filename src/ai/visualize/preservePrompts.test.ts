/**
 * G7 / §0.3 rule 1 (knowledge-notes-plan): `preserve` is exactly today's behaviour. These snapshots were taken before
 * any Knowledge Notes prompt change (WP1.4, WP1.5) and must never change for `preserve` input: a diff here means a
 * `preserve` prompt changed. Distil-mode prompts are tested in `tasks.test.ts`, never here.
 */
import { describe, expect, it } from "vitest";
import { numberSource } from "@/ai/fidelity/sourceBlocks";
import { SECTION_KINDS } from "@/ai/visual-plan/sectionKinds";
import { VISUAL_TEMPLATES } from "@/ai/visual-plan/types";
import { generateSectionAnalysisTask, generateVisualPlanTask, type GenerateVisualPlanInput } from "./tasks";

const TEXT = [
  "## Retries",
  "",
  "Retries can improve reliability when the cache holds a valid result. However, they must not exceed 3 attempts.",
  "",
  "| Case | Before | Now |",
  "|---|---|---|",
  "| Timeout | dropped | retried up to 3 times |",
  "",
  "- Use an idempotency key",
  "- Log every retry",
  "",
  "```ts",
  "retry(3);",
  "```",
].join("\n");

const plan = (input: GenerateVisualPlanInput, repairFeedback?: string) => {
  const { systemPrompt, prompt } = generateVisualPlanTask.buildPrompt({ input, ...(repairFeedback ? { repairFeedback } : {}) });
  return `${systemPrompt}\n----\n${prompt}`;
};

describe("preserve prompts are byte-identical to before Knowledge Notes (G7)", () => {
  it("numberSource's numbered view", async () => {
    const { numbered, blocks } = await numberSource(TEXT);
    expect({ numbered, refs: blocks.map((b) => `${b.ref}:${b.kind}`) }).toMatchSnapshot();
  });

  it("every forced template", () => {
    for (const template of VISUAL_TEMPLATES) expect(plan({ template, text: TEXT }), template).toMatchSnapshot(template);
  });

  it("every section kind, analysed, with numbered blocks", async () => {
    const { numbered } = await numberSource(TEXT);
    for (const kind of SECTION_KINDS) {
      expect(plan({ template: "sectioned", text: TEXT, numbered, section: { label: "Retries", kind } }), kind).toMatchSnapshot(kind);
    }
  });

  it("pieces, retries, dense, updates, appended and repair feedback", async () => {
    const { numbered } = await numberSource(TEXT);
    const section = { label: "Retries", kind: "notes" as const };
    const current = { nodes: [{ id: "p1", stableKey: "retry", type: "shape", content: { shape: "rectangle", label: "Retry" } }], relationships: [] };
    const cases: Record<string, GenerateVisualPlanInput> = {
      part: { template: "sectioned", text: TEXT, numbered, section, part: { index: 1, total: 2 } },
      retry: { template: "sectioned", text: TEXT, section, retry: { missing: ["Log every retry"] } },
      analysisRetry: { template: "sectioned", text: TEXT, numbered, section, analysisRetry: { missing: ["takeaway", "analysis"] } },
      dense: { template: "sectioned", text: TEXT, section, dense: { reason: "a 12-row table" } },
      update: { template: "sectioned", text: TEXT, section, current, changes: { edited: ["Log every retry"], added: [] } },
      appended: { template: "sectioned", text: TEXT, numbered, section, current, appended: true },
      architecture: { template: "architecture", text: TEXT, numbered },
    };
    for (const [name, input] of Object.entries(cases)) expect(plan(input), name).toMatchSnapshot(name);
    expect(plan(cases.retry!, "Your last reply was not valid JSON."), "repair").toMatchSnapshot("repair");
  });

  it("the analysis patch, for every kind and for an unknown one", () => {
    for (const kind of [...SECTION_KINDS, "other"]) {
      const { systemPrompt, prompt } = generateSectionAnalysisTask.buildPrompt({
        input: { label: "Retries", kind, text: TEXT, missing: ["takeaway", "analysis"], nodes: [{ id: "n1", type: "text", label: "Retry" }] },
      });
      expect(`${systemPrompt}\n----\n${prompt}`, kind).toMatchSnapshot(kind);
    }
  });
});
