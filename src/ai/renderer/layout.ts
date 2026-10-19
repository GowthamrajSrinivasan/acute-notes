/**
 * Per-template deterministic layout (F30, PRD §13.15.2's "layout strategy"):
 * given a validated plan's nodes (already sized by `measure.ts`) and its
 * relationships, place every node — never dropping one, even an untagged or
 * disconnected one. Pure arithmetic on plan order, roles and relationship
 * edges; no randomness, no reading of anything but the plan itself, so the
 * same plan always produces the same positions.
 *
 * Positions are local (an arbitrary origin near 0,0); `place.ts` translates
 * the whole result into free canvas space.
 */
import { clusterKey, groupTakeawayKey, groupTitleKey } from "@/ai/visual-plan/groups";
import type { GroupArrangement, VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { templateFor, type LayoutStrategyId } from "@/ai/visual-plan/templates";
import { measureNode, SECTION_TITLE_FONT_SIZE, takeawayHeight } from "./measure";
import type { Box } from "./types";

const GAP = 48;
const ROW_GAP = 32;
/** Connector labels are drawn at 16 px (`changeSetWriter.ts`) in Excalifont, about 0.56 em per character (`measure.ts`). */
const LINK_LABEL_CHAR = 16 * 0.56;
/** Clear space either side of a label on a link between two columns. */
const LINK_LABEL_PAD = 32;
/** A column gap never grows past this for a label; a longer label overlaps its ends a little rather than spreading the diagram. */
const MAX_LABEL_GAP = 320;

/** Sections (F42). A row of members wider than this wraps into a 2- or 3-column matrix. */
export const GROUP_ROW_MAX_WIDTH = 1500;
/** A row of sections wraps before it gets wider than this (two wide sections still fit side by side). */
export const SECTIONS_MAX_WIDTH = 3400;
const GROUP_PAD = 40;
const GROUP_TITLE_HEIGHT = Math.round(SECTION_TITLE_FONT_SIZE * 1.5);
/**
 * Per-character width of a section title, in em. Titles are drawn in the AI title font (often a hand-drawn one),
 * wider than the 0.55 em body average: estimating narrow made a short title in a narrow section wrap onto a second
 * line and overlap the first member. This errs wide, and the title band wraps to as many lines as the estimate needs.
 */
const SECTION_TITLE_EM = 0.66;
const GROUP_TITLE_GAP = 28;
const TAKEAWAY_GAP = 8;
const SECTION_GAP = 96;

export type LocalLayout = ReadonlyMap<string, Box>;

/**
 * Sizes every node, then arranges them per the plan's template. Child
 * explanations (the target of an `explained_by` from another node, F38b) are
 * kept out of the template's arrangement so they never stretch it: the
 * concepts are laid out alone, and each explanation hangs below its parent.
 */
export function layoutPlan(plan: VisualPlan): LocalLayout {
  if (plan.nodes.some((n) => n.type === "group")) return layoutGrouped(plan);
  const sizes = new Map(plan.nodes.map((n) => [n.id, measureNode(n)] as const));
  const parentOf = explanationParents(plan);
  const core = plan.nodes.filter((n) => !parentOf.has(n.id));
  const coreIds = new Set(core.map((n) => n.id));
  const coreRelationships = plan.relationships.filter((r) => coreIds.has(r.from) && coreIds.has(r.to));
  const positions = LAYOUTS[templateFor(plan.template).layout](core, coreRelationships, sizes);
  const boxes = new Map<string, Box>();
  for (const n of core) {
    const size = sizes.get(n.id)!;
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    boxes.set(n.id, { ...pos, ...size });
  }
  placeExplanations(plan.nodes.filter((n) => parentOf.has(n.id)), parentOf, sizes, boxes);
  return boxes;
}

/** Explanation node id → its parent's id: the target of an `explained_by` from a different node (first one wins; cycles broken). */
export function explanationParents(plan: VisualPlan): Map<string, string> {
  const ids = new Set(plan.nodes.map((n) => n.id));
  const parentOf = new Map<string, string>();
  for (const r of plan.relationships) {
    if (r.type !== "explained_by" || r.from === r.to || !ids.has(r.from) || !ids.has(r.to) || parentOf.has(r.to)) continue;
    // Never make a node the explanation of its own explanation (a cycle would leave neither placed).
    let up: string | undefined = r.from;
    while (up && up !== r.to) up = parentOf.get(up);
    if (up !== r.to) parentOf.set(r.to, r.from);
  }
  return parentOf;
}

function overlapsAny(b: Box, boxes: Iterable<Box>): boolean {
  for (const o of boxes) if (b.x < o.x + o.width + GAP / 2 && b.x + b.width + GAP / 2 > o.x && b.y < o.y + o.height + ROW_GAP / 2 && b.y + b.height + ROW_GAP / 2 > o.y) return true;
  return false;
}

/** Each explanation below its parent (parents first, so nested explanations go deeper), pushed down past anything in the way. */
function placeExplanations(nodes: readonly VisualNode[], parentOf: ReadonlyMap<string, string>, sizes: ReadonlyMap<string, NodeSize>, boxes: Map<string, Box>): void {
  const pending = [...nodes];
  while (pending.length) {
    const i = pending.findIndex((n) => boxes.has(parentOf.get(n.id)!));
    const node = pending.splice(i < 0 ? 0 : i, 1)[0]!;
    const parent = boxes.get(parentOf.get(node.id)!) ?? { x: 0, y: 0, width: 0, height: 0 };
    const size = sizes.get(node.id)!;
    const box: Box = { x: parent.x, y: parent.y + parent.height + GAP, ...size };
    while (overlapsAny(box, boxes.values())) box.y += ROW_GAP;
    boxes.set(node.id, box);
  }
}

type NodeSize = { width: number; height: number };

/**
 * Explanations under their node, as part of its room (Wave D): each core node's own explanations stacked below it,
 * the node centred over them. `sizes` gives each such node the room of the node and its stack, for the section's
 * arrangement; `place` then puts the stack under the node where the arrangement put it. Hung afterwards instead,
 * wide explanations under narrow shapes overlapped and were pushed down in a staircase, their links winding around
 * (the scenario of the live hand-off "Decision" section).
 */
function explanationsBelow(
  core: readonly VisualNode[],
  members: readonly VisualNode[],
  parentOf: ReadonlyMap<string, string>,
  sizes: ReadonlyMap<string, NodeSize>,
): { sizes: Map<string, NodeSize>; place: (boxes: Map<string, Box>) => void } | null {
  const coreIds = new Set(core.map((n) => n.id));
  const byParent = new Map<string, VisualNode[]>();
  for (const n of members) {
    const p = parentOf.get(n.id);
    if (p && coreIds.has(p)) (byParent.get(p) ?? byParent.set(p, []).get(p)!).push(n);
  }
  if (!byParent.size) return null;
  const unit = new Map(sizes);
  for (const [p, list] of byParent) {
    const own = sizes.get(p)!;
    const stackHeight = list.reduce((h, n, i) => h + sizes.get(n.id)!.height + (i ? ROW_GAP : 0), 0);
    unit.set(p, { width: Math.max(own.width, ...list.map((n) => sizes.get(n.id)!.width)), height: own.height + GAP + stackHeight });
  }
  return {
    sizes: unit,
    place: (boxes) => {
      for (const [p, list] of byParent) {
        const at = boxes.get(p);
        if (!at) continue;
        const room = unit.get(p)!;
        boxes.set(p, { ...at, x: at.x + (room.width - at.width) / 2 });
        let y = at.y + at.height + GAP;
        for (const n of list) {
          const s = sizes.get(n.id)!;
          boxes.set(n.id, { x: at.x + (room.width - s.width) / 2, y, ...s });
          y += s.height + ROW_GAP;
        }
      }
    },
  };
}

/**
 * A tree's explanations beside their nodes: each core node's own explanations (not explanations of explanations)
 * in a column to its right. `sizes` gives each such node the room of the node and its column, for the tree layout;
 * `place` then puts the column beside the node where the layout put it.
 */
function sideExplanations(
  core: readonly VisualNode[],
  members: readonly VisualNode[],
  parentOf: ReadonlyMap<string, string>,
  sizes: ReadonlyMap<string, NodeSize>,
): { sizes: Map<string, NodeSize>; place: (boxes: Map<string, Box>) => void } | null {
  const coreIds = new Set(core.map((n) => n.id));
  const byParent = new Map<string, VisualNode[]>();
  for (const n of members) {
    const p = parentOf.get(n.id);
    if (p && coreIds.has(p)) (byParent.get(p) ?? byParent.set(p, []).get(p)!).push(n);
  }
  if (!byParent.size) return null;
  const unit = new Map(sizes);
  for (const [p, list] of byParent) {
    const own = sizes.get(p)!;
    const colWidth = Math.max(...list.map((n) => sizes.get(n.id)!.width));
    const colHeight = list.reduce((h, n, i) => h + sizes.get(n.id)!.height + (i ? ROW_GAP : 0), 0);
    unit.set(p, { width: own.width + GAP + colWidth, height: Math.max(own.height, colHeight) });
  }
  return {
    sizes: unit,
    place: (boxes) => {
      for (const [p, list] of byParent) {
        const at = boxes.get(p);
        if (!at) continue;
        // The tree placed the node's whole room with the node at its left: the column goes to the node's right.
        const left = at.x;
        let y = at.y;
        for (const n of list) {
          const s = sizes.get(n.id)!;
          boxes.set(n.id, { x: left + at.width + GAP, y, ...s });
          y += s.height + ROW_GAP;
        }
      }
    },
  };
}
type LayoutFn = (
  nodes: readonly VisualNode[],
  relationships: readonly VisualRelationship[],
  sizes: ReadonlyMap<string, NodeSize>,
) => ReadonlyMap<string, { x: number; y: number }>;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** A single row, left to right in the given order; `align` is "center" (a chain/timeline's shared axis) or "top" (independent columns). */
function row(nodes: readonly VisualNode[], sizes: ReadonlyMap<string, { width: number; height: number }>, align: "center" | "top"): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const maxHeight = Math.max(0, ...nodes.map((n) => sizes.get(n.id)!.height));
  let x = 0;
  for (const n of nodes) {
    const s = sizes.get(n.id)!;
    out.set(n.id, { x, y: align === "center" ? (maxHeight - s.height) / 2 : 0 });
    x += s.width + GAP;
  }
  return out;
}

/** A single column, top to bottom, horizontally centred on a shared axis. */
function column(nodes: readonly VisualNode[], sizes: ReadonlyMap<string, { width: number; height: number }>, gap = ROW_GAP): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const maxWidth = Math.max(0, ...nodes.map((n) => sizes.get(n.id)!.width));
  let y = 0;
  for (const n of nodes) {
    const s = sizes.get(n.id)!;
    out.set(n.id, { x: (maxWidth - s.width) / 2, y });
    y += s.height + gap;
  }
  return out;
}

/** Several columns side by side, each its own vertical stack, all top-aligned. */
function columns(buckets: readonly (readonly VisualNode[])[], sizes: ReadonlyMap<string, { width: number; height: number }>): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  let x = 0;
  for (const bucket of buckets) {
    if (!bucket.length) continue;
    const width = Math.max(...bucket.map((n) => sizes.get(n.id)!.width));
    let y = 0;
    for (const n of bucket) {
      const s = sizes.get(n.id)!;
      out.set(n.id, { x: x + (width - s.width) / 2, y });
      y += s.height + ROW_GAP;
    }
    x += width + GAP;
  }
  return out;
}

/** A center node, then the rest evenly spaced on rings around it (multiple rings once one would be too crowded). */
function radial(center: VisualNode, rest: readonly VisualNode[], sizes: ReadonlyMap<string, { width: number; height: number }>): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const centerSize = sizes.get(center.id)!;
  out.set(center.id, { x: -centerSize.width / 2, y: -centerSize.height / 2 });
  if (!rest.length) return out;
  const avgSize = rest.reduce((sum, n) => sum + Math.max(sizes.get(n.id)!.width, sizes.get(n.id)!.height), 0) / rest.length;
  const ringGap = avgSize + GAP * 2;
  let ring = 0;
  let placed = 0;
  while (placed < rest.length) {
    const radius = centerSize.width / 2 + ringGap * (ring + 1);
    const circumference = 2 * Math.PI * radius;
    const perRing = Math.max(1, Math.min(rest.length - placed, Math.floor(circumference / (avgSize + GAP))));
    for (let i = 0; i < perRing; i++) {
      const node = rest[placed + i]!;
      const s = sizes.get(node.id)!;
      const angle = (2 * Math.PI * i) / perRing - Math.PI / 2;
      out.set(node.id, { x: Math.cos(angle) * radius - s.width / 2, y: Math.sin(angle) * radius - s.height / 2 });
    }
    placed += perRing;
    ring++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// DAG layering, shared by decision_tree (top-down) and architecture (left-to-right)
// ---------------------------------------------------------------------------

interface Layered {
  depth: number;
  order: number;
}

/**
 * One layer per BFS depth from the roots (nodes with no incoming edge, or —
 * with `root` given — that node alone), sibling order by plan order.
 * Unreachable nodes (disconnected, or edges elsewhere in the plan) still get
 * a layer: appended, in plan order, one row past the deepest reached layer,
 * so a layout never drops a node for lack of edges.
 */
function layerGraph(nodes: readonly VisualNode[], relationships: readonly VisualRelationship[], root?: VisualNode): Map<string, Layered> {
  const ids = nodes.map((n) => n.id);
  const indexOf = new Map(ids.map((id, i) => [id, i] as const));
  const outgoing = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const r of relationships) {
    if (!indexOf.has(r.from) || !indexOf.has(r.to) || r.from === r.to) continue;
    (outgoing.get(r.from) ?? outgoing.set(r.from, []).get(r.from)!).push(r.to);
    hasIncoming.add(r.to);
  }
  const depth = new Map<string, number>();
  // A graph that is all loop has no node without an incoming link: start from the first one.
  const sources = root ? [root.id] : ids.filter((id) => !hasIncoming.has(id));
  const roots = sources.length ? sources : ids.slice(0, 1);
  // Links that close a loop (a retry path, a state returning to an earlier one) don't add depth,
  // otherwise the longest-path relaxation below would never stop.
  const back = backEdges(roots, outgoing);
  const queue = [...new Set(roots)];
  for (const id of queue) depth.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of outgoing.get(id) ?? []) {
      if (back.has(`${id}\u0000${next}`)) continue;
      const candidate = depth.get(id)! + 1;
      if (candidate > (depth.get(next) ?? -1)) {
        depth.set(next, candidate);
        queue.push(next);
      }
    }
  }
  const deepest = Math.max(-1, ...depth.values());
  for (const id of ids) if (!depth.has(id)) depth.set(id, deepest + 1); // unreachable: one row past everything reached

  // Within a layer, each node sits under its parents: ordered by the mean position of its parents in the layer
  // above (a barycentre sort — far fewer crossing arrows than plan order), ties and orphans in plan order.
  const incoming = new Map<string, string[]>();
  for (const [from, tos] of outgoing) for (const to of tos) (incoming.get(to) ?? incoming.set(to, []).get(to)!).push(from);
  const layered = new Map<string, Layered>();
  const byDepth = new Map<number, string[]>();
  for (const id of ids) (byDepth.get(depth.get(id)!) ?? byDepth.set(depth.get(id)!, []).get(depth.get(id)!)!).push(id);
  for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
    const centre = (id: string) => {
      const above = (incoming.get(id) ?? []).flatMap((p) => (layered.get(p)?.depth === d - 1 ? [layered.get(p)!.order] : []));
      return above.length ? above.reduce((a, b) => a + b, 0) / above.length : Number.POSITIVE_INFINITY;
    };
    const members = byDepth.get(d)!.slice().sort((a, b) => centre(a) - centre(b) || indexOf.get(a)! - indexOf.get(b)!);
    members.forEach((id, order) => layered.set(id, { depth: d, order }));
  }
  return layered;
}

/** The links (as `from\0to`) that reach back to a node still on the depth-first path from `roots`, i.e. the ones closing a cycle. */
function backEdges(roots: readonly string[], outgoing: ReadonlyMap<string, readonly string[]>): Set<string> {
  const back = new Set<string>();
  const state = new Map<string, "open" | "done">();
  for (const start of roots) {
    if (state.has(start)) continue;
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, "open");
    while (stack.length) {
      const top = stack[stack.length - 1]!;
      const targets = outgoing.get(top.id) ?? [];
      if (top.next === targets.length) {
        state.set(top.id, "done");
        stack.pop();
        continue;
      }
      const to = targets[top.next++]!;
      const seen = state.get(to);
      if (seen === "open") back.add(`${top.id}\u0000${to}`);
      else if (!seen) {
        state.set(to, "open");
        stack.push({ id: to, next: 0 });
      }
    }
  }
  return back;
}

function layeredPositions(
  nodes: readonly VisualNode[],
  layered: ReadonlyMap<string, Layered>,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  axis: "x" | "y",
  relationships: readonly VisualRelationship[] = [],
): Map<string, { x: number; y: number }> {
  const byDepth = new Map<number, VisualNode[]>();
  for (const n of nodes) {
    const d = layered.get(n.id)!.depth;
    (byDepth.get(d) ?? byDepth.set(d, []).get(d)!).push(n);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  // Left to right, a link's label sits across the gap after its nearer end's column: widen that gap to fit it.
  const labelGap = new Map<number, number>();
  if (axis === "x") {
    for (const r of relationships) {
      const a = layered.get(r.from)?.depth;
      const b = layered.get(r.to)?.depth;
      if (!r.label || a === undefined || b === undefined || a === b) continue;
      const d = Math.min(a, b);
      const longest = Math.max(...r.label.split("\n").map((l) => l.length));
      const width = Math.min(MAX_LABEL_GAP, Math.ceil(longest * LINK_LABEL_CHAR) + 2 * LINK_LABEL_PAD);
      labelGap.set(d, Math.max(labelGap.get(d) ?? 0, width));
    }
  }
  const out = new Map<string, { x: number; y: number }>();
  let depthOffset = 0;
  for (const d of depths) {
    const members = byDepth.get(d)!.slice().sort((a, b) => layered.get(a.id)!.order - layered.get(b.id)!.order);
    const depthSize = Math.max(...members.map((n) => (axis === "x" ? sizes.get(n.id)!.width : sizes.get(n.id)!.height)));
    let crossOffset = 0;
    for (const n of members) {
      const s = sizes.get(n.id)!;
      if (axis === "x") out.set(n.id, { x: depthOffset, y: crossOffset });
      else out.set(n.id, { x: crossOffset, y: depthOffset });
      crossOffset += (axis === "x" ? s.height : s.width) + ROW_GAP;
    }
    depthOffset += depthSize + Math.max(GAP, labelGap.get(d) ?? 0);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The 8 templates
// ---------------------------------------------------------------------------

/** The role a template groups by, falling back to round-robin across the buckets so untagged content is never dropped. */
function byRole(nodes: readonly VisualNode[], roles: readonly string[]): VisualNode[][] {
  const buckets: VisualNode[][] = roles.map(() => []);
  let next = 0;
  for (const n of nodes) {
    const i = n.role ? roles.indexOf(n.role) : -1;
    if (i >= 0) buckets[i]!.push(n);
    else {
      buckets[next]!.push(n);
      next = (next + 1) % roles.length;
    }
  }
  return buckets;
}

const flow: LayoutFn = (nodes, _relationships, sizes) => row(nodes, sizes, "center");

const problemCauseSolution: LayoutFn = (nodes, _relationships, sizes) => columns(byRole(nodes, ["problem", "cause", "solution"]), sizes);

const conceptMap: LayoutFn = (nodes, _relationships, sizes) => {
  if (!nodes.length) return new Map();
  const centerIndex = Math.max(0, nodes.findIndex((n) => n.role === "center"));
  const center = nodes[centerIndex]!;
  const rest = nodes.filter((n) => n.id !== center.id);
  return radial(center, rest, sizes);
};

/** Left to right like `flow`, but nodes alternate above/below the axis (a common timeline convention) instead of sharing a centre line. */
const timeline: LayoutFn = (nodes, _relationships, sizes) => {
  const out = new Map<string, { x: number; y: number }>();
  const maxHeight = Math.max(0, ...nodes.map((n) => sizes.get(n.id)!.height));
  let x = 0;
  nodes.forEach((n, i) => {
    const s = sizes.get(n.id)!;
    out.set(n.id, { x, y: i % 2 === 0 ? 0 : maxHeight + ROW_GAP });
    x += s.width + GAP;
  });
  return out;
};

const decisionTree: LayoutFn = (nodes, relationships, sizes) => {
  const rootIndex = Math.max(0, nodes.findIndex((n) => n.role === "decision"));
  const layered = layerGraph(nodes, relationships, nodes[rootIndex]);
  return layeredPositions(nodes, layered, sizes, "y");
};

const architecture: LayoutFn = (nodes, relationships, sizes) => {
  const layered = layerGraph(nodes, relationships); // multiple roots allowed, unlike a single-root tree
  return layeredPositions(nodes, layered, sizes, "x", relationships);
};

const comparison: LayoutFn = (nodes, _relationships, sizes) => row(nodes, sizes, "top");

const actionPlan: LayoutFn = (nodes, _relationships, sizes) => column(nodes, sizes);

/** Without groups, a sectioned plan's nodes are packed in rows like sections (see `layoutGrouped`). */
const groupedGrid: LayoutFn = (nodes, _relationships, sizes) => packRows(nodes, sizes);

const LAYOUTS: Record<LayoutStrategyId, LayoutFn> = {
  "chain-horizontal": flow,
  "three-column": problemCauseSolution,
  "radial-cluster": conceptMap,
  "timeline-axis": timeline,
  "tree-top-down": decisionTree,
  "layered-boxes": architecture,
  "column-compare": comparison,
  "document-stack": actionPlan,
  "grouped-grid": groupedGrid,
  // `causal_map` (Wave E): the same multi-root, relationship-driven layout as `architecture` — a free-form
  // causes/effects graph needs no layout of its own.
  "causal-graph": architecture,
};

// ---------------------------------------------------------------------------
// Sections (F42): groups laid out bottom-up, then packed
// ---------------------------------------------------------------------------

/**
 * One row while it fits in `GROUP_ROW_MAX_WIDTH`, else a matrix: 2 columns for up to 4 members, 3 beyond —
 * row-major in plan order, each column as wide as its widest member and each row as tall as its tallest, so a
 * section reads left to right instead of scrolling down. `align` centres members on their row (a chain's axis).
 */
function grid(nodes: readonly VisualNode[], sizes: ReadonlyMap<string, NodeSize>, align: "center" | "top", snake = false): Map<string, { x: number; y: number }> {
  const widths = nodes.map((n) => sizes.get(n.id)!.width);
  if (widths.reduce((a, w) => a + w, 0) + GAP * Math.max(0, nodes.length - 1) <= GROUP_ROW_MAX_WIDTH) return row(nodes, sizes, align);
  const cols = nodes.length <= 4 ? 2 : 3;
  // A wrapped sequence snakes (Wave D): every other row runs right to left, so each step's arrow goes to a
  // neighbour — the row's last step to the one right below it — instead of back across the whole section.
  const colOf = (i: number) => (snake && Math.floor(i / cols) % 2 === 1 ? cols - 1 - (i % cols) : i % cols);
  const colWidth = Array.from({ length: cols }, (_, c) => Math.max(0, ...nodes.filter((_, i) => colOf(i) === c).map((n) => sizes.get(n.id)!.width)));
  const rows = Math.ceil(nodes.length / cols);
  const rowHeight = Array.from({ length: rows }, (_, r) => Math.max(0, ...nodes.slice(r * cols, r * cols + cols).map((n) => sizes.get(n.id)!.height)));
  const out = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const c = colOf(i);
    const r = Math.floor(i / cols);
    const s = sizes.get(n.id)!;
    const x = colWidth.slice(0, c).reduce((a, w) => a + w + GAP, 0);
    const y = rowHeight.slice(0, r).reduce((a, h) => a + h + ROW_GAP, 0);
    out.set(n.id, { x, y: y + (align === "center" ? (rowHeight[r]! - s.height) / 2 : 0) });
  });
  return out;
}

/**
 * A chain's members in the order their `flows_to` links give (plan order breaks ties and places unlinked
 * members), the order their step numbers follow (`wrapSections`), so the layout reads in the same order.
 */
function sequenceOrder(nodes: readonly VisualNode[], relationships: readonly VisualRelationship[]): VisualNode[] {
  const index = new Map(nodes.map((n, i) => [n.id, i] as const));
  const next = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const incoming = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const r of relationships) {
    if (r.type !== "flows_to" || !index.has(r.from) || !index.has(r.to) || r.from === r.to) continue;
    next.get(r.from)!.push(r.to);
    incoming.set(r.to, incoming.get(r.to)! + 1);
  }
  const order: string[] = [];
  const ready = nodes.filter((n) => incoming.get(n.id) === 0).map((n) => n.id);
  while (ready.length) {
    ready.sort((a, b) => index.get(a)! - index.get(b)!);
    const id = ready.shift()!;
    order.push(id);
    for (const to of next.get(id)!) {
      incoming.set(to, incoming.get(to)! - 1);
      if (incoming.get(to) === 0) ready.push(to);
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  return [...order, ...nodes.map((n) => n.id).filter((id) => !order.includes(id))].map((id) => byId.get(id)!);
}

/**
 * A chain (a flow section): its steps — the members its `flows_to` links join — snake in their order, and any other
 * member (the source's table, a note) sits in a row of its own below them, so a wide table never becomes one of the
 * steps' cells, stretching the columns and pulling steps apart (the live run of 2026-09-29).
 */
function chainLayout(nodes: readonly VisualNode[], relationships: readonly VisualRelationship[], sizes: ReadonlyMap<string, NodeSize>): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id));
  const linked = new Set(relationships.flatMap((r) => (r.type === "flows_to" && ids.has(r.from) && ids.has(r.to) && r.from !== r.to ? [r.from, r.to] : [])));
  const steps = sequenceOrder(nodes.filter((n) => linked.has(n.id)), relationships);
  const rest = nodes.filter((n) => !linked.has(n.id));
  if (!steps.length || !rest.length) return grid(sequenceOrder(nodes, relationships), sizes, "center", true);
  const top = grid(steps, sizes, "center", true);
  const below = grid(rest, sizes, "top");
  const stepsBottom = Math.max(...steps.map((n) => top.get(n.id)!.y + sizes.get(n.id)!.height));
  const out = new Map(top);
  for (const [id, p] of below) out.set(id, { x: p.x, y: p.y + stepsBottom + GAP * 2 });
  return out;
}

/**
 * A tidy tree, top down (Wave D): each subtree as wide as its children need, each parent centred over its
 * children, layers `GAP` apart. A node's parent is the first node one layer up that links to it (a node with two
 * parents hangs under the first; its other links are drawn as they are). Replaces left-packed layers, which put a
 * root at the far left so its link to a far child ran along the children's row and through a sibling.
 */
function tidyTree(nodes: readonly VisualNode[], relationships: readonly VisualRelationship[], sizes: ReadonlyMap<string, NodeSize>): Map<string, { x: number; y: number }> {
  const layered = layerGraph(nodes, relationships);
  const index = new Map(nodes.map((n, i) => [n.id, i] as const));
  const parent = new Map<string, string>();
  for (const r of relationships) {
    if (!index.has(r.from) || !index.has(r.to) || r.from === r.to || parent.has(r.to)) continue;
    if (layered.get(r.from)!.depth + 1 === layered.get(r.to)!.depth) parent.set(r.to, r.from);
  }
  const children = new Map<string, VisualNode[]>(nodes.map((n) => [n.id, []]));
  for (const n of nodes) if (parent.has(n.id)) children.get(parent.get(n.id)!)!.push(n);
  const roots = nodes.filter((n) => !parent.has(n.id));
  const depthHeight = new Map<number, number>();
  for (const n of nodes) {
    const d = layered.get(n.id)!.depth;
    depthHeight.set(d, Math.max(depthHeight.get(d) ?? 0, sizes.get(n.id)!.height));
  }
  const depthTop = new Map<number, number>();
  let top = 0;
  for (const d of [...depthHeight.keys()].sort((a, b) => a - b)) {
    depthTop.set(d, top);
    top += depthHeight.get(d)! + GAP;
  }
  const widthOf = new Map<string, number>();
  const measure = (n: VisualNode): number => {
    const kids = children.get(n.id)!;
    const kidsWidth = kids.reduce((w, k, i) => w + measure(k) + (i ? GAP : 0), 0);
    const w = Math.max(sizes.get(n.id)!.width, kidsWidth);
    widthOf.set(n.id, w);
    return w;
  };
  const out = new Map<string, { x: number; y: number }>();
  const place = (n: VisualNode, left: number) => {
    const w = widthOf.get(n.id)!;
    out.set(n.id, { x: left + (w - sizes.get(n.id)!.width) / 2, y: depthTop.get(layered.get(n.id)!.depth)! });
    const kids = children.get(n.id)!;
    const kidsWidth = kids.reduce((s, k, i) => s + widthOf.get(k.id)! + (i ? GAP : 0), 0);
    let x = left + (w - kidsWidth) / 2;
    for (const k of kids) {
      place(k, x);
      x += widthOf.get(k.id)! + GAP;
    }
  };
  let left = 0;
  for (const r of roots) {
    measure(r);
    place(r, left);
    left += widthOf.get(r.id)! + GAP;
  }
  return out;
}

/**
 * Members in an order that keeps linked ones next to each other (Wave D): starting from the first member, each link
 * is followed before moving on (depth first; the plan's order breaks ties and places unlinked members), so a link
 * joins neighbours — short, and across no other card — instead of reaching past the cards between its ends. The
 * plan's reading order is kept wherever links don't say otherwise.
 */
export function connectedOrder(nodes: readonly VisualNode[], relationships: readonly VisualRelationship[]): VisualNode[] {
  const index = new Map(nodes.map((n, i) => [n.id, i] as const));
  const near = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const r of relationships) {
    if (!index.has(r.from) || !index.has(r.to) || r.from === r.to) continue;
    near.get(r.from)!.push(r.to);
    near.get(r.to)!.push(r.from);
  }
  for (const list of near.values()) list.sort((a, b) => index.get(a)! - index.get(b)!);
  const seen = new Set<string>();
  const out: VisualNode[] = [];
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(nodes[index.get(id)!]!);
    for (const next of near.get(id)!) visit(next);
  };
  for (const n of nodes) visit(n.id);
  return out;
}

/**
 * A grid in whichever order keeps linked members closer — the plan's own, or `connectedOrder` — by the total
 * distance between the centres of the members each link joins (the plan's order on a tie: it is the reading order).
 * A depth-first order suits a row or a column; in a 2-D grid the plan's order can already put partners one above the
 * other, where following links would put them diagonal.
 */
function linkedGrid(nodes: readonly VisualNode[], relationships: readonly VisualRelationship[], sizes: ReadonlyMap<string, NodeSize>): Map<string, { x: number; y: number }> {
  const plain = grid(nodes, sizes, "top");
  const ordered = connectedOrder(nodes, relationships);
  if (ordered.every((n, i) => n === nodes[i])) return plain;
  const linked = grid(ordered, sizes, "top");
  const spread = (at: Map<string, { x: number; y: number }>) =>
    relationships.reduce((sum, r) => {
      const a = at.get(r.from);
      const b = at.get(r.to);
      if (!a || !b) return sum;
      const sa = sizes.get(r.from)!;
      const sb = sizes.get(r.to)!;
      return sum + Math.abs(a.x + sa.width / 2 - (b.x + sb.width / 2)) + Math.abs(a.y + sa.height / 2 - (b.y + sb.height / 2));
    }, 0);
  return spread(linked) < spread(plain) ? linked : plain;
}

const ARRANGEMENTS: Record<GroupArrangement, LayoutFn> = {
  grid: (nodes, relationships, sizes) => linkedGrid(nodes, relationships, sizes),
  chain: (nodes, relationships, sizes) => chainLayout(nodes, relationships, sizes),
  tree: (nodes, relationships, sizes) => tidyTree(nodes, relationships, sizes),
  // One top-aligned row while it fits; wider (a wide table and its notes) it wraps like a grid, instead of one
  // section so wide that every other section is pushed into a column below it (Wave D).
  compare: (nodes, relationships, sizes) => linkedGrid(nodes, relationships, sizes),
  radial: conceptMap,
  // A wider gap than a grid row's: a link that skips a card leaves its card, turns and runs around the one between —
  // 32 px left no room for that turn (connector gap + stub + clearance), so it went straight through (Wave D).
  stack: (nodes, relationships, sizes) => column(connectedOrder(nodes, relationships), sizes, GAP),
};

/**
 * Row packing of top-level items (sections and loose nodes), in plan order: left to right, wrapping to a new row
 * at the row width that makes the whole result closest to a wide screen's shape (16:9), at most 4 per row. A wide
 * section takes a row of its own while smaller ones share theirs, and a set of wide sections goes side by side
 * instead of collapsing into one tall column. Rows are top-aligned.
 */
function packRows(nodes: readonly VisualNode[], sizes: ReadonlyMap<string, NodeSize>): Map<string, { x: number; y: number }> {
  // A result that already fits a screen at a readable zoom keeps the plain packing (rows of up to 3 within
  // SECTIONS_MAX_WIDTH; 4 items make two rows of 2).
  const plain = packAt(nodes, sizes, SECTIONS_MAX_WIDTH, nodes.length === 4 ? 2 : 3);
  if (fitZoom(plain) >= READABLE_FIT_ZOOM) return plain.out;
  // A large one (Wave D: it used to stack into one tall column that fit the screen only at 10% zoom) takes the row
  // width at which the whole result fits a screen at the highest zoom. Every width that changes where rows break is
  // tried — from the widest item alone up to `MAX_PER_ROW` items side by side — in reading order.
  const widths = nodes.map((n) => sizes.get(n.id)!.width);
  const candidates = new Set<number>([Math.max(0, ...widths)]);
  for (let i = 0; i < nodes.length; i++) {
    let w = 0;
    for (let j = i; j < Math.min(nodes.length, i + MAX_PER_ROW); j++) {
      w += widths[j]! + (j > i ? SECTION_GAP : 0);
      candidates.add(w);
    }
  }
  let best: { out: Map<string, { x: number; y: number }>; zoom: number } = { out: plain.out, zoom: fitZoom(plain) };
  for (const limit of [...candidates].sort((a, b) => a - b)) {
    const packed = packAt(nodes, sizes, limit, MAX_PER_ROW);
    const zoom = fitZoom(packed);
    // Ties go to the narrower packing (fewer items per row reads more easily).
    if (zoom > best.zoom + 1e-9) best = { out: packed.out, zoom };
  }
  return best.out;
}

/** The screen a result should fit (a laptop viewport, 16:9), and the zoom from which it counts as readable. */
const FIT_SCREEN = { width: 1600, height: 900 };
const READABLE_FIT_ZOOM = 0.5;
/** A row of sections holds at most this many. */
const MAX_PER_ROW = 4;

/** The zoom at which a packed result fits `FIT_SCREEN` whole. */
function fitZoom(packed: { width: number; height: number }): number {
  return Math.min(FIT_SCREEN.width / Math.max(1, packed.width), FIT_SCREEN.height / Math.max(1, packed.height));
}

/** Rows in reading order, each at most `limit` wide (an item wider than that gets a row of its own), top-aligned. */
function packAt(
  nodes: readonly VisualNode[],
  sizes: ReadonlyMap<string, NodeSize>,
  limit: number,
  perRow: number,
): { out: Map<string, { x: number; y: number }>; width: number; height: number } {
  const out = new Map<string, { x: number; y: number }>();
  let row: VisualNode[] = [];
  let y = 0;
  let width = 0;
  const flush = () => {
    let x = 0;
    for (const n of row) {
      out.set(n.id, { x, y });
      x += sizes.get(n.id)!.width + SECTION_GAP;
    }
    width = Math.max(width, x - SECTION_GAP);
    y += Math.max(0, ...row.map((n) => sizes.get(n.id)!.height)) + SECTION_GAP;
    row = [];
  };
  for (const n of nodes) {
    const w = row.reduce((a, m) => a + sizes.get(m.id)!.width + SECTION_GAP, 0) + sizes.get(n.id)!.width;
    if (row.length && (row.length >= perRow || w > limit)) flush();
    row.push(n);
  }
  if (row.length) flush();
  return { out, width, height: Math.max(0, y - SECTION_GAP) };
}

/** Boxes shifted so their bounds start at 0,0, with those bounds' size. */
function normalise(boxes: ReadonlyMap<string, Box>): { boxes: Map<string, Box>; width: number; height: number } {
  const all = [...boxes.values()];
  if (!all.length) return { boxes: new Map(), width: 0, height: 0 };
  const minX = Math.min(...all.map((b) => b.x));
  const minY = Math.min(...all.map((b) => b.y));
  const width = Math.max(...all.map((b) => b.x + b.width)) - minX;
  const height = Math.max(...all.map((b) => b.y + b.height)) - minY;
  return { boxes: new Map([...boxes].map(([id, b]) => [id, { ...b, x: b.x - minX, y: b.y - minY }] as const)), width, height };
}

/**
 * Each non-group node's section (F42): its own `parent`, except that an explanation (the target of an
 * `explained_by`) always goes with the node it explains, so a section's frame holds its explanations too.
 */
export function sectionOfNodes(plan: VisualPlan): Map<string, string | undefined> {
  const parentOf = explanationParents(plan);
  const byId = new Map(plan.nodes.map((n) => [n.id, n] as const));
  const out = new Map<string, string | undefined>();
  for (const n of plan.nodes) {
    if (n.type === "group") continue;
    let at = n.id;
    for (let hops = 0; parentOf.has(at) && hops < plan.nodes.length; hops++) at = parentOf.get(at)!;
    const parent = byId.get(at)!.parent;
    out.set(n.id, parent && byId.get(parent)?.type === "group" ? parent : undefined);
  }
  return out;
}

/** Space between a sub-topic's backdrop and what it holds. */
const TOPIC_PAD = 32;

/**
 * The sub-topics of a section: each heading (a plain heading, not a title or section title) and the nodes after it, up to the next heading — what
 * the AI wrote as "Shift 1: …", "Shift 2: …" under one section. Null unless at least two headings start one, so a section with a single heading,
 * or none, is laid out as before. When every heading starts with a number the sub-topics are in that order, else in plan order. A node before the
 * first heading joins the first sub-topic; an explanation goes with the node it explains.
 */
function subTopics(core: readonly VisualNode[], members: readonly VisualNode[], parentOf: ReadonlyMap<string, string>): { core: VisualNode[]; members: VisualNode[] }[] | null {
  const starts = (n: VisualNode) => n.type === "heading" && n.role !== "title" && n.role !== "subtitle" && n.role !== "section";
  if (core.filter(starts).length < 2) return null;
  const topics: { head: VisualNode; core: VisualNode[] }[] = [];
  const lead: VisualNode[] = [];
  for (const n of core) {
    if (starts(n)) topics.push({ head: n, core: [n] });
    else if (topics.length) topics.at(-1)!.core.push(n);
    else lead.push(n);
  }
  topics[0]!.core.unshift(...lead);
  const number = (t: { head: VisualNode }) => (t.head.type === "heading" ? /\d+/.exec(t.head.content.text)?.[0] : undefined);
  if (topics.every((t) => number(t) !== undefined)) topics.sort((a, b) => Number(number(a)) - Number(number(b)));
  const rootOf = (id: string) => {
    let at = id;
    for (let hops = 0; parentOf.has(at) && hops < members.length; hops++) at = parentOf.get(at)!;
    return at;
  };
  return topics.map((t) => {
    const ids = new Set(t.core.map((n) => n.id));
    return { core: t.core, members: members.filter((n) => ids.has(n.id) || ids.has(rootOf(n.id))) };
  });
}

/** Boxes flowed left to right in the given order while the row fits `GROUP_ROW_MAX_WIDTH`, then wrapped (two columns once it doesn't). */
function flowBoxes(sizes: readonly { width: number; height: number }[]): Box[] {
  const total = sizes.reduce((a, s) => a + s.width, 0) + GAP * Math.max(0, sizes.length - 1);
  const cols = total <= GROUP_ROW_MAX_WIDTH ? sizes.length : 2;
  const colWidths = Array.from({ length: cols }, (_, c) => Math.max(0, ...sizes.filter((_s, i) => i % cols === c).map((s) => s.width)));
  const rows = Math.ceil(sizes.length / cols);
  const rowHeights = Array.from({ length: rows }, (_, r) => Math.max(0, ...sizes.slice(r * cols, r * cols + cols).map((s) => s.height)));
  return sizes.map((s, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return {
      x: colWidths.slice(0, c).reduce((a, w) => a + w + GAP, 0),
      y: rowHeights.slice(0, r).reduce((a, h) => a + h + ROW_GAP, 0),
      width: colWidths[c]!,
      height: rowHeights[r]!,
    };
  });
}

/**
 * A plan with sections (F42). Each group's members are laid out with its arrangement (their explanations hung
 * below them, inside the section), and the group's box wraps them plus padding and a title band — the title is
 * `groupTitleKey(id)`'s box, full width at the top (the title text is centred in it). Groups and loose top-level
 * nodes are then packed in rows (`packRows`), below any document title (a top-level heading with role
 * "title"), centred across the grid. An explanation always sits in the section of the node it explains.
 */
function layoutGrouped(plan: VisualPlan): LocalLayout {
  const sizes = new Map(plan.nodes.map((n) => [n.id, measureNode(n)] as const));
  const parentOf = explanationParents(plan);
  const sections = sectionOfNodes(plan);
  const sectionOf = (n: VisualNode) => sections.get(n.id);
  /** Each group's members (and its title) relative to the group's own corner, offset once the group is placed. */
  const inner = new Map<string, Map<string, Box>>();

  for (const g of plan.nodes) {
    if (g.type !== "group") continue;
    const members = plan.nodes.filter((n) => n.type !== "group" && sectionOf(n) === g.id);
    const core = members.filter((n) => !parentOf.has(n.id));
    const arrangement = g.content.arrangement;
    /** One set of nodes (a section's, or one sub-topic's) laid out with the section's arrangement, from 0,0. */
    const arrange = (setCore: readonly VisualNode[], setMembers: readonly VisualNode[]) => {
      const coreIds = new Set(setCore.map((n) => n.id));
      const rels = plan.relationships.filter((r) => coreIds.has(r.from) && coreIds.has(r.to));
      // In a tree, a node's explanations sit in a column to its right, as part of the node's room in the tree: below
      // it are its children, so an explanation hung there was pushed under them, its link running through them.
      // Elsewhere (grid, compare, stack, chain), under their node, as part of its room. A concept map places its own.
      const beside =
        arrangement === "tree" ? sideExplanations(setCore, setMembers, parentOf, sizes) : arrangement !== "radial" ? explanationsBelow(setCore, setMembers, parentOf, sizes) : null;
      const arranged = ARRANGEMENTS[arrangement](setCore, rels, beside?.sizes ?? sizes);
      const placed = new Map<string, Box>(setCore.map((n) => [n.id, { ...(arranged.get(n.id) ?? { x: 0, y: 0 }), ...sizes.get(n.id)! }] as const));
      if (beside) beside.place(placed);
      placeExplanations(setMembers.filter((n) => parentOf.has(n.id) && !placed.has(n.id)), parentOf, sizes, placed);
      return normalise(placed);
    };
    const topics = subTopics(core, members, parentOf);
    let local: Map<string, Box>;
    if (topics) {
      // Each sub-topic is arranged on its own and drawn on a backdrop; the backdrops are then flowed in reading order.
      const arrangedTopics = topics.map((t) => ({ ...arrange(t.core, t.members), pad: TOPIC_PAD }));
      const slots = flowBoxes(arrangedTopics.map((t) => ({ width: t.width + t.pad * 2, height: t.height + t.pad * 2 })));
      local = new Map();
      arrangedTopics.forEach((t, i) => {
        const slot = slots[i]!;
        local.set(clusterKey(g.id, i), slot);
        for (const [id, b] of t.boxes) local.set(id, { ...b, x: b.x + slot.x + t.pad, y: b.y + slot.y + t.pad });
      });
    } else local = new Map(arrange(core, members).boxes);
    const { boxes: content, width, height } = normalise(local);
    const titleEstimate = g.content.label.length * SECTION_TITLE_FONT_SIZE * SECTION_TITLE_EM;
    const titleWidth = Math.min(1200, titleEstimate);
    const boxWidth = Math.max(width, titleWidth) + GROUP_PAD * 2;
    const offsetX = GROUP_PAD + (boxWidth - GROUP_PAD * 2 - width) / 2;
    // The section's takeaway (Wave B), one centred line (wrapped when long) between its title and its members.
    const bandWidth = boxWidth - GROUP_PAD * 2;
    const titleHeight = Math.max(1, Math.ceil(titleEstimate / bandWidth)) * GROUP_TITLE_HEIGHT;
    const takeaway = g.content.takeaway ? takeawayHeight(g.content.takeaway, bandWidth) : 0;
    const takeawayBand = takeaway ? takeaway + TAKEAWAY_GAP : 0;
    const offsetY = GROUP_PAD + titleHeight + takeawayBand + GROUP_TITLE_GAP;
    const rel = new Map<string, Box>([[groupTitleKey(g.id), { x: GROUP_PAD, y: GROUP_PAD, width: bandWidth, height: titleHeight }]]);
    if (takeaway) rel.set(groupTakeawayKey(g.id), { x: GROUP_PAD, y: GROUP_PAD + titleHeight + TAKEAWAY_GAP, width: bandWidth, height: takeaway });
    for (const [id, b] of content) rel.set(id, { ...b, x: b.x + offsetX, y: b.y + offsetY });
    inner.set(g.id, rel);
    sizes.set(g.id, { width: boxWidth, height: offsetY + height + GROUP_PAD });
  }

  const inSection = (n: VisualNode) => n.type !== "group" && !!sectionOf(n);
  const top = plan.nodes.filter((n) => n.type === "group" || (!inSection(n) && !parentOf.has(n.id)));
  // The document's title and the outline's subtitle, stacked and centred above the sections.
  const titles = top.filter((n) => n.type === "heading" && (n.role === "title" || n.role === "subtitle"));
  const items = top.filter((n) => !titles.includes(n));
  const packed = packRows(items, sizes);
  const gridWidth = Math.max(0, ...items.map((n) => packed.get(n.id)!.x + sizes.get(n.id)!.width));
  const boxes = new Map<string, Box>();
  let y = 0;
  for (const t of titles) {
    const s = sizes.get(t.id)!;
    boxes.set(t.id, { x: Math.max(0, (gridWidth - s.width) / 2), y, ...s });
    y += s.height + ROW_GAP;
  }
  const gridTop = titles.length ? y - ROW_GAP + GAP : 0;
  for (const n of items) {
    const box = { ...packed.get(n.id)!, ...sizes.get(n.id)! };
    box.y += gridTop;
    boxes.set(n.id, box);
    for (const [id, b] of inner.get(n.id) ?? []) boxes.set(id, { ...b, x: b.x + box.x, y: b.y + box.y });
  }
  // Explanations of loose top-level nodes hang below them, as without sections.
  placeExplanations(
    plan.nodes.filter((n) => parentOf.has(n.id) && !boxes.has(n.id)),
    parentOf,
    sizes,
    boxes,
  );
  return boxes;
}
