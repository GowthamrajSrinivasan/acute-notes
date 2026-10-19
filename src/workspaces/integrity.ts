/**
 * Document identity and ownership invariants, enforced in storage:
 *
 * 1. Every document id is unique on the device (random, prefixed ids).
 * 2. Every block and page belongs to exactly one canvas: its record carries
 *    the canvas's `workspaceId` and `canvasId`.
 * 3. A document is shown by at most one canvas element. Duplicating or
 *    pasting creates a copy (`cloneDocument`), so editing one never edits
 *    another.
 * 4. Block ids inside a document are unique to that document (copies get
 *    fresh block ids, see `sync/blockIds`).
 *
 * New content keeps these by construction. `ensureDocumentIntegrity` repairs
 * data written before they existed (or by an older import): a document that
 * is referenced twice, or by a canvas that doesn't own it, is copied for
 * that reference, and unowned documents are assigned to the canvas showing
 * them. It runs before a canvas opens.
 */
import * as Y from "yjs";
import { canvasDocId } from "@/sync/docIds";
import { blockLink, getEmbedRef, pageLink, type AcuteEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, Workspace } from "@/domain/types";
import type { PersistenceServices } from "@/persistence/repositories/types";
import { cloneStoredDocument } from "@/state/documentClone";

/** Bump to re-run the full-workspace check everywhere (e.g. after a new rule). */
const INTEGRITY_VERSION = 1;
const checkedKey = (workspaceId: string) => `integrity/${workspaceId}`;

export interface IntegrityReport {
  /** References that got their own copy of a shared or foreign document. */
  copied: number;
  /** Documents whose owning canvas was set or corrected. */
  assigned: number;
  /** Ids of documents written (copies and reassigned records), for caches. */
  changed: string[];
  /**
   * Current records of the documents shown on the opened canvas (after
   * repairs), read in one batch — callers can seed caches with them instead
   * of reading each document again.
   */
  documents: DocumentRecord[];
}

/** Forces the next open of the workspace to check every canvas (e.g. after an import). */
export function markIntegrityUnchecked(services: PersistenceServices, workspaceId: string): Promise<void> {
  return services.meta.set(checkedKey(workspaceId), 0);
}

type EmbedElement = SceneElement & { version: number; isDeleted?: boolean; link?: string | null };

/** The document an embed shows. */
export const refId = (ref: AcuteEmbedRef) => (ref.kind === "rich-block" ? ref.documentId : ref.pageId);

/** The element pointing at another document, as a new element version. */
export function retarget<E extends { version: number; customData?: Record<string, unknown> }>(el: E, ref: AcuteEmbedRef, id: string): E {
  const acute = ref.kind === "rich-block" ? { documentId: id } : { pageId: id };
  return {
    ...el,
    link: ref.kind === "rich-block" ? blockLink(id) : pageLink(id),
    customData: { ...el.customData, acute: { ...(el.customData?.acute as object), ...acute } },
    version: el.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  } as E;
}

/**
 * Checks `canvasId` (and, the first time a workspace is opened with this
 * version, every canvas of it), then assigns pages without a canvas to
 * the workspace's first canvas.
 */
export async function ensureDocumentIntegrity(
  services: PersistenceServices,
  workspace: Workspace,
  canvasId: string,
): Promise<IntegrityReport> {
  const full = (await services.meta.get<number>(checkedKey(workspace.id))) !== INTEGRITY_VERSION;
  const report = await checkCanvases(services, workspace, full ? workspace.canvasIds : [canvasId], canvasId);
  const pages = await assignUnownedPages(services, workspace);
  report.assigned += pages.length;
  report.changed.push(...pages);
  if (full) await services.meta.set(checkedKey(workspace.id), INTEGRITY_VERSION);
  return report;
}

async function checkCanvases(
  services: PersistenceServices,
  workspace: Workspace,
  canvasIds: readonly string[],
  openedCanvasId: string,
): Promise<IntegrityReport> {
  const canvases = new Set(workspace.canvasIds);
  /** Document id → the canvas whose element claimed it first. */
  const claimed = new Map<string, string>();
  const report: IntegrityReport = { copied: 0, assigned: 0, changed: [], documents: [] };

  for (const canvasId of canvasIds) {
    const doc = new Y.Doc();
    try {
      const key = canvasDocId(canvasId);
      const { updates } = await services.yupdates.load(key);
      Y.transact(doc, () => updates.forEach((u) => Y.applyUpdate(doc, u)));
      const before = Y.encodeStateVector(doc);
      const elements = doc.getMap<EmbedElement>("elements");
      const fixes: EmbedElement[] = [];

      const embeds: { el: EmbedElement; ref: AcuteEmbedRef }[] = [];
      for (const el of [...elements.values()].sort((a, b) => a.id.localeCompare(b.id))) {
        if (el.isDeleted || el.type !== "embeddable") continue;
        const ref = getEmbedRef(el);
        if (ref) embeds.push({ el, ref });
      }
      // One read for every referenced document (not one round trip each).
      const ids = [...new Set(embeds.map((e) => refId(e.ref)))];
      const records = new Map<string, DocumentRecord | null>();
      (await services.documents.getMany(ids)).forEach((rec, i) => records.set(ids[i]!, rec));
      /** Records shown on this canvas once repaired (for `report.documents`). */
      const shown = new Map<string, DocumentRecord>();

      for (const { el, ref } of embeds) {
        const id = refId(ref);
        const rec = records.get(id) ?? null;
        // Missing documents render as deleted; a kind mismatch is not ours to guess.
        if (!rec || (rec.kind === "page") !== (ref.kind === "page-preview")) continue;

        const ownedElsewhere = !!rec.canvasId && rec.canvasId !== canvasId && canvases.has(rec.canvasId);
        if (claimed.has(id) || rec.workspaceId !== workspace.id || ownedElsewhere) {
          const copy = await cloneStoredDocument(services, id, { workspaceId: workspace.id, canvasId: canvasId });
          if (!copy) continue;
          claimed.set(copy, canvasId);
          const copied = await services.documents.get(copy);
          if (copied) shown.set(copy, copied);
          fixes.push(retarget(el, ref, copy));
          report.copied++;
          report.changed.push(copy);
        } else {
          claimed.set(id, canvasId);
          let current = rec;
          if (rec.canvasId !== canvasId) {
            current = { ...rec, canvasId: canvasId };
            await services.documents.put(current);
            records.set(id, current);
            report.assigned++;
            report.changed.push(id);
          }
          shown.set(id, current);
        }
      }
      if (canvasId === openedCanvasId) report.documents = [...shown.values()];

      if (fixes.length) {
        doc.transact(() => {
          for (const el of fixes) elements.set(el.id, el);
        });
        await services.yupdates.append(key, Y.encodeStateAsUpdate(doc, before));
      }
    } finally {
      doc.destroy();
    }
  }
  return report;
}

/** Pages placed on no canvas and owned by no (current) canvas join the first canvas. */
async function assignUnownedPages(services: PersistenceServices, workspace: Workspace): Promise<string[]> {
  const owner = workspace.canvasIds[0];
  if (!owner) return [];
  const canvases = new Set(workspace.canvasIds);
  const pages: DocumentRecord[] = await services.documents.listByWorkspace(workspace.id, "page");
  const unowned = pages.filter((p) => !p.canvasId || !canvases.has(p.canvasId));
  for (const page of unowned) await services.documents.put({ ...page, canvasId: owner });
  return unowned.map((p) => p.id);
}
