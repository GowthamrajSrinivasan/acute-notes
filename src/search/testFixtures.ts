/** Scene and document builders shared by the F22 search and context tests (test-only). */
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichBlockType, RichContent } from "@/domain/types";

export function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    locked: false,
    opacity: 100,
    isDeleted: false,
    groupIds: [],
    strokeColor: "#000",
    backgroundColor: "transparent",
    strokeWidth: 1,
    strokeStyle: "solid",
    ...partial,
  };
}

export const block = (id: string, documentId: string, extra: Partial<SceneElement> = {}, blockType: RichBlockType = "text") =>
  el({ id, type: "embeddable", customData: { acute: { kind: "rich-block", blockType, documentId } }, ...extra });
export const pagePreview = (id: string, pageId: string, extra: Partial<SceneElement> = {}) =>
  el({ id, type: "embeddable", customData: { acute: { kind: "page-preview", pageId, preview: false } }, ...extra });
export const note = (id: string, text: string, extra: Partial<SceneElement> = {}) => el({ id, type: "text", text, originalText: text, ...extra });
export const shape = (id: string, extra: Partial<SceneElement> = {}) => el({ id, type: "rectangle", ...extra });
export const label = (id: string, containerId: string, text: string) => el({ id, type: "text", text, originalText: text, containerId });
export const arrow = (id: string, from: string, to: string, relation?: string, extra: Partial<SceneElement> = {}) =>
  el({ id, type: "arrow", startBinding: { elementId: from }, endBinding: { elementId: to }, customData: relation ? { acuteRelation: relation } : {}, ...extra });

export const para = (text: string): RichContent => [{ type: "paragraph", content: text }];

export function doc(id: string, content: RichContent, extra: Partial<DocumentRecord> = {}): DocumentRecord {
  return { id, workspaceId: "ws", canvasId: "cv", kind: "block", title: "Untitled", snapshot: content, createdAt: 0, updatedAt: 0, ...extra };
}

export const pageDoc = (id: string, title: string, content: RichContent, extra: Partial<DocumentRecord> = {}) => doc(id, content, { kind: "page", title, ...extra });

export function lookup(docs: readonly DocumentRecord[]) {
  const byId = new Map(docs.map((d) => [d.id, d] as const));
  return (id: string) => byId.get(id);
}
