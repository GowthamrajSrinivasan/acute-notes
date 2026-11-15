/** The external execution envelope (§12.33), offline: a fake base fetch, no network. */
import { describe, expect, it, vi } from "vitest";
import { createExecutionEnvelope, type EnvelopeLimits } from "./executionEnvelope";

const LIMITS: EnvelopeLimits = { maxRequests: 3, maxTokens: 3_000, maxUsd: 0.05, price: { input: 1e-7, output: 5e-7 }, templateMargin: 64 };
const URL_ = "https://x.test/v1/chat/completions";
const body = (maxTokens: number | undefined, chars = 400) => JSON.stringify({ model: "m", ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}), messages: [{ role: "system", content: "s".repeat(chars / 2) }, { role: "user", content: "u".repeat(chars / 2) }] });
const reply = (usage?: { prompt_tokens: number; completion_tokens: number }) => new Response(JSON.stringify({ choices: [{ message: { content: "{}" }, finish_reason: "stop" }], ...(usage ? { usage } : {}) }));

describe("execution envelope (§12.33)", () => {
  it("sends a capped request within the ceilings and charges the reported usage", async () => {
    const base = vi.fn(async () => reply({ prompt_tokens: 120, completion_tokens: 80 }));
    const env = createExecutionEnvelope(base as unknown as typeof fetch, LIMITS);
    await env.fetch(URL_, { method: "POST", body: body(500) });
    expect(base).toHaveBeenCalledTimes(1);
    expect(env.log[0]).toMatchObject({ decision: "sent", maxTokens: 500, estimatedInput: 100 + 64, worstCase: 664, charged: 200 });
    expect(env.totals()).toMatchObject({ sent: 1, refused: 0, spentTokens: 200 });
  });

  it("refuses (never sends) a request without max_tokens", async () => {
    const base = vi.fn(async () => reply());
    const env = createExecutionEnvelope(base as unknown as typeof fetch, LIMITS);
    await expect(env.fetch(URL_, { method: "POST", body: body(undefined) })).rejects.toThrow(/max_tokens/);
    expect(base).not.toHaveBeenCalled();
  });

  it("refuses the request that would take actual spend + its worst case past the token ceiling", async () => {
    const base = vi.fn(async () => reply({ prompt_tokens: 1_000, completion_tokens: 900 }));
    const env = createExecutionEnvelope(base as unknown as typeof fetch, LIMITS);
    await env.fetch(URL_, { method: "POST", body: body(500) }); // spends 1,900
    await expect(env.fetch(URL_, { method: "POST", body: body(1_000, 400) })).rejects.toThrow(/token ceiling/); // 1,900 + 1,164 > 3,000
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("a reply without usage is charged its whole worst case", async () => {
    const env = createExecutionEnvelope((async () => reply()) as unknown as typeof fetch, LIMITS);
    await env.fetch(URL_, { method: "POST", body: body(500) });
    expect(env.totals().spentTokens).toBe(664);
  });

  it("the request limit is hard: the 4th model request is refused", async () => {
    const base = vi.fn(async () => reply({ prompt_tokens: 10, completion_tokens: 10 }));
    const env = createExecutionEnvelope(base as unknown as typeof fetch, LIMITS);
    for (let i = 0; i < 3; i++) await env.fetch(URL_, { method: "POST", body: body(100) });
    await expect(env.fetch(URL_, { method: "POST", body: body(100) })).rejects.toThrow(/request limit/);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("the dollar ceiling is checked too", async () => {
    const env = createExecutionEnvelope((async () => reply()) as unknown as typeof fetch, { ...LIMITS, maxUsd: 1e-6 });
    await expect(env.fetch(URL_, { method: "POST", body: body(500) })).rejects.toThrow(/dollar ceiling/);
  });

  it("non-model requests (the price catalogue GET) pass through uncounted", async () => {
    const base = vi.fn(async () => new Response("{}"));
    const env = createExecutionEnvelope(base as unknown as typeof fetch, LIMITS);
    await env.fetch("https://x.test/v1/models");
    expect(env.totals()).toMatchObject({ sent: 0, refused: 0 });
    expect(base).toHaveBeenCalledTimes(1);
  });
});
