/**
 * "Re-arrange layout" in the review (organisation-layout plan §3.4.3–3.4.4, Lane F's F3 request): what Re-arrange
 * proposes is reviewed like any other change set, and the bar says what it left alone and whether the result is worse
 * than the canvas now. Pure: the wording and the before/after comparison; `rearrangeAction.ts` runs it on the canvas.
 *
 * - Cards the user placed stay where they are by default ("2 cards you placed were left where they are."); the review's
 *   "Also move cards I placed" option re-plans with `moveUserPlaced`, and then says how many of them it moves.
 * - The geometry report (`planRearrange`'s `geometry`) is compared with the canvas as it is: overlapping cards in the
 *   selected frames before and after the moves. A worse result is still proposed (never dropped silently), and said.
 */
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { RearrangeResult } from "@/ai/reconcile/rearrange";
import { boxesOverlap } from "@/ai/renderer/geometry";
import type { SceneElement } from "@/domain/canvas/adapter";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** How many pairs of cards overlap inside `frames`, with `moves` applied (backdrops and frames never count). */
export function overlapsIn(scene: readonly SceneElement[], frames: ReadonlySet<string>, moves: ReadonlyMap<string, { x: number; y: number }> = new Map()): number {
  const cards = scene.filter((el) => !el.isDeleted && el.type !== "frame" && el.type !== "arrow" && el.type !== "text" && !el.customData?.acuteBackdrop && !!el.frameId && frames.has(el.frameId));
  const boxes = cards.map((el) => ({ ...el, ...(moves.get(el.id) ?? {}) })).map((b) => ({ x: b.x, y: b.y, width: b.width, height: b.height }));
  let n = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (boxesOverlap(boxes[i]!, boxes[j]!)) n++;
  return n;
}

/** The moves a Re-arrange set proposes, by object id. */
export function movesOf(set: Pick<ChangeSet, "changes"> | null): Map<string, { x: number; y: number }> {
  return new Map((set?.changes ?? []).flatMap((c) => (c.kind === "move" ? [[c.target, c.to] as const] : [])));
}

/**
 * The review's lines for a Re-arrange result: the cards the user placed that it kept (or, with `moveUserPlaced`, moves),
 * and a warning when the proposal overlaps more cards than the canvas does now.
 */
export function rearrangeNotes(result: Pick<RearrangeResult, "kept" | "geometry" | "set">, scene: readonly SceneElement[], frames: ReadonlySet<string>, moveUserPlaced = false): string[] {
  const notes: string[] = [];
  if (!moveUserPlaced && result.kept.length) {
    const n = result.kept.length;
    notes.push(`${n} ${plural(n, "card you placed was", "cards you placed were")} left where ${plural(n, "it is", "they are")}.`);
  }
  const movedMine = result.geometry?.movedUserPlaced.length ?? 0;
  if (moveUserPlaced && movedMine) notes.push(`${movedMine} ${plural(movedMine, "card you placed moves", "cards you placed move")} too.`);
  const before = overlapsIn(scene, frames);
  const after = overlapsIn(scene, frames, movesOf(result.set));
  if (after > before) notes.push(`This layout overlaps more cards than the canvas does now (${after} ${plural(after, "pair", "pairs")}, now ${before}).`);
  const outside = result.geometry?.outsideFrames.length ?? 0;
  if (outside) notes.push(`${outside} ${plural(outside, "card ends", "cards end")} up outside ${plural(outside, "its", "their")} frame.`);
  return notes;
}
