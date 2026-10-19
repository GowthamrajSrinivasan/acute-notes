/**
 * After Accept: which of the objects a change set just added are dense
 * (`assessDensity`), pointed out on the canvas (`denseBlocks`) in reading
 * order — top to bottom, then left to right. Only rich blocks are judged;
 * pages, shapes, frames and connectors never are.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { assessDensity } from "@/ai/density/density";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";
import { denseBlocks, type DenseEntry } from "./denseBlocksStore";

type GetDocument = (id: string) => DocumentRecord | null | undefined;

/** The dense blocks among `elementIds`, in reading order. */
export function denseEntries(elements: readonly SceneElement[], elementIds: Iterable<string>, getDocument: GetDocument): DenseEntry[] {
  const ids = new Set(elementIds);
  const found = elements.flatMap((el) => {
    if (el.isDeleted || el.type !== "embeddable" || !ids.has(el.id)) return [];
    const ref = getEmbedRef(el);
    if (ref?.kind !== "rich-block") return [];
    const rec = getDocument(ref.documentId);
    const finding = rec ? assessDensity(ref.blockType, rec.snapshot) : null;
    return finding ? [{ id: el.id, reason: finding.reason, cause: finding.cause, x: el.x, y: el.y }] : [];
  });
  found.sort((a, b) => a.y - b.y || a.x - b.x);
  return found.map(({ id, reason, cause }) => ({ id, reason, cause }));
}

/** Points out the dense blocks among the objects just added; returns how many there are. */
export function flagDenseBlocks(api: ExcalidrawImperativeAPI, canvasId: string, elementIds: Iterable<string>): number {
  const entries = denseEntries(api.getSceneElements() as unknown as readonly SceneElement[], elementIds, (id) => getDocumentStore().get(id));
  denseBlocks.add(canvasId, entries);
  return entries.length;
}
