/**
 * An existing canvas object's current content and fingerprint (F37/F38), read
 * from the structural scene (`SceneElement`) and the document cache — no
 * renderer import. The same canonicalisation as the writer's baseline
 * (`ai/content/fingerprint.ts`), so an untouched object always matches it.
 */
import { fingerprintContent, fingerprintShape } from "@/ai/content/fingerprint";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { shapeKindOf } from "@/domain/canvas/compositeShapes";
import type { DocumentRecord, RichContent } from "@/domain/types";

export type ObjectContent =
  | { kind: "block"; documentId: string; content: RichContent }
  | { kind: "page"; documentId: string; content: RichContent; title: string }
  | { kind: "shape"; shape: string; label: string };

/** Bound label text by container id. */
export function labelsByContainer(elements: readonly SceneElement[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const el of elements) {
    if (!el.isDeleted && el.type === "text" && el.containerId) labels.set(el.containerId, el.originalText ?? el.text ?? "");
  }
  return labels;
}

/** Content of a block, page preview or shape; null for anything else, or a document not loaded yet. */
export function objectContent(el: SceneElement, labels: ReadonlyMap<string, string>, getDocument: (id: string) => DocumentRecord | null | undefined): ObjectContent | null {
  const ref = getEmbedRef(el);
  if (ref?.kind === "rich-block") {
    const rec = getDocument(ref.documentId);
    return rec ? { kind: "block", documentId: ref.documentId, content: rec.snapshot } : null;
  }
  if (ref?.kind === "page-preview") {
    const rec = getDocument(ref.pageId);
    return rec ? { kind: "page", documentId: ref.pageId, content: rec.snapshot, title: rec.title } : null;
  }
  const shape = shapeKindOf(el);
  if (shape) return { kind: "shape", shape, label: labels.get(el.id) ?? "" };
  return null;
}

export function fingerprintOf(content: ObjectContent): string {
  if (content.kind === "shape") return fingerprintShape(content.shape, content.label);
  return fingerprintContent(content.content, content.kind === "page" ? content.title : undefined);
}
