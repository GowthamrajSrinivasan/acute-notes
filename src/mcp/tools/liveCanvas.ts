/**
 * The open canvas, as MCP write tools (F21) see it. The canvas registers
 * these actions while it is mounted, the way it registers its current
 * context (`../context/currentContextSource`), so the tools never touch
 * React, Excalidraw or the review UI themselves.
 *
 * Nothing here writes to the canvas: `propose` only puts a change set up for
 * the user's review (F19). Only the user's Accept writes it.
 */
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { RenderContext } from "@/ai/renderer/render";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";

export interface LiveCanvasActions {
  /** The workspace and canvas that are open. */
  readonly workspaceId: string;
  readonly canvasId: string;
  /** The live scene in z-order (deleted elements may be included; tools skip them). */
  elements(): readonly SceneElement[];
  /** F30's placement input from the live canvas: existing boxes, viewport, selection anchor, movable objects. */
  renderContext(): RenderContext;
  /** Whether this producer session (default: in-app) already has a change set under review on this canvas (D40). */
  isReviewing(session?: string): boolean;
  /**
   * Puts a validated change set up for review on this canvas, in its session's slot (D40). Never writes to the scene.
   * Throws `PendingReviewError` when a set from another session is under review and touches the same objects.
   */
  propose(set: ChangeSet): void;
  /**
   * Writes the set under review `operationId` exactly as the user's Accept does. Used only for a session the user
   * switched to auto-accept, for a set `autoAcceptable` allows (D44); false when nothing was written.
   */
  acceptSet?(operationId: string): boolean;

  // Repo maps (F43). Optional: a canvas without them simply doesn't serve the repo-map tools.
  /** A block's or page's document (for reading the map's own objects' content). */
  getDocument?(id: string): DocumentRecord | null | undefined;
  /** The change set under review on this canvas: the merged set of `mergeKey` when given, else the selected one. */
  pending?(mergeKey?: string): ChangeSet | null;
  /** Merges a mapping session's set into the one under review (`PendingChanges.merge`); throws when another set is under review. */
  merge?(set: ChangeSet): void;
  /** Takes staged sections back out of the merged set under review. */
  dropParts?(mergeKey: string, keys: readonly string[]): void;
  /**
   * Writes the named parts of the set under review as one undo step, exactly as the user's "Accept section"
   * does. Used only for a session the user switched to auto-accept (`sessionAutoAccept`); null when nothing was written.
   */
  acceptParts?(keys: readonly string[], mergeKey: string): { stepId: number | null; applied: number } | null;
  /**
   * Shows the quiet "stale" marker on these objects (replacing the canvas's previous stale set), and Lens's lighter
   * "may be affected" ring on their ancestors (Agent Sync, plan §8.2).
   */
  setStale?(objectIds: readonly string[], ancestorIds?: readonly string[]): void;
  /** Clears it from these objects (they were re-sent). */
  clearStale?(objectIds: readonly string[]): void;
}

let current: LiveCanvasActions | null = null;

/** Registered by the open canvas; returns the unregister function. */
export function registerLiveCanvasActions(actions: LiveCanvasActions): () => void {
  current = actions;
  return () => {
    if (current === actions) current = null;
  };
}

/** The open canvas's actions, or null when no canvas is open. */
export function getLiveCanvasActions(): LiveCanvasActions | null {
  return current;
}
