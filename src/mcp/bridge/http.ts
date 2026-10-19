/**
 * The client-facing MCP endpoints' shared request handling (`/api/mcp` with a bearer or OAuth token, and
 * `/api/mcp/s/<token>` with a secret URL). The routes are thin adapters around this, so the same checks run, in the
 * same order, whichever way a client authenticates — and a test can drive it without Next.
 *
 * Order matters: the feature switch (404), host/origin, a block on addresses that keep failing, authentication (the
 * credential decides the workspace — nothing in the request body can), the per-credential rate limit, and only then
 * the relay for *that workspace*.
 *
 * Nothing here logs a token or a secret URL; errors never echo one.
 */
import { isMcpOAuthEnabled, mcpFeatureDisabledResponse } from "@/config/features";
import type { CredentialKind } from "./credentials";
import { publicBaseUrl } from "./oauth";
import { isAllowedHost, isAllowedOrigin, isLoopbackHost, NOT_CONNECTED_MESSAGE, RELAY_ERRORS } from "./relay";
import { getMcpServices, type McpServices } from "./store";

const SAFE_HEADERS = { "cache-control": "no-store", "referrer-policy": "no-referrer" } as const;

/** A JSON-RPC error body, as the relay produces. */
const rpc = (code: number, message: string) => ({ jsonrpc: "2.0", id: null, error: { code, message } });

export function clientAddress(req: Request): string {
  // Behind a proxy/tunnel this header is set by it; for rate limiting only, never for authorization.
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...SAFE_HEADERS, ...headers } });
}

export function bearerOf(req: Request): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  return match ? match[1]! : null;
}

export interface ClientAuth {
  /** The presented token (a bearer header, or the secret-URL path segment). */
  token: string | null;
  /** The credential kinds this endpoint accepts. */
  kinds: readonly CredentialKind[];
}

export async function handleClientRequest(req: Request, auth: ClientAuth, services: McpServices = getMcpServices()): Promise<Response> {
  const disabled = mcpFeatureDisabledResponse();
  if (disabled) return disabled;

  const host = req.headers.get("host");
  if (!isAllowedHost(host) || !isAllowedOrigin(req.headers.get("origin"))) return new Response("Forbidden", { status: 403 });

  const address = clientAddress(req);
  if (services.limits.failures.blocked(address)) return json(rpc(-32000, "Too many failed attempts; try again later."), 429, { "retry-after": "300" });

  const principal = services.credentials.authenticate(auth.token, auth.kinds);
  if (!principal) {
    services.limits.failures.hit(address);
    const oauth = auth.kinds.includes("oauth") && isMcpOAuthEnabled();
    const base = publicBaseUrl();
    const challenge = oauth && base ? `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` : "Bearer";
    return json(rpc(-32001, "Unauthorized."), 401, { "www-authenticate": challenge });
  }
  if (!services.limits.requests.hit(principal.credentialId)) return json(rpc(-32000, "Rate limit exceeded."), 429, { "retry-after": "30" });

  // The workspace comes from the credential, never from the request.
  const relay = services.relays.existing(principal.workspaceId);
  if (!relay?.connected) return json(rpc(RELAY_ERRORS.notConnected, NOT_CONNECTED_MESSAGE), 503, { "retry-after": "5" });
  const caller = { credentialId: principal.credentialId, remote: principal.kind !== "bearer" || !isLoopbackHost(host), scope: principal.scope };

  switch (req.method) {
    case "POST": {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json(rpc(-32700, "Parse error"), 400);
      }
      const reply = await relay.fromClient(body, req.headers.get("mcp-session-id"), caller);
      return reply.body === undefined ? new Response(null, { status: reply.status, headers: { ...SAFE_HEADERS, ...reply.headers } }) : json(reply.body, reply.status, reply.headers);
    }
    case "DELETE":
      return new Response(null, { status: relay.endSession(req.headers.get("mcp-session-id"), principal.credentialId) ? 200 : 404, headers: SAFE_HEADERS });
    default:
      // No server → client stream is offered (allowed by the Streamable HTTP spec).
      return new Response("Method Not Allowed", { status: 405, headers: { ...SAFE_HEADERS, allow: "POST, DELETE" } });
  }
}
