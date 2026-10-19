/**
 * Interactive architecture frames (plan: .ai/docs/interactive-architecture-frames-plan.md).
 *
 * A frame marked `acuteDiagram.interactive` reads as an architecture diagram: its shapes are nodes with a semantic
 * kind (and optional sublabel, tag, details), the arrows bound between them are its relationships (label = the
 * arrow's bound text, plus an optional explanation). Everything lives in `customData`, so it persists, syncs and
 * exports with the element; the interactive layer (passport card, highlight, legend) only reads it.
 *
 * The same two objects also hold Acute Lens's fields (`NodeLens`, `FrameLens`; plan: .ai/docs/acute-lens-plan.md §3).
 * Each half has its own getter and `with…` writer, and each writer keeps the other half, so setting a kind never drops
 * a Lens link and linking a detail frame never drops a kind.
 *
 * Pure and renderer-agnostic, like the adapter: written against `SceneElement`.
 */
import type { RelationType } from "../types";
import { getArrowRelation, type SceneElement } from "./adapter";
import { getNodeProject, normalizeProject, PROJECT_KINDS, PROJECT_KIND_LABELS, type NodeProject, type ProjectKind } from "./nodeProject";

export { getNodeProject } from "./nodeProject";

/** Architecture kinds; `endpoint`, `step`, `function`, `event`, `store` are L3 flow and L4 operation nodes (plan §3.2, Phase 2). */
export const NODE_KINDS = ["frontend", "backend", "database", "cloud", "security", "messagebus", "external", "endpoint", "step", "function", "event", "store"] as const;
/** The architecture kinds: what AI, Mermaid and the kind picker offer. Project kinds (D33) are not among them. */
export type ArchitectureKind = (typeof NODE_KINDS)[number];
/** Every kind a node can carry: architecture kinds and the project-knowledge kinds. */
export const ALL_NODE_KINDS: readonly NodeKind[] = [...NODE_KINDS, ...PROJECT_KINDS];
export type NodeKind = ArchitectureKind | ProjectKind;

export const NODE_KIND_LABELS: Record<NodeKind, string> = {
  ...PROJECT_KIND_LABELS,
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  cloud: "Cloud",
  security: "Security",
  messagebus: "Message bus",
  external: "External",
  endpoint: "Endpoint",
  step: "Step",
  function: "Function",
  event: "Event",
  store: "Store",
};

/** How a relation type reads in a sentence ("Orders depends on Payments"). Typed, so a new type needs a label. */
export const RELATION_LABELS: Record<RelationType, string> = {
  relates_to: "relates to",
  flows_to: "flows to",
  caused_by: "caused by",
  depends_on: "depends on",
  supports: "supports",
  blocks: "blocks",
  implements: "implements",
  derived_from: "derived from",
  references: "references",
  explained_by: "explained by",
  supersedes: "supersedes",
  deviates_from: "deviates from",
  option_of: "has the option",
  calls: "calls",
  reads: "reads",
  writes: "writes",
  publishes: "publishes",
  subscribes: "subscribes",
  contains: "contains",
};

/** The descriptive half of `acuteNode`: what AI, MCP and the properties panel write. */
export interface NodeSemantics {
  kind?: NodeKind;
  sublabel?: string;
  tag?: string;
  /** Responsibilities / notes shown in the node's passport card. */
  details?: string[];
}

export interface EdgeSemantics {
  /** Why this connection exists, shown when the relationship is inspected. */
  explanation?: string;
  /** How sure an AI plan was that it exists (0–1); absent for what people drew (Lens plan §6.3). */
  confidence?: number;
}

export interface DiagramCard {
  kind?: NodeKind;
  title: string;
  items: string[];
}

/** The diagram half of `acuteDiagram`. */
export interface DiagramMeta {
  type: "architecture";
  interactive: boolean;
  cards?: DiagramCard[];
}

/** Lens profiles (plan D10): the architecture profile, and the project profile (D25, §3.6) of decisions and progress. */
export const LENS_PROFILES = ["architecture", "project"] as const;
export type LensProfileId = (typeof LENS_PROFILES)[number];
/** The deepest level any profile has (architecture: L0 System … L5 Source). */
export const LENS_MAX_LEVEL = 5;

export const LENS_LIMITS = { key: 200, sources: 8, path: 500 } as const;

/** What a source is to its node (plan D48), so "tests linked to this component" is a read. */
export const SOURCE_ROLES = ["implementation", "test", "config", "doc"] as const;
export type SourceRole = (typeof SOURCE_ROLES)[number];

/** Code a node is implemented by: entered in the panel, or by the user's agent. */
export interface NodeSource {
  path: string;
  /** 1-based, inclusive, start ≤ end. */
  lines?: [number, number];
  commit?: string;
  role?: SourceRole;
}

/** The Lens half of `acuteNode`. */
export interface NodeLens {
  /** Stable semantic identity of a hand-drawn node (plan §3.1.1); kept on rename. */
  key?: string;
  /** "Zooming into me shows that frame": its `lensKey` or id, and its canvas when it's on another one. */
  expandsTo?: { frameKey: string; canvasId?: string };
  sources?: NodeSource[];
  /**
   * A copy of a Repo Map or Visualize object (D21 + D59): it carries the original's provenance, reconciliation key
   * included, but not its Lens identity, which stays with the original. Set by the copy rule only.
   */
  ownIdentity?: true;
}

/** The Lens half of `acuteDiagram`. */
export interface FrameLens {
  /** Index into the profile's levels; inferred when missing. */
  level?: number;
  /** Stable id for deep links and `expandsTo`; the frame id when missing. */
  lensKey?: string;
  profile?: LensProfileId;
}

const MAX_TEXT = 500;
const MAX_ITEMS = 20;

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t.slice(0, MAX_TEXT) : undefined;
}

function textList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(text).filter((v): v is string => !!v).slice(0, MAX_ITEMS);
  return items.length ? items : undefined;
}

function kind(value: unknown): NodeKind | undefined {
  return ALL_NODE_KINDS.includes(value as NodeKind) ? (value as NodeKind) : undefined;
}

function compact<T extends object>(value: T): T | undefined {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

function raw(el: Pick<SceneElement, "customData">, prop: "acuteNode" | "acuteDiagram"): Record<string, unknown> | undefined {
  const value = el.customData?.[prop];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** `customData` with `prop` set to both halves merged (removed when both are empty). */
function withHalves(customData: Record<string, unknown> | undefined, prop: "acuteNode" | "acuteDiagram", ...halves: (object | undefined)[]): Record<string, unknown> {
  const next = { ...customData };
  const merged: Record<string, unknown> = Object.assign({}, ...halves.filter(Boolean));
  if (Object.keys(merged).length) next[prop] = merged;
  else delete next[prop];
  return next;
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** A single-line identifier: trimmed, at most `max` characters, no control characters. */
function keyText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t && t.length <= max && !CONTROL_CHARS.test(t) ? t : undefined;
}

/** Normalised node semantics stored on a shape, or undefined when it has none. */
export function getNodeSemantics(el: Pick<SceneElement, "customData">): NodeSemantics | undefined {
  const r = raw(el, "acuteNode");
  if (!r) return undefined;
  return compact<NodeSemantics>({ kind: kind(r.kind), sublabel: text(r.sublabel), tag: text(r.tag), details: textList(r.details) });
}

/** `customData` with the node semantics replaced (the Lens and project halves kept; `acuteNode` removed when all are empty). */
export function withNodeSemantics(customData: Record<string, unknown> | undefined, semantics: NodeSemantics | undefined): Record<string, unknown> {
  const normalized = semantics && getNodeSemantics({ customData: { acuteNode: semantics } });
  return withHalves(customData, "acuteNode", getNodeLens({ customData }), getNodeProject({ customData }), normalized);
}

function nodeSource(value: unknown): NodeSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const path = keyText(v.path, LENS_LIMITS.path);
  if (!path) return undefined;
  const [start, end] = Array.isArray(v.lines) && v.lines.length === 2 ? v.lines : [];
  const lines = Number.isInteger(start) && Number.isInteger(end) && start >= 1 && start <= end ? ([start, end] as [number, number]) : undefined;
  const commit = typeof v.commit === "string" && /^[0-9a-f]{4,64}$/i.test(v.commit.trim()) ? v.commit.trim() : undefined;
  const role = SOURCE_ROLES.find((r) => r === v.role);
  return compact<NodeSource>({ path, lines, commit, role });
}

/** Normalised Lens fields stored on a node, or undefined when it has none. */
export function getNodeLens(el: Pick<SceneElement, "customData">): NodeLens | undefined {
  const r = raw(el, "acuteNode");
  if (!r) return undefined;
  const to = r.expandsTo && typeof r.expandsTo === "object" ? (r.expandsTo as Record<string, unknown>) : undefined;
  const frameKey = to && keyText(to.frameKey, LENS_LIMITS.key);
  const canvasId = to && keyText(to.canvasId, LENS_LIMITS.key);
  const sources = Array.isArray(r.sources) ? r.sources.flatMap((x) => nodeSource(x) ?? []).slice(0, LENS_LIMITS.sources) : [];
  return compact<NodeLens>({
    key: keyText(r.key, LENS_LIMITS.key),
    expandsTo: frameKey ? { frameKey, ...(canvasId ? { canvasId } : {}) } : undefined,
    sources: sources.length ? sources : undefined,
    ownIdentity: r.ownIdentity === true ? true : undefined,
  });
}

/** `customData` with the node's Lens fields replaced (the semantics and project halves kept; `acuteNode` removed when all are empty). */
export function withNodeLens(customData: Record<string, unknown> | undefined, lens: NodeLens | undefined): Record<string, unknown> {
  const normalized = lens && getNodeLens({ customData: { acuteNode: lens } });
  return withHalves(customData, "acuteNode", getNodeSemantics({ customData }), getNodeProject({ customData }), normalized);
}

/**
 * `customData` with the node's project-knowledge fields replaced (plan D33, D53; the semantics and Lens halves kept;
 * `acuteNode` removed when all are empty). Validated per field against the kind the node has right now, so set the
 * kind first (`withNodeSemantics`) when both change.
 */
export function withNodeProject(customData: Record<string, unknown> | undefined, project: NodeProject | undefined): Record<string, unknown> {
  const kind = (customData?.acuteNode as Record<string, unknown> | undefined)?.kind;
  const normalized = project && normalizeProject(kind, project as Record<string, unknown>);
  return withHalves(customData, "acuteNode", getNodeSemantics({ customData }), getNodeLens({ customData }), normalized);
}

export function getEdgeSemantics(el: Pick<SceneElement, "customData">): EdgeSemantics | undefined {
  const raw = el.customData?.acuteEdge as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return undefined;
  const confidence = typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : undefined;
  return compact<EdgeSemantics>({ explanation: text(raw.explanation), confidence });
}

export function withEdgeSemantics(customData: Record<string, unknown> | undefined, semantics: EdgeSemantics | undefined): Record<string, unknown> {
  const next = { ...customData };
  const normalized = semantics && getEdgeSemantics({ customData: { acuteEdge: semantics } });
  if (normalized) next.acuteEdge = normalized;
  else delete next.acuteEdge;
  return next;
}

export function getDiagramMeta(el: Pick<SceneElement, "customData">): DiagramMeta | undefined {
  const r = raw(el, "acuteDiagram");
  if (!r || r.type !== "architecture") return undefined;
  const cards = Array.isArray(r.cards)
    ? r.cards.flatMap((c: unknown) => {
        const card = c as Record<string, unknown> | null;
        const title = card && text(card.title);
        if (!title) return [];
        return [compact<DiagramCard>({ kind: kind(card.kind), title, items: textList(card.items) ?? [] })!];
      })
    : [];
  return { type: "architecture", interactive: r.interactive === true, ...(cards.length ? { cards: cards.slice(0, MAX_ITEMS) } : {}) };
}

/** `customData` with the diagram meta replaced (the Lens half kept; `acuteDiagram` removed when both are empty). */
export function withDiagramMeta(customData: Record<string, unknown> | undefined, meta: DiagramMeta | undefined): Record<string, unknown> {
  const normalized = meta && getDiagramMeta({ customData: { acuteDiagram: meta } });
  return withHalves(customData, "acuteDiagram", getFrameLens({ customData }), normalized);
}

/** Normalised Lens fields stored on a frame, or undefined when it has none. */
export function getFrameLens(el: Pick<SceneElement, "customData">): FrameLens | undefined {
  const r = raw(el, "acuteDiagram");
  if (!r) return undefined;
  const level = typeof r.level === "number" && Number.isInteger(r.level) && r.level >= 0 && r.level <= LENS_MAX_LEVEL ? r.level : undefined;
  const profile = LENS_PROFILES.find((p) => p === r.profile);
  return compact<FrameLens>({ level, lensKey: keyText(r.lensKey, LENS_LIMITS.key), profile });
}

/** `customData` with the frame's Lens fields replaced (the diagram meta kept; `acuteDiagram` removed when both are empty). */
export function withFrameLens(customData: Record<string, unknown> | undefined, lens: FrameLens | undefined): Record<string, unknown> {
  const normalized = lens && getFrameLens({ customData: { acuteDiagram: lens } });
  return withHalves(customData, "acuteDiagram", getDiagramMeta({ customData }), normalized);
}

// ---------------------------------------------------------------------------
// The frame's graph
/**
 * The copy rule (plan §3.1.1, D59): `customData` with a copied node's or frame's Lens key dropped, or `null` when it
 * had none. A key must not survive a copy that would duplicate it — like a relation dropped on a lone copied arrow —
 * so refs and drill links keep naming the original; the copy gets a fresh key the next time Lens needs one
 * (`ensureNodeKey`). Everything else on it (kind, project fields, its own `refs`, drill link, sources) is kept.
 */
export function dropsLensKeyOnCopy(el: Pick<SceneElement, "type" | "customData">): Record<string, unknown> | null {
  if (el.type === "frame") {
    const lens = getFrameLens(el);
    return lens?.lensKey ? withFrameLens(el.customData, { ...lens, lensKey: undefined }) : null;
  }
  if (!NODE_ELEMENT_TYPES.includes(el.type)) return null;
  const lens = getNodeLens(el);
  return lens?.key ? withNodeLens(el.customData, { ...lens, key: undefined }) : null;
}

/**
 * A node's stored fields as plain lines ("Decision · Proposed", "Reason: …"), for search and AI context (plan Phase 6,
 * C6): the descriptive half and the project-knowledge half, never Lens keys or refs (identifiers, not content).
 * Empty for a shape with no `acuteNode`.
 */
export function nodeFieldLines(el: Pick<SceneElement, "customData">): string[] {
  const s = getNodeSemantics(el);
  const p = getNodeProject(el);
  if (!s && !p) return [];
  const lines: string[] = [];
  const status = p?.status ? p.status.replace(/_/g, " ") : undefined;
  if (s?.kind) lines.push([NODE_KIND_LABELS[s.kind], status, p?.stage, p?.severity, p?.intent, p?.style].filter(Boolean).join(" · "));
  if (s?.sublabel) lines.push(s.sublabel);
  if (s?.tag) lines.push(s.tag);
  if (s?.details?.length) lines.push(...s.details);
  if (p?.focus) lines.push(`Focus: ${p.focus}`);
  if (p?.reason) lines.push(`Reason: ${p.reason}`);
  if (p?.options?.length) lines.push(`Options: ${p.options.map((o) => (o.tradeoffs ? `${o.label} (${o.tradeoffs})` : o.label)).join("; ")}`);
  if (p?.chosen) lines.push(`Chosen: ${p.chosen}`);
  if (p?.note) lines.push(`Finding: ${p.note}`);
  if (p?.answer) lines.push(`Answer: ${p.answer}`);
  return lines;
}

// ---------------------------------------------------------------------------

/** Element types that can be diagram nodes. */
export const NODE_ELEMENT_TYPES: readonly string[] = ["rectangle", "ellipse", "diamond"];

export interface DiagramNode {
  id: string;
  label: string;
  semantics: NodeSemantics;
  box: { x: number; y: number; width: number; height: number };
}

export interface DiagramEdge {
  /** The arrow's element id. */
  id: string;
  from: string;
  to: string;
  label?: string;
  relation?: RelationType;
  explanation?: string;
  /** How sure an AI plan was that the link exists (0–1). */
  confidence?: number;
  /** Absolute points of the arrow's path, for highlighting it. */
  points: [number, number][];
}

export interface DiagramGraph {
  frameId: string;
  title: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

/** The interactive diagram frame an element belongs to (or is), if any. */
export function interactiveFrameOf(elements: readonly SceneElement[], element: SceneElement): SceneElement | undefined {
  const frameId = element.type === "frame" ? element.id : element.frameId;
  if (!frameId) return undefined;
  const frame = elements.find((el) => el.id === frameId && !el.isDeleted && el.type === "frame");
  return frame && getDiagramMeta(frame)?.interactive ? frame : undefined;
}

/** The frame's own title: the section's (Visualize's frames are named "1 · Structure"), else the frame's name. */
export function frameTitleOf(frame: Pick<SceneElement, "customData"> & { name?: string | null }): string {
  const overview = frame.customData?.acuteOverview as { title?: unknown } | undefined;
  return (typeof overview?.title === "string" && overview.title.trim()) || frame.name?.trim() || "Diagram";
}

function boundLabels(elements: readonly SceneElement[]): Map<string, string> {
  const labels = new Map<string, string>();
  for (const el of elements) {
    if (!el.isDeleted && el.type === "text" && el.containerId) labels.set(el.containerId, (el.originalText ?? el.text ?? "").trim());
  }
  return labels;
}

/**
 * The frame's nodes (its shapes) and the directed relationships between them (arrows bound at both ends to two of
 * its nodes — typed or not; an arrow needn't sit inside the frame itself). Order follows the scene (z-order).
 */
export function frameGraph(elements: readonly SceneElement[], frameId: string, options: { extraNodes?: readonly DiagramNode[] } = {}): DiagramGraph | undefined {
  const frame = elements.find((el) => el.id === frameId && !el.isDeleted && el.type === "frame");
  if (!frame) return undefined;
  const labels = boundLabels(elements);
  const nodes: DiagramNode[] = elements
    .filter((el) => !el.isDeleted && el.frameId === frameId && NODE_ELEMENT_TYPES.includes(el.type))
    .map((el) => ({
      id: el.id,
      label: labels.get(el.id) || "Untitled",
      semantics: getNodeSemantics(el) ?? {},
      box: { x: el.x, y: el.y, width: el.width, height: el.height },
    }));
  // Other node readers (Lens's map cards) join here so relations between them and the shapes are drawn too.
  if (options.extraNodes?.length) nodes.push(...options.extraNodes.filter((x) => !nodes.some((n) => n.id === x.id)));
  const ids = new Set(nodes.map((n) => n.id));
  const edges: DiagramEdge[] = [];
  for (const el of elements) {
    if (el.isDeleted || el.type !== "arrow") continue;
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    if (!from || !to || !ids.has(from) || !ids.has(to)) continue;
    const label = labels.get(el.id);
    const relation = getArrowRelation(el);
    const { explanation, confidence } = getEdgeSemantics(el) ?? {};
    edges.push({
      id: el.id,
      from,
      to,
      ...(label ? { label } : {}),
      ...(relation ? { relation } : {}),
      ...(explanation ? { explanation } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      points: (el.points ?? []).map(([px, py]) => [el.x + px, el.y + py]),
    });
  }
  const title = frameTitleOf(frame as SceneElement & { name?: string | null });
  return { frameId, title, nodes, edges };
}

export interface NodeNeighborhood {
  node: DiagramNode;
  outgoing: { edge: DiagramEdge; neighbor: DiagramNode }[];
  incoming: { edge: DiagramEdge; neighbor: DiagramNode }[];
  /** Nodes reachable against / along edge direction (excluding the node itself). */
  upstream: number;
  downstream: number;
}

function reach(graph: DiagramGraph, start: string, direction: "up" | "down"): number {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of graph.edges) {
      const next = direction === "down" ? (e.from === id ? e.to : undefined) : e.to === id ? e.from : undefined;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size - 1;
}

/** A node's direct relationships (self-loops appear once, as outgoing) and its authored reach. */
export function nodeNeighborhood(graph: DiagramGraph, nodeId: string): NodeNeighborhood | undefined {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const node = byId.get(nodeId);
  if (!node) return undefined;
  const outgoing = graph.edges.filter((e) => e.from === nodeId).map((edge) => ({ edge, neighbor: byId.get(edge.to)! }));
  const incoming = graph.edges.filter((e) => e.to === nodeId && e.from !== nodeId).map((edge) => ({ edge, neighbor: byId.get(edge.from)! }));
  return { node, outgoing, incoming, upstream: reach(graph, nodeId, "up"), downstream: reach(graph, nodeId, "down") };
}

/** Kinds present in the diagram with their node counts, in `NODE_KINDS` order (for the legend). */
export function kindCounts(graph: DiagramGraph): { kind: NodeKind; count: number }[] {
  return NODE_KINDS.map((k) => ({ kind: k, count: graph.nodes.filter((n) => n.semantics.kind === k).length })).filter((c) => c.count > 0);
}
