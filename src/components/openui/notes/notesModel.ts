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
import { cardTextOf, splitBody, type CardTable } from "@/ai/openui/cardLang";
import type { DocumentRecord } from "@/domain/types";
import { isOpenReview } from "@/components/review/wording";

// The Lang builder and the card text shaping are shared with the canvas's "Cards" view (`ai/openui/cardLang.ts`).
export { BODY_LIMIT, noteLang, splitBody } from "@/ai/openui/cardLang";
export type NoteTable = CardTable;

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

  // Reading order among the cards of one section only: a frame, a drawing or a card of another frame starting a "row"
  // would otherwise pull every card whose top is above its middle into that row, read by x alone (rows interleaved).
  const bySection = new Map<string, SceneElement[]>();
  for (const el of live) {
    if (!documentIdOf(el)) continue;
    const sid = el.frameId && frameIds.has(el.frameId) ? el.frameId : "";
    (bySection.get(sid) ?? bySection.set(sid, []).get(sid)!).push(el);
  }
  const ordered = [...frames.map((f) => f.id), ""].flatMap((sid) => readingOrder(bySection.get(sid) ?? []));

  for (const el of ordered) {
    const docId = documentIdOf(el);
    if (!docId) continue;
    const rec = getDocument(docId);
    if (!rec) continue;
    const { title, text, table } = cardTextOf(rec);
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
