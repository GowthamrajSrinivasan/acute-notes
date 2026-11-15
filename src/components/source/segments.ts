/**
 * Source panel, pure part (knowledge-notes-plan §5.1, §5.2; WP2.1–2.3): turns a version's text, its units and their
 * outcomes into sections of marked segments, ready to render. No React, no DOM, so it can be tested and timed.
 *
 * - Sections come from `SourcePanelData.sections` (parser spans: heading to the end of the last subsection, so they
 *   nest). Each section here owns only the text from its start to the next section's start; its heading line is
 *   shown as the heading row, not repeated in the body. Text before the first heading is a lead-in section.
 * - Every unit becomes one segment carrying its outcome and reasons; the text between units is plain.
 * - Selection: the selected card's units, or, for a source recorded before unit ids (`units` empty), the selection's
 *   spans (a selection given only as spans selects the units it overlaps). Passages are the selection in document order, for "Passage 1 of 3".
 */
import type { SourceFilter, SourcePanelData, SourcePanelProps, SourceUnit, TextSpan, UnitId, UnitOutcome } from "@/ai/fidelity/contracts";

export interface UnitSegment {
  kind: "unit";
  start: number;
  end: number;
  unit: UnitId;
  /** Absent when the run recorded no outcome for the unit. */
  outcome?: UnitOutcome;
  reasons: string[];
  selected: boolean;
  /** Whether a card on the canvas cites it; absent when the data has no `onCanvas` list. */
  onCanvas?: boolean;
}

export interface TextSegment {
  kind: "text";
  start: number;
  end: number;
  /** Set on a highlighted span when the source has no units: the passage key (`span:0`). */
  passage?: string;
}

export type Segment = UnitSegment | TextSegment;

export interface OutcomeCounts {
  represented: number;
  omitted: number;
  needs_review: number;
}

export interface SectionView {
  index: number;
  topic: string;
  /** "" for the lead-in before the first heading (and for a source without headings). */
  heading: string;
  level: number;
  start: number;
  end: number;
  /** Where the body starts: after the heading line. */
  bodyStart: number;
  segments: Segment[];
  counts: OutcomeCounts;
  /** Units without a recorded outcome. */
  unknown: number;
  /** Units the "Not on canvas" filter lists. */
  notOnCanvas: number;
  /** Selected passages in this section. */
  selected: number;
}

export interface Passage {
  /** The unit id, or `span:N` when highlighting by span. */
  key: string;
  units: UnitId[];
  start: number;
  end: number;
  section: number;
}

export interface SourceView {
  sections: SectionView[];
  /** The selection in document order. */
  passages: Passage[];
  /** Unit id → section index, for jumping to a unit. */
  sectionOfUnit: Map<UnitId, number>;
  /** Unit id → the unit, for the action bar and "What changed". */
  unitById: Map<UnitId, SourceUnit>;
  /** True when the source has no units: highlighting is by span only. */
  bySpan: boolean;
}

/** Plain text runs longer than this are split, so a source without units still windows. */
export const MAX_TEXT_SEGMENT = 1500;

const emptyCounts = (): OutcomeCounts => ({ represented: 0, omitted: 0, needs_review: 0 });

/** Where a section's body starts: after its first line when that line is the heading (ATX or setext). */
export function bodyStartOf(text: string, start: number, end: number, heading: string): number {
  if (!heading) return start;
  const nl = text.indexOf("\n", start);
  const lineEnd = nl === -1 || nl > end ? end : nl;
  const line = text.slice(start, lineEnd).trim();
  const bare = line.replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "").trim();
  if (bare !== heading.trim() && !line.includes(heading.trim())) return start;
  let at = lineEnd === end ? end : lineEnd + 1;
  // Setext underline (`Heading\n=====`).
  const nl2 = text.indexOf("\n", at);
  const next = text.slice(at, nl2 === -1 || nl2 > end ? end : nl2).trim();
  if (next && /^(=+|-+)$/.test(next)) at = nl2 === -1 || nl2 > end ? end : nl2 + 1;
  return at;
}

function normalizedSpans(spans: readonly TextSpan[], length: number): TextSpan[] {
  const sorted = spans
    .map((s) => ({ start: Math.max(0, Math.min(length, s.start)), end: Math.max(0, Math.min(length, s.end)) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged: TextSpan[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  return merged;
}

/** Splits a plain run into pieces of at most `MAX_TEXT_SEGMENT`, preferring a line break, then a space. */
function pushText(out: Segment[], text: string, start: number, end: number, passage?: string) {
  let at = start;
  while (end - at > MAX_TEXT_SEGMENT) {
    const limit = at + MAX_TEXT_SEGMENT;
    let cut = text.lastIndexOf("\n", limit);
    if (cut <= at + MAX_TEXT_SEGMENT / 2) cut = text.lastIndexOf(" ", limit);
    if (cut <= at + MAX_TEXT_SEGMENT / 2) cut = limit;
    else cut += 1;
    out.push(passage ? { kind: "text", start: at, end: cut, passage } : { kind: "text", start: at, end: cut });
    at = cut;
  }
  if (end > at) out.push(passage ? { kind: "text", start: at, end, passage } : { kind: "text", start: at, end });
}

interface Mark {
  start: number;
  end: number;
  unit: SourceUnit;
}

/** Builds the panel's view of one version. Linear in the text and units (a 200k-character source in a few ms). */
export function buildSourceView(data: SourcePanelData, selection: SourcePanelProps["selection"]): SourceView {
  const { text } = data;
  const length = text.length;

  // Sections: own range = start → next section's start.
  const declared = [...data.sections]
    .map((s) => ({ ...s, start: Math.max(0, Math.min(length, s.span.start)) }))
    .sort((a, b) => a.start - b.start || a.level - b.level);
  const starts: { topic: string; heading: string; level: number; start: number }[] = [];
  for (const s of declared) {
    if (starts.length && starts[starts.length - 1]!.start === s.start) continue; // same place: keep the outer one
    starts.push({ topic: s.topic, heading: s.heading, level: s.level, start: s.start });
  }
  if (!starts.length || (starts[0]!.start > 0 && text.slice(0, starts[0]!.start).trim())) {
    starts.unshift({ topic: "", heading: "", level: 0, start: 0 });
  } else if (starts[0]!.start > 0) {
    starts[0] = { ...starts[0]!, start: 0 };
  }
  const sections: SectionView[] = starts.map((s, index) => {
    const end = index + 1 < starts.length ? starts[index + 1]!.start : length;
    return {
      index,
      topic: s.topic,
      heading: s.heading,
      level: s.level,
      start: s.start,
      end,
      bodyStart: bodyStartOf(text, s.start, end, s.heading),
      segments: [],
      counts: emptyCounts(),
      unknown: 0,
      notOnCanvas: 0,
      selected: 0,
    };
  });

  // Units in document order, overlaps clipped.
  const unitById = new Map<UnitId, SourceUnit>();
  for (const u of data.units) unitById.set(u.id, u);
  const bySpan = data.units.length === 0;
  const onCanvas = data.onCanvas ? new Set(data.onCanvas) : null;
  const spans = normalizedSpans(selection.spans ?? [], length);
  const marks: Mark[] = [];
  let lastEnd = 0;
  for (const u of [...data.units].sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end)) {
    const start = Math.max(lastEnd, Math.max(0, u.span.start));
    const end = Math.min(length, u.span.end);
    if (end <= start) continue;
    marks.push({ start, end, unit: u });
    lastEnd = end;
  }
  // The card's units; a selection given only as spans selects the units it overlaps.
  const selectedUnits = new Set(selection.units.filter((id) => unitById.has(id)));
  if (!bySpan && !selectedUnits.size && spans.length) {
    let si = 0;
    for (const m of marks) {
      while (si < spans.length && spans[si]!.end <= m.start) si += 1;
      if (si < spans.length && spans[si]!.start < m.end) selectedUnits.add(m.unit.id);
    }
  }

  const passages: Passage[] = [];
  const sectionOfUnit = new Map<UnitId, number>();
  let mi = 0;
  const spanState = { si: 0, seen: new Set<number>() };
  for (const section of sections) {
    let cursor = section.bodyStart;
    if (bySpan) {
      emitText(section, text, cursor, section.end, spans, spanState, passages);
      continue;
    }
    // Skip marks that ended inside this section's heading line.
    while (mi < marks.length && marks[mi]!.end <= cursor) mi += 1;
    while (mi < marks.length && marks[mi]!.start < section.end) {
      const m = marks[mi]!;
      const id = m.unit.id;
      const start = Math.max(cursor, m.start);
      if (start > cursor) pushText(section.segments, text, cursor, start);
      const outcome = data.outcome[id];
      const selected = selectedUnits.has(id);
      const seg: UnitSegment = { kind: "unit", start, end: m.end, unit: id, outcome, reasons: data.reasons[id] ?? [], selected };
      if (onCanvas) seg.onCanvas = onCanvas.has(id);
      section.segments.push(seg);
      if (outcome) section.counts[outcome] += 1;
      else section.unknown += 1;
      if (matchesFilter(outcome, "not_on_canvas", seg.onCanvas)) section.notOnCanvas += 1;
      if (selected) {
        section.selected += 1;
        passages.push({ key: id, units: [id], start, end: m.end, section: section.index });
      }
      sectionOfUnit.set(id, section.index);
      cursor = m.end;
      mi += 1;
    }
    if (section.end > cursor) pushText(section.segments, text, cursor, section.end);
  }
  return { sections, passages, sectionOfUnit, unitById, bySpan };
}

/** Span-only mode: plain text from `from` to `to`, split at the highlighted spans. */
function emitText(section: SectionView, text: string, from: number, to: number, spans: TextSpan[], state: { si: number; seen: Set<number> }, passages: Passage[]) {
  while (state.si < spans.length && spans[state.si]!.end <= from) state.si += 1;
  let at = from;
  for (let i = state.si; i < spans.length && spans[i]!.start < to; i += 1) {
    const s = spans[i]!;
    const hs = Math.max(at, s.start);
    const he = Math.min(to, s.end);
    if (he <= hs) continue;
    if (hs > at) pushText(section.segments, text, at, hs);
    const key = `span:${i}`;
    pushText(section.segments, text, hs, he, key);
    // A span crossing sections is one passage, counted where it starts.
    if (!state.seen.has(i)) {
      state.seen.add(i);
      passages.push({ key, units: [], start: hs, end: s.end, section: section.index });
      section.selected += 1;
    }
    at = he;
  }
  if (to > at) pushText(section.segments, text, at, to);
}

/**
 * Does a unit pass the filter? `not_on_canvas` uses `onCanvas` (some card on the canvas cites it) when the data has
 * it, so a cited unit with a fidelity flag is on the canvas (still listed under Needs review); without it, anything
 * not Represented.
 */
export function matchesFilter(outcome: UnitOutcome | undefined, filter: SourceFilter, onCanvas?: boolean): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_review":
      return outcome === "needs_review";
    case "omitted":
      return outcome === "omitted";
    case "not_on_canvas":
      return onCanvas === undefined ? outcome !== "represented" : !onCanvas;
  }
}

/** Totals over all sections, for the outline header. */
export function totalCounts(sections: readonly SectionView[]): OutcomeCounts {
  const total = emptyCounts();
  for (const s of sections) {
    total.represented += s.counts.represented;
    total.omitted += s.counts.omitted;
    total.needs_review += s.counts.needs_review;
  }
  return total;
}
