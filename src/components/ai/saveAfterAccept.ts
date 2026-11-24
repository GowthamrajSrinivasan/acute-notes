/**
 * Saving what an Accept wrote at once (#34, intelligent-update-engine-plan §19.5). Card text is written after a 400 ms
 * delay (`documentStore`), the scene after 120 ms plus its document buffer, and the tab-close flush only starts those
 * writes: a reload within about a second of an Accept kept the source's new version but lost the cards it describes
 * (and any edit still waiting). An Accept is a deliberate commit, so its writes start now, in the Accept's own task and
 * before the content version is recorded. The version is not held back until they finish: the card chips and the
 * Source tab read it as soon as Accept returns. If a reload still lands in the few milliseconds both are in flight and
 * only the version survives, an AI-worded card behind it is offered again by the next update (`classify.ts` rule 2).
 */
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import { getDocumentStore } from "@/state/documents";
import { documentRegistry } from "@/sync/documentRegistry";

/** The stores an Accept writes to, each saved by its own flush. */
export interface Savers {
  /** The open canvas's scene (null when no canvas is open). */
  canvas(): Promise<void> | null | undefined;
  /** Card and page records. */
  documents(): Promise<void>;
  /** Open rich documents (pages). */
  open(): Promise<void>;
}

const live: Savers = {
  canvas: () => getCanvasCommands()?.flush(),
  documents: () => getDocumentStore().flush(),
  open: () => documentRegistry.flushAll(),
};

/**
 * Starts writing every store now — each flush is called before this returns — and resolves once they are done. Never
 * rejects: a failed write is logged and kept by its store for its next flush.
 */
export function saveNow(savers: Savers = live): Promise<void> {
  const run = (save: () => Promise<void> | null | undefined) => {
    try {
      return Promise.resolve(save());
    } catch (err) {
      return Promise.reject(err);
    }
  };
  return Promise.allSettled([run(savers.canvas), run(savers.documents), run(savers.open)]).then((results) => {
    for (const r of results) if (r.status === "rejected") console.error("[acute-notes] Saving after Accept failed; the next save retries it", r.reason);
  });
}
