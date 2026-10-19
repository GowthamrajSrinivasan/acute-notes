import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { aiFeatureDisabledResponse, isAIFeatureEnabled, isMcpFeatureEnabled, isMcpOAuthEnabled, isMcpUiEnabled, mcpFeatureDisabledResponse, mcpOAuthDisabledResponse } from "./features";
import { getAIMode, setAIMode } from "@/ai/aiMode";

const generate = vi.fn();
vi.mock("@/ai/host/copilot/CopilotHostRuntime", () => ({
  createCopilotHostRuntime: () => ({ id: "copilot", generate, stream: generate, listModels: generate }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  generate.mockReset();
});

describe("NEXT_PUBLIC_AI_FEATURE", () => {
  it('is on only for exactly "on" — unset or anything else fails closed', () => {
    expect(isAIFeatureEnabled()).toBe(true); // vitest.config.ts sets "on"
    for (const value of ["off", "", "true", "ON", "1"]) {
      vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", value);
      expect(isAIFeatureEnabled()).toBe(false);
    }
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", undefined);
    expect(isAIFeatureEnabled()).toBe(false);
  });

  it("forces AI mode Off, whatever the device setting, and ignores attempts to turn it on", async () => {
    expect(getAIMode()).toBe("on");
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "off");
    expect(getAIMode()).toBe("off");
    await setAIMode("on"); // no-op: never reaches persistence
    expect(getAIMode()).toBe("off");
  });

  it("makes every AI route a 404 without touching the AI host", async () => {
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "off");
    const [run, stream, models] = await Promise.all([import("@/app/api/ai/run/route"), import("@/app/api/ai/stream/route"), import("@/app/api/ai/models/route")]);
    const post = (url: string) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: { task: "t", prompt: "p" } }) });

    const responses = await Promise.all([
      run.POST(post("http://localhost:3000/api/ai/run")),
      stream.POST(post("http://localhost:3000/api/ai/stream")),
      models.GET(new NextRequest("http://localhost:3000/api/ai/models")),
    ]);
    expect(responses.map((r) => r.status)).toEqual([404, 404, 404]);
    expect(generate).not.toHaveBeenCalled();
    expect(aiFeatureDisabledResponse()?.status).toBe(404);
  });

  it("does not switch MCP off: the two flags are independent", async () => {
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "off");
    expect(isMcpFeatureEnabled()).toBe(true);
    expect(mcpFeatureDisabledResponse()).toBeNull();
    const { POST } = await import("@/app/api/mcp/route");
    // No credential: refused for that reason (401), not because the feature is off (404).
    const res = await POST(new NextRequest("http://localhost:3000/api/mcp", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(401);
  });
});

describe("MCP_FEATURE (server-enforced, independent of the AI flag)", () => {
  it('is on only for exactly "on" — unset or anything else fails closed', () => {
    expect(isMcpFeatureEnabled()).toBe(true); // vitest.config.ts sets "on"
    for (const value of ["off", "", "true", "ON", "1"]) {
      vi.stubEnv("MCP_FEATURE", value);
      expect(isMcpFeatureEnabled()).toBe(false);
    }
    vi.stubEnv("MCP_FEATURE", undefined);
    expect(isMcpFeatureEnabled()).toBe(false);
  });

  it("makes every MCP route a 404 when called directly, whatever the UI flag or the AI flag say", async () => {
    vi.stubEnv("MCP_FEATURE", "off");
    expect(isAIFeatureEnabled()).toBe(true);
    expect(isMcpUiEnabled()).toBe(true); // a UI hint can't keep the server routes open
    const [mcp, secret, bridge, access, register, authorize, token, prm, asm] = await Promise.all([
      import("@/app/api/mcp/route"),
      import("@/app/api/mcp/s/[token]/route"),
      import("@/app/api/mcp/bridge/route"),
      import("@/app/api/mcp/access/route"),
      import("@/app/oauth/register/route"),
      import("@/app/oauth/authorize/route"),
      import("@/app/oauth/token/route"),
      import("@/app/.well-known/oauth-protected-resource/[[...path]]/route"),
      import("@/app/.well-known/oauth-authorization-server/[[...path]]/route"),
    ]);
    const post = (url: string) => new NextRequest(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const get = (url: string) => new NextRequest(url);
    const ctx = { params: Promise.resolve({ token: "acm_whatever" }) };

    const responses = await Promise.all([
      mcp.POST(post("http://localhost:3000/api/mcp")),
      mcp.GET(get("http://localhost:3000/api/mcp")),
      mcp.DELETE(new NextRequest("http://localhost:3000/api/mcp", { method: "DELETE" })),
      secret.POST(post("http://localhost:3000/api/mcp/s/acm_whatever"), ctx),
      secret.GET(get("http://localhost:3000/api/mcp/s/acm_whatever"), ctx),
      bridge.GET(get("http://localhost:3000/api/mcp/bridge")),
      bridge.POST(post("http://localhost:3000/api/mcp/bridge")),
      access.POST(post("http://localhost:3000/api/mcp/access")),
      register.POST(post("http://localhost:3000/oauth/register")),
      authorize.GET(get("http://localhost:3000/oauth/authorize")),
      authorize.POST(post("http://localhost:3000/oauth/authorize")),
      token.POST(post("http://localhost:3000/oauth/token")),
      prm.GET(),
      asm.GET(),
    ]);
    expect(responses.map((r) => r.status)).toEqual(Array(14).fill(404));
    expect(mcpFeatureDisabledResponse()?.status).toBe(404);
  });

  it("leaves the AI features alone when it is off", () => {
    vi.stubEnv("MCP_FEATURE", "off");
    expect(isAIFeatureEnabled()).toBe(true);
    expect(getAIMode()).toBe("on");
    expect(aiFeatureDisabledResponse()).toBeNull();
  });
});

describe("MCP_OAUTH_FEATURE (separate from MCP_FEATURE, and needs its configuration)", () => {
  it("is off by default, and turning MCP on does not turn it on", () => {
    expect(isMcpFeatureEnabled()).toBe(true);
    expect(isMcpOAuthEnabled()).toBe(false);
    expect(mcpOAuthDisabledResponse()?.status).toBe(404);
  });

  it("needs the flag, MCP itself, and a public base URL", () => {
    vi.stubEnv("MCP_OAUTH_FEATURE", "on");
    expect(isMcpOAuthEnabled()).toBe(false); // no MCP_PUBLIC_BASE_URL
    vi.stubEnv("MCP_PUBLIC_BASE_URL", "https://notes.example.com");
    expect(isMcpOAuthEnabled()).toBe(true);
    expect(mcpOAuthDisabledResponse()).toBeNull();
    vi.stubEnv("MCP_FEATURE", "off");
    expect(isMcpOAuthEnabled()).toBe(false); // OAuth can't outlive MCP
    vi.stubEnv("MCP_FEATURE", "on");
    vi.stubEnv("MCP_OAUTH_FEATURE", "true");
    expect(isMcpOAuthEnabled()).toBe(false);
  });
});
