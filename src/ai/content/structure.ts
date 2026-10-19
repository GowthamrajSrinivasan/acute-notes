/**
 * Structure recovery (content fidelity plan): the structure a document shows to a reader but not to a Markdown
 * parser — chat answers, notes and copied documents rarely use `#` headings or pipe tables. Recovered structure
 * becomes real blocks, so the document splits into its own sections (analysis units, one model call each) and its
 * tables stay tables, instead of arriving at the model as one long blob it then condenses.
 *
 * Recovered, in parsed paragraphs only (every other block is kept as is), with spans into the original input:
 * - A bold-only line, optionally followed by a short note: `**Tests before the hand-off**`,
 *   `**Branches and worktrees** (new worktrees, …)` → a heading, one level below the heading it sits under.
 * - Two or more consecutive tab-separated lines with the same columns (a table copied from a page or a sheet)
 *   → a table. A header row that starts with a tab (an empty corner cell above a row-label column) is read by the
 *   Markdown parser as an indented code block; it is joined back to its rows. A header one cell short of every row
 *   (the corner cell dropped in the copy) gets an empty first column, so each row keeps its cells in place.
 * - Only in a document with no headings of its own (so a Markdown document's soft-wrapped prose is never
 *   touched): a short title line directly above such a table, or a short title line above longer, hard-broken
 *   lines ("Pass / fail examples per check" / "One row per check. Where a check can fail…") → a heading.
 *   The document's first block, when it is a recovered title, becomes its level-1 title.
 *
 * Pure and deterministic.
 */
import type { ParsedBlock, ParsedInline, SourceSpan } from "./types";

/** A bold title's own text, at most this long (a longer bold run is emphasis in a sentence, not a title). */
const BOLD_TITLE_MAX = 80;
/** A bold title's whole line (with its note), at most this long. */
const BOLD_LINE_MAX = 160;
/** A plain title line, at most this long. */
const TITLE_LINE_MAX = 100;
/** A plain title line above prose, at most this long (shorter than soft-wrapped prose lines). */
const PROSE_TITLE_MAX = 60;
/** A line this long can't be soft-wrapped prose: its paragraph has hard line breaks. */
const LONG_LINE = 100;

interface Line {
  text: string;
  start: number;
  end: number;
}

type Paragraph = Extract<ParsedBlock, { type: "paragraph" }>;

export function recoverStructure(blocks: readonly ParsedBlock[], input: string): ParsedBlock[] {
  const hasHeadings = blocks.some((b) => b.type === "heading");
  const out: ParsedBlock[] = [];
  let underLevel = 1;
  let recovered = 0;
  const merged = joinTabbedHeaders(blocks, input);
  merged.forEach((block, i) => {
    if (block.type === "heading") {
      underLevel = block.level;
      out.push(block);
      return;
    }
    if (block.type !== "paragraph") {
      out.push(block);
      return;
    }
    const level = Math.min(6, underLevel + 1) as 2 | 3 | 4 | 5 | 6;
    if (i < merged.length - 1 && isBoldTitle(block)) {
      out.push({ type: "heading", level, text: block.text.trim(), inline: block.inline, span: block.span });
      recovered++;
      return;
    }
    const pieces = splitParagraph(block, input, !hasHeadings, level);
    recovered += pieces.filter((p) => p.type === "heading").length;
    out.push(...pieces);
  });
  // A heading-less document whose very first block is a recovered title: that is the document's title.
  const first = out[0];
  if (!hasHeadings && recovered > 1 && first?.type === "heading") out[0] = { ...first, level: 1 };
  return out;
}

/**
 * An indented code block of tab-separated lines directly followed by a paragraph that starts with tab-separated
 * lines: a copied table whose header row starts with a tab (an empty corner cell). Joined into one paragraph over
 * both, so the table is recovered with its header.
 */
function joinTabbedHeaders(blocks: readonly ParsedBlock[], input: string): ParsedBlock[] {
  const out: ParsedBlock[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    const next = blocks[i + 1];
    if (block.type === "code" && next?.type === "paragraph") {
      const start = input.lastIndexOf("\n", block.span.start - 1) + 1;
      const header = input.slice(start, block.span.end).split("\n").filter((l) => l.trim());
      const fenced = /^\s*(```|~~~)/.test(header[0] ?? "");
      const firstRow = input.slice(next.span.start, next.span.end).split("\n")[0] ?? "";
      if (!fenced && header.length && header.every(isTableLine) && isTableLine(firstRow)) {
        const span = { start, end: next.span.end };
        const text = input.slice(span.start, span.end);
        out.push({ type: "paragraph", text, inline: [{ type: "text", text, span }], span });
        i++;
        continue;
      }
    }
    out.push(block);
  }
  return out;
}

/** `**Title**` on its own line, optionally with a short trailing note (`(…)`, `— …`). */
function isBoldTitle(block: Paragraph): boolean {
  const text = block.text.trim();
  if (!text || text.includes("\n") || text.length > BOLD_LINE_MAX) return false;
  const parts = block.inline.filter((p) => !(p.type === "text" && !p.text.trim()));
  let bold = "";
  let i = 0;
  for (; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.type !== "text" || !p.marks?.includes("strong")) break;
    bold += p.text;
  }
  bold = bold.trim();
  if (bold.length < 2 || bold.length > BOLD_TITLE_MAX || /[.!?]$/.test(bold)) return false;
  const rest = plain(parts.slice(i)).trim();
  // "**Status tracker:** no rows changed." is a labelled sentence, not a title.
  if (/:$/.test(bold) && rest) return false;
  return !rest || /^[(—–-]/.test(rest);
}

function plain(inline: readonly ParsedInline[]): string {
  return inline.map((p) => (p.type === "link" ? p.children.map((c) => c.text).join("") : p.type === "text" ? p.text : "")).join("");
}

function linesOf(input: string, span: SourceSpan): Line[] {
  const lines: Line[] = [];
  let start = span.start;
  for (const raw of input.slice(span.start, span.end).split("\n")) {
    const text = raw.replace(/\r$/, "");
    lines.push({ text, start, end: start + text.length });
    start += raw.length + 1;
  }
  return lines;
}

const cellsOf = (line: string) => line.split("\t").map((c) => c.trim().replace(/\*\*|`/g, ""));
const isTableLine = (line: string) => line.includes("\t") && line.trim().length > 0;
const isTitleLine = (line: string, max: number) => {
  const t = line.trim();
  return t.length > 1 && t.length <= max && !t.includes("\t") && !/[.,;:!?]$/.test(t) && !/^[-*+>|]|^\d+[.)]\s/.test(t);
};

function paragraphOf(lines: readonly Line[]): Paragraph {
  const text = lines.map((l) => l.text).join("\n");
  const span = { start: lines[0]!.start, end: lines.at(-1)!.end };
  return { type: "paragraph", text, inline: [{ type: "text", text, span }], span };
}

function headingOf(line: Line, level: 1 | 2 | 3 | 4 | 5 | 6): ParsedBlock {
  const text = line.text.trim();
  const span = { start: line.start, end: line.end };
  return { type: "heading", level, text, inline: [{ type: "text", text, span }], span };
}

function tableOf(lines: readonly Line[]): ParsedBlock {
  let columns = cellsOf(lines[0]!.text);
  const body = lines.slice(1).map((l) => cellsOf(l.text));
  // The corner cell above a row-label column was dropped in the copy: every row has one cell more.
  if (body.length && body.every((cells) => cells.length === columns.length + 1)) columns = ["", ...columns];
  const rows = body.map((cells) => {
    // A row with more cells than columns keeps the extra text in its last cell.
    const fitted = columns.map((_, i) => cells[i] ?? "");
    if (cells.length > columns.length) fitted[columns.length - 1] = cells.slice(columns.length - 1).join(" ");
    return fitted;
  });
  return { type: "table", columns, rows, align: columns.map(() => null), span: { start: lines[0]!.start, end: lines.at(-1)!.end } };
}

/** A paragraph as its recovered pieces — or itself, unchanged, when nothing is recovered. */
function splitParagraph(block: Paragraph, input: string, titles: boolean, level: 2 | 3 | 4 | 5 | 6): ParsedBlock[] {
  const raw = input.slice(block.span.start, block.span.end);
  if (!raw.includes("\t") && !(titles && raw.includes("\n"))) return [block];
  const lines = linesOf(input, block.span).filter((l) => l.text.trim());
  const pieces: ParsedBlock[] = [];
  let pending: Line[] = [];
  const flush = (beforeTable: boolean) => {
    if (!pending.length) return;
    // A short title line directly above a table: that table's heading.
    if (beforeTable && titles && isTitleLine(pending.at(-1)!.text, TITLE_LINE_MAX)) {
      const title = pending.pop()!;
      if (pending.length) pieces.push(...prose(pending));
      pieces.push(headingOf(title, level));
    } else pieces.push(...prose(pending));
    pending = [];
  };
  const prose = (chunk: Line[]): ParsedBlock[] => {
    if (titles && chunk.length > 1 && isTitleLine(chunk[0]!.text, PROSE_TITLE_MAX) && chunk.slice(1).some((l) => l.text.length > LONG_LINE)) {
      return [headingOf(chunk[0]!, level), paragraphOf(chunk.slice(1))];
    }
    return [paragraphOf(chunk)];
  };
  let i = 0;
  while (i < lines.length) {
    let j = i;
    while (j < lines.length && isTableLine(lines[j]!.text)) j++;
    if (j - i >= 2 && cellsOf(lines[i]!.text).length >= 2) {
      flush(true);
      pieces.push(tableOf(lines.slice(i, j)));
      i = j;
    } else {
      pending.push(...lines.slice(i, Math.max(j, i + 1)));
      i = Math.max(j, i + 1);
    }
  }
  flush(false);
  // Nothing recovered: keep the original block (with its inline formatting).
  return pieces.length === 1 && pieces[0]!.type === "paragraph" ? [block] : pieces;
}
