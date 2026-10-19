/**
 * The live input for `acute://context/current`. The open canvas registers
 * what it shows (scene, selection, visible area, open page) while it is
 * mounted, so this module never touches the renderer or React. Workspace and
 * canvas names come from the repositories. Resolving is async and happens only
 * on request, never on the interaction path.
 */
import { getOperationLog } from "@/ai/changes/operations";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import type { PersistenceServices } from "@/persistence";
import { buildCurrentContext, CONTEXT_LIMITS, type ContextBounds, type CurrentContext } from "./currentContext";

export interface LiveCanvasContext {
  workspaceId: string;
  canvasId: string;
  elements: readonly SceneElement[];
  selectedIds: readonly string[];
  viewport: ContextBounds | null;
  openPageId: string | null;
  getDocument(id: string): DocumentRecord | null | undefined;
}

let source: (() => LiveCanvasContext) | null = null;

/** Registered by the open canvas; returns the unregister function. */
export function registerCurrentContextSource(read: () => LiveCanvasContext): () => void {
  source = read;
  return () => {
    if (source === read) source = null;
  };
}

/** What the user is looking at now; null when no canvas is open. */
export async function getCurrentContext(services: Pick<PersistenceServices, "workspaces" | "canvases">): Promise<CurrentContext | null> {
  const live = source?.();
  if (!live) return null;
  const [workspace, canvas] = await Promise.all([services.workspaces.get(live.workspaceId), services.canvases.get(live.canvasId)]);
  return buildCurrentContext({
    ...live,
    workspace: { id: live.workspaceId, name: workspace?.name ?? "" },
    canvas: { id: live.canvasId, title: canvas?.title ?? "" },
    recentChanges: getOperationLog()
      .recent(live.canvasId, CONTEXT_LIMITS.recentChanges + 1)
      .map((op) => op.description),
  });
}
