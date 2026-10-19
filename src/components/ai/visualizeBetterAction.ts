/**
 * The walk-through's "Visualize better" (F42 Phase 4.2) and "Split locally"
 * (4.4) on the live canvas: reads the dense block's content and link, splits
 * it (with the model, or deterministically), and puts the result up for
 * review. Nothing is written until the user accepts it.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { splitLocally } from "@/ai/density/splitLocally";
import { NOTHING_TO_SPLIT_LOCALLY, NothingToSplitError, proposeSplit, visualizeBetter, type SplitTarget } from "@/ai/density/visualizeBetter";
import { splitLinkOf } from "@/ai/reconcile/split";
import { AIRuntime } from "@/ai/runtime";
import { gatherRenderContext } from "@/components/canvas/renderPlanContext";
import { getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { inlineText } from "@/domain/content/richContent";
import { contentToMarkdown } from "@/domain/content/markdown";
import { newId } from "@/domain/ids";
import type { DocumentRecord } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";

/** The block is gone, or isn't a block with content any more. */
export class BlockUnavailableError extends Error {
  override name = "BlockUnavailableError";
  constructor() {
    super("This block isn't on the canvas any more.");
  }
}

/** A block's name: its own title, else its first heading, else "Details" (a table's header row is never a name). */
function blockLabel(rec: DocumentRecord): string {
  const title = rec.title.trim();
  if (title && title !== "Untitled") return title.slice(0, 120);
  const heading = rec.snapshot.find((b) => b.type === "heading" && inlineText(b.content).trim());
  return heading ? inlineText(heading.content).trim().slice(0, 120) : "Details";
}

/** The block behind `elementId` and what a split of it replaces. */
function splitTargetOf(api: ExcalidrawImperativeAPI, elementId: string): { rec: DocumentRecord; target: SplitTarget } {
  const el = api.getSceneElements().find((e) => e.id === elementId) as unknown as SceneElement | undefined;
  const ref = el ? getEmbedRef(el) : null;
  const getDocument = (id: string) => getDocumentStore().get(id);
  const rec = ref?.kind === "rich-block" ? getDocument(ref.documentId) : null;
  if (!el || !rec) throw new BlockUnavailableError();
  return {
    rec,
    target: {
      label: blockLabel(rec),
      target: el.id,
      box: { x: el.x, y: el.y, width: el.width, height: el.height },
      split: splitLinkOf(el, getDocument),
      operationId: newId("op"),
      context: gatherRenderContext(api),
      frameCount: api.getSceneElements().filter((e) => e.type === "frame").length,
    },
  };
}

export async function proposeVisualizeBetter(api: ExcalidrawImperativeAPI, canvasId: string, elementId: string, reason: string, signal: AbortSignal): Promise<void> {
  const { rec, target } = splitTargetOf(api, elementId);
  const { changeSet } = await visualizeBetter({ ...target, text: contentToMarkdown(rec.snapshot).trim(), reason }, AIRuntime, { signal });
  if (signal.aborted) return;
  getPendingChanges().propose(canvasId, changeSet);
}

/** "Split locally": the block's table rows (or long checklist items) as cards, with no model call. */
export async function proposeSplitLocally(api: ExcalidrawImperativeAPI, canvasId: string, elementId: string): Promise<void> {
  const { rec, target } = splitTargetOf(api, elementId);
  const raw = splitLocally(rec.snapshot, target.label);
  if (!raw) throw new NothingToSplitError(NOTHING_TO_SPLIT_LOCALLY);
  const metadata = { createdBy: "ai" as const, task: "split_locally", operationId: target.operationId };
  const { changeSet } = await proposeSplit(raw, target, { title: `Split locally: ${target.label}`, metadata }).catch((err: unknown) => {
    throw err instanceof NothingToSplitError ? new NothingToSplitError(NOTHING_TO_SPLIT_LOCALLY) : err;
  });
  getPendingChanges().propose(canvasId, changeSet);
}
