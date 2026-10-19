/**
 * The content safety net (content fidelity plan, Step 4): after a section is generated, every unit of its source —
 * a sentence, a list item, a table row, a code block — is checked against the model's reply, and whatever the reply
 * doesn't cover is attached to the same section, verbatim. The model may reorganise and shorten; it can no longer
 * lose content: missing table rows come back as a table with the same columns, missing sentences and list items as
 * one "Also in the source" block, missing code as code.
 *
 * Deterministic and word-level (`coverageOf`, the same measure the fidelity score uses): a unit counts as covered
 * when most of its significant words appear anywhere in the reply, so a reworded unit is kept, a dropped one is not.
 */
import { parseContent } from "@/ai/content/parser";
import type { ParsedBlock, ParsedListItem } from "@/ai/content/types";
import { COVERAGE_THRESHOLD, coverageOf, keyTerms, nodeStrings, significant, words } from "./information";

/** A section's source coverage by its generated plan. */
export interface SectionCoverage {
  /** Source units (sentences, list items, table rows, code blocks). */
  total: number;
  /** Units the model's reply already covered. */
  covered: number;
  /** Units attached from the source because the reply didn't cover them. */
  attached: number;
  /** The attached units' text, in source order (a table row as its cells joined by " · "). */
  added: string[];
  /** Key terms (numbers, paths, identifiers) of the section, and those the AI's own plan left out. */
  keyTerms: { total: number; placedByAI: number; missing: string[]; all: string[] };
}

const ALSO_TITLE = "Also in the source";
/** Where the net puts what the AI left out, when it is more than a line or two (Wave B): one page, one click away. */
export const SOURCE_DETAILS_TITLE = "Source details";
/** Up to this much missing prose (and no table or code) stays a small card; more goes in the "Source details" page. */
const SMALL_ADDITION_CHARS = 300;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Sentences of a paragraph, each with enough words to be a unit of information. */
function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/))
    .map((s) => s.trim())
    .filter((s) => significant(s).length >= 2);
}

function itemText(item: ParsedListItem): string {
  const nested = item.children.flatMap((b) => (b.type === "paragraph" ? [b.text] : []));
  return [item.text, ...nested].join(" ").trim();
}

interface Missing {
  /** Missing prose, in source order, as Markdown: a paragraph (or its missing sentences) or a list item line. */
  lines: { kind: "paragraph" | "item"; markdown: string }[];
  /** Every missing unit's text, in source order. */
  texts: string[];
  tables: { columns: string[]; rows: string[][]; partial: boolean }[];
  code: { language?: string; source: string }[];
}

/** A paragraph that introduces the list right after it ("Now the checks look the unit up in the dictionary:"). */
const isLeadIn = (b: ParsedBlock, next: ParsedBlock | undefined) => b.type === "paragraph" && next?.type === "list" && /:\s*$/.test(b.text);

/** A block's own Markdown, as the source wrote it (bold, code, links kept), on one line. */
const markdownOf = (source: string, span: { start: number; end: number }) => source.slice(span.start, span.end).replace(/\s*\n\s*/g, " ").trim();

function walk(blocks: readonly ParsedBlock[], source: string, vocab: ReadonlySet<string>, missing: Missing, count: { total: number; covered: number }): void {
  const unit = (text: string): boolean => {
    count.total++;
    const ok = coverageOf(text, vocab) >= COVERAGE_THRESHOLD;
    if (ok) count.covered++;
    return ok;
  };
  // A missing lead-in waits for its list: it is attached only before list items that are missing too, never on its own.
  let leadIn: { markdown: string; text: string; units: number } | null = null;
  blocks.forEach((b, index) => {
    switch (b.type) {
      case "paragraph": {
        const all = sentences(b.text);
        const lost = all.filter((s) => !unit(s));
        if (!lost.length) break;
        // A paragraph missing whole keeps its own Markdown; one missing in part, its missing sentences, together.
        const markdown = lost.length === all.length ? markdownOf(source, b.span) : lost.join(" ");
        if (isLeadIn(b, blocks[index + 1])) {
          leadIn = { markdown, text: lost.join(" "), units: lost.length };
          // Counted as covered unless its list turns out to be missing something.
          count.covered += lost.length;
          break;
        }
        missing.lines.push({ kind: "paragraph", markdown });
        missing.texts.push(...lost);
        break;
      }
      case "list": {
        const intro: { markdown: string; text: string; units: number } | null = leadIn;
        leadIn = null;
        let introduced = false;
        b.items.forEach((item, i) => {
          const text = itemText(item);
          if (significant(text).length && !unit(text)) {
            if (intro && !introduced) {
              introduced = true;
              count.covered -= intro.units;
              missing.lines.push({ kind: "paragraph", markdown: intro.markdown });
              missing.texts.push(intro.text);
            }
            const marker = item.checked === null ? (b.ordered ? `${(b.start ?? 1) + i}.` : "-") : `- [${item.checked ? "x" : " "}]`;
            // The item's own Markdown when it holds nothing but text (nested lists are walked on their own below).
            const own = item.children.every((c) => c.type === "paragraph") ? markdownOf(source, item.span).replace(/^(?:[-*+]|\d+[.)])(?:\s+\[[ xX]\])?\s+/, "") : text;
            missing.lines.push({ kind: "item", markdown: `${marker} ${own}` });
            missing.texts.push(text);
          }
          walk(item.children.filter((c) => c.type !== "paragraph"), source, vocab, missing, count);
        });
        break;
      }
      case "table": {
        // A row the AI shortened (a dropped column, a cut condition) is missing, even when its key is there. What is
        // missing goes in the "Source details" page, so it no longer sits as a second copy beside the AI's table.
        const rows = b.rows.filter((row) => !unit(row.join(" ")));
        if (rows.length) missing.tables.push({ columns: b.columns, rows, partial: rows.length < b.rows.length });
        for (const row of rows) missing.texts.push(row.filter(Boolean).join(" · "));
        break;
      }
      case "code":
        if (!unit(b.source)) {
          missing.code.push({ ...(b.language ? { language: b.language } : {}), source: b.source });
          missing.texts.push(b.source.split(/\r?\n/)[0]!.trim() || "code");
        }
        break;
      case "quote":
        walk(b.children, source, vocab, missing, count);
        break;
      default:
        // Headings are the frame's title; images and dividers carry no text to lose.
        break;
    }
  });
}

/** Missing prose as Markdown: paragraphs apart, a list's items together. */
function proseOf(lines: Missing["lines"]): string {
  return lines.map((l, i) => (i === 0 ? "" : l.kind === "item" && lines[i - 1]!.kind === "item" ? "\n" : "\n\n") + l.markdown).join("");
}

/** A Markdown table of `rows` under `columns` (pipes escaped, line breaks as spaces). */
function markdownTable(columns: readonly string[], rows: readonly (readonly string[])[]): string {
  const cell = (c: string) => c.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim() || " ";
  const line = (cells: readonly string[]) => `| ${columns.map((_, i) => cell(cells[i] ?? "")).join(" | ")} |`;
  return [line(columns), `|${columns.map(() => "---").join("|")}|`, ...rows.map(line)].join("\n");
}

/**
 * `raw` (a section's untrusted plan reply) with the parts of `sectionText` it doesn't cover attached as nodes of
 * its own, and the section's coverage. A reply that isn't plan-shaped is returned as is (the caller's fallback
 * handles it).
 */
export async function attachUncovered(raw: unknown, sectionText: string): Promise<{ raw: unknown; coverage: SectionCoverage }> {
  const empty = { raw, coverage: { total: 0, covered: 0, attached: 0, added: [], keyTerms: { total: 0, placedByAI: 0, missing: [], all: [] } } };
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return empty;
  let parsed;
  try {
    parsed = await parseContent(sectionText);
  } catch {
    return empty;
  }
  const vocab = new Set<string>();
  for (const n of raw.nodes) for (const s of nodeStrings(n)) for (const w of words(s)) vocab.add(w);
  if (Array.isArray(raw.relationships)) for (const r of raw.relationships) if (isObject(r) && typeof r.label === "string") for (const w of words(r.label)) vocab.add(w);

  const missing: Missing = { lines: [], texts: [], tables: [], code: [] };
  const count = { total: 0, covered: 0 };
  walk(parsed.blocks, sectionText, vocab, missing, count);

  const added: Record<string, unknown>[] = [];
  const id = (k: string) => `src~${k}`;
  // In source order, shaped as the source was: paragraphs as paragraphs, list items as a list.
  const prose = proseOf(missing.lines);
  if (!missing.tables.length && !missing.code.length && prose.length <= SMALL_ADDITION_CHARS) {
    // A line or two: a small card, where it is seen.
    if (prose) added.push({ id: id("text"), type: "text", title: ALSO_TITLE, content: { markdown: prose } });
  } else if (prose || missing.tables.length || missing.code.length) {
    // More: one "Source details" page, one click away, so the source's own wording never crowds out the AI's
    // analysis on the canvas (Wave B). Everything is still there, verbatim.
    const parts = [
      ...(prose ? [prose] : []),
      ...missing.tables.map((t) => markdownTable(t.columns, t.rows)),
      ...missing.code.map((c) => `\`\`\`${c.language ?? ""}\n${c.source}\n\`\`\``),
    ];
    added.push({ id: id("page"), type: "page", content: { title: SOURCE_DETAILS_TITLE, markdown: parts.join("\n\n") } });
  }

  const terms = keyTerms(sectionText);
  const missingTerms = terms.filter((t) => !vocab.has(t));
  return {
    raw: added.length ? { ...raw, nodes: [...raw.nodes, ...added] } : raw,
    coverage: {
      total: count.total,
      covered: count.covered,
      attached: missing.texts.length,
      added: missing.texts,
      keyTerms: { total: terms.length, placedByAI: terms.length - missingTerms.length, missing: missingTerms, all: terms },
    },
  };
}
