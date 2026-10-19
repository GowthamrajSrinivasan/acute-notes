import { describe, expect, it, vi } from "vitest";
import { CredentialStore, DEFAULT_SECRET_URL_TTL_MS, PAIRING_CODE_TTL_MS, TOKEN_PREFIX, mintPairingCode, mintToken } from "./credentials";
import { RateLimiter } from "./rateLimit";

describe("CredentialStore", () => {
  it("mints unpredictable, distinct tokens from the CSPRNG (32 bytes, base64url)", () => {
    const tokens = new Set(Array.from({ length: 200 }, mintToken));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(t).toMatch(new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`));
    for (let i = 0; i < 50; i++) expect(mintPairingCode()).toMatch(/^[A-HJKMNP-TV-Z2-9]{8}$/);
  });

  it("returns a credential's plaintext once, and authenticates it to the workspace and scope it was issued for", () => {
    const store = new CredentialStore();
    const issued = store.issue("ws_a", { kind: "bearer", scope: "propose" });
    expect(store.authenticate(issued.token)).toEqual({ workspaceId: "ws_a", credentialId: issued.id, kind: "bearer", scope: "propose" });
    // The listing (what the owner sees later) never contains the token.
    expect(JSON.stringify(store.list("ws_a"))).not.toContain(issued.token);
    expect(store.list("ws_b")).toEqual([]);
  });

  it("refuses unknown, malformed, or wrong-kind tokens", () => {
    const store = new CredentialStore();
    const bearer = store.issue("ws_a", { kind: "bearer", scope: "propose" });
    for (const bad of [null, undefined, "", "acm_", "acm_nope", bearer.token.slice(0, -1), bearer.token + "x", "x".repeat(500)]) expect(store.authenticate(bad)).toBeNull();
    expect(store.authenticate(bearer.token, ["secret-url"])).toBeNull();
    expect(store.authenticate(bearer.token, ["bearer", "oauth"])).not.toBeNull();
  });

  it("expires credentials (secret URLs by default) and reports it", () => {
    let now = 1_000;
    const store = new CredentialStore(() => now);
    const url = store.issue("ws_a", { kind: "secret-url", scope: "read" });
    expect(url.expiresAt).toBe(1_000 + DEFAULT_SECRET_URL_TTL_MS);
    expect(store.issue("ws_a", { kind: "bearer", scope: "propose" }).expiresAt).toBeNull();
    const revoked = vi.fn();
    store.onRevoked(revoked);
    now += DEFAULT_SECRET_URL_TTL_MS - 1;
    expect(store.authenticate(url.token)).not.toBeNull();
    now += 2;
    expect(store.authenticate(url.token)).toBeNull();
    expect(revoked).toHaveBeenCalledWith("ws_a", url.id);
  });

  it("revokes at once, only within its own workspace, and tells listeners", () => {
    const store = new CredentialStore();
    const a = store.issue("ws_a", { kind: "bearer", scope: "propose" });
    const b = store.issue("ws_b", { kind: "bearer", scope: "propose" });
    const revoked = vi.fn();
    store.onRevoked(revoked);
    expect(store.revoke("ws_b", a.id)).toBe(false); // another workspace's owner can't revoke it
    expect(store.authenticate(a.token)).not.toBeNull();
    expect(store.revoke("ws_a", a.id)).toBe(true);
    expect(store.authenticate(a.token)).toBeNull();
    expect(revoked).toHaveBeenCalledWith("ws_a", a.id);
    expect(store.authenticate(b.token)).not.toBeNull();
    expect(store.revokeAll("ws_b")).toBe(1);
    expect(store.authenticate(b.token)).toBeNull();
  });

  it("pairing codes are single-use, expire, and name their workspace", () => {
    let now = 0;
    const store = new CredentialStore(() => now);
    const { code } = store.createPairingCode("ws_a");
    expect(store.redeemPairingCode("WRONG123")).toBeNull();
    expect(store.redeemPairingCode(code.toLowerCase())).toBe("ws_a");
    expect(store.redeemPairingCode(code)).toBeNull(); // used
    const second = store.createPairingCode("ws_b").code;
    now += PAIRING_CODE_TTL_MS + 1;
    expect(store.redeemPairingCode(second)).toBeNull();
  });
});

describe("RateLimiter", () => {
  it("allows `limit` hits per window per key, then blocks until the window passes", () => {
    let now = 0;
    const limiter = new RateLimiter(3, 1000, () => now);
    expect([1, 2, 3, 4].map(() => limiter.hit("k"))).toEqual([true, true, true, false]);
    expect(limiter.blocked("k")).toBe(true);
    expect(limiter.hit("other")).toBe(true);
    now += 1000;
    expect(limiter.blocked("k")).toBe(false);
    expect(limiter.hit("k")).toBe(true);
  });
});
