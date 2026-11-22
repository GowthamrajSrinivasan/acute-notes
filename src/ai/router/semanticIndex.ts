/**
 * Stage 5b wiring (intelligent-update-engine-plan §18): the item index (`itemIndex.ts`) fed from a live canvas.
 *
 * - **What a card's items are** (`cardItemsOf`): a table card → its data rows; a card of list or todo items → each item;
 *   any other card → each sentence of its paragraphs (and a shape's label). `block` is the item's top-level block index
 *   and `part` its sentence or (absolute) table row — exactly what a `patch_block` edit or insert addresses (5d).
 * - **Kept current incrementally** (`sync`): a card is re-read only when its fingerprint changed; removed cards leave.
 *   Called after every accepted change (the dialog listens to `onCommitted`) and on each use, so manual edits count too.
 *   Hashing only — embedding is `Descent.prepare()` / `ItemIndex.refresh()`, in the background.
 * - **Derived and disposable**: rebuilt from the canvas at any time; nothing is persisted yet (vectors are cached per
 *   text by the embedder for the page's life).
 */
import { blockPlainText, targetPlainText } from "@/ai/changes/claimPatch";
import { sentenceSpans } from "@/ai/fidelity/sourceUnits";
import { fingerprintOf, labelsByContainer, objectContent, type ObjectContent } from "@/ai/reconcile/objects";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { ContentBlock, DocumentRecord, TableContent } from "@/domain/types";
import type { DescentSection } from "./descent";
import { sectionsOf } from "./descriptors";
import { ItemIndex, type CardItems } from "./itemIndex";
import type { EmbeddingProvider } from "./embeddingProvider";

const LIST_TYPES = new Set(["bulletListItem", "numberedListItem", "toggleListItem"]);
const PROSE_TYPES = new Set(["paragraph", "quote"]);

function isTable(c: ContentBlock["content"]): c is TableContent {
  return typeof c === "object" && c !== null && !Array.isArray(c) && (c as TableContent).type === "tableContent";
}

function sentencesOf(text: string): string[] {
  return sentenceSpans(text, { start: 0, end: text.length })
    .map((s) => text.slice(s.start, s.end).trim())
    .filter(Boolean);
}

/** A table block's cells as plain text, row by row. */
export function tableCells(block: ContentBlock): string[][] {
  if (!isTable(block.content)) return [];
  return block.content.rows.map((r, row) => r.cells.map((_c, col) => targetPlainText(block, { cell: { row, col } }) ?? ""));
}

/** See module doc. Null for an object with no text (an empty card, an image). */
export function cardItemsOf(card: string, section: string | null, content: ObjectContent): CardItems | null {
  if (content.kind === "shape") {
    const label = content.label.trim();
    if (!label) return null;
    return { card, section, kind: "text", text: label, items: sentencesOf(label).map((text, part) => ({ block: 0, part, text })) };
  }
  const blocks = content.content;
  const texts = blocks.map((b) => (isTable(b.content) ? tableCells(b).map((r) => r.join(" | ")).join("\n") : (blockPlainText(b) ?? "")));
  const text = [content.kind === "page" ? content.title : "", ...texts].filter((t) => t.trim()).join("\n");
  if (!text.trim()) return null;
  const tableAt = blocks.findIndex((b) => b.type === "table" && isTable(b.content));
  if (tableAt >= 0) {
    const block = blocks[tableAt]!;
    const rows = tableCells(block);
    const headerRows = Math.min(rows.length, Math.max(1, (block.content as TableContent).headerRows ?? 1));
    return {
      card,
      section,
      kind: "table",
      text,
      header: rows[0] ?? [],
      items: rows.slice(headerRows).map((cells, i) => ({ block: tableAt, part: headerRows + i, text: cells.join(" | "), cells })),
    };
  }
  const list = blocks.flatMap((b, i) => (LIST_TYPES.has(b.type) || b.type === "checkListItem" ? [i] : []));
  if (list.length) {
    const todo = list.every((i) => blocks[i]!.type === "checkListItem");
    return { card, section, kind: todo ? "todo" : "list", text, items: list.map((i) => ({ block: i, text: texts[i]! })).filter((it) => it.text.trim()) };
  }
  const items = blocks.flatMap((b, i) => (PROSE_TYPES.has(b.type) ? sentencesOf(texts[i]!).map((t, part) => ({ block: i, part, text: t })) : []));
  return { card, section, kind: "text", text, items };
}

/** See module doc. One per canvas; the embedder decides the vectors' id. */
export class SemanticIndex {
  readonly index: ItemIndex;
  private readonly fingerprints = new Map<string, string>();

  constructor(provider: EmbeddingProvider) {
    this.index = new ItemIndex(provider);
  }

  /** Brings the index level with the scene (changed cards re-read, removed ones dropped). Synchronous, no model call. */
  sync(scene: readonly SceneElement[], getDocument: (id: string) => DocumentRecord | null | undefined): { changed: number; removed: number } {
    const labels = labelsByContainer(scene);
    const { frameOf } = sectionsOf(scene);
    const seen = new Set<string>();
    let changed = 0;
    for (const el of scene) {
      if (el.isDeleted || el.type === "frame" || el.type === "text" || el.type === "arrow") continue;
      const content = objectContent(el, labels, getDocument);
      if (!content) continue;
      const items = cardItemsOf(el.id, frameOf.get(el.id) ?? null, content);
      if (!items) continue;
      seen.add(el.id);
      const fp = `${fingerprintOf(content)}|${items.section ?? ""}`;
      if (this.fingerprints.get(el.id) === fp) continue;
      this.index.setCard(items);
      this.fingerprints.set(el.id, fp);
      changed++;
    }
    let removed = 0;
    for (const id of [...this.fingerprints.keys()]) {
      if (seen.has(id)) continue;
      this.index.removeCard(id);
      this.fingerprints.delete(id);
      removed++;
    }
    return { changed, removed };
  }

  /** The canvas's sections (frames), as the descent takes them. */
  sections(scene: readonly SceneElement[]): DescentSection[] {
    return [...sectionsOf(scene).frames.values()].map((f) => ({ id: f.id, name: f.name }));
  }
}
