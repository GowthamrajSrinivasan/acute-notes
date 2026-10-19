/**
 * Analysis units (F37/F38): the pieces of content the AI tier analyses one at
 * a time, and the unit a later "Update from new content" compares — an
 * unchanged unit is never sent to a model again (§13.15.19).
 *
 * Units follow the document's own structure, at the level where there are
 * siblings to tell apart: every top-level section's own content (its heading
 * and blocks before its first subsection) is a unit, and each of its
 * subsections — whole — is a unit. So "# Title / ## A … ## J" gives
 * Title, A, …, J: editing a paragraph in C changes only C. Content before the
 * first heading is the "(lead)" unit. A unit over `MAX_UNIT_CHARS` is split at
 * blank lines into numbered parts.
 *
 * Keys come from heading paths (with an ordinal for repeated headings), never
 * from wording elsewhere, so they are comparable run to run.
 */
import type { ParsedContent, ParsedSection } from "@/ai/content/types";

export const MAX_UNIT_CHARS = 12_000;
const LEAD_KEY = "(lead)";

export interface AnalysisUnit {
  key: string;
  text: string;
  span: { start: number; end: number };
}

/** Text normalised for "did this unit change?": trailing spaces and blank-line runs don't count. */
export function normalizeUnitText(text: string): string {
  return text
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function analysisUnits(parsed: ParsedContent, input: string): AnalysisUnit[] {
  if (input.length !== parsed.length) throw new Error("analysisUnits: input does not match the parsed content");
  const raw: { key: string; start: number; end: number }[] = [];
  const pathKey = (s: ParsedSection) => (s.path.length ? s.path.join(" › ") : LEAD_KEY);
  for (const top of parsed.sections) {
    if (!top.subsections.length) {
      raw.push({ key: pathKey(top), start: top.span.start, end: top.span.end });
      continue;
    }
    const ownEnd = top.subsections[0]!.span.start;
    if (ownEnd > top.span.start) raw.push({ key: pathKey(top), start: top.span.start, end: ownEnd });
    for (const sub of top.subsections) raw.push({ key: pathKey(sub), start: sub.span.start, end: sub.span.end });
  }

  const seen = new Map<string, number>();
  const units: AnalysisUnit[] = [];
  for (const r of raw) {
    const n = (seen.get(r.key) ?? 0) + 1;
    seen.set(r.key, n);
    const key = n > 1 ? `${r.key} #${n}` : r.key;
    const text = input.slice(r.start, r.end).trim();
    if (!text) continue;
    if (text.length <= MAX_UNIT_CHARS) {
      units.push({ key, text, span: { start: r.start, end: r.end } });
      continue;
    }
    splitLarge(text, MAX_UNIT_CHARS).forEach((part, i) => units.push({ key: `${key} ·${i + 1}`, text: part, span: { start: r.start, end: r.end } }));
  }
  return units;
}

/**
 * A unit with nothing but heading lines (a document title above its first
 * subsection) has nothing for a model to analyse — and asked anyway, a model
 * invents content for it. It is answered locally instead, with a raw reply of
 * the same shape as a model's: one heading node. Null for any unit with body.
 */
export function headingOnlyReply(unit: AnalysisUnit, template: string): unknown | null {
  const lines = unit.text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length || !lines.every((l) => /^#{1,6}\s/.test(l))) return null;
  const nodes = lines.map((l, i) => ({ id: `h${i + 1}`, type: "heading", stableKey: `heading#${i}`, content: { text: l.replace(/^#{1,6}\s+/, "").trim() } }));
  return { version: 1, template, nodes, relationships: [] };
}

/** Splits at blank lines into parts of at most `max` characters (a single oversized paragraph is cut by length). */
function splitLarge(text: string, max: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const para of text.split(/\n\s*\n/)) {
    const pieces = para.length > max ? para.match(new RegExp(`[\\s\\S]{1,${max}}`, "g"))! : [para];
    for (const piece of pieces) {
      if (current && current.length + 2 + piece.length > max) {
        parts.push(current);
        current = piece;
      } else current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}
