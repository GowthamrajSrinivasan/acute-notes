/**
 * Refining an unplaced part at subsection level (placement step (a), `unsure.ts` rule 6). A mid-sized part often spans more than one
 * subject, which is why one topic answer for the whole of it is unsure; its own subsections may each be about one thing. So the part is
 * split at its direct subsections — its own text before the first one, then each subsection whole — and each piece is asked about again.
 * One level only, and only for a part that has subsections.
 *
 * Pure: the new content, its parse and a part in; the pieces out (null when the part has no subsections to split at).
 */
import type { ParsedContent, ParsedSection } from "@/ai/content/types";
import { headingOnlyReply, type AnalysisUnit } from "@/ai/reconcile/units";

/** The section a part is, by its span: a whole subsection or a top-level section without subsections; none for a part that is only a section's own text or a split piece. */
function sectionOf(sections: readonly ParsedSection[], span: AnalysisUnit["span"]): ParsedSection | null {
  for (const s of sections) {
    if (s.span.start === span.start && s.span.end === span.end) return s;
    const inside = sectionOf(s.subsections, span);
    if (inside) return inside;
  }
  return null;
}

export function subsectionParts(parsed: ParsedContent, input: string, part: AnalysisUnit): AnalysisUnit[] | null {
  const section = sectionOf(parsed.sections, part.span);
  // A part cut into numbered pieces (over the unit limit) is not the whole section: leave it be.
  if (!section || !section.subsections.length || part.text !== input.slice(section.span.start, section.span.end).trim()) return null;
  const pieces: AnalysisUnit[] = [];
  const first = section.subsections[0]!;
  // The part's own text before its first subsection keeps the part's key (its heading, or the chat's, is dropped if it has no body).
  const own: AnalysisUnit = { key: part.key, text: input.slice(section.span.start, first.span.start).trim(), span: { start: section.span.start, end: first.span.start } };
  if (own.text && !headingOnlyReply(own, "sectioned")) pieces.push(own);
  const seen = new Map<string, number>();
  for (const sub of section.subsections) {
    const text = input.slice(sub.span.start, sub.span.end).trim();
    if (!text) continue;
    const label = sub.heading?.text ?? sub.path[sub.path.length - 1] ?? "Section";
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    pieces.push({ key: `${part.key} › ${n > 1 ? `${label} #${n}` : label}`, text, span: sub.span });
  }
  return pieces.length >= 2 ? pieces : null;
}
