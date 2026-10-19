import { describe, expect, it, vi } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { visualizeContent } from "@/ai/visualize/visualize";
import { canRegenerate, regenerateSections } from "./regenerate";
import { buildReport, sectionsToRegenerate, type FidelitySection } from "./report";

const section = (key: string, units: number, placedByAI: number, missing: string[] = []): FidelitySection => ({
  key,
  label: key,
  units,
  placedByAI,
  addedFromSource: units - placedByAI,
  added: Array.from({ length: units - placedByAI }, (_, i) => `${key} point ${i}`),
  keyTerms: { total: 5, placedByAI: 5 - missing.length, missing },
});

describe("buildReport / sectionsToRegenerate", () => {
  const report = buildReport([section("a", 10, 10), section("b", 10, 9), section("c", 10, 5, ["0.5", "0.5"])]);

  it("sums the sections and lists each missing key term once", () => {
    expect(report).toMatchObject({ units: 30, placedByAI: 24, addedFromSource: 6, keyTerms: { missing: ["0.5"] } });
    expect(report.keyTerms.total - report.keyTerms.placedByAI).toBe(report.keyTerms.missing.length);
  });

  it("offers every section that fell short by default, and none when regeneration is off", () => {
    const on = { enabled: true, whenAIPlacedBelow: 1, whenKeyTermsMissingAtLeast: 1 };
    expect(sectionsToRegenerate(report, on).map((s) => s.key)).toEqual(["b", "c"]);
    expect(sectionsToRegenerate(report, { ...on, enabled: false })).toEqual([]);
  });

  it("honours the thresholds: only below the placed share, or with enough key terms missing", () => {
    expect(sectionsToRegenerate(report, { enabled: true, whenAIPlacedBelow: 0.8, whenKeyTermsMissingAtLeast: Infinity }).map((s) => s.key)).toEqual(["c"]);
    expect(sectionsToRegenerate(report, { enabled: true, whenAIPlacedBelow: 0, whenKeyTermsMissingAtLeast: 2 }).map((s) => s.key)).toEqual(["c"]);
  });
});

describe("Visualize → fidelity report → Regenerate (only the sections that fell short)", () => {
  // Long enough (and sectioned) for Visualize to recommend AI over the local tier.
  const BETA = Array.from({ length: 40 }, (_, i) => `Beta stores session ${i} in Redis for ${30 + i} minutes.`).join(" ");
  const DOC = `# Notes\n\n## Alpha\n\nAlpha keeps the cache warm between deploys. Alpha retries three times with exponential backoff.\n\n## Beta\n\n${BETA}\n`;
  const OUTLINE = { sections: [
    { id: "s1", label: "Alpha", kind: "notes", prominence: "primary", parts: ["u1"] },
    { id: "s2", label: "Beta", kind: "notes", prominence: "primary", parts: ["u2"] },
  ] };
  // A good reply (Wave B): the section's text, plus a takeaway and one node of the model's own analysis.
  const reply = (markdown: string) =>
    JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown } }, { id: "an1", type: "text", origin: "analysis", content: { markdown: "The section at a glance." } }], relationships: [], metadata: { takeaway: "At a glance" } });
  const response = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });

  function setup() {
    let alphaCalls = 0;
    const spy = vi.fn((req: AIRequest) => {
      if (req.task === "outline_document") return response(JSON.stringify(OUTLINE));
      if (req.prompt.includes('"Alpha"')) {
        alphaCalls++;
        // First plan leaves the retry detail out; the regenerated one places it.
        return response(reply(alphaCalls === 1 ? "Alpha keeps the cache warm between deploys." : "Alpha keeps the cache warm between deploys; retries three times with exponential backoff."));
      }
      return response(reply(BETA));
    });
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerVisualizeTasks(registry);
    manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
    manager.setPrimary("mock");
    return { runtime: createAIRuntime({ manager, registry }), spy };
  }
  const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
  const parse = (md: string) => [{ type: "paragraph" as const, content: md }];

  it("reports what the AI left out, carries it on the change set, and regenerates only that section", async () => {
    const { runtime, spy } = setup();
    const first = await visualizeContent({ text: DOC, operationId: "op_1", title: "Visualize", context }, runtime, { parseMarkdown: parse });
    expect(first.usedLocalTier).toBe(false);
    expect(first.changeSet.fidelity).toMatchObject({ units: 42, placedByAI: 41, addedFromSource: 1 });
    const alpha = first.fidelity!.sections.find((s) => s.label === "Alpha")!;
    expect(alpha.added).toEqual(["Alpha retries three times with exponential backoff."]);
    expect(sectionsToRegenerate(first.fidelity!).map((s) => s.label)).toEqual(["Alpha"]);
    expect(canRegenerate("op_1")).toBe(true);

    spy.mockClear();
    const again = await regenerateSections("op_1", [alpha.key], runtime, { operationId: "op_2", context }, { parseMarkdown: parse });
    // No new outline, no call for Beta: only Alpha, told what it missed.
    expect(spy.mock.calls.map((c) => c[0]!.task)).toEqual(["generate_visual_plan"]);
    expect(spy.mock.calls[0]![0]!.prompt).toContain("«Alpha retries three times with exponential backoff.»");
    expect(again.fidelity).toMatchObject({ units: 42, placedByAI: 42, addedFromSource: 0 });
  });

  it("refuses a run it no longer keeps", async () => {
    const { runtime } = setup();
    await expect(regenerateSections("unknown", ["x"], runtime, { operationId: "op_x", context })).rejects.toThrow(/can no longer be regenerated/);
  });
});
