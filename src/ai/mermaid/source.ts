/**
 * Source-level scanning shared by detection and both parsers: YAML
 * frontmatter, `%%` comments/directives, and splitting into statements
 * (newline- or `;`-separated) with exact offsets back into the input.
 */
import type { Span } from "./types";

export interface Statement {
  /** Trimmed text, comments removed. */
  text: string;
  /** Offsets of `text` in the original source. */
  span: Span;
  /** 1-based line of `span.start`. */
  line: number;
}

export interface Frontmatter {
  title?: string;
  /** Where the diagram itself starts (0 without frontmatter). */
  bodyStart: number;
}

/** A leading `---` … `---` block (Mermaid's config/title frontmatter); only `title:` is read. */
export function readFrontmatter(source: string): Frontmatter {
  const m = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!m) return { bodyStart: 0 };
  const title = /^title:[ \t]*(.+?)[ \t]*$/m.exec(m[1]!)?.[1]?.replace(/^(["'])(.*)\1$/, "$2");
  return { bodyStart: m[0].length, ...(title ? { title } : {}) };
}

/** An HTML-entity-style code (`#quot;`, `#35;`) ends in `;` without ending the statement. */
const ENTITY_BEFORE = /#[A-Za-z0-9]+$/;

/**
 * Splits `source[from…]` into statements. A statement ends at a newline or a
 * `;` outside double quotes; `%%` starts a comment to the end of the line
 * (which also covers `%%{init: …}%%` directives). Empty statements are skipped.
 */
export function splitStatements(source: string, from = 0): Statement[] {
  const out: Statement[] = [];
  let start = from;
  let inQuote = false;
  let line = 1 + countNewlines(source, 0, from);
  let startLine = line;
  const flush = (end: number) => {
    const raw = source.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text) out.push({ text, span: { start: start + lead, end: start + lead + text.length }, line: startLine + countNewlines(raw, 0, lead) });
  };
  for (let i = from; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\n") {
      flush(i);
      inQuote = false; // a quote never spans lines in Mermaid; don't let one stray quote swallow the rest
      line++;
      start = i + 1;
      startLine = line;
    } else if (c === '"') {
      inQuote = !inQuote;
    } else if (!inQuote && c === "%" && source[i + 1] === "%") {
      flush(i);
      while (i < source.length && source[i] !== "\n") i++;
      i--; // let the newline branch run next
      start = i + 1;
    } else if (!inQuote && c === ";" && !ENTITY_BEFORE.test(source.slice(Math.max(start, i - 12), i))) {
      flush(i);
      start = i + 1;
      startLine = line;
    }
  }
  flush(source.length);
  return out;
}

function countNewlines(s: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) if (s[i] === "\n") n++;
  return n;
}

/** 1-based line and column of an offset. */
export function lineColumn(source: string, offset: number): { line: number; column: number } {
  const before = source.slice(0, offset);
  const line = countNewlines(before, 0, before.length) + 1;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) + 1 };
}

const NAMED_ENTITIES: Record<string, string> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'", nbsp: " ", semi: ";", hash: "#" };

/**
 * A Mermaid label → plain text: surrounding quotes and markdown-string
 * backticks removed, `<br>` → newline, other HTML tags stripped, Mermaid's
 * `#name;` / `#123;` entity codes decoded, whitespace collapsed per line.
 */
export function cleanLabel(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  if (s.length >= 2 && s.startsWith("`") && s.endsWith("`")) s = s.slice(1, -1);
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[a-z][^<>]*>/gi, "");
  s = s.replace(/#([A-Za-z]+|\d+);/g, (whole, code: string) => {
    if (/^\d+$/.test(code)) {
      const cp = Number(code);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l, i, all) => l || (i > 0 && i < all.length - 1))
    .join("\n")
    .trim();
}
