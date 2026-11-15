/**
 * Frame order by links (organisation-layout plan §3.3, F4; organisation "v2" only). `packRows` places top-level items
 * (sections and loose nodes) strictly in plan order and never looks at the links between them, so when cards in
 * different frames are linked, most orders route some link through a card (a fatal layout issue) — the references
 * pass only because their author picked a good order (§1.2).
 *
 * Here a few candidate orders are packed with the same `packRows` and scored with the geometry report: fatal issues
 * first, then crossings plus links over a third frame, then reading-order inversions. Candidates: the plan's order; a
 * link order (frames that share links placed next to each other, greedily); a barycentre order (each frame moved
 * towards the frames it links to); single adjacent swaps of each; and, only while the best still has a fatal issue,
 * pairwise swaps from the best. Primary sections stay before supporting ones (`importance: "low"`) in every candidate.
 *
 * The plan's order wins unless a candidate is clearly better: it has fewer fatal issues, or (both clean) it cuts the
 * crossing cost by at least `MIN_GAIN` and `MIN_GAIN_SHARE`. Deterministic: candidates in a fixed order, ties to the
 * earlier one. A plan whose links all stay inside frames returns the plan's order without scoring anything.
 */
import type { Box, ProposedChange } from "@/ai/changes/changeSet";
import { groupTakeawayKey, groupTitleKey, isBackdropKey, isSubGroupTitleKey } from "@/ai/visual-plan/groups";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { geometryOf } from "./geometry";

/** A reordering must cut the crossing cost by at least this much, and this share of it, to beat the reader's order. */
export const MIN_GAIN = 3;
export const MIN_GAIN_SHARE = 0.25;
/** Most layouts scored for one plan (each is a full pack, route and check: about 7 ms for 7 frames and 22 links). */
export const MAX_CANDIDATES = 60;
/** While every order tried still routes a link through a card, the climb may score up to this many in all. */
export const MAX_CANDIDATES_FATAL = 160;

export interface FrameOrderScore {
  /** Links through cards. */
  fatal: number;
  /** Link crossings plus links that pass over a third frame. */
  cost: number;
  /** Frames out of plan order, read row by row. */
  inversions: number;
}

export interface FrameOrderInput {
  plan: VisualPlan;
  /** Top-level items (sections and loose nodes, not the document title), in plan order. */
  items: readonly VisualNode[];
  /** The whole layout with the items packed in `order`. */
  place: (order: readonly VisualNode[]) => Map<string, Box>;
  /** Each section's own boxes (title, takeaway, backdrops, members), as its frame lists them. */
  children: ReadonlyMap<string, readonly string[]>;
}

export interface FrameOrderResult {
  order: VisualNode[];
  boxes: Map<string, Box>;
  /** The chosen order's score; null when nothing was scored (no links across items). */
  score: FrameOrderScore | null;
  /** The plan order's score, for comparison; null when nothing was scored. */
  planScore: FrameOrderScore | null;
  /** Layouts scored. */
  tried: number;
}

/** Lower is better: fatal first, then crossing cost, then reading order. */
export function compareScores(a: FrameOrderScore, b: FrameOrderScore): number {
  return a.fatal - b.fatal || a.cost - b.cost || a.inversions - b.inversions;
}

/** Whether `candidate` is clearly better than the plan's own order (§3.3 rule 3). */
export function clearlyBetter(candidate: FrameOrderScore, plan: FrameOrderScore): boolean {
  if (candidate.fatal !== plan.fatal) return candidate.fatal < plan.fatal;
  if (candidate.fatal > 0) return compareScores(candidate, plan) < 0;
  const gain = plan.cost - candidate.cost;
  return gain >= MIN_GAIN && gain >= MIN_GAIN_SHARE * plan.cost;
}

/** The change set a render of `boxes` would propose, reduced to what geometry reads (cards, frames, links), in `renderVisualPlan`'s order. */
function changesOf(plan: VisualPlan, boxes: ReadonlyMap<string, Box>, children: ReadonlyMap<string, readonly string[]>): ProposedChange[] {
  const out: ProposedChange[] = [];
  const shape = (key: string, backdrop = false): ProposedChange | null => {
    const box = boxes.get(key);
    return box ? { kind: "create_shape", key, shape: "rectangle", box, ...(backdrop ? { backdrop: true as const } : {}) } : null;
  };
  for (const g of plan.nodes) {
    if (g.type !== "group") continue;
    const box = boxes.get(g.id);
    if (!box) continue;
    out.push({ kind: "create_frame", key: g.id, title: g.content.label, box, children: [...(children.get(g.id) ?? [])] });
    for (const key of [groupTitleKey(g.id), groupTakeawayKey(g.id)]) {
      const c = shape(key);
      if (c) out.push(c);
    }
  }
  for (const key of boxes.keys()) {
    const c = isBackdropKey(key) ? shape(key, true) : null;
    if (c) out.push(c);
  }
  for (const key of boxes.keys()) {
    const c = isSubGroupTitleKey(key) ? shape(key) : null;
    if (c) out.push(c);
  }
  for (const n of plan.nodes) {
    const c = n.type !== "group" ? shape(n.id) : null;
    if (c) out.push(c);
  }
  plan.relationships.forEach((r, i) => {
    if (boxes.has(r.from) && boxes.has(r.to)) out.push({ kind: "connect", key: `__rel${i}`, from: { created: r.from }, to: { created: r.to }, ...(r.label ? { label: r.label } : {}) });
  });
  return out;
}

export function scoreLayout(plan: VisualPlan, boxes: ReadonlyMap<string, Box>, children: ReadonlyMap<string, readonly string[]>): FrameOrderScore {
  const groups = plan.nodes.filter((n) => n.type === "group").map((n) => n.id);
  const g = geometryOf(changesOf(plan, boxes, children), [], { planOrder: groups });
  return { fatal: g.layout.counts.throughCards, cost: g.layout.counts.crossings + g.linksOverFrames.length, inversions: g.readingOrder.inversions };
}

/** Link weight between top-level items: card-to-card (or section) links whose ends sit in different items. */
export function itemLinks(plan: VisualPlan, items: readonly VisualNode[], children: ReadonlyMap<string, readonly string[]>): Map<string, Map<string, number>> {
  const itemOf = new Map<string, string>();
  for (const it of items) {
    itemOf.set(it.id, it.id);
    for (const c of children.get(it.id) ?? []) itemOf.set(c, it.id);
  }
  const out = new Map<string, Map<string, number>>(items.map((it) => [it.id, new Map()]));
  for (const r of plan.relationships) {
    const a = itemOf.get(r.from);
    const b = itemOf.get(r.to);
    if (!a || !b || a === b) continue;
    out.get(a)!.set(b, (out.get(a)!.get(b) ?? 0) + 1);
    out.get(b)!.set(a, (out.get(b)!.get(a) ?? 0) + 1);
  }
  return out;
}

/** Primary items, then supporting sections (`importance: "low"`), each in the given order. */
function tiersOf(items: readonly VisualNode[]): VisualNode[][] {
  const supporting = (n: VisualNode) => n.type === "group" && n.importance === "low";
  return [items.filter((n) => !supporting(n)), items.filter(supporting)].filter((t) => t.length);
}

/** Greedy neighbours: each next item is the one most linked to the last placed (then to all placed); unlinked ones in plan order. */
function linkOrder(items: readonly VisualNode[], links: ReadonlyMap<string, ReadonlyMap<string, number>>): VisualNode[] {
  const placed: VisualNode[] = [];
  for (const tier of tiersOf(items)) {
    const rest = [...tier];
    while (rest.length) {
      const last = placed.at(-1);
      const weight = (n: VisualNode) => 2 * (last ? (links.get(n.id)?.get(last.id) ?? 0) : 0) + placed.reduce((w, p) => w + (links.get(n.id)?.get(p.id) ?? 0), 0);
      let best = 0;
      for (let i = 1; i < rest.length; i++) if (weight(rest[i]!) > weight(rest[best]!)) best = i;
      placed.push(rest.splice(best, 1)[0]!);
    }
  }
  return placed;
}

/** Two barycentre passes: each item moves towards the mean position of the items it links to (itself counted once), within its tier. */
function barycentreOrder(items: readonly VisualNode[], links: ReadonlyMap<string, ReadonlyMap<string, number>>): VisualNode[] {
  let order = [...items];
  for (let pass = 0; pass < 2; pass++) {
    const pos = new Map(order.map((n, i) => [n.id, i] as const));
    const centre = (n: VisualNode) => {
      let sum = pos.get(n.id)!;
      let weight = 1;
      for (const [other, w] of links.get(n.id) ?? []) {
        if (!pos.has(other)) continue;
        sum += w * pos.get(other)!;
        weight += w;
      }
      return sum / weight;
    };
    order = tiersOf(order).flatMap((tier) => [...tier].sort((a, b) => centre(a) - centre(b) || pos.get(a.id)! - pos.get(b.id)!));
  }
  return order;
}

/** Orders with one item taken out and put back at another position, within its tier. */
function moves(order: readonly VisualNode[]): VisualNode[][] {
  const supporting = (n: VisualNode) => n.type === "group" && n.importance === "low";
  const out: VisualNode[][] = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) {
      if (j === i || j === i + 1 || j === i - 1) continue; // adjacent: a swap already
      const next = [...order];
      const [item] = next.splice(i, 1);
      next.splice(j, 0, item!);
      if (next.some((n, k) => supporting(n) && k < next.findLastIndex((m) => !supporting(m)))) continue;
      out.push(next);
    }
  }
  return out;
}

/** Orders with one pair swapped, within a tier: adjacent pairs only, or every pair. */
function swaps(order: readonly VisualNode[], adjacentOnly: boolean): VisualNode[][] {
  const supporting = (n: VisualNode) => n.type === "group" && n.importance === "low";
  const out: VisualNode[][] = [];
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < (adjacentOnly ? Math.min(order.length, i + 2) : order.length); j++) {
      if (supporting(order[i]!) !== supporting(order[j]!)) continue;
      const next = [...order];
      [next[i], next[j]] = [next[j]!, next[i]!];
      out.push(next);
    }
  }
  return out;
}

const keyOf = (order: readonly VisualNode[]) => order.map((n) => n.id).join("\u0000");

export function orderFrames(input: FrameOrderInput): FrameOrderResult {
  const { plan, items, place, children } = input;
  const links = itemLinks(plan, items, children);
  const linked = [...links.values()].some((m) => m.size > 0);
  if (items.length < 2 || !linked) return { order: [...items], boxes: place(items), score: null, planScore: null, tried: 0 };

  const seen = new Map<string, { order: VisualNode[]; boxes: Map<string, Box>; score: FrameOrderScore }>();
  let budget = MAX_CANDIDATES;
  const tryOrder = (order: readonly VisualNode[]) => {
    const key = keyOf(order);
    if (seen.has(key) || seen.size >= budget) return seen.get(key);
    const boxes = place(order);
    const entry = { order: [...order], boxes, score: scoreLayout(plan, boxes, children) };
    seen.set(key, entry);
    return entry;
  };
  const best = () => [...seen.values()].reduce((a, b) => (compareScores(b.score, a.score) < 0 ? b : a));

  const planEntry = tryOrder(items)!;
  // A clean plan order with no crossings can't be beaten.
  if (planEntry.score.fatal === 0 && planEntry.score.cost === 0) return { order: planEntry.order, boxes: planEntry.boxes, score: planEntry.score, planScore: planEntry.score, tried: 1 };
  const bases = [items, linkOrder(items, links), barycentreOrder(items, links)];
  for (const b of bases) tryOrder(b);
  for (const b of bases) for (const s of swaps(b, true)) tryOrder(s);
  // Still a link through a card: climb by any swap or move from the best, while it improves and the larger budget lasts.
  if (best().score.fatal > 0) budget = MAX_CANDIDATES_FATAL;
  for (let round = 0; round < 6 && best().score.fatal > 0 && seen.size < budget; round++) {
    const from = best();
    for (const s of [...swaps(from.order, false), ...moves(from.order)]) tryOrder(s);
    if (best() === from) break;
  }
  const winner = best();
  const chosen = winner !== planEntry && clearlyBetter(winner.score, planEntry.score) ? winner : planEntry;
  return { order: chosen.order, boxes: chosen.boxes, score: chosen.score, planScore: planEntry.score, tried: seen.size };
}
