/**
 * A canvas as a recording stores it (`scene.json`): the scene elements and the block/page documents they show, read in
 * the browser by `e2e/ai/recordGolden.spec.ts` after Accept. Everything that needs the real canvas is derived from it
 * here, offline, so a better adapter re-scores old recordings without a new (paid) run:
 *
 * - the Lens projection (`lensAdapter.ts`, over the product's own `lensTree`);
 * - the update outcome of the reconcile case, from the canvas before and after "Update from new content".
 */
import { z } from "zod";
import type { SceneElement } from "@/domain/canvas/adapter";
import { singleScene, type SceneSource } from "@/domain/lens/lensView";
import { reconciliationOf } from "@/domain/provenance";
import type { DocumentRecord } from "@/domain/types";
import { lensProjectionOfCanvas } from "./lensAdapter";
import type { LensProjection, ReconcileOutcome } from "./schemas";

export const recordedSceneSchema = z.object({
  canvasId: z.string().min(1),
  /** `api.getSceneElements()`: Excalidraw elements, kept as they are. */
  elements: z.array(z.object({ id: z.string(), type: z.string() }).passthrough()),
  /** Document records by id (`store.get(id)`) for every rich block and page preview on the canvas. */
  documents: z.record(z.string(), z.unknown()),
});
export type RecordedScene = z.infer<typeof recordedSceneSchema>;

export function sceneSourceOf(scene: RecordedScene): SceneSource {
  const docs = scene.documents as Record<string, DocumentRecord | null>;
  return singleScene(scene.canvasId, scene.elements as unknown as SceneElement[], (id) => docs[id]);
}

export function lensProjectionOfScene(scene: RecordedScene): LensProjection {
  return lensProjectionOfCanvas(sceneSourceOf(scene), scene.canvasId);
}

// ---------------------------------------------------------------- reconcile outcome

const SKIP_KEYS = new Set(["id", "type", "textColor", "backgroundColor", "textAlignment", "level", "styles", "language", "props"]);

/** Every string of a block document's content (the way `e2e/ai/fidelity.spec.ts` reads canvas text). */
function deepText(value: unknown, out: string[], key = ""): void {
  if (typeof value === "string") {
    if (!SKIP_KEYS.has(key)) out.push(value);
  } else if (Array.isArray(value)) value.forEach((x) => deepText(x, out, key));
  else if (value && typeof value === "object") for (const [k, x] of Object.entries(value)) if (!SKIP_KEYS.has(k)) deepText(x, out, k);
}

/** What an object says: its document (title and content) for blocks and pages, its bound label for shapes. */
export function objectText(el: SceneElement, labels: ReadonlyMap<string, string>, docs: Record<string, DocumentRecord | null>): string {
  const ref = el.customData?.acute as { documentId?: string; pageId?: string } | undefined;
  const docId = ref?.documentId ?? ref?.pageId;
  if (docId) {
    const doc = docs[docId];
    const out: string[] = doc?.title ? [doc.title] : [];
    deepText(doc?.snapshot, out);
    return out.join(" ").replace(/\s+/g, " ").trim();
  }
  return (labels.get(el.id) ?? el.text ?? "").replace(/\s+/g, " ").trim();
}

/** Stable node key → text, for every AI object linked to a content source (`reconciliationOf`). */
function linkedObjects(scene: RecordedScene): Map<string, string> {
  const elements = (scene.elements as unknown as SceneElement[]).filter((e) => !e.isDeleted);
  const docs = scene.documents as Record<string, DocumentRecord | null>;
  const labels = new Map<string, string>();
  for (const e of elements) if (e.type === "text" && e.containerId) labels.set(e.containerId, (e.originalText ?? e.text ?? "").trim());
  const out = new Map<string, string>();
  for (const e of elements) {
    if (e.type === "text" && e.containerId) continue;
    const link = reconciliationOf(e, (id) => docs[id]);
    if (!link) continue;
    const t = objectText(e, labels, docs);
    out.set(link.stableNodeKey, out.has(link.stableNodeKey) ? `${out.get(link.stableNodeKey)} ${t}` : t);
  }
  return out;
}

/**
 * The normalised update outcome (schemas.ts `reconcileOutcomeSchema`) from the canvas before an update (with the user's
 * edit applied) and after its Accept: per stable node key, `add` (new), `remove` (gone), `unchanged` (same text) or
 * `update_clean` (new text). A conflict left undecided keeps the user's text, so it reads as `unchanged`; `review`
 * and `update_conflict` can't be told apart from the canvas alone (the assertions needing them are `future`).
 */
export function reconcileOutcomeFromScenes(before: RecordedScene, after: RecordedScene): ReconcileOutcome {
  const a = linkedObjects(before);
  const b = linkedObjects(after);
  const items: ReconcileOutcome["items"] = [];
  for (const [key, text] of b) items.push({ key, text, state: !a.has(key) ? "add" : a.get(key) === text ? "unchanged" : "update_clean" });
  for (const [key, text] of a) if (!b.has(key)) items.push({ key, text, state: "remove" });
  return { items };
}
