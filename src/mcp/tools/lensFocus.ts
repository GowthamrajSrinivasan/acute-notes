/**
 * The tab's Lens panel, as MCP's `focus_lens` sees it (plan §7.1, D41): the app registers a host while a canvas of
 * the workspace is mounted, the way it registers `LiveCanvasActions`, so the tool never touches React or the panel's
 * store itself. Tab-only: with no host (no tab, or a hosted server later) the tool says so and changes nothing.
 *
 * Focusing is UI-only: it opens the panel at a level, selects a node and highlights keys. It never writes the scene,
 * so it is allowed with writes off.
 */
import type { FrameRef } from "@/domain/lens/lensView";

export interface LensFocusRequest {
  /** The level to open from (a Lens root, so the breadcrumb runs from the top). */
  root: FrameRef;
  /** Node keys drilled from `root` to the level shown, outermost first. */
  path: readonly string[];
  /** The node to select on that level. */
  nodeKey: string | null;
  /** Node keys to highlight (a trace's stops, the agent's "look here"). */
  highlight: readonly string[];
}

export interface LensFocusHost {
  readonly workspaceId: string;
  /** The canvas open in the tab. */
  readonly canvasId: string;
  focus(request: LensFocusRequest): void;
}

let current: LensFocusHost | null = null;

/** Registered by the open canvas's Lens host; returns the unregister function. */
export function registerLensFocusHost(host: LensFocusHost): () => void {
  current = host;
  return () => {
    if (current === host) current = null;
  };
}

/** The tab's Lens host, or null when no canvas is open. */
export function getLensFocusHost(): LensFocusHost | null {
  return current;
}
