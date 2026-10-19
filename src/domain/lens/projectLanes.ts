/**
 * The Project profile's lanes (plan §3.6, D25, D33): a project-profile frame isn't drawn on the user's canvas
 * geometry but in four semantic lanes — Plan, Decisions, Working knowledge, Notes — under a banner for the
 * `project` node. This is an auto layout for a level whose meaning is its grouping (D8's "user geometry wins" is for
 * architecture levels, where position carries meaning). Pure: nodes in, boxes out.
 *
 * Plan lane order: milestones by `order`, each followed by the progress items that name it in their `refs` (D53),
 * by `order`; items with no milestone come last. The other lanes put what needs attention first.
 */
import type { DiagramNode } from "@/domain/canvas/diagram";
import {
  PROGRESS_STATUSES,
  STATUS_LABELS,
  type NodeProject,
  type ProgressStatus,
  type ProjectKind,
  type ProjectStyle,
  type RiskSeverity,
} from "@/domain/canvas/nodeProject";

type Box = DiagramNode["box"];

export const PROJECT_LANE_IDS = ["plan", "decisions", "knowledge", "notes"] as const;
export type ProjectLaneId = (typeof PROJECT_LANE_IDS)[number];

export const PROJECT_LANE_DEFS: readonly { id: ProjectLaneId; name: string; kinds: readonly ProjectKind[] }[] = [
  { id: "plan", name: "Plan", kinds: ["milestone", "progress_item"] },
  { id: "decisions", name: "Decisions", kinds: ["decision", "constraint"] },
  { id: "knowledge", name: "Working knowledge", kinds: ["finding", "open_question", "risk"] },
  { id: "notes", name: "Notes", kinds: ["annotation"] },
];

export function laneOf(kind: ProjectKind | undefined): ProjectLaneId | undefined {
  return PROJECT_LANE_DEFS.find((l) => kind && l.kinds.includes(kind))?.id;
}

export interface LensLane {
  id: ProjectLaneId;
  name: string;
  /** The lane's column, heading included, in the view's own coordinates. */
  box: Box;
  count: number;
}

export interface ProjectSummary {
  /** The project node (the first one, when a frame holds several). */
  project?: { key: string; label: string; focus?: string; style?: ProjectStyle };
  milestones: { total: number; done: number };
  items: Record<ProgressStatus, number>;
  /** Decisions still `proposed`. */
  proposedDecisions: number;
  /** Constraints and enforced decisions: what raises a warning (D36). */
  warnings: number;
  openQuestions: number;
}

/** What the layout needs of a node: structurally a `LensNode`, kept minimal so tests can build one cheaply. */
export interface LaneNode {
  id: string;
  key: string;
  label: string;
  semantics: DiagramNode["semantics"];
  box: Box;
  project?: NodeProject;
}

const LANE_W = 248;
const LANE_GAP = 20;
const HEAD_H = 34;
const NODE_H = 64;
const NODE_GAP = 12;
const INDENT = 14;
const BANNER_H = 72;
const PAD = 16;

const DECISION_RANK: Record<string, number> = { proposed: 0, accepted: 1, superseded: 2 };
const SEVERITY_RANK: Record<RiskSeverity, number> = { high: 0, medium: 1, low: 2 };

/** A short state line for a node card ("✓ Redis", "In progress", "high"), or undefined when it has none to show. */
export function projectBadge(kind: ProjectKind | undefined, p: NodeProject | undefined): string | undefined {
  if (!kind || !p) return undefined;
  switch (kind) {
    case "decision":
    case "constraint":
      return p.chosen ? `✓ ${p.chosen}` : p.status ? STATUS_LABELS[p.status] : undefined;
    case "progress_item":
      return [p.status ? STATUS_LABELS[p.status] : undefined, p.next ? "next" : undefined].filter(Boolean).join(" · ") || undefined;
    case "open_question":
      return p.status ? STATUS_LABELS[p.status] : undefined;
    case "finding":
      return p.stage === "validated" ? "Validated" : p.stage === "ephemeral" ? "Ephemeral" : undefined;
    case "risk":
      return p.severity;
    case "annotation":
      return p.intent;
    case "project":
      return p.style;
    default:
      return undefined;
  }
}

const byCanvasPosition = (a: LaneNode, b: LaneNode) => a.box.y - b.box.y || a.box.x - b.box.x || a.label.localeCompare(b.label);
const byOrder = (a: LaneNode, b: LaneNode) => (a.project?.order ?? Infinity) - (b.project?.order ?? Infinity) || byCanvasPosition(a, b);

const kindOf = (n: LaneNode): ProjectKind | undefined => n.semantics.kind as ProjectKind | undefined;

/** The Plan lane in reading order, with the indent each row takes (items sit under their milestone). */
function planRows(nodes: LaneNode[]): { node: LaneNode; indent: boolean }[] {
  const milestones = nodes.filter((n) => kindOf(n) === "milestone").sort(byOrder);
  const items = nodes.filter((n) => kindOf(n) === "progress_item");
  const placed = new Set<string>();
  const rows: { node: LaneNode; indent: boolean }[] = [];
  for (const m of milestones) {
    rows.push({ node: m, indent: false });
    for (const item of items.filter((i) => i.project?.refs?.includes(m.key) && !placed.has(i.id)).sort(byOrder)) {
      placed.add(item.id);
      rows.push({ node: item, indent: true });
    }
  }
  for (const item of items.filter((i) => !placed.has(i.id)).sort(byOrder)) rows.push({ node: item, indent: false });
  return rows;
}

function laneRows(id: ProjectLaneId, nodes: LaneNode[]): { node: LaneNode; indent: boolean }[] {
  if (id === "plan") return planRows(nodes);
  const sorted = [...nodes];
  if (id === "decisions") {
    const rank = (n: LaneNode) => (kindOf(n) === "constraint" ? -1 : (DECISION_RANK[n.project?.status ?? "proposed"] ?? 0));
    sorted.sort((a, b) => rank(a) - rank(b) || byCanvasPosition(a, b));
  } else if (id === "knowledge") {
    const rank = (n: LaneNode) => {
      const k = kindOf(n);
      if (k === "open_question") return n.project?.status === "answered" ? 3 : 0;
      if (k === "risk") return 1 + (SEVERITY_RANK[n.project?.severity ?? "low"] ?? 2) / 10;
      return n.project?.stage === "validated" ? 2.5 : 2;
    };
    sorted.sort((a, b) => rank(a) - rank(b) || byCanvasPosition(a, b));
  } else sorted.sort(byCanvasPosition);
  return sorted.map((node) => ({ node, indent: false }));
}

export function projectSummary(nodes: readonly LaneNode[]): ProjectSummary {
  const summary: ProjectSummary = {
    milestones: { total: 0, done: 0 },
    items: Object.fromEntries(PROGRESS_STATUSES.map((s) => [s, 0])) as Record<ProgressStatus, number>,
    proposedDecisions: 0,
    warnings: 0,
    openQuestions: 0,
  };
  const items = nodes.filter((n) => kindOf(n) === "progress_item");
  for (const n of nodes) {
    const k = kindOf(n);
    if (k === "project" && !summary.project) {
      summary.project = { key: n.key, label: n.label, ...(n.project?.focus ? { focus: n.project.focus } : {}), ...(n.project?.style ? { style: n.project.style } : {}) };
    } else if (k === "milestone") {
      summary.milestones.total++;
      const mine = items.filter((i) => i.project?.refs?.includes(n.key));
      if (mine.length && mine.every((i) => i.project?.status === "done")) summary.milestones.done++;
    } else if (k === "progress_item") {
      const status = PROGRESS_STATUSES.find((st) => st === n.project?.status) ?? "not_started";
      summary.items[status]++;
    } else if (k === "decision" || k === "constraint") {
      if (k === "decision" && (n.project?.status ?? "proposed") === "proposed") summary.proposedDecisions++;
      if (k === "constraint" || n.project?.enforce) summary.warnings++;
    } else if (k === "open_question" && n.project?.status !== "answered") summary.openQuestions++;
  }
  return summary;
}

export interface LaneLayout<T extends LaneNode> {
  nodes: T[];
  lanes: LensLane[];
  /** The whole view, from the origin. */
  box: Box;
  summary: ProjectSummary;
}

/**
 * Lays `nodes` out: `project` nodes as full-width banners on top, then one column per lane. Nodes of a kind no lane
 * takes (an architecture node dropped into the frame, a node with no kind) are kept in Notes so nothing disappears.
 */
export function layoutProjectLanes<T extends LaneNode>(nodes: readonly T[]): LaneLayout<T> {
  const width = PROJECT_LANE_DEFS.length * LANE_W + (PROJECT_LANE_DEFS.length - 1) * LANE_GAP;
  const boxes = new Map<string, Box>();

  const banners = nodes.filter((n) => kindOf(n) === "project").sort(byCanvasPosition);
  let y = PAD;
  for (const b of banners) {
    boxes.set(b.id, { x: PAD, y, width, height: BANNER_H });
    y += BANNER_H + NODE_GAP;
  }
  const lanesTop = banners.length ? y + 4 : PAD;

  const rest = nodes.filter((n) => kindOf(n) !== "project");
  let bottom = lanesTop;
  const lanes: LensLane[] = PROJECT_LANE_DEFS.map((def, i) => {
    const members = rest.filter((n) => (laneOf(kindOf(n)) ?? "notes") === def.id);
    const x = PAD + i * (LANE_W + LANE_GAP);
    let ly = lanesTop + HEAD_H + NODE_GAP;
    for (const { node, indent } of laneRows(def.id, members)) {
      boxes.set(node.id, { x: x + (indent ? INDENT : 0), y: ly, width: LANE_W - (indent ? INDENT : 0), height: NODE_H });
      ly += NODE_H + NODE_GAP;
    }
    bottom = Math.max(bottom, ly);
    return { id: def.id, name: def.name, box: { x, y: lanesTop, width: LANE_W, height: 0 }, count: members.length };
  });
  for (const lane of lanes) lane.box.height = bottom - lanesTop;

  return {
    nodes: nodes.map((n) => ({ ...n, box: boxes.get(n.id) ?? n.box })),
    lanes,
    box: { x: 0, y: 0, width: width + PAD * 2, height: bottom + PAD },
    summary: projectSummary(nodes),
  };
}
