/**
 * The merged text (topic merge plan G2): the notes' current text with new content filed into it, written by code so
 * "Update from new content" can take it from there — re-analysing only the topics that grew, with their current
 * representation, and adding new topics as new sections.
 *
 * - A part assigned to a topic: its blocks (paragraphs, lists, tables, code — never split) are appended at the end of
 *   that topic's own text, below its last block. Headings inside the part become bold lines, so the topic's
 *   structure — and every key built from it — stays as it is.
 * - A part with no topic: appended at the end as a new section, at the level of the notes' own sections.
 * - **No redundancy:** a block the notes already say is skipped — word for word anywhere, or nearly all of its
 *   significant words in one topic, **whichever topic that is** (a passage filed under "AI access" that "Storage"
 *   already says is a repeat too). Each topic is compared on its own, never a pool of the whole text's words, which
 *   would make a new sentence built from familiar words look said. Each skipped block is counted in the report.
 * - Passages the notes **already** repeat across two topics are reported (`overlaps`), never removed: they are the
 *   user's notes, and which topic should keep them is the user's call.
 *
 * Pure: texts and parsed content in, text and a report out.
 */
import type { ParsedBlock, ParsedContent } from "@/ai/content/types";
import { coverageOf, keyTerms, significant } from "@/ai/fidelity/information";
import { normalizeUnitText, type AnalysisUnit } from "@/ai/reconcile/units";
import { findChoices, formatChoice, IN_NOTES, type Choice, type ChoiceOption } from "@/ai/history/choices";
import { topicLabel, type Assignment, type Conflict } from "./assign";

/** A block already this covered by what one topic says is a repeat. */
const REPEAT = 0.85;
const MIN_WORDS = 3;

export interface MergeReport {
  /** Topic key → the parts filed into it. */
  mergedInto: Record<string, string[]>;
  /** Parts added as new topics. */
  newTopics: string[];
  /** Blocks left out because the notes already say them. */
  skippedBlocks: number;
  /** Parts left out entirely (every block a repeat). */
  skippedParts: string[];
  /** Of `skippedBlocks`, those another topic says (not the one the part was filed under). */
  repeatedElsewhere: number;
  /** Pairs of the notes' own topics that already repeat each other, with how many passages. */
  overlaps: { topics: [string, string]; passages: number }[];
  /** Parts the model judged to add nothing to their topic (in other words), left out and named in the review. */
  nothingNew: string[];
  /** What the merged content contradicts (G3): each became a "Needs your call" choice in its topic. */
  choices: string[];
  /** Open choices this content added another option to (a further view on the same statement), by title. */
  extended: string[];
  /** Choices the user had made that this content contradicts: reopened, the user's choice tagged, by title. */
  reopened: string[];
  /** New-topic part → the parts kept in its topic because AI couldn't place them on their own (`unsure.ts`). */
  keptWith: Record<string, string[]>;
  /** Parts AI couldn't place that a rule then kept (with the section around them, or the part before): not the unplaced or refined ones (set by the merge). */
  unsure: string[];
  /** Parts AI couldn't place and that no rule could (`unsure.ts` rule 6), kept whole as sections of their own at the end — not counted in `newTopics`. */
  unplaced: string[];
  /** Parts AI couldn't place as a whole, placed by asking about their subsections one by one (set by the merge). */
  refined: string[];
  /** Economy mode: parts added to an existing topic as plain verbatim cards, not analysed (set by the merge). */
  economy: string[];
  /** Economy mode: the sections AI planning was skipped for because the plan had no room (`reconcile/capacity.ts`), as topic or section keys (set by the merge). */
  planSkipped?: string[];
}

export interface ComposeInput {
  /** The notes' current text, parsed, and its analysis units (keys as in the text, not topic ids). */
  text: string;
  parsed: ParsedContent;
  units: readonly AnalysisUnit[];
  /** The new content, parsed, and its parts. */
  incoming: string;
  incomingParsed: ParsedContent;
  parts: readonly AnalysisUnit[];
  assignment: Assignment;
  /** Per part, what it says that its topic contradicts (from the assignment). */
  conflicts?: ReadonlyMap<string, readonly Conflict[]>;
  /** Where the merged content came from, as a choice's option says it ("from “…”, date"). */
  from?: { label: string; date: string };
  /** Part → the new-topic part it joins (its content goes into that topic, under its own label); see `unsure.ts`. */
  attach?: ReadonlyMap<string, string>;
  /** Parts kept unplaced (themselves, or joined to one): each is a section of its own at the end of the notes, reported as unplaced, not as a new topic. */
  unplaced?: ReadonlySet<string>;
}

interface Said {
  text: string;
  words: Set<string>;
}

const said0 = (text: string): Said => ({ text: normalizeUnitText(text).toLowerCase(), words: new Set(significant(text)) });
const WORD_FOR_WORD = "(word for word)";

/**
 * `kept`: each part's blocks that the notes don't already say, in order — what is actually new in it (the model is
 * shown only these when it decides where a part belongs).
 */
export function composeMerged(input: ComposeInput): { text: string; report: MergeReport; kept: Record<string, string[]>; unplacedTexts: string[]; unplacedSpans: { start: number; end: number }[] } {
  const report: MergeReport = { mergedInto: {}, newTopics: [], skippedBlocks: 0, skippedParts: [], repeatedElsewhere: 0, overlaps: notesOverlaps(input.text, input.parsed, input.units), nothingNew: [], choices: [], extended: [], reopened: [], keptWith: {}, unsure: [], unplaced: [], refined: [], economy: [], planSkipped: [] };
  const keptOf: Record<string, string[]> = {};
  /** The notes' own choices (G3), and the ones this merge rewrites: an option added to an open one, or one the user made, reopened. */
  const existingChoices = findChoices(input.text);
  const edits = new Map<string, { choice: Choice; options: ChoiceOption[] }>();
  const unitByKey = new Map(input.units.map((u) => [u.key, u] as const));
  /** Units that are a top-level section's own text, above its first subsection: their end is followed by sibling sections. */
  const ownTextUnits = new Set(input.units.filter((u) => input.parsed.sections.some((s) => s.subsections.length > 0 && s.span.start === u.span.start && s.subsections[0]!.span.start === u.span.end)).map((u) => u.key));
  /** Insertion offset in the notes' text → the blocks going there, in order. */
  const inserts = new Map<number, string[]>();
  /** New topics, in order: the part each is named after, and its heading and blocks. */
  const sections: { key: string; blocks: string[] }[] = [];
  const level = newTopicLevel(input.parsed);
  /** What each topic says (the notes' own, then each new one), growing as blocks are filed into it. */
  const said = new Map<string, Said>(input.units.map((u) => [u.key, said0(u.text)] as const));
  /** The whole text as it grows, for a word-for-word repeat anywhere. */
  let whole = normalizeUnitText(input.text).toLowerCase();
  /** Files `block` under `topic` unless the notes already say it; counts it when they do. */
  const keep = (block: string, topic: string) => {
    const where = repeatOf(block, whole, said);
    if (where) {
      report.skippedBlocks++;
      if (where !== topic && where !== WORD_FOR_WORD) report.repeatedElsewhere++;
      return false;
    }
    const n = normalizeUnitText(block).toLowerCase();
    const s = said.get(topic) ?? said0("");
    said.set(topic, { text: `${s.text}\n${n}`, words: new Set([...s.words, ...significant(block)]) });
    whole += `\n${n}`;
    return true;
  };

  const incomingBlocks = questionsWithTheirAnswers(input.incoming, input.incomingParsed, input.parts);
  for (const part of input.parts) {
    const topic = input.assignment.get(part.key) ?? null;
    const target = topic ? unitByKey.get(topic) : undefined;
    // A topic that is a section's own text above its subsections must not gain a bold line the parser reads as a heading (`titleLikeAsItalic`).
    const blocks = (incomingBlocks.get(part.key) ?? []).map((b) => (target && ownTextUnits.has(target.key) ? titleLikeAsItalic(b) : b));
    if (target) {
      // What the part says that its topic contradicts (G3) isn't filed as a fact: it becomes a choice the user makes.
      const conflicts = input.conflicts?.get(part.key) ?? [];
      const own = conflicts.length ? blocks.map((b) => conflicts.reduce((x, c) => x.replace(c.partSays, ""), b).replace(/[ \t]{2,}/g, " ").trim()).filter((b) => /[\p{L}\p{N}]/u.test(b)) : blocks;
      const kept = (keptOf[part.key] = own.filter((b) => keep(b, target.key)));
      // Each contradiction: another option in the box already open about that statement, a choice the user made reopened, or a new box.
      const choices: string[] = [];
      for (const c of conflicts) {
        const option: ChoiceOption = { statement: c.partSays, from: input.from ? `from “${input.from.label}”, ${input.from.date}` : "from the merged content", inNotes: false, state: "open" };
        const here = existingChoices.filter((ch) => ch.span.start >= target.span.start && ch.span.start < target.span.end);
        const open = here.find((ch) => !ch.resolved && ch.options.some((o) => sameStatement(o.statement, c.topicSays)));
        const made = here.find((ch) => ch.resolved && ch.options.some((o) => o.state === "chosen" && sameStatement(o.statement, c.topicSays)));
        const existing = open ?? made;
        if (existing) {
          const chosen = made?.options.find((o) => o.state === "chosen");
          const edit = edits.get(existing.id) ?? { choice: existing, options: open ? [...open.options] : [{ ...chosen!, from: `${IN_NOTES} · your choice`, inNotes: true, state: "open" as const }] };
          if (!edit.options.some((o) => sameStatement(o.statement, c.partSays))) edit.options.push(option);
          edits.set(existing.id, edit);
          (open ? report.extended : report.reopened).push(existing.title);
          continue;
        }
        choices.push(formatChoice({ title: c.about, resolved: false, options: [{ statement: c.topicSays, from: IN_NOTES, inNotes: true, state: "open" }, option] }));
        report.choices.push(c.about);
      }
      if (!kept.length && !conflicts.length) {
        report.skippedParts.push(part.key);
        continue;
      }
      const at = beforeNextQuestion(input.text, target.span.start, endOfText(input.text, target.span.end));
      inserts.set(at, [...(inserts.get(at) ?? []), ...kept, ...choices]);
      (report.mergedInto[target.key] ??= []).push(part.key);
    } else {
      // A part joining another part's new topic (`unsure.ts`: a fragment kept with its section) goes there, under its own label.
      const anchor = input.attach?.get(part.key);
      const home = anchor ?? part.key;
      const kept = (keptOf[part.key] = blocks.filter((b) => keep(b, `(new) ${home}`)));
      if (!kept.length) {
        report.skippedParts.push(part.key);
        continue;
      }
      let section = sections.find((s) => s.key === home);
      if (!section) {
        section = { key: home, blocks: [`${"#".repeat(level)} ${topicLabel(home)}`] };
        sections.push(section);
        if (!input.unplaced?.has(home)) report.newTopics.push(home);
      }
      if (input.unplaced?.has(part.key)) report.unplaced.push(part.key);
      if (anchor) {
        section.blocks.push(`**${topicLabel(part.key)}**`, ...kept);
        (report.keptWith[anchor] ??= []).push(part.key);
      } else section.blocks.push(...kept);
    }
  }

  // Insertions, and choices rewritten in place (an option added, a choice reopened), applied from the end so no offset moves.
  const ops = [
    ...[...inserts].map(([at, blocks]) => ({ start: at, end: at, text: `\n\n${blocks.join("\n\n")}` })),
    ...[...edits.values()].map(({ choice, options }) => ({ start: choice.span.start, end: choice.span.end, text: formatChoice({ title: choice.title, resolved: false, options }) })),
  ].sort((a, b) => b.start - a.start || b.end - a.end);
  let text = input.text;
  for (const op of ops) text = `${text.slice(0, op.start)}${op.text}${text.slice(op.end)}`;
  // Where each unplaced section sits in the final text (offsets), so the update finds its units by position, not by matching text.
  const unplacedSpans: { start: number; end: number }[] = [];
  if (sections.length) {
    const head = text.replace(/\s+$/, "");
    let at = head.length + 2;
    for (const sec of sections) {
      const length = sec.blocks.join("\n\n").length;
      if (input.unplaced?.has(sec.key)) unplacedSpans.push({ start: at, end: at + length });
      at += length + 2;
    }
    text = `${head}\n\n${sections.map((s) => s.blocks.join("\n\n")).join("\n\n")}\n`;
  }
  // The text of each unplaced section as the merged text has it, so the update can show it as a plain card (`UpdateOptions.plainUnits`).
  const unplacedTexts = sections.filter((s) => input.unplaced?.has(s.key)).map((s) => normalizeUnitText(s.blocks.join("\n\n")));
  return { text, report, kept: keptOf, unplacedTexts, unplacedSpans };
}

/**
 * Where the notes already say `block`: `WORD_FOR_WORD` when its text is in them as is, else the topic holding nearly
 * all of its significant words (at least `MIN_WORDS` of them), else null. A number, version or identifier the topic does not
 * carry makes it something else ("12 dollars" against "15 dollars" is a change, not a repeat): it is not left out here, so the
 * model that files it can see both statements and call the difference a contradiction.
 */
function repeatOf(block: string, whole: string, said: ReadonlyMap<string, Said>): string | null {
  const n = normalizeUnitText(block).toLowerCase();
  if (!n || whole.includes(n)) return WORD_FOR_WORD;
  if (new Set(significant(block)).size < MIN_WORDS) return null;
  const details = keyTerms(block).map((t) => t.toLowerCase());
  for (const [topic, s] of said) if (coverageOf(block, s.words) >= REPEAT && details.every((t) => s.text.includes(t))) return topic;
  return null;
}

/** Pairs of the notes' topics that already repeat each other: a block of a later topic that an earlier one holds. */
export function notesOverlaps(text: string, parsed: ParsedContent, units: readonly AnalysisUnit[]): MergeReport["overlaps"] {
  const earlier: { key: string; said: Said }[] = [];
  const counts = new Map<string, { topics: [string, string]; passages: number }>();
  for (const u of units) {
    for (const block of partBlocks(text, parsed, u)) {
      const n = normalizeUnitText(block).toLowerCase();
      if (new Set(significant(block)).size < MIN_WORDS) continue;
      const other = earlier.find((e) => e.key !== u.key && (e.said.text.includes(n) || coverageOf(block, e.said.words) >= REPEAT));
      if (!other) continue;
      const pair = `${other.key}\u0000${u.key}`;
      const c = counts.get(pair) ?? { topics: [other.key, u.key] as [string, string], passages: 0 };
      c.passages++;
      counts.set(pair, c);
    }
    earlier.push({ key: u.key, said: said0(u.text) });
  }
  return [...counts.values()];
}

/**
 * A bold-only line (`**Title**`, optionally with a short note) is read as a heading, one level below the heading above it
 * (`content/structure.ts`). Filed at the end of a section's own text — above its subsections — it would be a heading at the section's
 * subsection level and every following subsection would nest under it: every topic key below changes, and the earlier sections are
 * no longer the same sections (measured on the layout D merge, 2026-10-10: all of them regenerated). The same line is written in italics
 * there, so it stays a label and the notes' structure stays as it is. Any other block is returned as it is.
 */
export function titleLikeAsItalic(block: string): string {
  const m = /^\*\*([^*\n]{2,80})\*\*(\s+[(—–-][^\n]*)?$/.exec(block.trim());
  return m ? `*${m[1]!.trim()}*${m[2] ?? ""}` : block;
}

/** A part's top-level blocks as source text, its own heading left out and any deeper heading turned into a bold line. */
export function partBlocks(input: string, parsed: ParsedContent, part: AnalysisUnit): string[] {
  const inside = parsed.blocks.filter((b) => b.span.start >= part.span.start && b.span.end <= part.span.end);
  const own = inside[0]?.type === "heading" && part.key !== "(lead)" ? inside.slice(1) : inside;
  return own.map((b) => blockText(input, b)).filter((t) => t.trim());
}

function blockText(input: string, b: ParsedBlock): string {
  return b.type === "heading" ? `**${b.text}**` : input.slice(b.span.start, b.span.end).replace(/\s+$/, "");
}

/** A quoted question of a chat: a quote block that is not a callout (a "Needs your call" choice is one). */
const isQuestion = (block: string) => /^>\s/.test(block) && !/^>\s*\[!/.test(block);

/**
 * Each part's blocks. In an incoming shared chat the question that leads to a part's answer is quoted at the end of the part before it, because
 * a heading starts a part; filed as it is, a question would travel with the wrong answer (under another topic, away from its own). So a part's
 * trailing quoted questions move to the start of the part that follows it, when that part comes straight after it in the incoming text. Anything
 * else, and a part that is only quotes, is left as it was.
 */
function questionsWithTheirAnswers(text: string, parsed: ParsedContent, parts: readonly AnalysisUnit[]): Map<string, string[]> {
  const blocks = new Map(parts.map((p) => [p.key, partBlocks(text, parsed, p)] as const));
  if (!CHAT_NOTES.test(text)) return blocks;
  for (let i = 0; i + 1 < parts.length; i++) {
    const here = parts[i]!;
    const next = parts[i + 1]!;
    if (next.span.start - here.span.end > 2) continue;
    const mine = blocks.get(here.key)!;
    let keep = mine.length;
    while (keep > 0 && isQuestion(mine[keep - 1]!)) keep--;
    if (keep === 0 || keep === mine.length) continue;
    blocks.set(next.key, [...mine.slice(keep), ...blocks.get(next.key)!]);
    blocks.set(here.key, mine.slice(0, keep));
  }
  return blocks;
}

/** Notes made from a shared ChatGPT chat (`Source: https://chatgpt.com/share/…`): each exchange is a quoted question and then the answer under its heading. */
const CHAT_NOTES = /^Source: https:\/\/chatgpt\.com\/share\//m;
const TRAILING_QUESTION = /\n\n(?:>[^\n]*(?:\n|$))+$/;

/**
 * In notes made from a chat, the question that leads to the next answer is quoted at the end of the section before it (a heading starts a
 * section, a question comes before its answer's heading). New text for a topic goes above those quoted lines, so it stays with its own
 * answer instead of under the next topic's question. Anything else, and a section that is only quotes, is left as it was.
 */
function beforeNextQuestion(text: string, start: number, at: number): number {
  if (!CHAT_NOTES.test(text)) return at;
  let end = at;
  for (;;) {
    const quoted = TRAILING_QUESTION.exec(text.slice(start, end));
    if (!quoted) return end;
    const above = start + quoted.index;
    // Something of the section's own must stay above the quote: a heading alone is not content.
    if (!/[\p{L}\p{N}]/u.test(text.slice(start, above).split("\n").filter((l) => !/^\s{0,3}#{1,6}\s/.test(l)).join(" "))) return end;
    end = above;
  }
}

/** The offset just after the last non-blank character before `end`: new blocks go right below the topic's own text. */
function endOfText(text: string, end: number): number {
  let i = end;
  while (i > 0 && /\s/.test(text[i - 1]!)) i--;
  return i;
}

/**
 * The heading level of a new topic: one below a single top heading that holds every section (`# Title` / `## …`),
 * else the level of the notes' own top sections, else 2.
 */
function newTopicLevel(parsed: ParsedContent): number {
  const headed = parsed.sections.filter((s) => s.heading);
  if (headed.length === 1 && parsed.sections.length <= 2 && headed[0]!.subsections.length) return Math.min(6, headed[0]!.heading!.level + 1);
  if (headed.length) return Math.min(...headed.map((s) => s.heading!.level));
  return 2;
}

/** Two statements are the same when only spacing and a final full stop differ. */
function sameStatement(a: string, b: string): boolean {
  const norm = (x: string) => x.trim().replace(/\s+/g, " ").replace(/[.!?]$/, "");
  return norm(a) === norm(b);
}
