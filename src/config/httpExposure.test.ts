import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTERNALLY_REACHABLE, exposureRefusal, isExternallyReachable } from "./httpExposure";

const SECRET = "/api/mcp/s/acm_AbCdEf0123456789-_xyz";

/** Every route that must never be reachable from outside (with the method a caller would use). */
const BLOCKED: [string, string][] = [
  ["/", "GET"],
  ["/workspace/default", "GET"],
  ["/workspace/default/canvas-1", "GET"],
  ["/dev/openui-demo", "GET"],
  ["/_next/static/chunks/main-app.js", "GET"],
  ["/_next/image", "GET"],
  ["/icon.svg", "GET"],
  ["/favicon.ico", "GET"],
  ["/api/ai/run", "POST"],
  ["/api/ai/stream", "POST"],
  ["/api/ai/models", "GET"],
  ["/api/ai/decide", "POST"],
  ["/api/embed/check", "GET"],
  ["/api/import/chat-share", "POST"],
  ["/api/mcp/bridge", "GET"],
  ["/api/mcp/bridge", "POST"],
  ["/api/mcp/access", "POST"],
  // look-alikes of the secret-URL path
  ["/api/mcp/s", "POST"],
  ["/api/mcp/s/", "POST"],
  ["/api/mcp/s/acm_x/extra", "POST"],
  ["/api/mcp/s/acm_x/", "POST"],
  ["/api/mcp/s/acm%2F..%2F..%2Fai%2Frun", "POST"],
  ["/api/mcp/s/a.b", "POST"],
  ["/API/MCP/S/acm_x", "POST"],
  [`/api/mcp/s/${"a".repeat(201)}`, "POST"],
];

const OAUTH: [string, string][] = [
  ["/api/mcp", "POST"],
  ["/api/mcp", "GET"],
  ["/api/mcp", "DELETE"],
  ["/.well-known/oauth-protected-resource", "GET"],
  ["/.well-known/oauth-protected-resource/api/mcp", "GET"],
  ["/.well-known/oauth-authorization-server", "GET"],
  ["/oauth/authorize", "GET"],
  ["/oauth/authorize", "POST"],
  ["/oauth/token", "POST"],
  ["/oauth/register", "POST"],
];

describe("isExternallyReachable (pure allowlist)", () => {
  it("allows the secret-URL endpoint for POST, GET and DELETE only", () => {
    for (const m of ["POST", "GET", "DELETE", "post"]) expect(isExternallyReachable(SECRET, m, { oauth: false })).toBe(true);
    for (const m of ["PUT", "PATCH", "HEAD", "OPTIONS"]) expect(isExternallyReachable(SECRET, m, { oauth: false })).toBe(false);
  });

  it.each(BLOCKED)("blocks %s %s whatever the OAuth flag", (path, method) => {
    expect(isExternallyReachable(path, method, { oauth: false })).toBe(false);
    expect(isExternallyReachable(path, method, { oauth: true })).toBe(false);
  });

  it.each(OAUTH)("blocks OAuth path %s %s when OAuth is off, allows it when on", (path, method) => {
    expect(isExternallyReachable(path, method, { oauth: false })).toBe(false);
    expect(isExternallyReachable(path, method, { oauth: true })).toBe(true);
  });

  it("keeps OAuth method sets tight", () => {
    expect(isExternallyReachable("/oauth/token", "GET", { oauth: true })).toBe(false);
    expect(isExternallyReachable("/oauth/register", "GET", { oauth: true })).toBe(false);
    expect(isExternallyReachable("/.well-known/oauth-authorization-server", "POST", { oauth: true })).toBe(false);
  });

  it("is a short, explicit list", () => {
    expect(EXTERNALLY_REACHABLE).toHaveLength(7);
    expect(EXTERNALLY_REACHABLE.filter((r) => !r.oauthOnly)).toHaveLength(1);
  });
});

const LOCAL = { host: "localhost:3000", "x-forwarded-for": "::1", "x-forwarded-host": "localhost:3000" };
const TUNNEL_LIKE: Record<string, Record<string, string>> = {
  "ngrok Host": { host: "abc.ngrok-free.app" },
  "x-forwarded-for public": { host: "localhost:3000", "x-forwarded-for": "203.0.113.7" },
  "x-forwarded-host tunnel": { host: "localhost:3000", "x-forwarded-host": "abc.ngrok-free.app" },
  forwarded: { host: "localhost:3000", forwarded: "for=203.0.113.7;host=abc.ngrok-free.app;proto=https" },
  "LAN Host": { host: "192.168.31.30:3000" },
  "ngrok header": { host: "localhost:3000", "ngrok-skip-browser-warning": "1" },
  "foreign Origin": { host: "localhost:3000", origin: "https://evil.example" },
};

describe("exposureRefusal (request decision)", () => {
  afterEach(() => vi.unstubAllEnvs());

  for (const [label, headers] of Object.entries(TUNNEL_LIKE)) {
    it(`${label}: every unrelated route is a 404; the secret URL passes`, async () => {
      for (const [path, method] of [...BLOCKED, ...OAUTH]) {
        const res = exposureRefusal(path, method, new Headers(headers));
        expect(res?.status, `${method} ${path}`).toBe(404);
        expect(await res!.text()).toBe("Not Found");
      }
      expect(exposureRefusal(SECRET, "POST", new Headers(headers))).toBeNull();
    });
  }

  it("local requests pass for every path", () => {
    for (const [path, method] of [...BLOCKED, ...OAUTH, [SECRET, "POST"] as [string, string]]) {
      expect(exposureRefusal(path, method, new Headers(LOCAL))).toBeNull();
      expect(exposureRefusal(path, method, new Headers({ host: "127.0.0.1:3000" }))).toBeNull();
    }
  });

  it("OAuth paths pass from outside only when the OAuth flow is fully on", () => {
    vi.stubEnv("MCP_OAUTH_FEATURE", "on");
    vi.stubEnv("MCP_PUBLIC_BASE_URL", "https://abc.ngrok-free.app");
    for (const [path, method] of OAUTH) expect(exposureRefusal(path, method, new Headers(TUNNEL_LIKE["ngrok Host"]))).toBeNull();
    expect(exposureRefusal("/api/ai/run", "POST", new Headers(TUNNEL_LIKE["ngrok Host"]))?.status).toBe(404);
    vi.stubEnv("MCP_FEATURE", "off");
    expect(exposureRefusal("/oauth/token", "POST", new Headers(TUNNEL_LIKE["ngrok Host"]))?.status).toBe(404);
  });

  it("ACUTE_HTTP_EXPOSURE=public (the hosted app) turns the filter off; any other value keeps it on", () => {
    vi.stubEnv("ACUTE_HTTP_EXPOSURE", "public");
    expect(exposureRefusal("/", "GET", new Headers({ host: "acute-notes.example" }))).toBeNull();
    vi.stubEnv("ACUTE_HTTP_EXPOSURE", "Public");
    expect(exposureRefusal("/", "GET", new Headers({ host: "acute-notes.example" }))?.status).toBe(404);
  });
});
