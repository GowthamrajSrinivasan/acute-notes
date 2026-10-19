import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AIModel, AIResponse } from "@/ai/types";
import type { HostRuntime } from "@/ai/host/hostRuntime";

const fakeRuntime: { [K in keyof HostRuntime]: HostRuntime[K] } = {
  id: "copilot",
  generate: vi.fn(),
  stream: vi.fn(),
  listModels: vi.fn(),
};

vi.mock("@/ai/host/copilot/CopilotHostRuntime", () => ({
  createCopilotHostRuntime: () => fakeRuntime,
}));

const SECRET_TOKEN = "gho_TopSecretUserToken";

function postRequest(url: string, body: unknown, token?: string): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string, token?: string): NextRequest {
  return new NextRequest(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.AI_HOST_MODE;
});

afterEach(() => {
  delete process.env.AI_HOST_MODE;
});

describe("POST /api/ai/run — server-mode credential gating", () => {
  it("rejects a request with no token and no BYOK provider in server mode, without ever calling the host runtime", async () => {
    process.env.AI_HOST_MODE = "server";
    const { POST } = await import("./run/route");

    const res = await POST(postRequest("http://localhost/api/ai/run", { request: { prompt: "hi" } }));

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.kind).toBe("auth");
    expect(fakeRuntime.generate).not.toHaveBeenCalled();
  });

  it("allows a missing token in local (default) mode, falling back to the host's logged-in user", async () => {
    vi.mocked(fakeRuntime.generate).mockResolvedValueOnce({
      text: "ok",
      model: "gpt-5",
      finishReason: "stop",
      usage: { provider: "copilot", model: "gpt-5" },
    } satisfies AIResponse);
    const { POST } = await import("./run/route");

    const res = await POST(postRequest("http://localhost/api/ai/run", { request: { prompt: "hi" } }));

    expect(res.status).toBe(200);
    expect(fakeRuntime.generate).toHaveBeenCalledOnce();
    expect(fakeRuntime.generate).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "logged_in_user" } }));
  });

  it("accepts a server-mode request with no token when a BYOK provider is supplied", async () => {
    process.env.AI_HOST_MODE = "server";
    vi.mocked(fakeRuntime.generate).mockResolvedValueOnce({
      text: "ok",
      model: "gpt-4",
      finishReason: "stop",
      usage: { provider: "copilot", model: "gpt-4" },
    } satisfies AIResponse);
    const { POST } = await import("./run/route");

    const res = await POST(
      postRequest("http://localhost/api/ai/run", {
        request: { prompt: "hi", model: "gpt-4" },
        provider: { type: "openai", baseUrl: "https://my-api.example.com/v1", apiKey: "byok-key" },
      }),
    );

    expect(res.status).toBe(200);
    expect(fakeRuntime.generate).toHaveBeenCalledOnce();
  });

  it("accepts a server-mode request that carries its own token", async () => {
    process.env.AI_HOST_MODE = "server";
    vi.mocked(fakeRuntime.generate).mockResolvedValueOnce({
      text: "ok",
      model: "gpt-5",
      finishReason: "stop",
      usage: { provider: "copilot", model: "gpt-5" },
    } satisfies AIResponse);
    const { POST } = await import("./run/route");

    const res = await POST(postRequest("http://localhost/api/ai/run", { request: { prompt: "hi" } }, SECRET_TOKEN));

    expect(res.status).toBe(200);
    expect(fakeRuntime.generate).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "token", gitHubToken: SECRET_TOKEN } }));
  });

  it("rejects a request missing the prompt before ever resolving auth", async () => {
    process.env.AI_HOST_MODE = "server";
    const { POST } = await import("./run/route");

    const res = await POST(postRequest("http://localhost/api/ai/run", { request: {} }, SECRET_TOKEN));
    expect(res.status).toBe(400);
    expect(fakeRuntime.generate).not.toHaveBeenCalled();
  });
});

describe("POST /api/ai/run — error mapping", () => {
  it("maps a thrown AIError to its status and kind", async () => {
    const { AIError } = await import("@/ai/errors");
    vi.mocked(fakeRuntime.generate).mockRejectedValueOnce(new AIError("rate_limited", "slow down"));
    const { POST } = await import("./run/route");

    const res = await POST(postRequest("http://localhost/api/ai/run", { request: { prompt: "hi" } }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ kind: "rate_limited", message: "slow down" });
  });
});

describe("secret handling", () => {
  it("never echoes the caller's GitHub token back in a success or error response body", async () => {
    vi.mocked(fakeRuntime.generate).mockResolvedValueOnce({
      text: "ok",
      model: "gpt-5",
      finishReason: "stop",
      usage: { provider: "copilot", model: "gpt-5" },
    } satisfies AIResponse);
    const { POST } = await import("./run/route");

    const okRes = await POST(postRequest("http://localhost/api/ai/run", { request: { prompt: "hi" } }, SECRET_TOKEN));
    const okText = await okRes.text();
    expect(okText).not.toContain(SECRET_TOKEN);

    vi.mocked(fakeRuntime.generate).mockRejectedValueOnce(new Error(`upstream failed for token ${SECRET_TOKEN}`));
    const errRes = await POST(postRequest("http://localhost/api/ai/run", { request: { prompt: "hi" } }, SECRET_TOKEN));
    const errText = await errRes.text();
    // A leak here would mean an underlying error message accidentally
    // embedded the caller's own token — this asserts the route never
    // forwards that verbatim even when the host runtime's own error does.
    expect(errText).not.toContain(SECRET_TOKEN);
  });

  it("never logs the caller's GitHub token via console.*", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fakeRuntime.generate).mockRejectedValueOnce(new Error("boom"));
    const { POST } = await import("./run/route");

    await POST(postRequest("http://localhost/api/ai/run", { request: { prompt: "hi" } }, SECRET_TOKEN));

    for (const call of consoleSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_TOKEN);
    }
    consoleSpy.mockRestore();
  });
});

describe("GET /api/ai/models — server-mode credential gating", () => {
  it("rejects a request with no token in server mode, without ever calling listModels", async () => {
    process.env.AI_HOST_MODE = "server";
    const { GET } = await import("./models/route");

    const res = await GET(getRequest("http://localhost/api/ai/models"));

    expect(res.status).toBe(401);
    expect(fakeRuntime.listModels).not.toHaveBeenCalled();
  });

  it("returns the model list for an authorized request", async () => {
    const models: AIModel[] = [{ id: "gpt-5", name: "GPT-5" }];
    vi.mocked(fakeRuntime.listModels).mockResolvedValueOnce(models);
    const { GET } = await import("./models/route");

    const res = await GET(getRequest("http://localhost/api/ai/models", SECRET_TOKEN));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(models);
  });
});

describe("POST /api/ai/stream — server-mode credential gating", () => {
  it("rejects a request with no token and no BYOK provider in server mode before streaming starts", async () => {
    process.env.AI_HOST_MODE = "server";
    const { POST } = await import("./stream/route");

    const res = await POST(postRequest("http://localhost/api/ai/stream", { request: { prompt: "hi" } }));

    expect(res.status).toBe(401);
    expect(fakeRuntime.stream).not.toHaveBeenCalled();
  });

  it("streams newline-delimited chunks for an authorized request", async () => {
    vi.mocked(fakeRuntime.stream).mockReturnValueOnce(
      (async function* () {
        yield { delta: "Hi", done: false };
        yield { delta: "", done: true };
      })(),
    );
    const { POST } = await import("./stream/route");

    const res = await POST(postRequest("http://localhost/api/ai/stream", { request: { prompt: "hi" } }, SECRET_TOKEN));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toEqual([
      { delta: "Hi", done: false },
      { delta: "", done: true },
    ]);
  });
});
