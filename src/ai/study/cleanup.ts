/**
 * Device-local cleanup when a content source is deleted (study-mode plan issue C, decision 4). The meta store has no
 * key listing, so each key is enumerated from what owns it:
 *
 * - `sourceReview:<sourceId>@<v>` (`ai/content/sourceReview.ts`): versions are append-only, 1 … `latestVersion`, so the
 *   source header (read before it is deleted) says which keys can exist. This fixes an existing leak: deleting a source
 *   used to leave every one of these behind.
 *
 * The study shard `study.<workspaceId>.<sourceId>` is **kept** (decision 2026-11-15, option a: deletion must not erase
 * audit history): its concepts are retired as `source_missing` with their attempts (`store.ts` `retireStudySource`).
 *
 * Workspace deletion (`workspaces/hierarchy.ts` `deleteWorkspace`) still calls `clearStudy` for all the workspace's keys.
 */
import { sourceReviewKey } from "@/ai/content/sourceReview";
import type { ContentSourceRepository, MetaRepository } from "@/persistence/repositories/types";
import { retireStudySource } from "./store";

/** Deletes a content source with its versions and review keys, and retires its study concepts. False when there was none. */
export async function deleteContentSource(services: { contentSources: ContentSourceRepository; meta: MetaRepository }, sourceId: string, now: number = Date.now()): Promise<boolean> {
  const source = await services.contentSources.get(sourceId);
  await services.contentSources.delete(sourceId);
  if (!source) return false;
  for (let v = 1; v <= source.latestVersion; v++) await services.meta.delete(sourceReviewKey(sourceId, v));
  await retireStudySource(services.meta, source.workspaceId, sourceId, now);
  return true;
}
