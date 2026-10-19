/**
 * Local spatial reflow (F41, PRD §13.15.19b): place a local layout at its
 * natural slot beside an anchor — below a concept, along a flow — making
 * room by moving only what is in the way, or somewhere free nearby when
 * that costs less.
 *
 * Candidates, in order (ties go to the earlier one):
 *   free   — F30's free-space search (`findPlacement`): moves nothing;
 *   push   — the natural slot, pushing what is in the way along the anchor side;
 *   across — only when that push is not possible (a wall, too much to move):
 *            the natural slot, pushing along the other axis. It moves
 *            objects out of the line they are in, so it never competes
 *            with a push along the anchor side.
 * Each costs the layout's distance from the natural slot (× `DISTANCE_WEIGHT`:
 * content far from where it belongs is the thing a user notices most) plus
 * every moved unit's displacement, × 1 when Acute placed it and it hasn't
 * been moved since, × `USER_PLACED_WEIGHT` otherwise. A push that would move a
 * locked unit, or more than `MAX_MOVED_UNITS`, is not a candidate; neither
 * is one whose result overlaps anything.
 *
 * The push is a sweep along its axis: a unit ahead of the slot that overlaps
 * a pusher (the slot, or a unit already pushed) across the axis is moved just
 * far enough to clear it, and the free space already in front of each unit
 * absorbs part of the push, so it fades out across gaps instead of shifting
 * "everything below". Units (frames, groups) move whole.
 *
 * Pure and deterministic: the same inputs always give the same result.
 */
import { findPlacement, PLACEMENT_GAP, startingPoint } from "./place";
import type { Box, RenderContext, SceneObject } from "./types";

const GAP = PLACEMENT_GAP;
/** A push moving more units than this is not a local change any more. */
export const MAX_MOVED_UNITS = 40;
/** How much more it costs to move something the user placed than something Acute placed. */
export const USER_PLACED_WEIGHT = 4;
/** How much the new content's distance from its natural slot counts, against a moved object's displacement. */
export const DISTANCE_WEIGHT = 3;
const CELL = 512;

export type ReflowStrategy = "free" | "push" | "across";

export interface ReflowResult {
  /** Added to every node of the local layout. */
  dx: number;
  dy: number;
  /** Existing objects to move, by id (every member of a moved unit), in a stable order. */
  moves: { id: string; to: { x: number; y: number } }[];
  strategy: ReflowStrategy;
}

interface Unit {
  key: string;
  members: SceneObject[];
  box: Box;
  /** Never moved: locked, or the anchor itself. */
  wall: boolean;
  weight: number;
}

type Axis = "x" | "y";

/**
 * Where `layoutBounds` goes, and what moves to make room for it. Needs
 * `context.anchor` and `context.objects`; `context.existing` is not used
 * (connectors and labels follow the objects they belong to).
 */
export function placeWithReflow(layoutBounds: Box, context: RenderContext & { anchor: Box; objects: readonly SceneObject[] }): ReflowResult {
  const units = buildUnits(context.objects, context.anchor, context.anchorIds);
  const side: Axis = context.anchorSide === "below" ? "y" : "x";
  const start = startingPoint(layoutBounds, context);
  const slot: Box = { x: start.x, y: start.y, width: layoutBounds.width, height: layoutBounds.height };
  const index = new GridIndex(units);

  const candidates: { strategy: ReflowStrategy; at: Box; shifts: Map<Unit, number>; cost: number }[] = [];

  const free = findPlacement(layoutBounds, { ...context, existing: units.map((u) => u.box) });
  const freeAt = { ...slot, x: layoutBounds.x + free.dx, y: layoutBounds.y + free.dy };
  candidates.push({ strategy: "free", at: freeAt, shifts: new Map(), cost: DISTANCE_WEIGHT * (Math.abs(freeAt.x - slot.x) + Math.abs(freeAt.y - slot.y)) });

  for (const [strategy, axis] of [["push", side], ["across", side === "y" ? "x" : "y"]] as const) {
    const shifts = push(slot, units, axis);
    if (!shifts || !isClear(slot, shifts, index, axis)) continue;
    let cost = 0;
    for (const [u, s] of shifts) cost += u.weight * s;
    candidates.push({ strategy, at: slot, shifts, cost });
    break;
  }

  const best = candidates.reduce((a, b) => (b.cost < a.cost ? b : a));
  const moves = [...best.shifts]
    .sort(([a], [b]) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .flatMap(([u, s]) => u.members.map((m) => ({ id: m.id, to: best.strategy === "across" ? shifted(m.box, otherAxis(side), s) : shifted(m.box, side, s) })));
  return { dx: best.at.x - layoutBounds.x, dy: best.at.y - layoutBounds.y, moves, strategy: best.strategy };
}

const otherAxis = (a: Axis): Axis => (a === "x" ? "y" : "x");

function shifted(b: Box, axis: Axis, by: number): { x: number; y: number } {
  return axis === "x" ? { x: b.x + by, y: b.y } : { x: b.x, y: b.y + by };
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

function contains(outer: Box, inner: Box): boolean {
  return outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
}

function union(boxes: readonly Box[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The scene as rigid units. The anchor is one wall. A unit the anchor belongs
 * to (its frame or group) is split into its members, so room can be made
 * inside it. An object that encloses the anchor (a frame, a background
 * shape) is where the insertion happens, not in its way: it is left out.
 */
function buildUnits(objects: readonly SceneObject[], anchor: Box, anchorIds: readonly string[] | undefined): Unit[] {
  const isAnchor = anchorIds ? new Set(anchorIds) : new Set(objects.filter((o) => contains(anchor, o.box)).map((o) => o.id));
  const open = new Set(objects.filter((o) => isAnchor.has(o.id)).map((o) => o.unit));
  const byKey = new Map<string, SceneObject[]>();
  for (const o of objects) {
    if (!isAnchor.has(o.id) && contains(o.box, anchor)) continue;
    const key = isAnchor.has(o.id) ? " anchor" : open.has(o.unit) ? `o:${o.id}` : `u:${o.unit}`;
    const members = byKey.get(key);
    if (members) members.push(o);
    else byKey.set(key, [o]);
  }
  return [...byKey].map(([key, members]) => ({
    key,
    members,
    box: union(members.map((m) => m.box)),
    wall: key === " anchor" || members.some((m) => m.locked),
    weight: members.every((m) => m.placedByAcute) ? 1 : USER_PLACED_WEIGHT,
  }));
}

// ---------------------------------------------------------------------------
// The push
// ---------------------------------------------------------------------------

const near = (b: Box, a: Axis) => (a === "x" ? b.x : b.y);
const far = (b: Box, a: Axis) => (a === "x" ? b.x + b.width : b.y + b.height);
const mid = (b: Box, a: Axis) => (a === "x" ? b.x + b.width / 2 : b.y + b.height / 2);
/** Overlap across `a` (the other axis's extents intersect). */
const across = (p: Box, u: Box, a: Axis) => (a === "x" ? p.y < u.y + u.height && p.y + p.height > u.y : p.x < u.x + u.width && p.x + p.width > u.x);

/**
 * How far each unit moves along `axis` to clear `slot` (null when a wall is
 * in the way or the push grows past the budget). A unit is ahead of the slot
 * when its middle is past the slot's near edge; the slot needs a full `GAP`
 * in front of it, while pushed units keep their original spacing up to `GAP`
 * (so tight arrangements stay tight, and slack beyond `GAP` absorbs the push).
 */
function push(slot: Box, units: readonly Unit[], axis: Axis): Map<Unit, number> | null {
  const ahead = units
    .filter((u) => mid(u.box, axis) > near(slot, axis))
    .sort((a, b) => near(a.box, axis) - near(b.box, axis) || near(a.box, otherAxis(axis)) - near(b.box, otherAxis(axis)) || (a.key < b.key ? -1 : 1));
  const shifts = new Map<Unit, number>();
  const pushers: { box: Box; shift: number }[] = [];
  for (const u of ahead) {
    let need = across(slot, u.box, axis) ? far(slot, axis) + GAP - near(u.box, axis) : 0;
    for (const p of pushers) {
      if (!across(p.box, u.box, axis)) continue;
      const slack = Math.max(0, near(u.box, axis) - far(p.box, axis) - GAP);
      need = Math.max(need, p.shift - slack);
    }
    if (need <= 0) continue;
    if (u.wall || shifts.size >= MAX_MOVED_UNITS) return null;
    shifts.set(u, need);
    pushers.push({ box: u.box, shift: need });
  }
  return shifts;
}

/** Nothing overlaps once the slot is filled and the units have moved. */
function isClear(slot: Box, shifts: ReadonlyMap<Unit, number>, index: GridIndex, axis: Axis): boolean {
  const finalBox = (u: Unit): Box => {
    const s = shifts.get(u);
    return s ? { ...u.box, ...shifted(u.box, axis, s) } : u.box;
  };
  const moved = [...shifts.keys()];
  const clearOf = (b: Box, self?: Unit) => {
    for (const u of index.near(b)) if (u !== self && !shifts.has(u) && overlaps(b, u.box)) return false;
    for (const u of moved) if (u !== self && overlaps(b, finalBox(u))) return false;
    return true;
  };
  return clearOf(slot) && moved.every((u) => clearOf(finalBox(u), u));
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Units bucketed by a uniform grid, so an overlap check looks at neighbours only. */
class GridIndex {
  private readonly cells = new Map<string, Unit[]>();

  constructor(units: readonly Unit[]) {
    for (const u of units) {
      for (const k of this.keys(u.box)) {
        const cell = this.cells.get(k);
        if (cell) cell.push(u);
        else this.cells.set(k, [u]);
      }
    }
  }

  near(b: Box): Set<Unit> {
    const out = new Set<Unit>();
    for (const k of this.keys(b)) for (const u of this.cells.get(k) ?? []) out.add(u);
    return out;
  }

  private *keys(b: Box): Generator<string> {
    for (let cx = Math.floor(b.x / CELL); cx <= Math.floor((b.x + b.width) / CELL); cx++) {
      for (let cy = Math.floor(b.y / CELL); cy <= Math.floor((b.y + b.height) / CELL); cy++) yield `${cx},${cy}`;
    }
  }
}
