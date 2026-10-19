/**
 * Layout checks on a proposal's geometry (Wave 1b item 4, after Archify's validator —
 * github.com/tt-a1i/archify, MIT, `references/authoring-contract.md`: stable codes, a
 * subject, evidence and supported fixes). Pure and deterministic: boxes and polylines in,
 * a report out. It measures; it never moves anything.
 *
 * Codes:
 * - `link_through_card` (fatal): a link's route crosses a card that isn't one of its ends.
 * - `links_cross`: two links' routes cross each other.
 * - `links_share_corridor`: two links run along the same line for a stretch, so the eye
 *   can't tell them apart.
 * - `link_on_frame_border`: a link runs along a section frame's border.
 * - `label_collision`: a link's label sits on a card or on another link's label.
 *
 * Only issues that involve at least one link or card in `focus` are reported (default:
 * everything), so a proposal is judged on what it adds or moves, not on a canvas's older mess.
 */
import type { Box } from "./changeSet";
import { labelCenter, type Point, type RoutedBox } from "./routing";

export type LayoutIssueCode = "link_through_card" | "links_cross" | "links_share_corridor" | "link_on_frame_border" | "label_collision";

export interface LayoutLink {
  key: string;
  fromId: string;
  toId: string;
  /** Absolute polyline; every segment horizontal or vertical for routed links (others are checked as drawn). */
  points: readonly Point[];
  label?: string;
  /** Where the label's centre is, when known (it may sit off the longest segment's middle to clear another label). */
  labelAt?: Point;
}

export interface LayoutGeometry {
  /** Cards: every object a link should keep clear of (not frames, labels or links). */
  cards: readonly RoutedBox[];
  frames: readonly RoutedBox[];
  links: readonly LayoutLink[];
}

export interface LayoutIssue {
  code: LayoutIssueCode;
  severity: "fatal" | "warning";
  /** The link keys (and object ids) the issue is about. */
  subject: string[];
  evidence: string;
  /** What fixes it, in order of preference. */
  fixes: string[];
}

export interface LayoutCounts {
  throughCards: number;
  crossings: number;
  sharedCorridors: number;
  onFrameBorders: number;
  labelCollisions: number;
}

export interface LayoutReport {
  issues: LayoutIssue[];
  counts: LayoutCounts;
  /** Lower is cleaner: fatal issues weigh most. For comparing two layouts of the same content. */
  score: number;
  /** More issues were found than listed. */
  truncated: boolean;
}

export const LAYOUT_LIMITS = { issues: 50 } as const;

/** Inside a card by more than this counts as crossing it (routes keep 6 px clearance; touching the end's edge is fine). */
const INSET = 2;
/** Two parallel segments this close, overlapping at least `CORRIDOR_MIN`, share a corridor. */
const CORRIDOR_GAP = 4;
const CORRIDOR_MIN = 24;
/** A segment this close to a frame edge, along at least `CORRIDOR_MIN`, runs on the border. */
const BORDER_GAP = 4;

const FIXES: Record<LayoutIssueCode, string[]> = {
  link_through_card: ["drop the link if it adds little", "move one of its ends so the path is clear", "split the section so the ends sit side by side"],
  links_cross: ["drop the lower-value link", "reorder the cards so linked ones are neighbours", "link at the overview level instead"],
  links_share_corridor: ["drop one of the links", "move one end so the links leave different sides"],
  link_on_frame_border: ["move the card off the frame edge", "link to the section's title card instead"],
  label_collision: ["shorten or drop the label", "move one of the linked cards"],
};

const WEIGHT: Record<LayoutIssueCode, number> = { link_through_card: 10, links_cross: 2, links_share_corridor: 2, link_on_frame_border: 1, label_collision: 1 };

type Segment = { a: Point; b: Point; horizontal: boolean; vertical: boolean };

function segmentsOf(points: readonly Point[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) continue;
    out.push({ a, b, horizontal: Math.abs(a.y - b.y) < 0.5, vertical: Math.abs(a.x - b.x) < 0.5 });
  }
  return out;
}

/** Whether segment a–b passes through the inside of `box` (shrunk by `inset`); exact for axis-aligned segments, sampled otherwise. */
function segmentEntersBox(s: Segment, box: Box, inset: number): boolean {
  const x0 = box.x + inset;
  const x1 = box.x + box.width - inset;
  const y0 = box.y + inset;
  const y1 = box.y + box.height - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  if (s.horizontal || s.vertical) {
    const minX = Math.min(s.a.x, s.b.x);
    const maxX = Math.max(s.a.x, s.b.x);
    const minY = Math.min(s.a.y, s.b.y);
    const maxY = Math.max(s.a.y, s.b.y);
    return maxX > x0 && minX < x1 && maxY > y0 && minY < y1;
  }
  // Liang–Barsky clip of a diagonal segment against the box.
  let t0 = 0;
  let t1 = 1;
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  for (const [p, q] of [
    [-dx, s.a.x - x0],
    [dx, x1 - s.a.x],
    [-dy, s.a.y - y0],
    [dy, y1 - s.a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 >= t1) return false;
  }
  return true;
}

/** A proper crossing of two segments (not touching at an end, not collinear). */
function segmentsCross(s: Segment, t: Segment): boolean {
  const d = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = d(t.a, t.b, s.a);
  const d2 = d(t.a, t.b, s.b);
  const d3 = d(s.a, s.b, t.a);
  const d4 = d(s.a, s.b, t.b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Length of the stretch two parallel axis-aligned segments run together within `gap`, else 0. */
function sharedRun(s: Segment, t: Segment, gap: number): number {
  if (s.horizontal && t.horizontal && Math.abs(s.a.y - t.a.y) <= gap) {
    return Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)) - Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x));
  }
  if (s.vertical && t.vertical && Math.abs(s.a.x - t.a.x) <= gap) {
    return Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y));
  }
  return 0;
}

/** How long a segment runs along one of `frame`'s edges. */
function runOnBorder(s: Segment, frame: Box): number {
  const edges: Segment[] = [
    { a: { x: frame.x, y: frame.y }, b: { x: frame.x + frame.width, y: frame.y }, horizontal: true, vertical: false },
    { a: { x: frame.x, y: frame.y + frame.height }, b: { x: frame.x + frame.width, y: frame.y + frame.height }, horizontal: true, vertical: false },
    { a: { x: frame.x, y: frame.y }, b: { x: frame.x, y: frame.y + frame.height }, horizontal: false, vertical: true },
    { a: { x: frame.x + frame.width, y: frame.y }, b: { x: frame.x + frame.width, y: frame.y + frame.height }, horizontal: false, vertical: true },
  ];
  return Math.max(0, ...edges.map((e) => sharedRun(s, e, BORDER_GAP)));
}

/** The box a link's label takes (Excalidraw's 16 px label, roughly), centred on the route's longest segment. */
export function labelBox(link: LayoutLink): Box | null {
  const text = link.label?.trim();
  if (!text) return null;
  const c = link.labelAt ?? labelCenter(link.points);
  const { width, height } = labelSize(text);
  return { x: c.x - width / 2, y: c.y - height / 2, width, height };
}

/** The size of a link's label (Excalidraw's 16 px label, roughly). */
export function labelSize(text: string): { width: number; height: number } {
  return { width: Math.min(text.trim().length * 8.5, 220) + 8, height: 24 };
}

function boundsOf(points: readonly Point[], label: Box | null): Box {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  if (label) {
    xs.push(label.x, label.x + label.width);
    ys.push(label.y, label.y + label.height);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

const expand = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, width: b.width + 2 * d, height: b.height + 2 * d });

/** A uniform grid over boxes: which boxes may touch a query box, in index order. */
class Grid {
  private static readonly CELL = 400;
  private readonly cells = new Map<number, number[]>();

  constructor(private readonly boxes: readonly Box[]) {
    boxes.forEach((b, i) => this.forCells(b, (k) => (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i)));
  }

  private forCells(b: Box, visit: (key: number) => void) {
    const c = Grid.CELL;
    // Canvas coordinates are bounded (±1,000,000), so a cell's (x, y) packs into one safe integer.
    for (let cx = Math.floor(b.x / c); cx <= Math.floor((b.x + b.width) / c); cx += 1) {
      for (let cy = Math.floor(b.y / c); cy <= Math.floor((b.y + b.height) / c); cy += 1) visit(cx * 1_000_003 + cy);
    }
  }

  /** Indices of boxes whose bounds overlap `b` (touching counts), ascending. */
  near(b: Box): number[] {
    const found = new Set<number>();
    this.forCells(b, (k) => {
      for (const i of this.cells.get(k) ?? []) found.add(i);
    });
    return [...found].filter((i) => touches(this.boxes[i]!, b)).sort((x, y) => x - y);
  }
}

const touches = (a: Box, b: Box) => a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * `name`: how a caller refers to a link or card (e.g. repo-map keys instead of element ids), used in `subject` and
 * `evidence`; ids by default.
 */
export function checkLayout(geometry: LayoutGeometry, options: { focus?: ReadonlySet<string>; name?: (id: string) => string } = {}): LayoutReport {
  const inFocus = (key: string) => !options.focus || options.focus.has(key);
  const n = options.name ?? ((id: string) => id);
  // Segments are built only for links that get tested (most of a large map is far from what a proposal touches).
  const links = geometry.links.map((l) => {
    const label = labelBox(l);
    let segments: Segment[] | null = null;
    return {
      link: l,
      label,
      reach: expand(boundsOf(l.points, label), CORRIDOR_GAP + 1),
      get segments() {
        return (segments ??= segmentsOf(l.points));
      },
    };
  });
  const cards = geometry.cards;
  const all: LayoutIssue[] = [];
  const counts: LayoutCounts = { throughCards: 0, crossings: 0, sharedCorridors: 0, onFrameBorders: 0, labelCollisions: 0 };
  const push = (code: LayoutIssueCode, subject: string[], evidence: string) =>
    all.push({ code, severity: code === "link_through_card" ? "fatal" : "warning", subject: subject.map(n), evidence, fixes: FIXES[code] });

  // Spatial grids, so each focused link or card meets only what is near it (maps of 1,500 cards stay cheap).
  const cardGrid = new Grid(cards.map((c) => c as Box));
  const linkGrid = new Grid(links.map((l) => l.reach));
  const focusedLink = links.map((l) => inFocus(l.link.key));

  // Links through cards, and labels on cards: each (link, card) pair where either is in focus, once.
  const cardPairs = new Map<number, Set<number>>();
  const pair = (li: number, ci: number) => (cardPairs.get(li) ?? cardPairs.set(li, new Set()).get(li)!).add(ci);
  links.forEach((l, li) => {
    if (focusedLink[li]) for (const ci of cardGrid.near(l.reach)) pair(li, ci);
  });
  cards.forEach((c, ci) => {
    if (inFocus(c.id)) for (const li of linkGrid.near(c)) pair(li, ci);
  });
  for (const li of [...cardPairs.keys()].sort((a, b) => a - b)) {
    const { link, segments, label } = links[li]!;
    const near = [...cardPairs.get(li)!].sort((a, b) => a - b).map((ci) => cards[ci]!);
    for (const card of near) {
      if (card.id === link.fromId || card.id === link.toId) continue;
      if (!segments.some((s) => segmentEntersBox(s, card, INSET))) continue;
      counts.throughCards += 1;
      push("link_through_card", [link.key, card.id], `the route of ${n(link.key)} runs through ${n(card.id)}`);
    }
    const hit = label && near.find((c) => c.id !== link.fromId && c.id !== link.toId && overlaps(label, c));
    if (hit) {
      counts.labelCollisions += 1;
      push("label_collision", [link.key, hit.id], `the label of ${n(link.key)} sits on ${n(hit.id)}`);
    }
  }

  links.forEach(({ link, segments }, li) => {
    if (!focusedLink[li]) return;
    for (const frame of geometry.frames) {
      const run = Math.max(0, ...segments.map((s) => runOnBorder(s, frame)));
      if (run < CORRIDOR_MIN) continue;
      counts.onFrameBorders += 1;
      push("link_on_frame_border", [link.key, frame.id], `${n(link.key)} runs ${Math.round(run)} px along the border of ${n(frame.id)}`);
    }
  });

  // Link pairs with at least one in focus, each once (by index order).
  links.forEach((p, i) => {
    if (!focusedLink[i]) return;
    for (const j of linkGrid.near(p.reach)) {
      if (j === i || (focusedLink[j] && j < i)) continue;
      const q = links[j]!;
      const [a, b] = i < j ? [p, q] : [q, p];
      let crossings = 0;
      let corridor = 0;
      for (const s of a.segments) {
        for (const t of b.segments) {
          if (segmentsCross(s, t)) crossings += 1;
          corridor = Math.max(corridor, sharedRun(s, t, CORRIDOR_GAP));
        }
      }
      if (crossings) {
        counts.crossings += crossings;
        push("links_cross", [a.link.key, b.link.key], `${n(a.link.key)} and ${n(b.link.key)} cross ${crossings === 1 ? "once" : `${crossings} times`}`);
      }
      if (corridor >= CORRIDOR_MIN) {
        counts.sharedCorridors += 1;
        push("links_share_corridor", [a.link.key, b.link.key], `${n(a.link.key)} and ${n(b.link.key)} run together for ${Math.round(corridor)} px`);
      }
      if (a.label && b.label && overlaps(a.label, b.label)) {
        counts.labelCollisions += 1;
        push("label_collision", [a.link.key, b.link.key], `the labels of ${n(a.link.key)} and ${n(b.link.key)} overlap`);
      }
    }
  });

  // Fatal first, then by code, in discovery order within a code (stable).
  const order: LayoutIssueCode[] = ["link_through_card", "links_cross", "links_share_corridor", "link_on_frame_border", "label_collision"];
  const sorted = all.map((issue, i) => ({ issue, i })).sort((a, b) => order.indexOf(a.issue.code) - order.indexOf(b.issue.code) || a.i - b.i);
  const score = all.reduce((n, issue) => n + WEIGHT[issue.code], 0);
  return { issues: sorted.slice(0, LAYOUT_LIMITS.issues).map((s) => s.issue), counts, score, truncated: all.length > LAYOUT_LIMITS.issues };
}

/** "2 links cross cards · 3 crossings", or null when the layout is clean. */
export function describeLayout(counts: LayoutCounts): string | null {
  const parts = [
    counts.throughCards ? `${counts.throughCards} ${counts.throughCards === 1 ? "link crosses a card" : "links cross cards"}` : "",
    counts.crossings ? `${counts.crossings} ${counts.crossings === 1 ? "crossing" : "crossings"}` : "",
    counts.sharedCorridors ? `${counts.sharedCorridors} ${counts.sharedCorridors === 1 ? "pair of links overlaps" : "pairs of links overlap"}` : "",
    counts.onFrameBorders ? `${counts.onFrameBorders} ${counts.onFrameBorders === 1 ? "link runs" : "links run"} along a section border` : "",
    counts.labelCollisions ? `${counts.labelCollisions} ${counts.labelCollisions === 1 ? "label overlaps" : "labels overlap"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
