"use client";

/**
 * The app side of semantic placement (intelligent-update-engine-plan Stage 5, §18): one item index per canvas, kept level
 * with the canvas after every accepted change (`warmSemanticIndex`, from `onCommitted`) and on each use, and the descent
 * run over it for "Where should this go?" (`semanticFind`).
 *
 * Only when the build offers it (`NEXT_PUBLIC_SEMANTIC_PLACEMENT`) **and** the server's local model answers
 * (`/api/ai/embed`); otherwise `semanticFind` gives null and the dialog keeps today's router. Any failure is the same
 * null: semantic placement never blocks placing content.
 */
import type { DescriptorCache } from "@/ai/router/descriptors";
import { sectionsOf } from "@/ai/router/descriptors";
import { Descent } from "@/ai/router/descent";
import type { VectorTier } from "@/ai/router/embedding";
import type { RouteResult } from "@/ai/router/router";
import { isModel, semanticEmbedder } from "@/ai/router/routeEmbedding";
import type { PlacementContext } from "@/ai/router/placementContext";
import { SemanticIndex } from "@/ai/router/semanticIndex";
import { semanticRoute } from "@/ai/router/semanticRoute";
import { isSemanticPlacementUiEnabled } from "@/config/features";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";

type GetDocument = (id: string) => DocumentRecord | null | undefined;

const indexes = new Map<string, SemanticIndex>();

async function activeIndex(canvasId: string): Promise<SemanticIndex | null> {
  if (!isSemanticPlacementUiEnabled()) return null;
  const provider = semanticEmbedder();
  await provider.ready();
  if (!isModel(provider)) return null;
  let index = indexes.get(canvasId);
  if (!index) indexes.set(canvasId, (index = new SemanticIndex(provider)));
  return index;
}

/** After an accepted change: the canvas's items re-read and embedded in the background. Never throws. */
export function warmSemanticIndex(canvasId: string, scene: readonly SceneElement[], getDocument: GetDocument): void {
  void activeIndex(canvasId)
    .then(async (index) => {
      if (!index) return;
      index.sync(scene, getDocument);
      await index.index.refresh();
    })
    .catch(() => undefined);
}

/** The descent's answer in the router's shape, or null when semantic placement isn't available (see module doc). */
export async function semanticFind(input: {
  canvasId: string;
  text: string;
  scene: readonly SceneElement[];
  getDocument: GetDocument;
  tier: VectorTier;
  descriptors: DescriptorCache;
  /** Where the user was when they asked (`placementContext.ts`): a prior for that card or section. */
  context?: PlacementContext | null;
}): Promise<RouteResult | null> {
  try {
    const index = await activeIndex(input.canvasId);
    if (!index) return null;
    index.sync(input.scene, input.getDocument);
    const descent = new Descent(index.index, index.sections(input.scene));
    await descent.prepare();
    const context = input.context ? { ...(input.context.card ? { card: input.context.card } : {}), ...(input.context.section ? { section: input.context.section } : {}) } : {};
    const placement = await descent.place(input.text, {}, context);
    const { frames, frameOf } = sectionsOf(input.scene);
    return semanticRoute({
      text: input.text,
      placement,
      index: index.index,
      embedder: index.index.provider.id,
      scene: input.scene,
      getDocument: input.getDocument,
      sections: [...frames.values()],
      context: input.context ?? null,
      describe: (id) => {
        const o = input.tier.get(id);
        const frame = frameOf.get(id);
        return o ? input.descriptors.describe(o, frame ? frames.get(frame) : undefined, (t) => input.tier.frequency(t), input.tier.size) : null;
      },
    });
  } catch {
    return null;
  }
}

/** Test seam. */
export function resetSemanticPlacement(): void {
  indexes.clear();
}
