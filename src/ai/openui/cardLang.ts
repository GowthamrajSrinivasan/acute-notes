/**
 * One card as OpenUI Lang for `acuteCardLibrary`, built in code from the card's stored content (no model call). Shared by
 * the Notes view (`components/openui/notes/notesModel.ts`) and the canvas's "Cards" view
 * (`.ai/docs/openui/openui-canvas-rendering-plan-2026-11-16.md` step 3), so both draw a card the same way.
 *
 * Pure and deterministic. It never reads object metadata: citations and an open review's reason are passed in as plain
 * data by a caller that is allowed to know them.
 */
import { inlineText, isTableContent, toPlainText } from "@/domain/content/richContent";
import type { RichContent } from "@/domain/types";

export interface CardTable {
  columns: string[];
  rows: string[][];
}

/** What a card's Lang is built from. */
export interface CardLangInput {
  title: string;
  body: string;
  /** The rest of a long card, shown on "More". */
  detail?: string;
  cites: readonly string[];
  /** The first reason of an open review (the card "Needs review"). */
  needsReview?: string;
  table?: CardTable;
  /** Other notes this one links to (`NoteLink`); the Notes view only. */
  related?: readonly string[];
}

/** A body longer than this is split: its first paragraph (or first sentences up to this) stays, the rest is detail. */
export const BODY_LIMIT = 280;

/** First paragraph as body; when that is itself too long, as many whole sentences as fit (at least one). */
export function splitBody(text: string, limit = BODY_LIMIT): { body: string; detail?: string } {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return { body: trimmed };
  const paragraphs = trimmed.split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean);
  let body = paragraphs[0] ?? "";
  let rest = paragraphs.slice(1).join("\n\n");
  if (body.length > limit) {
    const sentences = body.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [body];
    let kept = "";
    let i = 0;
    while (i < sentences.length && (kept.length === 0 || kept.length + sentences[i]!.length <= limit)) kept += sentences[i++];
    const leftover = sentences.slice(i).join("").trim();
    body = kept.trim();
    rest = [leftover, rest].filter(Boolean).join("\n\n");
  }
  return rest ? { body, detail: rest } : { body };
}

function tableOf(snapshot: RichContent): CardTable | undefined {
  const block = snapshot.find((b) => isTableContent(b.content));
  if (!block || !isTableContent(block.content)) return undefined;
  const rows = block.content.rows.map((r) => r.cells.map((c) => inlineText(c).trim()));
  if (!rows.length) return undefined;
  const [columns, ...rest] = rows;
  return { columns: columns!, rows: rest };
}

/** A card's title and the text after it. The document's own title wins; else its first line. */
export function cardTextOf(rec: { title: string; snapshot: RichContent }): { title: string; text: string; table?: CardTable } {
  const table = tableOf(rec.snapshot);
  const prose = toPlainText(rec.snapshot.filter((b) => !isTableContent(b.content))).trim();
  const hasTitle = rec.title && rec.title !== "Untitled";
  if (hasTitle) {
    const text = prose.startsWith(rec.title) ? prose.slice(rec.title.length).trim() : prose;
    return { title: rec.title, text, ...(table ? { table } : {}) };
  }
  const [first = "", ...rest] = prose.split("\n");
  return { title: first.trim(), text: rest.join("\n").trim(), ...(table ? { table } : {}) };
}

/** A card's title, body and detail as a note shows them; null for a card with no text and no table. */
export function cardShapeOf(rec: { title: string; snapshot: RichContent }): Pick<CardLangInput, "title" | "body" | "detail" | "table"> | null {
  const { title, text, table } = cardTextOf(rec);
  if (!title && !text && !table) return null;
  return {
    title: title || text.split("\n")[0]!.slice(0, 80),
    ...(title ? splitBody(text) : splitBody(text.split("\n").slice(1).join("\n"))),
    ...(table ? { table } : {}),
  };
}

const lit = (s: string) => JSON.stringify(s);

/** One note as OpenUI Lang: an `IdeaCard` with its citations, detail, table and review callout. */
export function noteLang(note: CardLangInput): string {
  const lines: string[] = [];
  const cites = note.cites.map((u, i) => {
    lines.push(`c${i + 1} = CitationChip(${lit(u)})`);
    return `c${i + 1}`;
  });
  const extras: string[] = [];
  if (note.needsReview) {
    lines.push(`x1 = Callout("warning", ${lit(`Needs review: ${note.needsReview}`)})`);
    extras.push("x1");
  }
  if (note.table) {
    const columns = `[${note.table.columns.map(lit).join(", ")}]`;
    const rows = `[${note.table.rows.map((r) => `[${r.map(lit).join(", ")}]`).join(", ")}]`;
    lines.push(`x2 = ComparisonTable(${columns}, ${rows})`);
    extras.push("x2");
  }
  (note.related ?? []).forEach((id, i) => {
    lines.push(`l${i + 1} = NoteLink(${lit(id)})`);
    extras.push(`l${i + 1}`);
  });
  const args = [lit(note.title), lit(note.body), "null", `[${cites.join(", ")}]`, note.detail ? lit(note.detail) : "null", `[${extras.join(", ")}]`];
  // Trailing nulls/empties are dropped so the Lang stays as short as a hand-written card.
  while (args.length > 2 && (args.at(-1) === "null" || args.at(-1) === "[]")) args.pop();
  return [`root = IdeaCard(${args.join(", ")})`, ...lines].join("\n");
}

/**
 * A canvas card's Lang (the "Cards" view): its stored title and content, with the citations and open review the caller
 * knows. Null when the card has nothing a note would show (empty, or only a heading-less nothing).
 */
export function cardLangOf(rec: { title: string; snapshot: RichContent }, knowledge?: { cites: readonly string[]; needsReview?: string }): string | null {
  const shape = cardShapeOf(rec);
  if (!shape) return null;
  return noteLang({ ...shape, cites: knowledge?.cites ?? [], ...(knowledge?.needsReview ? { needsReview: knowledge.needsReview } : {}) });
}
