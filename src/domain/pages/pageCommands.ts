/**
 * Page domain commands (F09/F16). Every page — created from the canvas block
 * menu, the page sidebar or, later, AI/MCP/import — goes through these.
 *
 * A page is a `DocumentRecord` of kind "page" (PageId === DocumentId). Its
 * editable content is a Y.Doc keyed like any rich document; the record holds
 * the title and a preview snapshot.
 */
import { newId } from "@/domain/ids";
import type { ObjectMetadata, PageDocument, RichContent } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { richDocKey } from "@/state/documentClone";
import { getDocumentStore } from "@/state/documents";
import { pagePanel } from "@/state/pagePanel";
import { newBlockId } from "@/sync/blockIds";
import { documentRegistry } from "@/sync/documentRegistry";

export interface CreatePageOptions {
  title?: string;
  content?: RichContent;
  /** Document metadata (defaults to user provenance); AI-created pages (F30) pass their `metadata.ai`. */
  metadata?: ObjectMetadata;
}

/** Creates a page in a canvas and returns its id. The record is cached synchronously. */
export function createPage(workspaceId: string, canvasId: string, options: CreatePageOptions = {}): string {
  const id = newId("page");
  const now = Date.now();
  const page: PageDocument = {
    id,
    workspaceId,
    canvasId,
    kind: "page",
    title: options.title ?? "",
    // A first block with its own id: an empty document would get BlockNote's shared default id.
    snapshot: options.content ?? [{ id: newBlockId(), type: "paragraph" }],
    createdAt: now,
    updatedAt: now,
    metadata: options.metadata ?? { ai: { createdBy: "user" } },
  };
  void getDocumentStore().put(page);
  return id;
}

export function renamePage(pageId: string, title: string): void {
  getDocumentStore().update(pageId, { title });
}

/**
 * Deletes a page and its content. Canvas previews that still reference it
 * show it as deleted (they are canvas objects and stay undoable).
 */
export async function deletePage(pageId: string): Promise<void> {
  if (pagePanel.get().pageId === pageId) pagePanel.close();
  // Let the panel's editor unmount (it writes its last snapshot) and its
  // pending Yjs updates land before the log is cleared.
  await new Promise((r) => setTimeout(r, 0));
  await documentRegistry.peek(richDocKey(pageId))?.then((p) => p.flush(), () => undefined);
  await getDocumentStore().delete(pageId);
  await getPersistence().yupdates.clear(richDocKey(pageId));
}
