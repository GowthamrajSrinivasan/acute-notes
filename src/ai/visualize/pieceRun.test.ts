/** A large section is generated in pieces in parallel, merged, and analysed once as a whole (pieces.ts). */
import { describe, expect, it, vi } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { registerVisualizeTasks } from "./tasks";
import { SPLIT_SECTION_CHARS } from "./pieces";
import { visualizeContent } from "./visualize";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const response = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });

const topics = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
/** One paragraph per topic, each carrying one «marker» so it can be counted once. */
const DOC = topics.map((t) => `Stage «${t}» ${"runs its checks before the next one starts, and records what it found. ".repeat(10).trim()}`).join("\n\n");
const OUTLINE = JSON.stringify({ sections: [{ id: "s1", label: "Stages", kind: "notes", parts: ["u1"] }] });

/** A piece's reply: its own text as a text node, plus a shape, with ids that repeat across pieces. */
const pieceReply = (req: AIRequest) => {
  const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
  return JSON.stringify({
    version: 1,
    template: "sectioned",
    nodes: [{ id: "n1", type: "text", content: { markdown: body } }, { id: "n2", type: "shape", content: { shape: "rectangle", label: "Stage" } }],
    relationships: [{ from: "n2", to: "n1", type: "explained_by" }],
  });
};
const PATCH = JSON.stringify({
  takeaway: "Every stage checks before the next starts",
  nodes: [{ id: "a1", type: "text", origin: "analysis", title: "Reading", content: { markdown: "The stages run in order, each gating the next." } }],
  relationships: [],
});

function setup(respondPiece: (req: AIRequest) => string = pieceReply) {
  const spy = vi.fn((req: AIRequest) => response(req.task === "outline_document" ? OUTLINE : req.task === "generate_section_analysis" ? PATCH : respondPiece(req)));
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), spy };
}
const run = (runtime: ReturnType<typeof setup>["runtime"]) => visualizeContent({ text: DOC, operationId: "op_pieces", title: "Visualize", context }, runtime, { parseMarkdown: parse });

describe("a large section is generated in pieces", () => {
  it("each piece is its own call without a takeaway or analysis, then the whole section is analysed once", async () => {
    expect(DOC.length).toBeGreaterThan(SPLIT_SECTION_CHARS);
    const { runtime, spy } = setup();
    const result = await run(runtime);
    const calls = spy.mock.calls.map((c) => c[0]!);
    const plan = calls.filter((c) => c.task === "generate_visual_plan");
    expect(plan.length).toBeGreaterThan(1);
    expect(calls.filter((c) => c.task === "generate_section_analysis")).toHaveLength(1);
    expect(calls.at(-1)!.task).toBe("generate_section_analysis");
    plan.forEach((c) => {
      expect(c.prompt).toMatch(new RegExp(`part [0-9]+ of ${plan.length} of this section`));
      expect(c.prompt).not.toContain('"metadata.takeaway"');
    });
    // Every piece's content is on the canvas once, and the whole section's takeaway came from the analysis step.
    const changes = JSON.stringify(result.changeSet.changes);
    for (const t of topics) expect(changes.split(`«${t}»`).length - 1).toBe(1);
    expect(changes).toContain("Every stage checks before the next starts");
    expect(result.changeSet.analysis).toEqual({ mode: "ai", fallbacks: [] });
  });

  it("a piece that fails shows its own structure while the others stay AI's, and the section isn't generated whole again", async () => {
    const { runtime, spy } = setup((req) => (req.prompt.includes("«alpha»") ? "not json at all" : pieceReply(req)));
    const result = await run(runtime);
    const calls = spy.mock.calls.map((c) => c[0]!);
    // The failed piece is asked twice (the runtime's repair retry), never regenerated as a whole section.
    expect(calls.filter((c) => c.task === "generate_visual_plan" && c.prompt.includes("«alpha»"))).toHaveLength(2);
    expect(calls.filter((c) => c.task === "generate_section_analysis")).toHaveLength(1);
    expect(result.warnings.join("\n")).toMatch(/couldn't be analysed/);
    // Nothing is lost: the failed piece shows its own text, the others are AI's.
    const changes = JSON.stringify(result.changeSet.changes);
    for (const t of topics) expect(changes).toContain(`«${t}»`);
  });
});
