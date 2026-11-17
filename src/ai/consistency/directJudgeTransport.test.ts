import { describe, expect, it, vi } from "vitest";
import { directJudgeTransport } from "./directJudgeTransport";

const connection = { connectionId: "aicredits", model: "m", provider: { type: "openai" as const, baseUrl: "https://x.test/v1", apiKey: "sk-test-123456789" } };
const request = { systemPrompt: "s", prompt: "p", maxTokens: 760, reasoningEffort: "low" as const, timeoutMs: 90_000 };

describe("directJudgeTransport — the app's one-request path to /api/ai/judge", () => {
  it("declares a real cap and one attempt; posts once to the judge route (never the SDK's /api/ai/run), redirects refused", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: "{}", finishReason: "stop", usage: { promptTokens: 5, completionTokens: 6 }, providerRequests: 1 })));
    const onProviderRequest = vi.fn();
    const t = directJudgeTransport(connection, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(t).toMatchObject({ capsOutput: true, singleAttempt: true, id: "direct:aicredits" });
    const r = await t.send({ ...request, onProviderRequest });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onProviderRequest).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai/judge");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(String(init.body))).toEqual({ provider: connection.provider, model: "m", ...request });
    expect(r).toEqual({ text: "{}", finishReason: "stop", usage: { promptTokens: 5, completionTokens: 6 }, providerRequests: 1 });
  });

  it("a 404 says the check is switched off on the server; other failures carry the host's fixed message; never retried", async () => {
    const off = vi.fn(async () => new Response("Not Found", { status: 404 }));
    await expect(directJudgeTransport(connection, { fetchImpl: off as unknown as typeof fetch }).send(request)).rejects.toThrow(/switched off/);
    const limited = vi.fn(async () => new Response(JSON.stringify({ kind: "rate_limited", message: "The AI connection is rate limited." }), { status: 429 }));
    await expect(directJudgeTransport(connection, { fetchImpl: limited as unknown as typeof fetch }).send(request)).rejects.toThrow(/rate limited/);
    expect(off).toHaveBeenCalledTimes(1);
    expect(limited).toHaveBeenCalledTimes(1);
  });
});
