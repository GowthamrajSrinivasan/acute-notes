/**
 * The canvas objects made under the distil note model (knowledge-notes-plan §4.1, §6.2), as the Source tab, the source
 * chips and the review queue need them: their source version, the units they cite and their review. The one module of
 * the review UI that reads those reconciliation fields (`reconciliationOf`); everything else is given what it returns.
 *
 * Objects made under `preserve` (or before Knowledge Notes) are never returned: preserve canvases look exactly as
 * they did, with no chip, no Source tab and no queue item.
 */
import type { CardReview, UnitId } from "@/ai/fidelity/contracts";
import type { SceneElement } from "@/domain/canvas/adapter";
import { getEmbedRef } from "@/domain/canvas/adapter";
import { toPlainText } from "@/domain/content/richContent";
import { reconciliationOf } from "@/domain/provenance";
import { fingerprintOf, labelsByContainer, objectContent } from "@/ai/reconcile/objects";
import type { DocumentRecord } from "@/domain/types";

export interface KnowledgeObject {
  objectId: string;
  sourceId: string;
  /** The source version the object was made from (`contentSourceVersion`). */
  version: number;
  stableNodeKey: string;
  /** The units it cites (empty for a section title or a card that cites nothing). */
  cites: UnitId[];
  review?: CardReview;
  box: { x: number; y: number; width: number; height: number };
  frameId?: string;
  /** "block" for a rich block or page preview (its text can carry a pinned quote), "shape" otherwise. */
  shape: "block" | "shape";
}

type GetDocument = (id: string) => DocumentRecord | null | undefined;

/** Every live distil object of the scene (labels and connectors are never objects). */
export function knowledgeObjectsOf(elements: readonly SceneElement[], getDocument: GetDocument): KnowledgeObject[] {
  const out: KnowledgeObject[] = [];
  for (const el of elements) {
    if (el.isDeleted || el.type === "arrow" || (el.type === "text" && el.containerId)) continue;
    const link = reconciliationOf(el, getDocument);
    if (!link || link.noteModel !== "distil") continue;
    const ref = getEmbedRef(el);
    out.push({
      objectId: el.id,
      sourceId: link.contentSourceId,
      version: link.contentSourceVersion,
      stableNodeKey: link.stableNodeKey,
      cites: [...(link.sourceUnits ?? [])],
      ...(link.review ? { review: link.review } : {}),
      box: { x: el.x, y: el.y, width: el.width, height: el.height },
      ...(el.frameId ? { frameId: el.frameId } : {}),
      shape: ref?.kind === "rich-block" || ref?.kind === "page-preview" ? "block" : "shape",
    });
  }
  return out;
}

/** The distil object behind one element, or null (a preserve object, a manual one, a label). */
export function knowledgeObjectOf(elements: readonly SceneElement[], elementId: string, getDocument: GetDocument): KnowledgeObject | null {
  const el = elements.find((e) => e.id === elementId);
  return el ? (knowledgeObjectsOf([el], getDocument)[0] ?? null) : null;
}

/** A card's title and body as the review queue shows them. */
export function cardTextOf(elements: readonly SceneElement[], elementId: string, getDocument: GetDocument): { title: string; body: string } {
  const el = elements.find((e) => e.id === elementId);
  if (!el) return { title: "", body: "" };
  const ref = getEmbedRef(el);
  const docId = ref?.kind === "rich-block" ? ref.documentId : ref?.kind === "page-preview" ? ref.pageId : null;
  if (docId) {
    const rec = getDocument(docId);
    const body = rec ? toPlainText(rec.snapshot).trim() : "";
    const title = rec?.title && rec.title !== "Untitled" ? rec.title : (body.split("\n")[0] ?? "");
    return { title, body: body.startsWith(title) ? body.slice(title.length).trim() : body };
  }
  const label = elements.find((e) => e.type === "text" && e.containerId === el.id) as (SceneElement & { text?: string }) | undefined;
  return { title: label?.text?.trim() ?? "", body: "" };
}

/** Whether the user changed the object's content since AI last wrote it (its fingerprint no longer matches the baseline). */
export function isEditedSinceAI(elements: readonly SceneElement[], elementId: string, getDocument: GetDocument): boolean {
  const el = elements.find((e) => e.id === elementId);
  const link = el ? reconciliationOf(el, getDocument) : undefined;
  if (!el || !link) return false;
  const content = objectContent(el, labelsByContainer(elements), getDocument);
  return !!content && fingerprintOf(content) !== link.contentFingerprint;
}
