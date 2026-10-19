/**
 * Trace (plan §4, §5.2, D16; Phase 3): the shortest path between two nodes of the workspace, across canvases and
 * Lens levels, with every hop named — the relation it follows ("Checkout calls Payments") or the level it crosses
 * ("Payments contains Webhook handler, zoom in"). One BFS, used by the Trace node action, MCP's `trace_lens_path` and
 * (later) the canvas's route probe (plan 0.5). Pure, over the workspace graph (D41), like `impactOf`.
 *
 * - **Kinds** filter the relations a path may follow: `dependency`, `data`, `execution`, or `any` (every relation,
 *   typed or not). Level hops — a node to the nodes of the frame it drills into, and an arrow typed `contains` — are
 *   structure, allowed in every kind.
 * - **Direction:** a path along the arrows is looked for first (`directed: true`); only when there is none, one that
 *   may run against them (each such hop says `forward: false`). Level hops have no direction.
 * - Bounded: at most `TRACE_LIMITS.maxHops` hops.
 */
import { RELATION_LABELS } from "@/domain/canvas/diagram";
import type { RelationType } from "@/domain/types";
import { codeEvidence, type LensEvidence } from "./evidence";
import { frameLevelOf, frameOf, resolve, type GraphEdge, type GraphNode, type WorkspaceGraph } from "@/domain/project/workspaceGraph";

export const TRACE_KINDS = ["any", "dependency", "data", "execution"] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

export const TRACE_LIMITS = { maxHops: 12, codePerStop: 3, candidates: 10 } as const;

/** The relations each kind may follow (`any` follows every relation, and untyped arrows too). */
const KIND_RELATIONS: Record<Exclude<TraceKind, "any">, readonly RelationType[]> = {
  dependency: ["depends_on", "calls", "reads", "writes", "publishes", "subscribes", "implements", "derived_from"],
  data: ["flows_to", "reads", "writes", "publishes", "subscribes"],
  execution: ["calls", "flows_to", "publishes", "subscribes"],
};

export interface TraceStop {
  ref: string;
  id: string;
  label: string;
  kind?: string;
  canvasId: string;
  /** The frame it sits in (element id), and that frame's Lens key. */
  frameId?: string;
  frameKey?: string;
  level?: number;
  /** Its code evidence, at most `TRACE_LIMITS.codePerStop` (the "evidence per hop"). */
  code: LensEvidence[];
}

export interface TraceHop {
  /** `relation`: an arrow; `zoom_in` / `zoom_out`: from a node to a node of the level it drills into, or back. */
  via: "relation" | "zoom_in" | "zoom_out";
  relation?: RelationType;
  /** False when the hop runs against its arrow (only in an undirected path). */
  forward: boolean;
  arrowId?: string;
  label?: string;
  explanation?: string;
  /** The hop in words: "Checkout calls Payments", "Payments contains Webhook handler (zoom in)". */
  text: string;
}

export interface LensPath {
  kind: TraceKind;
  /** Every relation hop follows its arrow. */
  directed: boolean;
  /** `stops[i]` → `stops[i + 1]` is `hops[i]`. */
  stops: TraceStop[];
  hops: TraceHop[];
}

export type TraceEnd = { ok: true; node: GraphNode } | { ok: false; reason: "not_found" | "ambiguous" | "not_a_node"; message: string; candidates: { ref: string; label: string; canvasId: string }[] };

const vertex = (n: Pick<GraphNode, "canvasId" | "id">) => `${n.canvasId}/${n.id}`;

/**
 * The node `text` names: a key or element id first, then a node label (case-insensitive, exact, then contained).
 * A frame's address names the node that drills into it.
 */
export function findTraceEnd(g: WorkspaceGraph, text: string): TraceEnd {
  const wanted = text.trim();
  const hit = resolve(g, wanted);
  if (hit?.what === "node") {
    if (g.ambiguous.has(wanted)) return ambiguous(wanted, g.nodes.filter((n) => n.key === wanted));
    return { ok: true, node: hit };
  }
  if (hit?.what === "frame") {
    const parentRef = g.drilledFrom.get(`${hit.canvasId}/${hit.id}`);
    const parent = parentRef ? resolve(g, parentRef) : undefined;
    if (parent?.what === "node") return { ok: true, node: parent };
    return { ok: false, reason: "not_a_node", message: `"${hit.title}" is a frame no node drills into; trace between nodes.`, candidates: [] };
  }
  const lower = wanted.toLowerCase();
  const exact = g.nodes.filter((n) => n.label.trim().toLowerCase() === lower);
  if (exact.length === 1) return { ok: true, node: exact[0]! };
  if (exact.length > 1) return ambiguous(wanted, exact);
  const partial = g.nodes.filter((n) => n.label.toLowerCase().includes(lower));
  if (partial.length === 1) return { ok: true, node: partial[0]! };
  if (partial.length > 1) return ambiguous(wanted, partial);
  return { ok: false, reason: "not_found", message: `No node "${wanted}" in this workspace (a key, an id or a label).`, candidates: [] };
}

function ambiguous(wanted: string, nodes: readonly GraphNode[]): TraceEnd {
  return {
    ok: false,
    reason: "ambiguous",
    message: `"${wanted}" names ${nodes.length} nodes; use one's key.`,
    candidates: nodes.slice(0, TRACE_LIMITS.candidates).map((n) => ({ ref: n.ref, label: n.label, canvasId: n.canvasId })),
  };
}

interface Link {
  to: GraphNode;
  hop: Omit<TraceHop, "text">;
  /** For an arrow: its source and target, to word the hop the way the arrow reads. */
  edge?: GraphEdge;
}

/** Every link out of each node: relations both ways (marked), and level hops. */
function links(g: WorkspaceGraph, kind: TraceKind): Map<string, Link[]> {
  const out = new Map<string, Link[]>();
  const add = (from: GraphNode, link: Link) => {
    const list = out.get(vertex(from));
    if (list) list.push(link);
    else out.set(vertex(from), [link]);
  };
  // Arrows name their ends by ref on their own canvas; look them up there (a key may also exist elsewhere).
  const byCanvasRef = new Map<string, GraphNode>();
  for (const n of g.nodes) {
    byCanvasRef.set(`${n.canvasId}\u0000${n.id}`, n);
    if (n.key) byCanvasRef.set(`${n.canvasId}\u0000${n.key}`, n);
  }
  const allowed = kind === "any" ? null : new Set<RelationType>(KIND_RELATIONS[kind]);
  for (const e of g.edges) {
    const a = byCanvasRef.get(`${e.canvasId}\u0000${e.from}`);
    const b = byCanvasRef.get(`${e.canvasId}\u0000${e.to}`);
    if (!a || !b || a === b) continue;
    if (e.relation === "contains") {
      add(a, { to: b, hop: { via: "zoom_in", relation: "contains", forward: true, arrowId: e.id } });
      add(b, { to: a, hop: { via: "zoom_out", relation: "contains", forward: true, arrowId: e.id } });
      continue;
    }
    if (allowed && (!e.relation || !allowed.has(e.relation))) continue;
    const base = { via: "relation" as const, ...(e.relation ? { relation: e.relation } : {}), arrowId: e.id, ...(e.label ? { label: e.label } : {}), ...(e.explanation ? { explanation: e.explanation } : {}) };
    add(a, { to: b, hop: { ...base, forward: true }, edge: e });
    add(b, { to: a, hop: { ...base, forward: false }, edge: e });
  }
  // Drill links: every node that drills into a frame, to every node in that frame, and back.
  const inFrame = new Map<string, GraphNode[]>();
  for (const child of g.nodes) {
    if (!child.frameId) continue;
    const at = `${child.canvasId}/${child.frameId}`;
    const list = inFrame.get(at);
    if (list) list.push(child);
    else inFrame.set(at, [child]);
  }
  for (const parent of g.nodes) {
    if (!parent.drillsTo) continue;
    for (const child of inFrame.get(`${parent.drillsTo.canvasId}/${parent.drillsTo.frameId}`) ?? []) {
      if (child === parent) continue;
      add(parent, { to: child, hop: { via: "zoom_in", forward: true } });
      add(child, { to: parent, hop: { via: "zoom_out", forward: true } });
    }
  }
  return out;
}

function stopOf(g: WorkspaceGraph, n: GraphNode): TraceStop {
  const frame = frameOf(g, n);
  return {
    ref: n.ref,
    id: n.id,
    label: n.label,
    ...(n.kind ? { kind: n.kind } : {}),
    canvasId: n.canvasId,
    ...(frame ? { frameId: frame.id, frameKey: frame.ref, level: frameLevelOf(g, frame) } : {}),
    code: codeEvidence(n.code ?? []).slice(0, TRACE_LIMITS.codePerStop),
  };
}

function words(link: Link, from: TraceStop, to: TraceStop): string {
  const { hop } = link;
  const levels = from.level !== undefined && to.level !== undefined && from.level !== to.level ? `, L${from.level} → L${to.level}` : "";
  if (hop.via === "zoom_in") return `${from.label} contains ${to.label} (zoom in${levels})`;
  if (hop.via === "zoom_out") return `${to.label} contains ${from.label} (zoom out${levels})`;
  const verb = hop.relation ? RELATION_LABELS[hop.relation] : "connects to";
  return hop.forward ? `${from.label} ${verb} ${to.label}` : `${to.label} ${verb} ${from.label} (against the arrow)`;
}

/** Breadth-first: the fewest hops from `from` to `to`, following only `forward` links when `directed`. */
function search(adjacency: Map<string, Link[]>, from: GraphNode, to: GraphNode, directed: boolean, maxHops: number): { nodes: GraphNode[]; links: Link[] } | undefined {
  const prev = new Map<string, { node: GraphNode; link: Link } | null>([[vertex(from), null]]);
  let frontier = [from];
  for (let depth = 0; depth < maxHops && frontier.length; depth++) {
    const next: GraphNode[] = [];
    for (const n of frontier) {
      for (const link of adjacency.get(vertex(n)) ?? []) {
        if (directed && !link.hop.forward) continue;
        const v = vertex(link.to);
        if (prev.has(v)) continue;
        prev.set(v, { node: n, link });
        if (v === vertex(to)) {
          const nodes: GraphNode[] = [to];
          const path: Link[] = [];
          for (let step = prev.get(v); step; step = prev.get(vertex(step.node))) {
            path.unshift(step.link);
            nodes.unshift(step.node);
          }
          return { nodes, links: path };
        }
        next.push(link.to);
      }
    }
    frontier = next;
  }
  return undefined;
}

export interface Reach {
  node: GraphNode;
  /** True when some path from the start follows the arrows all the way; false when every path runs against one. */
  directed: boolean;
}

/** The key `reachableFrom` files a node under: its canvas and element id. */
export const reachKey = (n: Pick<GraphNode, "canvasId" | "id">) => vertex(n);

/**
 * Every node a trace from `from` can end at (within `maxHops`), for the "pick the end" step: the nodes reachable along
 * the arrows are `directed`, the ones only reachable against them are not (`tracePath` finds both). `from` itself is
 * left out. Uses the same links as `tracePath`, so a node is in the result exactly when picking it yields a path.
 */
export function reachableFrom(g: WorkspaceGraph, from: GraphNode, kind: TraceKind = "any", maxHops: number = TRACE_LIMITS.maxHops): Map<string, Reach> {
  const adjacency = links(g, kind);
  const flood = (directed: boolean): Map<string, GraphNode> => {
    const seen = new Map<string, GraphNode>([[vertex(from), from]]);
    let frontier = [from];
    for (let depth = 0; depth < maxHops && frontier.length; depth++) {
      const next: GraphNode[] = [];
      for (const n of frontier) {
        for (const link of adjacency.get(vertex(n)) ?? []) {
          if (directed && !link.hop.forward) continue;
          const v = vertex(link.to);
          if (seen.has(v)) continue;
          seen.set(v, link.to);
          next.push(link.to);
        }
      }
      frontier = next;
    }
    return seen;
  };
  const along = flood(true);
  const out = new Map<string, Reach>();
  for (const [v, node] of flood(false)) if (v !== vertex(from)) out.set(v, { node, directed: along.has(v) });
  return out;
}

/**
 * The path from `from` to `to` (nodes of `g`), or undefined when none is within `maxHops`. A path along the arrows
 * wins over a shorter one that runs against them.
 */
export function tracePath(g: WorkspaceGraph, from: GraphNode, to: GraphNode, kind: TraceKind = "any", maxHops: number = TRACE_LIMITS.maxHops): LensPath | undefined {
  if (vertex(from) === vertex(to)) return { kind, directed: true, stops: [stopOf(g, from)], hops: [] };
  const adjacency = links(g, kind);
  const directed = search(adjacency, from, to, true, maxHops);
  const found = directed ?? search(adjacency, from, to, false, maxHops);
  if (!found) return undefined;
  const stops = found.nodes.map((n) => stopOf(g, n));
  const hops = found.links.map((link, i) => ({ ...link.hop, text: words(link, stops[i]!, stops[i + 1]!) }));
  return { kind, directed: hops.every((h) => h.forward), stops, hops };
}
