/** The OAuth flow ChatGPT's "OAuth" mode needs, end to end against in-memory services. Flag-gated: see `features.ts`. */
import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectTab, initialize, request } from "@/testUtils/mcpBridge";
import { handleClientRequest } from "./http";
import { ACCESS_TOKEN_TTL_MS } from "./oauth";
import { authorizationServerMetadata, authorizeGet, authorizePost, protectedResourceMetadata, registerClient, token } from "./oauthHttp";
import { createMcpServices, type McpServices } from "./store";

const BASE = "https://notes.example.com";
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const OWNER = "o".repeat(64);

let services: McpServices;
beforeEach(() => {
  vi.stubEnv("MCP_OAUTH_FEATURE", "on");
  vi.stubEnv("MCP_PUBLIC_BASE_URL", BASE);
  services = createMcpServices();
});
afterEach(() => vi.unstubAllEnvs());

const form = (path: string, fields: Record<string, string>) =>
  new Request(`https://notes.example.com${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", host: "notes.example.com" }, body: new URLSearchParams(fields).toString() });

async function register(redirect = REDIRECT) {
  const res = await registerClient(request("/oauth/register", { host: "notes.example.com", body: { client_name: "ChatGPT", redirect_uris: [redirect], token_endpoint_auth_method: "none" } }), services);
  return { res, body: (await res.json()) as { client_id?: string; error?: string } };
}

const verifier = () => randomBytes(32).toString("base64url");
const challengeOf = (v: string) => createHash("sha256").update(v).digest("base64url");

function authorizeQuery(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", resource: `${BASE}/api/mcp`, ...extra });
}

/** Registers, approves with a pairing code for `workspaceId`, and exchanges the code: the tokens ChatGPT would hold. */
async function connect(workspaceId = "ws_a") {
  const { body } = await register();
  const clientId = body.client_id!;
  const v = verifier();
  const { code: pairing } = services.credentials.createPairingCode(workspaceId);
  const res = await authorizePost(form("/oauth/authorize", { ...Object.fromEntries(authorizeQuery(clientId, challengeOf(v))), pairing_code: pairing, decision: "approve" }), services);
  const location = new URL(res.headers.get("location")!);
  const tokenRes = await token(form("/oauth/token", { grant_type: "authorization_code", code: location.searchParams.get("code")!, client_id: clientId, redirect_uri: REDIRECT, code_verifier: v, resource: `${BASE}/api/mcp` }), services);
  return { clientId, tokens: (await tokenRes.json()) as { access_token: string; refresh_token: string; expires_in: number; scope: string }, res, location, tokenRes };
}

describe("OAuth stays off unless it is explicitly, fully configured", () => {
  it.each([
    ["flag off", () => vi.stubEnv("MCP_OAUTH_FEATURE", "off")],
    ["no public base URL", () => vi.stubEnv("MCP_PUBLIC_BASE_URL", "")],
    ["MCP off", () => vi.stubEnv("MCP_FEATURE", "off")],
  ])("every OAuth endpoint is a 404 with %s", async (_name, turnOff) => {
    turnOff();
    const responses = [
      protectedResourceMetadata(),
      authorizationServerMetadata(),
      await registerClient(request("/oauth/register", { body: { redirect_uris: [REDIRECT] } }), services),
      authorizeGet(request("/oauth/authorize", { method: "GET" }), services),
      await authorizePost(form("/oauth/authorize", {}), services),
      await token(form("/oauth/token", {}), services),
    ];
    expect(responses.map((r) => r.status)).toEqual(Array(6).fill(404));
  });

  it("the 401 only advertises OAuth discovery when OAuth is enabled", async () => {
    connectTab(services, "ws_a");
    const challenge = async () => (await handleClientRequest(request("/api/mcp", { body: initialize() }), { token: null, kinds: ["bearer", "oauth"] }, services)).headers.get("www-authenticate");
    expect(await challenge()).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`);
    vi.stubEnv("MCP_OAUTH_FEATURE", "off");
    expect(await challenge()).toBe("Bearer");
  });
});

describe("discovery metadata (from configuration, never the Host header)", () => {
  it("publishes what OpenAI's connector guide requires", async () => {
    const prm = (await protectedResourceMetadata().json()) as Record<string, unknown>;
    expect(prm).toMatchObject({ resource: `${BASE}/api/mcp`, authorization_servers: [BASE] });
    const asm = (await authorizationServerMetadata().json()) as Record<string, unknown>;
    expect(asm).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      registration_endpoint: `${BASE}/oauth/register`,
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_methods_supported: ["none"],
    });
  });
});

describe("dynamic client registration", () => {
  it("accepts ChatGPT's documented redirect URIs only", async () => {
    expect((await register()).res.status).toBe(201);
    expect((await register("https://chatgpt.com/connector/oauth/abc_123-XYZ")).res.status).toBe(201);
    for (const bad of ["https://evil.example.com/cb", "https://chatgpt.com.evil.test/connector_platform_oauth_redirect", "https://chatgpt.com/connector/oauth/a/b", "http://chatgpt.com/connector_platform_oauth_redirect"]) {
      const { res, body } = await register(bad);
      expect(res.status).toBe(400);
      expect(body.error).toBe("invalid_redirect_uri");
    }
  });

  it("lets the operator add exact extra redirect URIs", async () => {
    vi.stubEnv("MCP_OAUTH_REDIRECT_URIS", "https://staging.example.com/cb");
    expect((await register("https://staging.example.com/cb")).res.status).toBe(201);
    expect((await register("https://staging.example.com/cb2")).res.status).toBe(400);
  });
});

describe("authorization (pairing-code approval)", () => {
  it("shows the approval page for a valid request, with framing and referrer protections", async () => {
    const { body } = await register();
    const res = authorizeGet(request("/oauth/authorize?" + authorizeQuery(body.client_id!, challengeOf(verifier())), { method: "GET", host: "notes.example.com" }), services);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    // Browsers apply form-action to the redirect after the POST: the registered client's origin must be allowed, or the
    // 302 back to ChatGPT is blocked (seen in the real spike). Nothing broader than that one origin.
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("form-action 'self' https://chatgpt.com;");
    expect(csp).not.toMatch(/form-action[^;]*\*/);
    const html = await res.text();
    expect(html).toContain("pairing_code");
    expect(html).toContain("ChatGPT");
  });

  it("never redirects to an unregistered redirect URI or unknown client", async () => {
    const { body } = await register();
    const bad = authorizeGet(request("/oauth/authorize?" + authorizeQuery(body.client_id!, challengeOf(verifier()), { redirect_uri: "https://evil.example.com/cb" }), { method: "GET" }), services);
    expect(bad.status).toBe(400);
    expect(bad.headers.get("location")).toBeNull();
    expect(authorizeGet(request("/oauth/authorize?" + authorizeQuery("cli_unknown", challengeOf(verifier())), { method: "GET" }), services).status).toBe(400);
  });

  it("requires PKCE S256, and reports other request faults to the client with `iss`", async () => {
    const { body } = await register();
    const plain = authorizeGet(request("/oauth/authorize?" + authorizeQuery(body.client_id!, "plain-challenge", { code_challenge_method: "plain" }), { method: "GET" }), services);
    expect(plain.status).toBe(302);
    const loc = new URL(plain.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("invalid_request");
    expect(loc.searchParams.get("iss")).toBe(BASE);
    expect(loc.searchParams.get("state")).toBe("xyz");
    const badScope = authorizeGet(request("/oauth/authorize?" + authorizeQuery(body.client_id!, challengeOf(verifier()), { scope: "admin" }), { method: "GET" }), services);
    expect(new URL(badScope.headers.get("location")!).searchParams.get("error")).toBe("invalid_scope");
    const badResource = authorizeGet(request("/oauth/authorize?" + authorizeQuery(body.client_id!, challengeOf(verifier()), { resource: "https://other.example.com/api/mcp" }), { method: "GET" }), services);
    expect(new URL(badResource.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
  });

  it("a wrong pairing code is refused (and counted); a stranger can't approve", async () => {
    const { body } = await register();
    const fields = { ...Object.fromEntries(authorizeQuery(body.client_id!, challengeOf(verifier()))), decision: "approve" };
    const res = await authorizePost(form("/oauth/authorize", { ...fields, pairing_code: "NOTACODE" }), services);
    expect(res.status).toBe(200); // the form again, with an error
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("isn&#39;t valid"); // escaped in the HTML
  });

  it("deny redirects with access_denied and `iss`", async () => {
    const { body } = await register();
    const res = await authorizePost(form("/oauth/authorize", { ...Object.fromEntries(authorizeQuery(body.client_id!, challengeOf(verifier()))), decision: "deny" }), services);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("iss")).toBe(BASE);
  });

  it("brute-forcing pairing codes gets the address blocked", async () => {
    const { body } = await register();
    const fields = { ...Object.fromEntries(authorizeQuery(body.client_id!, challengeOf(verifier()))), decision: "approve" };
    const attempt = (code: string) => authorizePost(new Request("https://notes.example.com/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", host: "notes.example.com", "x-forwarded-for": "203.0.113.5" }, body: new URLSearchParams({ ...fields, pairing_code: code }) }), services);
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) statuses.push((await attempt(`BAD${i}`)).status);
    expect(statuses.at(-1)).toBe(429);
    // Even the right code is refused from a blocked address.
    expect((await attempt(services.credentials.createPairingCode("ws_a").code)).status).toBe(429);
  });
});

describe("the full flow: register → approve → token → MCP call", () => {
  it("issues an access token bound to the approving workspace, and `iss` on the success redirect", async () => {
    const { location, tokens, tokenRes } = await connect("ws_a");
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("xyz");
    expect(location.searchParams.get("iss")).toBe(BASE);
    expect(tokenRes.headers.get("cache-control")).toBe("no-store");
    expect(tokens.expires_in).toBe(ACCESS_TOKEN_TTL_MS / 1000);
    expect(tokens.scope).toBe("mcp:read mcp:propose");

    const tabA = connectTab(services, "ws_a");
    const tabB = connectTab(services, "ws_b");
    const res = await handleClientRequest(request("/api/mcp", { host: "localhost:3000", headers: { authorization: `Bearer ${tokens.access_token}` }, body: initialize() }), { token: tokens.access_token, kinds: ["bearer", "oauth"] }, services);
    expect(res.status).toBe(200);
    expect(tabA.messages()[0]).toMatchObject({ remote: true, scope: "propose" });
    expect(tabB.messages()).toHaveLength(0);
  });

  it("an OAuth token is not accepted on the secret-URL endpoint", async () => {
    const { tokens } = await connect();
    connectTab(services, "ws_a");
    const res = await handleClientRequest(request("/api/mcp/s/x", { body: initialize() }), { token: tokens.access_token, kinds: ["secret-url"] }, services);
    expect(res.status).toBe(401);
  });

  it("the pairing code is single-use", async () => {
    const { body } = await register();
    const { code } = services.credentials.createPairingCode("ws_a");
    const fields = { ...Object.fromEntries(authorizeQuery(body.client_id!, challengeOf(verifier()))), pairing_code: code, decision: "approve" };
    expect((await authorizePost(form("/oauth/authorize", fields), services)).status).toBe(302);
    expect((await authorizePost(form("/oauth/authorize", fields), services)).status).toBe(200); // second use: form with an error
  });

  it("a read-only request yields a read-only token", async () => {
    const { body } = await register();
    const v = verifier();
    const { code } = services.credentials.createPairingCode("ws_a");
    const res = await authorizePost(form("/oauth/authorize", { ...Object.fromEntries(authorizeQuery(body.client_id!, challengeOf(v), { scope: "mcp:read" })), pairing_code: code, decision: "approve" }), services);
    const authCode = new URL(res.headers.get("location")!).searchParams.get("code")!;
    const t = (await (await token(form("/oauth/token", { grant_type: "authorization_code", code: authCode, client_id: body.client_id!, redirect_uri: REDIRECT, code_verifier: v }), services)).json()) as { access_token: string; scope: string };
    expect(t.scope).toBe("mcp:read");
    expect(services.credentials.authenticate(t.access_token)?.scope).toBe("read");
  });
});

describe("token endpoint", () => {
  async function pending() {
    const { body } = await register();
    const clientId = body.client_id!;
    const v = verifier();
    const { code: pairing } = services.credentials.createPairingCode("ws_a");
    const res = await authorizePost(form("/oauth/authorize", { ...Object.fromEntries(authorizeQuery(clientId, challengeOf(v))), pairing_code: pairing, decision: "approve" }), services);
    return { clientId, v, code: new URL(res.headers.get("location")!).searchParams.get("code")! };
  }
  const exchange = (fields: Record<string, string>) => token(form("/oauth/token", { grant_type: "authorization_code", redirect_uri: REDIRECT, ...fields }), services);

  it("rejects a wrong PKCE verifier, and the code is then spent", async () => {
    const { clientId, v, code } = await pending();
    const wrong = await exchange({ code, client_id: clientId, code_verifier: verifier() });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_grant");
    expect((await exchange({ code, client_id: clientId, code_verifier: v })).status).toBe(400);
  });

  it("rejects a code replayed, or presented by another client or redirect URI", async () => {
    const first = await pending();
    expect((await exchange({ code: first.code, client_id: first.clientId, code_verifier: first.v })).status).toBe(200);
    expect((await exchange({ code: first.code, client_id: first.clientId, code_verifier: first.v })).status).toBe(400);
    const second = await pending();
    const other = (await register()).body.client_id!;
    expect((await exchange({ code: second.code, client_id: other, code_verifier: second.v })).status).toBe(400);
    const third = await pending();
    expect((await token(form("/oauth/token", { grant_type: "authorization_code", code: third.code, client_id: third.clientId, redirect_uri: "https://chatgpt.com/connector/oauth/other", code_verifier: third.v }), services)).status).toBe(400);
  });

  it("rejects a resource other than this server's", async () => {
    const { clientId, v, code } = await pending();
    const res = await exchange({ code, client_id: clientId, code_verifier: v, resource: "https://other.example.com/api/mcp" });
    expect(((await res.json()) as { error: string }).error).toBe("invalid_target");
  });

  it("rejects unsupported grant types", async () => {
    const res = await token(form("/oauth/token", { grant_type: "password", username: "a", password: "b" }), services);
    expect(((await res.json()) as { error: string }).error).toBe("unsupported_grant_type");
  });

  it("expires the access token", async () => {
    let now = 1_000;
    services = createMcpServices(() => now);
    const { tokens } = await connect("ws_a");
    expect(services.credentials.authenticate(tokens.access_token)).not.toBeNull();
    now += ACCESS_TOKEN_TTL_MS + 1;
    expect(services.credentials.authenticate(tokens.access_token)).toBeNull();
  });
});

describe("refresh tokens and revoking a grant", () => {
  const refresh = (clientId: string, refreshToken: string) => token(form("/oauth/token", { grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken }), services);

  it("rotates: a refresh returns a new pair, and the old refresh token is dead", async () => {
    const { clientId, tokens } = await connect();
    const next = (await (await refresh(clientId, tokens.refresh_token)).json()) as { access_token: string; refresh_token: string };
    expect(next.access_token).not.toBe(tokens.access_token);
    expect(services.credentials.authenticate(next.access_token)).not.toBeNull();
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
  });

  it("reuse of a rotated refresh token revokes the whole grant", async () => {
    const { clientId, tokens } = await connect();
    const next = (await (await refresh(clientId, tokens.refresh_token)).json()) as { access_token: string; refresh_token: string };
    const reuse = await refresh(clientId, tokens.refresh_token);
    expect(reuse.status).toBe(400);
    expect(services.credentials.authenticate(next.access_token)).toBeNull();
    expect(services.credentials.authenticate(tokens.access_token)).toBeNull();
    expect((await refresh(clientId, next.refresh_token)).status).toBe(400);
  });

  it("only the client that holds the grant can refresh it", async () => {
    const { tokens } = await connect();
    const stranger = (await register()).body.client_id!;
    expect((await refresh(stranger, tokens.refresh_token)).status).toBe(400);
  });

  it("the owner revoking a grant ends its tokens at once, in its workspace only", async () => {
    const a = await connect("ws_a");
    const b = await connect("ws_b");
    const grantA = services.oauth.grantsOf("ws_a")[0]!;
    expect(services.oauth.revokeGrant("ws_b", grantA.id)).toBe(false); // another workspace's owner can't
    expect(services.credentials.authenticate(a.tokens.access_token)).not.toBeNull();
    expect(services.oauth.revokeGrant("ws_a", grantA.id)).toBe(true);
    expect(services.credentials.authenticate(a.tokens.access_token)).toBeNull();
    expect((await refresh(a.clientId, a.tokens.refresh_token)).status).toBe(400);
    expect(services.credentials.authenticate(b.tokens.access_token)).not.toBeNull();
  });

  it("revoking all of a workspace's credentials includes its OAuth grants", async () => {
    const a = await connect("ws_a");
    services.oauth.revokeWorkspace("ws_a");
    expect(services.credentials.authenticate(a.tokens.access_token)).toBeNull();
    expect((await refresh(a.clientId, a.tokens.refresh_token)).status).toBe(400);
  });
});
