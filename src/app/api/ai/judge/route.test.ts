import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AIError } from "@/ai/errors";
import { hostDirectJudge } from "@/ai/host/judge/directJudge";
import { POST } from "./route";

vi.mock("@/ai/host/judge/directJudge", async (orig) => ({ ...(await orig<typeof import("@/ai/host/judge/directJudge")>()), hostDirectJudge: vi.fn() }));

const body = { provider: { type: "openai", baseUrl: "https://api.example.test/v1", apiKey: "sk-test-secret-123456" }, model: "m", systemPrompt: "s", prompt: "p", maxTokens: 760, reasoningEffort: "low", timeoutMs: 90_000 };
const post = (json: unknown) => new NextRequest("http://localhost/api/ai/judge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });

beforeEach(() => {
  vi.mocked(hostDirectJudge).mockReset();
  vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "on");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/ai/judge — off by default", () => {
  it("404 unless CONSISTENCY_AI_CHECK is exactly on (unset, off, anything else), and no model request is made", async () => {
    for (const v of [undefined, "off", "ON", "1", "true"]) {
      if (v === undefined) vi.stubEnv("CONSISTENCY_AI_CHECK", undefined as unknown as string);
      else vi.stubEnv("CONSISTENCY_AI_CHECK", v);
      expect((await POST(post(body))).status).toBe(404);
    }
    expect(hostDirectJudge).not.toHaveBeenCalled();
  });

  it("404 when the AI feature itself is off, even with the switch on", async () => {
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "off");
    vi.stubEnv("CONSISTENCY_AI_CHECK", "on");
    expect((await POST(post(body))).status).toBe(404);
    expect(hostDirectJudge).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/judge — switched on", () => {
  beforeEach(() => vi.stubEnv("CONSISTENCY_AI_CHECK", "on"));

  it("passes one validated call to the host and returns its reply", async () => {
    vi.mocked(hostDirectJudge).mockResolvedValueOnce({ text: "{}", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 2 }, providerRequests: 1 });
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "{}", finishReason: "stop", usage: { promptTokens: 1, completionTokens: 2 }, providerRequests: 1 });
    expect(hostDirectJudge).toHaveBeenCalledTimes(1);
    expect(vi.mocked(hostDirectJudge).mock.calls[0]![0]).toMatchObject({ model: "m", maxTokens: 760, reasoningEffort: "low" });
  });

  it("rejects a body without a cap, over the cap or not JSON — without calling the host", async () => {
    expect((await POST(post({ ...body, maxTokens: undefined }))).status).toBe(400);
    expect((await POST(post({ ...body, maxTokens: 5000 }))).status).toBe(400);
    expect((await POST(new NextRequest("http://localhost/api/ai/judge", { method: "POST", body: "{" }))).status).toBe(400);
    expect(hostDirectJudge).not.toHaveBeenCalled();
  });

  it("a host failure becomes the AI error response with fixed text, never the key", async () => {
    vi.mocked(hostDirectJudge).mockRejectedValueOnce(new AIError("rate_limited", "The AI connection is rate limited."));
    const res = await POST(post(body));
    expect(res.status).toBe(429);
    expect(JSON.stringify(await res.json())).not.toContain("sk-test-secret");
  });
});
