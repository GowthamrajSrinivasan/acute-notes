/**
 * Source panel, pure part (knowledge-notes-plan §5.2): which rows to render for a filter and the collapsed sections,
 * their estimated heights, and the window of rows inside the viewport. The component measures rendered rows and
 * feeds the real heights back through `heightOf`.
 *
 * Rows:
 * - `heading`: a section's heading (click to fold or unfold). A section without a heading (the lead-in, or a
 *   source without headings) has no heading row and is always open.
 * - `chunk`: a run of a section's segments, about `CHUNK_CHARS` long, so one huge section still windows.
 * - `passage`: under a filter other than All, one matching unit per row, with its reason and actions.
 */
import type { SourceFilter } from "@/ai/fidelity/contracts";
import { matchesFilter, type SectionView } from "./segments";

export const CHUNK_CHARS = 1200;

export type Row =
  | { kind: "heading"; key: string; section: number; open: boolean }
  | { kind: "chunk"; key: string; section: number; from: number; to: number; chars: number; lines: number }
  | { kind: "passage"; key: string; section: number; segment: number; chars: number; lines: number };

/** A section folds to its heading unless something in it is selected or needs review (§5.2). */
export function defaultOpen(section: SectionView): boolean {
  return !section.heading || section.selected > 0 || section.counts.needs_review > 0;
}

export interface RowOptions {
  filter: SourceFilter;
  /** The user's fold / unfold per section index, overriding `defaultOpen`. */
  toggled?: ReadonlyMap<number, boolean>;
  /** Characters per rendered line, for the line estimate. */
  charsPerLine?: number;
}

/** Visual lines of `text[start, end)` at `cpl` characters per line. */
function linesOf(text: string, start: number, end: number, cpl: number): number {
  let lines = 0;
  let at = start;
  while (at < end) {
    let nl = text.indexOf("\n", at);
    if (nl === -1 || nl >= end) nl = end;
    lines += Math.max(1, Math.ceil((nl - at) / cpl));
    at = nl + 1;
  }
  return lines;
}

export function isOpen(section: SectionView, toggled?: ReadonlyMap<number, boolean>): boolean {
  if (!section.heading) return true;
  return toggled?.get(section.index) ?? defaultOpen(section);
}

export function buildRows(sections: readonly SectionView[], text: string, options: RowOptions): Row[] {
  const cpl = options.charsPerLine ?? 46;
  const rows: Row[] = [];
  for (const section of sections) {
    if (options.filter !== "all") {
      const matches: Row[] = [];
      section.segments.forEach((seg, i) => {
        if (seg.kind !== "unit" || !matchesFilter(seg.outcome, options.filter, seg.onCanvas)) return;
        matches.push({ kind: "passage", key: `p:${seg.unit}`, section: section.index, segment: i, chars: seg.end - seg.start, lines: linesOf(text, seg.start, seg.end, cpl) });
      });
      if (!matches.length) continue;
      if (section.heading) rows.push({ kind: "heading", key: `h:${section.index}`, section: section.index, open: true });
      rows.push(...matches);
      continue;
    }
    const open = isOpen(section, options.toggled);
    if (section.heading) rows.push({ kind: "heading", key: `h:${section.index}`, section: section.index, open });
    if (!open) continue;
    let from = 0;
    let chars = 0;
    const flush = (to: number) => {
      if (to <= from) return;
      const first = section.segments[from]!;
      const last = section.segments[to - 1]!;
      // Skip chunks that are only whitespace (blank lines between sections).
      if (text.slice(first.start, last.end).trim()) {
        rows.push({ kind: "chunk", key: `c:${section.index}:${first.start}`, section: section.index, from, to, chars, lines: linesOf(text, first.start, last.end, cpl) });
      }
      from = to;
      chars = 0;
    };
    section.segments.forEach((seg, i) => {
      chars += seg.end - seg.start;
      if (chars >= CHUNK_CHARS) flush(i + 1);
    });
    flush(section.segments.length);
  }
  return rows;
}

export interface HeightModel {
  lineHeight: number;
  headingHeight: number;
  /** Padding of a chunk row. */
  chunkPadding: number;
  /** A passage row's reason line, actions and padding. */
  passageExtra: number;
}

export const DEFAULT_HEIGHTS: HeightModel = { lineHeight: 18, headingHeight: 28, chunkPadding: 6, passageExtra: 52 };

export function estimateHeight(row: Row, model: HeightModel = DEFAULT_HEIGHTS): number {
  switch (row.kind) {
    case "heading":
      return model.headingHeight;
    case "chunk":
      return row.lines * model.lineHeight + model.chunkPadding;
    case "passage":
      return row.lines * model.lineHeight + model.passageExtra;
  }
}

/** Prefix sums: `offsets[i]` is the top of row i, `offsets[rows.length]` the total height. */
export function rowOffsets(rows: readonly Row[], heightOf: (row: Row) => number): Float64Array {
  const offsets = new Float64Array(rows.length + 1);
  for (let i = 0; i < rows.length; i += 1) offsets[i + 1] = offsets[i]! + heightOf(rows[i]!);
  return offsets;
}

/** Index of the row at vertical position `y`. */
export function rowAt(offsets: Float64Array, y: number): number {
  const n = offsets.length - 1;
  if (n <= 0) return 0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The rows to render, `[first, last]` inclusive, for a viewport plus `overscan` pixels above and below. */
export function visibleRange(offsets: Float64Array, scrollTop: number, viewport: number, overscan = 400): [number, number] {
  const n = offsets.length - 1;
  if (n <= 0) return [0, -1];
  return [rowAt(offsets, Math.max(0, scrollTop - overscan)), rowAt(offsets, scrollTop + viewport + overscan)];
}

/** The row showing a segment of a section (chunk or passage), or the section's heading when folded. */
export function rowOfSegment(rows: readonly Row[], section: number, segment: number): number {
  let heading = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (r.section !== section) continue;
    if (r.kind === "heading") heading = i;
    else if (r.kind === "chunk" && segment >= r.from && segment < r.to) return i;
    else if (r.kind === "passage" && r.segment === segment) return i;
  }
  return heading;
}

/** The first row of a section (its heading, or its first chunk when it has none). */
export function rowOfSection(rows: readonly Row[], section: number): number {
  return rows.findIndex((r) => r.section === section);
}
