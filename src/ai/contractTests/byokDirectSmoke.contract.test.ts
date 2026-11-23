/**
 * #7 live smoke (approved 2026-11-23: "commit and push, then run the smoke check") — three small calls on AICredits
 * through the app's own path: `createCopilotProvider` (BYOK, task limits filled in) → the real `/api/ai/run` and
 * `/api/ai/stream` route handlers in-process → `getHostRuntime` → `withDirectByok` → one POST to AICredits.
 * The Copilot runtime is replaced by one that fails, so a call that didn't go direct fails the test.
 *
 * Opt-in: LIVE_BYOK_SMOKE=1. Ceiling: at most 6 provider requests (3 calls × the 2-attempt limit); only api.aicredits.in.
 * Writes no key or header anywhere; the summary goes to LIVE_BYOK_SMOKE_OUT (a JSON file) when set.
 */
import { writeFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCopilotProvider } from "@/ai/providers/copilot/copilotProvider";
import { getByokCredentials } from "./testEnv";

vi.mock("@/ai/host/copilot/CopilotHostRuntime", () => {
  const no = () => {
    throw new Error("the Copilot runtime was used: the call did not go direct");
  };
  return { createCopilotHostRuntime: () => ({ id: "copilot", generate: no, stream: no, listModels: no }) };
});

const live = process.env.LIVE_BYOK_SMOKE === "1";
const MAX_REQUESTS = 6;

interface Sent {
  url: string;
  body: Record<string, unknown>;
  status?: number;
  ms?: number;
}

describe.skipIf(!live)("#7 live smoke — chat-completions BYOK goes direct with the task's cap and temperature", () => {
  const sent: Sent[] = [];
  const results: Record<string, unknown> = {};
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    const { POST: run } = await import("@/app/api/ai/run/route");
    const { POST: stream } = await import("@/app/api/ai/stream/route");
    vi.stubGlobal("fetch", (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "/api/ai/run" || url === "/api/ai/stream") {
        const req = new NextRequest(`http://localhost${url}`, { method: "POST", headers: { host: "localhost", ...(init?.headers as Record<string, string>) }, body: init?.body as string, ...(init?.signal ? { signal: init.signal } : {}) });
        return url === "/api/ai/run" ? run(req) : stream(req);
      }
      if (new URL(url).host !== "api.aicredits.in") throw new Error(`blocked: ${new URL(url).host}`);
      if (sent.length >= MAX_REQUESTS) throw new Error(`ceiling: more than ${MAX_REQUESTS} provider requests`);
      const entry: Sent = { url, body: JSON.parse(String(init?.body)) };
      sent.push(entry);
      const t0 = Date.now();
      const res = await realFetch(url, init);
      entry.status = res.status;
      entry.ms = Date.now() - t0;
      return res;
    }) as typeof fetch);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    const summary = { sent: sent.map(({ url, body, status, ms }) => ({ url, status, ms, body: { ...body, messages: `${(body.messages as unknown[])?.length} messages` } })), results };
    console.log(JSON.stringify(summary, null, 2));
    if (process.env.LIVE_BYOK_SMOKE_OUT) writeFileSync(process.env.LIVE_BYOK_SMOKE_OUT, JSON.stringify(summary, null, 2));
  });

  function provider() {
    const creds = getByokCredentials("aicredits");
    if (!creds) throw new Error("no AICredits credentials in .env.local");
    return createCopilotProvider({ id: "aicredits", byok: { type: "openai", baseUrl: creds.endpoint ?? "https://api.aicredits.in/v1", apiKey: creds.apiKey }, defaultModel: creds.model });
  }

  it("generate (decide): one request, max_tokens 4,096 and temperature 0, a reply and its usage", async () => {
    const before = sent.length;
    const res = await provider().generate({ task: "decide", prompt: 'Reply with exactly this JSON and nothing else: {"ok":true}' });
    results.decide = { text: res.text, finishReason: res.finishReason, usage: res.usage, providerRequests: res.providerRequests };
    expect(sent.length - before).toBe(1);
    const body = sent[before]!.body;
    expect(sent[before]!.url).toBe("https://api.aicredits.in/v1/chat/completions");
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(4_096);
    expect(body.temperature).toBe(0);
    expect(body.stream).toBeUndefined();
    expect(res.text).toMatch(/"ok"\s*:\s*true/);
    expect(res.usage?.completionTokens).toBeGreaterThan(0);
  }, 120_000);

  it("stream (chat): server-sent events read, max_tokens 16,384 and temperature 0.7", async () => {
    const before = sent.length;
    let text = "";
    let done = false;
    for await (const chunk of provider().stream!({ task: "chat", prompt: "Say hello in exactly three words." })) {
      text += chunk.delta;
      if (chunk.done) done = true;
    }
    results.chat = { text, done };
    expect(sent.length - before).toBe(1);
    const body = sent[before]!.body;
    expect(body.stream).toBe(true);
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(16_384);
    expect(body.temperature).toBe(0.7);
    expect(done).toBe(true);
    expect(text.trim().length).toBeGreaterThan(0);
  }, 120_000);

  it("a request's own cap wins and the provider honours it: 64 tokens, cut with finishReason length", async () => {
    const before = sent.length;
    const res = await provider().generate({ task: "summarize", prompt: "Write a 400-word essay about rivers.", maxTokens: 64 });
    results.capped = { textChars: res.text.length, finishReason: res.finishReason, usage: res.usage };
    expect(sent.length - before).toBe(1);
    const body = sent[before]!.body;
    expect(body.max_tokens ?? body.max_completion_tokens).toBe(64);
    expect(body.temperature).toBe(0.3);
    expect(res.finishReason).toBe("length");
    expect(res.usage?.completionTokens).toBeLessThanOrEqual(64);
  }, 120_000);
});
