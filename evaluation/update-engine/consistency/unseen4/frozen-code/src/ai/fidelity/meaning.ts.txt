/**
 * Meaning rules (`.ai/docs/knowledge-notes-plan.md` §3.4, WP1.8): does a card keep the meaning of the units it cites?
 * Deterministic, pure, English-only cue words (`config/fidelityCues.ts`). An inexpensive first layer, measured per
 * kind against the labelled set (§7.2, `meaning.eval.test.ts`); a flag means Needs review, never "wrong".
 *
 * The seven rules, each with its `ReviewCode`:
 * - **Dropped qualifier** (`qualifier_dropped`): a hedge (*can, may, often…*) or a limit on an amount (*up to, at
 *   most…*) in the unit, about something the card restates, with no hedge or limit on the card. A caveat joined to
 *   the claim (*but, although, at the cost of…*) is reported on its own (`caveat_dropped`): the card must keep some of its words (or
 *   restate a restricting caveat as a restriction: *other than UTC … not supported* → *only UTC*), and must not turn
 *   the cost into its better side (*arrive later* → *kept current*, *costs more* → *saves money*). Kept as well: an
 *   ability as an *-able* word (*can restore* → *restorable*), and a floor as a requirement (rubric rule 8: *at least
 *   two are required* → *two are required*, unless the card makes the count exact).
 * - **Dropped or changed condition** (`condition_changed`): the unit has a condition and the card keeps under half of
 *   its significant words, or the card widens it (*whenever, at any time*), or turns *unless* into *if*. A scope
 *   restriction (*only for premium subscribers*, *for read-only workloads*) is a condition: the card must keep the
 *   narrowing word, and a restriction (*over Wi-Fi only*) needs a restricting word on the card.
 * - **Changed cause or effect** (`cause_changed`): the card's cause and effect are the unit's, swapped; or the card
 *   moves something the opposite way (*reduces* ↔ *increases*, *more* ↔ *less*); or (not for analysis cards) the card
 *   states a cause where the unit states none.
 * - **Added absolute** (`absolute_added`): *always, never, all, every, none, guaranteed…* on the card, unsupported by
 *   the units.
 * - **Negation flip** (`negation_flip`): what one side says is not so, the other says plainly, about the same words.
 *   A card may keep a negation with a negative verb (*dropped, removed, stays*) or a cap (*cannot … more than N* →
 *   *at most N*); a double negation (*never … without*) may be stated plainly, but not with one negation left.
 * - **Unsupported number** (`unsupported_number`): a number (with its unit) or an identifier the units don't have.
 * - **Citation sanity** (`citation_unrelated`): the card shares no significant word or key term with a unit it cites.
 *
 * Analysis cards (`origin: "analysis"`, D-R2.1) may infer, so the "unsupported" rules (added absolute, unsupported
 * number, citation sanity, and a cause stated without one in the source) don't apply to them. Cards placed by
 * reference are verbatim by construction and are not checked.
 *
 * Flags about one unit carry its id; flags about the card as a whole (absolute, number) carry only the card.
 */
import type { CheckMeaning, Idea, ReviewCode, ReviewFlag, SourceUnit } from "./contracts";
import { FIDELITY_CUES, findCues, hasCue } from "@/config/fidelityCues";
import { keyTerms, significant, words } from "./information";
import { containsTerm, normalizeForCompare, plainText } from "./exactness";
import { quantitiesOf, supportsQuantity } from "./quantities";

const CUES = FIDELITY_CUES.meaning;

// ---------------------------------------------------------------- text helpers

/** A rough stem, so "cached", "caches" and "caching" compare equal. Not a linguistic stemmer: prefixes of six. */
export function stem(word: string): string {
  let s = word.toLowerCase();
  if (s.length > 4 && /ie[sd]$/.test(s)) s = `${s.slice(0, -3)}y`;
  else if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  else if (s.length > 4 && /(?:ss|sh|ch|x|z)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith("ly")) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s.slice(0, 6);
}

/** Stems of a text's significant words; a hyphenated word adds its parts ("eu-region" → "eu-reg", "region"). */
function stemsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of significant(text)) {
    out.add(stem(w));
    if (w.includes("-")) for (const part of significant(w.replace(/-/g, " "))) out.add(stem(part));
  }
  return out;
}

/** Every word's stem, short ones included ("EU"), hyphenated words also by part. For scope modifiers. */
function allStemsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(text)) {
    out.add(stem(w));
    if (w.includes("-")) for (const part of w.split("-")) if (part) out.add(stem(part));
  }
  return out;
}

function overlap(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

/** Sentences, then clauses split at contrasts and semicolons (a negation or a direction belongs to its clause). */
function clauses(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+|;\s*|,\s*(?=(?:but|while|whereas|although|though|however|yet|so)\b)|\s+(?=but\b)|:\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

/** The sentence around a position. */
function sentenceAt(text: string, at: number): { start: number; end: number } {
  let start = at;
  while (start > 0 && !/[.!?\n;]/.test(text[start - 1]!)) start--;
  let end = at;
  while (end < text.length && !/[.!?\n;]/.test(text[end]!)) end++;
  return { start, end };
}

/** Matches of `cues`, the longest where two overlap. */
function cueMatches(text: string, cues: readonly string[]): { cue: string; start: number; end: number }[] {
  const all = findCues(text, cues);
  const kept: typeof all = [];
  for (const m of all) if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push(m);
  return kept;
}

/** Up to `n` words after `at`, within the sentence. */
function wordsAfter(text: string, at: number, n: number): string {
  const { end } = sentenceAt(text, at);
  return words(text.slice(at, end)).slice(0, n).join(" ");
}

function wordsBefore(text: string, at: number, n: number): string {
  const { start } = sentenceAt(text, at);
  return words(text.slice(start, at)).slice(-n).join(" ");
}

function quoteOf(text: string, start: number, end: number): string {
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

type Emit = (code: ReviewCode, unit: SourceUnit, detail: string, evidence?: { source?: string; card?: string }) => void;

// ---------------------------------------------------------------- dropped qualifier

const NUMBER_AHEAD = /^\s*(?:[\p{L}-]+\s+){0,2}?(?:\d|zero\b|two\b|three\b|four\b|five\b|six\b|seven\b|eight\b|nine\b|ten\b|twelve\b|twenty\b|fifty\b|hundred\b|half\b|a few\b|a dozen\b)/iu;
/** Limits that are limits only before an amount ("over 3 nodes", not "over the network"). */
const LIMITS_NEEDING_AMOUNT = new Set(["about", "around", "over", "under", "above", "below", "within", "between", "less than", "more than", "fewer than", "up to", "approximately", "roughly", "nearly", "almost", "max", "min", "cap*", "limit*", "ceiling", "floor"]);

/** Hedge and limit matches in a source text, excluding negations ("cannot", "could not") and "at most"'s "most". */
function qualifiersIn(text: string): { cue: string; start: number; end: number }[] {
  const limits = cueMatches(text, CUES.limits).filter((m) => !LIMITS_NEEDING_AMOUNT.has(m.cue) || NUMBER_AHEAD.test(text.slice(m.end)));
  const hedges = cueMatches(text, CUES.hedges).filter(
    (m) => !limits.some((l) => m.start < l.end && l.start < m.end) && !((m.cue === "can" || m.cue === "could") && /^\s*(?:not\b|'t\b)/i.test(text.slice(m.end))),
  );
  return [...hedges, ...limits].sort((a, b) => a.start - b.start);
}

/** The hedge and limit cues a text has, one entry per match, plus "range" for "6-8" / "6 to 8". */
function qualifierCues(text: string): string[] {
  const found = [...cueMatches(text, CUES.hedges), ...cueMatches(text, CUES.hedgeEquivalents), ...cueMatches(text, CUES.limits)].map((m) => m.cue);
  if (/\d\s*(?:-|to)\s*\d/.test(text)) found.push("range");
  return found;
}

/**
 * Whether the card keeps a qualifier for `q`: it has a hedge or limit that isn't just a copy of the source's other
 * qualifiers ("for a few seconds" copied into the card doesn't keep the dropped "may").
 */
function cardKeepsQualifier(cardCues: readonly string[], sourceCues: readonly { cue: string }[], q: { cue: string }): boolean {
  const left = [...cardCues];
  for (const other of sourceCues) {
    if (other === q) continue;
    const i = left.indexOf(other.cue);
    if (i >= 0) left.splice(i, 1);
  }
  return left.length > 0;
}

/** "can restore" kept as "restorable": an -able/-ible adjective built on the verb the ability is about. */
function keepsAbility(card: string, text: string, q: { cue: string; end: number }): boolean {
  if (q.cue !== "can" && q.cue !== "could" && q.cue !== "able to") return false;
  const verb = words(text.slice(q.end))[0];
  if (!verb) return false;
  const base = stem(verb);
  return words(card).some((w) => /(?:able|ible)$/.test(w) && w.length > 6 && stem(w.slice(0, -4)) === base);
}

const LOWER_BOUNDS = new Set(["at least", "no fewer than", "no less than", "or more", "minimum", "min"]);

/**
 * Rubric rule 8: a requirement for N means at least N. "At least two approvals are required" is kept by "two
 * approvals are required", unless the card makes the count exact ("exactly two"). A limit ("up to 3") is not a floor.
 */
function keepsFloorAsRequirement(card: string, q: { cue: string }): boolean {
  return LOWER_BOUNDS.has(q.cue) && hasCue(card, CUES.requirements) && !hasCue(card, CUES.exactCounts);
}

/**
 * A caveat that limits or excludes ("time zones other than UTC are not supported") restated by a card that restricts
 * the same thing another way ("only UTC is supported"): a restriction word in a card clause that shares the caveat's words.
 */
function restrictionRestated(card: string, caveat: string, caveatStems: ReadonlySet<string>): boolean {
  if (!hasCue(caveat, [...CUES.restrictionKept, ...CUES.hedges])) return false;
  return clauses(card).some((c) => hasCue(c, [...CUES.restrictionKept, ...CUES.hedges]) && overlap(stemsOf(c), caveatStems) > 0);
}

const SYNONYM = new Map<string, string>(CUES.costSynonyms.flatMap((g) => g.map((w) => [stem(w), stem(g[0]!)] as const)));
const canon = (s: string) => SYNONYM.get(s) ?? s;
const canonSet = (stems: Iterable<string>) => new Set([...stems].map(canon));
const NEGATED_BEFORE = /\b(?:no|not|never|without|\w+n't|cannot)\s+(?:[\p{L}-]+\s+)?$/iu;

interface CostWord {
  dimension: string;
  better: boolean;
  /** Stems of the word, three words before it and four after (a coordinated object: "saves work and money"), within its clause, synonyms folded. */
  about: Set<string>;
  word: string;
}

/** The cost words of a text: each worse or better word of a dimension; a negated worse word ("without delaying") is better. */
function costWordsOf(text: string): CostWord[] {
  const out: CostWord[] = [];
  for (const clause of clauses(text)) {
    for (const d of CUES.costDimensions) {
      for (const [better, cues] of [
        [false, d.worse],
        [true, d.better],
      ] as const) {
        for (const m of cueMatches(clause, cues)) {
          const before = clause.slice(0, m.start);
          const negated = NEGATED_BEFORE.test(before);
          const about = canonSet([...stemsOf(clause.slice(m.start, m.end)), ...stemsOf(words(before).slice(-3).join(" ")), ...stemsOf(words(clause.slice(m.end)).slice(0, 4).join(" "))]);
          out.push({ dimension: d.name, better: better !== negated, about, word: quoteOf(clause, m.start, m.end) });
        }
      }
    }
  }
  return out;
}

/**
 * A trade-off's cost inverted: the caveat makes something worse in one dimension ("security fixes arrive later"), and
 * the card says the better side about the same thing ("keeps security fixes current") and never the worse side.
 * Returns the card's words, or null.
 */
function costInverted(card: string, caveat: string, caveatStems: ReadonlySet<string>): string | null {
  const costs = new Set(costWordsOf(caveat).filter((w) => !w.better).map((w) => w.dimension));
  if (!costs.size) return null;
  const about = canonSet(caveatStems);
  const cardWords = costWordsOf(card);
  for (const dimension of costs) {
    if (cardWords.some((w) => w.dimension === dimension && !w.better)) continue;
    const hit = cardWords.find((w) => w.dimension === dimension && w.better && overlap(w.about, about) > 0);
    if (hit) return hit.word;
  }
  return null;
}

/** Dropped qualifier (hedges, limits on amounts) and dropped caveat (a cost or caveat joined to the claim: `caveat_dropped`). */
function qualifierRule(card: string, cardStems: ReadonlySet<string>, unit: SourceUnit, text: string, emit: Emit): void {
  const cardNorm = normalizeForCompare(card);
  const cardCues = qualifierCues(card);
  const sourceQualifiers = qualifiersIn(text);
  {
    for (const q of sourceQualifiers) {
      if (cardKeepsQualifier(cardCues, sourceQualifiers, q)) continue;
      if (keepsAbility(card, text, q) || keepsFloorAsRequirement(card, q)) continue;
      const after = wordsAfter(text, q.end, 6);
      const scope = stemsOf(after);
      const subject = stemsOf(wordsBefore(text, q.start, 3));
      // The card restates the qualified part when it has its words, or the amount a limit applies to.
      const amount = /\d+(?:\.\d+)?/.exec(normalizeForCompare(after))?.[0];
      const restated = overlap(scope, cardStems) > 0 || (amount !== undefined && containsTerm(cardNorm, amount)) || (scope.size === 0 && overlap(subject, cardStems) > 0);
      if (!restated) continue;
      const phrase = quoteOf(text, q.start, Math.min(text.length, q.end + after.length + 1));
      emit("qualifier_dropped", unit, `source says "${phrase}"`, { source: phrase });
      return;
    }
  }
  // A caveat on the claim: "faster, but uses more memory".
  for (const c of cueMatches(text, CUES.caveats)) {
    const { start, end } = sentenceAt(text, c.start);
    const sentence = text.slice(start, end);
    const at = c.start - start;
    const leading = words(sentence.slice(0, at)).length === 0;
    // "Although X, Y": X is the caveat (up to the comma). "Y, but X" / "Y at the cost of X": X is the caveat.
    let caveat: string;
    let claim: string;
    let stop = sentence.length;
    if (leading) {
      const comma = sentence.indexOf(",", at);
      if (comma < 0) continue;
      caveat = sentence.slice(c.end - start, comma);
      claim = sentence.slice(comma + 1);
      stop = comma;
    } else {
      caveat = sentence.slice(c.end - start);
      claim = sentence.slice(0, at);
    }
    const claimStems = stemsOf(claim);
    const caveatStems = new Set([...stemsOf(caveat)].filter((s) => !claimStems.has(s)));
    if (!caveatStems.size || overlap(claimStems, cardStems) === 0) continue;
    const phrase = quoteOf(sentence, at, stop);
    const inverted = costInverted(card, caveat, caveatStems);
    if (inverted) {
      emit("caveat_dropped", unit, `the card turns the source's cost "${phrase}" into "${inverted}"`, { source: phrase, card: inverted });
      return;
    }
    if (overlap(caveatStems, cardStems) / caveatStems.size >= FIDELITY_CUES.caveatOverlap) continue;
    if (restrictionRestated(card, caveat, caveatStems)) continue;
    emit("caveat_dropped", unit, `the card drops the source's caveat "${phrase}"`, { source: phrase });
    return;
  }
}

// ---------------------------------------------------------------- condition and scope

/** A condition's or scope's clause: from the marker to the next comma (or the sentence's end). */
function clauseAfter(text: string, end: number): string {
  const { end: stop } = sentenceAt(text, end);
  const rest = text.slice(end, stop);
  const comma = rest.search(/,|\bthen\b/);
  return comma >= 0 ? rest.slice(0, comma) : rest;
}

const SCOPE_NOUNS =
  /^(?:workloads?|users?|customers?|tenants?|accounts?|regions?|environments?|production|staging|plans?|tiers?|versions?|platforms?|linux|windows|macos|ios|android|browsers?|devices?|teams?|projects?|endpoints?|tables?|files?|deployments?|clusters?|members?|admins?|administrators?|subscribers?|instances?|databases?|languages?|markets?|countries|organi[sz]ations?|apps?|clients?|services?|queries|jobs?|builds?|branches|hosts?)$/i;
/** "for read-only workloads", "for internal services", "in the EU region": a prepositional phrase that narrows the claim. */
const SCOPE_PHRASE = /(?<![\p{L}\p{N}-])(?:for|on|in|within|across|to)\s+((?:the\s+|all\s+|our\s+)?(?:[\p{L}\p{N}-]+\s+){0,3}[\p{L}\p{N}-]+)(?=[\s,.;:)]|$)/giu;
const NARROWING = /-|\b(?:only|internal|external|enterprise|free|paid|premium|legacy|new|existing|mobile|desktop|eu|us|beta|large|small|single|multi)\b/i;

const SCOPE_FILLER = new Set(["the", "a", "an", "all", "our", "their", "its", "only", "those", "that", "which", "who", "with", "of", "in", "on", "for", "to", "per", "and", "or", "is", "are", "be", "than", "up", "after", "before"]);

/**
 * The words that narrow a scope: "premium" in "premium subscribers only", "desktop" in "only on the desktop app".
 * Dropping the noun alone is a paraphrase; dropping the narrowing word widens the claim.
 */
function modifiersOf(clause: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(clause)) if (!SCOPE_FILLER.has(w) && !SCOPE_NOUNS.test(w)) out.add(stem(w));
  return out;
}

function scopesIn(text: string): { marker: string; clause: string }[] {
  const out: { marker: string; clause: string }[] = [];
  for (const m of cueMatches(text, CUES.scopes)) out.push({ marker: m.cue, clause: clauseAfter(text, m.end) });
  for (const m of text.matchAll(SCOPE_PHRASE)) {
    const phrase = m[1]!;
    if (words(phrase).some((w) => SCOPE_NOUNS.test(w)) && NARROWING.test(phrase)) out.push({ marker: m[0].split(/\s/)[0]!.toLowerCase(), clause: phrase });
  }
  return out;
}

const ABSOLUTE_WORDS = new Set(CUES.absolutes.flatMap((g) => g.words));

/** Dropped or changed condition, and dropped scope. */
function conditionRule(card: string, cardStems: ReadonlySet<string>, unit: SourceUnit, text: string, emit: Emit): void {
  // A widening ("whenever", "at any time") the source doesn't have: the card claims more than the source.
  const widened = cueMatches(card, CUES.widening).find((w) => !hasCue(text, [w.cue]));
  const conditions = cueMatches(text, CUES.conditions).map((m) => ({ marker: m.cue, clause: clauseAfter(text, m.end) }));
  // With no condition in the source, "always" is an added absolute (that rule reports it); "at any time" is ours.
  if (widened && (conditions.length > 0 || !ABSOLUTE_WORDS.has(widened.cue))) {
    const c = conditions[0];
    const source = c ? `${c.marker} ${c.clause.trim()}` : undefined;
    emit("condition_changed", unit, source ? `source says "${source}"; the card says "${widened.cue}"` : `the card says "${widened.cue}"; the source doesn't`, { source, card: widened.cue });
    return;
  }
  for (const c of conditions) {
    const stems = stemsOf(c.clause);
    if (!stems.size) continue;
    if (overlap(stems, cardStems) / stems.size < FIDELITY_CUES.conditionOverlap) {
      emit("condition_changed", unit, `source says "${c.marker} ${c.clause.trim()}"`, { source: `${c.marker} ${c.clause.trim()}` });
      return;
    }
    if (c.marker === "unless") {
      const cardMarker = cueMatches(card, CUES.cardConditions)[0];
      if (cardMarker && cardMarker.cue !== "unless" && !hasCue(clauseAfter(card, cardMarker.end), CUES.negators) && !hasCue(card, ["except", "unless", "otherwise"])) {
        emit("condition_changed", unit, `source says "unless ${c.clause.trim()}"; the card says "${cardMarker.cue}"`, { source: `unless ${c.clause.trim()}`, card: cardMarker.cue });
        return;
      }
    }
  }
  const cardAll = allStemsOf(card);
  for (const s of scopesIn(text)) {
    const mods = modifiersOf(s.clause);
    if (!mods.size) continue;
    if (overlap(mods, cardAll) / mods.size < FIDELITY_CUES.conditionOverlap) {
      emit("condition_changed", unit, `source limits it: "${s.marker} ${s.clause.trim()}"`, { source: `${s.marker} ${s.clause.trim()}` });
      return;
    }
  }
  // A restriction ("over Wi-Fi only", "only on Wi-Fi") the card restates without restricting: the claim is widened.
  if (hasCue(card, CUES.restrictionKept)) return;
  for (const r of cueMatches(text, CUES.restrictives)) {
    const before = text.slice(0, r.start);
    const after = text.slice(r.end);
    // "not only" is emphasis; "only 5%", "only covers the last 90 days" state an amount; "only when" is a condition (checked above).
    if (/\bnot\s*$/i.test(before) || NUMBER_AHEAD.test(after) || /\d/.test(wordsAfter(text, r.end, 4)) || hasCue(wordsAfter(text, r.end, 1), CUES.conditions)) continue;
    const phrase = `${wordsBefore(text, r.start, 2)} ${quoteOf(text, r.start, r.end)} ${wordsAfter(text, r.end, 3)}`.trim();
    if (overlap(stemsOf(phrase), cardStems) === 0) continue;
    emit("condition_changed", unit, `source restricts it: "${phrase}"; the card doesn't`, { source: phrase });
    return;
  }
}

// ---------------------------------------------------------------- cause and effect

/** Cause and effect of the first causal marker in a text, as stems; null when there is none. */
function causalOf(text: string): { cause: Set<string>; effect: Set<string>; marker: string } | null {
  const first = cueMatches(text, CUES.causeFirst).map((m) => ({ ...m, forward: true }));
  const second = cueMatches(text, CUES.causeSecond).map((m) => ({ ...m, forward: false }));
  const all = [...first, ...second].filter((m) => m.cue !== "so" || /,\s*$/.test(text.slice(0, m.start))).sort((a, b) => a.start - b.start || b.end - a.end);
  const m = all.find((x, i) => !all.slice(0, i).some((y) => x.start < y.end && y.start < x.end));
  if (!m) return null;
  const { start, end } = sentenceAt(text, m.start);
  const left = text.slice(start, m.start);
  const right = text.slice(m.end, end);
  // "Because A, B": the marker leads; the comma splits cause from effect.
  if (!words(left).length) {
    const comma = right.indexOf(",");
    if (comma < 0) return null;
    const a = stemsOf(right.slice(0, comma));
    const b = stemsOf(right.slice(comma + 1));
    return m.forward ? { cause: b, effect: a, marker: m.cue } : { cause: a, effect: b, marker: m.cue };
  }
  const l = stemsOf(left);
  const r = stemsOf(right);
  for (const s of [...l])
    if (r.has(s)) {
      l.delete(s);
      r.delete(s);
    }
  return m.forward ? { cause: l, effect: r, marker: m.cue } : { cause: r, effect: l, marker: m.cue };
}

const PASSIVE = /\b(?:is|are|was|were|be|been|being|gets?|got)\s*$/i;

/** Each direction word ("reduces", "more") with the stems it applies to, within its clause: the next words, or the subject when passive. */
function directionsOf(text: string): { side: 0 | 1; group: number; objects: Set<string>; word: string }[] {
  const out: { side: 0 | 1; group: number; objects: Set<string>; word: string }[] = [];
  for (const clause of clauses(text)) {
    CUES.directions.forEach(([a, b], group) => {
      const sides: [0 | 1, readonly string[]][] = [
        [0, a],
        [1, b],
      ];
      for (const [side, cues] of sides) {
        for (const m of cueMatches(clause, cues)) {
          const before = clause.slice(0, m.start);
          // "no longer", "no more", "not faster": a negation, not a direction.
          if (/\b(?:no|not)\s*$/i.test(before)) continue;
          const next = stemsOf(words(clause.slice(m.end)).slice(0, 3).join(" "));
          const prev = stemsOf(words(before).slice(-3).join(" "));
          const objects = PASSIVE.test(before) || next.size === 0 ? prev : next;
          out.push({ side, group, objects, word: quoteOf(clause, m.start, m.end) });
        }
      }
    });
  }
  return out;
}

/** Changed cause or effect: opposite direction, swapped parts, or (not for analysis cards) an added cause. */
function causeRule(card: string, unit: SourceUnit, text: string, analysis: boolean, emit: Emit): void {
  // Opposite direction about the same thing: some object the card moves one way, the unit only the other way.
  const unitDirs = directionsOf(text);
  for (const c of directionsOf(card)) {
    for (const o of c.objects) {
      const opposite = unitDirs.find((u) => u.group === c.group && u.side !== c.side && u.objects.has(o));
      const same = unitDirs.some((u) => u.group === c.group && u.side === c.side && u.objects.has(o));
      if (opposite && !same) {
        emit("cause_changed", unit, `source says "${opposite.word}"; the card says "${c.word}"`, { source: opposite.word, card: c.word });
        return;
      }
    }
  }
  const u = causalOf(text);
  const c = causalOf(card);
  if (u && c) {
    const sameWay = overlap(c.cause, u.cause) + overlap(c.effect, u.effect);
    const swapped = overlap(c.cause, u.effect) + overlap(c.effect, u.cause);
    if (overlap(c.cause, u.effect) > 0 && overlap(c.effect, u.cause) > 0 && swapped > sameWay) {
      emit("cause_changed", unit, `cause and effect are swapped (source: "${u.marker}")`, { source: text, card });
      return;
    }
  }
  // A condition is a dependency too: "retries only when it times out" → "timeouts trigger a retry" adds nothing.
  if (!analysis && c && !u && !hasCue(text, CUES.causalVerbs) && !hasCue(text, CUES.conditions) && overlap(stemsOf(text), new Set([...c.cause, ...c.effect])) > 0) {
    emit("cause_changed", unit, `the card says "${c.marker}"; the source states no cause`, { card: c.marker });
  }
}

// ---------------------------------------------------------------- negation

/** Negators for polarity: the configured ones, "unless" (if not) and exceptions ("except", "other than"). */
const NEGATORS = [...CUES.negators, "unless", "except", "apart from", "other than", "excluding"];
/** "unsupported", "unavailable", "uncached": a negation in one word. Not "under", "until", "unique", "universal". */
const NEGATED_WORD = /(?<![\p{L}])(?:un(?!der|til|ion|iq|it|iv|if|less)|non-?|in(?=valid|compatible|secure|active|correct|complete))(\p{L}{3,})/giu;

interface Polarity {
  text: string;
  negated: boolean;
  /** How many negations the clause has (negators and negated words like "unsigned"). */
  count: number;
  /**
   * Two negations, one of them an exclusion ("never deletes without a confirmation", "other than UTC … not
   * supported"): they cancel, and the clause states a requirement or a restriction, not a negation.
   */
  double: boolean;
  /** Stems of up to three content words after a negator: what the clause says is not so. */
  scope: Set<string>;
  stems: Set<string>;
}

function polarityOf(clause: string): Polarity {
  const masked = cueMatches(clause, CUES.notNegations).reduceRight((t, m) => t.slice(0, m.start) + " ".repeat(m.end - m.start) + t.slice(m.end), clause);
  const scope = new Set<string>();
  const hits = cueMatches(masked, NEGATORS);
  for (const h of hits) for (const w of significant(words(masked.slice(h.end)).slice(0, 4).join(" ")).slice(0, 3)) scope.add(stem(w));
  let count = hits.length;
  for (const m of masked.matchAll(NEGATED_WORD)) {
    count++;
    scope.add(stem(m[1]!));
  }
  const exclusions = hits.filter((h) => CUES.exclusions.includes(h.cue)).length;
  const double = count === 2 && exclusions === 1;
  const stems = stemsOf(clause.replace(NEGATED_WORD, (_w, base: string) => base));
  return { text: clause, negated: count > 0, count, double, scope, stems };
}

/**
 * Whether a card clause states the unit clause's negation without a negator: a negative verb ("support has been
 * dropped", "the page stays loaded"), or, for a negated excess ("cannot invite more than two"), a cap ("at most two").
 */
function expressesNegation(card: Polarity, unit: Polarity): boolean {
  if (hasCue(card.text, CUES.negationEquivalents)) return true;
  const negator = cueMatches(unit.text, NEGATORS)[0];
  if (!negator) return false;
  const rest = unit.text.slice(negator.end);
  return (hasCue(rest, CUES.beyond) && hasCue(card.text, CUES.upperLimits)) || (hasCue(rest, CUES.short) && hasCue(card.text, CUES.lowerLimits));
}

/**
 * Negation flip: what one side says is not so, the other says plainly, about the same thing. A clause that negates
 * anything is taken to agree ("failed requests are not retried" for "does not retry failed requests"): the rule
 * compares polarity, not which word the negation sits on. A double negation ("will not start without a key") is
 * positive: the card may say it plainly, but not with a single negation ("starts without a key").
 */
function negationRule(card: string, unit: SourceUnit, text: string, emit: Emit): void {
  const unitClauses = clauses(text).map(polarityOf);
  const cardClauses = clauses(card).map(polarityOf);
  const cardCount = cardClauses.reduce((n, c) => n + c.count, 0);
  const contextNeed = (a: Polarity, b: Polarity) => Math.min(2, a.stems.size, b.stems.size);
  for (const u of unitClauses) {
    if (!u.negated || !u.scope.size) continue;
    for (const c of cardClauses) {
      if (overlap(u.scope, c.stems) === 0 || overlap(u.stems, c.stems) < contextNeed(u, c)) continue;
      if (u.double) {
        if (cardCount !== 1 || !c.negated) continue;
        emit("negation_flip", unit, `source says "${u.text}"; the card keeps only one of its two negations`, { source: u.text, card: c.text });
        return;
      }
      if (c.negated || expressesNegation(c, u)) continue;
      emit("negation_flip", unit, `source says "${u.text}"; the card drops the negation`, { source: u.text, card: c.text });
      return;
    }
  }
  for (const c of cardClauses) {
    if (!c.negated || !c.scope.size) continue;
    for (const u of unitClauses) {
      if (u.negated || overlap(c.scope, u.stems) === 0 || overlap(u.stems, c.stems) < contextNeed(u, c)) continue;
      emit("negation_flip", unit, `source says "${u.text}"; the card negates it`, { source: u.text, card: c.text });
      return;
    }
  }
}

// ---------------------------------------------------------------- unsupported content (not for analysis cards)

/** Added absolute: an absolute on the card the cited units don't support. */
function absoluteRule(card: string, sources: string, emit: (detail: string, evidence: { card: string }) => void): void {
  for (const group of CUES.absolutes) {
    const m = cueMatches(card, group.words)[0];
    if (!m || hasCue(sources, group.supportedBy)) continue;
    const word = quoteOf(card, m.start, m.end);
    emit(`the card says "${word}"; the source doesn't`, { card: word });
    return;
  }
}

/**
 * Unsupported number or identifier: on the card, in none of the cited units. Numbers are compared as quantities
 * (`quantities.ts`): by value and dimension, so "two thousand" = "2,000" and "0.25 seconds" = "250 ms", while
 * "200 s" ≠ "200 ms" and a range collapsed to one of its ends ("4–8" → "8") is unsupported.
 */
function numberRule(card: string, sources: string, emit: (detail: string, evidence: { card: string }) => void): void {
  const src = normalizeForCompare(sources);
  const srcQuantities = quantitiesOf(sources);
  for (const q of quantitiesOf(card)) {
    if (srcQuantities.some((s) => supportsQuantity(s, q))) continue;
    const near = srcQuantities.find((s) => s.dimension === q.dimension || s.rawLow === q.rawLow || s.rawHigh === q.rawHigh);
    const shown = q.text.trim();
    emit(near ? `the card says "${shown}"; the source has "${near.text.trim()}"` : `the card says "${shown}"; the source doesn't`, { card: shown });
    return;
  }
  for (const term of keyTerms(normalizeForCompare(card, { keepCase: true }))) {
    // Numbers were checked above; a hyphenated word ("trade-off", "eu-region") or a range ("4-8") is not an identifier.
    if (/^[\d.]+(?:-[\d.]+)*$/.test(term) || /^[\p{L}-]+$/u.test(term) || containsTerm(src, normalizeForCompare(term))) continue;
    emit(`the card names "${term}"; the source doesn't`, { card: term });
    return;
  }
}

// ---------------------------------------------------------------- the check

/** The §3.4 rules for one card against the units it cites. */
export const checkMeaning: CheckMeaning = (idea: Idea, cited: readonly SourceUnit[]): ReviewFlag[] => {
  if (idea.byReference || !cited.length) return [];
  const analysis = idea.origin === "analysis";
  const card = plainText([idea.title, idea.body].filter((s) => s.trim()).join("\n"));
  const cardStems = stemsOf(card);
  const cardTerms = new Set(keyTerms(normalizeForCompare(card)));
  const flags: ReviewFlag[] = [];
  const seen = new Set<string>();
  const push = (code: ReviewCode, unitId: string | undefined, detail: string, evidence?: { source?: string; card?: string }) => {
    const key = `${code}:${unitId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    flags.push({ code, ...(unitId ? { unit: unitId } : {}), card: idea.id, detail, ...(evidence ? { evidence } : {}) });
  };
  const emit: Emit = (code, unit, detail, evidence) => push(code, unit.id, detail, evidence);

  for (const unit of cited) {
    const text = plainText(unit.text);
    const related = overlap(stemsOf(text), cardStems) > 0 || keyTerms(normalizeForCompare(text)).some((t) => cardTerms.has(t));
    if (!related) {
      if (!analysis) emit("citation_unrelated", unit, `the card shares no words with the passage it cites: "${quoteOf(text, 0, 80)}"`, { source: text });
      continue;
    }
    qualifierRule(card, cardStems, unit, text, emit);
    conditionRule(card, cardStems, unit, text, emit);
    causeRule(card, unit, text, analysis, emit);
    negationRule(card, unit, text, emit);
  }

  if (!analysis) {
    const sources = cited.map((u) => plainText(u.text)).join("\n");
    // About the card as a whole, not one unit: no `unit`, so accounting applies it to every unit the card cites.
    absoluteRule(card, sources, (detail, evidence) => push("absolute_added", undefined, detail, evidence));
    numberRule(card, sources, (detail, evidence) => push("unsupported_number", undefined, detail, evidence));
  }
  return flags;
};
