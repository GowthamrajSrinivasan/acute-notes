/**
 * Source units with stable ids (Knowledge Notes plan §3.1, WP1.1–1.2; contracts in `contracts.ts`): the pieces of a
 * source a card cites, and how their ids carry over from one source version to the next.
 *
 * **Splitting** (`splitUnits`) follows the safety net's rules (`sentences`, `itemText` in `safetyNet.ts`), applied to
 * the source's own text so every unit's span slices back to its text:
 *
 * - a paragraph gives one unit per sentence (split at line breaks and at `. ! ?` before a capital, digit, quote,
 *   bracket or Markdown opener); a line starting in lowercase continues the line before it (hard-wrapped prose), so
 *   a re-wrapped paragraph keeps its units and hashes; a fragment with fewer than two significant words joins its
 *   neighbour on the same line, so short asides ("Yes.") are accounted without becoming units of their own;
 * - a list item is one unit (its first paragraph and the paragraphs directly after it; nested lists give their own
 *   units), its span starting after the marker and checkbox;
 * - a table row is one unit (the header row too), its text the cells joined with " | " and its span the row's line;
 * - a code block is one unit, its span the code inside the fences;
 * - a block quote gives one `quote` unit per sentence, `>` markers left out of the spans.
 *
 * Headings, images and dividers aren't units: a unit's `topic` is its section's heading path mapped through the
 * version's `pathIds` (`topicIds.ts`), so a renamed heading keeps its units' topic. Ids are opaque (`u17`) and never
 * reused: each set carries the next free counter.
 *
 * **Matching** (`matchVersions`) implements the §3.1 table over the whole document, one-to-one, steps 1–5. Ambiguity
 * is never resolved silently: the unit gets a new id and an `ambiguous` lineage entry naming its candidates, and the
 * candidates are not reported `removed` (cards citing them go to Needs review through the ambiguous entry instead).
 *
 * Pure apart from loading the Markdown parser.
 */
import { cyrb53 } from "@/ai/content/fingerprint";
import { parseContent } from "@/ai/content/parser";
import type { ParsedBlock, ParsedContent, ParsedListItem, ParsedSection } from "@/ai/content/types";
import { rekey, type PathIds } from "@/ai/reconcile/topicIds";
import { normalizeUnitText } from "@/ai/reconcile/units";
import type { Lineage, LineageEntry, MatchVersions, SourceUnit, SourceUnitKind, SplitUnits, TextSpan, UnitId, UnitSet } from "./contracts";
import { significant, words } from "./information";

/** §3.1 step 3: same topic, a neighbour agrees, and at least this share of significant words in common. */
export const SAME_TOPIC_OVERLAP = 0.8;
/** §3.1 step 4: any topic, exactly one candidate, and at least this share of significant words in common. */
export const MOVED_OVERLAP = 0.9;
/** The counter a first version starts from (`u1`). */
export const FIRST_UNIT_ID = 1;
/** Heading-path separator, as `topicIds.ts` and `units.ts` build paths. */
const PATH_SEPARATOR = " › ";
/** A sentence ends at `. ! ?` followed by space and a capital, digit, quote, bracket or Markdown opener. */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z0-9"“'‘(\[*_`])/g;
/** A fragment with fewer significant words than this joins its neighbour (the safety net's `sentences` filter). */
const MIN_SENTENCE_WORDS = 2;

/** A unit before it has an id. */
interface Draft {
  kind: SourceUnitKind;
  text: string;
  span: TextSpan;
  topic: string;
}

// ---------------------------------------------------------------- splitting

/** The text a unit's hash is taken over: `normalizeUnitText`, and outside code every whitespace run as one space. */
export function unitHashText(text: string, kind: SourceUnitKind): string {
  const normal = normalizeUnitText(text);
  return kind === "code" ? normal : normal.replace(/\s+/g, " ");
}

export const hashUnit = (text: string, kind: SourceUnitKind): string => cyrb53(unitHashText(text, kind));

/** The share of the larger text's significant words both texts share (0 when either has none). */
export const wordOverlap = (a: string, b: string): number => setOverlap(new Set(significant(a)), new Set(significant(b)));

function setOverlap(wa: ReadonlySet<string>, wb: ReadonlySet<string>): number {
  if (!wa.size || !wb.size) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.max(wa.size, wb.size);
}

/** Every unit of a parsed text, in document order, before ids are given. */
export function draftUnits(parsed: ParsedContent, input: string, pathIds?: PathIds): Draft[] {
  if (input.length !== parsed.length) throw new Error("draftUnits: input does not match the parsed content");
  const out: Draft[] = [];
  const visit = (section: ParsedSection) => {
    const topic = section.path.length ? rekey(section.path.join(PATH_SEPARATOR), pathIds) : "";
    for (const i of section.blockIndexes) blockUnits(parsed.blocks[i]!, input, topic, false, out);
    section.subsections.forEach(visit);
  };
  parsed.sections.forEach(visit);
  return out.sort((a, b) => a.span.start - b.span.start);
}

function blockUnits(block: ParsedBlock, input: string, topic: string, quoted: boolean, out: Draft[]): void {
  switch (block.type) {
    case "paragraph":
      for (const span of sentenceSpans(input, block.span)) out.push({ kind: quoted ? "quote" : "sentence", text: input.slice(span.start, span.end), span, topic });
      return;
    case "list":
      for (const item of block.items) itemUnits(item, input, topic, quoted, out);
      return;
    case "table":
      tableUnits(block, input, topic, out);
      return;
    case "code": {
      if (!block.source.trim()) return;
      const at = input.indexOf(block.source, block.span.start);
      // Indented code is stored without its indent, so it can't be found verbatim: the whole block is the span.
      const span = at >= 0 && at + block.source.length <= block.span.end ? { start: at, end: at + block.source.length } : { ...block.span };
      out.push({ kind: "code", text: block.source, span, topic });
      return;
    }
    case "quote":
      for (const child of block.children) blockUnits(child, input, topic, true, out);
      return;
    default:
      // headings (the topic), images and dividers carry no unit.
      return;
  }
}

/** A list item: its own text (marker and checkbox left out) up to its first child that isn't a paragraph. */
function itemUnits(item: ParsedListItem, input: string, topic: string, quoted: boolean, out: Draft[]): void {
  const firstOther = item.children.find((b) => b.type !== "paragraph");
  const raw = input.slice(item.span.start, firstOther ? firstOther.span.start : item.span.end);
  const marker = /^[ \t>]*(?:[-*+]|\d+[.)])[ \t]*(?:\[[ xX]\][ \t]*)?/.exec(raw)?.[0].length ?? 0;
  const span = trimSpan(input, item.span.start + marker, item.span.start + raw.length);
  if (span && words(input.slice(span.start, span.end)).length) out.push({ kind: "list_item", text: input.slice(span.start, span.end), span, topic });
  // Nested lists, code, quotes, and paragraphs after them.
  let own = true;
  for (const child of item.children) {
    if (own && child.type === "paragraph") continue;
    own = false;
    if (child.type === "paragraph") {
      const s = trimSpan(input, child.span.start, child.span.end);
      if (s && words(input.slice(s.start, s.end)).length) out.push({ kind: "list_item", text: input.slice(s.start, s.end), span: s, topic });
    } else blockUnits(child, input, topic, quoted, out);
  }
}

/** One unit per row, the header included; spans are the rows' lines when they can be found, else the table's. */
function tableUnits(block: Extract<ParsedBlock, { type: "table" }>, input: string, topic: string, out: Draft[]): void {
  const lines: TextSpan[] = [];
  let at = block.span.start;
  for (const line of input.slice(block.span.start, block.span.end).split("\n")) {
    const span = trimSpan(input, at, at + line.length);
    at += line.length + 1;
    if (!span) continue;
    if (/^\|?[\s:|-]*-[\s:|-]*$/.test(input.slice(span.start, span.end))) continue; // the delimiter row
    lines.push(span);
  }
  const rows = [block.columns, ...block.rows];
  rows.forEach((cells, i) => {
    const text = cells.join(" | ");
    if (!words(text).length) return;
    const span = lines.length === rows.length ? lines[i]! : { ...block.span };
    out.push({ kind: "table_row", text, span, topic });
  });
}

/**
 * A paragraph's lines, quote markers left out, with soft-wrapped lines joined: a line that starts with a lowercase
 * letter (and no quote marker) continues the line before it, since the sentence rule never splits before lowercase.
 */
function logicalLines(input: string, block: TextSpan): TextSpan[] {
  const lines: TextSpan[] = [];
  let at = block.start;
  for (const line of input.slice(block.start, block.end).split("\n")) {
    const lineStart = at;
    at += line.length + 1;
    const lead = /^[ \t]*(?:>[ \t]?)*/.exec(line)![0];
    const continues = lines.length > 0 && !lead.includes(">") && /^\p{Ll}/u.test(line.slice(lead.length));
    if (continues) lines[lines.length - 1]!.end = lineStart + line.length;
    else lines.push({ start: lineStart + lead.length, end: lineStart + line.length });
  }
  return lines;
}

/**
 * A paragraph's sentences as spans of the source: each line on its own (quote markers left out, soft-wrapped lines
 * joined, `logicalLines`), split at sentence ends; a fragment with fewer than two significant words joins the
 * sentence before it on the line (or after it).
 */
export function sentenceSpans(input: string, block: TextSpan): TextSpan[] {
  const out: TextSpan[] = [];
  for (const { start: lineStart, end: lineEnd } of logicalLines(input, block)) {
    const line = input.slice(lineStart, lineEnd);
    const pieces: TextSpan[] = [];
    let from = 0;
    for (const m of line.matchAll(SENTENCE_BREAK)) {
      pieces.push({ start: lineStart + from, end: lineStart + m.index! });
      from = m.index! + m[0].length;
    }
    pieces.push({ start: lineStart + from, end: lineEnd });
    const trimmed = pieces.map((p) => trimSpan(input, p.start, p.end)).filter((p): p is TextSpan => p !== null);
    const merged: TextSpan[] = [];
    let pending: TextSpan | null = null; // a short fragment at the start of the line, waiting for the next sentence
    for (const p of trimmed) {
      const short = significant(input.slice(p.start, p.end)).length < MIN_SENTENCE_WORDS;
      if (pending) {
        merged.push({ start: pending.start, end: p.end });
        pending = null;
      } else if (short && merged.length) merged[merged.length - 1]!.end = p.end;
      else if (short) pending = p;
      else merged.push(p);
    }
    if (pending) merged.push(pending);
    for (const p of merged) if (words(input.slice(p.start, p.end)).length) out.push(p);
  }
  return out;
}

/** `[start, end)` without leading and trailing whitespace; null when nothing is left. */
function trimSpan(input: string, start: number, end: number): TextSpan | null {
  while (start < end && /\s/.test(input[start]!)) start++;
  while (end > start && /\s/.test(input[end - 1]!)) end--;
  return end > start ? { start, end } : null;
}

/** Drafts with their ids, hashes and neighbours, in document order. */
function withIds(drafts: readonly Draft[], ids: readonly UnitId[]): SourceUnit[] {
  return drafts.map((d, i) => ({
    id: ids[i]!,
    kind: d.kind,
    text: d.text,
    hash: hashUnit(d.text, d.kind),
    topic: d.topic,
    span: d.span,
    ...(i > 0 ? { prev: ids[i - 1]! } : {}),
    ...(i < drafts.length - 1 ? { next: ids[i + 1]! } : {}),
  }));
}

/** §3.1: a first version's units, ids `u<firstId>`, `u<firstId + 1>`, … in document order. */
export const splitUnits: SplitUnits = async (text, options = {}) => {
  const drafts = draftUnits(await parseContent(text), text, options.pathIds);
  const first = options.firstId ?? FIRST_UNIT_ID;
  return { units: withIds(drafts, drafts.map((_, i) => `u${first + i}`)), nextId: first + drafts.length };
};

// ---------------------------------------------------------------- matching

/**
 * §3.1: the next version's units, ids carried over by the matching table, and the lineage between the two.
 *
 * 1. Same hash, unique in both versions: same id, `unchanged` (`moved` when the topic differs).
 * 2. Same hash, repeated: repeats are paired by their neighbours (a neighbour agrees when the units next to both are
 *    themselves matched to each other, or both sit at the document's start or end), repeatedly, so a run of
 *    identical units pairs from its anchored end. A pair is taken only when it is the best for both sides. What is
 *    left with old units of the same hash still unpaired is `ambiguous`.
 * 3. No hash match: same topic, overlap ≥ `SAME_TOPIC_OVERLAP`, and a neighbour that agrees through steps 1–2 only.
 *    Best first; a tie is `ambiguous`.
 * 4. No hash match, any topic: overlap ≥ `MOVED_OVERLAP`, and exactly one candidate on both sides. More than one is
 *    `ambiguous`.
 * 5. Anything else is `added` with a new id; an old unit left over is `removed`.
 */
export const matchVersions: MatchVersions = async (previous, next) => {
  const drafts = draftUnits(await parseContent(next.text), next.text, next.pathIds);
  const old = previous.units;
  const newHash = drafts.map((d) => hashUnit(d.text, d.kind));
  const oldIndex = new Map(old.map((u, i) => [u.id, i] as const));
  const oldPrev = old.map((u, i) => (u.prev !== undefined ? oldIndex.get(u.prev) : i > 0 ? i - 1 : undefined));
  const oldNext = old.map((u, i) => (u.next !== undefined ? oldIndex.get(u.next) : i < old.length - 1 ? i + 1 : undefined));

  /** New index → old index it carries the id of. */
  const match: (number | undefined)[] = drafts.map(() => undefined);
  const step: (1 | 2 | 3 | 4 | undefined)[] = drafts.map(() => undefined);
  /** Old index → taken (matched, or a candidate of an ambiguous unit). */
  const oldTaken = old.map(() => false);
  const ambiguous = new Map<number, number[]>();

  const take = (n: number, o: number, s: 1 | 2 | 3 | 4) => {
    match[n] = o;
    step[n] = s;
    oldTaken[o] = true;
  };
  const markAmbiguous = (n: number, candidates: readonly number[]) => {
    const all = new Set([...(ambiguous.get(n) ?? []), ...candidates]);
    ambiguous.set(n, [...all].sort((a, b) => a - b));
    for (const o of candidates) oldTaken[o] = true;
  };
  const open = (n: number) => match[n] === undefined && !ambiguous.has(n);
  /** How many of the two neighbours agree (0–2), given the matches made so far (`against`). */
  const agree = (o: number, n: number, against: readonly (number | undefined)[]) => {
    const prevOk = n === 0 ? oldPrev[o] === undefined : against[n - 1] !== undefined && against[n - 1] === oldPrev[o];
    const nextOk = n === drafts.length - 1 ? oldNext[o] === undefined : against[n + 1] !== undefined && against[n + 1] === oldNext[o];
    return Number(prevOk) + Number(nextOk);
  };

  const oldWords = old.map((u) => new Set(significant(u.text)));
  const newWords = drafts.map((d) => new Set(significant(d.text)));
  const overlap = (o: number, n: number) => setOverlap(oldWords[o]!, newWords[n]!);

  // Hash groups.
  const oldByHash = groupBy(old.map((u) => u.hash));
  const newByHash = groupBy(newHash);

  // Step 1.
  for (const [hash, ns] of newByHash) {
    const os = oldByHash.get(hash);
    if (ns.length === 1 && os?.length === 1) take(ns[0]!, os[0]!, 1);
  }

  // Step 2: repeats, paired by neighbours until nothing more pairs.
  const repeated = [...newByHash].filter(([hash, ns]) => oldByHash.has(hash) && (ns.length > 1 || oldByHash.get(hash)!.length > 1));
  for (;;) {
    const pairs: { o: number; n: number; s: number }[] = [];
    for (const [hash, ns] of repeated) {
      for (const n of ns) {
        if (!open(n)) continue;
        for (const o of oldByHash.get(hash)!) {
          if (oldTaken[o]) continue;
          const s = agree(o, n, match);
          if (s > 0) pairs.push({ o, n, s });
        }
      }
    }
    const accepted = pairs.filter((p) => uniqueBest(pairs, p, "n") && uniqueBest(pairs, p, "o"));
    if (!accepted.length) break;
    for (const p of accepted) take(p.n, p.o, 2);
  }
  for (const [hash, ns] of repeated) {
    const left = oldByHash.get(hash)!.filter((o) => !oldTaken[o]);
    if (!left.length) continue;
    for (const n of ns) if (open(n)) markAmbiguous(n, left);
  }

  // Step 3: same topic, reworded, anchored by a neighbour matched in step 1 or 2.
  const anchored = [...match];
  const step3: { o: number; n: number; s: number }[] = [];
  drafts.forEach((d, n) => {
    if (!open(n) || oldByHash.has(newHash[n]!)) return;
    old.forEach((u, o) => {
      if (oldTaken[o] || newByHash.has(u.hash) || u.topic !== d.topic || agree(o, n, anchored) === 0) return;
      const s = overlap(o, n);
      if (s >= SAME_TOPIC_OVERLAP) step3.push({ o, n, s });
    });
  });
  step3.sort((a, b) => b.s - a.s || a.n - b.n || a.o - b.o);
  for (const p of step3) {
    if (!open(p.n) || oldTaken[p.o]) continue;
    const ties = step3.filter((q) => q.s === p.s && (q.n === p.n) !== (q.o === p.o) && open(q.n) && !oldTaken[q.o]);
    if (!ties.length) {
      take(p.n, p.o, 3);
      continue;
    }
    // Equally good for another unit or another old unit: never chosen silently.
    const os = [p.o, ...ties.filter((q) => q.n === p.n).map((q) => q.o)];
    const ns = [p.n, ...ties.filter((q) => q.o === p.o).map((q) => q.n)];
    for (const n of ns) markAmbiguous(n, os);
  }

  // Step 4: moved and edited, any topic, exactly one candidate either way.
  const step4: { o: number; n: number }[] = [];
  drafts.forEach((_, n) => {
    if (!open(n) || oldByHash.has(newHash[n]!)) return;
    old.forEach((u, o) => {
      if (oldTaken[o] || newByHash.has(u.hash)) return;
      if (overlap(o, n) >= MOVED_OVERLAP) step4.push({ o, n });
    });
  });
  for (const n of new Set(step4.map((p) => p.n))) {
    const os = step4.filter((p) => p.n === n).map((p) => p.o);
    const contested = step4.some((p) => p.o === os[0] && p.n !== n);
    if (os.length === 1 && !contested) take(n, os[0]!, 4);
    else markAmbiguous(n, os);
  }

  // Step 5: ids, and the lineage.
  let nextId = previous.nextId;
  const ids = drafts.map((_, n) => (match[n] !== undefined ? old[match[n]!]!.id : `u${nextId++}`));
  const units = withIds(drafts, ids);
  const entries: LineageEntry[] = units.map((u, n): LineageEntry => {
    const o = match[n];
    if (o !== undefined) {
      const moved = old[o]!.topic !== u.topic;
      return { state: step[n]! <= 2 ? "unchanged" : "changed", from: old[o]!.id, to: u.id, ...(moved ? { moved } : {}) };
    }
    const candidates = ambiguous.get(n);
    if (candidates) return { state: "ambiguous", to: u.id, candidates: candidates.map((c) => old[c]!.id) };
    return { state: "added", to: u.id };
  });
  const cited = new Set([...ambiguous.values()].flat());
  old.forEach((u, o) => {
    if (!match.includes(o) && !cited.has(o)) entries.push({ state: "removed", from: u.id });
  });

  const lineage: Lineage = { fromVersion: previous.version, toVersion: next.version, entries };
  const set: UnitSet = { units, nextId };
  return { units: set, lineage };
};

/** Value → indexes it occurs at, in order. */
function groupBy(values: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  values.forEach((v, i) => out.set(v, [...(out.get(v) ?? []), i]));
  return out;
}

/** `p` has the highest score among the pairs sharing its `side`, and no other pair there has the same. */
function uniqueBest(pairs: readonly { o: number; n: number; s: number }[], p: { o: number; n: number; s: number }, side: "o" | "n"): boolean {
  return pairs.every((q) => q === p || q[side] !== p[side] || q.s < p.s);
}
