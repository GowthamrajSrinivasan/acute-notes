/**
 * "Regenerate never makes it worse" (content fidelity plan, Wave A2): a regenerated section keeps its earlier reply
 * when the new one places less of the source or fails, each section is regenerated at most once, and — given the
 * canvas — a regenerated section whose layout is messier is put back as it was.
 */
import { describe, expect, it, vi } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { visualizeContent } from "@/ai/visualize/visualize";
import { regeneratedSections, regenerateSections } from "./regenerate";
import { compareCoverage } from "./report";
import type { SectionCoverage } from "./safetyNet";

// The layout score, stood in for by the number of arrows drawn: more arrows, messier layout.
vi.mock("@/ai/changes/proposalGeometry", () => ({
  checkProposal: (changes: readonly { kind: string }[]) => ({ score: changes.filter((c) => c.kind === "connect").length, issues: [], counts: {}, truncated: false }),
}));

const coverage = (total: number, covered: number, placedTerms = 0): SectionCoverage => ({
  total,
  covered,
  attached: total - covered,
  added: [],
  keyTerms: { total: 3, placedByAI: placedTerms, missing: [], all: [] },
});

describe("compareCoverage", () => {
  it("the placed share decides; key terms kept break a tie", () => {
    expect(compareCoverage(coverage(10, 9), coverage(10, 5))).toBeGreaterThan(0);
    expect(compareCoverage(coverage(4, 2), coverage(10, 5, 3))).toBeLessThan(0);
    expect(compareCoverage(coverage(10, 5, 1), coverage(10, 5, 1))).toBe(0);
  });
});

describe("regenerateSections — never worse (Wave A2)", () => {
  const BETA = Array.from({ length: 40 }, (_, i) => `Beta stores session ${i} in Redis for ${30 + i} minutes.`).join(" ");
  const DOC = `# Notes\n\n## Alpha\n\nAlpha keeps the cache warm between deploys. Alpha retries three times with exponential backoff.\n\n## Beta\n\n${BETA}\n`;
  const OUTLINE = {
    sections: [
      { id: "s1", label: "Alpha", kind: "notes", prominence: "primary", parts: ["u1"] },
      { id: "s2", label: "Beta", kind: "notes", prominence: "primary", parts: ["u2"] },
    ],
  };
  // A good reply (Wave B): the section's text, plus a takeaway and one node of the model's own analysis.
  const ANALYSIS = { id: "an1", type: "text", origin: "analysis", content: { markdown: "The section at a glance." } };
  const text = (markdown: string) => ({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown } }, ANALYSIS], relationships: [], metadata: { takeaway: "At a glance" } });
  const HALF = JSON.stringify(text("Alpha keeps the cache warm between deploys."));
  const FULL = "Alpha keeps the cache warm between deploys; retries three times with exponential backoff.";
  /** Places everything, but as five linked shapes: the stand-in layout score calls that messier. */
  const FULL_BUT_MESSY = JSON.stringify({
    version: 1,
    template: "sectioned",
    metadata: { takeaway: "At a glance" },
    nodes: [{ id: "t", type: "text", content: { markdown: FULL } }, ANALYSIS, ...["a", "b", "c", "d", "e"].map((id) => ({ id, type: "shape", content: { shape: "rectangle", label: `Step ${id}` } }))],
    relationships: ["b", "c", "d", "e"].map((to, i) => ({ from: ["a", "b", "c", "d"][i]!, to, type: "flows_to" })),
  });
  const response = (t: string): AIResponse => ({ text: t, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });
  const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
  const parse = (md: string) => [{ type: "paragraph" as const, content: md }];

  /** Alpha's replies in order (the last repeats); Beta always places everything. */
  function setup(alpha: string[]) {
    let calls = 0;
    const spy = vi.fn((req: AIRequest) => {
      if (req.task === "outline_document") return response(JSON.stringify(OUTLINE));
      if (req.prompt.includes('"Alpha"')) return response(alpha[Math.min(calls++, alpha.length - 1)]!);
      return response(JSON.stringify(text(BETA)));
    });
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerVisualizeTasks(registry);
    manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
    manager.setPrimary("mock");
    return createAIRuntime({ manager, registry });
  }
  async function first(runtime: ReturnType<typeof setup>, id: string) {
    const r = await visualizeContent({ text: DOC, operationId: id, title: "Visualize", context }, runtime, { parseMarkdown: parse });
    return { r, alpha: r.fidelity!.sections.find((s) => s.label === "Alpha")! };
  }

  it("keeps the earlier reply when the regenerated one places less of the source, and says so", async () => {
    const runtime = setup([JSON.stringify(text(FULL)), HALF]);
    const { r, alpha } = await first(runtime, "a_1");
    const again = await regenerateSections("a_1", [alpha.key], runtime, { operationId: "a_2", context }, { parseMarkdown: parse });
    expect(again.fidelity!.sections.find((s) => s.label === "Alpha")!.placedByAI).toBe(alpha.placedByAI);
    expect(again.fidelity).toEqual(r.fidelity);
    expect(again.notices).toContain(`Kept the earlier version of "Alpha": the regenerated one placed less of the source.`);
  });

  it("keeps the earlier reply when the regenerated one fails", async () => {
    const runtime = setup([HALF, "not a plan"]);
    const { r, alpha } = await first(runtime, "b_1");
    const again = await regenerateSections("b_1", [alpha.key], runtime, { operationId: "b_2", context }, { parseMarkdown: parse });
    expect(again.fidelity).toEqual(r.fidelity);
    expect(again.analysis.fallbacks).toEqual([]); // not reported as a fallback: the earlier AI reply is shown
  });

  it("uses the regenerated reply when it's better, and offers each section once", async () => {
    const runtime = setup([HALF, JSON.stringify(text(FULL))]);
    const { alpha } = await first(runtime, "c_1");
    expect(regeneratedSections("c_1").size).toBe(0);
    const again = await regenerateSections("c_1", [alpha.key], runtime, { operationId: "c_2", context }, { parseMarkdown: parse });
    expect(again.fidelity!.sections.find((s) => s.label === "Alpha")!.addedFromSource).toBe(0);
    expect([...regeneratedSections("c_2")]).toEqual([alpha.key]);
  });

  it("given the canvas, a better-placed but messier section is put back as it was", async () => {
    const runtime = setup([HALF, FULL_BUT_MESSY]);
    const { r, alpha } = await first(runtime, "d_1");
    const again = await regenerateSections("d_1", [alpha.key], runtime, { operationId: "d_2", context, scene: [] }, { parseMarkdown: parse });
    expect(again.changeSet.operationId).toBe("d_2");
    expect(again.fidelity).toEqual(r.fidelity);
    expect(again.notices.join(" ")).toMatch(/Kept the earlier version of "Alpha": the regenerated one made the layout messier/);
    // Without the canvas there is nothing to judge the layout by: the better-placed reply is used.
    const runtime2 = setup([HALF, FULL_BUT_MESSY]);
    const { alpha: alpha2 } = await first(runtime2, "e_1");
    const kept = await regenerateSections("e_1", [alpha2.key], runtime2, { operationId: "e_2", context }, { parseMarkdown: parse });
    expect(kept.fidelity!.sections.find((s) => s.label === "Alpha")!.addedFromSource).toBe(0);
  });
});
