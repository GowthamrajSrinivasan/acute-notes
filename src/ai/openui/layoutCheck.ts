/**
 * The layout check (note-taking-modes plan §4.3, Step 4): what the canvas checks, with no model call, before a card layout
 * composed elsewhere (an MCP client, later in-app AI) is proposed or drawn.
 *
 * Errors refuse the layout:
 * - it parses against the card library with no error, no unresolved reference and nothing truncated;
 * - it is static: the only calls outside string literals are the library's components — no Query, Mutation, Action,
 *   builtin function or `$state` (a layout shows a card; it never fetches, changes or navigates anything);
 * - it is within limits (characters, statements, components, text);
 * - every source passage it cites exists among the passages the card may cite (a client can't invent a source);
 * - every number it shows appears in the card's text or a cited passage;
 * - every NoteLink points at an object that exists (when the caller says which do).
 * Notes don't refuse it; they go into the review: a phrase whose words are mostly not in the card's text or its cited
 * passages, statements nothing draws.
 *
 * D3 (owner, 2026-11-23): this is a STRUCTURAL check. Passing it means nothing mechanical was found — never that the layout
 * faithfully represents every claim in the text. The review stays mandatory, and no wording here or in a caller may say
 * "verified", "faithful", "accurate", "correct" or "confirmed" about a layout (`layoutReviewLines`, pinned by a test).
 */
import { createParser, type ElementNode, type ParseResult } from "@openuidev/react-lang";
import { CARD_LAYOUT_LANG_MAX, type RichContent } from "@/domain/types";
import { cardTextOf } from "./cardLang";
import { acuteCardLibrary } from "./library";

export const LAYOUT_LIMITS = {
  chars: CARD_LAYOUT_LANG_MAX,
  statements: 120,
  components: 200,
  /** All text shown by the layout, in characters. */
  textChars: 8_000,
} as const;

export type LayoutErrorCode =
  | "empty"
  | "too-large"
  | "parse"
  | "not-static"
  | "unknown-citation"
  | "citation-without-source"
  | "number-not-in-text"
  | "unknown-note-link";
export type LayoutNoteCode = "words-not-in-text" | "unused-statements";

export interface LayoutIssue<C extends string = string> {
  code: C;
  message: string;
  /** The phrase, citation, number or statement the issue is about. */
  subject?: string;
}

export interface LayoutCheck {
  /** No errors. Says nothing about whether the layout is faithful to the text (D3). */
  ok: boolean;
  errors: LayoutIssue<LayoutErrorCode>[];
  notes: LayoutIssue<LayoutNoteCode>[];
  /** The passage ids the layout cites, in order of first use. */
  cites: string[];
  stats: { statements: number; components: number; textChars: number };
}

export interface LayoutCheckInput {
  lang: string;
  /** The card's text: what the layout must agree with. Absent for a structure-only check (drawing a stored layout). */
  card?: { title: string; snapshot: RichContent };
  /**
   * Every passage the card may cite (unit id → text): its content source's units. Absent or empty: the card cites
   * nothing, so any citation is an error. Ignored for a structure-only check.
   */
  passages?: ReadonlyMap<string, string>;
  /** Ids a NoteLink may point at. Absent: links aren't checked. */
  objects?: ReadonlySet<string>;
}

const COMPONENTS = new Set(Object.keys(acuteCardLibrary.components));
let parser: ReturnType<typeof createParser> | null = null;
const parse = (lang: string): ParseResult => (parser ??= createParser(acuteCardLibrary.toJSONSchema())).parse(lang);

/** Props that hold ids or fixed choices, not text a reader sees. */
const ID_PROPS = new Set(["unit", "target", "tone", "importance"]);
/** Components whose `label` is a chip or link caption ("Source 1", "See also"), not a claim: not compared with the text. */
const CAPTIONED = new Set(["CitationChip", "SourceLink", "NoteLink"]);
/** Props whose string items are passage ids. */
const CITE_ARRAY_PROPS = new Set(["citations"]);

/** Lang with every string literal emptied, so a word inside a quote can't look like a call. */
const outsideStrings = (lang: string) => lang.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");

interface Walked {
  components: number;
  texts: string[];
  cites: string[];
  links: string[];
}

function walk(node: unknown, out: Walked, key?: string): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      if (typeof item === "string" && key && CITE_ARRAY_PROPS.has(key)) out.cites.push(item);
      else walk(item, out, key);
    }
    return;
  }
  if (node && typeof node === "object") {
    if ((node as ElementNode).type === "element") {
      const el = node as ElementNode;
      out.components++;
      for (const [k, v] of Object.entries(el.props)) {
        if (k === "unit" && typeof v === "string") out.cites.push(v);
        else if (k === "target" && el.typeName === "NoteLink" && typeof v === "string") out.links.push(v);
        else if (ID_PROPS.has(k) || (k === "label" && CAPTIONED.has(el.typeName))) continue;
        else walk(v, out, k);
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) walk(v, out, k);
    return;
  }
  if (typeof node === "string" && node.trim()) out.texts.push(node);
}

const STOPWORDS = new Set(
  "a an and are as at be but by for from has have if in into is it its of on or so than that the their then there these this those to was were when which while will with without not no".split(" "),
);
const tokens = (text: string) => text.normalize("NFKC").toLowerCase().match(/\d+(?:[.,]\d+)*%?|[\p{L}]+/gu) ?? [];
const isNumber = (t: string) => /\d/.test(t);
/** Loose word identity: a trailing plural or possessive doesn't matter. */
const stem = (w: string) => w.replace(/(?:'s|s)$/u, "");
const numberKey = (t: string) => t.replace(/,/g, "").replace(/%$/, "");
/**
 * Small numbers written as words: a layout may show "1" for "one" or "first" (live run 2026-11-24: "Day 1" for "day one"
 * was refused). Only these, so a number the text doesn't state is still refused.
 */
const NUMBER_WORDS: Readonly<Record<string, string>> = Object.fromEntries([
  ..."zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split(" ").map((w, i) => [w, String(i)]),
  ..."first second third fourth fifth sixth seventh eighth ninth tenth".split(" ").map((w, i) => [w, String(i + 1)]),
]);

/** The structural checks alone (parse, static, limits): what drawing a stored layout needs. */
export function checkLayoutStructure(lang: string): LayoutCheck {
  return checkLayout({ lang });
}

export function checkLayout(input: LayoutCheckInput): LayoutCheck {
  const errors: LayoutIssue<LayoutErrorCode>[] = [];
  const notes: LayoutIssue<LayoutNoteCode>[] = [];
  const done = (stats: LayoutCheck["stats"], cites: string[] = []): LayoutCheck => ({ ok: errors.length === 0, errors, notes, cites, stats });
  const lang = input.lang.trim();
  const none = { statements: 0, components: 0, textChars: 0 };

  if (!lang) {
    errors.push({ code: "empty", message: "The layout is empty." });
    return done(none);
  }
  if (lang.length > LAYOUT_LIMITS.chars) {
    errors.push({ code: "too-large", message: `The layout is ${lang.length} characters; at most ${LAYOUT_LIMITS.chars}.` });
    return done(none);
  }

  // Static only: every call outside a string literal is a component of the card library.
  const bare = outsideStrings(lang);
  for (const m of bare.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (!COMPONENTS.has(m[1]!)) errors.push({ code: "not-static", message: `"${m[1]}" isn't a card component: a layout can only show components, never run, fetch or change anything.`, subject: m[1] });
  }
  if (/\$[A-Za-z_]/.test(bare)) errors.push({ code: "not-static", message: "A layout can't declare or use state ($…).", subject: "$" });

  let result: ParseResult;
  try {
    result = parse(lang);
  } catch (err) {
    errors.push({ code: "parse", message: `The layout doesn't parse: ${err instanceof Error ? err.message : String(err)}` });
    return done(none);
  }
  const { meta } = result;
  if (!result.root) errors.push({ code: "parse", message: "The layout has no root component." });
  if (meta.incomplete) errors.push({ code: "parse", message: "The layout is cut off (incomplete)." });
  for (const name of meta.unresolved) errors.push({ code: "parse", message: `"${name}" is used but never defined.`, subject: name });
  for (const e of meta.errors) {
    if (e.severity === "warning") continue;
    errors.push({ code: "parse", message: `${e.component}${e.path ? ` ${e.path}` : ""}: ${e.message}`, subject: e.statementId ?? e.component });
  }
  if (result.queryStatements.length || result.mutationStatements.length || Object.keys(result.stateDeclarations).length) {
    if (!errors.some((e) => e.code === "not-static")) errors.push({ code: "not-static", message: "A layout can't query, change data or hold state." });
  }

  const walked: Walked = { components: 0, texts: [], cites: [], links: [] };
  walk(result.root, walked);
  const textChars = walked.texts.reduce((n, t) => n + t.length, 0);
  const stats = { statements: meta.statementCount, components: walked.components, textChars };
  if (meta.statementCount > LAYOUT_LIMITS.statements) errors.push({ code: "too-large", message: `${meta.statementCount} statements; at most ${LAYOUT_LIMITS.statements}.` });
  if (walked.components > LAYOUT_LIMITS.components) errors.push({ code: "too-large", message: `${walked.components} components; at most ${LAYOUT_LIMITS.components}.` });
  if (textChars > LAYOUT_LIMITS.textChars) errors.push({ code: "too-large", message: `${textChars} characters of text; at most ${LAYOUT_LIMITS.textChars}.` });
  if (meta.orphaned.length) notes.push({ code: "unused-statements", message: `${meta.orphaned.length} statement(s) nothing draws: ${meta.orphaned.join(", ")}.`, subject: meta.orphaned.join(", ") });

  const cites = [...new Set(walked.cites)];
  if (!input.card) return done(stats, cites);

  // Citations: only passages the card may cite.
  const passages = input.passages ?? new Map<string, string>();
  for (const u of cites) {
    if (passages.has(u)) continue;
    errors.push(
      passages.size
        ? { code: "unknown-citation", message: `Cites "${u}", which isn't a passage of this card's source.`, subject: u }
        : { code: "citation-without-source", message: `Cites "${u}", but this card has no source to cite.`, subject: u },
    );
  }

  // NoteLinks: only to objects that exist.
  if (input.objects) for (const t of new Set(walked.links)) if (!input.objects.has(t)) errors.push({ code: "unknown-note-link", message: `Links to "${t}", which isn't on this canvas.`, subject: t });

  // Agreement with the text (structural): numbers must appear; mostly-unknown wording is a note.
  const card = cardTextOf(input.card);
  const sourceText = [card.title, card.text, ...(card.table ? [card.table.columns.join(" "), ...card.table.rows.map((r) => r.join(" "))] : []), ...cites.flatMap((u) => (passages.has(u) ? [passages.get(u)!] : []))].join(" ");
  const sourceTokens = tokens(sourceText);
  const numbers = new Set([...sourceTokens.filter(isNumber).map(numberKey), ...sourceTokens.flatMap((t) => (NUMBER_WORDS[t] ? [NUMBER_WORDS[t]!] : []))]);
  const reported = new Set<string>();
  const words = new Set(sourceTokens.filter((t) => !isNumber(t)).map(stem));
  for (const text of new Set(walked.texts)) {
    const ts = tokens(text);
    for (const n of new Set(ts.filter(isNumber))) {
      if (numbers.has(numberKey(n)) || reported.has(numberKey(n))) continue;
      reported.add(numberKey(n));
      errors.push({ code: "number-not-in-text", message: `Shows "${n}", which isn't in the card's text or its cited passages.`, subject: n });
    }
    const content = [...new Set(ts.filter((t) => !isNumber(t) && t.length > 2 && !STOPWORDS.has(t)).map(stem))];
    if (content.length < 3) continue;
    const missing = content.filter((w) => !words.has(w));
    if (missing.length / content.length > 0.5) {
      notes.push({ code: "words-not-in-text", message: `"${text.length > 80 ? `${text.slice(0, 77)}…` : text}" is mostly in words the card's text doesn't use (${missing.slice(0, 5).join(", ")}).`, subject: text });
    }
  }
  return done(stats, cites);
}

/**
 * The check as the review shows it: one line for the outcome, then each error and note. Structural wording only (D3):
 * "checked", "found", "not found" — never a claim that the layout is right.
 */
export function layoutReviewLines(check: LayoutCheck): string[] {
  const head = check.ok
    ? `Layout structure checked: it parses, stays within limits, shows only card components${check.cites.length ? ", and cites passages that exist" : ""}. Read it against the card before accepting: this check doesn't compare meaning.`
    : `The layout was refused: ${check.errors.length} problem${check.errors.length === 1 ? "" : "s"} found.`;
  return [head, ...check.errors.map((e) => e.message), ...check.notes.map((n) => `Note: ${n.message}`)];
}
