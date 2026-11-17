import { describe, expect, it, vi } from "vitest";
import { AIError } from "@/ai/errors";
import { outputBudget } from "@/ai/consistency/judge";
import { DIRECT_JUDGE_MAX_TOKENS, directJudgeBodySchema, endpointOf, hostDirectJudge, isDirectJudgeProvider } from "./directJudge";

const provider = { type: "openai" as const, baseUrl: "https://api.example.test/v1/", apiKey: "sk-test-secret-123456" };
const input = { provider, model: "m-1", systemPrompt: "sys", prompt: "pairs", maxTokens: 1300, reasoningEffort: "low" as const, timeoutMs: 90_000 };
const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const reply = { choices: [{ message: { content: '{"results":[]}' }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 300 } };

describe("hostDirectJudge — exactly one direct request (Stage 4f, direct HTTP only)", () => {
  it("sends one POST to <base>/chat/completions with the cap, temperature 0, low reasoning and both messages; refuses redirects", async () => {
    const fetchImpl = vi.fn(async () => ok(reply));
    const onRequest = vi.fn();
    const r = await hostDirectJudge(input, fetchImpl as unknown as typeof fetch, onRequest);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test-secret-123456");
    expect(JSON.parse(String(init.body))).toEqual({
      model: "m-1",
      temperature: 0,
      max_tokens: 1300,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "pairs" },
      ],
    });
    expect(r).toEqual({ text: '{"results":[]}', finishReason: "stop", usage: { promptTokens: 900, completionTokens: 300 }, providerRequests: 1 });
  });

  it("never retries: a 429 or a 5xx is one request and a fixed-text error", async () => {
    for (const [status, kind] of [[429, "rate_limited"], [503, "network"], [401, "auth"], [402, "quota_exhausted"], [400, "model_unavailable"]] as const) {
      const fetchImpl = vi.fn(async () => ok({ error: { message: "echo of the prompt: pairs" } }, status));
      const err = await hostDirectJudge(input, fetchImpl as unknown as typeof fetch).catch((e: unknown) => e);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(err).toBeInstanceOf(AIError);
      expect((err as AIError).kind).toBe(kind);
      expect((err as AIError).message).not.toContain("pairs");
    }
  });

  it("a network failure, a timeout and a cancellation are told apart; an unreadable reply is invalid_output", async () => {
    const net = await hostDirectJudge(input, (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch).catch((e: AIError) => e);
    expect((net as AIError).kind).toBe("network");
    const ctrl = new AbortController();
    ctrl.abort();
    const cancelled = await hostDirectJudge({ ...input, signal: ctrl.signal }, (async () => Promise.reject(new DOMException("x", "AbortError"))) as unknown as typeof fetch).catch((e: AIError) => e);
    expect((cancelled as AIError).kind).toBe("cancelled");
    const bad = await hostDirectJudge(input, (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch).catch((e: AIError) => e);
    expect((bad as AIError).kind).toBe("invalid_output");
  });

  it("only a chat-completions connection qualifies: anything else is refused before any request", async () => {
    const fetchImpl = vi.fn(async () => ok(reply));
    for (const p of [
      { type: "azure" as const, baseUrl: "https://x.test" },
      { type: "anthropic" as const, baseUrl: "https://x.test" },
      { type: "openai" as const, baseUrl: "https://x.test", wireApi: "responses" as const },
      { type: "openai" as const, baseUrl: "ftp://x.test" },
      { type: "openai" as const, baseUrl: "https://user:pw@x.test" },
      { type: "openai" as const, baseUrl: "not a url" },
    ]) {
      expect(isDirectJudgeProvider(p)).toBe(false);
      await expect(hostDirectJudge({ ...input, provider: p }, fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(AIError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(isDirectJudgeProvider({ type: "openai", baseUrl: "http://localhost:11434/v1" })).toBe(true);
    expect(endpointOf("https://a.test/v1")).toBe("https://a.test/v1/chat/completions");
  });

  it("the body schema bounds the call: the cap is the check's own maximum, effort low, timeout ≤ 90 s", () => {
    expect(DIRECT_JUDGE_MAX_TOKENS).toBe(outputBudget({ pairs: Array.from({ length: 10 }, (_, i) => ({ ref: `p${i + 1}`, a: { sentence: "a" }, b: { sentence: "b" } })) }));
    expect(directJudgeBodySchema.safeParse(input).success).toBe(true);
    expect(directJudgeBodySchema.safeParse({ ...input, maxTokens: 1301 }).success).toBe(false);
    expect(directJudgeBodySchema.safeParse({ ...input, maxTokens: undefined }).success).toBe(false);
    expect(directJudgeBodySchema.safeParse({ ...input, reasoningEffort: "high" }).success).toBe(false);
    expect(directJudgeBodySchema.safeParse({ ...input, timeoutMs: 90_001 }).success).toBe(false);
    expect(directJudgeBodySchema.safeParse({ ...input, prompt: "x".repeat(8_001) }).success).toBe(false);
  });
});
