/**
 * Quantities (`.ai/docs/knowledge-notes-plan.md` §3.3 normalisation, §3.4 "unsupported number"): read every number in
 * a text as a value (or a range) in a dimension, so equal quantities compare equal however they are written and
 * different ones never do. Deterministic and pure; English only. Tables live in `config/fidelityCues.ts`.
 *
 * - **Numbers**: digits with thousands separators and decimals (`2,000`, `0.25`); words (`two thousand`,
 *   `twenty-five`, `a dozen`); digits with a scale word (`1.5 million`).
 * - **Units**, converted to the dimension's base unit: time → ms, size → bytes (decimal KB = 1,000 unless written
 *   KiB = 1,024), bits, percent, ratio (`3×`, `three times`, `twice`, `fourfold`). `250 ms` = `0.25 seconds`;
 *   `1.5 GB` ≠ `15 GB`; `4 bits` = `4-bit`.
 * - **Percentiles**: `p99` = `99th percentile` = `99th-percentile`; `median` = `p50`.
 * - **Ranges**: `4-8`, `4–8 ms`, `between 4 and 8`, `four to eight` are one range, never equal to either end. "from
 *   A to B" is a change, not a range: it stays two values.
 * - **half** is 50% only as a proportion: "half of", "by half", "in half".
 *
 * Never read as quantities: identifiers, versions, paths, dates and times (`v2.5`, `HK-3`, `#25`, `/var/log/2024`,
 * `1.2.3`, `2024-01-05`, `10:30`, `3rd`): a number touching a letter, `.`, `/`, `_`, `#` or `-digit` is left alone.
 */
import type { QuantityDimension } from "@/config/fidelityCues";
import { FIDELITY_CUES } from "@/config/fidelityCues";

export interface Quantity {
  dimension: QuantityDimension;
  /** In the dimension's base unit (ms, bytes, bits, %, ×; the rank for a percentile). `high` = `low` for one value. */
  low: number;
  high: number;
  range: boolean;
  /** The number(s) as written, before unit conversion: a unitless number on one side compares with these. */
  rawLow: number;
  rawHigh: number;
  /** The text as written ("0.25 seconds", "between 4 and 8") and where it is. */
  text: string;
  start: number;
  end: number;
}

const BASE_UNIT: Record<QuantityDimension, string> = { count: "", time: "ms", size: "byte", bits: "bit", percent: "%", ratio: "x", percentile: "p" };

const W = FIDELITY_CUES.numberWords;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A number as text: 12 significant digits, so 1.1 s → "1100" ms, not "1100.0000000000002". */
export function formatNumber(n: number): string {
  return String(Number(n.toPrecision(12)));
}

// ---------------------------------------------------------------- units

type Unit = (typeof FIDELITY_CUES.unitSpellings)[number];
const UNIT_BY_VARIANT = new Map<string, Unit>();
const UNIT_BY_EXACT = new Map<string, Unit>();
for (const u of FIDELITY_CUES.unitSpellings) {
  for (const v of u.variants) UNIT_BY_VARIANT.set(v.toLowerCase(), u);
  for (const v of u.exactCase ?? []) UNIT_BY_EXACT.set(v, u);
}
const alternation = (vs: Iterable<string>) =>
  [...vs]
    .sort((a, b) => b.length - a.length)
    .map((v) => escapeRe(v).replace(/ /g, "[ \\t]+"))
    .join("|");
/** A unit right after a number: attached, after spaces, or after one hyphen ("4-bit", "5-minute"). */
const UNIT_I = new RegExp(`(?:[ \\t]*|-)(${alternation(UNIT_BY_VARIANT.keys())})(?![\\p{L}\\p{N}])`, "iuy");
const UNIT_EXACT = new RegExp(`(?:[ \\t]*|-)(${alternation(UNIT_BY_EXACT.keys())})(?![\\p{L}\\p{N}])`, "uy");

function unitAt(text: string, at: number): { unit: Unit; end: number } | null {
  let best: { unit: Unit; end: number } | null = null;
  for (const [re, map, fold] of [
    [UNIT_I, UNIT_BY_VARIANT, true],
    [UNIT_EXACT, UNIT_BY_EXACT, false],
  ] as const) {
    re.lastIndex = at;
    const m = re.exec(text);
    if (!m) continue;
    const key = fold ? m[1]!.toLowerCase().replace(/\s+/g, " ") : m[1]!;
    const unit = map.get(key);
    if (unit && (!best || re.lastIndex > best.end)) best = { unit, end: re.lastIndex };
  }
  return best;
}

// ---------------------------------------------------------------- numbers

interface Num {
  value: number;
  end: number;
  digits: boolean;
}

const DIGITS = /(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?/y;
/** Before a number: a letter, digit, `_ . / \ # @`, "N:" (a time) or "X-" (as in "HK-3") make it part of an identifier. */
const NOT_BEFORE = /[\p{L}\p{N}_./\\#@]$|[\p{L}\p{N}][-:]$/u;

/** Digits at `at`; `rangeEnd` skips the check before them (the "8" of "4-8" follows "4-"). */
function digitsAt(text: string, at: number, rangeEnd = false): Num | null {
  if (!rangeEnd && NOT_BEFORE.test(text.slice(Math.max(0, at - 2), at))) return null;
  DIGITS.lastIndex = at;
  const m = DIGITS.exec(text);
  if (!m) return null;
  let value = Number(`${m[1]!.replace(/,/g, "")}${m[2] ?? ""}`);
  let end = DIGITS.lastIndex;
  // "1.5 million", "2 thousand".
  const scale = /[ \t]+(\p{L}+)/uy;
  scale.lastIndex = end;
  const s = scale.exec(text);
  const factor = s ? W.scales[s[1]!.toLowerCase()] : undefined;
  if (factor && !/^\p{L}/u.test(text.slice(scale.lastIndex))) {
    value *= factor;
    end = scale.lastIndex;
  }
  return { value, end, digits: true };
}

const WORD = /\p{L}+/uy;

function wordAt(text: string, at: number): { w: string; end: number } | null {
  WORD.lastIndex = at;
  const m = WORD.exec(text);
  return m ? { w: m[0].toLowerCase(), end: WORD.lastIndex } : null;
}

type WordKind = "unit" | "teen" | "ten" | "hundred" | "scale" | "dozen";

function kindOf(w: string): { kind: WordKind; value: number } | null {
  if (w in W.units) return { kind: "unit", value: W.units[w]! };
  if (w in W.tens) return { kind: W.tens[w]! < 20 ? "teen" : "ten", value: W.tens[w]! };
  if (w === "hundred") return { kind: "hundred", value: 100 };
  if (w in W.scales) return { kind: "scale", value: W.scales[w]! };
  if (w === "dozen") return { kind: "dozen", value: 12 };
  return null;
}

/** Which word may follow which: "twenty-five", "two thousand three hundred and ten", "two dozen". */
const NEXT: Record<WordKind | "start", readonly WordKind[]> = {
  start: ["unit", "teen", "ten", "hundred", "scale", "dozen"],
  unit: ["hundred", "scale", "dozen"],
  teen: ["hundred", "scale"],
  ten: ["unit", "scale"],
  hundred: ["unit", "teen", "ten", "scale"],
  scale: ["unit", "teen", "ten"],
  dozen: [],
};

/** A number in words at `at`: "two thousand", "twenty-five", "a dozen". "one" or "a" alone is no number. */
function wordsAt(text: string, at: number): Num | null {
  let pos = at;
  let prev: WordKind | "start" = "start";
  let total = 0;
  let current = 0;
  let end = -1;
  let tokens = 0;
  let onlyOne = true;
  const first = wordAt(text, pos);
  if (first?.w === "a") {
    const sep = /[ \t]+/y;
    sep.lastIndex = first.end;
    if (!sep.exec(text)) return null;
    const next = wordAt(text, sep.lastIndex);
    const k = next && kindOf(next.w);
    if (!k || !["hundred", "scale", "dozen"].includes(k.kind)) return null;
    pos = sep.lastIndex;
    onlyOne = false;
  }
  for (;;) {
    const tok = wordAt(text, pos);
    const k = tok && kindOf(tok.w);
    if (!tok || !k || !NEXT[prev].includes(k.kind)) break;
    if (k.kind === "unit" || k.kind === "teen" || k.kind === "ten") current += k.value;
    else if (k.kind === "hundred" || k.kind === "dozen") current = (current || 1) * k.value;
    else {
      total += (current || 1) * k.value;
      current = 0;
    }
    if (tok.w !== "one") onlyOne = false;
    tokens++;
    prev = k.kind;
    end = tok.end;
    // Separator: spaces, one hyphen ("twenty-five"), or "and" after a hundred or a scale.
    const sep = prev === "hundred" || prev === "scale" ? /(?:[ \t]+and[ \t]+|[ \t]+|-)(?=\p{L})/uy : /(?:[ \t]+|-)(?=\p{L})/uy;
    sep.lastIndex = end;
    if (!sep.exec(text)) break;
    pos = sep.lastIndex;
  }
  if (!tokens || (onlyOne && tokens === 1)) return null;
  return { value: total + current, end, digits: false };
}

/** Whether the character before `at` joins a word to it (a letter, digit or `_`). */
const wordBefore = (text: string, at: number) => at > 0 && /[\p{L}\p{N}_]/u.test(text[at - 1]!);

function numberAt(text: string, at: number): Num | null {
  const c = text[at] ?? "";
  if (/\d/.test(c)) return digitsAt(text, at);
  return /\p{L}/u.test(c) && !wordBefore(text, at) ? wordsAt(text, at) : null;
}

// ---------------------------------------------------------------- one quantity

/** After a quantity: a letter, digit or `_`, or `.`, `,`, `/`, `:`, `-` before a digit (versions, dates, times). */
const NOT_AFTER = /^(?:[\p{L}\p{N}_]|[.,/:-]\d)/u;

function make(text: string, start: number, end: number, dimension: QuantityDimension, rawLow: number, low: number, rawHigh = rawLow, high = low): Quantity {
  return { dimension, low, high, range: high !== low || rawHigh !== rawLow, rawLow, rawHigh, text: text.slice(start, end), start, end };
}

/** A number's unit, percentile or "-fold" from `num.end`: the single quantity, before any range. */
function single(text: string, start: number, num: Num): { q: Quantity; unit?: Unit } | null {
  const rest = text.slice(num.end);
  const pct = /^(?:st|nd|rd|th)?[ \t-]*percentile(?![\p{L}])/iu.exec(rest);
  if (pct && num.digits) return { q: make(text, start, num.end + pct[0].length, "percentile", num.value, num.value) };
  const fold = /^[ \t-]?fold(?![\p{L}])/iu.exec(rest);
  if (fold) return { q: make(text, start, num.end + fold[0].length, "ratio", num.value, num.value) };
  // "1990s" is a decade, not 1,990 seconds.
  const u = /^\d{3}0s(?![\p{L}])/u.test(text.slice(start, num.end + 1)) ? null : unitAt(text, num.end);
  if (u) return { q: make(text, start, u.end, u.unit.dimension, num.value, num.value * u.unit.factor), unit: u.unit };
  return { q: make(text, start, num.end, "count", num.value, num.value) };
}

/** "4-8 ms", "4 to 8", "500 ms to 2 s": the second number and its unit; one unit serves both ends. */
function rangeEnd(text: string, start: number, first: { q: Quantity; unit?: Unit }, sepRe: RegExp, words: boolean): Quantity | null {
  if (first.q.dimension === "percentile" || (first.q.dimension === "ratio" && !first.unit)) return null;
  sepRe.lastIndex = first.q.end;
  if (!sepRe.exec(text)) return null;
  const at = sepRe.lastIndex;
  const n2 = /\d/.test(text[at] ?? "") ? digitsAt(text, at, true) : words ? numberAt(text, at) : null;
  if (!n2) return null;
  const second = single(text, at, n2);
  if (!second || second.q.dimension === "percentile") return null;
  const u1 = first.unit;
  const u2 = second.unit;
  if (u1 && u2 && u1.dimension !== u2.dimension) return null;
  if (!u1 && !u2 && (first.q.dimension !== "count" || second.q.dimension !== "count")) return null;
  const unit = u2 ?? u1;
  const low = first.q.rawLow * ((u1 ?? unit)?.factor ?? 1);
  const high = n2.value * (unit?.factor ?? 1);
  if (high <= low) return null;
  return make(text, start, second.q.end, unit?.dimension ?? "count", first.q.rawLow, low, n2.value, high);
}

/** The quantity starting at a number at `at`, with its range when it has one; null when it isn't one. */
function quantityFrom(text: string, start: number, at: number): Quantity | null {
  const num = numberAt(text, at);
  if (!num) return null;
  const first = single(text, start, num);
  if (!first) return null;
  // "between 4 and 8": the caller passes the position of "between" as start.
  let q: Quantity | null = null;
  if (start !== at) q = rangeEnd(text, start, first, /[ \t]+and[ \t]+/iy, true);
  else {
    q = rangeEnd(text, start, first, /[ \t]*[-–—][ \t]*/y, false);
    // "four to eight" is a range; "from 4 to 8" is a change.
    if (!q && !/\bfrom\s+$/i.test(text.slice(Math.max(0, start - 8), start))) q = rangeEnd(text, start, first, /[ \t]+to[ \t]+/iy, true);
  }
  if (start !== at && !q) return null;
  const out = q ?? first.q;
  return NOT_AFTER.test(text.slice(out.end)) ? null : out;
}

/** A quantity spelled as one word: "p99", "median", "twice", "fourfold", "half of". */
function wordQuantity(text: string, at: number, word: string): Quantity | null {
  const lower = word.toLowerCase();
  const end = at + word.length;
  if (lower === "median") return make(text, at, end, "percentile", 50, 50);
  if (lower === "half") {
    const before = text.slice(Math.max(0, at - 4), at);
    const after = text.slice(end);
    const proportion = /^[ \t]+of\b/i.test(after) || (/\b(?:by|in)[ \t]+$/i.test(before) && !/^[ \t]+an?\b/i.test(after));
    return proportion ? make(text, at, end, "percent", 50, 50) : null;
  }
  if (lower in W.multipliers) {
    // "twice" always; "double"/"triple" only as a verb on an amount ("double the throughput"), not "double quotes".
    if (lower !== "twice" && !/^[ \t]+(?:the|its|their|our|your|this|that)\b/i.test(text.slice(end))) return null;
    return make(text, at, end, "ratio", W.multipliers[lower]!, W.multipliers[lower]!);
  }
  const fold = /^(\p{L}+)fold$/u.exec(lower);
  if (fold) {
    const k = kindOf(fold[1]!);
    if (k && k.kind !== "scale" && k.kind !== "dozen") return make(text, at, end, "ratio", k.value, k.value);
  }
  return null;
}

/** "p99", "P99.9": a percentile; two digits at least, so "P1" (a priority) is not one. */
const P_FORM = /[pP](\d{2,3}(?:\.\d+)?)(?![\p{L}\p{N}_]|[.,/:-]\d)/uy;

/** Every quantity in `text`, in order, without overlaps. Pass text through `plainText` first for curly dashes. */
export function quantitiesOf(text: string): Quantity[] {
  const out: Quantity[] = [];
  const start = /\d|\p{L}+/gu;
  for (let m = start.exec(text); m; m = start.exec(text)) {
    const at = m.index;
    const tok = m[0];
    let q: Quantity | null = null;
    if (/\d/.test(tok)) q = quantityFrom(text, at, at);
    else if (!wordBefore(text, at)) {
      const lower = tok.toLowerCase();
      if (lower === "between") {
        const sep = /[ \t]+/y;
        sep.lastIndex = at + tok.length;
        if (sep.exec(text)) q = quantityFrom(text, at, sep.lastIndex);
      } else if (lower === "p") {
        if (!NOT_BEFORE.test(text.slice(Math.max(0, at - 2), at))) {
          P_FORM.lastIndex = at;
          const p = P_FORM.exec(text);
          if (p) q = make(text, at, P_FORM.lastIndex, "percentile", Number(p[1]), Number(p[1]));
        }
      } else q = wordQuantity(text, at, tok) ?? quantityFrom(text, at, at);
    }
    if (q) {
      out.push(q);
      start.lastIndex = q.end;
    }
  }
  return out;
}

/** The canonical text of a quantity: "250 ms", "4-8", "2000", "p99", "1500000000 byte". */
export function canonicalQuantity(q: Quantity): string {
  if (q.dimension === "percentile") return `p${formatNumber(q.low)}`;
  const value = q.range ? `${formatNumber(q.low)}-${formatNumber(q.high)}` : formatNumber(q.low);
  return q.dimension === "count" ? value : `${value} ${BASE_UNIT[q.dimension]}`;
}

/** `text` with every quantity in its canonical form (§3.3): "two thousand files" → "2000 files", "0.25 s" → "250 ms". */
export function normalizeQuantities(text: string): string {
  let out = "";
  let last = 0;
  for (const q of quantitiesOf(text)) {
    out += text.slice(last, q.start) + canonicalQuantity(q);
    last = q.end;
  }
  return out + text.slice(last);
}

const same = (a: number, b: number) => formatNumber(a) === formatNumber(b);

/** The same quantity: same dimension and value(s), and a range only equals the same range. */
export function sameQuantity(a: Quantity, b: Quantity): boolean {
  return a.dimension === b.dimension && a.range === b.range && same(a.low, b.low) && same(a.high, b.high);
}

/**
 * Whether a source quantity supports a card's (§3.4 "unsupported number"): the same quantity; or one side has no unit
 * and the other has the same number as written ("200" for "200 ms"). A range never supports one of its ends, nor
 * the reverse.
 */
export function supportsQuantity(source: Quantity, card: Quantity): boolean {
  if (sameQuantity(source, card)) return true;
  if (source.range !== card.range) return false;
  if (card.dimension === "count") return same(card.rawLow, source.rawLow) && same(card.rawHigh, source.rawHigh);
  if (source.dimension === "count") return same(source.rawLow, card.rawLow) && same(source.rawHigh, card.rawHigh);
  return false;
}
