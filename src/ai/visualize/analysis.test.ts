/**
 * Content fidelity Wave B1: analysis on top of the preserved content — a takeaway and the model's own analysis per
 * section (marked as analysis), a deterministic check with one retry, "Keep as text", and the prompt rules behind them.
 */
import { describe, expect, it, vi } from "vitest";
import { missingAnalysis, takeawayOf } from "@/ai/fidelity/analysisCheck";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { renderVisualPlan } from "@/ai/renderer/render";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { groupTakeawayKey, groupTitleKey } from "@/ai/visual-plan/groups";
import { SECTION_KINDS } from "@/ai/visual-plan/sectionKinds";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { outlineDocumentTask } from "./outline";
import { visualNodeSchema } from "@/ai/visual-plan/schema";
import { generateSectionAnalysisTask, generateVisualPlanTask, registerVisualizeTasks } from "./tasks";
import { ReadsFineAsTextError } from "./types";
import { readsFineAsText, visualizeContent } from "./visualize";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const response = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });

describe("the analysis check", () => {
  it("reads the takeaway from metadata, trimmed and cut at a word when long", () => {
    expect(takeawayOf({ metadata: { takeaway: "  Merge v3 now;\n two wait  " } })).toBe("Merge v3 now; two wait");
    expect(takeawayOf({ metadata: {} })).toBeNull();
    expect(takeawayOf({ metadata: { takeaway: 3 } })).toBeNull();
    const long = takeawayOf({ metadata: { takeaway: "word ".repeat(80) } })!;
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith("word…")).toBe(true);
  });

  it("asks every kind for a takeaway and an analysis node; supporting detail only for a takeaway", () => {
    const bare = { nodes: [{ id: "n1", type: "text", content: { markdown: "x" } }] };
    expect(missingAnalysis(bare, "decision")).toEqual(["a takeaway", "its own analysis"]);
    expect(missingAnalysis(bare, "supporting")).toEqual(["a takeaway"]);
    const good = { nodes: [...bare.nodes, { id: "a", type: "text", origin: "analysis", content: { markdown: "y" } }], metadata: { takeaway: "t" } };
    expect(missingAnalysis(good, "flow")).toEqual([]);
  });
});

describe("prompts (Wave B1)", () => {
  it("every section kind is asked for a takeaway and its kind's analysis, marked as analysis", () => {
    for (const kind of SECTION_KINDS) {
      const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "sectioned", text: "Some content", section: { label: "S", kind } } });
      expect(prompt, kind).toContain('"metadata.takeaway"');
      expect(prompt, kind).toContain('"origin":"analysis"');
      expect(prompt, kind).toContain('"takeaway":"..."');
    }
  });

  it("a forced template, an update or a dense block is not asked for analysis", () => {
    expect(generateVisualPlanTask.buildPrompt({ input: { template: "flow", text: "x" } }).prompt).not.toContain("metadata.takeaway");
    expect(generateVisualPlanTask.buildPrompt({ input: { template: "sectioned", text: "x", section: { label: "S", kind: "notes" }, dense: { reason: "long" } } }).prompt).not.toContain("metadata.takeaway");
  });

  it("decisions are one shape each and never chained in list order; the outline keeps independent items out of a flow", () => {
    const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "sectioned", text: "x", section: { label: "S", kind: "decision" } } });
    expect(prompt).toContain("Decisions are NOT a sequence");
    expect(prompt).not.toMatch(/short chain of "shape" nodes/);
    const outline = outlineDocumentTask.buildPrompt({ input: { units: [{ key: "u", text: "D1 … D6" }] } }).prompt;
    expect(outline).toContain('A "flow" is only for steps where each one leads to the next');
  });

  it("numbered content is placed by reference and never restated; a decision table is its own structure", () => {
    const input = { template: "sectioned" as const, text: "x", numbered: "[T1] | a | b |", section: { label: "S", kind: "decision" as const } };
    const { prompt } = generateVisualPlanTask.buildPrompt({ input });
    expect(prompt).toContain('"type":"source","ref":"T1"');
    expect(prompt).toContain("Never restate a block you placed");
    expect(prompt).toContain("that table IS their structure");
    expect(prompt.endsWith("Content to visualize:\n\n[T1] | a | b |")).toBe(true);
    // Without numbering (a forced template, an update), no reference rule.
    expect(generateVisualPlanTask.buildPrompt({ input: { template: "flow", text: "x" } }).prompt).not.toContain('"type":"source"');
  });

  it("a comparison already a table in the content is placed as it is, not re-arranged; block numbers stay out of the model's text", () => {
    const input = { template: "sectioned" as const, text: "x", numbered: "[T1] | a | b |", section: { label: "S", kind: "comparison" as const } };
    const { prompt } = generateVisualPlanTask.buildPrompt({ input });
    expect(prompt).toContain("that table IS the comparison");
    expect(prompt).toContain('never write "[P1]", "[T1]"');
  });

  /** The `{"id":"a1",…"origin":"analysis"…}` node a prompt's JSON shape shows (the first one on a line starting with `{`), parsed. */
  const shapeAnalysisNode = (prompt: string): unknown => {
    const line = prompt.split("\n").find((l) => l.startsWith("{") && l.includes('"origin":"analysis"'));
    const match = line && /\{"id":"a1"[^{}]*\{[^{}]*\}\}/.exec(line);
    return match ? JSON.parse(match[0]) : undefined;
  };

  it("the reply's JSON shape shows the analysis node the plan must contain, the same node the analysis patch's shape shows", () => {
    const patch = generateSectionAnalysisTask.buildPrompt({ input: { label: "S", kind: "notes", text: "x", missing: ["its own analysis"], nodes: [] } }).prompt;
    const expected = shapeAnalysisNode(patch);
    expect(expected).toEqual({ id: "a1", type: "text", origin: "analysis", title: "...", content: { markdown: "..." } });
    for (const kind of SECTION_KINDS) {
      const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "sectioned", text: "Some content", section: { label: "S", kind } } });
      expect(shapeAnalysisNode(prompt), kind).toEqual(expected);
      // The shape comes before the rules, and still names the takeaway in its metadata.
      expect(prompt.indexOf('"origin":"analysis"'), kind).toBeLessThan(prompt.indexOf('Each node is one of'));
      expect(prompt, kind).toContain('"metadata":{"title":"optional","takeaway":"..."}');
    }
  });

  it("the node the shape shows is a valid plan node, and counts as the section's own analysis for the check", () => {
    const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "sectioned", text: "x", section: { label: "S", kind: "decision" } } });
    const node = shapeAnalysisNode(prompt);
    expect(visualNodeSchema.safeParse(node).success).toBe(true);
    expect(missingAnalysis({ nodes: [{ id: "n1", type: "text", content: { markdown: "x" } }, node], metadata: { takeaway: "t" } }, "decision")).toEqual([]);
    // Ids of the model's other nodes are "n1", "n2", …; the example's id can't collide with them.
    expect(prompt).toContain('Give every node a unique "id" ("n1", "n2", ...)');
  });

  it("the shape shows no analysis node where no analysis is asked for: a forced template, a dense block, an update, a piece", () => {
    const section = { label: "S", kind: "notes" as const };
    const inputs = [
      { template: "flow" as const, text: "x" },
      { template: "sectioned" as const, text: "x", section, dense: { reason: "long" } },
      { template: "sectioned" as const, text: "x", section, current: { nodes: [], relationships: [] } as never },
      { template: "sectioned" as const, text: "x", section, part: { index: 1, total: 2 } },
    ];
    for (const input of inputs) {
      const { prompt } = generateVisualPlanTask.buildPrompt({ input });
      expect(prompt).not.toContain('"origin":"analysis"');
      expect(prompt).toContain('"nodes":[<node>, ...],"relationships"');
    }
  });

  it("the analysis retry says what the earlier plan lacked", () => {
    const { prompt } = generateVisualPlanTask.buildPrompt({ input: { template: "sectioned", text: "x", section: { label: "S", kind: "notes" }, analysisRetry: { missing: ["a takeaway"] } } });
    expect(prompt).toContain("An earlier plan of this section fell short of an analysis: it lacked a takeaway.");
  });
});

describe("rendering the analysis (Wave B1)", () => {
  const plan = (takeaway?: string): VisualPlan =>
    validateVisualPlan({
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "g0", type: "group", content: { label: "Decisions", arrangement: "grid", ...(takeaway ? { takeaway } : {}) } },
        { id: "n1", type: "shape", parent: "g0", content: { shape: "rectangle", label: "D1: gate" } },
        { id: "a1", type: "text", parent: "g0", origin: "analysis", title: "Status", content: { markdown: "D2 waits on the engineer." } },
        { id: "n2", type: "text", parent: "g0", origin: "made-up", content: { markdown: "A fact." } },
      ],
      relationships: [],
    }).plan;

  it("a section's takeaway is one centred line under its title, inside its frame", async () => {
    const set = await renderVisualPlan(plan("Merge v3; two wait on the engineer"), { operationId: "op", title: "t", metadata: { createdBy: "ai", task: "generate_visual_plan", operationId: "op" }, context, parseMarkdown: parse });
    const frame = set.changes.find((c) => c.kind === "create_frame") as { children: string[] };
    const line = set.changes.find((c) => c.kind === "create_block" && c.key === groupTakeawayKey("g0")) as { box: { y: number }; textAlign?: string; content: { content: string }[] };
    const title = set.changes.find((c) => c.kind === "create_block" && c.key === groupTitleKey("g0")) as { box: { y: number; height: number } };
    expect(frame.children).toContain(groupTakeawayKey("g0"));
    expect(line.content[0]!.content).toBe("Merge v3; two wait on the engineer");
    expect(line.textAlign).toBe("center");
    expect(line.box.y).toBeGreaterThanOrEqual(title.box.y + title.box.height);
    // Members sit below the takeaway.
    const shape = set.changes.find((c) => c.kind === "create_shape") as { box: { y: number } };
    expect(shape.box.y).toBeGreaterThan(line.box.y);
  });

  it("no takeaway, no line; the model's analysis is tagged, anything else isn't", async () => {
    const set = await renderVisualPlan(plan(), { operationId: "op", title: "t", metadata: { createdBy: "ai", task: "generate_visual_plan", operationId: "op" }, context, parseMarkdown: parse });
    expect(set.changes.some((c) => c.kind === "create_block" && c.key === groupTakeawayKey("g0"))).toBe(false);
    const text = (key: string) => JSON.stringify((set.changes.find((c) => c.kind === "create_block" && c.key === key) as { content: unknown }).content);
    expect(text("a1")).toContain("Analysis · Status");
    expect(text("n2")).not.toContain("Analysis");
  });
});

describe("the analysis check in a run: one retry, then reported (Wave B1)", () => {
  const DOC = "D1 is the verification gate: replace the checklist with submit_answer. D2 calls the merge v3 and keeps Draft 03 frozen; the engineer needs to agree.";
  const OUTLINE = JSON.stringify({ sections: [{ id: "s1", label: "Decisions", kind: "decision", parts: ["u1"] }] });
  const bare = JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: DOC } }, { id: "n2", type: "shape", content: { shape: "rectangle", label: "D1" } }], relationships: [] });
  const analysed = JSON.stringify({
    version: 1,
    template: "sectioned",
    nodes: [{ id: "n1", type: "text", content: { markdown: DOC } }, { id: "n2", type: "shape", content: { shape: "rectangle", label: "D1" } }, { id: "a1", type: "text", origin: "analysis", title: "Status", content: { markdown: "D2 needs the engineer's agreement." } }],
    relationships: [],
    metadata: { takeaway: "Gate on submit_answer; D2 waits on the engineer" },
  });

  /** What the analysis-only retry answers: a takeaway and an analysis node linked to the plan's n2. */
  const PATCH = JSON.stringify({
    takeaway: "Gate on submit_answer; D2 waits on the engineer",
    nodes: [{ id: "a1", type: "text", origin: "analysis", title: "Status", content: { markdown: "D2 needs the engineer's agreement." } }],
    relationships: [{ from: "a1", to: "n2", type: "relates_to" }],
  });

  function setup(replies: string[], patch = "{}") {
    let i = 0;
    const spy = vi.fn((req: AIRequest) =>
      response(req.task === "outline_document" ? OUTLINE : req.task === "generate_section_analysis" ? patch : replies[Math.min(i++, replies.length - 1)]!),
    );
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerVisualizeTasks(registry);
    manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
    manager.setPrimary("mock");
    return { runtime: createAIRuntime({ manager, registry }), spy };
  }
  const run = (runtime: ReturnType<typeof setup>["runtime"]) => visualizeContent({ text: DOC, operationId: "op_b1", title: "Visualize", context }, runtime, { parseMarkdown: parse });

  it("a plan with no takeaway or analysis gets just those from a small call, merged into the plan it has", async () => {
    const { runtime, spy } = setup([bare], PATCH);
    const result = await run(runtime);
    const calls = spy.mock.calls.map((c) => c[0]!);
    expect(calls.map((c) => c.task)).toEqual(["outline_document", "generate_visual_plan", "generate_section_analysis"]);
    expect(calls[2]!.prompt).toContain("it lacks a takeaway and its own analysis");
    expect(calls[2]!.prompt).toContain("- n2 (shape): D1");
    expect(JSON.stringify(result.changeSet.changes)).toContain("D2 needs the engineer");
    expect(result.changeSet.analysis).toEqual({ mode: "ai", fallbacks: [] });
    expect(JSON.stringify(result.changeSet.changes)).toContain("Gate on submit_answer; D2 waits on the engineer");
  });

  it("a small call that fixes nothing falls back to generating the section once more, told what it lacked", async () => {
    const { runtime, spy } = setup([bare, analysed]);
    const result = await run(runtime);
    const calls = spy.mock.calls.map((c) => c[0]!);
    expect(calls.map((c) => c.task)).toEqual(["outline_document", "generate_visual_plan", "generate_section_analysis", "generate_visual_plan"]);
    expect(calls[3]!.prompt).toContain("it lacked a takeaway and its own analysis");
    expect(result.changeSet.analysis).toEqual({ mode: "ai", fallbacks: [] });
    expect(JSON.stringify(result.changeSet.changes)).toContain("Gate on submit_answer; D2 waits on the engineer");
  });

  it("a plan that is already analysed costs no extra call", async () => {
    const { runtime, spy } = setup([analysed]);
    await run(runtime);
    expect(spy.mock.calls.map((c) => c[0]!.task)).toEqual(["outline_document", "generate_visual_plan"]);
  });

  it("a one-section document longer than a note, written out as text only, is asked once for its structure", async () => {
    const incident =
      "Our checkout has a web client that calls a Checkout API over HTTPS. The API writes orders to an Orders database " +
      "and charges cards through a third-party payment gateway. When the gateway times out, the API retries, which has " +
      "caused double charges. We plan to add idempotency keys derived from the order id so a retry can never charge twice.";
    const analysis = { id: "a1", type: "text", origin: "analysis", content: { markdown: "Retries without idempotency charge twice." } };
    const textOnly = JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: incident } }, analysis], relationships: [], metadata: { takeaway: "Retries double-charge" } });
    const drawn = JSON.stringify({
      version: 1,
      template: "sectioned",
      nodes: [{ id: "w", type: "shape", content: { shape: "rectangle", label: "Web client" } }, { id: "api", type: "shape", content: { shape: "rectangle", label: "Checkout API" } }, { id: "d", type: "text", content: { markdown: incident } }, analysis],
      relationships: [{ from: "w", to: "api", type: "depends_on" }],
      metadata: { takeaway: "Retries double-charge" },
    });
    let i = 0;
    const spy = vi.fn((req: AIRequest) => response(req.task === "outline_document" ? OUTLINE : [textOnly, drawn][Math.min(i++, 1)]!));
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerVisualizeTasks(registry);
    manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
    manager.setPrimary("mock");
    const result = await visualizeContent({ text: incident, operationId: "op_s", title: "Visualize", context }, createAIRuntime({ manager, registry }), { parseMarkdown: parse });
    expect(spy.mock.calls.map((c) => c[0]!.task)).toEqual(["outline_document", "generate_visual_plan", "generate_visual_plan"]);
    expect(spy.mock.calls[2]![0]!.prompt).toContain("it lacked a visual structure");
    expect(result.changeSet.changes.filter((c) => c.kind === "create_shape")).toHaveLength(2);
  });

  it("still only restated after the retry: reported in the review, never hidden", async () => {
    const { runtime } = setup([bare, bare]);
    const result = await run(runtime);
    expect(result.changeSet.analysis).toEqual({ mode: "ai", fallbacks: [], shallow: ["Decisions"] });
  });
});

describe('"Keep as text" (D-R2.3)', () => {
  const p = (nodes: unknown[], relationships: unknown[] = []) => validateVisualPlan({ version: 1, template: "sectioned", nodes, relationships }).plan;
  const text = (id: string, parent?: string) => ({ id, type: "text", ...(parent ? { parent } : {}), content: { markdown: `Text ${id}` } });
  const group = { id: "g0", type: "group", content: { label: "S", arrangement: "grid" } };

  it("fewer than 3 text cards with no relationship reads fine as text; a table, a shape, a link or a third card draws", () => {
    const note = "The meeting moved to Tuesday.";
    expect(readsFineAsText(p([group, text("a", "g0"), text("b", "g0")]), note)).toBe(true);
    expect(readsFineAsText(p([group, text("a", "g0"), text("b", "g0"), text("c", "g0")]), note)).toBe(false);
    expect(readsFineAsText(p([group, text("a", "g0"), text("b", "g0")], [{ from: "a", to: "b", type: "relates_to" }]), note)).toBe(false);
    expect(readsFineAsText(p([group, text("a", "g0"), { id: "t", type: "table", parent: "g0", content: { columns: ["x"], rows: [["1"]] } }]), note)).toBe(false);
    expect(readsFineAsText(p([group, { id: "s", type: "shape", parent: "g0", content: { shape: "rectangle", label: "X" } }]), note)).toBe(false);
  });

  it("longer content is never declared simple, however the model wrote it (the live run's checkout incident)", () => {
    const incident =
      "Our checkout has a web client that calls a Checkout API over HTTPS. The API writes orders to an Orders database " +
      "and charges cards through a third-party payment gateway. When the gateway times out, the API retries, which has caused double charges.";
    expect(readsFineAsText(p([group, text("a", "g0"), text("b", "g0")]), incident)).toBe(false);
  });

  it("Visualize says so instead of drawing, carrying the proposal for \"Visualize anyway\"", async () => {
    const reply = JSON.stringify({
      version: 1,
      template: "sectioned",
      nodes: [{ id: "n1", type: "text", content: { markdown: "The meeting moved to Tuesday." } }, { id: "a1", type: "text", origin: "analysis", content: { markdown: "Nothing else changes." } }],
      relationships: [],
      metadata: { takeaway: "Meeting moved to Tuesday" },
    });
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerVisualizeTasks(registry);
    const outline = JSON.stringify({ sections: [{ id: "s1", label: "Note", kind: "notes", parts: ["u1"] }] });
    manager.registerProvider(createMockProvider({ id: "mock", respond: (req) => response(req.task === "outline_document" ? outline : reply) }));
    manager.setPrimary("mock");
    const runtime = createAIRuntime({ manager, registry });
    const err = await visualizeContent({ text: "The meeting moved to Tuesday.", operationId: "op_t", title: "Visualize", context }, runtime, { parseMarkdown: parse }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReadsFineAsTextError);
    expect((err as ReadsFineAsTextError).changeSet.changes.length).toBeGreaterThan(0);
  });
});
