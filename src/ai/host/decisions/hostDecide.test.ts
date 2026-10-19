import { describe, expect, it, vi } from "vitest";
import type { DecisionRequest } from "@/ai/decisions/types";
import { hostDecide } from "./hostDecide";

const request: DecisionRequest = { state: "x", questions: { q: { type: "boolean", instructions: "Is it?" } } };
const input = { vendor: "jev" as const, model: "typesafe/jev-1.13", apiKey: "sk-or-secret-key-123456", request };
const ok = () => new Response(JSON.stringify({ model: "typesafe/jev-1.13-x", answers: { q: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200 });
const asFetch = (fn: unknown) => fn as typeof fetch;

describe("hostDecide", () => {
  it("posts to the vendor with the caller's key and returns the normalised answers", async () => {
    const fetchMock = vi.fn(async () => ok());
    const result = await hostDecide(input, asFetch(fetchMock));
    expect(result.answers.q).toEqual({ type: "boolean", probability: 0.9 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-or-secret-key-123456");
    expect(JSON.parse(init.body as string).questions.q.type).toBe("noul");
  });

  it("a vendor it doesn't know is a model_unavailable error, and nothing is sent", async () => {
    const fetchMock = vi.fn(async () => ok());
    await expect(hostDecide({ ...input, vendor: "mystery" }, asFetch(fetchMock))).rejects.toMatchObject({ kind: "model_unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls OpenAI's endpoint for the openai vendor", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: "gpt-6-luna", answers: [{ type: "predicate", name: "q", probability: 0.1 }], usage: {} }), { status: 200 }));
    await hostDecide({ ...input, vendor: "openai", model: "gpt-6-luna" }, asFetch(fetchMock));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api.openai.com/v1/decisions");
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [402, "quota_exhausted"],
    [429, "rate_limited"],
    [504, "timeout"],
    [404, "model_unavailable"],
    [422, "model_unavailable"],
    [500, "network"],
  ])("a %i from the vendor is a %s error, with fixed text that never echoes the vendor's body or the key", async (status, kind) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: "echoes sk-or-secret-key-123456 and the ticket" } }), { status }));
    const err = await hostDecide(input, asFetch(fetchMock)).catch((e: unknown) => e);
    expect(err).toMatchObject({ kind });
    expect((err as Error).message).not.toContain("sk-or-secret");
    expect((err as Error).message).not.toContain("ticket");
  });

  it("a network failure is a network error; a cancelled call is cancelled", async () => {
    await expect(hostDecide(input, asFetch(async () => Promise.reject(new TypeError("fetch failed"))))).rejects.toMatchObject({ kind: "network" });
    const controller = new AbortController();
    controller.abort();
    await expect(hostDecide({ ...input, signal: controller.signal }, asFetch(async () => Promise.reject(new DOMException("aborted", "AbortError"))))).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("a reply that isn't JSON, or isn't the documented shape, is invalid_output", async () => {
    await expect(hostDecide(input, asFetch(async () => new Response("<html>", { status: 200 })))).rejects.toMatchObject({ kind: "invalid_output" });
    await expect(hostDecide(input, asFetch(async () => new Response(JSON.stringify({ nope: 1 }), { status: 200 })))).rejects.toMatchObject({ kind: "invalid_output" });
  });
});
