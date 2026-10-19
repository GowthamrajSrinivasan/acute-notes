/**
 * Server-issued credentials for MCP clients, one set per workspace (proof of concept: in memory).
 *
 * - The server mints every credential (32 CSPRNG bytes); only its SHA-256 is kept, so a leaked store reveals no
 *   usable token. The plaintext is returned once, at issue.
 * - A credential is bound to one workspace and one scope at issue time. `authenticate` returns that binding; nothing
 *   a client sends can pick a different workspace.
 * - "Workspace" here is an opaque key chosen by the caller of `issue` (the owner routes pass a namespace derived from
 *   the owner's secret, `owner.ts#ownerKey`), so there is no workspace-name claiming to squat on or lose.
 * - Credentials expire and can be revoked at once; revocation tells listeners so live sessions end.
 *
 * Framework-free so it can be unit-tested directly.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { McpScope } from "./protocol";

export type CredentialKind = "bearer" | "secret-url" | "oauth";

export interface Principal {
  workspaceId: string;
  credentialId: string;
  kind: CredentialKind;
  scope: McpScope;
}

export interface CredentialInfo {
  id: string;
  kind: CredentialKind;
  scope: McpScope;
  createdAt: number;
  expiresAt: number | null;
  lastUsed: number | null;
}

interface Stored extends CredentialInfo {
  workspaceId: string;
  hash: string;
}

export const TOKEN_PREFIX = "acm_";
/** A secret URL lives this long unless the owner chooses otherwise. */
export const DEFAULT_SECRET_URL_TTL_MS = 8 * 60 * 60 * 1000;
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function equalHashes(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A fresh opaque token: `acm_` + 32 random bytes, base64url. */
export function mintToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** Crockford-style base32 without ambiguous characters: 8 characters ≈ 40 bits, from the CSPRNG. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
export function mintPairingCode(): string {
  // Rejection sampling: only bytes below the largest multiple of the alphabet size are used, so no character is likelier.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = "";
  while (code.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < limit && code.length < 8) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return code;
}

export class CredentialStore {
  private readonly byId = new Map<string, Stored>();
  private readonly byHash = new Map<string, Stored>();
  private readonly pairing = new Map<string, { workspaceId: string; expiresAt: number }>();
  private readonly revokedListeners = new Set<(workspaceId: string, credentialId: string) => void>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Calls `listener` whenever a credential is revoked or expires on use (so live sessions can end). */
  onRevoked(listener: (workspaceId: string, credentialId: string) => void): () => void {
    this.revokedListeners.add(listener);
    return () => this.revokedListeners.delete(listener);
  }

  // ── credentials ────────────────────────────────────────────────────────────────────────────────

  /** Issues a credential for `workspaceId`; the plaintext token is returned here and never again. */
  issue(workspaceId: string, options: { kind: CredentialKind; scope: McpScope; ttlMs?: number | null }): CredentialInfo & { token: string } {
    const token = mintToken();
    const id = randomBytes(9).toString("base64url");
    const createdAt = this.now();
    const ttl = options.ttlMs === undefined ? (options.kind === "secret-url" ? DEFAULT_SECRET_URL_TTL_MS : null) : options.ttlMs;
    const record: Stored = { id, workspaceId, kind: options.kind, scope: options.scope, hash: sha256(token), createdAt, expiresAt: ttl === null ? null : createdAt + ttl, lastUsed: null };
    this.byId.set(id, record);
    this.byHash.set(record.hash, record);
    return { ...info(record), token };
  }

  /** The principal a token stands for, or null (unknown, revoked, expired, or of another kind than `kinds`). */
  authenticate(token: string | null | undefined, kinds?: readonly CredentialKind[]): Principal | null {
    if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
    const record = this.byHash.get(sha256(token));
    if (!record) return null;
    if (kinds && !kinds.includes(record.kind)) return null;
    if (record.expiresAt !== null && record.expiresAt <= this.now()) {
      this.remove(record);
      return null;
    }
    record.lastUsed = this.now();
    return { workspaceId: record.workspaceId, credentialId: record.id, kind: record.kind, scope: record.scope };
  }

  /** Whether credential `id` still exists for `workspaceId` (not revoked, not expired). */
  isValid(workspaceId: string, credentialId: string): boolean {
    const record = this.byId.get(credentialId);
    return !!record && record.workspaceId === workspaceId && (record.expiresAt === null || record.expiresAt > this.now());
  }

  list(workspaceId: string): CredentialInfo[] {
    return [...this.byId.values()].filter((r) => r.workspaceId === workspaceId).map(info);
  }

  /** Revokes one credential of `workspaceId`; false when it doesn't exist there (another workspace's id never matches). */
  revoke(workspaceId: string, credentialId: string): boolean {
    const record = this.byId.get(credentialId);
    if (!record || record.workspaceId !== workspaceId) return false;
    this.remove(record);
    return true;
  }

  /** Revokes every credential of `workspaceId` (of the given kinds, if any). */
  revokeAll(workspaceId: string, kinds?: readonly CredentialKind[]): number {
    let n = 0;
    for (const record of [...this.byId.values()]) {
      if (record.workspaceId !== workspaceId || (kinds && !kinds.includes(record.kind))) continue;
      this.remove(record);
      n++;
    }
    return n;
  }

  private remove(record: Stored): void {
    this.byId.delete(record.id);
    this.byHash.delete(record.hash);
    for (const l of this.revokedListeners) l(record.workspaceId, record.id);
  }

  // ── pairing codes (OAuth approval) ─────────────────────────────────────────────────────────────

  /** A short-lived, single-use code the owner types into the OAuth approval page; it names the workspace to grant. */
  createPairingCode(workspaceId: string): { code: string; expiresAt: number } {
    this.sweepPairing();
    const code = mintPairingCode();
    const expiresAt = this.now() + PAIRING_CODE_TTL_MS;
    this.pairing.set(sha256(code), { workspaceId, expiresAt });
    return { code, expiresAt };
  }

  /** The workspace `code` approves, consuming it; null when unknown or expired. */
  redeemPairingCode(code: string): string | null {
    const key = sha256(String(code).trim().toUpperCase());
    const entry = this.pairing.get(key);
    if (!entry) return null;
    this.pairing.delete(key);
    return entry.expiresAt > this.now() ? entry.workspaceId : null;
  }

  private sweepPairing(): void {
    for (const [k, v] of this.pairing) if (v.expiresAt <= this.now()) this.pairing.delete(k);
  }
}

function info(r: Stored): CredentialInfo {
  return { id: r.id, kind: r.kind, scope: r.scope, createdAt: r.createdAt, expiresAt: r.expiresAt, lastUsed: r.lastUsed };
}
