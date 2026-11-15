/**
 * AI-host fallback gate (2026-11-15): negative tests for every AI host route. In local mode, a request with no token and
 * no BYOK connection may run as this machine's logged-in Copilot user only when it is demonstrably local
 * (`localTrust.ts`). The host runtime and the decision vendor are mocked so that any call not explicitly expected fails
 * the test — no real model call can happen here. Required by scripts/chatgpt-mcp-session.ps1 -Verify.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AIModel, AIResponse } from "@/ai/types";
import type { HostRuntime } from "@/ai/host/hostRuntime";
import { hostDecide } from "@/ai/host/decisions/hostDecide";
import { nonLocalReason } from "./localTrust";

const unexpected = (what: string) => () => {
  throw new Error(`unexpected ${what} call: the AI-host gate should have refused this request first`);
};

const fakeRuntime: { [K in keyof HostRuntime]: HostRuntime[K] } = {
  id: "copilot",
  generate: vi.fn(),
  stream: vi.fn(),
  listModels: vi.fn(),
};

vi.mock("@/ai/host/copilot/CopilotHostRuntime", () => ({ createCopilotHostRuntime: () => fakeRuntime }));
vi.mock("@/ai/host/decisions/hostDecide", () => ({ hostDecide: vi.fn() }));

const TOKEN = "gho_GateTestUserToken";
const BYOK = { type: "openai", baseUrl: "https://my-api.example.com/v1", apiKey: "byok-key" };

/** Tunnel-, proxy- and LAN-shaped requests: each must be refused the logged-in-user fallback. */
const NON_LOCAL: Record<string, Record<string, string>> = {
  "ngrok Host": { host: "abc.ngrok-free.app" },
  "x-forwarded-for from a public client": { host: "localhost:3000", "x-forwarded-for": "203.0.113.7" },
  "spoofed loopback x-forwarded-for with a proxy-appended client": { host: "localhost:3000", "x-forwarded-for": "127.0.0.1, 203.0.113.7" },
  "forwarded header": { host: "localhost:3000", forwarded: "for=203.0.113.7;host=abc.ngrok-free.app;proto=https" },
  "ngrok Origin": { host: "localhost:3000", origin: "https://abc.ngrok-free.app" },
  "LAN Host": { host: "192.168.31.30:3000" },
  "x-forwarded-host of the tunnel (host header rewritten)": { host: "localhost:3000", "x-forwarded-host": "abc.ngrok-free.app" },
  "x-real-ip": { host: "localhost:3000", "x-real-ip": "203.0.113.7" },
  "x-original-host": { host: "localhost:3000", "x-original-host": "abc.ngrok-free.app" },
  "ngrok-* header": { host: "localhost:3000", "ngrok-skip-browser-warning": "1" },
  "foreign Referer": { host: "localhost:3000", referer: "https://abc.ngrok-free.app/canvas" },
  "opaque Origin": { host: "localhost:3000", origin: "null" },
  "no Host": {},
};

/** What a request from this machine looks like, including the x-forwarded-* headers Next.js itself fills in. */
const LOCAL: Record<string, Record<string, string>> = {
  "localhost": { host: "localhost:3000" },
  "127.0.0.1 with same-origin Origin and Referer": { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", referer: "http://127.0.0.1:3000/" },
  "[::1]": { host: "[::1]:3000", origin: "http://[::1]:3000" },
  "Next.js-filled forwarding headers": { host: "localhost:3000", "x-forwarded-for": "::1", "x-forwarded-host": "localhost:3000", "x-forwarded-port": "3000", "x-forwarded-proto": "http" },
  "IPv4-mapped loopback socket": { host: "localhost:3000", "x-forwarded-for": "::ffff:127.0.0.1" },
};

const OK: AIResponse = { text: "ok", model: "gpt-5", finishReason: "stop", usage: { provider: "copilot", model: "gpt-5" } };

function post(path: string, headers: Record<string, string>, body: unknown, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

function get(path: string, headers: Record<string, string>, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) } });
}

function expectNoRuntimeCall() {
  expect(fakeRuntime.generate).not.toHaveBeenCalled();
  expect(fakeRuntime.stream).not.toHaveBeenCalled();
  expect(fakeRuntime.listModels).not.toHaveBeenCalled();
  expect(hostDecide).not.toHaveBeenCalled();
}

async function expectRefused(res: Response) {
  expect(res.status).toBe(403);
  const body = (await res.json()) as { kind: string; message: string };
  expect(body.kind).toBe("auth");
  expect(body.message).toMatch(/made on this machine/);
  expectNoRuntimeCall();
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fakeRuntime.generate).mockImplementation(unexpected("generate"));
  vi.mocked(fakeRuntime.stream).mockImplementation(unexpected("stream"));
  vi.mocked(fakeRuntime.listModels).mockImplementation(unexpected("listModels"));
  vi.mocked(hostDecide).mockImplementation(unexpected("hostDecide"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  delete process.env.AI_HOST_MODE;
});

afterEach(() => {
  delete process.env.AI_HOST_MODE;
  vi.restoreAllMocks();
});

describe("nonLocalReason", () => {
  it.each(Object.entries(NON_LOCAL))("refuses %s", (_, headers) => {
    expect(nonLocalReason(new Headers(headers))).not.toBeNull();
  });
  it.each(Object.entries(LOCAL))("accepts %s", (_, headers) => {
    expect(nonLocalReason(new Headers(headers))).toBeNull();
  });
});

describe("POST /api/ai/run — local mode, no credentials", () => {
  it.each(Object.entries(NON_LOCAL))("refuses a %s request before any runtime call", async (_, headers) => {
    const { POST } = await import("./run/route");
    await expectRefused(await POST(post("/api/ai/run", headers, { request: { prompt: "hi" } })));
  });

  it("allows a plain loopback request, running as the logged-in user", async () => {
    vi.mocked(fakeRuntime.generate).mockResolvedValueOnce(OK);
    const { POST } = await import("./run/route");
    const res = await POST(post("/api/ai/run", { host: "localhost:3000", origin: "http://localhost:3000" }, { request: { prompt: "hi" } }));
    expect(res.status).toBe(200);
    expect(fakeRuntime.generate).toHaveBeenCalledOnce();
    expect(fakeRuntime.generate).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "logged_in_user" } }));
  });
});

describe("POST /api/ai/run — token and BYOK requests are unaffected", () => {
  it("runs a tunnel request that carries its own token with that token", async () => {
    vi.mocked(fakeRuntime.generate).mockResolvedValueOnce(OK);
    const { POST } = await import("./run/route");
    const res = await POST(post("/api/ai/run", NON_LOCAL["ngrok Host"]!, { request: { prompt: "hi" } }, TOKEN));
    expect(res.status).toBe(200);
    expect(fakeRuntime.generate).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "token", gitHubToken: TOKEN } }));
  });

  it("runs a tunnel request that carries its own BYOK provider", async () => {
    vi.mocked(fakeRuntime.generate).mockResolvedValueOnce(OK);
    const { POST } = await import("./run/route");
    const res = await POST(post("/api/ai/run", NON_LOCAL["x-forwarded-for from a public client"]!, { request: { prompt: "hi" }, provider: BYOK }));
    expect(res.status).toBe(200);
    expect(fakeRuntime.generate).toHaveBeenCalledWith(expect.objectContaining({ provider: BYOK }));
  });
});

describe("POST /api/ai/stream — local mode, no credentials", () => {
  it.each(Object.entries(NON_LOCAL))("refuses a %s request before streaming starts", async (_, headers) => {
    const { POST } = await import("./stream/route");
    await expectRefused(await POST(post("/api/ai/stream", headers, { request: { prompt: "hi" } })));
  });

  it("streams for a plain loopback request", async () => {
    vi.mocked(fakeRuntime.stream).mockReturnValueOnce(
      (async function* () {
        yield { delta: "", done: true };
      })(),
    );
    const { POST } = await import("./stream/route");
    const res = await POST(post("/api/ai/stream", { host: "127.0.0.1:3000" }, { request: { prompt: "hi" } }));
    expect(res.status).toBe(200);
    await res.text();
    expect(fakeRuntime.stream).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "logged_in_user" } }));
  });

  it("streams a tunnel request that carries its own token", async () => {
    vi.mocked(fakeRuntime.stream).mockReturnValueOnce(
      (async function* () {
        yield { delta: "", done: true };
      })(),
    );
    const { POST } = await import("./stream/route");
    const res = await POST(post("/api/ai/stream", NON_LOCAL["ngrok Host"]!, { request: { prompt: "hi" } }, TOKEN));
    expect(res.status).toBe(200);
    await res.text();
    expect(fakeRuntime.stream).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "token", gitHubToken: TOKEN } }));
  });
});

describe("GET /api/ai/models — local mode, no credentials", () => {
  it.each(Object.entries(NON_LOCAL))("refuses a %s request before listing models", async (_, headers) => {
    const { GET } = await import("./models/route");
    await expectRefused(await GET(get("/api/ai/models", headers)));
  });

  it("lists models for a plain loopback request as the logged-in user", async () => {
    const models: AIModel[] = [{ id: "gpt-5", name: "GPT-5" }];
    vi.mocked(fakeRuntime.listModels).mockResolvedValueOnce(models);
    const { GET } = await import("./models/route");
    const res = await GET(get("/api/ai/models", { host: "[::1]:3000" }));
    expect(res.status).toBe(200);
    expect(fakeRuntime.listModels).toHaveBeenCalledWith({ kind: "logged_in_user" });
  });

  it("lists models for a tunnel request that carries its own token", async () => {
    vi.mocked(fakeRuntime.listModels).mockResolvedValueOnce([]);
    const { GET } = await import("./models/route");
    const res = await GET(get("/api/ai/models", NON_LOCAL["ngrok Host"]!, TOKEN));
    expect(res.status).toBe(200);
    expect(fakeRuntime.listModels).toHaveBeenCalledWith({ kind: "token", gitHubToken: TOKEN });
  });
});

describe("POST /api/ai/decide — no ambient key at all", () => {
  const decision = { vendor: "jev", model: "typesafe/jev-1.13", request: { state: { t: "t" }, questions: { q: { type: "boolean", instructions: "?" } } } };

  it.each(Object.entries(NON_LOCAL))("refuses a keyless %s request without calling the vendor", async (_, headers) => {
    const { POST } = await import("./decide/route");
    const res = await POST(post("/api/ai/decide", headers, decision));
    expect(res.status).toBe(401);
    expectNoRuntimeCall();
  });

  it("refuses a keyless loopback request too (nothing to fall back on)", async () => {
    const { POST } = await import("./decide/route");
    const res = await POST(post("/api/ai/decide", { host: "localhost:3000" }, decision));
    expect(res.status).toBe(401);
    expectNoRuntimeCall();
  });
});

describe("server mode is unchanged", () => {
  beforeEach(() => {
    process.env.AI_HOST_MODE = "server";
  });

  it("rejects a keyless tunnel request with 401 before any runtime call", async () => {
    const run = (await import("./run/route")).POST;
    const stream = (await import("./stream/route")).POST;
    const models = (await import("./models/route")).GET;
    for (const res of [
      await run(post("/api/ai/run", NON_LOCAL["ngrok Host"]!, { request: { prompt: "hi" } })),
      await stream(post("/api/ai/stream", NON_LOCAL["ngrok Host"]!, { request: { prompt: "hi" } })),
      await models(get("/api/ai/models", NON_LOCAL["ngrok Host"]!)),
    ]) {
      expect(res.status).toBe(401);
    }
    expectNoRuntimeCall();
  });

  it("rejects a keyless loopback request with 401 too (server mode never falls back)", async () => {
    const { POST } = await import("./run/route");
    const res = await POST(post("/api/ai/run", { host: "localhost:3000" }, { request: { prompt: "hi" } }));
    expect(res.status).toBe(401);
    expectNoRuntimeCall();
  });

  it("runs a tunnel request that carries its own token", async () => {
    vi.mocked(fakeRuntime.generate).mockResolvedValueOnce(OK);
    const { POST } = await import("./run/route");
    const res = await POST(post("/api/ai/run", NON_LOCAL["ngrok Host"]!, { request: { prompt: "hi" } }, TOKEN));
    expect(res.status).toBe(200);
    expect(fakeRuntime.generate).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "token", gitHubToken: TOKEN } }));
  });
});
