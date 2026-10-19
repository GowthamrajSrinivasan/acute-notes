"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { DocumentRecord } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { DocumentStore } from "./documentStore";

let store: DocumentStore | null = null;

export function getDocumentStore(): DocumentStore {
  if (!store) store = new DocumentStore(getPersistence().documents);
  return store;
}

/** Subscribes to one document record; re-renders only when it changes. */
export function useDocumentRecord(id: string): DocumentRecord | null | undefined {
  const s = getDocumentStore();
  const subscribe = useCallback((cb: () => void) => s.subscribe(id, cb), [s, id]);
  const get = useCallback(() => s.get(id), [s, id]);
  return useSyncExternalStore(subscribe, get, () => undefined);
}

/** All records of one kind in a workspace (e.g. the page list); re-renders when any of them changes. */
export function useDocumentList(workspaceId: string, kind: DocumentRecord["kind"]): DocumentRecord[] {
  const s = getDocumentStore();
  useEffect(() => void s.loadKind(workspaceId, kind), [s, workspaceId, kind]);
  const subscribe = useCallback((cb: () => void) => s.subscribeKind(kind, cb), [s, kind]);
  const version = useSyncExternalStore(
    subscribe,
    () => s.kindVersion(kind),
    () => 0,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the change signal
  return useMemo(() => s.list(workspaceId, kind), [s, workspaceId, kind, version]);
}
