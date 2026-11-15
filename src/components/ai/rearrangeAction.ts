/**
 * "Re-arrange layout" on the live canvas (organisation-layout plan §3.4): the selection's frames laid out again from the
 * source's stored plan (`planRearrange`), with the organisation rules its objects were made under (distil → "v2",
 * §3.0), put up for review with what it left alone and whether the result is worse than the canvas now
 * (`rearrangeNotes`). "Also move cards I placed" in the review re-plans the same frames with `moveUserPlaced`.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { loadLatest } from "@/ai/content/sources";
import { existingObjects } from "@/ai/reconcile/existing";
import { planRearrange } from "@/ai/reconcile/rearrange";
import { sourceOrganisation } from "@/ai/reconcile/update";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";
import { getPersistence } from "@/persistence";
import { getDocumentStore } from "@/state/documents";
import { rearrangeNotes } from "./rearrangeReview";

/** What the review shows for a pending Re-arrange set, and what re-planning it needs. */
export interface RearrangeReview {
  sourceId: string;
  frames: ReadonlySet<string>;
  moveUserPlaced: boolean;
  /** Cards the user placed that this proposal leaves where they are (none with `moveUserPlaced`). */
  kept: number;
  notes: string[];
}

/** By operation id: the review row reads it for the set it shows. Bounded: only the latest few proposals matter. */
const reviews = new Map<string, RearrangeReview>();
const MAX_REVIEWS = 20;

export function rearrangeReviewOf(operationId: string): RearrangeReview | undefined {
  return reviews.get(operationId);
}

export type RearrangeOutcome = "proposed" | "no_source" | "nothing";

/** Plans the re-arrangement of `frames` and puts it up for review (replacing an earlier one in the same slot). */
export async function proposeRearrange(api: ExcalidrawImperativeAPI, canvasId: string, sourceId: string, frames: ReadonlySet<string>, moveUserPlaced = false): Promise<RearrangeOutcome> {
  const latest = await loadLatest(getPersistence().contentSources, sourceId);
  if (!latest) return "no_source";
  const scene = api.getSceneElements() as unknown as readonly SceneElement[];
  const existing = existingObjects(scene, (id) => getDocumentStore().get(id), sourceId);
  const operationId = newId("op");
  const result = planRearrange({ plan: latest.version.plan, existing, scene, operationId, frames, organisation: sourceOrganisation(existing), moveUserPlaced });
  if (!result.set) return "nothing";
  reviews.set(operationId, { sourceId, frames, moveUserPlaced, kept: result.kept.length, notes: rearrangeNotes(result, scene, frames, moveUserPlaced) });
  while (reviews.size > MAX_REVIEWS) reviews.delete(reviews.keys().next().value!);
  getPendingChanges().propose(canvasId, result.set);
  return "proposed";
}
