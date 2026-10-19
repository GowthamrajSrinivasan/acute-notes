/**
 * Chunking for AI analysis (F28): content too long for one request is split
 * along its own structure. Whole top-level sections come first; a section
 * that is still too long is split into its subsections, then between blocks,
 * and only a single oversized block is cut by length. Small neighbours are
 * merged up to the limit, so a chunk is as close to one topic as possible.
 *
 * Chunks are slices of the original input with their spans and heading
 * path, so an analysis result can be traced back to its source (and F38 can
 * re-analyse only the sections that changed).
 */
import type { ParsedContent, ParsedSection, SourceSpan } from "./types";

/** Default characters per chunk, well inside every connection's context window. */
export const DEFAULT_CHUNK_CHARS = 12_000;

export interface ContentChunk {
  index: number;
  span: SourceSpan;
  /** Heading path of the chunk's first section ([] for the lead-in). */
  path: string[];
  text: string;
}

interface Unit {
  span: SourceSpan;
  path: string[];
}

export function chunkForAnalysis(parsed: ParsedContent, input: string, maxChars = DEFAULT_CHUNK_CHARS): ContentChunk[] {
  if (input.length !== parsed.length) throw new Error("chunkForAnalysis: input does not match the parsed content");
  if (maxChars < 1) throw new Error("chunkForAnalysis: maxChars must be positive");
  const units: Unit[] = [];
  for (const section of parsed.sections) split(section, parsed, maxChars, units);

  const chunks: ContentChunk[] = [];
  let current: Unit | null = null;
  const flush = () => {
    if (!current) return;
    const text = input.slice(current.span.start, current.span.end).trim();
    if (text) chunks.push({ index: chunks.length, span: current.span, path: current.path, text });
    current = null;
  };
  for (const unit of units) {
    if (current && unit.span.end - current.span.start <= maxChars) current = { span: { start: current.span.start, end: unit.span.end }, path: current.path };
    else {
      flush();
      current = unit;
    }
  }
  flush();
  return chunks;
}

/** Breaks a section into units of at most `max` characters, following its structure. */
function split(section: ParsedSection, parsed: ParsedContent, max: number, out: Unit[]): void {
  const len = section.span.end - section.span.start;
  if (len <= max) {
    out.push({ span: section.span, path: section.path });
    return;
  }
  // Own content (heading + blocks before the first subsection), then each subsection.
  const own: SourceSpan[] = [];
  if (section.headingIndex !== undefined) own.push(parsed.blocks[section.headingIndex]!.span);
  for (const i of section.blockIndexes) own.push(parsed.blocks[i]!.span);
  let group: SourceSpan | null = null;
  const pushGroup = () => {
    if (group) out.push({ span: group, path: section.path });
    group = null;
  };
  for (const span of own) {
    if (span.end - span.start > max) {
      pushGroup();
      for (let start = span.start; start < span.end; start += max) out.push({ span: { start, end: Math.min(span.end, start + max) }, path: section.path });
    } else if (group && span.end - group.start <= max) {
      group = { start: group.start, end: span.end };
    } else {
      pushGroup();
      group = span;
    }
  }
  pushGroup();
  for (const sub of section.subsections) split(sub, parsed, max, out);
}
