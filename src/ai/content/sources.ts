/**
 * Content source versioning (F37): each Visualize run is tied to a
 * `ContentSource`; "Update from new content" (F39) appends a new
 * `ContentSourceVersion` to the same source instead of starting an unrelated
 * one. A version is recorded only when its change set is **accepted** — a
 * rejected run leaves no trace. Device-local (`ContentSourceRepository`),
 * never in workspace documents, Yjs or exports.
 */
import type { ContentSourceRecord } from "@/ai/changes/changeSet";
import { newId } from "@/domain/ids";
import type { ContentSource, ContentSourceVersion, DocumentHome } from "@/domain/types";
import type { ContentSourceRepository } from "@/persistence/repositories/types";

export function newContentSourceId(): string {
  return newId("src");
}

/**
 * Writes still in flight, per repository and source. Accept records a version without waiting (the undo step is
 * already written), so `loadLatest` waits for them: a re-send right after Accept compares against the version
 * that Accept just recorded, never the one before it.
 */
const inFlight = new WeakMap<ContentSourceRepository, Map<string, Promise<void>>>();

/** Writes an accepted change set's content version: a new source at version 1, or the next version of an existing one. */
export function recordAcceptedSource(repo: ContentSourceRepository, home: DocumentHome, record: ContentSourceRecord, now = Date.now()): Promise<void> {
  let writes = inFlight.get(repo);
  if (!writes) inFlight.set(repo, (writes = new Map()));
  const map = writes;
  // Writes to one source run in order, so the latest version always wins.
  const run = (map.get(record.sourceId) ?? Promise.resolve()).then(() => writeAccepted(repo, home, record, now));
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  map.set(record.sourceId, settled);
  void settled.then(() => {
    if (map.get(record.sourceId) === settled) map.delete(record.sourceId);
  });
  return run;
}

async function writeAccepted(repo: ContentSourceRepository, home: DocumentHome, record: ContentSourceRecord, now: number): Promise<void> {
  const existing = await repo.get(record.sourceId);
  const source: ContentSource = existing
    ? { ...existing, latestVersion: Math.max(existing.latestVersion, record.version), updatedAt: now }
    : {
        id: record.sourceId,
        workspaceId: home.workspaceId,
        canvasId: home.canvasId,
        origin: record.origin,
        tier: record.tier,
        template: record.template,
        latestVersion: record.version,
        createdAt: now,
        updatedAt: now,
      };
  const version: ContentSourceVersion = {
    sourceId: record.sourceId,
    version: record.version,
    text: record.text,
    plan: record.plan,
    ...(record.pathIds ? { pathIds: record.pathIds } : {}),
    ...(record.revisions?.length ? { revisions: record.revisions } : {}),
    createdAt: now,
  };
  await repo.append(source, version);
}

/** A source and its latest accepted version; null when either is missing (e.g. objects imported from another device). */
export async function loadLatest(repo: ContentSourceRepository, sourceId: string): Promise<{ source: ContentSource; version: ContentSourceVersion } | null> {
  await inFlight.get(repo)?.get(sourceId);
  const source = await repo.get(sourceId);
  if (!source) return null;
  const version = await repo.getVersion(sourceId, source.latestVersion);
  return version ? { source, version } : null;
}
