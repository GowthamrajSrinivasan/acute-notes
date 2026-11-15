/**
 * The Notes view's content (`.ai/docs/openui-integration-plan.md` Phase 2): the canvas's text cards as a reading
 * document — sections from frames, notes in reading order, each note as OpenUI Lang for `acuteCardLibrary`. Pure and
 * deterministic: no model, no store, no canvas writes. The canvas stays the source of truth; this is a view of it.
 *
 * Progressive disclosure: a long card's first paragraph is its body, the rest is `detail` (behind "More"). A card's
 * citations and open review come from the distil link the review UI already reads (`knowledgeObjectsOf`), passed in.
 */
import type { CardReview } from "@/ai/fidelity/contracts";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { inlineText, isTableContent, toPlainText } from "@/domain/content/richContent";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { isOpenReview } from "@/components/review/wording";

export interface NoteTable {
  columns: string[];
  rows: string[][];
}

export interface Note {
  /** The canvas object id for a note on the canvas; a generated note's key otherwise. */
  id: string;
  title: string;
  body: string;
  /** The rest of a long card, shown on "More". */
  detail?: string;
  cites: string[];
  /** The first reason of an open review (the card "Needs review"). */
  needsReview?: string;
  table?: NoteTable;
  /** Other notes an arrow on the canvas connects this one to (either direction), in reading order. */
  related?: string[];
  /** The source version the note cites units of. */
  source?: { sourceId: string; version: number };
  onCanvas: boolean;
}

export interface NoteSection {
  /** The frame id, or "" for cards outside any frame. */
  id: string;
  title: string;
  notes: Note[];
}

/** What the review UI knows about a distil card (a subset of `KnowledgeObject`). */
export interface NoteKnowledge {
  objectId: string;
  sourceId: string;
  version: number;
  cites: readonly string[];
  review?: CardReview;
}

type GetDocument = (id: string) => DocumentRecord | null | undefined;

/** A body longer than this is split: its first paragraph (or first sentences up to this) stays, the rest is detail. */
export const BODY_LIMIT = 280;
const UNTITLED_SECTION = "Notes outside sections";

interface Box {
  x: number;
  y: number;
  height: number;
}

/**
 * Reading order: rows top to bottom, left to right within a row. Two items share a row when the later one's top is
 * above the middle of the row's first item, so a grid of cards reads row by row even when their tops differ a little.
 */
export function readingOrder<T extends Box>(items: readonly T[]): T[] {
  const byTop = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: T[][] = [];
  for (const item of byTop) {
    const row = rows.at(-1);
    if (row && item.y < row[0]!.y + row[0]!.height / 2) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}

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

function tableOf(snapshot: RichContent): NoteTable | undefined {
  const block = snapshot.find((b) => isTableContent(b.content));
  if (!block || !isTableContent(block.content)) return undefined;
  const rows = block.content.rows.map((r) => r.cells.map((c) => inlineText(c).trim()));
  if (!rows.length) return undefined;
  const [columns, ...rest] = rows;
  return { columns: columns!, rows: rest };
}

/** A card's title and the text after it. The document's own title wins; else its first line. */
function textOf(rec: DocumentRecord): { title: string; text: string; table?: NoteTable } {
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

function documentIdOf(el: SceneElement): string | null {
  const ref = getEmbedRef(el);
  if (ref?.kind === "rich-block") return ref.documentId;
  if (ref?.kind === "page-preview") return ref.pageId;
  return null;
}

/**
 * The canvas's text cards (rich blocks and page previews) as sections: one per frame, in the frames' reading order,
 * then the cards outside every frame. Section-title cards (a card whose only text is its frame's name) are left out;
 * so are empty cards and deleted elements. Shapes, arrows and drawings aren't notes.
 */
export function buildNotes(elements: readonly SceneElement[], getDocument: GetDocument, knowledge: readonly NoteKnowledge[] = []): NoteSection[] {
  const live = elements.filter((e) => !e.isDeleted);
  const frames = readingOrder(live.filter((e) => e.type === "frame"));
  const frameIds = new Set(frames.map((f) => f.id));
  const known = new Map(knowledge.map((k) => [k.objectId, k] as const));
  const sections = new Map<string, NoteSection>();
  for (const f of frames) sections.set(f.id, { id: f.id, title: (f as SceneElement & { name?: string | null }).name?.trim() || "Untitled section", notes: [] });

  for (const el of readingOrder(live)) {
    const docId = documentIdOf(el);
    if (!docId) continue;
    const rec = getDocument(docId);
    if (!rec) continue;
    const { title, text, table } = textOf(rec);
    if (!title && !text && !table) continue;
    const sectionId = el.frameId && frameIds.has(el.frameId) ? el.frameId : "";
    let section = sections.get(sectionId);
    if (!section) {
      section = { id: "", title: UNTITLED_SECTION, notes: [] };
      sections.set("", section);
    }
    if (!text && !table && title === section.title) continue;
    const k = known.get(el.id);
    const reason = k?.review && isOpenReview(k.review) ? (k.review.reasons[0] ?? "Needs review") : undefined;
    section.notes.push({
      id: el.id,
      title: title || text.split("\n")[0]!.slice(0, 80),
      ...(title ? splitBody(text) : splitBody(text.split("\n").slice(1).join("\n"))),
      cites: [...(k?.cites ?? [])],
      ...(reason ? { needsReview: reason } : {}),
      ...(table ? { table } : {}),
      ...(k ? { source: { sourceId: k.sourceId, version: k.version } } : {}),
      onCanvas: true,
    });
  }
  const result = [...sections.values()].filter((s) => s.notes.length > 0);
  linkRelated(live, result);
  return result;
}

/** Cross-note navigation: two notes joined by an arrow are related both ways. */
function linkRelated(elements: readonly SceneElement[], sections: NoteSection[]): void {
  const notes = sections.flatMap((s) => s.notes);
  const order = new Map(notes.map((n, i) => [n.id, i] as const));
  const related = new Map<string, Set<string>>();
  const add = (a: string, b: string) => (related.get(a) ?? related.set(a, new Set()).get(a)!).add(b);
  for (const el of elements) {
    if (el.type !== "arrow") continue;
    const a = el.startBinding?.elementId;
    const b = el.endBinding?.elementId;
    if (!a || !b || a === b || !order.has(a) || !order.has(b)) continue;
    add(a, b);
    add(b, a);
  }
  for (const n of notes) {
    const ids = related.get(n.id);
    if (ids) n.related = [...ids].sort((x, y) => order.get(x)! - order.get(y)!);
  }
}

const lit = (s: string) => JSON.stringify(s);

/** One note as OpenUI Lang: an `IdeaCard` with its citations, detail, table and review callout. */
export function noteLang(note: Pick<Note, "title" | "body" | "detail" | "cites" | "needsReview" | "table" | "related">): string {
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
