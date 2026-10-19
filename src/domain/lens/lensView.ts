/**
 * Acute Lens's derived view of a frame hierarchy (plan §4): `lensView` walks a drilled `path` of node keys from
 * `root` to the current level; `lensTree` resolves the same links downward into a tree, for the level rail and
 * (later) MCP. Both read a node's child frame the same way (§3.1): `expandsTo`, else an `explained_by` arrow, else
 * a title-match suggestion — never written without the user asking. Pure and renderer-agnostic, like `frameGraph`;
 * Lens reads the canvas alone (D2) and never stores a second copy of the architecture.
 *
 * Canvases come only through a `SceneSource` (D41), so an `expandsTo` with a `canvasId` resolves into another
 * canvas's frame (Phase 1B) and a server-side reader can implement the same interface later. A node with code
 * evidence and no child frame drills one more step, into the profile's source level (L5, D12): a source card, not
 * a diagram.
 */
import { frameGraph, frameTitleOf, getDiagramMeta, getFrameLens, getNodeLens, getNodeProject, LENS_MAX_LEVEL, type DiagramEdge, type DiagramNode } from "@/domain/canvas/diagram";
import { projectKindOf, type NodeProject } from "@/domain/canvas/nodeProject";
import { getArrowRelation, type SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { frameCards } from "./cards";
import { codeEvidence, lensEvidence, type LensEvidence } from "./evidence";
import { lensKeyOf } from "./identity";
import { lensProfile, type LensProfile } from "./lensProfile";
import { layoutProjectLanes, projectBadge, type LensLane, type ProjectSummary } from "./projectLanes";

/** A frame on a canvas, addressed the way `expandsTo` and deep links will (plan §3.1). */
export interface FrameRef {
  canvasId: string;
  frameId: string;
}

/**
 * Where Lens reads canvases from (plan §4, D41). The browser implementation serves the open canvas live and loads
 * other canvases read-only on demand; a hosted server can implement it over its own Yjs docs.
 */
export interface SceneSource {
  /** A canvas's elements (deleted ones may be included), or undefined when it isn't available (yet). */
  elements(canvasId: string): readonly SceneElement[] | undefined;
  /** True while `elements(canvasId)` is still loading, as opposed to missing. */
  isLoading?(canvasId: string): boolean;
  /** Block and page records, for provenance kept on documents rather than elements. */
  getDocument?(id: string): DocumentRecord | null | undefined;
}

/** A source over one canvas's elements: what tests, and code that only ever looks at the open canvas, use. */
export function singleScene(canvasId: string, elements: readonly SceneElement[], getDocument?: SceneSource["getDocument"]): SceneSource {
  return { elements: (id) => (id === canvasId ? elements : undefined), getDocument };
}

export type ChildFrameVia = "expandsTo" | "explained_by" | "suggested";

export interface LensNode extends DiagramNode {
  /** Stable Lens key (§3.1.1): `acuteNode.key`, else the element id. */
  key: string;
  /**
   * "Zooming into me shows that frame", resolved in order: expandsTo, explained_by, title-match suggestion.
   * `pending` while the target is on another canvas that is still loading (`frameId` is then the link's key).
   */
  childFrame?: { canvasId: string; frameId: string; via: ChildFrameVia; pending?: boolean };
  evidence: LensEvidence[];
  /** The node's project-knowledge fields (decision status, progress state, `refs`, …), when it has any (D33, D53). */
  project?: NodeProject;
  /** A short state line for project nodes ("✓ Redis", "In progress"). */
  badge?: string;
}

export interface LensCrumb {
  frame: FrameRef;
  key: string;
  title: string;
  level: number;
  /** The L5 step: a node's source card, not a frame (`frame` is then the frame holding the node). */
  source?: boolean;
}

export interface LensLevelView {
  frame: FrameRef;
  profile: LensProfile;
  /** Index into the profile's levels. */
  level: number;
  /** Stable key of this frame (`acuteDiagram.lensKey`, else the frame id). */
  key: string;
  title: string;
  /** The frame's own canvas geometry, for normalising node/edge coordinates in the renderer. */
  box: DiagramNode["box"];
  nodes: LensNode[];
  edges: DiagramEdge[];
  /** Root first, this level last. */
  crumbs: LensCrumb[];
  /** This level's frame already appears earlier in `crumbs`: a drill link cycle (plan §11, AC12). */
  loop: boolean;
  /** The source level (L5): the node whose code this is, with its code evidence. `nodes`/`edges` are then empty. */
  source?: { node: LensNode; evidence: LensEvidence[] };
  /** The path's next step is on a canvas that is still loading: the view stops here until it arrives. */
  loading?: boolean;
  /** Project profile only: the lane columns the nodes are laid out in (their `box`es already follow them). */
  lanes?: LensLane[];
  /** Project profile only: the banner's counts (the L0 overview, D25). */
  summary?: ProjectSummary;
}

export interface LensTreeNode {
  frame: FrameRef;
  key: string;
  title: string;
  level: number;
  nodes: LensNode[];
  edges: DiagramEdge[];
  /** One per node that resolved a child frame, in node order. */
  children: LensTreeNode[];
  /** The source level, when a node here drills into a source card (code evidence, no child frame). */
  sourceLevel?: number;
  /** This frame already appears in the path that reached it: stops here instead of recursing. */
  loop: boolean;
}

const sameFrame = (a: FrameRef, b: FrameRef) => a.canvasId === b.canvasId && a.frameId === b.frameId;

function findFrameByKey(elements: readonly SceneElement[], key: string): SceneElement | undefined {
  return elements.find((el) => !el.isDeleted && el.type === "frame" && (getFrameLens(el)?.lensKey === key || el.id === key));
}

/** A node's child frame, resolved in the order plan §3.1 lists. `explained_by` and suggestions stay on its canvas. */
function resolveChildFrame(scenes: SceneSource, canvasId: string, elements: readonly SceneElement[], nodeEl: SceneElement, label: string): LensNode["childFrame"] {
  const expandsTo = getNodeLens(nodeEl)?.expandsTo;
  if (expandsTo) {
    const targetCanvas = expandsTo.canvasId ?? canvasId;
    const targetElements = targetCanvas === canvasId ? elements : scenes.elements(targetCanvas);
    const frame = targetElements && findFrameByKey(targetElements, expandsTo.frameKey);
    if (frame) return { canvasId: targetCanvas, frameId: frame.id, via: "expandsTo" };
    if (!targetElements && scenes.isLoading?.(targetCanvas)) return { canvasId: targetCanvas, frameId: expandsTo.frameKey, via: "expandsTo", pending: true };
  }
  const explainedBy = elements.find(
    (el) => !el.isDeleted && el.type === "arrow" && getArrowRelation(el) === "explained_by" && el.startBinding?.elementId === nodeEl.id,
  );
  const explainedTarget = explainedBy?.endBinding?.elementId && elements.find((el) => el.id === explainedBy.endBinding!.elementId && !el.isDeleted && el.type === "frame");
  if (explainedTarget) return { canvasId, frameId: explainedTarget.id, via: "explained_by" };

  const wanted = label.trim().toLowerCase();
  if (!wanted) return undefined;
  const suggestion = elements.find(
    (el) => !el.isDeleted && el.type === "frame" && el.id !== nodeEl.frameId && getDiagramMeta(el)?.interactive && frameTitleOf(el as SceneElement & { name?: string | null }).trim().toLowerCase() === wanted,
  );
  return suggestion ? { canvasId, frameId: suggestion.id, via: "suggested" } : undefined;
}

/** What zooming into a node shows: its child frame, else its source card when it has code, else nothing. */
export function drillTarget(node: Pick<LensNode, "childFrame" | "evidence">): "frame" | "source" | undefined {
  if (node.childFrame) return "frame";
  return codeEvidence(node.evidence).length ? "source" : undefined;
}

/**
 * One level, with no crumbs: the shared core of `lensView` and `lensTree`. `fallbackLevel` is what an explicit
 * `acuteDiagram.level` is missing (plan §3.1): the root's own level is its explicit level or L1; each drill step
 * adds 1, clamped to `LENS_MAX_LEVEL`.
 */
function lensLevel(scenes: SceneSource, ref: FrameRef, fallbackLevel: number): Omit<LensLevelView, "crumbs" | "loop"> | undefined {
  const elements = scenes.elements(ref.canvasId);
  // Shapes, and (Phase 2) the frame's cards: a Repo Map section's rich blocks and page previews.
  const graph = elements && frameGraph(elements, ref.frameId, { extraNodes: frameCards(elements, ref.frameId, scenes.getDocument) });
  if (!elements || !graph) return undefined;
  const frameEl = elements.find((el) => el.id === ref.frameId)!;
  const lens = getFrameLens(frameEl);
  const nodes: LensNode[] = graph.nodes.map((n) => {
    const nodeEl = elements.find((el) => el.id === n.id)!;
    return {
      ...n,
      // D21: acuteNode.key, else the map identity the node carries (unless it's a copy), else its id.
      key: lensKeyOf(nodeEl, scenes.getDocument) ?? n.id,
      childFrame: resolveChildFrame(scenes, ref.canvasId, elements, nodeEl, n.label),
      evidence: lensEvidence(nodeEl, { canvasId: ref.canvasId, label: `${graph.title} · ${n.label}` }, scenes.getDocument),
      ...projectFieldsOf(nodeEl),
    };
  });
  const profile = lensProfile(lens?.profile);
  // A level number is an index into this frame's own profile: a project frame has L0 and L1, whatever depth reached it.
  const level = Math.min(lens?.level ?? fallbackLevel, profile.levels[profile.levels.length - 1]!.index);
  const laid = profile.id === "project" ? layoutProjectLanes(nodes) : undefined;
  return {
    frame: ref,
    profile,
    level,
    key: lens?.lensKey ?? ref.frameId,
    title: graph.title,
    box: laid?.box ?? { x: frameEl.x, y: frameEl.y, width: frameEl.width, height: frameEl.height },
    nodes: laid?.nodes ?? nodes,
    edges: graph.edges,
    ...(laid ? { lanes: laid.lanes, summary: laid.summary } : {}),
  };
}

/**
 * One frame as a Lens level, without crumbs (what MCP's `get_lens` lists per level). `fallbackLevel` is used when the
 * frame has no explicit level. Undefined when the frame or its canvas isn't available.
 */
export function lensFrame(scenes: SceneSource, ref: FrameRef, fallbackLevel = 1): Omit<LensLevelView, "crumbs" | "loop"> | undefined {
  return lensLevel(scenes, ref, fallbackLevel);
}

/** A node's project-knowledge fields and badge, for `LensNode` (nothing for an architecture node). */
function projectFieldsOf(nodeEl: SceneElement): Pick<LensNode, "project" | "badge"> {
  const project = getNodeProject(nodeEl);
  const badge = projectBadge(projectKindOf(nodeEl), project);
  return { ...(project ? { project } : {}), ...(badge ? { badge } : {}) };
}

function sourceLevelOf(profile: LensProfile): number {
  return profile.sourceLevel ?? LENS_MAX_LEVEL;
}

/**
 * The view at the end of `path` (node keys drilled from `root`, outermost first). `path` stops resolving — and the
 * view reverts to the last level it could reach — once a step's node or child frame is gone, or once it has reached
 * a source card (nothing is below L5). A step into a canvas still loading stops with `loading` set.
 */
export function lensView(scenes: SceneSource, root: FrameRef, path: readonly string[] = []): LensLevelView | undefined {
  const rootLevel = lensLevel(scenes, root, 1);
  if (!rootLevel) return undefined;
  const crumbs: LensCrumb[] = [{ frame: root, key: rootLevel.key, title: rootLevel.title, level: rootLevel.level }];
  let current = rootLevel;
  let loading = false;
  for (const key of path) {
    const node = current.nodes.find((n) => n.key === key);
    const target = node && drillTarget(node);
    if (!node || !target) break;
    if (target === "source") {
      const level = sourceLevelOf(current.profile);
      crumbs.push({ frame: current.frame, key: node.key, title: node.label, level, source: true });
      return { ...current, level, nodes: [], edges: [], crumbs, loop: false, source: { node, evidence: codeEvidence(node.evidence) } };
    }
    const child = node.childFrame!;
    if (child.pending) {
      loading = true;
      break;
    }
    const nextRef: FrameRef = { canvasId: child.canvasId, frameId: child.frameId };
    const next = lensLevel(scenes, nextRef, current.level + 1);
    if (!next) break;
    const loop = crumbs.some((c) => sameFrame(c.frame, nextRef));
    crumbs.push({ frame: nextRef, key: next.key, title: next.title, level: next.level });
    current = next;
    if (loop) break;
  }
  const loop = crumbs.length > 1 && crumbs.slice(0, -1).some((c) => sameFrame(c.frame, current.frame));
  return { ...current, crumbs, loop, ...(loading ? { loading } : {}) };
}

/** The downward hierarchy from `root` (plan §4): every node's resolved child frame, recursively, for the level
 * rail and MCP's `get_lens`. Stops at a frame already on the path to it ("↻ loop", plan §11) rather than recursing
 * forever, and below `maxDepth` levels under `root` (its `children` are then left empty). */
export function lensTree(scenes: SceneSource, root: FrameRef, fallbackLevel = 1, ancestors: ReadonlySet<string> = new Set(), maxDepth = Infinity): LensTreeNode | undefined {
  const level = lensLevel(scenes, root, fallbackLevel);
  if (!level) return undefined;
  const id = `${root.canvasId}/${root.frameId}`;
  if (ancestors.has(id)) {
    return { frame: root, key: level.key, title: level.title, level: level.level, nodes: [], edges: [], children: [], loop: true };
  }
  const nextAncestors = new Set(ancestors).add(id);
  const children = level.nodes.flatMap((n) => {
    if (!n.childFrame || n.childFrame.pending || maxDepth <= 0) return [];
    const child = lensTree(scenes, { canvasId: n.childFrame.canvasId, frameId: n.childFrame.frameId }, level.level + 1, nextAncestors, maxDepth - 1);
    return child ? [child] : [];
  });
  const hasSource = level.nodes.some((n) => drillTarget(n) === "source");
  return {
    frame: root,
    key: level.key,
    title: level.title,
    level: level.level,
    nodes: level.nodes,
    edges: level.edges,
    children,
    ...(hasSource ? { sourceLevel: sourceLevelOf(level.profile) } : {}),
    loop: false,
  };
}

/** Every level number reachable at or below `tree`'s own level (for the level rail). */
export function reachableLevels(tree: LensTreeNode): Set<number> {
  const levels = new Set<number>([tree.level]);
  if (tree.sourceLevel !== undefined) levels.add(tree.sourceLevel);
  for (const child of tree.children) for (const l of reachableLevels(child)) levels.add(l);
  return levels;
}

/**
 * The canvas's Lens roots (plan §5.3, Navigator): interactive frames that no node on the same canvas drills into.
 * Links from other canvases aren't seen here, so a detail frame on a detail canvas still lists there as a root.
 */
export function lensRootFrames(scenes: SceneSource, canvasId: string): { frameId: string; title: string; level: number }[] {
  const elements = scenes.elements(canvasId);
  if (!elements) return [];
  const frames = elements.filter((el) => !el.isDeleted && el.type === "frame" && getDiagramMeta(el)?.interactive);
  const linked = new Set<string>();
  for (const f of frames) {
    for (const n of lensLevel(scenes, { canvasId, frameId: f.id }, 1)?.nodes ?? []) {
      if (n.childFrame && n.childFrame.canvasId === canvasId && n.childFrame.via !== "suggested" && n.childFrame.frameId !== f.id) linked.add(n.childFrame.frameId);
    }
  }
  return frames
    .filter((f) => !linked.has(f.id))
    .map((f) => ({ frameId: f.id, title: frameTitleOf(f as SceneElement & { name?: string | null }), level: getFrameLens(f)?.level ?? 1 }));
}

/**
 * Each interactive frame's level on this canvas, as Lens would show it opened from its root (for the canvas frame
 * chip, plan §5.3): explicit levels, else inferred by depth from the root that reaches it first.
 */
export function frameLevels(scenes: SceneSource, canvasId: string): Map<string, number> {
  const levels = new Map<string, number>();
  const visit = (tree: LensTreeNode) => {
    if (tree.frame.canvasId !== canvasId || levels.has(tree.frame.frameId)) return;
    levels.set(tree.frame.frameId, tree.level);
    tree.children.forEach(visit);
  };
  for (const root of lensRootFrames(scenes, canvasId)) {
    const tree = lensTree(scenes, { canvasId, frameId: root.frameId });
    if (tree) visit(tree);
  }
  return levels;
}
