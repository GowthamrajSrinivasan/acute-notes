/**
 * Deleting a page's last preview from the canvas deletes the page too, after
 * the user confirms. The guard runs ahead of Excalidraw's own delete (the
 * Delete/Backspace keys, the context menu's Delete and the trash button):
 * Cancel stops the delete entirely; OK lets Excalidraw delete the elements as
 * usual, then deletes the pages whose previews are all gone.
 *
 * Only a user's delete asks. Cut (the preview may be pasted back), undo, AI
 * change sets and clearing the canvas leave pages alone.
 */
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getEmbedRef } from "@/domain/canvas/adapter";
import { UNTITLED_PAGE } from "@/domain/content/richContent";
import { deletePage } from "@/domain/pages/pageCommands";
import type { DocumentRecord } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";

type SceneEl = Pick<ExcalidrawElement, "id" | "type" | "isDeleted" | "frameId" | "customData">;

function previewPageId(el: SceneEl): string | null {
  if (el.type !== "embeddable" || el.isDeleted) return null;
  const ref = getEmbedRef(el);
  return ref?.kind === "page-preview" ? ref.pageId : null;
}

/**
 * Pages of `canvasId` whose every live preview is among the selected elements
 * (a selected frame deletes its children too). Previews of the same page left
 * elsewhere on the canvas keep it.
 */
export function orphanedPages(
  elements: readonly SceneEl[],
  selectedIds: Readonly<Record<string, boolean>>,
  canvasId: string,
  getRecord: (id: string) => DocumentRecord | null | undefined,
): DocumentRecord[] {
  const doomed = (el: SceneEl) => !!selectedIds[el.id] || (!!el.frameId && !!selectedIds[el.frameId]);
  const deleted = new Set<string>();
  const kept = new Set<string>();
  for (const el of elements) {
    const pageId = previewPageId(el);
    if (pageId) (doomed(el) ? deleted : kept).add(pageId);
  }
  const pages: DocumentRecord[] = [];
  for (const pageId of deleted) {
    if (kept.has(pageId)) continue;
    const page = getRecord(pageId);
    if (page?.kind === "page" && (page.canvasId ?? canvasId) === canvasId) pages.push(page);
  }
  return pages;
}

export function confirmMessage(pages: readonly DocumentRecord[]): string {
  const name = (p: DocumentRecord) => `"${p.title.trim() || UNTITLED_PAGE}"`;
  const subject = pages.length === 1 ? `the page ${name(pages[0]!)}` : `${pages.length} pages (${pages.map(name).join(", ")})`;
  return `Delete ${subject}? The page content is deleted permanently; undo brings back only the canvas preview.`;
}

/**
 * Call just before a user's delete runs. Returns false when the user cancels
 * (the caller must stop the delete); true when the delete may proceed.
 */
export function guardPageDeletion(api: ExcalidrawImperativeAPI, canvasId: string): boolean {
  const store = getDocumentStore();
  const pages = orphanedPages(api.getSceneElements(), api.getAppState().selectedElementIds, canvasId, (id) => store.get(id));
  if (!pages.length) return true;
  if (!window.confirm(confirmMessage(pages))) return false;
  // After Excalidraw has applied the delete: only pages it actually left without a preview.
  setTimeout(() => {
    const live = new Set(api.getSceneElements().map(previewPageId));
    for (const page of pages) if (!live.has(page.id)) void deletePage(page.id);
  }, 0);
  return true;
}

/** Excalidraw's delete buttons: the context-menu item and the trash button (desktop panel and mobile toolbar). */
const DELETE_BUTTONS = '.excalidraw [data-testid="deleteSelectedElements"], .excalidraw button.ToolIcon_type_button[aria-label="Delete"]';

/** Guards clicks on Excalidraw's delete buttons; returns the uninstaller. (Keys go through the shortcut registry.) */
export function installPageDeletionGuard(api: ExcalidrawImperativeAPI, canvasId: string): () => void {
  const onClick = (e: MouseEvent) => {
    if (!(e.target instanceof Element) || !e.target.closest(DELETE_BUTTONS)) return;
    if (guardPageDeletion(api, canvasId)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener("click", onClick, true);
  return () => document.removeEventListener("click", onClick, true);
}
