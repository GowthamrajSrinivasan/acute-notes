/**
 * Right-angle ("elbow") routes for connectors the AI or an MCP client adds (Wave 1b item 2).
 *
 * The rules follow Archify's architecture renderer (github.com/tt-a1i/archify, MIT,
 * `renderers/shared/geometry.mjs`): a connector leaves and enters a box at a right
 * angle to the side it uses; when several connectors share one side of a box, their
 * attachment points spread out (16 px from the corners, at most 14 px apart), ordered
 * by where the other end is, so they never stack; and a route may not cross a box
 * other than its own two ends. Written independently for Acute's boxes and change sets.
 *
 * Pure and deterministic: the same boxes always give the same routes. The writer turns
 * a route into an Excalidraw elbow arrow bound at fixed points, so Excalidraw re-routes
 * it on its own when the user later moves either end.
 */
import type { Box } from "./changeSet";
import { CONNECTOR_GAP } from "./geometry";

export type Side = "left" | "right" | "top" | "bottom";
export type Point = { x: number; y: number };
export type RoutedBox = Box & { id: string };

export interface ConnectorRequest {
  key: string;
  from: RoutedBox;
  to: RoutedBox;
  /**
   * Boxes this connector alone avoids, besides the shared obstacles — for a link between two sections, the other
   * sections' frames, so it runs in the gutters between frames instead of across their cards (Wave D).
   */
  avoid?: readonly RoutedBox[];
  /**
   * Spread its ports across the whole side, not `PORT_SPACING` apart: for links between section frames, whose sides
   * are long — 14 px apart on a frame reads as one thick arrow.
   */
  wide?: boolean;
}

export interface ConnectorRoute {
  /** Absolute points, first at the start (just outside `from`), last at the end. Every segment is horizontal or vertical. */
  points: Point[];
  fromSide: Side;
  toSide: Side;
  /** Where on each box the connector attaches, as fractions of its width and height (Excalidraw's `fixedPoint`). */
  startRatio: [number, number];
  endRatio: [number, number];
  /** Unrelated boxes the chosen route still crosses (0 unless every candidate was blocked). */
  crossings: number;
}

/** Corner clearance and maximum spacing when several connectors share one side (Archify's values). */
export const PORT_GUTTER = 16;
export const PORT_SPACING = 14;
/** How far a route runs straight out of a side before it may turn. */
export const ROUTE_STUB = 24;
/** Height of the band above a section frame where Excalidraw draws its name ("2 · Comparison"). */
export const FRAME_NAME_BAND = 28;

/** The band above `frame` its name takes: links between sections keep their runs and labels out of it. */
export function frameNameBand(frame: RoutedBox): RoutedBox {
  return { id: `${frame.id}#name`, x: frame.x, y: frame.y - FRAME_NAME_BAND, width: frame.width, height: FRAME_NAME_BAND };
}

/**
 * What a link between two sections keeps clear of: the other sections' frames, and every section's name band but its
 * own two ends' (it enters and leaves those across them).
 */
export function sectionAvoid(frames: readonly RoutedBox[], fromId: string, toId: string): RoutedBox[] {
  const others = frames.filter((f) => f.id !== fromId && f.id !== toId);
  return [...others, ...others.map(frameNameBand)];
}

/** Distance between parallel runs that share a gutter, so each link (and its label) reads on its own. */
export const LANE_SPACING = 12;
/** Runs this close share a gutter: they're laid out in lanes together. */
const LANE_GROUP = LANE_SPACING * 3;
/** A wide port spread keeps this far apart at most, so links stay grouped near the side's middle. */
const WIDE_PORT_SPACING = 120;
/** Clearance a route keeps from unrelated boxes. */
const CLEARANCE = 6;

const horizontalSide = (side: Side) => side === "left" || side === "right";
type PortOffsets = { from: number; to: number; fromShared: boolean; toShared: boolean };
const NO_OFFSET: PortOffsets = { from: 0, to: 0, fromShared: false, toShared: false };
const center = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/**
 * The sides a connector uses: left/right when the boxes are further apart horizontally
 * than vertically (measured as clear gap, not centre distance), else top/bottom.
 */
export function connectorSides(from: Box, to: Box): { fromSide: Side; toSide: Side } {
  const gapX = Math.max(to.x - (from.x + from.width), from.x - (to.x + to.width));
  const gapY = Math.max(to.y - (from.y + from.height), from.y - (to.y + to.height));
  const fc = center(from);
  const tc = center(to);
  if (gapX >= gapY) return tc.x >= fc.x ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
  return tc.y >= fc.y ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
}

/** A side's midpoint, moved `offset` along the side. */
function portOn(box: Box, side: Side, offset: number): Point {
  const c = center(box);
  switch (side) {
    case "left":
      return { x: box.x, y: c.y + offset };
    case "right":
      return { x: box.x + box.width, y: c.y + offset };
    case "top":
      return { x: c.x + offset, y: box.y };
    case "bottom":
      return { x: c.x + offset, y: box.y + box.height };
  }
}

const OUTWARD: Record<Side, Point> = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };
const out = (p: Point, side: Side, d: number): Point => ({ x: p.x + OUTWARD[side].x * d, y: p.y + OUTWARD[side].y * d });

/**
 * Offsets along each box side for connectors that share it: symmetric around the
 * midpoint, ordered by the other end's position so neighbouring connectors don't cross.
 */
function spreadPorts(
  requests: readonly ConnectorRequest[],
  sides: Map<string, { fromSide: Side; toSide: Side }>,
): Map<string, { from: number; to: number; fromShared: boolean; toShared: boolean }> {
  type Item = { key: string; end: "from" | "to"; box: RoutedBox; side: Side; other: RoutedBox; wide: boolean };
  const groups = new Map<string, Item[]>();
  for (const r of requests) {
    const s = sides.get(r.key)!;
    for (const item of [
      { key: r.key, end: "from" as const, box: r.from, side: s.fromSide, other: r.to, wide: !!r.wide },
      { key: r.key, end: "to" as const, box: r.to, side: s.toSide, other: r.from, wide: !!r.wide },
    ]) {
      const id = `${item.box.id}\u0000${item.side}`;
      (groups.get(id) ?? groups.set(id, []).get(id)!).push(item);
    }
  }
  const offsets = new Map(requests.map((r) => [r.key, { from: 0, to: 0, fromShared: false, toShared: false }]));
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    for (const item of items) offsets.get(item.key)![item.end === "from" ? "fromShared" : "toShared"] = true;
    const alongY = horizontalSide(items[0]!.side);
    items.sort((a, b) => {
      const d = alongY ? center(a.other).y - center(b.other).y : center(a.other).x - center(b.other).x;
      return d || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });
    const extent = alongY ? items[0]!.box.height : items[0]!.box.width;
    const most = items.every((i) => i.wide) ? Math.max(PORT_SPACING, Math.min(WIDE_PORT_SPACING, extent / (items.length + 1))) : PORT_SPACING;
    const spacing = Math.min(most, Math.max(0, extent - PORT_GUTTER * 2) / (items.length - 1));
    if (!(spacing > 0)) continue;
    items.forEach((item, i) => {
      offsets.get(item.key)![item.end] = (i - (items.length - 1) / 2) * spacing;
    });
  }
  return offsets;
}

function segmentHitsBox(a: Point, b: Point, box: Box, clearance: number): boolean {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  // Axis-aligned segment against an axis-aligned box: a bounding-box overlap test is exact.
  return maxX > box.x - clearance && minX < box.x + box.width + clearance && maxY > box.y - clearance && minY < box.y + box.height + clearance;
}

function crossingsOf(points: readonly Point[], obstacles: readonly RoutedBox[], skip: ReadonlySet<string>): number {
  let hits = 0;
  for (const box of obstacles) {
    if (skip.has(box.id)) continue;
    for (let i = 0; i < points.length - 1; i += 1) {
      if (segmentHitsBox(points[i]!, points[i + 1]!, box, CLEARANCE)) {
        hits += 1;
        break;
      }
    }
  }
  return hits;
}

/**
 * `r` routed between the sides across `defaultSide`'s axis (top/bottom instead of left/right, or the other way),
 * each facing the other end: its least-crossing candidate route.
 */
function otherAxisRoute(r: ConnectorRequest, defaultSide: Side, gap: number, obstacles: readonly RoutedBox[], skip: ReadonlySet<string>, off: PortOffsets = NO_OFFSET): ConnectorRoute | null {
  const fc = center(r.from);
  const tc = center(r.to);
  const [fromSide, toSide]: [Side, Side] = horizontalSide(defaultSide)
    ? tc.y >= fc.y
      ? ["bottom", "top"]
      : ["top", "bottom"]
    : tc.x >= fc.x
      ? ["right", "left"]
      : ["left", "right"];
  const startEdge = portOn(r.from, fromSide, off.from);
  const endEdge = portOn(r.to, toSide, off.to);
  const s = out(startEdge, fromSide, gap);
  const e = out(endEdge, toSide, gap);
  const span = { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y), width: Math.abs(s.x - e.x), height: Math.abs(s.y - e.y) };
  const blockers = obstacles.filter((b) => !skip.has(b.id) && segmentHitsBox({ x: span.x, y: span.y }, { x: span.x + span.width, y: span.y + span.height }, b, CLEARANCE));
  let best: { points: Point[]; crossings: number } | null = null;
  for (const points of candidates(s, e, fromSide, toSide, blockers).map(simplify)) {
    if (!honoursSides(points, fromSide, toSide)) continue;
    const crossings = crossingsOf(points, blockers.length ? obstacles : [], skip);
    if (!best || crossings < best.crossings) best = { points, crossings };
    if (crossings === 0) break;
  }
  if (!best) return null;
  return {
    points: best.points,
    fromSide,
    toSide,
    startRatio: [(startEdge.x - r.from.x) / r.from.width, (startEdge.y - r.from.y) / r.from.height],
    endRatio: [(endEdge.x - r.to.x) / r.to.width, (endEdge.y - r.to.y) / r.to.height],
    crossings: best.crossings,
  };
}

/**
 * Whether a link skips a box: its two ends line up along the link's axis (a column for top/bottom sides, a row for
 * left/right) and one of `blockers` sits between them there — the case a C-shaped route is for, and the only one.
 */
function skipsABox(from: Box, to: Box, side: Side, blockers: readonly Box[]): boolean {
  const vertical = !horizontalSide(side);
  const [a0, a1, b0, b1] = vertical ? [from.x, from.x + from.width, to.x, to.x + to.width] : [from.y, from.y + from.height, to.y, to.y + to.height];
  const across = [Math.max(a0, b0), Math.min(a1, b1)] as const;
  if (across[0] >= across[1]) return false;
  const [lo, hi] = vertical
    ? [Math.min(from.y + from.height, to.y + to.height), Math.max(from.y, to.y)]
    : [Math.min(from.x + from.width, to.x + to.width), Math.max(from.x, to.x)];
  return blockers.some((b) => {
    const [c0, c1] = vertical ? [b.x, b.x + b.width] : [b.y, b.y + b.height];
    const [d0, d1] = vertical ? [b.y, b.y + b.height] : [b.x, b.x + b.width];
    return c1 > across[0] && c0 < across[1] && d0 >= lo - 1 && d1 <= hi + 1;
  });
}

/**
 * The C-shaped route of `r` along the outside of both boxes, on whichever of the two sides across its default axis
 * is clear of every obstacle (the shorter when both are); null when neither is.
 */
function sameSideRoute(r: ConnectorRequest, defaultSide: Side, gap: number, obstacles: readonly RoutedBox[], skip: ReadonlySet<string>, off: PortOffsets = NO_OFFSET, only?: Side): ConnectorRoute | null {
  const sides: readonly Side[] = only ? [only] : horizontalSide(defaultSide) ? ["top", "bottom"] : ["left", "right"];
  let best: { route: ConnectorRoute; length: number } | null = null;
  for (const side of sides) {
    const startEdge = portOn(r.from, side, off.from);
    const endEdge = portOn(r.to, side, off.to);
    const s = out(startEdge, side, gap);
    const e = out(endEdge, side, gap);
    const alongX = side === "left" || side === "right";
    const sign = side === "left" || side === "top" ? -1 : 1;
    // Every point of this route lies between the two ports along the run, and on the outer side of them across it:
    // only obstacles in that corridor can be hit (one pass over all of them, then the few that matter).
    const lo = alongX ? Math.min(s.y, e.y) - CLEARANCE : Math.min(s.x, e.x) - CLEARANCE;
    const hi = alongX ? Math.max(s.y, e.y) + CLEARANCE : Math.max(s.x, e.x) + CLEARANCE;
    const inner = sign < 0 ? Math.max(alongX ? s.x : s.y, alongX ? e.x : e.y) + CLEARANCE : Math.min(alongX ? s.x : s.y, alongX ? e.x : e.y) - CLEARANCE;
    const corridor = obstacles.filter((b) => {
      const [a0, a1] = alongX ? [b.y, b.y + b.height] : [b.x, b.x + b.width];
      const [c0, c1] = alongX ? [b.x, b.x + b.width] : [b.y, b.y + b.height];
      return a1 > lo && a0 < hi && (sign < 0 ? c0 < inner : c1 > inner);
    });
    // The outer run: past both ends by a stub, then past anything in its way.
    let far = sign < 0 ? Math.min(alongX ? s.x : s.y, alongX ? e.x : e.y) - ROUTE_STUB : Math.max(alongX ? s.x : s.y, alongX ? e.x : e.y) + ROUTE_STUB;
    const run = () => (alongX ? [{ x: far, y: s.y }, { x: far, y: e.y }] : [{ x: s.x, y: far }, { x: e.x, y: far }]);
    for (let pass = 0; pass < 2; pass++) {
      const [a, b] = run();
      for (const box of corridor) {
        if (skip.has(box.id) || !segmentHitsBox(a!, b!, box, CLEARANCE)) continue;
        far = sign < 0 ? Math.min(far, (alongX ? box.x : box.y) - PORT_GUTTER) : Math.max(far, (alongX ? box.x + box.width : box.y + box.height) + PORT_GUTTER);
      }
    }
    const points = simplify([s, ...run(), e]);
    if (crossingsOf(points, corridor, skip) > 0) continue;
    const length = points.reduce((n, p, i) => (i ? n + Math.abs(p.x - points[i - 1]!.x) + Math.abs(p.y - points[i - 1]!.y) : 0), 0);
    if (best && best.length <= length) continue;
    best = {
      length,
      route: {
        points,
        fromSide: side,
        toSide: side,
        startRatio: [(startEdge.x - r.from.x) / r.from.width, (startEdge.y - r.from.y) / r.from.height],
        endRatio: [(endEdge.x - r.to.x) / r.to.width, (endEdge.y - r.to.y) / r.to.height],
        crossings: 0,
      },
    };
  }
  return best?.route ?? null;
}

/** Where a connector's label sits: centred on the route's longest segment. */
export function labelCenter(points: readonly Point[]): Point {
  let best = { length: -1, center: points[0] ?? { x: 0, y: 0 } };
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length > best.length) best = { length, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }
  return best.center;
}

/** Drops repeated and collinear points, so a straight run is one segment. */
export function simplify(points: readonly Point[]): Point[] {
  const outPts: Point[] = [];
  for (const p of points) {
    const last = outPts[outPts.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue;
    const prev = outPts[outPts.length - 2];
    if (prev && last && ((Math.abs(prev.x - last.x) < 0.5 && Math.abs(last.x - p.x) < 0.5) || (Math.abs(prev.y - last.y) < 0.5 && Math.abs(last.y - p.y) < 0.5))) {
      outPts[outPts.length - 1] = p;
      continue;
    }
    outPts.push(p);
  }
  return outPts;
}

/** Candidate right-angle routes between two ports, best first. */
function candidates(s: Point, e: Point, fromSide: Side, toSide: Side, blockers: readonly Box[]): Point[][] {
  const s1 = out(s, fromSide, ROUTE_STUB);
  const e1 = out(e, toSide, ROUTE_STUB);
  const list: Point[][] = [];
  if (horizontalSide(fromSide)) {
    if (Math.abs(s.y - e.y) < 0.5) list.push([s, e]);
    const midX = (s.x + e.x) / 2;
    list.push([s, { x: midX, y: s.y }, { x: midX, y: e.y }, e]);
    // Turn right after leaving, or just before arriving, so the vertical run sits in a different gap.
    list.push([s, { x: s1.x, y: s.y }, { x: s1.x, y: e.y }, e], [s, { x: e1.x, y: s.y }, { x: e1.x, y: e.y }, e]);
    // Around everything in the way: above or below the blockers, through the outer channel.
    const top = Math.min(s.y, e.y, ...blockers.map((b) => b.y)) - PORT_GUTTER;
    const bottom = Math.max(s.y, e.y, ...blockers.map((b) => b.y + b.height)) + PORT_GUTTER;
    for (const y of [top, bottom]) list.push([s, s1, { x: s1.x, y }, { x: e1.x, y }, e1, e]);
    // The vertical run just past a box in the way, in the gap beside it (a gutter the middle line misses).
    for (const x of gutterLines(s.x, e.x, blockers.flatMap((b) => [b.x, b.x + b.width]))) list.push([s, { x, y: s.y }, { x, y: e.y }, e]);
  } else {
    if (Math.abs(s.x - e.x) < 0.5) list.push([s, e]);
    const midY = (s.y + e.y) / 2;
    list.push([s, { x: s.x, y: midY }, { x: e.x, y: midY }, e]);
    list.push([s, { x: s.x, y: s1.y }, { x: e.x, y: s1.y }, e], [s, { x: s.x, y: e1.y }, { x: e.x, y: e1.y }, e]);
    const left = Math.min(s.x, e.x, ...blockers.map((b) => b.x)) - PORT_GUTTER;
    const right = Math.max(s.x, e.x, ...blockers.map((b) => b.x + b.width)) + PORT_GUTTER;
    for (const x of [left, right]) list.push([s, s1, { x, y: s1.y }, { x, y: e1.y }, e1, e]);
    // The horizontal run just past a box in the way, in the gap above or below it (a gutter the middle line misses).
    for (const y of gutterLines(s.y, e.y, blockers.flatMap((b) => [b.y, b.y + b.height]))) list.push([s, { x: s.x, y }, { x: e.x, y }, e]);
  }
  return list;
}

/** Lines between `a` and `b` that run `2 × PORT_GUTTER` clear of each box edge in `edges`, nearest the middle first. */
function gutterLines(a: number, b: number, edges: readonly number[]): number[] {
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)];
  const mid = (lo + hi) / 2;
  const lines = edges.flatMap((edge) => [edge - PORT_GUTTER * 2, edge + PORT_GUTTER * 2]).filter((v) => v > lo + ROUTE_STUB / 2 && v < hi - ROUTE_STUB / 2);
  return [...new Set(lines)].sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
}

/** Whether a route leaves and enters at right angles to its sides (Archify's "side is a direction contract"). */
function honoursSides(points: readonly Point[], fromSide: Side, toSide: Side): boolean {
  if (points.length < 2) return false;
  const [a, b] = [points[0]!, points[1]!];
  const [y, z] = [points[points.length - 2]!, points[points.length - 1]!];
  const leaves = (p: Point, q: Point, side: Side) => {
    const v = OUTWARD[side];
    return v.x !== 0 ? Math.abs(p.y - q.y) < 0.5 && (q.x - p.x) * v.x > 0 : Math.abs(p.x - q.x) < 0.5 && (q.y - p.y) * v.y > 0;
  };
  return leaves(a, b, fromSide) && leaves(z, y, toSide);
}

/**
 * Routes a set of connectors together (ports are spread across the whole set).
 * `obstacles` are every box a route should avoid; each connector's own two ends are skipped.
 */
export function routeConnectors(requests: readonly ConnectorRequest[], obstacles: readonly RoutedBox[], gap = CONNECTOR_GAP): Map<string, ConnectorRoute> {
  // First pass: the sides each connector ends up using, detours included. A detour moves a connector to other sides
  // (a link to a far frame leaving from the bottom, not the right), where its port would sit in the middle of the
  // ports spread for the others: so the ports are spread again over the sides actually used, and routed on them.
  const first = routeOnSides(requests, obstacles, gap, new Map(requests.map((r) => [r.key, connectorSides(r.from, r.to)])), true);
  const actual = new Map(requests.map((r) => [r.key, { fromSide: first.get(r.key)!.fromSide, toSide: first.get(r.key)!.toSide }]));
  const moved = requests.some((r) => {
    const d = connectorSides(r.from, r.to);
    const a = actual.get(r.key)!;
    return d.fromSide !== a.fromSide || d.toSide !== a.toSide;
  });
  const routes = moved ? routeOnSides(requests, obstacles, gap, actual, false) : first;
  // A re-route that crosses more than the first pass did keeps the first pass's route.
  if (moved) for (const r of requests) if (routes.get(r.key)!.crossings > first.get(r.key)!.crossings) routes.set(r.key, first.get(r.key)!);
  separateLanes(routes, requests, obstacles);
  return routes;
}

/**
 * Routes every connector on the given sides, with ports spread over them. With `detours`, a connector whose sides
 * are blocked may take a C-shaped or other-axis route instead (and reports its new sides); without, the sides are
 * kept, each routed by the builder that fits them.
 */
function routeOnSides(
  requests: readonly ConnectorRequest[],
  obstacles: readonly RoutedBox[],
  gap: number,
  sides: Map<string, { fromSide: Side; toSide: Side }>,
  detours: boolean,
): Map<string, ConnectorRoute> {
  const offsets = spreadPorts(requests, sides);
  const routes = new Map<string, ConnectorRoute>();
  for (const r of requests) {
    const { fromSide, toSide } = sides.get(r.key)!;
    const off = offsets.get(r.key)!;
    const skip = new Set([r.from.id, r.to.id]);
    const all = r.avoid?.length ? [...obstacles, ...r.avoid] : obstacles;
    if (!detours) {
      const defaultSide = connectorSides(r.from, r.to).fromSide;
      const forced =
        fromSide === toSide
          ? sameSideRoute(r, defaultSide, gap, all, skip, off, fromSide)
          : horizontalSide(fromSide) !== horizontalSide(defaultSide)
            ? otherAxisRoute(r, defaultSide, gap, all, skip, off)
            : null;
      if (forced) {
        routes.set(r.key, forced);
        continue;
      }
    }
    let startEdge = portOn(r.from, fromSide, off.from);
    let endEdge = portOn(r.to, toSide, off.to);
    // Facing ports only a few pixels apart would make a tiny jog: when exactly one end was spread, the other moves onto
    // its line if it stays clear of its own box's corners (Archify keeps such ports on one shared axis).
    if (off.fromShared !== off.toShared) {
      const alongY = horizontalSide(fromSide);
      const delta = alongY ? endEdge.y - startEdge.y : endEdge.x - startEdge.x;
      if (delta !== 0 && Math.abs(delta) < PORT_GUTTER) {
        const [box, edge] = off.fromShared ? [r.to, endEdge] : [r.from, startEdge];
        const target = off.fromShared ? startEdge : endEdge;
        const lo = (alongY ? box.y : box.x) + PORT_GUTTER;
        const hi = (alongY ? box.y + box.height : box.x + box.width) - PORT_GUTTER;
        const want = alongY ? target.y : target.x;
        if (want >= lo && want <= hi) {
          const moved = alongY ? { x: edge.x, y: want } : { x: want, y: edge.y };
          if (off.fromShared) endEdge = moved;
          else startEdge = moved;
        }
      }
    }
    const s = out(startEdge, fromSide, gap);
    const e = out(endEdge, toSide, gap);
    const span = { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y), width: Math.abs(s.x - e.x), height: Math.abs(s.y - e.y) };
    const blockers = all.filter((b) => !skip.has(b.id) && segmentHitsBox({ x: span.x, y: span.y }, { x: span.x + span.width, y: span.y + span.height }, b, CLEARANCE));
    const options = candidates(s, e, fromSide, toSide, blockers).map(simplify);
    // Every candidate stays inside this region, so only the obstacles in it can be crossed (same result, far fewer tests).
    const xs = options.flatMap((pts) => pts.map((p) => p.x));
    const ys = options.flatMap((pts) => pts.map((p) => p.y));
    const region = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const nearby = all.filter((b) => !skip.has(b.id) && segmentHitsBox({ x: region.x, y: region.y }, { x: region.x + region.width, y: region.y + region.height }, b, CLEARANCE));
    let best: { points: Point[]; crossings: number } | null = null;
    for (const points of options) {
      if (!honoursSides(points, fromSide, toSide)) continue;
      const crossings = crossingsOf(points, nearby, skip) + (r.wide ? ownNameHits(points, r) : 0);
      if (!best || crossings < best.crossings) best = { points, crossings };
      if (crossings === 0) break;
    }
    // A detour (the facing sides are blocked by a box between the two): a C-shaped route out of and back into the
    // same outer side is shorter, and crosses none of the links that join the boxes between them on their facing
    // sides — in a stack of cards, a link skipping one no longer cuts across its neighbours' links (Wave D).
    if (detours && best && (best.points.length >= 5 || best.crossings > 0) && skipsABox(r.from, r.to, fromSide, blockers)) {
      const c = sameSideRoute(r, fromSide, gap, all, skip, off);
      if (c) {
        routes.set(r.key, c);
        continue;
      }
    }
    // Still through a box: the sides were chosen by the wider gap alone, and that side may be taken (in a tree, a
    // node's right side is where its explanations sit). The other axis's sides, when they cross less, win.
    if (detours && best && best.crossings > 0) {
      const other = otherAxisRoute(r, fromSide, gap, all, skip, off);
      if (other && other.crossings < best.crossings) {
        routes.set(r.key, other);
        continue;
      }
    }
    const points = best?.points ?? [s, e];
    routes.set(r.key, {
      points,
      fromSide,
      toSide,
      startRatio: [(startEdge.x - r.from.x) / r.from.width, (startEdge.y - r.from.y) / r.from.height],
      endRatio: [(endEdge.x - r.to.x) / r.to.width, (endEdge.y - r.to.y) / r.to.height],
      crossings: best?.crossings ?? 0,
    });
  }
  return routes;
}

/**
 * Parallel runs of different links between sections (`wide`) that share a gutter — the middle segments, never the
 * stubs at the ports — are
 * moved `LANE_SPACING` apart, in order along the run, so links that leave a frame together don't merge into one line
 * and their labels don't stack. A run is only moved when the route still leaves and enters its sides at right angles
 * and crosses no more boxes than before.
 */
function separateLanes(routes: Map<string, ConnectorRoute>, requests: readonly ConnectorRequest[], obstacles: readonly RoutedBox[]): void {
  const byKey = new Map(requests.map((r) => [r.key, r]));
  type Run = { key: string; i: number; at: number; lo: number; hi: number };
  for (const horizontal of [true, false]) {
    const runs: Run[] = [];
    for (const [key, route] of routes) {
      // Links between sections only: they share the gutters between frames. A link inside a section keeps its route
      // (a lane shift there could land on the section's own border).
      if (!byKey.get(key)?.wide) continue;
      const p = route.points;
      for (let i = 1; i + 2 < p.length; i += 1) {
        const [a, b] = [p[i]!, p[i + 1]!];
        const flat = horizontal ? Math.abs(a.y - b.y) < 0.5 : Math.abs(a.x - b.x) < 0.5;
        if (!flat) continue;
        const [u, v] = horizontal ? [a.x, b.x] : [a.y, b.y];
        runs.push({ key, i, at: horizontal ? a.y : a.x, lo: Math.min(u, v), hi: Math.max(u, v) });
      }
    }
    // Runs of different links on (nearly) one line, overlapping along it: one lane group.
    runs.sort((a, b) => a.at - b.at || a.lo - b.lo);
    const used = new Set<Run>();
    for (const first of runs) {
      if (used.has(first)) continue;
      const group = [first];
      used.add(first);
      // Sorted by line: runs within `LANE_GROUP` of the group's last line (and overlapping one of it along the run) share
      // its gutter and join it — their order there is what makes them cross — however many there are; past that,
      // nothing further can join.
      let last = first.at;
      for (let j = runs.indexOf(first) + 1; j < runs.length && runs[j]!.at - last < LANE_GROUP; j += 1) {
        const other = runs[j]!;
        if (used.has(other) || group.some((g) => g.key === other.key)) continue;
        if (group.some((g) => other.lo < g.hi && g.lo < other.hi)) {
          group.push(other);
          used.add(other);
          last = other.at;
        }
      }
      if (group.length < 2) continue;
      group.sort((a, b) => a.lo - b.lo || (a.key < b.key ? -1 : 1));
      const base = group.reduce((n, g) => n + g.at, 0) / group.length;
      /** The group's routes with its runs in lanes in `order` (a run that can't move keeps its line). */
      const laid = (order: readonly Run[]) =>
        order.map((g, k) => {
          const route = routes.get(g.key)!;
          const shift = base + (k - (group.length - 1) / 2) * LANE_SPACING - g.at;
          if (Math.abs(shift) < 0.5) return [g.key, route] as const;
          const r = byKey.get(g.key)!;
          const points = route.points.map((p, j) => (j === g.i || j === g.i + 1 ? (horizontal ? { x: p.x, y: p.y + shift } : { x: p.x + shift, y: p.y }) : p));
          const all = r.avoid?.length ? [...obstacles, ...r.avoid] : obstacles;
          const skip = new Set([r.from.id, r.to.id]);
          // The moved run itself stays out of its own two frames' name bands (it only crosses them to enter or leave).
          const own = [frameNameBand(r.from), frameNameBand(r.to)];
          const clearOfNames = !own.some((band) => segmentHitsBox(points[g.i]!, points[g.i + 1]!, band, 0));
          const ok = clearOfNames && honoursSides(points, route.fromSide, route.toSide) && crossingsOf(points, all, skip) <= crossingsOf(route.points, all, skip);
          return [g.key, ok ? { ...route, points } : route] as const;
        });
      // The lane order whose links cross each other least (in order along the run when it ties): which lane each
      // link takes decides whether its turn cuts across its neighbours'.
      // Only links near the group can cross its turns: the rest of a large map isn't counted.
      const lo = Math.min(...group.map((g) => g.lo)) - LANE_SPACING;
      const hi = Math.max(...group.map((g) => g.hi)) + LANE_SPACING;
      const near = base - LANE_SPACING * group.length;
      const far = base + LANE_SPACING * group.length;
      const nearby = [...routes.entries()].filter(([k, r]) => group.some((g) => g.key === k) || r.points.some((p, j) => {
        const q = r.points[j + 1];
        if (!q) return false;
        const [u0, u1] = horizontal ? [Math.min(p.x, q.x), Math.max(p.x, q.x)] : [Math.min(p.y, q.y), Math.max(p.y, q.y)];
        const [v0, v1] = horizontal ? [Math.min(p.y, q.y), Math.max(p.y, q.y)] : [Math.min(p.x, q.x), Math.max(p.x, q.x)];
        return u1 >= lo && u0 <= hi && v1 >= near - 64 && v0 <= far + 64;
      }));
      let best: { routes: (readonly [string, ConnectorRoute])[]; cuts: number } | null = null;
      for (const order of group.length <= 4 ? permutations(group) : [group]) {
        const next = laid(order);
        const all = new Map(nearby);
        for (const [k, r] of next) all.set(k, r);
        const cuts = linkCrossings([...all.values()].map((r) => r.points));
        if (!best || cuts < best.cuts) best = { routes: next, cuts };
        if (cuts === 0) break;
      }
      for (const [k, r] of best!.routes) routes.set(k, r);
    }
  }
}

/**
 * How many of a section link's middle runs cross its own two frames' name bands: it may cross them only on the stubs
 * it leaves and enters by, never run along one (where it would cover the section's name).
 */
function ownNameHits(points: readonly Point[], r: ConnectorRequest): number {
  const bands = [frameNameBand(r.from), frameNameBand(r.to)];
  let hits = 0;
  for (let i = 1; i + 2 < points.length; i += 1) for (const band of bands) if (segmentHitsBox(points[i]!, points[i + 1]!, band, 0)) hits += 1;
  return hits;
}

/** Every ordering of `items` (for small lane groups only). */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

/** How many times the routes' segments cross one another (right-angle routes: a horizontal across a vertical). */
function linkCrossings(routes: readonly (readonly Point[])[]): number {
  type Seg = { a: Point; b: Point; route: number };
  const h: Seg[] = [];
  const v: Seg[] = [];
  routes.forEach((points, route) => {
    for (let i = 0; i + 1 < points.length; i += 1) {
      const [a, b] = [points[i]!, points[i + 1]!];
      if (Math.abs(a.y - b.y) < 0.5) h.push({ a, b, route });
      else if (Math.abs(a.x - b.x) < 0.5) v.push({ a, b, route });
    }
  });
  let n = 0;
  for (const s of h) {
    const [x0, x1] = [Math.min(s.a.x, s.b.x), Math.max(s.a.x, s.b.x)];
    for (const t of v) {
      if (t.route === s.route) continue;
      const [y0, y1] = [Math.min(t.a.y, t.b.y), Math.max(t.a.y, t.b.y)];
      if (t.a.x > x0 + 0.5 && t.a.x < x1 - 0.5 && s.a.y > y0 + 0.5 && s.a.y < y1 - 0.5) n += 1;
    }
  }
  return n;
}

/**
 * Where a connector's label of `width` × `height` goes: the middle of the route's longest segment, unless that box
 * would cover one of `taken` (labels already placed) — then the first clear spot along the route's segments, longest
 * first, sliding along each. Falls back to the longest segment's middle.
 */
export function placeLabel(points: readonly Point[], width: number, height: number, taken: readonly Box[]): Point {
  const at = labelCenter(points);
  const boxAt = (c: Point): Box => ({ x: c.x - width / 2 - 4, y: c.y - height / 2 - 2, width: width + 8, height: height + 4 });
  const clear = (c: Point) => !taken.some((t) => { const b = boxAt(c); return b.x < t.x + t.width && t.x < b.x + b.width && b.y < t.y + t.height && t.y < b.y + b.height; });
  if (clear(at)) return at;
  const segments = points.slice(1).map((b, i) => [points[i]!, b] as const).sort(([a1, b1], [a2, b2]) => Math.abs(a2.x - b2.x) + Math.abs(a2.y - b2.y) - (Math.abs(a1.x - b1.x) + Math.abs(a1.y - b1.y)));
  for (const [a, b] of segments) {
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const along = Math.abs(a.x - b.x) > 0.5 ? width : height;
    if (length < along + 8) continue;
    // From the middle outwards, both ways.
    const steps = Math.floor((length - along) / 2 / 12);
    for (let k = 1; k <= steps; k += 1) {
      for (const dir of [1, -1]) {
        const t = 0.5 + (dir * k * 12) / length;
        const c = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (clear(c)) return c;
      }
    }
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (clear(mid)) return mid;
  }
  return at;
}
