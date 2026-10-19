/**
 * Content fingerprints (F37): a cheap, stable hash of an object's content —
 * never its geometry — used as the reconciliation baseline (F38).
 *
 * Stability is the whole point: a block's stored snapshot is rewritten by
 * BlockNote once it's edited or mounted (block ids added, default props filled
 * in, string content turned into inline arrays), and none of that may look
 * like a user edit. So rich content is hashed through its canonical Markdown
 * (`contentToMarkdown`, which ignores ids and default props), with whitespace
 * normalised; a shape through its kind and its unwrapped label.
 */
import { contentToMarkdown } from "@/domain/content/markdown";
import type { RichContent } from "@/domain/types";

/** cyrb53: a fast 53-bit string hash, stable across runs and platforms. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Canonical text of rich content: Markdown, trailing spaces trimmed, blank-line runs collapsed. */
export function canonicalContent(content: RichContent): string {
  return contentToMarkdown(content)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Fingerprint of a block's or page's content (a page's title is part of its content). */
export function fingerprintContent(content: RichContent, title?: string): string {
  return `c${cyrb53(`${title ? `${title.trim()}\n` : ""}${canonicalContent(content)}`)}`;
}

/** Fingerprint of a shape: its kind and label, whitespace-normalised (Excalidraw wraps labels with newlines). */
export function fingerprintShape(shape: string, label: string): string {
  return `s${cyrb53(`${shape}\n${label.replace(/\s+/g, " ").trim()}`)}`;
}
