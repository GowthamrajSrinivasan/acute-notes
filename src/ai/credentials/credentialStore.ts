/**
 * Browser-held BYOK secret storage (F27, PRD §13.15.13). Encrypted at rest
 * with a non-extractable, per-device WebCrypto key — this protects against
 * casual disk inspection, not against script injection in the page; pair it
 * with a strict Content Security Policy (the PRD is explicit this is not a
 * stronger claim than that). "Session only" mode skips persistence
 * entirely: the secret lives in memory for this tab and is gone on reload.
 *
 * Never store `AIProviderConfig` here — secrets and non-secret config are
 * deliberately separate stores (`AISettingsRepository` holds the config).
 */
import { getPersistence } from "@/persistence";

const KEY_META_KEY = "ai.credentialKey";
const secretMetaKey = (providerId: string) => `ai.secret.${providerId}`;

export type SecretStorageMode = "remember" | "session";

interface EncryptedSecret {
  iv: Uint8Array;
  ciphertext: Uint8Array;
}

let cachedKey: Promise<CryptoKey> | null = null;
/** "Session only" secrets — plaintext, in memory, never written to IndexedDB. */
const sessionSecrets = new Map<string, string>();

function getOrCreateKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = (async () => {
      const meta = getPersistence().meta;
      const existing = await meta.get<CryptoKey>(KEY_META_KEY);
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await meta.set(KEY_META_KEY, key);
      return key;
    })();
  }
  return cachedKey;
}

export async function setSecret(providerId: string, secret: string, mode: SecretStorageMode): Promise<void> {
  if (mode === "session") {
    await getPersistence().meta.delete(secretMetaKey(providerId));
    sessionSecrets.set(providerId, secret);
    return;
  }
  sessionSecrets.delete(providerId);
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(secret)));
  await getPersistence().meta.set(secretMetaKey(providerId), { iv, ciphertext } satisfies EncryptedSecret);
}

export async function getSecret(providerId: string): Promise<string | undefined> {
  const inMemory = sessionSecrets.get(providerId);
  if (inMemory !== undefined) return inMemory;

  const stored = await getPersistence().meta.get<EncryptedSecret>(secretMetaKey(providerId));
  if (!stored) return undefined;
  const key = await getOrCreateKey();
  // Re-wrap in a fresh Uint8Array: values round-tripped through IndexedDB
  // aren't guaranteed to type-check as the ArrayBuffer-backed view WebCrypto expects.
  const iv = new Uint8Array(stored.iv);
  const ciphertext = new Uint8Array(stored.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

export async function clearSecret(providerId: string): Promise<void> {
  sessionSecrets.delete(providerId);
  await getPersistence().meta.delete(secretMetaKey(providerId));
}
