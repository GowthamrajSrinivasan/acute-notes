/**
 * Copies a rich document (record + Yjs content) to a new id, with new block ids. Used when a
 * canvas block or page preview is duplicated or pasted, so the copy is
 * independent content rather than a second view of the same document.
 */
import { newId, type IdPrefix } from "@/domain/ids";
import type { DocumentRecord } from "@/domain/types";
import type { PersistenceServices } from "@/persistence";
import { copyWithNewBlockIds } from "@/sync/blockIds";
import { documentRegistry } from "@/sync/documentRegistry";
import type { DocumentStore } from "./documentStore";

const pending = new Map<string, Promise<void>>();

export function richDocKey(documentId: string): string {
  return `doc/${documentId}`;
}

/** Resolves once any in-flight clone or maintenance of `documentId` has been written. */
export function awaitPendingClone(documentId: string): Promise<void> {
  return pending.get(documentId) ?? Promise.resolve();
}

/** Registers background work on a stored document that editors must wait for. */
export function trackPendingDocWork(documentId: string, work: Promise<unknown>): void {
  const previous = pending.get(documentId) ?? Promise.resolve();
  const task = previous.then(() => work).then(
    () => undefined,
    (err: unknown) => console.error(`[acute-notes] Document work failed for ${documentId}`, err),
  );
  pending.set(documentId, task);
  void task.finally(() => {
    if (pending.get(documentId) === task) pending.delete(documentId);
  });
}

type CloneOverrides = Partial<Pick<DocumentRecord, "workspaceId" | "canvasId">>;

/**
 * Starts cloning `sourceId` and returns the new document id immediately; the
 * copy is written in the background (editors wait via `awaitPendingClone`).
 * The copy is independent content: its blocks get new ids (see
 * `sync/blockIds`), so no block is ever shared by two documents. `overrides`
 * re-home the copy (the workspace/canvas it is pasted into).
 */
export function cloneDocument(
  sourceId: string,
  store: DocumentStore,
  services: Pick<PersistenceServices, "yupdates">,
  prefix: IdPrefix = "doc",
  overrides: CloneOverrides = {},
): string {
  const targetId = newId(prefix);
  const task = (async () => {
    // An open editor may still hold unwritten edits of the source.
    await documentRegistry.peek(richDocKey(sourceId))?.then((p) => p.flush(), () => undefined);
    await awaitPendingClone(sourceId);
    await store.load(sourceId);
    const source = store.get(sourceId);
    const { updates } = await services.yupdates.load(richDocKey(sourceId));
    const copy = copyWithNewBlockIds(updates, source?.snapshot ?? []);
    if (copy.update) await services.yupdates.append(richDocKey(targetId), copy.update);
    if (source) {
      const now = Date.now();
      await store.put({ ...source, ...overrides, id: targetId, snapshot: copy.snapshot, createdAt: now, updatedAt: now });
    }
  })()
    .catch((err: unknown) => console.error(`[acute-notes] Failed to clone document ${sourceId}`, err))
    .finally(() => pending.delete(targetId));
  pending.set(targetId, task);
  return targetId;
}

/**
 * Storage-only clone (no caches or open editors), for repairs and imports.
 * Same guarantees as `cloneDocument`. Returns the new id, or null when the
 * source does not exist.
 */
export async function cloneStoredDocument(
  services: Pick<PersistenceServices, "documents" | "yupdates">,
  sourceId: string,
  overrides: CloneOverrides = {},
): Promise<string | null> {
  const source = await services.documents.get(sourceId);
  if (!source) return null;
  const targetId = newId(source.kind === "page" ? "page" : "doc");
  const { updates } = await services.yupdates.load(richDocKey(sourceId));
  const copy = copyWithNewBlockIds(updates, source.snapshot);
  if (copy.update) await services.yupdates.append(richDocKey(targetId), copy.update);
  const now = Date.now();
  await services.documents.put({ ...source, ...overrides, id: targetId, snapshot: copy.snapshot, createdAt: now, updatedAt: now });
  return targetId;
}
