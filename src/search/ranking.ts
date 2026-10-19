/**
 * Deterministic text ranking of the workspace index (F22), which also serves
 * MCP `search_workspace` (F21). Pure: no index, no DOM.
 *
 * Two modes:
 *
 * - `all` (keyword search, the MCP contract): every query word must appear
 *   (case-insensitive substring) in the title or the text. Score = word
 *   occurrences in the text (each capped) + 5 per word in the title, +10 when
 *   the whole query appears as a phrase. Pinned by `workspaceIndex.test.ts`
 *   and `mcp/tools/search.test.ts`.
 * - `any` (retrieval for AI context): a natural-language question rarely has
 *   every word in one object, so an object matches on any term, and terms
 *   are weighted by rarity (IDF over the matching set) so words that appear
 *   everywhere count for little. Objects matching more distinct terms rank
 *   first, then by weighted score.
 *
 * Ties always fall back to the caller's stable order, so equal input gives
 * equal output.
 */
import { searchSources } from "./canvasSearch";

export const RANKING_LIMITS = {
  /** Text of one item that is searched (the rest is ignored). */
  textChars: 50_000,
  /** Occurrences of one word counted per item. */
  occurrences: 20,
  words: 8,
  queryChars: 200,
} as const;

/** The query's distinct lower-case words, at most `RANKING_LIMITS.words` (same split as MCP). */
export function queryWords(query: string): string[] {
  return [...new Set(query.slice(0, RANKING_LIMITS.queryChars).toLowerCase().split(/\s+/).filter(Boolean))].slice(0, RANKING_LIMITS.words);
}

const STOP_WORDS = new Set(
  (
    "a an and are as at be but by can could did do does doing for from had has have how i if in into is it its me my of on or our " +
    "so than that the their them then there these they this those to was we were what when where which while who why will with would " +
    "you your about also any all each just more most other some such only very should shall may might must been being here over under " +
    "explain summarize describe tell show give list find please help want need make know think using use"
  ).split(" "),
);

/**
 * Search terms of a natural-language question: distinct lower-case words of
 * at least 3 letters/digits (or 2 when written in capitals, e.g. "UI"),
 * without stop words, in first-seen order, at most `RANKING_LIMITS.words`.
 */
export function questionTerms(question: string): string[] {
  const out: string[] = [];
  for (const raw of question.slice(0, 2_000).match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []) {
    const word = raw.toLowerCase().replace(/[-_]+$/, "");
    const short = word.length < 3 && !(word.length === 2 && raw === raw.toUpperCase() && /\p{L}/u.test(raw));
    if (short || STOP_WORDS.has(word) || out.includes(word)) continue;
    out.push(word);
    if (out.length >= RANKING_LIMITS.words) break;
  }
  return out;
}

export function countOccurrences(haystack: string, needle: string, cap: number = RANKING_LIMITS.occurrences): number {
  let n = 0;
  for (let at = haystack.indexOf(needle); at >= 0 && n < cap; at = haystack.indexOf(needle, at + needle.length)) n++;
  return n;
}

/** What ranking needs of one item; `lowerText` is the (already bounded) text in lower case. */
export interface RankInput {
  title: string;
  lowerTitle: string;
  text: string;
  lowerText: string;
  /** Lower-case text with whitespace runs collapsed (for phrase matching). */
  flatLowerText: string;
}

export function rankInput(title: string | undefined, text: string): RankInput {
  const body = text.slice(0, RANKING_LIMITS.textChars);
  const lowerText = body.toLowerCase();
  return { title: title ?? "", lowerTitle: (title ?? "").toLowerCase(), text: body, lowerText, flatLowerText: lowerText.replace(/\s+/g, " ") };
}

export interface WordMatch {
  word: string;
  inText: number;
  inTitle: boolean;
}

/** Per-word matches of one item (words that do not match are left out). */
export function matchWords(item: RankInput, words: readonly string[]): WordMatch[] {
  const out: WordMatch[] = [];
  for (const word of words) {
    const inText = countOccurrences(item.lowerText, word);
    const inTitle = item.lowerTitle.includes(word);
    if (inText || inTitle) out.push({ word, inText, inTitle });
  }
  return out;
}

/** The whole query as one phrase (only for multi-word queries), normalized. */
export function phraseOf(query: string, words: readonly string[]): string | null {
  return words.length > 1 ? query.slice(0, RANKING_LIMITS.queryChars).toLowerCase().trim().replace(/\s+/g, " ") : null;
}

export interface Scored {
  score: number;
  /** Occurrences of the query's words in title and text (each word capped). */
  matches: number;
  /** Distinct query words that matched. */
  matchedWords: string[];
  phraseInText: boolean;
}

/** `all` mode (the MCP formula): null unless every word matches. */
export function scoreAll(item: RankInput, words: readonly string[], phrase: string | null): Scored | null {
  if (!words.length) return null;
  const found = matchWords(item, words);
  if (found.length !== words.length) return null;
  let score = 0;
  let matches = 0;
  for (const m of found) {
    score += m.inText + (m.inTitle ? 5 : 0);
    matches += m.inText + (m.inTitle ? 1 : 0);
  }
  const phraseInText = !!phrase && item.flatLowerText.includes(phrase);
  if (phrase && (phraseInText || item.lowerTitle.includes(phrase))) score += 10;
  return { score, matches, matchedWords: found.map((m) => m.word), phraseInText };
}

/**
 * `any` mode: weighted by `weight(word)` (callers pass an IDF). Per word:
 * weight × (1 + ln(occurrences)) for the text, + 2 × weight for the title;
 * +weight-sum bonus when the phrase appears. Null when nothing matches.
 */
export function scoreAny(item: RankInput, words: readonly string[], phrase: string | null, weight: (word: string) => number, found = matchWords(item, words)): Scored | null {
  if (!found.length) return null;
  let score = 0;
  let matches = 0;
  for (const m of found) {
    const w = weight(m.word);
    score += (m.inText ? w * (1 + Math.log(m.inText)) : 0) + (m.inTitle ? 2 * w : 0);
    matches += m.inText + (m.inTitle ? 1 : 0);
  }
  const phraseInText = !!phrase && item.flatLowerText.includes(phrase);
  if (phrase && (phraseInText || item.lowerTitle.includes(phrase))) score += found.reduce((s, m) => s + weight(m.word), 0);
  return { score: Math.round(score * 1e6) / 1e6, matches, matchedWords: found.map((m) => m.word), phraseInText };
}

/** Inverse document frequency: rarer words weigh more. */
export function idf(total: number, containing: number): number {
  return Math.log(1 + total / Math.max(1, containing));
}

/** Text around the best match ("…before match after…"): the phrase when it matched, else the first word found. */
export function snippetOf(item: RankInput, words: readonly string[], phrase: string | null, phraseInText: boolean): string | undefined {
  const around = (needle: string | undefined) => (needle ? searchSources([{ elementId: "", kind: "rich", text: item.text }], needle)[0] : undefined);
  const found = (phraseInText && phrase ? around(phrase) : undefined) ?? around(words.find((w) => item.lowerText.includes(w)));
  return found ? `${found.snippet.before}${found.snippet.match}${found.snippet.after}` : undefined;
}
