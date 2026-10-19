/**
 * Where Lens shows a node or frame (plan §5.1; Phase 3's `focus_lens` and the Trace/Impact lists): the Lens root above
 * it and the node keys drilled from that root down to its frame, so the breadcrumb runs from the top. Pure (D41).
 */
import { ancestorsOf, frameOf, type GraphFrame, type GraphNode, type WorkspaceGraph } from "@/domain/project/workspaceGraph";
import { lensView, type FrameRef, type SceneSource } from "./lensView";

export interface LensLocation {
  root: FrameRef;
  /** Node keys drilled from `root`, outermost first. */
  path: string[];
  /** The node to select at that level (null for a frame). */
  nodeKey: string | null;
}

/**
 * The root and path to `target`'s level, walking up the drill links (`expandsTo`, `explained_by`). Used only when
 * Lens's own resolution agrees (it may resolve a link differently, e.g. a suggestion); otherwise the target's frame
 * is opened as the root. Undefined for a node outside any frame.
 */
export function locateInLens(g: WorkspaceGraph, scenes: SceneSource, target: GraphNode | GraphFrame): LensLocation | undefined {
  const frame = target.what === "frame" ? target : frameOf(g, target);
  if (!frame) return undefined;
  const nodeKey = target.what === "node" ? target.ref : null;
  const chain = ancestorsOf(g, frame);
  const path: string[] = [];
  let root: FrameRef = { canvasId: frame.canvasId, frameId: frame.id };
  for (let i = 0; i + 1 < chain.length; i += 2) {
    const node = chain[i];
    const above = chain[i + 1];
    if (node?.what !== "node" || above?.what !== "frame") break;
    path.unshift(node.ref);
    root = { canvasId: above.canvasId, frameId: above.id };
  }
  const view = lensView(scenes, root, path);
  if (view && view.crumbs.length === path.length + 1 && view.frame.canvasId === frame.canvasId && view.frame.frameId === frame.id) return { root, path, nodeKey };
  return { root: { canvasId: frame.canvasId, frameId: frame.id }, path: [], nodeKey };
}

/** A node of `g` by the address Lens uses for it (its key, else its id), on a given canvas. */
export function graphNodeAt(g: WorkspaceGraph, canvasId: string, key: string): GraphNode | undefined {
  return g.nodes.find((n) => n.canvasId === canvasId && (n.ref === key || n.id === key || n.key === key));
}
