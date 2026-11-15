/**
 * HTTP exposure filter (2026-11-15; see "HTTP exposure filter" in .ai/docs/chatgpt-mcp-architecture-and-test-plan.md).
 *
 * The local app (dev server, desktop build) is meant for this machine only. When the MCP test exposes it through a
 * tunnel (`ngrok http 3000`), only the MCP client endpoints may be reachable from outside: everything else — pages,
 * `_next` assets, the AI routes, `/api/embed/check` (fetches arbitrary URLs server-side), chat import, the tab's MCP
 * relay (`/api/mcp/bridge`) and credential management (`/api/mcp/access`) — answers a plain 404 to any request that is
 * not demonstrably local (`nonLocalReason`, src/app/api/ai/localTrust.ts), before any route code runs (src/proxy.ts).
 * Local requests are never affected.
 *
 * The one opt-out is `ACUTE_HTTP_EXPOSURE=public`, for a deployment that is meant to be public (the hosted App Hosting
 * build, apphosting.yaml). Anything else, including unset, is local-only: fail closed.
 */
import { nonLocalReason } from "@/app/api/ai/localTrust";
import { isMcpOAuthEnabled } from "@/config/features";

export interface ExternalRoute {
  /** Matched against the whole raw (still percent-encoded) pathname. */
  pattern: RegExp;
  methods: readonly string[];
  /** Reachable from outside only while the MCP OAuth flow is on (`isMcpOAuthEnabled`). */
  oauthOnly: boolean;
}

/**
 * Every path a request that is not demonstrably local may reach. Keep this list short; anything not on it is a 404.
 *
 * - `/api/mcp/s/<token>` — the secret-URL endpoint ChatGPT uses ("No authentication"). POST carries JSON-RPC, DELETE
 *   ends a session; GET is let through only so the handler can answer the Streamable-HTTP "no server stream" 405 —
 *   a 404 there would read to a client as "session gone". The token segment is base64url (`acm_…`), nothing else.
 * - `/api/mcp` — bearer/OAuth endpoint. Bearer clients (Claude Code, Codex) run on this machine and reach it on
 *   loopback, so from outside it is needed only for OAuth access tokens: OAuth-only.
 * - OAuth discovery, registration, authorization and token endpoints — OAuth-only. The authorize page is served
 *   inline by its route (no `_next` assets), so it works through the tunnel without opening the app.
 */
export const EXTERNALLY_REACHABLE: readonly ExternalRoute[] = [
  { pattern: /^\/api\/mcp\/s\/[A-Za-z0-9_-]{1,200}$/, methods: ["POST", "GET", "DELETE"], oauthOnly: false },
  { pattern: /^\/api\/mcp$/, methods: ["POST", "GET", "DELETE"], oauthOnly: true },
  { pattern: /^\/\.well-known\/oauth-protected-resource(\/[A-Za-z0-9_./-]*)?$/, methods: ["GET"], oauthOnly: true },
  { pattern: /^\/\.well-known\/oauth-authorization-server(\/[A-Za-z0-9_./-]*)?$/, methods: ["GET"], oauthOnly: true },
  { pattern: /^\/oauth\/authorize$/, methods: ["GET", "POST"], oauthOnly: true },
  { pattern: /^\/oauth\/token$/, methods: ["POST"], oauthOnly: true },
  { pattern: /^\/oauth\/register$/, methods: ["POST"], oauthOnly: true },
];

/** Whether a request that is NOT demonstrably local may reach `pathname` with `method`. Pure. */
export function isExternallyReachable(pathname: string, method: string, options: { oauth: boolean }): boolean {
  const m = method.toUpperCase();
  return EXTERNALLY_REACHABLE.some((r) => (!r.oauthOnly || options.oauth) && r.methods.includes(m) && r.pattern.test(pathname));
}

/** `ACUTE_HTTP_EXPOSURE=public` turns the filter off (a deliberately public deployment). Read per request. */
export function isPublicExposure(): boolean {
  return process.env.ACUTE_HTTP_EXPOSURE === "public";
}

/** True when this request must be refused: local-only mode and the request is not demonstrably from this machine. */
export function isRefusedNonLocal(headers: Headers): boolean {
  return !isPublicExposure() && nonLocalReason(headers) !== null;
}

/** The same bare 404 an unknown route gives: says nothing about what exists. */
export function notFound(): Response {
  return new Response("Not Found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/** The filter's decision for one request: `null` lets it through, otherwise the response to send instead. */
export function exposureRefusal(pathname: string, method: string, headers: Headers): Response | null {
  if (!isRefusedNonLocal(headers)) return null;
  return isExternallyReachable(pathname, method, { oauth: isMcpOAuthEnabled() }) ? null : notFound();
}
