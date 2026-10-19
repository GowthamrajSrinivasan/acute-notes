import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIRequest, AIResponse } from "@/ai/types";
import { createCopilotProvider } from "./copilotProvider";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function baseRequest(overrides: Partial<AIRequest> = {}): AIRequest {
  return { task: "chat", prompt: "hello", ...overrides };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copilotProvider.generate", () => {
  it("posts to /api/ai/run with the request and includes the bearer token", async () => {
    const response: AIResponse = { text: "hi", model: "gpt-5", finishReason: "stop", usage: { provider: "copilot", model: "gpt-5" } };
    const fetchMock = vi.fn(async () => jsonResponse(response));
    vi.stubGlobal("fetch", fetchMock);

    const provider = createCopilotProvider({ gitHubToken: "gho_secret" });
    const result = await provider.generate(baseRequest({ systemPrompt: "be terse" }));

    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/ai/run");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer gho_secret");
    const body = JSON.parse(init.body as string);
    expect(body.request).toMatchObject({ prompt: "hello", systemPrompt: "be terse", task: "chat" });
  });

  it("omits the authorization header when no token is configured", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: "", model: "m", finishReason: "stop", usage: { provider: "copilot", model: "m" } }));
    vi.stubGlobal("fetch", fetchMock);

    await createCopilotProvider().generate(baseRequest());

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("maps a non-ok response's kind into an AIError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ kind: "rate_limited", message: "slow down" }, 429)));

    await expect(createCopilotProvider().generate(baseRequest())).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("defaults an unrecognized error body's kind to auth on a 401", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));

    await expect(createCopilotProvider().generate(baseRequest())).rejects.toMatchObject({ kind: "auth" });
  });

  it("maps a fetch AbortError to AIError('cancelled')", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    );

    await expect(createCopilotProvider().generate(baseRequest())).rejects.toMatchObject({ kind: "cancelled" });
  });
});

describe("copilotProvider.stream", () => {
  it("yields chunks parsed from newline-delimited JSON", async () => {
    const body = `${JSON.stringify({ delta: "He", done: false })}\n${JSON.stringify({ delta: "llo", done: false })}\n${JSON.stringify({ delta: "", done: true })}\n`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

    const chunks = [];
    for await (const chunk of createCopilotProvider().stream!(baseRequest())) chunks.push(chunk);

    expect(chunks).toEqual([
      { delta: "He", done: false },
      { delta: "llo", done: false },
      { delta: "", done: true },
    ]);
  });

  it("throws an AIError when the stream embeds a failure line", async () => {
    const body = `${JSON.stringify({ delta: "", done: true, kind: "auth", message: "nope" })}\n`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

    async function drain() {
      const chunks = [];
      for await (const chunk of createCopilotProvider().stream!(baseRequest())) chunks.push(chunk);
      return chunks;
    }

    await expect(drain()).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("copilotProvider misc", () => {
  it("getModels GETs /api/ai/models", async () => {
    const models = [{ id: "gpt-5", name: "GPT-5" }];
    const fetchMock = vi.fn(async () => jsonResponse(models));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createCopilotProvider({ gitHubToken: "gho_x" }).getModels?.();
    expect(result).toEqual(models);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/ai/models");
  });

  it("getUsage always returns null — no cumulative-usage query exists", async () => {
    await expect(createCopilotProvider().getUsage?.()).resolves.toBeNull();
  });

  it("isConfigured reflects whether any credential is present", async () => {
    await expect(createCopilotProvider().isConfigured()).resolves.toBe(false);
    await expect(createCopilotProvider({ gitHubToken: "t" }).isConfigured()).resolves.toBe(true);
    await expect(createCopilotProvider({ byok: { type: "openai", baseUrl: "https://x" } }).isConfigured()).resolves.toBe(true);
  });

  it("testConnection reports ok:false with the error message when getModels fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ kind: "auth", message: "no token" }, 401)));

    const result = await createCopilotProvider().testConnection();
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no token");
  });

  it("declares json_mode structured output, not native — the SDK has no schema-constrained response output", () => {
    expect(createCopilotProvider().capabilities.structuredOutput).toBe("json_mode");
  });
});
