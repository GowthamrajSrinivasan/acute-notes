"use client";

/**
 * Where a workspace's code lives, for the L5 source card's "Open in VS Code" and "Open on GitHub" (plan §5.2, AC8):
 * a local folder and a web repository URL, entered by the user on the card. Device-local (the `meta` store, like
 * Lens's other view state, §3.5), never synced or exported — a local path means nothing on another machine. When the
 * user hasn't set a local folder, a repo map's `repoRoot` (given by the agent to begin_repo_map, Phase 2) stands in.
 */
import { useSyncExternalStore } from "react";
import { cleanRepoLinks, type RepoLinks } from "@/domain/lens/repoLinks";
import { getPersistence } from "@/persistence";

const key = (workspaceId: string) => `lens.repoLinks.${workspaceId}`;
const cache = new Map<string, RepoLinks>();
/** The first repo map's `repoRoot` per workspace (Phase 2), when any map has one. */
const mapRoots = new Map<string, string | undefined>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
const EMPTY: RepoLinks = {};

function emit() {
  for (const l of listeners) l();
}

function ensureLoaded(workspaceId: string) {
  if (cache.has(workspaceId) || loading.has(workspaceId) || typeof window === "undefined") return;
  loading.add(workspaceId);
  void getPersistence()
    .meta.get<RepoLinks>(key(workspaceId))
    .then(
      // A save made while this read was in flight wins over the older stored value.
      (stored) => void (cache.has(workspaceId) || cache.set(workspaceId, cleanRepoLinks(stored ?? {}))),
      () => void (cache.has(workspaceId) || cache.set(workspaceId, EMPTY)),
    )
    .finally(() => {
      loading.delete(workspaceId);
      emit();
    });
  void getPersistence()
    .repoMaps.listByWorkspace(workspaceId)
    .then(
      (maps) => {
        mapRoots.set(workspaceId, maps.find((m) => m.repoRoot)?.repoRoot);
        emit();
      },
      () => undefined,
    );
}

const merged = new Map<string, { from: RepoLinks; root?: string; value: RepoLinks }>();
/** The user's links, with a repo map's `repoRoot` as the local folder when they set none (a stable object per input). */
function linksFor(workspaceId: string): RepoLinks {
  const from = cache.get(workspaceId) ?? EMPTY;
  const root = mapRoots.get(workspaceId);
  const hit = merged.get(workspaceId);
  if (hit && hit.from === from && hit.root === root) return hit.value;
  const value = !from.root && root ? { ...from, root } : from;
  merged.set(workspaceId, { from, ...(root ? { root } : {}), value });
  return value;
}

export function setRepoLinks(workspaceId: string, links: RepoLinks): void {
  const next = cleanRepoLinks(links);
  cache.set(workspaceId, next);
  emit();
  void getPersistence().meta.set(key(workspaceId), next);
}

export function useRepoLinks(workspaceId: string): RepoLinks {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      ensureLoaded(workspaceId);
      return () => listeners.delete(l);
    },
    () => linksFor(workspaceId),
    () => EMPTY,
  );
}
