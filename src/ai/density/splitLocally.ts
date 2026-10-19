/**
 * "Split locally" (F42 Phase 4.4): a dense block split into pieces with no
 * model call — deterministic, instant and free, for the dense content whose
 * structure is already explicit:
 *
 * - A table: one card per row. The card's title is the lead of the row's first
 *   wordy cell (its leading bold text, else its first sentence); the row's
 *   short values are a bold-labelled line ("**Size:** M · **Order:** 1"); the
 *   body is the rest. A card that would still be long keeps its gist, and its
 *   full text goes on a page linked from it (`explained_by`).
 * - A checklist: its short items stay a checklist; each paragraph-long item is
 *   a card of its own (title from its lead, its status on the meta line).
 * - Anything else in the block (an intro paragraph, notes) stays as text, in
 *   order.
 *
 * The result is a raw plan of the pieces, for `proposeSplit` (which frames it
 * and proposes it as the block's replacement). Prose alone isn't split here:
 * finding its key points takes a model ("Visualize better").
 */
import { contentToMarkdown, inlineToMarkdown } from "@/domain/content/markdown";
import { inlineOf, inlineText, isTableContent } from "@/domain/content/richContent";
import type { ContentBlock, RichContent, TableCell, TableContent } from "@/domain/types";
import { DENSE_CELL_CHARS } from "./density";

/** A cell up to this long is a value (a size, a status, a name), shown on the card's meta line. */
export const SHORT_CELL_CHARS = 60;
/** A card longer than this keeps its gist, and its full text goes on a linked page. */
export const CARD_MAX_CHARS = 500;
const TITLE_MAX = 80;
/** A title longer than this is shortened at a clause boundary, when it has one. */
const TITLE_SHORT = 48;
const CLAUSE_BOUNDARIES = [" (", ", ", " — ", ": ", "; "];
const GIST_MAX = 300;

type Node = Record<string, unknown> & { id: string };

const norm = (s: string) => s.replace(/^#+\s*/, "").trim().toLowerCase();
const isBlank = (s: string) => !s.trim() || /^[-–—]+$/.test(s.trim());

/** Cuts at a word boundary, with an ellipsis. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > max / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** The first sentence of `text` and what follows it. */
function firstSentence(text: string): { sentence: string; rest: string } {
  const m = /^([\s\S]*?[.!?])(\s+|$)/.exec(text);
  if (!m) return { sentence: text, rest: "" };
  return { sentence: m[1]!, rest: text.slice(m[0].length) };
}

/** A leading status ("✅ **Done 2026-09-27 (tracker F31).**", "Not started.") — a value for the meta line, not a title. */
const STATUS_WORDS = String.raw`(?:done|built|not started|in progress|to do|open|deferred|mostly built)\b`;
const CHECK = String.raw`(✅|☑️?|✔️?)?\s*`;
/** "✅ **Done 2026-09-27 (tracker F31).**" (ends at the bold), or "Not started." (ends at its full stop or colon). */
const STATUS = [new RegExp(String.raw`^${CHECK}\*\*\s*(${STATUS_WORDS}[^*]*?)[.:]?\s*\*\*[.:]?\s+`, "i"), new RegExp(String.raw`^${CHECK}(${STATUS_WORDS}[^.:\n*]*)[.:]\s+`, "i")];

/** A wordy cell's leading status, and the text after it (unchanged when it has none, or nothing follows it). */
export function statusOf(markdown: string): { status: string | null; rest: string } {
  const m = STATUS.map((re) => re.exec(markdown.trim())).find((x) => x !== null) ?? null;
  const rest = m ? markdown.trim().slice(m[0].length).trim() : "";
  if (!m || !rest) return { status: null, rest: markdown };
  const words = m[2]!.trim();
  return { status: `${m[1] ? `${m[1]} ` : ""}${words.charAt(0).toUpperCase()}${words.slice(1)}`, rest };
}

/** A long title shortened at its first clause boundaries ("Levels for Repo Map, with the budget…" → "Levels for Repo Map"). */
function shortTitle(title: string): string {
  let t = title;
  while (t.length > TITLE_SHORT) {
    const at = CLAUSE_BOUNDARIES.map((b) => t.indexOf(b)).filter((i) => i >= 3);
    if (!at.length) break;
    t = t.slice(0, Math.min(...at)).trim();
  }
  return cut(t, TITLE_MAX);
}

/**
 * A card's title from a wordy cell: its leading bold text, else its first sentence; and what's left for the body.
 * A title shortened from its lead leaves the whole text in the body, so nothing is lost.
 */
export function leadOf(markdown: string): { title: string; rest: string } {
  const text = markdown.trim();
  const bold = /^\*\*(.+?)\*\*[\s:.–—-]*/.exec(text);
  const { sentence, rest } = firstSentence(text);
  // A title is plain text: no emphasis marks or Markdown escapes ("create\_image" → "create_image").
  const whole = (bold ? bold[1]! : sentence)
    .replace(/\*\*|__|`/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, "$1")
    .replace(/[.:]\s*$/, "")
    .trim();
  const title = shortTitle(whole);
  if (title !== whole) return { title, rest: text };
  return { title, rest: (bold ? text.slice(bold[0].length) : rest).trim() };
}

/** The gist of a body: whole sentences up to `GIST_MAX` characters (at least one, cut if it alone is longer). */
function gistOf(text: string): string {
  let out = "";
  let rest = text.trim();
  while (rest) {
    const { sentence, rest: next } = firstSentence(rest);
    if (out && out.length + 1 + sentence.length > GIST_MAX) break;
    out = out ? `${out} ${sentence}` : sentence;
    rest = next.trim();
    if (out.length >= GIST_MAX) break;
  }
  const gist = cut(out, GIST_MAX);
  return gist.length < text.trim().length ? (gist.endsWith("…") ? gist : `${gist} …`) : gist;
}

const cellText = (cell: TableCell | undefined) => (cell === undefined ? "" : inlineText(cell).trim());
const cellMarkdown = (cell: TableCell | undefined) => (cell === undefined ? "" : inlineToMarkdown(inlineOf(cell)).trim());

class Pieces {
  readonly nodes: Node[] = [];
  readonly relationships: { from: string; to: string; type: string }[] = [];

  /** A card, with its full text on a linked page when the card would be long. */
  card(key: string, title: string, meta: string, body: string, detail: string): void {
    const full = [meta, body].filter(Boolean).join("\n\n");
    const id = `c${this.nodes.length + 1}`;
    if (full.length <= CARD_MAX_CHARS) {
      this.nodes.push({ id, type: "text", title, stableKey: key, content: { markdown: full || title } });
      return;
    }
    const gist = [meta, gistOf(body)].filter(Boolean).join("\n\n");
    this.nodes.push({ id, type: "text", title, stableKey: key, content: { markdown: gist } });
    const page = `${id}p`;
    this.nodes.push({ id: page, type: "page", stableKey: `${key}:detail`, content: { title, markdown: detail.slice(0, 20_000) } });
    this.relationships.push({ from: id, to: page, type: "explained_by" });
  }

  text(key: string, markdown: string): void {
    if (markdown.trim()) this.nodes.push({ id: `t${this.nodes.length + 1}`, type: "text", stableKey: key, content: { markdown: markdown.trim() } });
  }

  todo(key: string, items: { text: string; checked: boolean }[]): void {
    if (items.length) this.nodes.push({ id: `d${this.nodes.length + 1}`, type: "todo", stableKey: key, content: { items } });
  }
}

function splitTable(table: TableContent, t: number, out: Pieces): void {
  const [header, ...rows] = table.rows.map((r) => r.cells);
  if (!header || !rows.length) return;
  const columns = header.map((c, i) => cellText(c) || `Column ${i + 1}`);
  const wordy = columns.map((_, c) => rows.some((r) => cellText(r[c]).length > SHORT_CELL_CHARS));
  const lead = wordy.indexOf(true);
  rows.forEach((row, i) => {
    const key = `table${t}.row#${i}`;
    const status = lead < 0 ? { status: null, rest: "" } : statusOf(cellMarkdown(row[lead]));
    const meta = [
      ...columns.flatMap((name, c) => (wordy[c] || isBlank(cellText(row[c])) ? [] : [`**${name}:** ${cellMarkdown(row[c])}`])),
      ...(status.status ? [`**Status:** ${status.status}`] : []),
    ].join(" · ");
    let title: string;
    const body: string[] = [];
    if (lead < 0) {
      // A long table of short values: each row titled by its first value.
      title = cellText(row[0]) || `Row ${i + 1}`;
    } else {
      const own = leadOf(status.status ? status.rest : cellMarkdown(row[lead]));
      title = own.title || cellText(row[0]) || `Row ${i + 1}`;
      if (own.rest) body.push(own.rest);
    }
    columns.forEach((name, c) => {
      if (!wordy[c] || c === lead || isBlank(cellText(row[c]))) return;
      body.push(`**${name}:** ${cellMarkdown(row[c])}`);
    });
    const detail = [
      meta,
      ...columns.flatMap((name, c) => (wordy[c] && !isBlank(cellText(row[c])) ? [`**${name}:** ${cellMarkdown(row[c])}`] : [])),
    ]
      .filter(Boolean)
      .join("\n\n");
    out.card(key, title, meta, body.join("\n\n"), detail);
  });
}

function splitChecklist(items: readonly ContentBlock[], l: number, out: Pieces): void {
  let short: { text: string; checked: boolean }[] = [];
  let runs = 0;
  const flush = () => {
    out.todo(`checklist${l}.items#${runs++}`, short);
    short = [];
  };
  items.forEach((b, i) => {
    const checked = b.props?.checked === true;
    const markdown = inlineToMarkdown(inlineOf(b.content)).trim();
    const nested = b.children?.length ? contentToMarkdown(b.children).trim() : "";
    const length = inlineText(b.content).trim().length + nested.length;
    if (length <= DENSE_CELL_CHARS) {
      short.push({ text: inlineText(b.content).trim(), checked });
      return;
    }
    flush();
    const own = leadOf(markdown);
    const meta = `**Status:** ${checked ? "✅ Done" : "☐ To do"}`;
    const body = [own.rest, nested].filter(Boolean).join("\n\n");
    out.card(`checklist${l}.item#${i}`, own.title, meta, body, [meta, markdown, nested].filter(Boolean).join("\n\n"));
  });
  flush();
}

/**
 * The pieces of a dense block's `content` (named `label`) as a raw plan, or null when there is nothing to split
 * locally (no table or paragraph-long checklist item, or fewer than two pieces).
 */
export function splitLocally(content: RichContent, label: string): unknown | null {
  const out = new Pieces();
  let tables = 0;
  let lists = 0;
  let splitSomething = false;
  let prose: ContentBlock[] = [];
  let checklist: ContentBlock[] = [];
  const flushProse = () => {
    out.text(`text#${out.nodes.length}`, contentToMarkdown(prose));
    prose = [];
  };
  const flushChecklist = () => {
    if (!checklist.length) return;
    if (checklist.some((b) => inlineText(b.content).trim().length + (b.children?.length ? contentToMarkdown(b.children).length : 0) > DENSE_CELL_CHARS)) {
      splitChecklist(checklist, lists++, out);
      splitSomething = true;
    } else prose.push(...checklist);
    checklist = [];
  };
  for (const b of content) {
    if (b.type === "checkListItem") {
      checklist.push(b);
      continue;
    }
    flushChecklist();
    if (isTableContent(b.content)) {
      flushProse();
      splitTable(b.content, tables++, out);
      splitSomething = true;
    } else if (!(b.type === "heading" && norm(inlineText(b.content)) === norm(label))) {
      // The block's own title is the frame's title.
      prose.push(b);
    }
  }
  flushChecklist();
  flushProse();
  if (!splitSomething || out.nodes.length < 2) return null;
  return { version: 1, template: "sectioned", nodes: out.nodes, relationships: out.relationships };
}
