/**
 * Exactness (`.ai/docs/knowledge-notes-plan.md` §3.3, WP1.7): the protected details of each source unit, and whether
 * the cards citing a unit kept them. Deterministic and pure; no model call.
 *
 * Two tiers. **Exact** items (numbers with units, versions, paths, identifiers, direct quotes, item ids, action
 * items, tables and code) must appear in a card citing their unit, after `normalizeForCompare`; a missing one is
 * returned in `missing` for the section's retry and, failing that, the "From the source" line. **Warn** items (named
 * terms) only raise a `named_term_changed` flag: a card may drop a name, but the reader should look.
 *
 * Nothing is wired into the pipeline here; the integrator calls these (§11, WP1.10).
 */
import type { CheckExactness, Idea, NormalizeForCompare, ProtectedItem, ProtectedItemsOf, ProtectedKind, ReviewFlag, SourceUnit, UnitId } from "./contracts";
import { FIDELITY_CUES } from "@/config/fidelityCues";
import { itemIds } from "./analysisCheck";
import { keyTerms } from "./information";
import { normalizeQuantities, quantitiesOf } from "./quantities";
import type { SourceBlock } from "./sourceBlocks";

// ---------------------------------------------------------------- normalisation

const QUOTES: [RegExp, string][] = [
  [/[\u2018\u2019\u201A\u201B\u2032\u00B4]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"'],
  [/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-"],
  [/\u2026/g, "..."],
  [/[\u00A0\u2007\u202F\u2009\u200A]/g, " "],
];

/** Typographic characters → ASCII (quotes, dashes, ellipsis, non-breaking spaces). Keeps everything else. */
export function plainText(text: string): string {
  let out = text;
  for (const [re, to] of QUOTES) out = out.replace(re, to);
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A word whose case is information: it has a digit, `_`, `/` or `.` inside, or is camelCase ("getUser", "wl5_INJ"). */
function isIdentifierLike(token: string): boolean {
  return /[\d_/]|\.\p{L}/u.test(token) || /\p{Ll}\p{Lu}/u.test(token);
}

/**
 * Text for comparing protected items (§3.3): Unicode quotes and dashes as ASCII, no back-ticks or bold/italic
 * markers, every quantity in its canonical form (`quantities.ts`: `1,000` = `1000` = "one thousand", `200
 * milliseconds` = `200ms` = `0.2 s` → `200 ms`, `99th percentile` = `p99`, `between 4 and 8` = `4–8` → `4-8`),
 * trailing punctuation off, whitespace collapsed, and words lower-cased unless `keepCase` (identifiers and paths always
 * keep their case). Identifiers, versions and paths are never read as quantities (`v2.5`, `HK-3`, `/var/log/2024`).
 */
export const normalizeForCompare: NormalizeForCompare = (text, options) => {
  let t = plainText(text)
    .replace(/\*\*|__|`/g, "")
    .replace(/(?<![\p{L}\p{N}])[*_](?=\S)|(?<=\S)[*_](?![\p{L}\p{N}])/gu, "");
  t = normalizeQuantities(t);
  t = t.replace(/\s+/g, " ").trim();
  if (!options?.keepCase) t = t.replace(/[^\s"'()[\]{},;:!?]+/g, (tok) => (isIdentifierLike(tok) ? tok : tok.toLowerCase()));
  // Trailing punctuation: at the end, and after each word (not inside "1.5" or "a/b").
  t = t.replace(/[.,;:!?]+(?=\s|$|["')\]])/g, "").trim();
  return t;
};

/** Whether `haystack` contains `needle` as whole words, both already normalised: "v2" is not found in "v2.1". */
export function containsTerm(haystack: string, needle: string): boolean {
  if (!needle) return true;
  const re = new RegExp(`(?<![\\p{L}\\p{N}]|[\\p{L}\\p{N}][._/-])${escapeRe(needle)}(?![\\p{L}\\p{N}]|[._/-][\\p{L}\\p{N}])`, "iu");
  return re.test(haystack);
}

// ---------------------------------------------------------------- protected items

const ITEM_ID_PROSE = /(?<![\p{L}\p{N}#-])(#\d{1,5}|[A-Z]{1,4}-\d{1,4}|[A-Z]\d{1,3})(?![\p{L}\p{N}]|-\d)/gu;
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today|tonight|eod|eow|end of (?:day|week|month|sprint|quarter)|next week|this week";
const DUE_DATE = new RegExp(
  `\\b(?:by|before|due|until|on)\\s+(?:(?:${DAYS})\\b|(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b|\\d{4}-\\d{2}-\\d{2}\\b|\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b|(?:the\\s+)?(?:next|this)\\s+\\w+)`,
  "i",
);
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const MENTION = /(?<![\p{L}\p{N}])@([\p{L}][\p{L}\p{N}_.-]*)/u;
/**
 * "Alice to send …", "Bob and Carol will review …", "Action: Dana to file …": an owner (a capitalised name) taking on
 * a verb, at the start of the unit. Anywhere else "X to y" is usually not an assignment ("upgrade Node to version 20").
 */
const OWNER_VERB =
  /^\s*(?:[-*+]\s+)?(?:\[[ xX]\]\s+)?(?:(?:Action(?:\s+item)?|AI|TODO|Next step)\s*:\s*)?((?:[A-Z][\p{L}]+)(?:\s+(?:and|&)\s+[A-Z][\p{L}]+)?)\s+(?:to|will|is to|owns|takes)\s+(?:(?:re|co)-?)?([a-z][a-z-]+)/u;
const MARKER = /^\s*(?:\[[ xX]\]|TODO\b|TBD\b|Action(?:\s+item)?s?\s*:|AI\s*:|Follow[- ]up\s*:|Next step\s*:)/i;
const MARKER_ANYWHERE = /\b(?:TODO|FIXME)\b|\bAction(?:\s+item)?\s*:/;

/** The parts of an action item a card must keep (§3.3): owner, due date and verb, whichever the item has. */
export function actionParts(text: string): { owner?: string; due?: string; verb?: string } {
  const t = plainText(text);
  const parts: { owner?: string; due?: string; verb?: string } = {};
  const mention = MENTION.exec(t);
  const ov = OWNER_VERB.exec(t);
  if (mention) parts.owner = `@${mention[1]}`;
  else if (ov && !STOP_NAMES.has(ov[1]!)) parts.owner = ov[1];
  const due = DUE_DATE.exec(t) ?? ISO_DATE.exec(t);
  if (due) parts.due = due[0].replace(/^(?:by|before|due|until|on)\s+/i, "");
  if (ov && !STOP_NAMES.has(ov[1]!)) parts.verb = ov[2];
  else {
    // "TODO: update the docs", "Action: ship it", "- [ ] write the migration": the first word after the marker.
    const after = t.replace(MARKER, "").replace(/^[\s:-]+/, "").replace(/^@\S+\s+(?:to\s+|will\s+)?/, "");
    const v = /^([A-Za-z][a-z-]+)/.exec(after);
    if (v && (MARKER.test(t) || mention)) parts.verb = v[1]!.toLowerCase();
  }
  return parts;
}

/** Capitalised words that start a sentence or a list item and are not owners. */
const STOP_NAMES = new Set(["We", "I", "You", "They", "It", "This", "That", "The", "Team", "Everyone", "Someone", "Need", "Needs", "Plan", "Going", "Want", "Wants", "Likely", "Has", "Have", "Is", "Are", "Was", "Who", "What", "How", "Why", "When", "Where", "Then", "Also"]);

function isActionItem(unit: SourceUnit): boolean {
  const t = plainText(unit.text);
  if (MARKER.test(t) || MARKER_ANYWHERE.test(t)) return true;
  const p = actionParts(t);
  // An owner plus a verb or a date; or a date with a mention. A bare date ("released on Monday") is not an action.
  return Boolean((p.owner && (p.verb || p.due)) || (MENTION.test(t) && p.due));
}

function kindOfTerm(term: string): ProtectedKind {
  if (/^v\d+(?:\.\d+)*$/i.test(term) || /^\d+\.\d+\.\d+(?:[.-][\p{L}\p{N}]+)*$/u.test(term)) return "version";
  if (/\//.test(term) && !/^\d{1,2}\/\d{1,2}(?:\/\d{2,4})?$/.test(term)) return "path";
  if (/^-?\d+(?:\.\d+)?$/.test(term)) return "number";
  return "identifier";
}

/** The term as the text spells it (keyTerms lower-cases). */
function originalCase(text: string, term: string): string {
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term)}(?![\\p{L}\\p{N}])`, "iu").exec(text);
  return m ? m[0] : term;
}

/** Quoted spans of at least `minQuoteWords` words: direct quotes. */
function quotesIn(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"\n]+)"/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const inner = m[1]!.trim();
    if (inner.split(/\s+/).length >= FIDELITY_CUES.minQuoteWords) out.push(inner);
  }
  return out;
}

/** Words that start sentences; a capitalised one is not a name. */
const STARTERS = new Set(
  "the a an this that these those our we it its in on for when if then so but and or as at by to with from after before once our their there here each every all some any no not use using".split(" "),
);

/** Back-ticked terms, and capitalised words or runs of them that don't start a sentence (§3.3, warn tier). */
export function namedTermsOf(text: string): string[] {
  const t = plainText(text);
  const terms: string[] = [];
  const add = (s: string) => {
    const v = s.trim();
    if (v && !terms.some((x) => x.toLowerCase() === v.toLowerCase())) terms.push(v);
  };
  for (const m of t.matchAll(/`([^`\n]+)`/g)) add(m[1]!);
  const stripped = t.replace(/`[^`\n]+`/g, " ").replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "");
  const re = /[A-Z][\p{L}\p{N}+#.-]*(?:\s+(?:of\s+|for\s+|de\s+)?[A-Z][\p{L}\p{N}+#.-]*)*/gu;
  for (let m = re.exec(stripped); m; m = re.exec(stripped)) {
    const before = stripped.slice(0, m.index);
    // At the start of the text or of a sentence (after . ! ? : or an opening quote): an ordinary word, unless it is
    // a run or has inner capitals ("PostgreSQL", "Google Cloud").
    const sentenceStart = /(?:^|[.!?:]\s+|["(]\s*|\|\s*)$/.test(before);
    let value = m[0].replace(/[.-]+$/, "");
    if (sentenceStart) {
      const words = value.split(/\s+/);
      if (words.length === 1 && !/\p{Lu}.*\p{Lu}/u.test(value)) continue;
      // "The Redis cache": a function word starting the sentence is not part of the name; "Google Cloud" keeps both.
      if (words.length > 1 && STARTERS.has(words[0]!.toLowerCase())) value = words.slice(1).join(" ").replace(/^(?:of|for|de)\s+/, "");
    }
    if (!value || value === "I" || /^[A-Z]$/.test(value) || /^(?:#?[A-Z]{0,4}-?\d+)$/.test(value)) continue;
    if (/^(?:TODO|TBD|FIXME|AI|OK|NB)$/.test(value)) continue;
    add(value);
  }
  return terms;
}

/** Item ids of the units' lists and tables (via `itemIds`, per topic), plus ids named in prose ("see D3", "#25"). */
function itemIdsByUnit(units: readonly SourceUnit[]): Map<UnitId, string[]> {
  const out = new Map<UnitId, string[]>();
  const push = (u: UnitId, id: string) => {
    const list = out.get(u) ?? [];
    if (!list.some((x) => x.toUpperCase() === id.toUpperCase())) list.push(id);
    out.set(u, list);
  };
  const byTopic = new Map<string, SourceUnit[]>();
  for (const u of units) byTopic.set(u.topic, [...(byTopic.get(u.topic) ?? []), u]);
  for (const group of byTopic.values()) {
    const lists = group.filter((u) => u.kind === "list_item");
    const rows = group.filter((u) => u.kind === "table_row");
    const blocks: SourceBlock[] = [];
    if (lists.length) blocks.push({ ref: "L1", kind: "list", text: lists.map((u) => `- ${u.text}`).join("\n"), node: {} });
    if (rows.length) blocks.push({ ref: "T1", kind: "table", text: "", node: { content: { rows: rows.map((u) => u.text.split(" | ")) } } });
    const ids = blocks.length ? itemIds(blocks) : [];
    for (const id of ids)
      for (const u of [...lists, ...rows]) if (new RegExp(`^\\s*${escapeRe(id)}(?![\\p{L}\\p{N}])`, "iu").test(u.text)) push(u.id, originalCase(u.text, id));
  }
  for (const u of units) for (const m of plainText(u.text).matchAll(ITEM_ID_PROSE)) push(u.id, m[1]!);
  return out;
}

/** Protected items of each unit (§3.3), in unit order. */
export const protectedItemsOf: ProtectedItemsOf = (units) => {
  const items: ProtectedItem[] = [];
  const ids = itemIdsByUnit(units);
  for (const unit of units) {
    const seen = new Set<string>();
    const add = (tier: ProtectedItem["tier"], kind: ProtectedKind, value: string) => {
      const key = normalizeForCompare(value);
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push({ tier, kind, value, unit: unit.id });
    };
    if (unit.kind === "code") {
      add("exact", "code", unit.text);
      continue;
    }
    if (unit.kind === "table_row") add("exact", "table", unit.text);
    const text = plainText(unit.text);
    if (unit.kind === "quote") add("exact", "quote", text);
    for (const q of quotesIn(text)) add("exact", "quote", q);
    if (isActionItem(unit)) add("exact", "action_item", text);
    const itemIdSet = new Set((ids.get(unit.id) ?? []).map((x) => x.toLowerCase()));
    for (const id of ids.get(unit.id) ?? []) add("exact", "item_id", id);
    // Quantities as written, with their unit or range ("0.25 seconds", "between 4 and 8"); compared by value.
    const quantities = quantitiesOf(text);
    for (const q of quantities) if (!itemIdSet.has(q.text.toLowerCase())) add("exact", "number", q.text);
    // The other key terms (versions, paths, identifiers, and numbers that are no quantity, like "10:30"), with the
    // quantities blanked so their digits aren't protected twice.
    let rest = text;
    for (const q of quantities) rest = rest.slice(0, q.start) + " ".repeat(q.end - q.start) + rest.slice(q.end);
    for (const term of keyTerms(rest)) {
      if (itemIdSet.has(term) || itemIdSet.has(`#${term}`)) continue;
      add("exact", kindOfTerm(term), originalCase(rest, term));
    }
    for (const term of namedTermsOf(text)) if (!seen.has(normalizeForCompare(term))) add("warn", "named_term", term);
  }
  return items;
};

// ---------------------------------------------------------------- the check

function cardText(idea: Idea): string {
  return `${idea.title}\n${idea.body}`;
}

/** Whether one card keeps one exact item (§3.3 rules). */
function keeps(idea: Idea, item: ProtectedItem): boolean {
  if (idea.byReference) return true;
  const card = normalizeForCompare(cardText(idea));
  if (item.kind === "action_item") {
    const parts = actionParts(item.value);
    const required = [parts.owner, parts.due].filter((p): p is string => Boolean(p)).map((p) => normalizeForCompare(p));
    if (!required.every((p) => containsTerm(card, p))) return false;
    // The verb, by its stem: "send" is kept by "sends" or "sending".
    if (parts.verb) {
      const stem = parts.verb.toLowerCase().slice(0, Math.max(3, Math.min(5, parts.verb.length - 1)));
      if (!new RegExp(`(?<![\\p{L}])${escapeRe(stem)}`, "iu").test(card)) return false;
    }
    return true;
  }
  const value = normalizeForCompare(item.value);
  if (item.kind === "code" || item.kind === "table" || item.kind === "quote") return card.includes(value);
  return containsTerm(card, value);
}

/** A capitalised term on the card that looks like the source's, renamed ("Postgres" for "PostgreSQL"). */
function changedTo(term: string, idea: Idea): string | undefined {
  const head = term.toLowerCase().slice(0, 4);
  return namedTermsOf(cardText(idea)).find((t) => t.toLowerCase() !== term.toLowerCase() && t.toLowerCase().startsWith(head));
}

/**
 * Exact items missing from every card citing their unit (`missing`), and a `named_term_changed` flag on each citing
 * card when none of them keeps a named term. Items of units no card cites are skipped: accounting decides those.
 */
export const checkExactness: CheckExactness = (items, ideas) => {
  const missing: ProtectedItem[] = [];
  const flags: ReviewFlag[] = [];
  for (const item of items) {
    const citing = ideas.filter((i) => i.cites.includes(item.unit));
    if (!citing.length) continue;
    if (item.tier === "exact") {
      if (!citing.some((i) => keeps(i, item))) missing.push(item);
      continue;
    }
    const term = normalizeForCompare(item.value);
    if (citing.some((i) => i.byReference || containsTerm(normalizeForCompare(cardText(i)), term))) continue;
    for (const idea of citing) {
      const renamed = changedTo(item.value, idea);
      flags.push({
        code: "named_term_changed",
        unit: item.unit,
        card: idea.id,
        detail: renamed ? `source says "${item.value}"; the card says "${renamed}"` : `source names "${item.value}"; no card citing it does`,
        evidence: { source: item.value, card: renamed },
      });
    }
  }
  return { missing, flags };
};
