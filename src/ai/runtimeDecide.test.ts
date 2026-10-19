import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIError } from "./errors";
import { AIProviderManager } from "./providerManager";
import { createMockProvider } from "./providers/mock/mockProvider";
import { createAIRuntime } from "./runtime";
import { createTaskRegistry } from "./tasks";
import type { DecisionProvider, DecisionResult, DecisionTask } from "./decisions/types";

const task: DecisionTask<{ text: string }, { label: string }> = {
  fallbackTask: "classify",
  buildRequest: (input) => (input.text === "unaskable" ? null : { state: input.text, questions: { q: { type: "boolean", instructions: "Is it?" } } }),
  interpret: (answers) => (answers.q?.type === "boolean" && answers.q.probability >= 0.8 ? { label: "typed" } : null),
};
const answer = (probability: number): DecisionResult => ({ answers: { q: { type: "boolean", probability } }, usage: { provider: "openrouter", model: "jev" } });

function setup(typed: DecisionProvider | null, extra: { onUsage?: (u: unknown) => void; isEnabled?: () => boolean } = {}) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registry.register({
    task: "classify",
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.object({ label: z.string() }),
    buildPrompt: ({ input }) => ({ prompt: input.text }),
    policy: {},
  });
  manager.registerProvider(
    createMockProvider({ id: "primary", respond: async () => ({ text: "", structured: { label: "chat" }, model: "m", finishReason: "stop", usage: { provider: "primary", model: "m" } }) }),
  );
  manager.setPrimary("primary");
  manager.setTypedDecisionProvider(typed);
  return createAIRuntime({ manager, registry, ...extra });
}
const provider = (decide: DecisionProvider["decide"]): DecisionProvider => ({ id: "openrouter", name: "Jev", model: "typesafe/jev-1.13", decide });

describe("AIRuntime.decide — a typed decision model, with the chat task as the fallback", () => {
  it("uses the typed decision model when one is enabled and it is sure, and records its usage", async () => {
    const onUsage = vi.fn();
    const result = await setup(provider(async () => answer(0.95)), { onUsage }).decide(task, { text: "x" });
    expect(result).toMatchObject({ data: { label: "typed" }, providerId: "openrouter", role: "decision" });
    expect(onUsage).toHaveBeenCalledWith({ provider: "openrouter", model: "jev" });
  });

  it("with no typed decision model, the chat task answers: nobody is blocked", async () => {
    const result = await setup(null).decide(task, { text: "x" });
    expect(result).toMatchObject({ data: { label: "chat" }, providerId: "primary" });
  });

  it("falls back to the chat task when the typed model isn't sure, fails, or can't express the question", async () => {
    expect((await setup(provider(async () => answer(0.4))).decide(task, { text: "x" })).data).toEqual({ label: "chat" });
    const failing = vi.fn(async () => Promise.reject(new AIError("auth", "bad key")));
    expect((await setup(provider(failing)).decide(task, { text: "x" })).data).toEqual({ label: "chat" });
    const never = vi.fn(async () => answer(0.99));
    expect((await setup(provider(never)).decide(task, { text: "unaskable" })).data).toEqual({ label: "chat" });
    expect(never).not.toHaveBeenCalled();
  });

  it("a cancelled call is cancelled, not answered by the fallback; AI mode off refuses before anything is asked", async () => {
    const cancelling = provider(async () => Promise.reject(new AIError("cancelled", "stop")));
    await expect(setup(cancelling).decide(task, { text: "x" })).rejects.toMatchObject({ kind: "cancelled" });
    const asked = vi.fn(async () => answer(0.99));
    await expect(setup(provider(asked), { isEnabled: () => false }).decide(task, { text: "x" })).rejects.toMatchObject({ kind: "disabled" });
    expect(asked).not.toHaveBeenCalled();
  });
});
