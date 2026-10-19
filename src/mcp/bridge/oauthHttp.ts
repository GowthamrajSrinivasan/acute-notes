/**
 * HTTP side of the OAuth flow (`oauth.ts`), for ChatGPT's "OAuth" connector mode. Every handler is gated by
 * `MCP_FEATURE` *and* `MCP_OAUTH_FEATURE` *and* `MCP_PUBLIC_BASE_URL` (`mcpOAuthDisabledResponse`): with any of them
 * missing the routes are 404, so enabling MCP never enables OAuth by accident.
 *
 * All URLs in the metadata come from `MCP_PUBLIC_BASE_URL`, never from the request's Host header.
 */
import { mcpOAuthDisabledResponse } from "@/config/features";
import { clientAddress } from "./http";
import { OAUTH_SCOPES, parseScope, publicBaseUrl, scopeString, type OAuthError } from "./oauth";
import { getMcpServices, type McpServices } from "./store";

const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" } as const;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
const oauthError = (e: OAuthError, status = 400) => json({ error: e.error, error_description: e.description }, status);

/** The canonical resource identifier clients bind tokens to. */
export const resourceUrl = (base: string) => `${base}/api/mcp`;

export function protectedResourceMetadata(): Response {
  const off = mcpOAuthDisabledResponse();
  if (off) return off;
  const base = publicBaseUrl()!;
  return json({ resource: resourceUrl(base), authorization_servers: [base], scopes_supported: [...OAUTH_SCOPES], bearer_methods_supported: ["header"] }, 200, { "cache-control": "public, max-age=300" });
}

export function authorizationServerMetadata(): Response {
  const off = mcpOAuthDisabledResponse();
  if (off) return off;
  const base = publicBaseUrl()!;
  return json(
    {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...OAUTH_SCOPES],
      // RFC 9207: every authorization response carries `iss`.
      authorization_response_iss_parameter_supported: true,
    },
    200,
    { "cache-control": "public, max-age=300" },
  );
}

function throttled(req: Request, services: McpServices): Response | null {
  return services.limits.failures.blocked(clientAddress(req)) ? new Response("Too Many Requests", { status: 429, headers: { "retry-after": "300" } }) : null;
}

export async function registerClient(req: Request, services: McpServices = getMcpServices()): Promise<Response> {
  const off = mcpOAuthDisabledResponse();
  if (off) return off;
  const limited = throttled(req, services);
  if (limited) return limited;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return oauthError({ error: "invalid_client_metadata", description: "Expected a JSON body." });
  }
  const result = services.oauth.registerClient(body);
  if ("error" in result) {
    services.limits.failures.hit(clientAddress(req));
    return oauthError(result);
  }
  return json(
    {
      client_id: result.clientId,
      client_name: result.name,
      redirect_uris: result.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

// ── the approval page ──────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The approval page must not be framed (clickjacking) and leaks nothing through referrers. Its CSP `form-action` must
 * also allow the *client's registered redirect origin*: browsers apply `form-action` to the redirect that follows a
 * form POST, so with `'self'` alone the 302 back to the client (e.g. https://chatgpt.com/...) is blocked and the
 * connection never completes. Only the origin of an already-validated, registered redirect URI is added.
 */
function pageHeaders(formActionOrigin?: string) {
  return {
    "content-type": "text/html; charset=utf-8",
    ...NO_STORE,
    "x-frame-options": "DENY",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${formActionOrigin ? ` ${formActionOrigin}` : ""}; frame-ancestors 'none'; base-uri 'none'`,
    "referrer-policy": "no-referrer",
  } as const;
}

function page(title: string, body: string, status = 200, formActionOrigin?: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>` +
      `<style>body{font:16px system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 1rem}input[type=text]{font:inherit;padding:.5rem;width:100%;box-sizing:border-box;letter-spacing:.15em;text-transform:uppercase}button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}.err{color:#b00020}</style>` +
      `</head><body>${body}</body></html>`,
    { status, headers: pageHeaders(formActionOrigin) },
  );
}

interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scope: string | null;
  resource: string | null;
}

/** Redirects back to the client with an authorization response — always carrying `iss` (RFC 9207), success or error. */
function redirectBack(redirectUri: string, base: string, params: Record<string, string | null>): Response {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
  url.searchParams.set("iss", base);
  return new Response(null, { status: 302, headers: { location: url.toString(), ...NO_STORE } });
}

/** Validates the authorization request. A bad client or redirect URI shows an error page (never redirects there); other faults redirect with an error. */
function checkAuthorize(get: (k: string) => string | null, services: McpServices): { ok: true; params: AuthorizeParams; clientName: string; scope: "read" | "propose" } | { ok: false; response: Response } {
  const base = publicBaseUrl()!;
  const client = services.oauth.client(get("client_id"));
  const redirectUri = get("redirect_uri");
  if (!client || !redirectUri || !client.redirectUris.includes(redirectUri)) {
    return { ok: false, response: page("Can't authorize", `<h1>Can't authorize</h1><p class="err">This request names an unknown application or redirect address.</p>`, 400) };
  }
  const state = get("state");
  const fail = (error: string, description: string): { ok: false; response: Response } => ({ ok: false, response: redirectBack(redirectUri, base, { error, error_description: description, state }) });
  if (get("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");
  const challenge = get("code_challenge");
  if (!challenge || get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return fail("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  const scope = parseScope(get("scope"));
  if (!scope) return fail("invalid_scope", "Unsupported scope.");
  const resource = get("resource");
  if (resource && resource !== resourceUrl(base)) return fail("invalid_target", "Unknown resource.");
  return { ok: true, params: { clientId: client.clientId, redirectUri, state, codeChallenge: challenge, scope: get("scope"), resource }, clientName: client.name, scope };
}

const HIDDEN = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type", "scope", "resource"] as const;

function form(get: (k: string) => string | null, clientName: string, scope: "read" | "propose", error?: string): Response {
  // `redirect_uri` was checked against the client's registered URIs before we get here.
  const redirectOrigin = new URL(get("redirect_uri")!).origin;
  const hidden = HIDDEN.map((k) => (get(k) === null ? "" : `<input type="hidden" name="${k}" value="${esc(get(k)!)}">`)).join("");
  const access = scope === "propose" ? "read your workspace and propose changes (you review and accept each one on the canvas)" : "read your workspace";
  return page(
    "Connect to Acute-Notes",
    `<h1>Connect to Acute-Notes</h1><p><strong>${esc(clientName)}</strong> wants to ${access}.</p>` +
      `<p>In Acute-Notes open ⋮ → MCP access and copy the <em>pairing code</em>, then enter it here to approve. Only the workspace's owner can do this.</p>` +
      (error ? `<p class="err">${esc(error)}</p>` : "") +
      `<form method="post">${hidden}<p><input type="text" name="pairing_code" autocomplete="off" autofocus required maxlength="16" aria-label="Pairing code"></p><button type="submit" name="decision" value="approve">Approve</button><button type="submit" name="decision" value="deny" formnovalidate>Deny</button></form>`,
    200,
    redirectOrigin,
  );
}

export function authorizeGet(req: Request, services: McpServices = getMcpServices()): Response {
  const off = mcpOAuthDisabledResponse();
  if (off) return off;
  const q = new URL(req.url).searchParams;
  const checked = checkAuthorize((k) => q.get(k), services);
  return checked.ok ? form((k) => q.get(k), checked.clientName, checked.scope) : checked.response;
}

export async function authorizePost(req: Request, services: McpServices = getMcpServices()): Promise<Response> {
  const off = mcpOAuthDisabledResponse();
  if (off) return off;
  const limited = throttled(req, services);
  if (limited) return limited;
  const data = await req.formData().catch(() => null);
  if (!data) return page("Can't authorize", `<p class="err">Bad request.</p>`, 400);
  const get = (k: string) => (typeof data.get(k) === "string" ? (data.get(k) as string) : null);
  const checked = checkAuthorize(get, services);
  if (!checked.ok) return checked.response;
  const base = publicBaseUrl()!;
  const { params, scope } = checked;

  if (get("decision") === "deny") return redirectBack(params.redirectUri, base, { error: "access_denied", state: params.state });

  const workspaceId = services.credentials.redeemPairingCode(get("pairing_code") ?? "");
  if (!workspaceId) {
    services.limits.failures.hit(clientAddress(req));
    return form(get, checked.clientName, scope, "That code isn't valid or has expired. Get a new one in Acute-Notes (⋮ → MCP access).");
  }
  const code = services.oauth.createCode({ clientId: params.clientId, redirectUri: params.redirectUri, codeChallenge: params.codeChallenge, workspaceId, scope, resource: params.resource });
  return redirectBack(params.redirectUri, base, { code, state: params.state });
}

// ── token endpoint ─────────────────────────────────────────────────────────────────────────────────

export async function token(req: Request, services: McpServices = getMcpServices()): Promise<Response> {
  const off = mcpOAuthDisabledResponse();
  if (off) return off;
  const limited = throttled(req, services);
  if (limited) return limited;
  const data = await req.formData().catch(() => null);
  const get = (k: string) => (data && typeof data.get(k) === "string" ? (data.get(k) as string) : "");
  const base = publicBaseUrl()!;
  const resource = get("resource") || null;
  if (resource && resource !== resourceUrl(base)) return oauthError({ error: "invalid_target", description: "Unknown resource." });

  let result;
  switch (get("grant_type")) {
    case "authorization_code":
      result = services.oauth.exchangeCode({ code: get("code"), clientId: get("client_id"), redirectUri: get("redirect_uri"), codeVerifier: get("code_verifier"), resource });
      break;
    case "refresh_token":
      result = services.oauth.refreshTokens({ refreshToken: get("refresh_token"), clientId: get("client_id") });
      break;
    default:
      return oauthError({ error: "unsupported_grant_type", description: "Use authorization_code or refresh_token." });
  }
  if ("error" in result) {
    services.limits.failures.hit(clientAddress(req));
    return oauthError(result, 400);
  }
  return json(result);
}

export { scopeString };
