"use client";

import { useParams } from "next/navigation";
import { AppShell } from "./AppShell";

/**
 * Hosts the shell from the `/workspace` layout, above the dynamic segments, so
 * moving between canvases or workspaces keeps it mounted: the navigator stays
 * open and an inline rename started there (e.g. after "New canvas") survives
 * the navigation that follows it.
 */
export function WorkspaceShell() {
  const { workspaceId, canvas } = useParams<{ workspaceId?: string; canvas?: string[] }>();
  if (!workspaceId) return null;
  return <AppShell workspaceId={workspaceId} canvasId={canvas?.[0]} />;
}
