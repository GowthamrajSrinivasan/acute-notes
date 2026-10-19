import { describe, expect, it, vi } from "vitest";
import type { SelectionContext } from "@/ai/context/selectionContext";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import {
  effectiveScope,
  getSelectionAction,
  runChat,
  suggestionsFor,
  provenanceMetadata,
  runSelectionAction,
  SELECTION_ACTIONS,
  tasksToContent,
  unwrapMarkdownFence,
  type SelectionActionId,
} from "./actions";
import { registerSelectionTasks } from "./selectionTasks";

const context: SelectionContext = {
  scope: "selection",
  workspaceId: "ws",
  canvasId: "cv",
  selectedObjectIds: ["b1"],
  items: [
    { id: "b1", kind: "text", text: "Checkout payment retries", onCanvas: true },
    { id: "b2", kind: "text", text: "Payment gateway alerts", onCanvas: true },
  ],
  nearby: [],
  relations: [],
  truncated: false,
};

const response = (text: string): AIResponse => ({ text, model: "model-x", finishReason: "stop", usage: { provider: "mock", model: "model-x" } });

function setup(respond: (req: AIRequest) => AIResponse | Promise<AIResponse>, extra: { delayMs?: number; enabled?: () => boolean; streamChunks?: () => string[] } = {}) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerSelectionTasks(registry);
  const spy = vi.fn(respond);
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy, delayMs: extra.delayMs, streamChunks: extra.streamChunks }));
  manager.setPrimary("mock");
  const runtime = createAIRuntime({ manager, registry, isEnabled: extra.enabled });
  return { runtime, spy };
}

describe("runSelectionAction", () => {
  it.each<[SelectionActionId, string, string]>([
    ["explain", "generate_note", "Explanation"],
    ["summarize", "summarize", "Summary"],
    ["create_test_cases", "generate_note", "Test cases"],
    ["create_plan", "generate_note", "Plan"],
  ])("%s runs the %s task and returns a note", async (actionId, task, title) => {
    const { runtime, spy } = setup(() => response("Some **markdown**"));
    const result = await runSelectionAction(runtime, actionId, context);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toMatchObject({ task });
    // Structured content reaches the model, not a screenshot.
    expect(spy.mock.calls[0]![0].prompt).toContain("Checkout payment retries");
    expect(result).toMatchObject({ kind: "note", title, markdown: "Some **markdown**", provenance: { task, providerId: "mock", role: "primary", model: "model-x" } });
  });

  it("turn_into_tasks runs transform_note and returns validated tasks", async () => {
    const { runtime, spy } = setup(() => response('{"title":"Payments","tasks":[{"text":"Add retry limit"},{"text":"Alert on failures"}]}'));
    const result = await runSelectionAction(runtime, "turn_into_tasks", context);
    expect(spy.mock.calls[0]![0]).toMatchObject({ task: "transform_note" });
    expect(result).toMatchObject({ kind: "tasks", title: "Payments", tasks: ["Add retry limit", "Alert on failures"] });
  });

  it("find_related is local: no AI call at all", async () => {
    const { runtime, spy } = setup(() => response("x"));
    const result = await runSelectionAction(runtime, "find_related", { ...context, scope: "canvas" });
    expect(spy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ kind: "related", matches: [{ item: { id: "b2" } }] });
  });

  it("visualize is available in the menu, but never dispatched through runSelectionAction (F31 opens its own dialog)", async () => {
    const { runtime } = setup(() => response("x"));
    expect(getSelectionAction("visualize").available).toBe(true);
    await expect(runSelectionAction(runtime, "visualize", context)).rejects.toThrow(/Visualize dialog/);
  });

  it("cancel mid-request rejects with cancelled and yields no result", async () => {
    const { runtime } = setup(() => response("late"), { delayMs: 30 });
    const controller = new AbortController();
    const onResult = vi.fn();
    const promise = runSelectionAction(runtime, "summarize", context, { signal: controller.signal }).then(onResult);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ kind: "cancelled" });
    expect(onResult).not.toHaveBeenCalled();
  });

  it("with AI mode Off, refuses and makes zero provider calls", async () => {
    const { runtime, spy } = setup(() => response("x"), { enabled: () => false });
    await expect(runSelectionAction(runtime, "summarize", context)).rejects.toMatchObject({ kind: "disabled" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("streams text actions into onText and still resolves with the final note", async () => {
    const { runtime } = setup(() => response("unused"), { streamChunks: () => ["## A", "\nB"] });
    const previews: string[] = [];
    const result = await runSelectionAction(runtime, "explain", context, { onText: (t) => previews.push(t) });
    expect(previews).toEqual(["## A", "## A\nB"]);
    expect(result).toMatchObject({ kind: "note", markdown: "## A\nB" });
  });

  it("repairs an invalid tasks reply once, then fails with invalid_output", async () => {
    const { runtime, spy } = setup(() => response('{"title":"x","tasks":[]}'));
    await expect(runSelectionAction(runtime, "turn_into_tasks", context)).rejects.toMatchObject({ kind: "invalid_output" });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("runChat", () => {
  it("runs the chat task with the context, bounded history and the new message", async () => {
    const { runtime, spy } = setup(() => response("Because retries are idempotent."));
    const result = await runChat(runtime, {
      context,
      scope: "selection",
      history: [
        { role: "user", text: "Summarize" },
        { role: "assistant", text: "It adds retries." },
      ],
      message: "Why is that safe?",
    });
    const req = spy.mock.calls[0]![0];
    expect(req.task).toBe("chat");
    expect(req.prompt).toContain("Checkout payment retries");
    expect(req.prompt).toContain("User: Summarize");
    expect(req.prompt).toContain("Assistant: It adds retries.");
    expect(req.prompt.trim().includes("User: Why is that safe?")).toBe(true);
    expect(result).toMatchObject({ kind: "note", title: "Answer", markdown: "Because retries are idempotent.", provenance: { task: "chat", providerId: "mock" } });
  });

  it("says so when the conversation's objects are gone", async () => {
    const { runtime, spy } = setup(() => response("ok"));
    await runChat(runtime, { context: null, scope: "selection", history: [], message: "Still there?" });
    expect(spy.mock.calls[0]![0].prompt).toContain("no longer on the canvas");
  });
});

describe("selection action helpers", () => {
  it("lists the PRD menu in order", () => {
    expect(SELECTION_ACTIONS.map((a) => a.label)).toEqual([
      "Explain",
      "Summarize",
      "Visualize",
      "Update from new content", // F39: shown only for objects made from a content source
      "Update from ChatGPT chats", // shown only for objects made from a content source; opens Merge into existing notes
      "Re-arrange layout", // shown only for objects made from a content source; local, no AI
      "Re-visualize with AI", // shown only for objects made from a content source
      "Find related items",
      "Turn into tasks",
      "Create test cases",
      "Create plan",
    ]);
  });

  it("falls back to an action's narrowest supported scope", () => {
    expect(effectiveScope(getSelectionAction("find_related"), "selection")).toBe("canvas");
    expect(effectiveScope(getSelectionAction("find_related"), "workspace")).toBe("workspace");
    expect(effectiveScope(getSelectionAction("summarize"), "workspace")).toBe("workspace");
  });

  it("unwraps a whole-reply Markdown fence but keeps inner code blocks", () => {
    expect(unwrapMarkdownFence("```markdown\n# Hi\n```")).toBe("# Hi");
    expect(unwrapMarkdownFence("Intro\n```ts\nx\n```")).toBe("Intro\n```ts\nx\n```");
  });

  it("maps tasks to todo content and provenance to metadata.ai", () => {
    expect(tasksToContent("T", ["a"])).toEqual([
      { type: "heading", props: { level: 3 }, content: "T" },
      { type: "checkListItem", props: { checked: false }, content: "a" },
    ]);
    expect(provenanceMetadata({ task: "summarize", providerId: "p", role: "primary", model: "m", operationId: "op_1" })).toEqual({
      createdBy: "ai",
      task: "summarize",
      provider: "p",
      model: "m",
      operationId: "op_1",
    });
    // Known connections also record how they are paid for / signed in to (F25).
    expect(provenanceMetadata({ task: "chat", providerId: "copilot", role: "primary", model: "m", operationId: "op_2" })).toMatchObject({ provider: "copilot", authType: "subscription" });
    expect(provenanceMetadata({ task: "chat", providerId: "openai", role: "primary", model: "m", operationId: "op_3" })).toMatchObject({ authType: "api_key" });
  });
});

describe("suggestionsFor", () => {
  const item = (kind: string, title?: string, text = "Body") => ({ kind, title, text });

  it("phrases three suggestions around a single selected object", () => {
    expect(suggestionsFor([item("text", "Checkout revamp")], "selection").map((s) => s.label)).toEqual([
      "Explain “Checkout revamp”",
      "Turn “Checkout revamp” into tasks",
      "Create a plan for “Checkout revamp”",
    ]);
  });

  it("adapts to the kind of block", () => {
    expect(suggestionsFor([item("code", "chargeWithRetry")], "selection").map((s) => s.actionId)).toEqual(["explain", "create_test_cases", "create_plan"]);
    expect(suggestionsFor([item("todo", "Launch checklist")], "selection")[0]!.label).toBe("Summarize progress on “Launch checklist”");
    expect(suggestionsFor([item("table", "Endpoints")], "selection").map((s) => s.actionId)).toContain("create_test_cases");
  });

  it("names several objects by count and falls back to the first line of untitled content", () => {
    expect(suggestionsFor([item("text"), item("shape")], "selection")[0]!.label).toBe("Explain the 2 selected objects");
    expect(suggestionsFor([item("note", undefined, "# Sticky note\nmore")], "selection")[0]!.label).toBe("Explain “Sticky note”");
  });

  it("offers canvas- or workspace-wide suggestions without a selection scope", () => {
    expect(suggestionsFor([item("text", "x")], "canvas").map((s) => s.label)).toEqual([
      "Summarize this canvas",
      "List the open tasks in this canvas",
      "Create a plan from this canvas",
    ]);
    expect(suggestionsFor([], "workspace")[0]!.label).toBe("Summarize this workspace");
  });
});
