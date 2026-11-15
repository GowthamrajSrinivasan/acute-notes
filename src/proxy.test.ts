import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "./proxy";

const ORIGIN = "http://localhost:3000";
const SECRET = "/api/mcp/s/acm_bogusTokenForProxyTest";

const BLOCKED: [string, string][] = [
  ["/", "GET"],
  ["/workspace/default/canvas-1", "GET"],
  ["/_next/static/chunks/main-app.js", "GET"],
  ["/api/ai/run", "POST"],
  ["/api/ai/stream", "POST"],
  ["/api/ai/models", "GET"],
  ["/api/ai/decide", "POST"],
  ["/api/embed/check?url=http%3A%2F%2F169.254.169.254%2F", "GET"],
  ["/api/import/chat-share", "POST"],
  ["/api/mcp/bridge", "GET"],
  ["/api/mcp/bridge", "POST"],
  ["/api/mcp/access", "POST"],
  ["/api/mcp", "POST"],
  ["/.well-known/oauth-protected-resource", "GET"],
  ["/.well-known/oauth-authorization-server", "GET"],
  ["/oauth/authorize", "GET"],
  ["/oauth/token", "POST"],
  ["/oauth/register", "POST"],
];

const TUNNEL_LIKE: Record<string, Record<string, string>> = {
  "ngrok Host": { host: "abc.ngrok-free.app", "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https" },
  "x-forwarded-for": { host: "localhost:3000", "x-forwarded-for": "203.0.113.7" },
  "x-forwarded-host": { host: "localhost:3000", "x-forwarded-host": "abc.ngrok-free.app" },
  forwarded: { host: "localhost:3000", forwarded: "for=203.0.113.7" },
  "LAN Host": { host: "192.168.31.30:3000", "x-forwarded-for": "192.168.31.40" },
};

function req(path: string, method: string, headers: Record<string, string>): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, { method, headers, ...(method === "POST" ? { body: "{}" } : {}) });
}

/** NextResponse.next() marks "continue" with this header; a refusal is a plain 404 without it. */
const passed = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy (HTTP exposure filter)", () => {
  afterEach(() => vi.unstubAllEnvs());

  for (const [label, headers] of Object.entries(TUNNEL_LIKE)) {
    it(`${label}: blocks every unrelated route with a bare 404 and lets the secret URL through`, async () => {
      for (const [path, method] of BLOCKED) {
        const res = proxy(req(path, method, headers));
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(passed(res), `${method} ${path}`).toBe(false);
        expect(await res.text()).toBe("Not Found");
      }
      for (const method of ["POST", "GET", "DELETE"]) expect(passed(proxy(req(SECRET, method, headers))), method).toBe(true);
      expect(proxy(req(SECRET, "PUT", headers)).status).toBe(404);
    });
  }

  it("local requests pass for every route", () => {
    for (const [path, method] of [...BLOCKED, [SECRET, "POST"] as [string, string]]) {
      expect(passed(proxy(req(path, method, { host: "localhost:3000", "x-forwarded-for": "::1" }))), `${method} ${path}`).toBe(true);
      expect(passed(proxy(req(path, method, { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-origin" }))), `${method} ${path}`).toBe(true);
    }
  });
});
