"use client";

/**
 * Whether MCP clients of a workspace may use the intelligent UI tools — `get_layout_grammar`, `create_layout_card`,
 * `update_layout_card` (note-taking-modes plan §4.3, D6). Off for every workspace until the user turns it on in
 * ⋮ → MCP access. Free in this build: the tools make no model call and spend no AI credit (the client's own model composes
 * the layout); the switch is the one place a later plan limit or rate limit attaches (`ToolPolicy.entitlement`, D49).
 * Per device, in the local `meta` store; read on every call so a change applies at once to connected clients.
 */
import { useSyncExternalStore } from "react";
import { getPersistence } from "@/persistence";

const KEY = "mcp.intelligentUi";
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

export function getMcpAllowIntelligentUi(workspaceId: string): boolean {
  ensureLoaded();
  return allowed[workspaceId] === true;
}

export function setMcpAllowIntelligentUi(workspaceId: string, on: boolean): void {
  const next = { ...allowed };
  if (on) next[workspaceId] = true;
  else delete next[workspaceId];
  allowed = next;
  emit();
  void getPersistence().meta.set(KEY, allowed);
}

export function useMcpAllowIntelligentUi(workspaceId: string): boolean {
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
