/**
 * OAuth 2.1 authorization server for ChatGPT's "OAuth" connector mode (proof of concept: in memory, behind
 * `MCP_OAUTH_FEATURE`). Not a general-purpose server: it supports exactly what ChatGPT's published connector authentication guide describes —
 * dynamic client registration, authorization code + PKCE (S256 only), RFC 9207 issuer identification, a `resource`
 * indicator, and rotating refresh tokens — and binds every grant to one workspace.
 *
 * Approval is by pairing code: the workspace owner reads a short single-use code in their own Acute-Notes tab and
 * types it on the approval page, so a stranger who finds the public URL can't authorize themselves. Access tokens are
 * ordinary credentials of kind "oauth" (`credentials.ts`), so they carry the same workspace binding, expiry and
 * revocation as every other credential.
 *
 * PoC limits (not production-ready): in-memory state is lost on restart; no client-metadata-document (CIMD) support;
 * the pairing code has ~40 bits and relies on the route's rate limits.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { CredentialStore } from "./credentials";
import type { McpScope } from "./protocol";

export const OAUTH_SCOPES = ["mcp:read", "mcp:propose"] as const;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CLIENTS = 200;
const REFRESH_PREFIX = "acr_";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const randomToken = (prefix = "") => prefix + randomBytes(32).toString("base64url");

/** The redirect URIs ChatGPT is documented to use, plus any exact extras the operator configures. */
export function isAllowedRedirectUri(uri: string): boolean {
  if (uri === "https://chatgpt.com/connector_platform_oauth_redirect") return true;
  if (/^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/.test(uri)) return true;
  return (process.env.MCP_OAUTH_REDIRECT_URIS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .includes(uri);
}

/** The server's public https origin (config, never the request), without a trailing slash; null when unset. */
export function publicBaseUrl(): string | null {
  const raw = process.env.MCP_PUBLIC_BASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: number;
}

interface AuthCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  workspaceId: string;
  scope: McpScope;
  resource: string | null;
  expiresAt: number;
}

export interface Grant {
  id: string;
  workspaceId: string;
  clientId: string;
  clientName: string;
  scope: McpScope;
  resource: string | null;
  createdAt: number;
  revoked: boolean;
  credentialIds: Set<string>;
}

interface RefreshRecord {
  grantId: string;
  expiresAt: number;
  used: boolean;
}

export type OAuthError = { error: string; description: string };
export type TokenResponse = { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string };

export function scopeString(scope: McpScope): string {
  return scope === "propose" ? "mcp:read mcp:propose" : "mcp:read";
}

/** The workspace permission a requested scope string asks for; null when it asks for something unsupported. */
export function parseScope(requested: string | null | undefined): McpScope | null {
  const parts = (requested ?? "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "propose"; // default: full read access, and proposals for the owner's review
  if (!parts.every((p) => (OAUTH_SCOPES as readonly string[]).includes(p))) return null;
  return parts.includes("mcp:propose") ? "propose" : "read";
}

export class OAuthStore {
  private readonly clients = new Map<string, OAuthClient>();
  private readonly codes = new Map<string, AuthCode>();
  private readonly grants = new Map<string, Grant>();
  private readonly refresh = new Map<string, RefreshRecord>();

  constructor(
    private readonly credentials: CredentialStore,
    private readonly now: () => number = Date.now,
  ) {}

  // ── registration (RFC 7591) ────────────────────────────────────────────────────────────────────

  registerClient(metadata: unknown): OAuthClient | OAuthError {
    const m = typeof metadata === "object" && metadata !== null ? (metadata as Record<string, unknown>) : {};
    const uris = Array.isArray(m.redirect_uris) ? m.redirect_uris : [];
    if (!uris.length || uris.length > 5 || !uris.every((u) => typeof u === "string" && u.length < 512)) {
      return { error: "invalid_redirect_uri", description: "redirect_uris must list one to five URIs." };
    }
    if (!(uris as string[]).every(isAllowedRedirectUri)) return { error: "invalid_redirect_uri", description: "A redirect URI isn't one this server accepts." };
    const method = m.token_endpoint_auth_method;
    if (method !== undefined && method !== "none") return { error: "invalid_client_metadata", description: "Only token_endpoint_auth_method \"none\" (PKCE public clients) is supported." };
    if (this.clients.size >= MAX_CLIENTS) {
      const oldest = [...this.clients.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) this.clients.delete(oldest.clientId);
    }
    const client: OAuthClient = {
      clientId: randomToken("cli_"),
      name: typeof m.client_name === "string" ? m.client_name.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, 80) || "MCP client" : "MCP client",
      redirectUris: uris as string[],
      createdAt: this.now(),
    };
    this.clients.set(client.clientId, client);
    return client;
  }

  client(clientId: string | null | undefined): OAuthClient | null {
    return (clientId && this.clients.get(clientId)) || null;
  }

  // ── authorization ──────────────────────────────────────────────────────────────────────────────

  /** After the owner approved with a pairing code: a single-use authorization code bound to the request's PKCE challenge. */
  createCode(input: { clientId: string; redirectUri: string; codeChallenge: string; workspaceId: string; scope: McpScope; resource: string | null }): string {
    this.sweep();
    const code = randomToken("acc_");
    this.codes.set(sha256(code), { ...input, expiresAt: this.now() + AUTH_CODE_TTL_MS });
    return code;
  }

  // ── token endpoint ─────────────────────────────────────────────────────────────────────────────

  exchangeCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string | null }): TokenResponse | OAuthError {
    const key = sha256(input.code);
    const entry = this.codes.get(key);
    this.codes.delete(key); // single use, whatever happens next
    if (!entry || entry.expiresAt <= this.now()) return { error: "invalid_grant", description: "Unknown or expired authorization code." };
    if (entry.clientId !== input.clientId || entry.redirectUri !== input.redirectUri) return { error: "invalid_grant", description: "The code was issued to a different client or redirect URI." };
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) return { error: "invalid_grant", description: "Invalid code_verifier." };
    const computed = createHash("sha256").update(input.codeVerifier).digest("base64url");
    const a = Buffer.from(computed);
    const b = Buffer.from(entry.codeChallenge);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: "invalid_grant", description: "PKCE verification failed." };
    if (input.resource && entry.resource && input.resource !== entry.resource) return { error: "invalid_target", description: "resource doesn't match the authorization request." };

    const client = this.clients.get(entry.clientId);
    const grant: Grant = {
      id: randomBytes(9).toString("base64url"),
      workspaceId: entry.workspaceId,
      clientId: entry.clientId,
      clientName: client?.name ?? "MCP client",
      scope: entry.scope,
      resource: entry.resource,
      createdAt: this.now(),
      revoked: false,
      credentialIds: new Set(),
    };
    this.grants.set(grant.id, grant);
    return this.mint(grant);
  }

  refreshTokens(input: { refreshToken: string; clientId: string }): TokenResponse | OAuthError {
    const key = sha256(input.refreshToken);
    const record = this.refresh.get(key);
    if (!record) return { error: "invalid_grant", description: "Unknown refresh token." };
    const grant = this.grants.get(record.grantId);
    if (!grant || grant.revoked || grant.clientId !== input.clientId || record.expiresAt <= this.now()) return { error: "invalid_grant", description: "The grant is no longer valid." };
    if (record.used) {
      // A rotated token presented again: assume it leaked and end the whole grant.
      this.revokeGrant(grant.workspaceId, grant.id);
      return { error: "invalid_grant", description: "Refresh token reuse detected; the grant was revoked." };
    }
    record.used = true;
    return this.mint(grant);
  }

  private mint(grant: Grant): TokenResponse {
    const access = this.credentials.issue(grant.workspaceId, { kind: "oauth", scope: grant.scope, ttlMs: ACCESS_TOKEN_TTL_MS });
    grant.credentialIds.add(access.id);
    const refreshToken = randomToken(REFRESH_PREFIX);
    this.refresh.set(sha256(refreshToken), { grantId: grant.id, expiresAt: this.now() + REFRESH_TOKEN_TTL_MS, used: false });
    return { access_token: access.token, token_type: "Bearer", expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000), refresh_token: refreshToken, scope: scopeString(grant.scope) };
  }

  // ── owner management ───────────────────────────────────────────────────────────────────────────

  grantsOf(workspaceId: string): { id: string; clientName: string; scope: McpScope; createdAt: number; revoked: boolean }[] {
    return [...this.grants.values()].filter((g) => g.workspaceId === workspaceId && !g.revoked).map(({ id, clientName, scope, createdAt, revoked }) => ({ id, clientName, scope, createdAt, revoked }));
  }

  /** Ends one grant of `workspaceId`: its access tokens stop working and its refresh tokens are refused. */
  revokeGrant(workspaceId: string, grantId: string): boolean {
    const grant = this.grants.get(grantId);
    if (!grant || grant.workspaceId !== workspaceId) return false;
    grant.revoked = true;
    for (const id of grant.credentialIds) this.credentials.revoke(workspaceId, id);
    return true;
  }

  revokeWorkspace(workspaceId: string): number {
    let n = 0;
    for (const grant of this.grants.values()) if (grant.workspaceId === workspaceId && !grant.revoked && this.revokeGrant(workspaceId, grant.id)) n++;
    return n;
  }

  private sweep(): void {
    for (const [k, v] of this.codes) if (v.expiresAt <= this.now()) this.codes.delete(k);
  }
}
