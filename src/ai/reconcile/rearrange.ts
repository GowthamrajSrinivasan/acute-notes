/**
 * "Re-arrange layout": a Visualize result's sections laid out again from its stored plan with the current layout and grouping rules
 * (`layoutPlan`, `linkLabelsToBlocks`) — no AI, no content change. The result is a change set of moves for the objects a source already has
 * on the canvas, reviewed like any other; a section's frame only grows to keep its members inside (`changeSetWriter`).
 */
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import type { ExistingObject } from "@/ai/reconcile/classify";
import { layoutPlan } from "@/ai/renderer/layout";
import { isClusterKey } from "@/ai/visual-plan/groups";
import { linkLabelsToBlocks, validateVisualPlan } from "@/ai/visual-plan/validate";
import type { SceneElement } from "@/domain/canvas/adapter";

export interface RearrangeInput {
  /** The source's latest stored plan (grouped by its sections, as a first run stores it). */
  plan: unknown;
  /** The source's objects on this canvas. */
  existing: readonly ExistingObject[];
  scene: readonly SceneElement[];
  operationId: string;
  title?: string;
  /**
   * The section frames to re-arrange (a selection's frames). Only those sections' objects move and only their sub-topic backdrops are redrawn;
   * every other section is left exactly as it is. Absent: every section of the source.
   */
  frames?: ReadonlySet<string>;
}

/** Moves smaller than this are not proposed. */
const TOLERANCE = 2;

/** A change set moving the source's objects to where the current layout puts them inside their frames; null when none would move. */
export function rearrangeSource(input: RearrangeInput): ChangeSet | null {
  const stored = validateVisualPlan(input.plan, { stored: true }).plan;
  const groups = stored.nodes.filter((n) => n.type === "group");
  if (!groups.length) return null;
  // The links the AI left out (a label and its block), as a new run would add them — for this layout only; the stored plan is untouched.
  const plan = { ...stored, relationships: [...stored.relationships, ...linkLabelsToBlocks(stored.nodes, stored.relationships)] };
  const boxes = layoutPlan(plan);
  const objectOf = new Map(input.existing.map((o) => [o.stableNodeKey, o] as const));
  const frames = new Map(input.scene.filter((el) => el.type === "frame" && !el.isDeleted).map((el) => [el.id, el] as const));

  const changes: ProposedChange[] = [];
  for (const group of groups) {
    const gbox = boxes.get(group.id);
    if (!gbox) continue;
    let frameId: string | undefined;
    const moves: ProposedChange[] = [];
    for (const node of plan.nodes) {
      if (node.type === "group" || node.parent !== group.id || !node.stableKey) continue;
      const object = objectOf.get(node.stableKey);
      const box = boxes.get(node.id);
      const frame = object?.frameId ? frames.get(object.frameId) : undefined;
      if (!object?.box || !box || !frame) continue;
      frameId = frame.id;
      const to = { x: Math.round(frame.x + (box.x - gbox.x)), y: Math.round(frame.y + (box.y - gbox.y)) };
      if (Math.abs(to.x - object.box.x) > TOLERANCE || Math.abs(to.y - object.box.y) > TOLERANCE) moves.push({ kind: "move", target: object.objectId, to });
    }
    // A section outside the selection is left alone: no moves, and its backdrops are neither removed nor redrawn.
    const frame = frameId ? frames.get(frameId) : undefined;
    if (!frame || (input.frames && !input.frames.has(frame.id))) continue;
    changes.push(...moves);
    // Sub-topic backdrops: the ones an earlier arrangement drew are replaced by this one's, so they are never doubled.
    const old = input.scene.filter((el) => !el.isDeleted && el.frameId === frame.id && el.customData?.acuteBackdrop);
    const keys = [...boxes.keys()].filter((k) => isClusterKey(k) && k.startsWith(`${group.id}::`));
    const target = (key: string) => {
      const b = boxes.get(key)!;
      return { x: Math.round(frame.x + (b.x - gbox.x)), y: Math.round(frame.y + (b.y - gbox.y)), width: b.width, height: b.height };
    };
    const same = old.length === keys.length && keys.every((k) => old.some((el) => Math.abs(el.x - target(k).x) <= TOLERANCE && Math.abs(el.y - target(k).y) <= TOLERANCE && Math.abs(el.width - target(k).width) <= TOLERANCE && Math.abs(el.height - target(k).height) <= TOLERANCE));
    if (same) continue;
    for (const el of old) changes.push({ kind: "remove", target: el.id });
    for (const key of keys) changes.push({ kind: "create_shape", key, shape: "rectangle", backdrop: true, box: target(key) });
    if (keys.length) changes.push({ kind: "update_frame", target: frame.id, add: keys });
  }
  if (!changes.length) return null;
  return {
    operationId: input.operationId,
    title: input.title ?? "Re-arrange layout",
    metadata: { createdBy: "ai", task: "generate_visual_plan", operationId: input.operationId },
    changes,
  };
}
