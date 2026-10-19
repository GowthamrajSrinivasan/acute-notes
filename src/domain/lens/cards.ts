/**
 * Map cards as Lens nodes (plan §9 Phase 2): a Repo Map section's cards are mostly rich blocks (text, table, todo,
 * code) and page previews, not shapes, so `frameGraph` alone wouldn't see them. A **card** is a bordered rich block or a
 * page preview inside the frame; frameless text (a section's title, a free note) isn't a node. Its label is the card's
 * title — a heading, else its first line — and its kind, when the agent gave one, rides in its `acuteNode` like a
 * shape's. Pure: elements and a document lookup in.
 */
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { getNodeSemantics, type DiagramNode } from "@/domain/canvas/diagram";
import { deriveTitle } from "@/domain/content/richContent";
import type { DocumentRecord } from "@/domain/types";

const BLOCK_NAMES: Record<string, string> = { text: "Note", todo: "Todo list", table: "Table", code: "Code" };

/** Whether an element is a card (a node Lens shows) rather than frameless text or anything else. */
export function isCard(el: Pick<SceneElement, "isDeleted" | "type" | "customData">): boolean {
  if (el.isDeleted || el.type !== "embeddable") return false;
  const ref = getEmbedRef(el);
  return ref?.kind === "page-preview" || (ref?.kind === "rich-block" && ref.style.frame !== "none");
}

/** A card's title: its page's title, else its block's heading or first line. */
export function cardLabel(el: Pick<SceneElement, "customData">, getDocument: (id: string) => DocumentRecord | null | undefined): string {
  const ref = getEmbedRef(el);
  if (!ref) return "Untitled";
  if (ref.kind === "page-preview") return getDocument(ref.pageId)?.title.trim() || "Untitled page";
  const doc = getDocument(ref.documentId);
  return doc ? deriveTitle(doc.snapshot, BLOCK_NAMES[ref.blockType] ?? "Block") : (BLOCK_NAMES[ref.blockType] ?? "Block");
}

/** The cards inside `frameId`, as diagram nodes (scene order). */
export function frameCards(elements: readonly SceneElement[], frameId: string, getDocument: (id: string) => DocumentRecord | null | undefined = () => undefined): DiagramNode[] {
  return elements
    .filter((el) => el.frameId === frameId && isCard(el))
    .map((el) => ({ id: el.id, label: cardLabel(el, getDocument), semantics: getNodeSemantics(el) ?? {}, box: { x: el.x, y: el.y, width: el.width, height: el.height } }));
}
