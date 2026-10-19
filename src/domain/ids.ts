const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** URL-safe random id (~119 bits for the default length of 20). */
export function randomId(length = 20): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export type IdPrefix = "ws" | "cv" | "doc" | "page" | "rel" | "op" | "asset" | "conv" | "src" | "chg" | "mcp";

/** Stable, prefixed identifier. Never derived from array position or DOM identity. */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomId()}`;
}
