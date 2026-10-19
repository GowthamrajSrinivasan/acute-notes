/**
 * The workspace as one graph, across canvases (plan §3.6, §4, D41, D53): every node and frame with its address, the
 * relations drawn between nodes on each canvas, which node drills into which frame (the Lens hierarchy), and which
 * nodes' `refs` point where. What the Phase 7B tools — session context, decisions, warnings, impact, session review —
 * read; derived from the canvases alone (D2), never stored.
 *
 * Pure: canvases in (elements as persisted or live), graph out. The browser feeds it the open canvas live and the
 * others from their persisted Yjs updates; a hosted server can feed it the same way (D41).
 *
 * **Addresses (D13, D53).** A node is addressed by its Lens key when it has one and always by its element id; a frame
 * by its `lensKey` when it has one and always by its id. `ref` is the preferred address (key, else id). A ref in
 * `refs` / `supersedes` / `deviatesFrom` may use either, so lookups go through `resolve`.
 */
import { getArrowRelation, type SceneElement } from "@/domain/canvas/adapter";
import {
  frameTitleOf,
  getDiagramMeta,
  getFrameLens,
  getNodeLens,
  getNodeProject,
  getEdgeSemantics,
  getNodeSemantics,
  LENS_MAX_LEVEL,
  NODE_ELEMENT_TYPES,
  type LensProfileId,
  type NodeKind,
  type NodeSemantics,
  type NodeSource,
} from "@/domain/canvas/diagram";
import type { NodeProject } from "@/domain/canvas/nodeProject";
import type { DocumentRecord, RelationType } from "@/domain/types";
import { cardLabel, isCard } from "@/domain/lens/cards";
import { codeEvidence, lensEvidence, type LensEvidence } from "@/domain/lens/evidence";
import { lensKeyOf } from "@/domain/lens/identity";

export interface WorkspaceCanvas {
  canvasId: string;
  title?: string;
  elements: readonly SceneElement[];
  /** The canvas's documents (cards' titles and their map identities, D21). */
  getDocument?: (id: string) => DocumentRecord | null | undefined;
}

export interface GraphNode {
  what: "node";
  /** Element id. */
  id: string;
  /** Lens key, when it has one. */
  key?: string;
  /** Preferred address: `key`, else `id`. */
  ref: string;
  canvasId: string;
  /** The frame it sits in, if any (element id). */
  frameId?: string;
  label: string;
  kind?: NodeKind;
  semantics: NodeSemantics;
  project?: NodeProject;
  sources?: NodeSource[];
  /** Code locations: the user's `sources` and an agent's `sourceRefs` (Repo Map, Phase 2), as Lens shows them (§3.3). */
  code?: LensEvidence[];
  /**
   * The frame zooming into this node shows (`expandsTo`, else an `explained_by` arrow, plan §3.1), when it resolves.
   * Several nodes may drill into one frame; `drilledFrom` keeps one of them, this keeps every link (Trace).
   */
  drillsTo?: { canvasId: string; frameId: string };
  /** Scene version, for "changed since" (Agent State, D30). */
  version?: number;
}

export interface GraphFrame {
  what: "frame";
  id: string;
  /** `acuteDiagram.lensKey`, when set. */
  key?: string;
  ref: string;
  canvasId: string;
  title: string;
  interactive: boolean;
  profile?: LensProfileId;
  level?: number;
}

export interface GraphEdge {
  canvasId: string;
  /** Arrow element id. */
  id: string;
  /** Node refs. */
  from: string;
  to: string;
  relation?: RelationType;
  label?: string;
  /** `acuteEdge.explanation`: why the relation holds (Trace names it per hop). */
  explanation?: string;
}

export interface WorkspaceGraph {
  canvases: { canvasId: string; title?: string }[];
  nodes: GraphNode[];
  frames: GraphFrame[];
  edges: GraphEdge[];
  /** Every address (key and id, nodes and frames) → its target. A key on two elements maps to the first; see `ambiguous`. */
  byAddress: ReadonlyMap<string, GraphNode | GraphFrame>;
  /** Keys carried by more than one element (a ref to one of them can't be resolved with certainty). */
  ambiguous: ReadonlySet<string>;
  /** `canvasId/frameId` → the ref of the node that drills into that frame (`expandsTo`, else an `explained_by` arrow). */
  drilledFrom: ReadonlyMap<string, string>;
}

const frameAddr = (canvasId: string, frameId: string) => `${canvasId}/${frameId}`;

function labelsOf(elements: readonly SceneElement[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const el of elements) if (!el.isDeleted && el.type === "text" && el.containerId) labels.set(el.containerId, (el.originalText ?? el.text ?? "").trim());
  return labels;
}

export function buildWorkspaceGraph(canvases: readonly WorkspaceCanvas[]): WorkspaceGraph {
  const nodes: GraphNode[] = [];
  const frames: GraphFrame[] = [];
  const edges: GraphEdge[] = [];
  const byAddress = new Map<string, GraphNode | GraphFrame>();
  const ambiguous = new Set<string>();
  const drilledFrom = new Map<string, string>();
  const register = (address: string, target: GraphNode | GraphFrame, isKey: boolean) => {
    const prior = byAddress.get(address);
    if (!prior) byAddress.set(address, target);
    else if (isKey && (prior.canvasId !== target.canvasId || prior.id !== target.id)) ambiguous.add(address);
  };

  for (const { canvasId, elements, getDocument } of canvases) {
    const labels = labelsOf(elements);
    const live = elements.filter((el) => !el.isDeleted);
    const refOfId = new Map<string, string>();
    for (const el of live) {
      if (el.type === "frame") {
        const lens = getFrameLens(el);
        const f: GraphFrame = {
          what: "frame",
          id: el.id,
          ...(lens?.lensKey ? { key: lens.lensKey } : {}),
          ref: lens?.lensKey ?? el.id,
          canvasId,
          title: frameTitleOf(el as SceneElement & { name?: string | null }),
          interactive: !!getDiagramMeta(el)?.interactive,
          ...(lens?.profile ? { profile: lens.profile } : {}),
          ...(lens?.level !== undefined ? { level: lens.level } : {}),
        };
        frames.push(f);
        if (f.key) register(f.key, f, true);
        register(el.id, f, false);
        continue;
      }
      const card = isCard(el);
      if (!card && !NODE_ELEMENT_TYPES.includes(el.type)) continue;
      const semantics = getNodeSemantics(el) ?? {};
      const lens = getNodeLens(el);
      const project = getNodeProject(el);
      // D21: acuteNode.key, else the map identity the node carries (unless it's a copy).
      const key = lensKeyOf(el, getDocument);
      const label = card ? cardLabel(el, getDocument ?? (() => undefined)) : (labels.get(el.id) ?? "");
      // A shape that says nothing (no label, no kind, no key) isn't a node anyone can talk about.
      if (!label && !semantics.kind && !key) continue;
      const code = codeEvidence(lensEvidence(el, { canvasId, label: "" }, getDocument));
      const n: GraphNode = {
        what: "node",
        id: el.id,
        ...(key ? { key } : {}),
        ref: key ?? el.id,
        canvasId,
        ...(el.frameId ? { frameId: el.frameId } : {}),
        label: label || "Untitled",
        ...(semantics.kind ? { kind: semantics.kind } : {}),
        semantics,
        ...(project ? { project } : {}),
        ...(lens?.sources?.length ? { sources: lens.sources } : {}),
        ...(code.length ? { code } : {}),
        ...((el as { version?: number }).version !== undefined ? { version: (el as { version?: number }).version } : {}),
      };
      nodes.push(n);
      refOfId.set(el.id, n.ref);
      if (n.key) register(n.key, n, true);
      register(el.id, n, false);
    }
    // Relations: arrows bound at both ends to nodes on this canvas.
    for (const el of live) {
      if (el.type !== "arrow") continue;
      const from = el.startBinding?.elementId && refOfId.get(el.startBinding.elementId);
      const to = el.endBinding?.elementId && refOfId.get(el.endBinding.elementId);
      if (from && to) {
        const relation = getArrowRelation(el);
        const label = labels.get(el.id);
        const explanation = getEdgeSemantics(el)?.explanation;
        edges.push({ canvasId, id: el.id, from, to, ...(relation ? { relation } : {}), ...(label ? { label } : {}), ...(explanation ? { explanation } : {}) });
      }
      // An `explained_by` arrow from a node to a frame is a drill link (plan §3.1).
      const target = el.endBinding?.elementId && live.find((x) => x.id === el.endBinding!.elementId && x.type === "frame");
      if (from && target && getArrowRelation(el) === "explained_by") {
        const addr = frameAddr(canvasId, target.id);
        if (!drilledFrom.has(addr)) drilledFrom.set(addr, from);
        const src = nodes.find((x) => x.canvasId === canvasId && x.id === el.startBinding!.elementId);
        if (src && !src.drillsTo) src.drillsTo = { canvasId, frameId: target.id };
      }
    }
  }

  // `expandsTo` drill links, which may cross canvases (they win over `explained_by`; when several nodes drill into one
  // frame, the first one, in canvas order, is its parent).
  const byExpandsTo = new Set<string>();
  for (const n of nodes) {
    const elements = canvases.find((c) => c.canvasId === n.canvasId)?.elements;
    const el = elements?.find((e) => e.id === n.id);
    const to = el && getNodeLens(el)?.expandsTo;
    if (!to) continue;
    const canvasId = to.canvasId ?? n.canvasId;
    const frame = frames.find((f) => f.canvasId === canvasId && (f.key === to.frameKey || f.id === to.frameKey));
    if (!frame) continue;
    n.drillsTo = { canvasId, frameId: frame.id };
    const addr = frameAddr(canvasId, frame.id);
    if (!byExpandsTo.has(addr)) {
      byExpandsTo.add(addr);
      drilledFrom.set(addr, n.ref);
    }
  }

  return { canvases: canvases.map(({ canvasId, title }) => ({ canvasId, ...(title ? { title } : {}) })), nodes, frames, edges, byAddress, ambiguous, drilledFrom };
}

/** The node or frame an address names (a key or an element id), if any. */
export function resolve(g: WorkspaceGraph, address: string): GraphNode | GraphFrame | undefined {
  return g.byAddress.get(address);
}

/** Every address of a node or frame (its key and its id). */
export function addressesOf(target: GraphNode | GraphFrame): string[] {
  return target.key && target.key !== target.id ? [target.key, target.id] : [target.id];
}

/** The frame a node sits in, if any. */
export function frameOf(g: WorkspaceGraph, n: GraphNode): GraphFrame | undefined {
  return n.frameId ? g.frames.find((f) => f.canvasId === n.canvasId && f.id === n.frameId) : undefined;
}

/**
 * What a node or frame sits under in the Lens hierarchy, nearest first: its frame, the node that drills into that
 * frame, that node's frame, and so on (plan §3.1). Bounded and loop-safe.
 */
export function ancestorsOf(g: WorkspaceGraph, target: GraphNode | GraphFrame, limit = 12): (GraphNode | GraphFrame)[] {
  const out: (GraphNode | GraphFrame)[] = [];
  const seen = new Set<string>([`${target.canvasId}/${target.id}`]);
  let frame: GraphFrame | undefined = target.what === "node" ? frameOf(g, target) : target;
  if (target.what === "frame") frame = target;
  while (frame && out.length < limit) {
    if (frame !== target) {
      if (seen.has(`${frame.canvasId}/${frame.id}`)) break;
      seen.add(`${frame.canvasId}/${frame.id}`);
      out.push(frame);
    }
    const parentRef = g.drilledFrom.get(frameAddr(frame.canvasId, frame.id));
    const parent = parentRef ? resolve(g, parentRef) : undefined;
    if (!parent || parent.what !== "node" || seen.has(`${parent.canvasId}/${parent.id}`)) break;
    seen.add(`${parent.canvasId}/${parent.id}`);
    out.push(parent);
    frame = frameOf(g, parent);
  }
  return out;
}

/**
 * A frame's Lens level: its explicit `level`, else one below the frame holding the node that drills into it, else L1
 * (plan §3.1's inference, from the frame's true root rather than from whichever frame a viewer opened). Clamped to L5
 * and loop-safe.
 */
export function frameLevelOf(g: WorkspaceGraph, frame: GraphFrame): number {
  const seen = new Set<string>();
  let steps = 0;
  let f: GraphFrame | undefined = frame;
  while (f && f.level === undefined) {
    const addr = frameAddr(f.canvasId, f.id);
    if (seen.has(addr)) break;
    seen.add(addr);
    const parentRef = g.drilledFrom.get(addr);
    const parent = parentRef ? resolve(g, parentRef) : undefined;
    const up = parent?.what === "node" ? frameOf(g, parent) : undefined;
    if (!up) break;
    steps++;
    f = up;
  }
  return Math.min((f?.level ?? 1) + steps, LENS_MAX_LEVEL);
}

/** Nodes whose `refs` include any address of `target` (D53 (1): "which decisions affect this node?"). */
export function referencing(g: WorkspaceGraph, target: GraphNode | GraphFrame): GraphNode[] {
  const addrs = new Set(addressesOf(target));
  return g.nodes.filter((n) => n.project?.refs?.some((r) => addrs.has(r)));
}

/** Whether `refs` (a list of addresses) names any address in `addresses`. */
export const refsHit = (refs: readonly string[] | undefined, addresses: ReadonlySet<string>) => !!refs?.some((r) => addresses.has(r));
