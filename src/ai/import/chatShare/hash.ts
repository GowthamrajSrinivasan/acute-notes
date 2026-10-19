import type { ChatTurn } from "./types";

/** Whitespace and case folded, so a re-wrapped copy of a turn hashes the same. */
export const normaliseTurnText = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/** cyrb53: a fast, well-spread 53-bit string hash. Not cryptographic; only used to compare turns inside one import. */
function cyrb53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

export function turnHash(role: ChatTurn["role"], markdown: string): string {
  return cyrb53(`${role}\n${normaliseTurnText(markdown)}`);
}
