/**
 * "Re-arrange layout": a Visualize result's sections laid out again from its stored plan with the current layout and grouping rules
 * (`layoutPlan`, `linkLabelsToBlocks`) — no AI, no content change. The result is a change set of moves for the objects a source already has
 * on the canvas, reviewed like any other; a section's frame only grows to keep its members inside (`changeSetWriter`).
 *
 * Each section's frame is the frame of its title object (organisation-layout plan §3.4.1); failing that, the frame most of its members are
 * in. A member the user dragged into another frame is left there, and its section is arranged without it. Cards are laid out at their real
 * size on the canvas (§3.4.2), so a card the user resized, or an auto-height card taller than estimated, doesn't overlap the next one.
 *
 * Organisation v2 splits an oversized section into parts (F6, `layoutPlanWithParts`): part 1 is the section's frame, later parts are frames
 * of their own (`<group>::part<i>`, no stable key). The split is reproduced from the stored plan, and each later part's frame on the canvas
 * is the one most of its cards are in. Cards in any of the section's parts belong to it (not "in another frame"), and each part is laid out
 * inside its own frame, so a selection still changes only the frames it holds.
 */
import type { Box, ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { isObstacle } from "@/ai/changes/proposalGeometry";
import type { ExistingObject } from "@/ai/reconcile/classify";
import { geometryOf, type GeometryReport } from "@/ai/renderer/geometry";
import type { FramePart } from "@/ai/renderer/frameSplit";
import { layoutPlanWithParts, subGroupLayout } from "@/ai/renderer/layout";
import { resolvePins } from "@/ai/renderer/pins";
import { restoreSubGroups, topLevelGroupOf, type Organisation } from "@/ai/visual-plan/grouping";
import { isBackdropKey, subGroupTitleKey } from "@/ai/visual-plan/groups";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { linkLabelsToBlocks, validateVisualPlan } from "@/ai/visual-plan/validate";
import { isWhereAcutePlacedIt, type SceneElement } from "@/domain/canvas/adapter";

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
  /** The organisation rules the source was laid out with (organisation-layout plan §3.0); "v2" keeps its sub-groups. Default "v1". */
  organisation?: Organisation;
  /**
   * "Also move cards I placed" (§3.4.3): re-arrange the cards the user moved too, as before. Default: they stay where they are, and the
   * section is laid out around them. (The panel's option is the integrator's.)
   */
  moveUserPlaced?: boolean;
}

/** Moves smaller than this are not proposed. */
const TOLERANCE = 2;

/**
 * A section's frame: the frame its title object (keyed with the group's `stableKey`) is in; failing that, the frame most of its placed
 * members are in, ties going to the first member in plan order.
 */
export function sectionFrame(group: VisualNode, members: readonly VisualNode[], objectOf: ReadonlyMap<string, ExistingObject>, frameIds: ReadonlySet<string>): string | undefined {
  const title = group.stableKey ? objectOf.get(group.stableKey) : undefined;
  if (title?.frameId && frameIds.has(title.frameId)) return title.frameId;
  const count = new Map<string, number>();
  for (const m of members) {
    const f = m.stableKey ? objectOf.get(m.stableKey)?.frameId : undefined;
    if (f && frameIds.has(f)) count.set(f, (count.get(f) ?? 0) + 1);
  }
  // Map order is first-seen order (plan order), and only a strictly larger count replaces the leader: ties go to the first member.
  let best: string | undefined;
  for (const [f, n] of count) if (!best || n > count.get(best)!) best = f;
  return best;
}

/** The plan without `drop` (nodes and the links that touch them). */
function without(plan: VisualPlan, drop: ReadonlySet<string>): VisualPlan {
  if (!drop.size) return plan;
  return { ...plan, nodes: plan.nodes.filter((n) => !drop.has(n.id)), relationships: plan.relationships.filter((r) => !drop.has(r.from) && !drop.has(r.to)) };
}

/** What Re-arrange proposes, and the cards it left where the user put them (for the review's wording). */
export interface RearrangeResult {
  set: ChangeSet | null;
  /** Object ids of the source's cards the user placed, kept where they are (never with `moveUserPlaced`). */
  kept: string[];
  /**
   * The proposal measured on the scene (§3.4.4): overlaps, layout issues, user-placed objects moved. Never used to drop the proposal: a
   * worse result is still proposed, and the review says so (the integrator's wording). Null when nothing is proposed.
   */
  geometry: GeometryReport | null;
}

/** A change set moving the source's objects to where the current layout puts them inside their frames; null when none would move. */
export function rearrangeSource(input: RearrangeInput): ChangeSet | null {
  return planRearrange(input).set;
}

/** `rearrangeSource`, also saying which cards the user placed were kept where they are (§3.4.3). */
export function planRearrange(input: RearrangeInput): RearrangeResult {
  const organisation = input.organisation ?? "v1";
  const validated = validateVisualPlan(input.plan, { stored: true }).plan;
  const stored = organisation === "v2" ? restoreSubGroups(input.plan, validated) : validated;
  // v2: a sub-group is drawn inside its section's frame, so only top-level groups have frames; their members include the sub-groups'.
  const { subsOf } = organisation === "v2" ? subGroupLayout(stored) : { subsOf: new Map<string, VisualNode[]>() };
  const subIds = new Set([...subsOf.values()].flat().map((n) => n.id));
  const groups = stored.nodes.filter((n) => n.type === "group" && !subIds.has(n.id));
  const sectionOf = (n: VisualNode) => (organisation === "v2" ? topLevelGroupOf(stored, n.id) : n.parent);
  if (!groups.length) return { set: null, kept: [], geometry: null };
  // The links the AI left out (a label and its block), as a new run would add them — for this layout only; the stored plan is untouched.
  const full: VisualPlan = { ...stored, relationships: [...stored.relationships, ...linkLabelsToBlocks(stored.nodes, stored.relationships)] };
  const objectOf = new Map(input.existing.map((o) => [o.stableNodeKey, o] as const));
  const frames = new Map(input.scene.filter((el) => el.type === "frame" && !el.isDeleted).map((el) => [el.id, el] as const));
  const frameIds = new Set(frames.keys());
  const sceneById = new Map(input.scene.filter((el) => !el.isDeleted).map((el) => [el.id, el] as const));
  /** The user placed it: it has moved since Acute last put it there (§3.4.3). An object the scene doesn't show is taken as Acute's. */
  const userPlaced = (objectId: string) => {
    const el = sceneById.get(objectId);
    return !!el && !isWhereAcutePlacedIt(el);
  };

  // Each section's frame; the members the user put in another frame (left where they are, their section laid out without them); and, unless
  // the user asked to move them too, the members the user placed in their own frame (pinned: not moved, and the section laid out around them).
  // Real sizes: whatever is on the canvas now (resized by the user, or an auto-height card grown past its estimate).
  const sizesOf = (nodes: readonly VisualNode[]) => {
    const sizes = new Map<string, { width: number; height: number }>();
    for (const n of nodes) {
      const box = n.stableKey ? objectOf.get(n.stableKey)?.box : undefined;
      if (n.type !== "group" && box && box.width > 0 && box.height > 0) sizes.set(n.id, { width: box.width, height: box.height });
    }
    return sizes;
  };
  const layoutOptions = organisation === "v2" ? { organisation } : {};
  const nodeById = new Map(full.nodes.map((n) => [n.id, n] as const));
  /** A later part's frame on the canvas: the candidate frame most of its cards are in (ties to the first card in layout order). */
  const partFrame = (children: readonly string[], candidates: ReadonlySet<string>): string | undefined => {
    const count = new Map<string, number>();
    for (const id of children) {
      const key = nodeById.get(id)?.stableKey;
      const f = key ? objectOf.get(key)?.frameId : undefined;
      if (f && candidates.has(f)) count.set(f, (count.get(f) ?? 0) + 1);
    }
    let best: string | undefined;
    for (const [f, n] of count) if (!best || n > count.get(best)!) best = f;
    return best;
  };

  // Each section's frame (its title's) and, in v2, its later parts' frames: the split reproduced from the stored plan. A part's frame is
  // never another section's own frame.
  const frameOfGroup = new Map<string, string | undefined>();
  for (const group of groups) frameOfGroup.set(group.id, sectionFrame(group, full.nodes.filter((n) => n.type !== "group" && sectionOf(n) === group.id), objectOf, frameIds));
  const firstParts: ReadonlyMap<string, readonly FramePart[]> = organisation === "v2" ? layoutPlanWithParts(full, { sizes: sizesOf(full.nodes), ...layoutOptions }).parts : new Map();
  const titleFrames = new Set([...frameOfGroup.values()].filter((f): f is string => !!f));
  const free = new Set([...frameIds].filter((f) => !titleFrames.has(f)));
  const framesOfGroup = new Map<string, Set<string>>();
  for (const group of groups) {
    const own = frameOfGroup.get(group.id);
    const sectionFrames = new Set(own ? [own] : []);
    for (const part of own ? (firstParts.get(group.id) ?? []).slice(1) : []) {
      const f = partFrame(part.children, free);
      if (!f) continue;
      sectionFrames.add(f);
      free.delete(f);
    }
    framesOfGroup.set(group.id, sectionFrames);
  }

  // The members the user put in a frame not their section's (left where they are, their section laid out without them); and, unless the
  // user asked to move them too, the members the user placed in one of their section's frames (pinned: not moved, laid out around them).
  const foreign = new Set<string>();
  const pinned = new Set<string>();
  for (const group of groups) {
    const frameId = frameOfGroup.get(group.id);
    const own = framesOfGroup.get(group.id)!;
    for (const m of full.nodes.filter((n) => n.type !== "group" && sectionOf(n) === group.id)) {
      const object = m.stableKey ? objectOf.get(m.stableKey) : undefined;
      if (object?.frameId && frameId && !own.has(object.frameId)) foreign.add(m.id);
      else if (object?.box && frameId && object.frameId && own.has(object.frameId) && !input.moveUserPlaced && userPlaced(object.objectId)) pinned.add(m.id);
    }
  }
  const plan = without(full, new Set([...foreign, ...pinned]));
  const { boxes, parts } = layoutPlanWithParts(plan, { sizes: sizesOf(plan.nodes), ...layoutOptions });
  const sourceObjects = new Set(input.existing.map((o) => o.objectId));

  const changes: ProposedChange[] = [];
  const kept: string[] = [];
  for (const group of groups) {
    const gbox = boxes.get(group.id);
    const frameId = frameOfGroup.get(group.id);
    const sectionFrameEl = frameId ? frames.get(frameId) : undefined;
    if (!gbox || !sectionFrameEl) continue;
    // The section's cards, and in v2 its sub-groups' titles (each the object keyed with its sub-group's stable key).
    const sectionPlaced = [
      ...plan.nodes.filter((n) => n.type !== "group" && sectionOf(n) === group.id).map((n) => ({ stableKey: n.stableKey, at: n.id })),
      ...(subsOf.get(group.id) ?? []).map((sub, i) => ({ stableKey: sub.stableKey, at: subGroupTitleKey(group.id, i) })),
    ];
    const sectionKeys = [...boxes.keys()].filter((k) => isBackdropKey(k) && k.startsWith(`${group.id}::`));
    // One frame to lay out; a split section (v2) one per part, each inside its own frame on the canvas.
    const split = parts.get(group.id);
    const candidates = new Set([...framesOfGroup.get(group.id)!].filter((f) => f !== sectionFrameEl.id));
    const jobs = split
      ? split.map((part, i) => {
          const f = i === 0 ? sectionFrameEl.id : partFrame(part.children, candidates);
          if (f) candidates.delete(f);
          return { frame: f ? frames.get(f) : undefined, frameBox: boxes.get(part.key), inside: new Set(part.children) as ReadonlySet<string> | null };
        })
      : [{ frame: sectionFrameEl, frameBox: gbox as Box | undefined, inside: null }];
    for (const { frame, frameBox, inside } of jobs) {
      // A frame outside the selection is left alone: no moves, and its backdrops are neither removed nor redrawn.
      if (!frame || !frameBox || (input.frames && !input.frames.has(frame.id))) continue;
      const placedHere = inside ? sectionPlaced.filter((p) => inside.has(p.at)) : sectionPlaced;
      const keys = inside ? sectionKeys.filter((k) => inside.has(k)) : sectionKeys;
      // Where the layout puts each of them on the canvas, then moved down past what the user placed in this frame: the source's pinned
      // cards and any card of the user's own (no link to the source). Neither moves.
      const toCanvas = (b: Box): Box => ({ x: frame.x + (b.x - frameBox.x), y: frame.y + (b.y - frameBox.y), width: b.width, height: b.height });
      const absolute = new Map<string, Box>();
      for (const { at } of placedHere) if (boxes.has(at)) absolute.set(at, toCanvas(boxes.get(at)!));
      for (const k of keys) absolute.set(k, toCanvas(boxes.get(k)!));
      const pins: Box[] = [];
      for (const n of full.nodes) {
        const object = pinned.has(n.id) && sectionOf(n) === group.id && n.stableKey ? objectOf.get(n.stableKey) : undefined;
        if (!object?.box || object.frameId !== frame.id) continue;
        pins.push(object.box);
        kept.push(object.objectId);
      }
      for (const el of input.scene) {
        if (el.isDeleted || el.frameId !== frame.id || sourceObjects.has(el.id) || el.customData?.acuteBackdrop || !isObstacle(el)) continue;
        pins.push({ x: el.x, y: el.y, width: el.width, height: el.height });
      }
      const placed = pins.length ? resolvePins(absolute, pins) : absolute;
      for (const { stableKey, at } of placedHere) {
        if (!stableKey) continue;
        const object = objectOf.get(stableKey);
        const box = placed.get(at);
        // A member outside every frame stays where the user put it (as before); one in another frame was dropped from `plan` above. In a
        // split section, a card the reproduced split puts in another part than the one it is in stays where it is.
        if (!object?.box || !box || object.frameId !== frame.id) continue;
        const to = { x: Math.round(box.x), y: Math.round(box.y) };
        if (Math.abs(to.x - object.box.x) > TOLERANCE || Math.abs(to.y - object.box.y) > TOLERANCE) changes.push({ kind: "move", target: object.objectId, to });
      }
      // Sub-topic backdrops: the ones an earlier arrangement drew are replaced by this one's, so they are never doubled.
      const old = input.scene.filter((el) => !el.isDeleted && el.frameId === frame.id && el.customData?.acuteBackdrop);
      const target = (key: string) => {
        const b = placed.get(key)!;
        return { x: Math.round(b.x), y: Math.round(b.y), width: b.width, height: b.height };
      };
      const same = old.length === keys.length && keys.every((k) => old.some((el) => Math.abs(el.x - target(k).x) <= TOLERANCE && Math.abs(el.y - target(k).y) <= TOLERANCE && Math.abs(el.width - target(k).width) <= TOLERANCE && Math.abs(el.height - target(k).height) <= TOLERANCE));
      if (same) continue;
      for (const el of old) changes.push({ kind: "remove", target: el.id });
      for (const key of keys) changes.push({ kind: "create_shape", key, shape: "rectangle", backdrop: true, box: target(key) });
      if (keys.length) changes.push({ kind: "update_frame", target: frame.id, add: keys });
    }
  }
  if (!changes.length) return { set: null, kept, geometry: null };
  // Rule 4 (§0.3): on a selection, nothing outside the selected frames may change. A failure here is a bug in this function.
  const geometry = geometryOf(changes, input.scene, input.frames ? { scope: input.frames } : {});
  if (geometry.outsideScope.length) throw new Error(`Re-arrange proposed changes outside the selection: ${geometry.outsideScope.join(", ")}`);
  return {
    geometry,
    set: {
      operationId: input.operationId,
      title: input.title ?? "Re-arrange layout",
      metadata: { createdBy: "ai", task: "generate_visual_plan", operationId: input.operationId },
      changes,
    },
    kept,
  };
}
