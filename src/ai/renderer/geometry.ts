/**
 * One geometry report for a change set on a scene (organisation-layout plan §3.1, F0): the layout checks the review
 * bar already runs (`checkProposal`: links through cards, crossings, corridors, frame borders, label collisions), plus
 * the box checks the golden layout gate used to keep its own copies of (overlaps, containment), plus what selection
 * actions need (reading order, frames that can't be read whole, user-placed objects moved, changes outside the
 * selection). Pure: it reads boxes and polylines, never moves anything.
 *
 * Built on `proposalGeometry` (the live scene with the set's moves and removals applied, its new objects and frames,
 * its new connectors routed as the writer routes them), so the same report judges a first run on an empty canvas and
 * a Re-arrange or Update on a canvas the user has changed.
 *
 * Names: a created object by its change key, an existing one by its element id.
 */
import type { Box, ProposedChange } from "@/ai/changes/changeSet";
import type { LayoutReport } from "@/ai/changes/layoutCheck";
import { checkLayout } from "@/ai/changes/layoutCheck";
import { isObstacle, proposalGeometry } from "@/ai/changes/proposalGeometry";
import { isWhereAcutePlacedIt, type SceneElement } from "@/domain/canvas/adapter";
import { FIT_SCREEN, READABLE_FIT_ZOOM } from "./screen";

export interface GeometryReport {
  /** `checkProposal` as today: link_through_card (fatal), crossings, corridors, frame borders, label collisions. */
  layout: LayoutReport;
  /** Pairs of cards (at least one created or moved) whose boxes overlap ("a × b"). Backdrops are behind by design and never count. */
  cardOverlaps: string[];
  /** Pairs of frames (at least one created or moved) that overlap. */
  frameOverlaps: string[];
  /** A card not inside the frame that lists it (`create_frame` children, `update_frame` add): "card outside frame". */
  outsideFrames: string[];
  /** A sub-group member not inside its backdrop (`options.subGroups`): "card outside backdrop". */
  outsideSubGroups: string[];
  /** A card-to-card link that passes over a third frame (one that holds neither of its ends): "link over frame". */
  linksOverFrames: string[];
  /** Pairs of frames whose plan order disagrees with row-major canvas order (rows: frames whose vertical extents overlap). */
  readingOrder: { inversions: number; detail: string[] };
  /** A frame that can't be read whole at `READABLE_FIT_ZOOM` on `FIT_SCREEN` (wider than 3,200 px or taller than 1,800 px). */
  oversizedFrames: string[];
  /** Existing objects the user placed (`isWhereAcutePlacedIt` false) that the change set moves. */
  movedUserPlaced: string[];
  /** Changes that touch objects outside the allowed frames (`options.scope`); empty without a scope. */
  outsideScope: string[];
}

export interface GeometryOptions {
  /** The frames a selection action may change (element ids, or created frames' keys). Absent: no scope check. */
  scope?: ReadonlySet<string>;
  /** Frames in the plan's reading order (created frames' keys, existing frames' ids). Default: the set's `create_frame` order. */
  planOrder?: readonly string[];
  /** Sub-group backdrops and the cards each holds (backdrop key or id → member keys or ids), for `outsideSubGroups`. */
  subGroups?: ReadonlyMap<string, readonly string[]>;
}

/** Boxes within this many pixels count as touching, not overlapping (the golden gate's tolerance). */
const TOLERANCE = 1;
/** A link inside a frame by more than this passes over it (as `checkLayout` treats cards). */
const INSET = 2;
const CREATED = "created:";

const nameOf = (id: string) => (id.startsWith(CREATED) ? id.slice(CREATED.length) : id);
const boxOf = (b: Box): Box => ({ x: b.x, y: b.y, width: b.width, height: b.height });

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x + a.width - TOLERANCE > b.x && b.x + b.width - TOLERANCE > a.x && a.y + a.height - TOLERANCE > b.y && b.y + b.height - TOLERANCE > a.y;
}

export function boxInside(inner: Box, outer: Box): boolean {
  return inner.x >= outer.x - TOLERANCE && inner.y >= outer.y - TOLERANCE && inner.x + inner.width <= outer.x + outer.width + TOLERANCE && inner.y + inner.height <= outer.y + outer.height + TOLERANCE;
}

type Point = { x: number; y: number };

/** Whether segment a–b enters `box` shrunk by `inset` (Liang–Barsky; exact for any direction). */
function segmentEnters(a: Point, b: Point, box: Box, inset: number): boolean {
  const x0 = box.x + inset;
  const x1 = box.x + box.width - inset;
  const y0 = box.y + inset;
  const y1 = box.y + box.height - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ] as const) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1) return false;
  }
  return true;
}

/** Frame ids in row-major canvas order: rows are frames whose vertical extents overlap, read top to bottom, each left to right. */
export function rowMajorOrder(frames: readonly { id: string; box: Box }[]): string[] {
  const byTop = [...frames].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const rows: { bottom: number; members: { id: string; box: Box }[] }[] = [];
  for (const f of byTop) {
    const row = rows.at(-1);
    if (row && f.box.y < row.bottom) {
      row.members.push(f);
      row.bottom = Math.max(row.bottom, f.box.y + f.box.height);
    } else rows.push({ bottom: f.box.y + f.box.height, members: [f] });
  }
  return rows.flatMap((r) => r.members.sort((a, b) => a.box.x - b.box.x).map((m) => m.id));
}

/** Pairs of `planOrder` frames that the canvas reads the other way round. */
export function readingOrderOf(frames: readonly { id: string; box: Box }[], planOrder: readonly string[]): { inversions: number; detail: string[] } {
  const known = new Set(frames.map((f) => f.id));
  const order = planOrder.filter((id) => known.has(id));
  const rank = new Map(rowMajorOrder(frames.filter((f) => order.includes(f.id))).map((id, i) => [id, i] as const));
  const detail: string[] = [];
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) if (rank.get(order[i]!)! > rank.get(order[j]!)!) detail.push(`${order[j]} reads before ${order[i]}`);
  return { inversions: detail.length, detail };
}

export function geometryOf(changes: readonly ProposedChange[], scene: readonly SceneElement[], options: GeometryOptions = {}): GeometryReport {
  const g = proposalGeometry(changes, scene);
  const layout = checkLayout(g, { focus: g.focus });
  const byId = new Map(scene.filter((el) => !el.isDeleted).map((el) => [el.id, el] as const));
  const removed = new Set(changes.flatMap((c) => (c.kind === "remove" ? [c.target] : [])));
  const moved = new Set(changes.flatMap((c) => (c.kind === "move" ? [c.target] : [])));

  // Backdrops sit behind what they group: never a card for overlaps (nor for links: `proposalGeometry` keeps them out
  // of `g.cards`), but their boxes are kept for `outsideSubGroups`.
  const cards = g.cards;
  const cardBox = new Map([...g.cards, ...g.backdrops].map((c) => [c.id, boxOf(c)] as const));
  const frameBox = new Map(g.frames.map((f) => [f.id, boxOf(f)] as const));
  const touched = (id: string) => id.startsWith(CREATED) || moved.has(id);

  // Overlaps: existing cards first (scene order), then created ones (change order); pairs with at least one touched.
  const cardOverlaps: string[] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i]!;
      const b = cards[j]!;
      if ((touched(a.id) || touched(b.id)) && boxesOverlap(a, b)) cardOverlaps.push(`${nameOf(a.id)} × ${nameOf(b.id)}`);
    }
  }
  const frameOverlaps: string[] = [];
  for (let i = 0; i < g.frames.length; i++) {
    for (let j = i + 1; j < g.frames.length; j++) {
      const a = g.frames[i]!;
      const b = g.frames[j]!;
      if ((touched(a.id) || touched(b.id)) && boxesOverlap(a, b)) frameOverlaps.push(`${nameOf(a.id)} × ${nameOf(b.id)}`);
    }
  }

  // Which frame lists each card: created frames' children, frames that gain members, and existing cards' own frame.
  const listed: { frame: string; card: string }[] = [];
  for (const c of changes) {
    if (c.kind === "create_frame") for (const k of c.children) listed.push({ frame: CREATED + c.key, card: CREATED + k });
    else if (c.kind === "update_frame") for (const k of c.add) listed.push({ frame: c.target, card: CREATED + k });
  }
  const frameOfCard = new Map<string, string>(listed.map((l) => [l.card, l.frame] as const));
  for (const el of byId.values()) if (el.frameId && !removed.has(el.id) && isObstacle(el) && !frameOfCard.has(el.id)) frameOfCard.set(el.id, el.frameId);
  const outsideFrames = listed.flatMap(({ frame, card }) => {
    const box = cardBox.get(card);
    const outer = frameBox.get(frame);
    return box && outer && !boxInside(box, outer) ? [`${nameOf(card)} outside ${nameOf(frame)}`] : [];
  });

  const idOf = (name: string) => (cardBox.has(name) || frameBox.has(name) ? name : CREATED + name);
  const outsideSubGroups: string[] = [];
  for (const [backdrop, members] of options.subGroups ?? []) {
    const outer = cardBox.get(idOf(backdrop));
    if (!outer) continue;
    for (const m of members) {
      const box = cardBox.get(idOf(m));
      if (box && !boxInside(box, outer)) outsideSubGroups.push(`${m} outside ${backdrop}`);
    }
  }

  // Links over a third frame: card-to-card links this set draws or re-routes.
  const linksOverFrames: string[] = [];
  for (const link of g.links) {
    if (!g.focus.has(link.key) || frameBox.has(link.fromId) || frameBox.has(link.toId)) continue;
    const own = new Set([frameOfCard.get(link.fromId), frameOfCard.get(link.toId)]);
    for (const f of g.frames) {
      if (own.has(f.id)) continue;
      const over = link.points.some((p, i) => i > 0 && segmentEnters(link.points[i - 1]!, p, f, INSET));
      if (over) linksOverFrames.push(`${nameOf(link.key)} over ${nameOf(f.id)}`);
    }
  }

  const frames = g.frames.map((f) => ({ id: nameOf(f.id), box: boxOf(f) }));
  const planOrder = options.planOrder ?? changes.flatMap((c) => (c.kind === "create_frame" ? [c.key] : []));
  const readingOrder = readingOrderOf(frames, planOrder);

  const maxWidth = FIT_SCREEN.width / READABLE_FIT_ZOOM;
  const maxHeight = FIT_SCREEN.height / READABLE_FIT_ZOOM;
  const changedFrames = new Set(changes.flatMap((c) => (c.kind === "update_frame" ? [c.target] : [])));
  const oversizedFrames = g.frames
    .filter((f) => (touched(f.id) || changedFrames.has(f.id)) && (f.width > maxWidth || f.height > maxHeight))
    .map((f) => `${nameOf(f.id)} (${Math.round(f.width)} × ${Math.round(f.height)})`);

  const movedUserPlaced = [...moved].filter((id) => {
    const el = byId.get(id);
    return el && !isWhereAcutePlacedIt(el);
  });

  return { layout, cardOverlaps, frameOverlaps, outsideFrames, outsideSubGroups, linksOverFrames, readingOrder, oversizedFrames, movedUserPlaced, outsideScope: outsideScopeOf(changes, byId, frameOfCard, cardBox, frameBox, options.scope) };
}

/** Rule 4 as a function: every change must stay inside the `scope` frames. */
function outsideScopeOf(
  changes: readonly ProposedChange[],
  byId: ReadonlyMap<string, SceneElement>,
  frameOfCard: ReadonlyMap<string, string>,
  cardBox: ReadonlyMap<string, Box>,
  frameBox: ReadonlyMap<string, Box>,
  scope: ReadonlySet<string> | undefined,
): string[] {
  if (!scope) return [];
  const scopeBoxes = [...scope].flatMap((id) => {
    const b = frameBox.get(id) ?? frameBox.get(CREATED + id);
    return b ? [b] : [];
  });
  /** An existing object is in scope when it is one of the frames or sits in one. */
  const existingIn = (id: string) => {
    const el = byId.get(id);
    if (!el) return true; // not on the canvas: nothing outside the selection to change
    return scope.has(id) || (!!el.frameId && scope.has(el.frameId));
  };
  /** A created object is in scope when a scope frame lists it, or its box lies inside one. */
  const createdIn = (key: string) => {
    const frame = frameOfCard.get(CREATED + key);
    if (frame) return scope.has(frame) || scope.has(nameOf(frame));
    const box = cardBox.get(CREATED + key);
    return !!box && scopeBoxes.some((b) => boxInside(box, b));
  };
  const out: string[] = [];
  for (const c of changes) {
    switch (c.kind) {
      case "create_block":
      case "create_shape":
      case "create_page":
        if (!createdIn(c.key)) out.push(`${c.kind} ${c.key}`);
        break;
      case "create_frame":
        if (!scope.has(c.key)) out.push(`create_frame ${c.key}`);
        break;
      case "group_objects":
        for (const t of c.targets) if (!existingIn(t)) out.push(`group_objects ${t}`);
        break;
      case "connect":
        for (const end of [c.from, c.to]) if ("existing" in end && !existingIn(end.existing)) out.push(`connect ${c.key} to ${end.existing}`);
        break;
      case "update_frame":
        if (!scope.has(c.target)) out.push(`update_frame ${c.target}`);
        break;
      default:
        if ("target" in c && !existingIn(c.target)) out.push(`${c.kind} ${c.target}`);
    }
  }
  return out;
}
