"use client";

/**
 * Whether MCP clients of a workspace may run AI content imports (`import_content`). Off for every workspace until the user turns it on
 * in ⋮ → MCP access: an import spends the user's own AI credit, which no other MCP tool does. Per device, in the local `meta` store; read
 * on every call so a change applies at once to connected clients.
 */
import { useSyncExternalStore } from "react";
import { getPersistence } from "@/persistence";

const KEY = "mcp.ingest";
let allowed: Record<string, true> = {};
let loaded = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

function ensureLoaded() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  void getPersistence()
    .meta.get<Record<string, true>>(KEY)
    .then((stored) => {
      if (stored) {
        allowed = { ...stored, ...allowed };
        emit();
      }
    });
}

export function getMcpAllowIngest(workspaceId: string): boolean {
  ensureLoaded();
  return allowed[workspaceId] === true;
}

export function setMcpAllowIngest(workspaceId: string, on: boolean): void {
  const next = { ...allowed };
  if (on) next[workspaceId] = true;
  else delete next[workspaceId];
  allowed = next;
  emit();
  void getPersistence().meta.set(KEY, allowed);
}

export function useMcpAllowIngest(workspaceId: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      ensureLoaded();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => allowed[workspaceId] === true,
    () => false,
  );
}
