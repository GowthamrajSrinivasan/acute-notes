import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIError } from "../errors";
import { AIProviderManager } from "../providerManager";
import { createMockProvider } from "../providers/mock/mockProvider";
import { createAIRuntime } from "../runtime";
import { createTaskRegistry } from "../tasks";
import type { DecisionProvider, DecisionTask } from "../decisions/types";
import { createCallLog, estimateCost, noteOf, stageOf, summarizeCalls, type CallRecord } from "./callLog";

const rec = (over: Partial<CallRecord>): CallRecord => ({ task: "generate_visual_plan", source: "chat", role: "primary", provider: "p", model: "m", attempt: 1, outcome: "ok", ms: 10, at: 0, ...over });

describe("call log pricing and summary", () => {
  it("prices at the benchmark's list prices: Run 4's first-chat plan calls come to about $0.106, its Jev decides about $0.034", () => {
    expect(estimateCost({ source: "chat", promptTokens: 108_000, completionTokens: 29_000 })).toBeCloseTo(0.1049, 3);
    expect(estimateCost({ source: "decision", promptTokens: 799_000 })).toBeCloseTo(0.0336, 3);
  });

  it("groups by stage, most expensive first, and counts outcomes, retries, fallbacks and calls with no usage report", () => {
    const { stages, total } = summarizeCalls([
      rec({ promptTokens: 1000, completionTokens: 2000 }),
      rec({ outcome: "invalid", promptTokens: 1000, completionTokens: 100 }),
      rec({ attempt: 2, role: "fallback", promptTokens: 1000, completionTokens: 2000, reasoningTokens: 50 }),
      rec({ task: "generate_section_analysis", promptTokens: 500, completionTokens: 570 }),
      rec({ task: "assign_to_topics", source: "decision", role: "decision", promptTokens: 10_000 }),
      rec({ task: "assign_to_topics", source: "decision", role: "decision", outcome: "unsure", ms: 0 }),
      rec({ task: "outline_document" }),
    ]);
    expect(stages.map((s) => s.stage)).toEqual(["plan", "analysis_patch", "assignment (decision)", "outline"]);
    expect(stages[0]).toMatchObject({ calls: 3, ok: 2, invalid: 1, retries: 1, fallbackCalls: 1, promptTokens: 3000, completionTokens: 4100, reasoningTokens: 50 });
    expect(stages[2]).toMatchObject({ calls: 2, unsure: 1, unreported: 0 });
    expect(stages[3]).toMatchObject({ unreported: 1 });
    expect(total.calls).toBe(7);
    expect(total.estimatedUsd).toBeCloseTo(stages.reduce((n, s) => n + s.estimatedUsd, 0), 10);
  });

  it("names a decision-model call for the chat task it replaces", () => {
    expect(stageOf({ task: "find_revisions", source: "decision" })).toBe("revisions (decision)");
    expect(stageOf({ task: "something_new", source: "chat" })).toBe("something_new");
  });

  it("notes what a plan call and an analysis patch were, from the request alone, and splits the stage by it", () => {
    const plan = (over: object) => noteOf("generate_visual_plan", { template: "sectioned", text: "x", ...over });
    expect([plan({}), plan({ part: { index: 1, total: 2 } }), plan({ appended: true, current: {} }), plan({ current: {} }), plan({ analysisRetry: { missing: ["a takeaway"] } }), plan({ retry: { missing: ["p"] } }), plan({ dense: { reason: "r" } })]).toEqual(["new", "piece", "appended", "update", "analysis_retry", "regenerate", "dense"]);
    const patch = (...missing: string[]) => noteOf("generate_section_analysis", { missing });
    expect(patch("a takeaway")).toBe("takeaway");
    expect(patch("a takeaway", "its own analysis")).toBe("takeaway+analysis");
    expect(patch("an analysis line for D3, D5")).toBe("items");
    expect(patch("a visual structure (shapes and links)")).toBe("structure");
    expect(noteOf("outline_document", { units: [] })).toBeUndefined();
    expect(stageOf({ task: "generate_section_analysis", source: "chat", note: "analysis" })).toBe("analysis_patch:analysis");
    expect(summarizeCalls([rec({ note: "new" }), rec({ note: "analysis_retry" }), rec({ note: "analysis_retry" })]).stages.map((s) => [s.stage, s.calls])).toEqual([["plan:new", 1], ["plan:analysis_retry", 2]]);
  });

  it("keeps only the newest records beyond its limit", () => {
    const log = createCallLog(2);
    for (const task of ["a", "b", "c"]) log.record({ ...rec({}), task });
    expect(log.records().map((r) => r.task)).toEqual(["b", "c"]);
  });
});

describe("AIRuntime reports every provider call to onCall", () => {
  const usage = (extra: object = {}) => ({ provider: "primary", model: "m", promptTokens: 100, completionTokens: 40, ...extra });
  function setup(replies: unknown[], typed: DecisionProvider | null = null, onCallOverride?: (c: Omit<CallRecord, "at">) => void) {
    const calls: Omit<CallRecord, "at">[] = [];
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registry.register({ task: "classify", inputSchema: z.object({ text: z.string() }), outputSchema: z.object({ label: z.string() }), buildPrompt: ({ input }) => ({ prompt: input.text }), policy: {} });
    let i = 0;
    manager.registerProvider(
      createMockProvider({
        id: "primary",
        respond: async () => {
          const next = replies[i++];
          if (next instanceof Error) throw next;
          return { text: "", structured: next, model: "m", finishReason: "stop", usage: usage({ reasoningTokens: 10 }) };
        },
      }),
    );
    manager.setPrimary("primary");
    manager.setTypedDecisionProvider(typed);
    return { runtime: createAIRuntime({ manager, registry, onCall: onCallOverride ?? ((c) => void calls.push(c)) }), calls };
  }

  it("one record for a valid reply, with the reported tokens", async () => {
    const { runtime, calls } = setup([{ label: "x" }]);
    await runtime.run("classify", { text: "x" });
    expect(calls).toEqual([expect.objectContaining({ task: "classify", source: "chat", role: "primary", attempt: 1, outcome: "ok", promptTokens: 100, completionTokens: 40, reasoningTokens: 10 })]);
  });

  it("an invalid reply is an `invalid` record, and its repair call is attempt 2", async () => {
    const { runtime, calls } = setup([{ nope: 1 }, { label: "x" }]);
    await runtime.run("classify", { text: "x" });
    expect(calls.map((c) => [c.attempt, c.outcome])).toEqual([[1, "invalid"], [2, "ok"]]);
  });

  it("a provider error is an `error` record carrying the error kind, and is still thrown", async () => {
    const { runtime, calls } = setup([new AIError("auth", "bad key")]);
    await expect(runtime.run("classify", { text: "x" })).rejects.toMatchObject({ kind: "auth" });
    expect(calls).toEqual([expect.objectContaining({ outcome: "error", error: "auth" })]);
  });

  it("a decision model call is a `decision` record; an unsure answer adds an `unsure` record before the chat fallback", async () => {
    const task: DecisionTask<{ text: string }, { label: string }> = {
      fallbackTask: "classify",
      buildRequest: () => ({ state: "s", questions: { q: { type: "boolean", instructions: "?" } } }),
      interpret: () => null,
    };
    const typed: DecisionProvider = { id: "openrouter", name: "Jev", model: "jev", decide: async () => ({ answers: { q: { type: "boolean", probability: 0.5 } }, usage: { provider: "openrouter", model: "jev", promptTokens: 900 } }) };
    const { runtime, calls } = setup([{ label: "chat" }], typed);
    await runtime.decide(task, { text: "x" });
    expect(calls.map((c) => [c.source, c.outcome, c.promptTokens])).toEqual([["decision", "ok", 900], ["decision", "unsure", undefined], ["chat", "ok", 100]]);
  });

  it("a throwing onCall never breaks the call", async () => {
    const { runtime } = setup([{ label: "x" }], null, () => {
      throw new Error("boom");
    });
    await expect(runtime.run("classify", { text: "x" })).resolves.toMatchObject({ data: { label: "x" } });
  });
});
