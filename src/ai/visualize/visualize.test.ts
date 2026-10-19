/**
 * `visualizeContent`'s own tests, in the same style as `actions.test.ts`:
 * a real `AIProviderManager` + task registry + `MockProvider`, scripted per
 * test — never the app-wide singletons, so provider state never leaks
 * between tests.
 */
import { AIError } from "@/ai/errors";
import { describe, expect, it, vi } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { registerVisualizeTasks } from "./tasks";
import { NoProviderConfiguredError, NothingToVisualizeLocallyError, type VisualizeInput, type VisualizeProgress } from "./types";
import { visualizeContent } from "./visualize";

/** The outline of content with one part: a single section (select_template is gone; the outline classifies it). */
const ONE_SECTION_OUTLINE = JSON.stringify({ sections: [{ id: "s1", label: "Notes", kind: "notes", parts: ["u1"] }] });

const emptyContext = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };
const stubMarkdown = (md: string) => [{ type: "paragraph" as const, content: `parsed:${md}` }];

function baseInput(text: string, overrides: Partial<VisualizeInput> = {}): VisualizeInput {
  return { text, operationId: "op_1", title: "Visualize", context: emptyContext, ...overrides };
}

function setup(respond: (req: AIRequest) => AIResponse | Promise<AIResponse>, extra: { delayMs?: number } = {}) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn(respond);
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy, delayMs: extra.delayMs }));
  manager.setPrimary("mock");
  const runtime = createAIRuntime({ manager, registry });
  return { runtime, spy };
}

function noProviderRuntime() {
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  return createAIRuntime({ manager: new AIProviderManager(), registry });
}

const response = (text: string): AIResponse => ({ text, model: "model-x", finishReason: "stop", usage: { provider: "mock", model: "model-x" } });

const ARCHITECTURE_PLAN = JSON.stringify({
  version: 1,
  template: "architecture",
  nodes: [
    { id: "n1", type: "shape", role: "component", content: { shape: "rectangle", label: "Web" } },
    { id: "n2", type: "shape", role: "component", content: { shape: "rectangle", label: "API" } },
    // The model's own reading of the section (Wave B), with its takeaway below.
    { id: "a1", type: "text", origin: "analysis", content: { markdown: "The web client can't work without the API." } },
  ],
  relationships: [{ from: "n1", to: "n2", type: "depends_on" }],
  metadata: { takeaway: "Web depends on the API" },
});

describe("visualizeContent — local tier", () => {
  it("uses the local tier for explicit structure, calling no AI task at all", async () => {
    const { runtime, spy } = setup(() => response("should never be called"));
    const stages: string[] = [];
    const result = await visualizeContent(baseInput("# Launch\n\n- [ ] Ship it\n- [ ] Tell support\n"), runtime, {
      onProgress: (p: VisualizeProgress) => stages.push(p.stage),
    });
    expect(spy).not.toHaveBeenCalled();
    expect(result.usedLocalTier).toBe(true);
    expect(result.provenance).toBeUndefined();
    expect(() => parseChangeSet(result.changeSet)).not.toThrow();
    expect([...new Set(stages)]).toEqual(["parsing", "planning_layout"]); // no "analyzing" stage: no AI call happened
    // No AI ran, so there's no provider/model/authType to stamp — only what's actually known.
    expect(result.changeSet.metadata).toEqual({ createdBy: "ai", task: "generate_visual_plan", operationId: "op_1" });
  });

  it("a heading-only section (a title above its subsections) is never sent to the model — a model invents content for it", async () => {
    const { runtime, spy } = setup((req) => response(req.task === "generate_visual_plan" ? ARCHITECTURE_PLAN : '{"template":"architecture"}'));
    const result = await visualizeContent(baseInput("# Database migration plan\n\n## Risks\n\nThe lock may last.\n", { template: "architecture" }), runtime, {});
    const prompts = spy.mock.calls.map((c) => c[0]!.prompt);
    expect(prompts).toHaveLength(1); // only "Risks"
    expect(prompts[0]).toContain("The lock may last.");
    expect(result.changeSet.changes.some((c) => c.kind === "create_block" && JSON.stringify(c.content).includes("Database migration plan"))).toBe(true);
  });

  it("a forced template always goes through AI, even when the local tier would have been sufficient", async () => {
    const { runtime, spy } = setup((req) => response(req.task === "generate_visual_plan" ? ARCHITECTURE_PLAN : '{"template":"architecture"}'));
    const result = await visualizeContent(baseInput("# Launch\n\n- [ ] Ship it\n", { template: "architecture" }), runtime, {});
    expect(spy).toHaveBeenCalledTimes(1); // select_template skipped: the template was forced
    expect(spy.mock.calls[0]![0]!.task).toBe("generate_visual_plan");
    expect(result.usedLocalTier).toBe(false);
  });
});

function setupWithProviderId(id: string, respond: (req: AIRequest) => AIResponse | Promise<AIResponse>) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  manager.registerProvider(createMockProvider({ id, respond }));
  manager.setPrimary(id);
  return createAIRuntime({ manager, registry });
}

describe("visualizeContent — AI tier", () => {
  it("stamps authType too, from the connection's own descriptor, when the provider id is a real one", async () => {
    const runtime = setupWithProviderId("copilot", (req) => response(req.task === "outline_document" ? ONE_SECTION_OUTLINE : ARCHITECTURE_PLAN));
    const result = await visualizeContent(baseInput("Our system has a web client that depends on an API."), runtime, {});
    expect(result.changeSet.metadata).toMatchObject({ provider: "copilot", authType: "subscription" });
  });


  it("outlines the content (even a single section), then generates it, and stamps provenance from the generation call", async () => {
    const { runtime, spy } = setup((req) => response(req.task === "outline_document" ? ONE_SECTION_OUTLINE : ARCHITECTURE_PLAN));
    const progress: VisualizeProgress[] = [];
    const result = await visualizeContent(baseInput("Our system has a web client that depends on an API."), runtime, {
      onProgress: (p) => progress.push(p),
    });
    expect(spy.mock.calls.map((c) => c[0]!.task)).toEqual(["outline_document", "generate_visual_plan"]);
    expect(result.usedLocalTier).toBe(false);
    expect(result.provenance).toMatchObject({ providerId: "mock", role: "primary", model: "model-x" });
    // The three stages, in order; within a stage the label says which step is running.
    expect(progress.map((p) => p.stage).filter((s, i, all) => s !== all[i - 1])).toEqual(["parsing", "analyzing", "planning_layout"]);
    const labels = progress.map((p) => p.label);
    expect(labels).toContain("Outlining the document…");
    expect(labels.some((l) => /^Analyzing “.+”…$/.test(l))).toBe(true);
    expect(labels.at(-1)).toBe("Drawing the canvas…");
    // One section: its frame (and title), holding the plan's two components.
    const shapes = result.changeSet.changes.filter((c) => c.kind === "create_shape");
    expect(shapes).toHaveLength(2);
    expect(result.changeSet.changes.filter((c) => c.kind === "create_frame")).toHaveLength(1);
    // Provider/model come from the *actual* call that served the request — never guessed upfront by the caller.
    expect(result.changeSet.metadata).toEqual({ createdBy: "ai", task: "generate_visual_plan", operationId: "op_1", provider: "mock", model: "model-x" });
  });

  it("passes a text/page-containing plan's Markdown through the injected parser (F30's real one is lazy-loaded and needs a browser)", async () => {
    const plan = JSON.stringify({
      version: 1,
      template: "action_plan",
      nodes: [
        { id: "n1", type: "text", content: { markdown: "**Owner:** payments" } },
        { id: "n2", type: "page", content: { title: "Runbook", markdown: "Steps" } },
        { id: "a1", type: "text", origin: "analysis", content: { markdown: "Payments owns the runbook." } },
      ],
      relationships: [],
      metadata: { takeaway: "Payments owns it" },
    });
    const { runtime } = setup((req) => response(req.task === "outline_document" ? ONE_SECTION_OUTLINE : plan));
    const result = await visualizeContent(baseInput("Owner: payments. Runbook steps."), runtime, { parseMarkdown: stubMarkdown });
    // The section's frame title and takeaway, then the plan's text, page and analysis.
    const created = result.changeSet.changes.filter((c) => c.kind === "create_block" || c.kind === "create_page");
    expect(created).toHaveLength(5);
    expect(JSON.stringify(created)).toContain("parsed:**Owner:** payments");
    expect(JSON.stringify(created)).toContain("parsed:Steps");
  });

  it("carries F29's validation warnings through to the result", async () => {
    const withBadRelationship = JSON.stringify({
      version: 1,
      template: "flow",
      nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: "Only node" } }],
      relationships: [{ from: "n1", to: "ghost", type: "relates_to" }],
    });
    const { runtime } = setup((req) => response(req.task === "outline_document" ? ONE_SECTION_OUTLINE : withBadRelationship));
    const result = await visualizeContent(baseInput("A single step."), runtime, {});
    expect(result.warnings.join()).toMatch(/refers to a node that isn't in the plan/);
  });
});

describe("visualizeContent — no provider configured", () => {
  it("throws NoProviderConfiguredError, noting whether local-only recourse exists", async () => {
    const runtime = noProviderRuntime();
    await expect(visualizeContent(baseInput("Some prose with no explicit structure at all, just sentences."), runtime, {})).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(NoProviderConfiguredError);
      expect((err as NoProviderConfiguredError).canUseLocalTier).toBe(true); // prose still gets a fallback text-block plan
      return true;
    });
  });

  it("forceLocalOnly then uses the local tier even with nothing configured, and needs no AI task at all", async () => {
    const runtime = noProviderRuntime();
    const result = await visualizeContent(baseInput("Prose with no structure.", { forceLocalOnly: true }), runtime, {});
    expect(result.usedLocalTier).toBe(true);
  });

  it("forceLocalOnly with truly nothing to build from throws NothingToVisualizeLocallyError", async () => {
    const runtime = noProviderRuntime();
    await expect(visualizeContent(baseInput("   ", { forceLocalOnly: true }), runtime, {})).rejects.toBeInstanceOf(NothingToVisualizeLocallyError);
  });
});

describe("visualizeContent — errors that must surface, not get swallowed", () => {
  it("an auth failure from the configured provider propagates as is", async () => {
    const { runtime } = setup(() => {
      throw new AIError("auth", "Auth failed");
    });
    await expect(visualizeContent(baseInput("Text needing AI analysis, no structure here."), runtime, {})).rejects.toMatchObject({ kind: "auth" });
  });

  it("an unusable AI reply (invalid after one repair retry) surfaces as invalid_output", async () => {
    const { runtime } = setup(() => response("not JSON at all, and no template field either"));
    await expect(visualizeContent(baseInput("Text needing AI analysis, no structure here."), runtime, {})).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("content over the hard limit is refused before any AI call", async () => {
    const { runtime, spy } = setup(() => response("x"));
    await expect(visualizeContent(baseInput("x".repeat(200_001)), runtime, {})).rejects.toThrow(/limit is 200,000/);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("visualizeContent — cancellation", () => {
  it("cancelling mid-flight rejects and never reaches the render stage", async () => {
    const { runtime } = setup(() => response('{"template":"architecture"}'), { delayMs: 30 });
    const controller = new AbortController();
    const stages: string[] = [];
    const run = visualizeContent(baseInput("Text needing AI analysis, no structure here."), runtime, { signal: controller.signal, onProgress: (p) => stages.push(p.stage) });
    setTimeout(() => controller.abort(), 5);
    await expect(run).rejects.toMatchObject({ name: "AIError", kind: "cancelled" });
    expect(stages).not.toContain("planning_layout");
  });
});

describe("visualizeContent — content source (F37)", () => {
  it("every run starts a content source at version 1 and links every created object to it by a stable key", async () => {
    const { runtime } = setup(() => response("never"));
    const text = "# Launch\n\n- [ ] Ship it\n\n## Risks\n\nTimeouts.\n";
    const { changeSet } = await visualizeContent(baseInput(text), runtime, {});
    expect(changeSet.contentSource).toMatchObject({ version: 1, origin: "paste", tier: "local", template: "sectioned", text });
    expect(changeSet.contentSource!.sourceId).toMatch(/^src_/);
    // A section's frame is never linked (its title object carries the section's key, F42).
    const creates = changeSet.changes.filter((c) => c.kind.startsWith("create_") && c.kind !== "create_frame");
    expect(creates.length).toBeGreaterThan(0);
    for (const c of creates) expect((c as { stableNodeKey?: string }).stableNodeKey, c.kind).toBeTruthy();
    expect(() => parseChangeSet(changeSet)).not.toThrow();
  });

  it("the AI tier analyses one unit (section) per call and namespaces keys by unit", async () => {
    const plan = (label: string) => JSON.stringify({ version: 1, template: "architecture", nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label } }], relationships: [] });
    const { runtime, spy } = setup((req) => response(plan(req.prompt.includes("Part B") ? "B" : "A")));
    const text = "Prose about the system with no explicit structure.\n\n## Part A\n\nMore prose.\n\n## Part B\n\nEven more prose.";
    const { changeSet } = await visualizeContent(baseInput(text, { template: "architecture" }), runtime, {});
    const generations = spy.mock.calls.map((c) => c[0]!).filter((r) => r.task === "generate_visual_plan");
    expect(generations).toHaveLength(3); // (lead), Part A, Part B
    expect(changeSet.contentSource).toMatchObject({ tier: "ai", template: "architecture" });
    const keys = changeSet.changes.flatMap((c) => ("stableNodeKey" in c && c.stableNodeKey ? [c.stableNodeKey] : []));
    // Each section is framed (F42); its title object carries the section's own key.
    expect(keys).toEqual(["Part A § group#0", "Part B § group#0", "(lead) § shape#0", "Part A § shape#0", "Part B § shape#0"]);
    // Frame labels say position and kind (none here); the section names are their title blocks, keyed above.
    expect(changeSet.changes.filter((c) => c.kind === "create_frame").map((c) => (c as { title: string }).title)).toEqual(["1 · Section", "2 · Section"]);
  });
});
