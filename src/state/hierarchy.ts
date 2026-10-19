"use client";

/**
 * The workspace → canvas tree shown in the navigator and the header
 * breadcrumb. A tiny external store over `listHierarchy`: commands write
 * storage, then `refresh()` re-reads the (small) tree.
 */
import { useSyncExternalStore } from "react";
import { getPersistence } from "@/persistence";
import { listHierarchy, type WorkspaceNode } from "@/workspaces/hierarchy";

export interface HierarchyState {
  loaded: boolean;
  nodes: WorkspaceNode[];
}

const SERVER_STATE: HierarchyState = { loaded: false, nodes: [] };
let state: HierarchyState = SERVER_STATE;
let refreshing: Promise<void> | null = null;
let again = false;
const listeners = new Set<() => void>();

export const hierarchy = {
  get: (): HierarchyState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Re-reads the tree. Calls made while a read is running trigger one more read. */
  refresh(): Promise<void> {
    if (refreshing) {
      again = true;
      return refreshing;
    }
    refreshing = (async () => {
      do {
        again = false;
        const nodes = await listHierarchy(getPersistence());
        state = { loaded: true, nodes };
        for (const l of listeners) l();
      } while (again);
    })()
      .catch((err: unknown) => console.error("[acute-notes] Failed to load workspaces", err))
      .finally(() => (refreshing = null));
    return refreshing;
  },
};

export function useHierarchy(): HierarchyState {
  return useSyncExternalStore(hierarchy.subscribe, hierarchy.get, () => SERVER_STATE);
}
