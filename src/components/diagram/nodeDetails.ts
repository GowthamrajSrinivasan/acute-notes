/**
 * Zoom-aware node details (interactive architecture frames, Phase 4; Archify's "reading depth"): a node's sublabel
 * shows on the canvas once there's enough zoom to read it, and its tag once there's more. They're drawn by the
 * overlay, never written into the shape's label, so the label stays what the user typed and what reconciliation and
 * search compare.
 *
 * Placement is inside the shape, under its label, when the shape has room there; otherwise just below the shape.
 * Pure, in scene coordinates.
 */
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DiagramGraph } from "@/domain/canvas/diagram";

/** From this zoom the sublabel shows (below it, it's too small to read and only clutters). */
export const SUBLABEL_ZOOM = 0.6;
/** From this zoom the tag shows too: a fine detail. */
export const TAG_ZOOM = 1.25;

export type DetailDepth = "none" | "sublabel" | "full";

export function detailDepth(zoom: number): DetailDepth {
  return zoom >= TAG_ZOOM ? "full" : zoom >= SUBLABEL_ZOOM ? "sublabel" : "none";
}

/** Scene px: one line of sublabel, of tag, and the inset kept from the shape's edge. */
export const SUBLABEL_LINE = 15;
export const TAG_LINE = 14;
const INSET = 6;
const OUTSIDE_GAP = 4;

export interface NodeDetail {
  id: string;
  /** Top-left of the detail block and its width, in scene px. */
  x: number;
  y: number;
  width: number;
  sublabel?: string;
  tag?: string;
  inside: boolean;
}

type Box = { x: number; y: number; width: number; height: number };

/** Where one node's details go, given its box and its label's box (when it has a label). */
export function placeDetails(box: Box, label: Box | undefined, lines: { sublabel: boolean; tag: boolean }): { x: number; y: number; width: number; inside: boolean } | null {
  const height = (lines.sublabel ? SUBLABEL_LINE : 0) + (lines.tag ? TAG_LINE : 0);
  if (!height) return null;
  const bottom = box.y + box.height - INSET;
  const below = label ? label.y + label.height : box.y + INSET;
  if (bottom - below >= height) return { x: box.x + INSET, y: bottom - height, width: Math.max(0, box.width - INSET * 2), inside: true };
  return { x: box.x, y: box.y + box.height + OUTSIDE_GAP, width: box.width, inside: false };
}

/** The details to draw for a diagram's nodes at `depth`: only nodes that have something to show. */
export function nodeDetails(elements: readonly SceneElement[], graph: DiagramGraph, depth: DetailDepth): NodeDetail[] {
  if (depth === "none") return [];
  const labels = new Map<string, Box>();
  for (const el of elements) if (!el.isDeleted && el.type === "text" && el.containerId) labels.set(el.containerId, el);
  return graph.nodes.flatMap((n) => {
    const sublabel = n.semantics.sublabel;
    const tag = depth === "full" ? n.semantics.tag : undefined;
    const at = placeDetails(n.box, labels.get(n.id), { sublabel: !!sublabel, tag: !!tag });
    return at ? [{ id: n.id, ...at, ...(sublabel ? { sublabel } : {}), ...(tag ? { tag } : {}) }] : [];
  });
}
