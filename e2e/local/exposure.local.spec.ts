/**
 * HTTP exposure filter (src/proxy.ts, src/config/httpExposure.ts) against the real dev server. Requests go to the
 * loopback server but carry what a tunnel (ngrok), a proxy or a LAN client would send. Every unrelated route must
 * answer the proxy's bare 404 — before any route code runs, so this spec makes no AI calls and no outbound fetches —
 * while the secret-URL MCP endpoint is let through to the MCP handler. With a bogus token that handler answers 401
 * (host allowed, credential wrong), 403 (tunnel Host not in MCP_ALLOWED_HOSTS) or 429 (this address failed too often):
 * any of these proves the request got past the filter. Local requests still reach every route.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = "http://localhost:3000";
// A documentation-range address, fresh per run so the MCP handler's failed-attempt block doesn't carry over.
const REMOTE_IP = `203.0.113.${1 + Math.floor(Math.random() * 250)}`;

const TUNNEL_LIKE: Record<string, Record<string, string>> = {
  "ngrok Host": { host: "abc.ngrok-free.app", "x-forwarded-for": REMOTE_IP, "x-forwarded-proto": "https" },
  "x-forwarded-for": { "x-forwarded-for": REMOTE_IP },
  "x-forwarded-host": { "x-forwarded-host": "abc.ngrok-free.app" },
  forwarded: { forwarded: `for=${REMOTE_IP};host=abc.ngrok-free.app;proto=https` },
  "LAN Host": { host: "192.168.31.30:3000" },
};

type Probe = { path: string; method: "GET" | "POST"; body?: unknown };

async function staticAsset(request: APIRequestContext): Promise<string> {
  const html = await (await request.get(`${BASE}/workspace/default`)).text();
  const asset = /\/_next\/static\/[^"']+\.js/.exec(html)?.[0];
  expect(asset, "a /_next/static script in the page").toBeTruthy();
  return asset!;
}

async function send(request: APIRequestContext, probe: Probe, headers: Record<string, string>) {
  const options = { headers, maxRedirects: 0, failOnStatusCode: false, ...(probe.body !== undefined ? { data: probe.body } : {}) };
  return probe.method === "GET" ? request.get(`${BASE}${probe.path}`, options) : request.post(`${BASE}${probe.path}`, options);
}

test("exposure filter: tunnel-like requests reach only the MCP secret URL; local requests reach everything", async ({ request }) => {
  const asset = await staticAsset(request);
  const blocked: Probe[] = [
    { path: "/", method: "GET" },
    { path: "/workspace/default", method: "GET" },
    { path: "/workspace/default/some-canvas", method: "GET" },
    { path: asset, method: "GET" },
    { path: "/icon.svg", method: "GET" },
    { path: "/api/ai/run", method: "POST", body: {} },
    { path: "/api/ai/stream", method: "POST", body: {} },
    { path: "/api/ai/models", method: "GET" },
    { path: "/api/ai/decide", method: "POST", body: {} },
    { path: `/api/embed/check?url=${encodeURIComponent("http://169.254.169.254/")}`, method: "GET" },
    { path: "/api/import/chat-share", method: "POST", body: {} },
    { path: "/api/mcp/bridge", method: "GET" },
    { path: "/api/mcp/bridge", method: "POST", body: {} },
    { path: "/api/mcp/access", method: "POST", body: { action: "list" } },
    { path: "/api/mcp", method: "POST", body: {} },
    { path: "/.well-known/oauth-protected-resource", method: "GET" },
    { path: "/.well-known/oauth-authorization-server", method: "GET" },
    { path: "/oauth/authorize", method: "GET" },
    { path: "/oauth/token", method: "POST", body: {} },
    { path: "/oauth/register", method: "POST", body: {} },
  ];
  const secret: Probe = { path: "/api/mcp/s/acm_bogusExposureSpecToken", method: "POST", body: { jsonrpc: "2.0", id: 1, method: "ping" } };

  for (const [label, headers] of Object.entries(TUNNEL_LIKE)) {
    for (const probe of blocked) {
      const res = await send(request, probe, headers);
      expect(res.status(), `${label}: ${probe.method} ${probe.path}`).toBe(404);
      expect(await res.text(), `${label}: ${probe.method} ${probe.path}`).toBe("Not Found");
    }
    const res = await send(request, secret, headers);
    expect([401, 403, 429], `${label}: secret URL reaches the MCP handler`).toContain(res.status());
  }

  // Local: the same routes are served as before (not the filter's 404). Only cheap, side-effect-free ones are called.
  const local = { "x-forwarded-for": "127.0.0.1" };
  expect((await send(request, { path: "/", method: "GET" }, local)).status()).toBe(307);
  expect((await send(request, { path: "/workspace/default", method: "GET" }, local)).status()).toBe(200);
  expect((await send(request, { path: asset, method: "GET" }, local)).status()).toBe(200);
  expect((await send(request, { path: "/api/embed/check?url=not-a-url", method: "GET" }, local)).status()).toBe(400);
  expect((await send(request, { path: "/api/mcp/bridge", method: "GET" }, local)).status()).toBe(403); // owner gate: not same-origin
});
