import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIError } from "./errors";
import { AIProviderManager } from "./providerManager";
import { createMockProvider } from "./providers/mock/mockProvider";
import { createAIRuntime } from "./runtime";
import { createTaskRegistry, type TaskDefinition } from "./tasks";
import type { AIResponse } from "./types";

const outputSchema = z.object({ label: z.string() });
type Input = { text: string };
type Output = z.infer<typeof outputSchema>;

function classifyTask(overrides: Partial<TaskDefinition<Input, Output>> = {}): TaskDefinition<Input, Output> {
  return {
    task: "classify",
    inputSchema: z.object({ text: z.string() }),
    outputSchema,
    buildPrompt: ({ input, repairFeedback }) => ({
      prompt: repairFeedback ? `${input.text}\n${repairFeedback}` : input.text,
    }),
    policy: {},
    ...overrides,
  };
}

function okResponse(label: string): AIResponse {
  return { text: "", structured: { label }, model: "m", finishReason: "stop", usage: { provider: "p", model: "m" } };
}

function setup() {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  const runtime = createAIRuntime({ manager, registry });
  return { manager, registry, runtime };
}

describe("AIRuntime.run", () => {
  it("returns the primary provider's validated result", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    manager.registerProvider(createMockProvider({ id: "primary", respond: async () => okResponse("a") }));
    manager.setPrimary("primary");

    const result = await runtime.run<Input, Output>("classify", { text: "x" });
    expect(result).toMatchObject({ data: { label: "a" }, providerId: "primary", role: "primary" });
  });

  it("[no decision model] falls straight to primary when the task prefers a decision model but none is configured", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask({ policy: { preferDecisionModel: true } }));
    manager.registerProvider(createMockProvider({ id: "primary", respond: async () => okResponse("a") }));
    manager.setPrimary("primary");

    const result = await runtime.run<Input, Output>("classify", { text: "x" });
    expect(result.role).toBe("primary");
  });

  it("[decision-model error] discards a decision-model failure and falls through to primary silently", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask({ policy: { preferDecisionModel: true } }));
    const decisionRespond = vi.fn(async () => {
      throw new AIError("timeout", "decision model timed out");
    });
    manager.registerProvider(createMockProvider({ id: "decision", respond: decisionRespond }));
    manager.setDecisionModel("decision");
    manager.registerProvider(createMockProvider({ id: "primary", respond: async () => okResponse("a") }));
    manager.setPrimary("primary");

    const result = await runtime.run<Input, Output>("classify", { text: "x" });
    expect(decisionRespond).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ providerId: "primary", role: "primary" });
  });

  it("[primary failure, fallback off] rejects with the primary's error", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    manager.registerProvider(
      createMockProvider({
        id: "primary",
        respond: async () => {
          throw new AIError("network", "primary unreachable");
        },
      }),
    );
    manager.setPrimary("primary");

    await expect(runtime.run<Input, Output>("classify", { text: "x" })).rejects.toMatchObject({ kind: "network" });
  });

  it("[primary failure, fallback on] uses the explicit fallback", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    manager.registerProvider(
      createMockProvider({
        id: "primary",
        respond: async () => {
          throw new AIError("network", "primary unreachable");
        },
      }),
    );
    manager.setPrimary("primary");
    manager.registerProvider(createMockProvider({ id: "fallback", respond: async () => okResponse("b") }));
    manager.setFallback("fallback");

    const result = await runtime.run<Input, Output>("classify", { text: "x" });
    expect(result).toMatchObject({ providerId: "fallback", role: "fallback" });
  });

  it("does not use the fallback for a non-availability error", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    manager.registerProvider(
      createMockProvider({
        id: "primary",
        respond: async () => {
          throw new Error("weird unmapped failure");
        },
      }),
    );
    manager.setPrimary("primary");
    const fallbackRespond = vi.fn(async () => okResponse("b"));
    manager.registerProvider(createMockProvider({ id: "fallback", respond: fallbackRespond }));
    manager.setFallback("fallback");

    await expect(runtime.run<Input, Output>("classify", { text: "x" })).rejects.toThrow("weird unmapped failure");
    expect(fallbackRespond).not.toHaveBeenCalled();
  });

  it("repairs an invalid structured response once and returns the corrected result", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    let calls = 0;
    manager.registerProvider(
      createMockProvider({
        id: "primary",
        respond: async (request) => {
          calls += 1;
          if (calls === 1) {
            return { text: "not json", model: "m", finishReason: "stop", usage: { provider: "p", model: "m" } };
          }
          expect(request.prompt).toContain("invalid");
          return okResponse("fixed");
        },
      }),
    );
    manager.setPrimary("primary");

    const result = await runtime.run<Input, Output>("classify", { text: "x" });
    expect(calls).toBe(2);
    expect(result.data).toEqual({ label: "fixed" });
  });

  it("gives up with a typed invalid_output failure after the repair retry is also invalid", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    manager.registerProvider(
      createMockProvider({
        id: "primary",
        respond: async () => ({ text: "still not json", model: "m", finishReason: "stop", usage: { provider: "p", model: "m" } }),
      }),
    );
    manager.setPrimary("primary");

    await expect(runtime.run<Input, Output>("classify", { text: "x" })).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("rejects immediately on an already-cancelled signal without calling the provider", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    const respond = vi.fn(async () => okResponse("a"));
    manager.registerProvider(createMockProvider({ id: "primary", respond }));
    manager.setPrimary("primary");

    const controller = new AbortController();
    controller.abort();

    await expect(runtime.run<Input, Output>("classify", { text: "x" }, { signal: controller.signal })).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(respond).not.toHaveBeenCalled();
  });

  it("cancellation mid-flight leaves no partial state — no repair retry, no fallback", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    const controller = new AbortController();
    manager.registerProvider(createMockProvider({ id: "primary", delayMs: 20, respond: async () => okResponse("a") }));
    manager.setPrimary("primary");
    const fallbackRespond = vi.fn(async () => okResponse("b"));
    manager.registerProvider(createMockProvider({ id: "fallback", respond: fallbackRespond }));
    manager.setFallback("fallback");

    const promise = runtime.run<Input, Output>("classify", { text: "x" }, { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: "cancelled" });
    expect(fallbackRespond).not.toHaveBeenCalled();
  });

  it("throws model_unavailable when no provider is configured at all", async () => {
    const { registry, runtime } = setup();
    registry.register(classifyTask());
    await expect(runtime.run<Input, Output>("classify", { text: "x" })).rejects.toMatchObject({ kind: "model_unavailable" });
  });

  it("[AI mode Off] refuses before resolving any provider — zero provider calls", async () => {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    const runtime = createAIRuntime({ manager, registry, isEnabled: () => false });
    registry.register(classifyTask());
    const respond = vi.fn(async () => okResponse("a"));
    manager.registerProvider(createMockProvider({ id: "primary", respond }));
    manager.setPrimary("primary");

    await expect(runtime.run<Input, Output>("classify", { text: "x" })).rejects.toMatchObject({ kind: "disabled" });
    expect(respond).not.toHaveBeenCalled();
  });

  it("parses a JSON object wrapped in a ```json fence", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    manager.registerProvider(
      createMockProvider({
        id: "primary",
        respond: async () => ({ text: '```json\n{"label":"a"}\n```', model: "m", finishReason: "stop", usage: { provider: "p", model: "m" } }),
      }),
    );
    manager.setPrimary("primary");
    await expect(runtime.run<Input, Output>("classify", { text: "x" })).resolves.toMatchObject({ data: { label: "a" } });
  });
});

describe("AIRuntime.run — text tasks", () => {
  const textTask: TaskDefinition<Input, string> = {
    task: "summarize",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.string().min(1),
    outputFormat: "text",
    buildPrompt: ({ input }) => ({ prompt: input.text }),
    policy: {},
  };
  const textResponse = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "p", model: "m" } });

  it("validates the raw text without JSON parsing (a JSON-looking reply stays text)", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(textTask);
    manager.registerProvider(createMockProvider({ id: "primary", respond: async () => textResponse("42") }));
    manager.setPrimary("primary");
    await expect(runtime.run<Input, string>("summarize", { text: "x" })).resolves.toMatchObject({ data: "42" });
  });

  it("streams through onText when the provider supports it, resolving with the full text", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(textTask);
    const respond = vi.fn(async () => textResponse("unused"));
    manager.registerProvider(createMockProvider({ id: "primary", respond, streamChunks: () => ["Hel", "lo"] }));
    manager.setPrimary("primary");
    const seen: string[] = [];

    const result = await runtime.run<Input, string>("summarize", { text: "x" }, { onText: (t) => seen.push(t) });
    expect(seen).toEqual(["Hel", "Hello"]);
    expect(result).toMatchObject({ data: "Hello", providerId: "primary" });
    expect(respond).not.toHaveBeenCalled();
  });

  it("uses generate (no streaming) when no onText is given", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(textTask);
    manager.registerProvider(createMockProvider({ id: "primary", respond: async () => textResponse("whole"), streamChunks: () => ["part"] }));
    manager.setPrimary("primary");
    await expect(runtime.run<Input, string>("summarize", { text: "x" })).resolves.toMatchObject({ data: "whole" });
  });

  it("never streams a JSON task, even with onText", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(classifyTask());
    const onText = vi.fn();
    manager.registerProvider(createMockProvider({ id: "primary", respond: async () => okResponse("a"), streamChunks: () => ["{"] }));
    manager.setPrimary("primary");
    await expect(runtime.run<Input, Output>("classify", { text: "x" }, { onText })).resolves.toMatchObject({ data: { label: "a" } });
    expect(onText).not.toHaveBeenCalled();
  });

  it("cancelling mid-stream rejects with cancelled", async () => {
    const { manager, registry, runtime } = setup();
    registry.register(textTask);
    const controller = new AbortController();
    manager.registerProvider(
      createMockProvider({ id: "primary", delayMs: 10, respond: async () => textResponse("x"), streamChunks: () => ["a", "b", "c"] }),
    );
    manager.setPrimary("primary");
    const promise = runtime.run<Input, string>("summarize", { text: "x" }, { signal: controller.signal, onText: () => controller.abort() });
    await expect(promise).rejects.toMatchObject({ kind: "cancelled" });
  });
});

describe("AIRuntime usage reporting", () => {
  it("reports every provider response's usage, the repair retry included", async () => {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    const onUsage = vi.fn();
    const runtime = createAIRuntime({ manager, registry, onUsage });
    registry.register(classifyTask());
    let calls = 0;
    manager.registerProvider(
      createMockProvider({
        id: "primary",
        respond: async () => (++calls === 1 ? { ...okResponse("a"), structured: { wrong: true } } : okResponse("b")),
      }),
    );
    manager.setPrimary("primary");

    await runtime.run<Input, Output>("classify", { text: "x" });
    expect(onUsage).toHaveBeenCalledTimes(2);
    expect(onUsage).toHaveBeenCalledWith({ provider: "p", model: "m" });
  });

  it("reports nothing for a request that failed before any response", async () => {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    const onUsage = vi.fn();
    const runtime = createAIRuntime({ manager, registry, onUsage });
    registry.register(classifyTask());
    manager.registerProvider(
      createMockProvider({
        id: "primary",
        respond: async () => {
          throw new AIError("auth", "bad key");
        },
      }),
    );
    manager.setPrimary("primary");

    await expect(runtime.run<Input, Output>("classify", { text: "x" })).rejects.toThrow("bad key");
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe("AIRuntime.run — tasks that fan out (limitConcurrency)", () => {
  function fanOut(deps: { maxConcurrent?: number; rateLimitBackoffMs?: number[] }, respond: () => Promise<AIResponse>) {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registry.register(classifyTask({ policy: { limitConcurrency: true } }));
    manager.registerProvider(createMockProvider({ id: "primary", respond }));
    manager.setPrimary("primary");
    return createAIRuntime({ manager, registry, ...deps });
  }

  it("runs at most maxConcurrent calls at once, and all of them complete", async () => {
    let active = 0;
    let peak = 0;
    const runtime = fanOut({ maxConcurrent: 2 }, async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return okResponse("a");
    });
    const results = await Promise.all(Array.from({ length: 6 }, () => runtime.run<Input, Output>("classify", { text: "x" })));
    expect(results).toHaveLength(6);
    expect(peak).toBe(2);
  });

  it("retries a rate-limited call after a pause, on the same provider", async () => {
    let calls = 0;
    const runtime = fanOut({ rateLimitBackoffMs: [1] }, async () => {
      if (calls++ === 0) throw new AIError("rate_limited", "slow down");
      return okResponse("a");
    });
    const result = await runtime.run<Input, Output>("classify", { text: "x" });
    expect(result).toMatchObject({ data: { label: "a" }, providerId: "primary" });
    expect(calls).toBe(2);
  });

  it("gives up on a call that stays rate limited, with the provider's own error", async () => {
    const runtime = fanOut({ rateLimitBackoffMs: [1, 1] }, async () => {
      throw new AIError("rate_limited", "slow down");
    });
    await expect(runtime.run<Input, Output>("classify", { text: "x" })).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("a call waiting for a slot is cancelled by its signal", async () => {
    const runtime = fanOut({ maxConcurrent: 1 }, () => new Promise<AIResponse>((r) => setTimeout(() => r(okResponse("a")), 30)));
    const first = runtime.run<Input, Output>("classify", { text: "x" });
    const controller = new AbortController();
    const second = runtime.run<Input, Output>("classify", { text: "y" }, { signal: controller.signal });
    controller.abort();
    await expect(second).rejects.toMatchObject({ kind: "cancelled" });
    await expect(first).resolves.toMatchObject({ data: { label: "a" } });
  });
});
