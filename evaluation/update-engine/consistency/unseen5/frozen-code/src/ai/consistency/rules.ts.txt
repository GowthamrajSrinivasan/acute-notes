/**
 * Tier 1 of the consistency check (intelligent-update-engine-plan Stage 4d, §12.3): do two sentences from two cards
 * disagree? Deterministic, local, no model. Three answers:
 * - `conflict` — the same claim, and they can't both be true: one says the opposite (a negation, or a known antonym), or
 *   the same quantity has values that don't fit together (a bound included: "at most 15 minutes" / "25 minutes");
 * - `possible` — a disagreement that may be fine, so it needs judgment (the AI tier when authorized, else the user): the
 *   values differ but a context marker differs too (staging / production, a past date, a version, a platform, "per user" /
 *   "in total"); one term of an otherwise identical claim is swapped ("payments team" / "platform team"); or too little
 *   context to tell the claims are the same ("The limit is 100" / "…500");
 * - `compatible` — anything else: a restatement ("five" / "5"), an extension, a value inside the other's range, different
 *   subjects sharing words ("timeouts happen…" / "retries happen…"), different metrics (p50 / p99, average / peak).
 *
 * The rules are tuned on `evaluation/update-engine/consistency/dev.json` only; the held-out split is never used for
 * tuning (§12.9 D). English cue words, like the rest of the fidelity rules.
 */
import { quantitiesOf, sameQuantity, type Quantity } from "@/ai/fidelity/quantities";
import { significant } from "@/ai/fidelity/information";

export type Verdict = "conflict" | "possible" | "compatible";
export type DisagreementKind = "contradicts" | "differs" | "value";

export interface PairJudgement {
  verdict: Verdict;
  /** Absent for `compatible`. */
  kind?: DisagreementKind;
  /** Why, in a line a person can check. */
  reason: string;
  /** Set when the verdict is `possible` (or a near-miss) because a context marker differs (an environment, a time, a version, a scope). */
  contextDiffers?: true;
  /**
   * Only on `compatible`: a **near-miss** — the same subject and property with values, frequencies or a polarity that may not
   * fit together, but too little evidence for the rules to say so (plan §12.15). The verdict stays `compatible` (the rules
   * alone show nothing, as before); the candidate selector may send it to the AI tier. Absent: a definite compatible.
   */
  nearMiss?: { kind: "value" | "frequency" | "negation" | "modality" | "limit" | "date"; reason: string };
  /**
   * For a `possible` one-term swap ("payments team" / "platform team"): whether either statement says only one value can
   * hold ("only", "sole", "all", "primary", "default", "due"…). Without it, two named values may simply coexist (two
   * databases, two alert channels), so the AI's "contradicts" alone doesn't make it a likely conflict (§12.19).
   */
  exclusive?: true;
  /**
   * Too little said to tell both statements are about the same thing ("The limit is 100", "It takes 5 minutes"), or
   * changes without a baseline. The AI's "contradicts" alone doesn't make it a likely conflict (§12.21).
   */
  thin?: true;
  /**
   * The deterministic evidence behind a routed pair, for ranking (§12.19): how directly the statements are incompatible,
   * and how surely they make the same claim. Absent on a definite compatible and on a rule conflict.
   */
  evidence?: { incompatibility: "strong" | "medium" | "weak"; sameClaim: boolean };
}

/** Irregular past forms, so "took" / "take" and "kept" / "keep" meet. */
const LEMMA: Record<string, string> = { took: "take", taken: "take", kept: "keep", had: "have", has: "have", ran: "run", grew: "grow", rose: "rise", fell: "fall", held: "hold", went: "go", gone: "go", made: "make", got: "get", stored: "store", allowed: "allow", shrank: "shrink", shrunk: "shrink", sank: "sink", rang: "ring" };

/** Light stemming, so "retries" / "retry" and "requests" / "request" meet. */
export function stem(word: string): string {
  const w = LEMMA[word.toLowerCase()] ?? word.toLowerCase().replace(/'s$/, "");
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

const tokens = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? []).map((t) => t.replace(/'$/, ""));

// ---------------------------------------------------------------------------
// Context markers: when they differ, a disagreement may be two true facts about different contexts.

const ENVIRONMENT = new Set(["staging", "stage", "production", "prod", "test", "testing", "qa", "dev", "development", "sandbox", "local", "preview", "uat"]);
const PLATFORM = new Set(["ios", "android", "mobile", "web", "desktop", "windows", "macos", "linux", "browser"]);
const REGION = new Set(["eu", "us", "uk", "apac", "emea", "europe", "asia", "america", "americas"]);
const TIME_WORDS = new Set(["previously", "formerly", "originally", "earlier", "until", "since", "yesterday", "used", "was", "were", "had"]);
const MONTHS = new Set(["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"]);
const PERIOD = new Set(["week", "month", "quarter", "year"]);
/** A metric's own qualifier: two sentences about different statistics are about different things. */
const METRIC = new Set(["average", "mean", "median", "peak", "worst-case", "best-case", "daily", "weekly", "monthly", "yearly", "annual", "hourly", "typical"]);
const BOUND_MAX = ["up to", "at most", "no more than", "a maximum of", "maximum of", "not more than", "under", "below", "within", "limited to", "capped at", "a limit of", "limit of", "a cap of", "cap of", "a ceiling of", "ceiling of"];
const BOUND_MIN = ["at least", "no less than", "a minimum of", "minimum of", "not less than", "more than", "over", "above"];
const LIMIT_WORDS = new Set(["limit", "limited", "capped", "cap", "ceiling"]);
/**
 * A maximum stated with a limiting verb and its object between (§12.29, unseen4 x60): "caps its squad at 30", "limits
 * each order to 5 items", "restricts guests to 2 drinks". The verb only — after "the / a / its …" the word is a noun
 * ("raised the limit to 50" states a new value of the limit, not a maximum of something else).
 */
const LIMIT_VERB_MAX = /(?:^|[^a-z'’])(?<!(?:the|a|an|its|their|this|that|our|your|his|her)\s)(?:caps?|capped|capping|limits?|limited|limiting|restricts?|restricted|restricting)(?:\s+(?!at\b|to\b)[a-z0-9'’-]+){1,4}\s+(?:at|to)\s*$/;
const APPROX = ["about", "around", "roughly", "approximately", "nearly", "almost", "~"];

/** Predicates whose "until <date>" is the claim's value ("valid until 30 June"), not a time scope ("Until March, …"). */
const VALIDITY = new Set(["valid", "available", "supported", "open", "active", "effective", "good", "licensed", "maintained"]);
const CURRENCY = new Set(["dollar", "dollars", "cent", "cents"]);

/** The context markers of a sentence, as `kind:value` strings (compared as sets). */
export function markersOf(sentence: string): Set<string> {
  const t = tokens(datesOf(sentence).reduceRight((s, d) => `${s.slice(0, d.start)} ${s.slice(d.end)}`, sentence));
  const out = new Set<string>();
  let valueUntil = -1;
  t.forEach((w, i) => {
    if ((w === "until" || w === "through" || w === "till") && VALIDITY.has(t[i - 1] ?? "")) valueUntil = i + 4;
    if (i <= valueUntil) return;
    if (w === "us" && CURRENCY.has(t[i + 1] ?? "")) return;
    if (ENVIRONMENT.has(w)) out.add(`env:${w === "prod" ? "production" : w === "stage" ? "staging" : w === "development" ? "dev" : w}`);
    if (PLATFORM.has(w)) out.add(`platform:${w}`);
    if (REGION.has(w)) out.add(`region:${w}`);
    if (/^(19|20)\d{2}$/.test(w)) out.add(`time:${w}`);
    if (MONTHS.has(w) && (i > 0 && ["until", "since", "in", "before", "after", "from", "by"].includes(t[i - 1]!))) out.add(`time:${w}`);
    if (TIME_WORDS.has(w)) out.add(`time:${w === "was" || w === "were" || w === "had" || w === "used" ? "past" : w}`);
    if ((w === "last" || w === "next" || w === "previous") && PERIOD.has(t[i + 1] ?? "")) out.add(`time:${w}-${t[i + 1]}`);
    if (/^q[1-4]$/.test(w)) out.add(`time:${w}`);
    if ((w === "before" || w === "after") && t[i + 1] === "the") out.add(`time:${w}-${t[i + 2] ?? ""}`);
    if (w === "version" || w === "release") out.add(`version:${t[i + 1] ?? ""}`);
    if (/^v\d+(\.\d+)*$/.test(w)) out.add(`version:${w.slice(1)}`);
    if (w === "per" && t[i + 1] && !["minute", "second", "hour", "day", "month", "week", "year"].includes(t[i + 1]!)) out.add(`per:${stem(t[i + 1]!)}`);
    if (w === "total" || w === "overall" || w === "combined") out.add("per:total");
  });
  return out;
}

const metricOf = (sentence: string) => new Set(tokens(sentence).filter((w) => METRIC.has(w) || /^p\d{2,3}$/.test(w)));

// ---------------------------------------------------------------------------
// Opposites

const NEGATIONS = new Set(["not", "no", "never", "cannot", "can't", "isn't", "aren't", "doesn't", "don't", "didn't", "won't", "wasn't", "weren't", "shouldn't", "mustn't", "hasn't", "haven't"]);
/** Words that only carry tense or negation support ("does not guarantee" = "guarantees"). */
const AUXILIARY = new Set(["do", "does", "did", "is", "are", "was", "were", "be", "the", "a", "an"]);
const NEGATED_BASE: Record<string, string> = { cannot: "can", "can't": "can", "isn't": "is", "aren't": "are", "doesn't": "does", "don't": "do", "didn't": "did", "won't": "will", "wasn't": "was", "weren't": "were", "shouldn't": "should", "mustn't": "must", "hasn't": "has", "haven't": "have" };
const ANTONYMS: readonly (readonly [string, string])[] = [
  ["enabled", "disabled"],
  ["enable", "disable"],
  ["required", "optional"],
  ["mandatory", "optional"],
  ["increased", "decreased"],
  ["increase", "decrease"],
  ["increasing", "decreasing"],
  ["grow", "shrink"],
  ["rose", "fell"],
  ["rise", "fall"],
  ["up", "down"],
  ["higher", "lower"],
  ["faster", "slower"],
  ["larger", "smaller"],
  ["more", "less"],
  ["public", "private"],
  ["allowed", "forbidden"],
  ["allowed", "blocked"],
  ["on", "off"],
  ["synchronous", "asynchronous"],
  ["sync", "async"],
  ["stateless", "stateful"],
  ["true", "false"],
  ["supported", "unsupported"],
  ["available", "unavailable"],
];

/** The sentence as stems, negation taken out (and counted). */
export function polarity(sentence: string): { words: string[]; negated: boolean } {
  let negations = 0;
  const words: string[] = [];
  for (const raw of tokens(sentence)) {
    if (NEGATIONS.has(raw)) {
      negations++;
      const base = NEGATED_BASE[raw];
      if (base && !AUXILIARY.has(base)) words.push(stem(base));
      continue;
    }
    if (AUXILIARY.has(raw)) continue;
    words.push(stem(raw));
  }
  return { words, negated: negations % 2 === 1 };
}

/** "One says the opposite": the same words with the negation flipped, or one antonym swapped. Null when not. */
export function opposite(a: string, b: string): string | null {
  const pa = polarity(a);
  const pb = polarity(b);
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((w, i) => w === y[i]);
  if (pa.negated !== pb.negated && same(pa.words, pb.words)) return "one says it isn't so";
  if (pa.negated !== pb.negated || pa.words.length !== pb.words.length) return null;
  const diff = pa.words.flatMap((w, i) => (w !== pb.words[i] ? [i] : []));
  if (diff.length !== 1) return null;
  const x = pa.words[diff[0]!]!;
  const y = pb.words[diff[0]!]!;
  for (const [p, q] of ANTONYMS) if ((stem(p) === x && stem(q) === y) || (stem(q) === x && stem(p) === y)) return `“${x}” on one side, “${y}” on the other`;
  return null;
}

// ---------------------------------------------------------------------------
// Frequencies ("every two weeks", "twice a week", "… weekly."): a rate, compared as occurrences a day.

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, once: 1, twice: 2, thrice: 3 };
/** How many of each unit a year holds — calendar-aware, so "every six months" = "twice a year" exactly. */
const UNIT_PER_YEAR: Record<string, number> = { minute: 525_960, hour: 8_766, day: 365.25, night: 365.25, week: 365.25 / 7, fortnight: 365.25 / 14, month: 12, quarter: 4, year: 1 };
const ADVERB_PER_YEAR: Record<string, number> = { hourly: 8_766, daily: 365.25, nightly: 365.25, weekly: 365.25 / 7, biweekly: 365.25 / 14, fortnightly: 365.25 / 14, monthly: 12, quarterly: 4, yearly: 1, annually: 1 };
const num = (w: string | undefined) => (w === undefined ? 1 : /^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w]);
const UNIT = "(minute|hour|day|night|week|fortnight|month|quarter|year)s?";

/** How often a sentence says something happens, as occurrences a year, with the words that say it. Null when it says no rate. */
export function frequencyOf(sentence: string): { perYear: number; text: string } | null {
  const lower = sentence.toLowerCase();
  let m = new RegExp(`\\bevery\\s+(other\\s+)?(?:(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\\s+)?${UNIT}\\b`).exec(lower);
  if (m) {
    const n = (m[1] ? 2 : 1) * (num(m[2]) ?? 1);
    return { perYear: UNIT_PER_YEAR[m[3]!]! / n, text: m[0] };
  }
  m = new RegExp(`\\b(once|twice|thrice|(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\\s+times)\\s+(?:a|an|per|each)\\s+${UNIT}\\b`).exec(lower);
  if (m) return { perYear: (num(m[2] ?? m[1]) ?? 1) * UNIT_PER_YEAR[m[3]!]!, text: m[0] };
  // An adverb only at the end ("Backups run weekly."), so "weekly active users" stays a metric.
  m = /\b(hourly|daily|nightly|weekly|biweekly|fortnightly|monthly|quarterly|yearly|annually)\s*[.!?]?\s*$/.exec(lower);
  if (m) return { perYear: ADVERB_PER_YEAR[m[1]!]!, text: m[1]! };
  return null;
}

// ---------------------------------------------------------------------------
// Dates ("1 March 2027", "June 30, 2027", "2027-06-30"): a claim's value when a sentence states one.

const MONTH_NO: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = Object.keys(MONTH_NO).join("|");

/** The sentence's full dates, as ISO strings with their spans. */
export function datesOf(sentence: string): { iso: string; start: number; end: number }[] {
  const out: { iso: string; start: number; end: number }[] = [];
  const iso = (y: string, m: number, d: string) => `${y}-${String(m).padStart(2, "0")}-${d.padStart(2, "0")}`;
  for (const m of sentence.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\.?,?\\s+(\\d{4})\\b`, "gi"))) out.push({ iso: iso(m[3]!, MONTH_NO[m[2]!.toLowerCase()]!, m[1]!), start: m.index!, end: m.index! + m[0].length });
  for (const m of sentence.matchAll(new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"))) out.push({ iso: iso(m[3]!, MONTH_NO[m[1]!.toLowerCase()]!, m[2]!), start: m.index!, end: m.index! + m[0].length });
  for (const m of sentence.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push({ iso: m[0], start: m.index!, end: m.index! + m[0].length });
  return out;
}

/** A value that is a change ("went up 10%", "grew by 5%"), not a level: it needs its baseline and period to compare. */
const DELTA_BEFORE = /(?:\bup|\bdown|\bby|\brose|\bgrew|\bfell|\bdropped|\bincreased|\bdecreased|\bclimbed|\bslipped)\s*$/;

// Modality: what a statement obliges, allows or forbids.
const REQUIRED_WORDS = new Set(["mandatory", "required", "must", "compulsory", "obligatory"]);
const OPTIONAL_WORDS = new Set(["optional", "voluntary", "choose", "whether", "opt", "elective"]);
const PROHIBITED_WORDS = new Set(["prohibited", "forbidden", "banned", "disallowed"]);
const PERMITTED_WORDS = new Set(["allowed", "permitted", "may", "can"]);
const MODAL_WORDS = new Set([...REQUIRED_WORDS, ...OPTIONAL_WORDS, ...PROHIBITED_WORDS, ...PERMITTED_WORDS, "cannot", "can't", "mustn't", "not", "no", "never", "to", "turn", "on", "off"]);

/** The statement's modality, if it states one: required, optional, prohibited or permitted (negation applied). */
export function modalityOf(sentence: string): "required" | "optional" | "prohibited" | "permitted" | null {
  const t = tokens(sentence);
  const negated = polarity(sentence).negated;
  const has = (set: Set<string>) => t.some((w) => set.has(w));
  const can = t.some((w) => w === "can" || w === "cannot" || w === "can't");
  if (has(REQUIRED_WORDS)) return negated ? "optional" : "required";
  if (has(OPTIONAL_WORDS)) return "optional";
  if (has(PROHIBITED_WORDS)) return negated ? "permitted" : "prohibited";
  if (has(PERMITTED_WORDS) || can) return negated ? "prohibited" : "permitted";
  return null;
}
export const MODAL_CLASH = new Set(["required/optional", "optional/required", "prohibited/permitted", "permitted/prohibited", "required/prohibited", "prohibited/required"]);

/** Words that say only one value can hold. */
const EXCLUSIVE_WORDS = new Set(["only", "sole", "solely", "exclusively", "all", "every", "single", "primary", "default", "main", "due"]);
export const isExclusive = (sentence: string) => tokens(sentence).some((w) => EXCLUSIVE_WORDS.has(w));

/** The significant stems of a sentence, apart from negation and modal words (for "the same claim, apart from …"). */
export const contentOf = (sentence: string) => [...new Set(significant(sentence).map(stem))].filter((w) => !NEGATIONS.has(w) && !MODAL_WORDS.has(w) && !AUXILIARY.has(w));
/** Same word, allowing a past participle or a gerund ("support" / "supported", "store" / "stored", "export" / "exporting"). */
const sameWord = (x: string, y: string) => x === y || [x, y].some((u) => { const v = u === x ? y : x; return u + "d" === v || u + "ed" === v || u + "ing" === v || (u.endsWith("e") && u.slice(0, -1) + "ing" === v); });
/** Words on either side with no counterpart on the other. */
export function unmatched(x: readonly string[], y: readonly string[]): number {
  return x.filter((w) => !y.some((v) => sameWord(w, v))).length + y.filter((v) => !x.some((w) => sameWord(w, v))).length;
}
export const sharedCount = (x: readonly string[], y: readonly string[]) => x.filter((w) => y.some((v) => sameWord(w, v))).length;

// ---------------------------------------------------------------------------
// Values

interface Bounded {
  q: Quantity;
  bound: "max" | "min" | "approx" | null;
  /** A change ("went up 10%"), not a level. */
  delta?: true;
}

/** The sentence's quantities that are claims (not a year, not a version number), each with the bound written before it. */
function valuesOf(sentence: string): Bounded[] {
  const lower = sentence.toLowerCase();
  const dates = datesOf(sentence);
  return quantitiesOf(sentence)
    .filter((q) => !dates.some((d) => q.start >= d.start && q.end <= d.end))
    .filter((q) => !(sentence[q.end] === "-" && /^[a-z\s]+$/i.test(q.text.trim())))
    .filter((q) => !/^(19|20)\d{2}$/.test(q.text.trim()) && !/(version|release|v)\s*$/i.test(sentence.slice(Math.max(0, q.start - 9), q.start)) && !/^p\d/i.test(q.text.trim()) && q.dimension !== "percentile")
    .map((q) => {
      const before = lower.slice(Math.max(0, q.start - 22), q.start);
      const ends = (cues: readonly string[]) => cues.some((c) => before.trimEnd().endsWith(c));
      const bound: Bounded["bound"] = ends(BOUND_MAX) || LIMIT_VERB_MAX.test(lower.slice(Math.max(0, q.start - 60), q.start)) ? "max" : ends(BOUND_MIN) ? "min" : ends(APPROX) ? "approx" : null;
      return DELTA_BEFORE.test(before.trimEnd()) ? { q, bound, delta: true as const } : { q, bound };
    });
}

/** The sentence's significant stems apart from its values (and their units) and its markers. */
function contextOf(sentence: string, values: readonly Bounded[]): string[] {
  let text = "";
  let last = 0;
  for (const { q } of values) {
    text += `${sentence.slice(last, q.start)} `;
    last = q.end;
  }
  text += sentence.slice(last);
  // Marker words and what they name ("before the migration", "version 2", "used to") are context, not the claim.
  const markers = [...markersOf(sentence)].flatMap((m) => m.split(":")[1]!.split("-")).map(stem);
  // (A limit cue's content words — "limit", "limited", "capped" — stay: "The limit is 100" is about the limit.)
  const drop = new Set([...[...BOUND_MAX, ...BOUND_MIN, ...APPROX].flatMap((c) => c.split(" ")).filter((w) => !LIMIT_WORDS.has(w)), "version", "release", "environment", "cluster", ...[...TIME_WORDS].map(stem), ...[...PERIOD].map(stem)]);
  return [...new Set(significant(text).map(stem))].filter((w) => !drop.has(w) && !markers.includes(w) && !ENVIRONMENT.has(w) && !PLATFORM.has(w) && !REGION.has(w) && !MONTHS.has(w) && !METRIC.has(w) && !/^\d/.test(w));
}

/** Two values that can't both hold: none `same`, and, with a bound or an approximation, outside it. */
function clash(a: Bounded, b: Bounded): boolean {
  if (a.q.dimension !== b.q.dimension || sameQuantity(a.q, b.q)) return false;
  // Two maxima (or two minima) that differ may govern different cases: not a clash by themselves (see `limitsDiffer`).
  if (a.bound && a.bound === b.bound && a.bound !== "approx") return false;
  const va = a.q.low;
  const vb = b.q.low;
  if (a.bound === "max") return vb > a.q.high;
  if (b.bound === "max") return va > b.q.high;
  if (a.bound === "min") return vb < a.q.low;
  if (b.bound === "min") return va < b.q.low;
  if (a.bound === "approx" || b.bound === "approx") return Math.max(va, vb) / Math.max(1e-9, Math.min(va, vb)) > 1.5;
  return true;
}

/** Two different limits of the same kind ("limited to 25 MB" / "files of up to 100 MB"). */
function limitsDiffer(a: Bounded, b: Bounded): boolean {
  return a.q.dimension === b.q.dimension && !sameQuantity(a.q, b.q) && !!a.bound && a.bound === b.bound && a.bound !== "approx";
}

// ---------------------------------------------------------------------------

const overlap = (x: readonly string[], y: readonly string[]) => {
  const a = new Set(x);
  const b = new Set(y);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.max(a.size, b.size);
};

/** The sentence's subject, roughly: its first significant stem that is no marker, metric, bound or number. */
function subjectOf(context: readonly string[]): string | undefined {
  return context[0];
}

/** Judges one pair of sentences (see module doc). Symmetric in what it decides. */
export function judgePair(a: string, b: string): PairJudgement {
  const core = judgeCore(a, b);
  if (core.verdict !== "compatible" || core.nearMiss) return core;
  // 0. Frequencies of the same thing that differ, where the rules found nothing else: a near-miss ("every two weeks" /
  // "every week" has no number the value rules read). Only here, so a conflict or possible the rules found is never weakened.
  const markersA = markersOf(a);
  const markersB = markersOf(b);
  const contextDiffers = [...markersA].some((m) => !markersB.has(m)) || [...markersB].some((m) => !markersA.has(m));
  const fa = frequencyOf(a);
  const fb = frequencyOf(b);
  const flags = { ...(contextDiffers ? { contextDiffers: true as const } : {}) };
  if (fa && fb && Math.abs(Math.log(fa.perYear / fb.perYear)) > 0.02) {
    const rest = (s: string, f: { text: string }) => contextOf(s.toLowerCase().replace(f.text, " "), []).filter((w) => !(w in UNIT_PER_YEAR) && !(w in ADVERB_PER_YEAR) && w !== "every" && w !== "time");
    const ra = rest(a, fa);
    const rb = rest(b, fb);
    if (ra[0] && rb[0] && (rb.includes(ra[0]) || ra.includes(rb[0])) && overlap(ra, rb) >= 0.5)
      return { verdict: "compatible", reason: "no disagreement the rules can confirm", nearMiss: { kind: "frequency", reason: `“${fa.text}” here, “${fb.text}” there — how often the same thing happens may differ` }, evidence: { incompatibility: "strong", sameClaim: true }, ...flags };
  }
  // Different dates for the same subject ("expires on 1 March 2027" / "valid until 30 June 2027"): a near-miss.
  const da = datesOf(a);
  const db = datesOf(b);
  if (da.length && db.length && !da.some((x) => db.some((y) => y.iso === x.iso))) {
    const strip = (s: string, ds: { start: number; end: number }[]) => ds.reduceRight((t, d) => t.slice(0, d.start) + " " + t.slice(d.end), s);
    const ra = contextOf(strip(a, da), []);
    const rb = contextOf(strip(b, db), []);
    if (ra[0] && rb[0] && (rb.includes(ra[0]) || ra.includes(rb[0])))
      return { verdict: "compatible", reason: "no disagreement the rules can confirm", nearMiss: { kind: "date", reason: `“${da[0]!.iso}” here, “${db[0]!.iso}” there, about the same subject — may be the same date` }, evidence: { incompatibility: "strong", sameClaim: overlap(ra, rb) >= 0.5 }, ...flags };
  }
  return core;
}

/** The rules before the frequency near-miss (see `judgePair`). */
function judgeCore(a: string, b: string): PairJudgement {
  const compatible = (reason: string): PairJudgement => ({ verdict: "compatible", reason });
  const va = valuesOf(a);
  const vb = valuesOf(b);
  const ca = contextOf(a, va);
  const cb = contextOf(b, vb);
  const markersA = markersOf(a);
  const markersB = markersOf(b);
  const contextDiffers = [...markersA].some((m) => !markersB.has(m)) || [...markersB].some((m) => !markersA.has(m));
  const markerText = () => {
    const only = (x: Set<string>, y: Set<string>) => [...x].filter((m) => !y.has(m)).map((m) => m.split(":")[1]!.replace(/-/g, " "));
    const left = only(markersA, markersB);
    const right = only(markersB, markersA);
    return `${left.join(", ") || "no context"} vs ${right.join(", ") || "no context"}`;
  };
  // Different subjects or different metrics: two facts about two things.
  const subjectA = subjectOf(ca);
  const subjectB = subjectOf(cb);
  const sameSubject = !!subjectA && !!subjectB && (cb.includes(subjectA) || ca.includes(subjectB));
  const ma = metricOf(a);
  const mb = metricOf(b);
  if ((ma.size || mb.size) && ([...ma].some((m) => !mb.has(m)) || [...mb].some((m) => !ma.has(m)))) return compatible("different metrics");

  // 1. Opposites.
  const flip = opposite(a, b);
  if (flip) return contextDiffers ? { verdict: "possible", kind: "contradicts", reason: `${flip}, but the context differs (${markerText()})`, contextDiffers: true, evidence: { incompatibility: "strong", sameClaim: true } } : { verdict: "conflict", kind: "contradicts", reason: flip };

  // 1b. Opposite polarity about the same subject in other words ("The API doesn't support pagination" / "Pagination is
  // supported by the API"): a near-miss.
  const pa = polarity(a);
  const pb = polarity(b);
  // The same claim apart from at most one word ("Guest users cannot export reports" / "Report export is available to
  // guest users"); a different action ("cannot edit" / "can view") is two claims, not one.
  const wa = contentOf(a);
  const wb = contentOf(b);
  const nearlySame = sharedCount(wa, wb) >= 2 && unmatched(wa, wb) <= 1;
  const flags = { ...(contextDiffers ? { contextDiffers: true as const } : {}) };
  // 1c. Conflicting modality — required / optional, prohibited / permitted — about the same claim: a near-miss.
  const ka = modalityOf(a);
  const kb = modalityOf(b);
  if (ka && kb && MODAL_CLASH.has(`${ka}/${kb}`) && !va.length && !vb.length && nearlySame)
    return { verdict: "compatible", reason: "no disagreement the rules can confirm", nearMiss: { kind: "modality", reason: `“${ka}” here, “${kb}” there — may be the same rule` }, evidence: { incompatibility: "strong", sameClaim: true }, ...flags };
  if (pa.negated !== pb.negated && !va.length && !vb.length && sameSubject && nearlySame)
    return { verdict: "compatible", reason: "no disagreement the rules can confirm", nearMiss: { kind: "negation", reason: "one says it isn't so, in other words — may be the same claim" }, evidence: { incompatibility: "strong", sameClaim: true }, ...flags };

  // 2. Values of the same claim.
  if (va.length && vb.length && sameSubject) {
    const sameClaim = overlap(ca, cb) >= 0.5;
    const clashing = va.flatMap((x) => vb.filter((y) => clash(x, y)).map((y) => [x, y] as const));
    if (sameClaim && clashing.length) {
      const [x, y] = clashing[0]!;
      const bound = (v: Bounded) => (v.bound === "max" ? "at most " : v.bound === "min" ? "at least " : "");
      const values = `“${bound(x)}${x.q.text.trim()}” here, “${bound(y)}${y.q.text.trim()}” there`;
      if (contextDiffers) return { verdict: "possible", kind: "differs", reason: `${values}, but the context differs (${markerText()}) — both may be true`, contextDiffers: true, evidence: { incompatibility: "medium", sameClaim: true } };
      if (new Set(ca).size < 2 || new Set(cb).size < 2) return { verdict: "possible", kind: "differs", reason: `${values}, but there is too little context to tell it is the same claim`, evidence: { incompatibility: "weak", sameClaim: false } };
      // A change ("went up 10%") isn't a level: without its baseline and period, two changes needn't be the same one.
      if (x.delta || y.delta) return { verdict: "possible", kind: "differs", reason: `${values} — changes, whose baseline and period aren't stated`, evidence: { incompatibility: "weak", sameClaim: false } };
      return { verdict: "conflict", kind: "differs", reason: values };
    }
    if (clashing.length) {
      // Same subject, clashing values of one kind, but the wording around them is too different to call it the same claim
      // ("Our worker retries three times before giving up" / "Retries happen five times"): a near-miss, not a conflict.
      const [x, y] = clashing[0]!;
      return { verdict: "compatible", reason: "different claims", nearMiss: { kind: "value", reason: `“${x.q.text.trim()}” here, “${y.q.text.trim()}” there, about the same subject — may be the same claim` }, evidence: { incompatibility: "strong", sameClaim: false }, ...flags };
    }
    // Two different limits of the same kind for the same subject: they may govern different cases, or one is wrong.
    const limits = va.flatMap((x) => vb.filter((y) => limitsDiffer(x, y)).map((y) => [x, y] as const));
    if (limits.length) {
      const [x, y] = limits[0]!;
      return { verdict: "compatible", reason: "the values agree", nearMiss: { kind: "limit", reason: `a limit of “${x.q.text.trim()}” here, “${y.q.text.trim()}” there — may govern the same thing` }, evidence: { incompatibility: "medium", sameClaim }, ...flags };
    }
    return compatible("the values agree");
  }

  // 3. One term of an otherwise identical claim swapped.
  // (Not when one side is negated: "admins can" / "viewers cannot" is two subjects, not a swapped value.)
  if (!va.length && !vb.length && !contextDiffers && polarity(a).negated === polarity(b).negated) {
    const ta = tokens(a).map(stem);
    const tb = tokens(b).map(stem);
    let p = 0;
    while (p < ta.length && p < tb.length && ta[p] === tb[p]) p++;
    let q = 0;
    while (q < ta.length - p && q < tb.length - p && ta[ta.length - 1 - q] === tb[tb.length - 1 - q]) q++;
    const da = ta.slice(p, ta.length - q);
    const db = tb.slice(p, tb.length - q);
    const shared = significant(a).map(stem).filter((w) => !da.includes(w)).length;
    if (da.length >= 1 && db.length >= 1 && da.length <= 3 && db.length <= 3 && shared >= 2 && !da.some((w) => db.includes(w))) {
      const exclusive = isExclusive(a) || isExclusive(b);
      return { verdict: "possible", kind: "value", reason: `“${da.join(" ")}” here, “${db.join(" ")}” there — maybe a different value for the same thing`, ...(exclusive ? { exclusive: true as const } : {}), evidence: { incompatibility: exclusive ? "strong" : "medium", sameClaim: true } };
    }
  }
  return compatible(sameSubject ? "no disagreement found" : "different subjects");
}
