import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { getPersistence } from "@/persistence";
import { clearSecret, getSecret, setSecret } from "./credentialStore";

describe("credentialStore", () => {
  it("round-trips a 'remember' secret through encryption", async () => {
    await setSecret("test-openai", "sk-abc123", "remember");
    expect(await getSecret("test-openai")).toBe("sk-abc123");
  });

  it("never stores the raw secret — only ciphertext appears in IndexedDB", async () => {
    await setSecret("test-anthropic", "sk-ant-supersecret", "remember");
    const stored = await getPersistence().meta.get<{ iv: Uint8Array; ciphertext: Uint8Array }>("ai.secret.test-anthropic");
    expect(stored).toBeTruthy();
    expect(Buffer.from(stored!.ciphertext).toString("latin1")).not.toContain("sk-ant-supersecret");
  });

  it("uses a non-extractable WebCrypto key", async () => {
    await setSecret("test-azure", "k", "remember");
    const key = await getPersistence().meta.get<CryptoKey>("ai.credentialKey");
    expect(key).toBeTruthy();
    expect(key!.extractable).toBe(false);
  });

  it("'session only' secrets are readable but never touch IndexedDB", async () => {
    await setSecret("test-session", "super-secret", "session");
    expect(await getSecret("test-session")).toBe("super-secret");
    expect(await getPersistence().meta.get("ai.secret.test-session")).toBeUndefined();
  });

  it("switching a connection from remember to session removes the persisted ciphertext", async () => {
    await setSecret("test-switch", "first-value", "remember");
    expect(await getPersistence().meta.get("ai.secret.test-switch")).toBeTruthy();
    await setSecret("test-switch", "second-value", "session");
    expect(await getPersistence().meta.get("ai.secret.test-switch")).toBeUndefined();
    expect(await getSecret("test-switch")).toBe("second-value");
  });

  it("clearSecret removes both the in-memory and persisted secret", async () => {
    await setSecret("test-clear", "value", "remember");
    await clearSecret("test-clear");
    expect(await getSecret("test-clear")).toBeUndefined();
    expect(await getPersistence().meta.get("ai.secret.test-clear")).toBeUndefined();
  });

  it("getSecret returns undefined when nothing was ever stored", async () => {
    expect(await getSecret("test-never-set")).toBeUndefined();
  });
});
