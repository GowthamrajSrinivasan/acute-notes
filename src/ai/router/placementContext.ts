/**
 * Explicit context for semantic placement (intelligent-update-engine-plan §13.4 step 1, §18 "not done", built 2026-11-24):
 * where the user is when they ask "Where should this go?". The descent (`descent.ts`) gives that card or section a small
 * prior (`contextBonus`) and never calls a note "belongs nowhere" when context is given.
 *
 * In order, the first that applies:
 * 1. **The selection.** One card (a text inside a container counts as its container) → that card, and its frame as the
 *    section. A selected frame → that section. Several things selected, all in one frame (or the frame among them) → that
 *    section only. Selected things in different frames → no context: the selection doesn't say where.
 * 2. **The frame in view** ("the open frame"): nothing selected, and one frame fills most of the viewport — it holds the
 *    viewport's centre and covers at least `OPEN_FRAME_SHARE` of the visible area. A canvas seen from afar says nothing.
 *
 * Pure: the dialog passes the scene, the selected ids and the viewport when it opens.
 */
import type { SceneElement } from "@/domain/canvas/adapter";

export interface PlacementContext {
  card?: string;
  section?: string;
  /** What the context came from, for the dialog's evidence line. */
  source: "selection" | "frame_in_view";
}

/** A rectangle in scene coordinates. */
export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The share of the visible area a frame must cover to count as the open frame (provisional, 2026-11-24). */
export const OPEN_FRAME_SHARE = 0.5;

/** See module doc. Null when neither the selection nor the view points anywhere. */
export function placementContextOf(scene: readonly SceneElement[], selectedIds: readonly string[], viewport?: Viewport): PlacementContext | null {
  const byId = new Map(scene.filter((e) => !e.isDeleted).map((e) => [e.id, e] as const));
  const selected = [...new Set(selectedIds.map((id) => byId.get(id)).filter((e): e is SceneElement => !!e).map((e) => (e.containerId && byId.get(e.containerId)) || e))];

  if (selected.length) {
    const frames = selected.filter((e) => e.type === "frame");
    const others = selected.filter((e) => e.type !== "frame" && !isConnector(e));
    const sectionsOfOthers = new Set(others.map((e) => e.frameId ?? null));
    if (frames.length > 1) return null;
    if (frames.length === 1) return [...sectionsOfOthers].every((s) => s === frames[0]!.id) ? { section: frames[0]!.id, source: "selection" } : null;
    if (others.length === 1) {
      const card = others[0]!;
      return { card: card.id, ...(card.frameId ? { section: card.frameId } : {}), source: "selection" };
    }
    if (others.length > 1 && sectionsOfOthers.size === 1) {
      const only = [...sectionsOfOthers][0];
      return only ? { section: only, source: "selection" } : null;
    }
    return null;
  }

  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return null;
  const cx = viewport.x + viewport.width / 2;
  const cy = viewport.y + viewport.height / 2;
  const area = viewport.width * viewport.height;
  let best: { id: string; share: number } | null = null;
  for (const f of byId.values()) {
    if (f.type !== "frame" || cx < f.x || cx > f.x + f.width || cy < f.y || cy > f.y + f.height) continue;
    const w = Math.min(f.x + f.width, viewport.x + viewport.width) - Math.max(f.x, viewport.x);
    const h = Math.min(f.y + f.height, viewport.y + viewport.height) - Math.max(f.y, viewport.y);
    const share = w > 0 && h > 0 ? (w * h) / area : 0;
    if (share >= OPEN_FRAME_SHARE && (!best || share > best.share)) best = { id: f.id, share };
  }
  return best ? { section: best.id, source: "frame_in_view" } : null;
}

/** Arrows and lines say how things relate, not where the user is. */
const isConnector = (e: SceneElement) => e.type === "arrow" || e.type === "line";
