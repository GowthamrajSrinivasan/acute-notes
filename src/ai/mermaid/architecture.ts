/**
 * Mermaid `architecture-beta` (interactive architecture frames, Phase 3 follow-up): Mermaid's own architecture syntax
 * → a plan whose frames are interactive diagrams. Its built-in icons name what a service is, so they map straight
 * to kinds (`database` and `disk` → database, `cloud` → cloud, `internet` → external, `server` → backend); any other
 * icon (`logos:aws-s3`) is read with the label, as for flowcharts (`componentKinds.ts`).
 *
 *   group api(cloud)[API]
 *   service db(database)[Database] in api
 *   junction hub in api
 *   db:L -- R:server        (`-->` / `<--` give direction; `{group}` after an id means the group it's in)
 *
 * Groups become diagram sections (one level: a nested group is its own section), edge sides are layout hints Acute
 * doesn't need, and junctions are folded into direct links between the services they join. Pure; the plan goes
 * through F29's `validateVisualPlan` in `convert.ts`.
 */
import type { NodeKind } from "@/domain/canvas/diagram";
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { MAX_PLAN_NODES, MAX_RELATIONSHIPS } from "@/ai/visual-plan/validate";
import { kindOfComponent } from "./componentKinds";
import { readFrontmatter, splitStatements } from "./source";
import type { ArchitectureGraph, ArchitectureNode, MermaidConversionError, Span } from "./types";

export type ArchitectureParseResult = { ok: true; graph: ArchitectureGraph } | { ok: false; error: MermaidConversionError };
export type ArchitectureBuildResult = { ok: true; plan: VisualPlan; warnings: string[] } | { ok: false; error: MermaidConversionError };

const ID = String.raw`[A-Za-z0-9_][\w-]*`;
const NODE = new RegExp(String.raw`^(group|service)\s+(${ID})\s*(?:\(([^)]*)\))?\s*(?:\[([^\]]*)\])?(?:\s+in\s+(${ID}))?\s*$`);
const JUNCTION = new RegExp(String.raw`^junction\s+(${ID})(?:\s+in\s+(${ID}))?\s*$`);
const EDGE = new RegExp(String.raw`^(${ID})(\{group\})?\s*:\s*([LRTB])\s*(<)?-(?:\[([^\]]*)\])?-(>)?\s*([LRTB])\s*:\s*(${ID})(\{group\})?\s*$`);

const ICON_KINDS: Record<string, NodeKind> = { database: "database", disk: "database", cloud: "cloud", internet: "external", server: "backend" };

const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2").trim();

export function parseArchitecture(source: string): ArchitectureParseResult {
  const front = readFrontmatter(source);
  const [header, ...statements] = splitStatements(source, front.bodyStart);
  if (!header) return { ok: false, error: { code: "empty", kind: "architecture", message: "there is no Mermaid diagram to convert" } };
  const nodes: ArchitectureNode[] = [];
  const edges: ArchitectureGraph["edges"] = [];
  const notes: string[] = [];
  let title = front.title;
  let skipped = 0;
  for (const st of statements) {
    const t = st.text;
    const titleLine = /^title\s+(.+)$/.exec(t);
    if (titleLine) {
      title = unquote(titleLine[1]!);
      continue;
    }
    if (/^(accTitle|accDescr)\b/.test(t)) continue;
    const node = NODE.exec(t);
    if (node) {
      nodes.push({ kind: node[1] as "group" | "service", id: node[2]!, icon: node[3]?.trim() || undefined, label: unquote(node[4] ?? "") || node[2]!, parent: node[5], span: st.span });
      continue;
    }
    const junction = JUNCTION.exec(t);
    if (junction) {
      nodes.push({ kind: "junction", id: junction[1]!, label: junction[1]!, parent: junction[2], span: st.span });
      continue;
    }
    const edge = EDGE.exec(t);
    if (edge) {
      edges.push({ from: edge[1]!, fromGroup: !!edge[2], into: !!edge[4], label: edge[5]?.trim() || undefined, out: !!edge[6], to: edge[8]!, toGroup: !!edge[9], span: st.span });
      continue;
    }
    skipped++;
  }
  if (skipped) notes.push(`${skipped} line${skipped === 1 ? "" : "s"} not understood and skipped`);
  return { ok: true, graph: { kind: "architecture", ...(title ? { title } : {}), nodes, edges, notes } };
}

export function buildArchitecturePlan(graph: ArchitectureGraph, options: { sourceOffset?: number } = {}): ArchitectureBuildResult {
  const offset = options.sourceOffset ?? 0;
  const span = (s: Span) => ({ start: s.start + offset, end: s.end + offset });
  const warnings: string[] = [];
  const byId = new Map<string, ArchitectureNode>();
  for (const n of graph.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  const services = [...byId.values()].filter((n) => n.kind === "service");
  if (!services.length) return { ok: false, error: { code: "no_nodes", kind: "architecture", message: "the diagram has no services to draw" } };
  if (services.length > MAX_PLAN_NODES) {
    return { ok: false, error: { code: "too_large", kind: "architecture", message: `the diagram has ${services.length} services; at most ${MAX_PLAN_NODES} can be converted at once` } };
  }

  // Sections: a service's own group (groups can't nest, so a nested group is a section of its own).
  const groupIds = new Set(services.flatMap((s) => (s.parent && byId.get(s.parent)?.kind === "group" ? [s.parent] : [])));
  const nested = [...groupIds].filter((g) => byId.get(g)!.parent).length;
  if (nested) warnings.push(`${nested} nested group${nested === 1 ? " is" : "s are"} shown as ${nested === 1 ? "its" : "their"} own section${nested === 1 ? "" : "s"} (sections can't be nested)`);
  const empty = [...byId.values()].filter((n) => n.kind === "group" && !groupIds.has(n.id)).length;
  if (empty) warnings.push(`${empty} group${empty === 1 ? " has" : "s have"} no services of ${empty === 1 ? "its" : "their"} own, so ${empty === 1 ? "it isn't" : "they aren't"} drawn`);

  // An endpoint: a service, or — with `{group}`, or naming a group directly — the section it stands for.
  const endpoint = (id: string, asGroup: boolean): string | "junction" | undefined => {
    const n = byId.get(id);
    if (!n) return undefined;
    if (n.kind === "junction") return "junction";
    if (n.kind === "group") return groupIds.has(id) ? id : undefined;
    if (asGroup) return n.parent && groupIds.has(n.parent) ? n.parent : undefined;
    return id;
  };

  // Junctions fold away: services joined through one (or a chain of them) are linked directly.
  const junctionOf = new Map<string, string>();
  const find = (j: string): string => {
    const up = junctionOf.get(j) ?? j;
    return up === j ? j : find(up);
  };
  for (const e of graph.edges) if (byId.get(e.from)?.kind === "junction" && byId.get(e.to)?.kind === "junction") junctionOf.set(find(e.from), find(e.to));
  const hubs = new Map<string, { into: string[]; out: string[]; plain: string[]; label?: string }>();
  const hub = (j: string) => hubs.get(find(j)) ?? hubs.set(find(j), { into: [], out: [], plain: [] }).get(find(j))!;

  const relationships: VisualRelationship[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  const link = (from: string, to: string, type: VisualRelationship["type"], label?: string) => {
    if (from === to) return;
    const key = `${from}\u0000${to}\u0000${label ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    relationships.push({ from, to, type, ...(label ? { label: truncate(label, TEXT_LIMITS.relationshipLabel) } : {}) });
  };
  for (const e of graph.edges) {
    const from = endpoint(e.from, e.fromGroup);
    const to = endpoint(e.to, e.toGroup);
    if (!from || !to) {
      dropped++;
      continue;
    }
    if (from === "junction" && to === "junction") continue;
    if (from === "junction" || to === "junction") {
      // Seen from the junction: does the line arrive at it, leave it, or neither?
      const j = from === "junction" ? e.from : e.to;
      const other = from === "junction" ? (to as string) : from;
      const arrowAtJunction = from === "junction" ? e.into : e.out;
      const arrowAtOther = from === "junction" ? e.out : e.into;
      const h = hub(j);
      if (arrowAtJunction && !arrowAtOther) h.into.push(other);
      else if (arrowAtOther && !arrowAtJunction) h.out.push(other);
      else h.plain.push(other);
      if (e.label) h.label ??= e.label;
      continue;
    }
    if (e.out && !e.into) link(from, to, "flows_to", e.label);
    else if (e.into && !e.out) link(to, from, "flows_to", e.label);
    else link(from, to, "relates_to", e.label);
  }
  for (const h of hubs.values()) {
    const directed = h.into.length && h.out.length;
    if (directed) for (const a of h.into) for (const b of h.out) link(a, b, "flows_to", h.label);
    const rest = directed ? h.plain : [...h.into, ...h.out, ...h.plain];
    // Undirected: each later service joins the first one met, which keeps a star a star (not every pair).
    for (const b of rest.slice(1)) link(rest[0]!, b, "relates_to", h.label);
    if (directed) for (const b of h.plain) link(h.into[0]!, b, "relates_to", h.label);
  }
  if (hubs.size) warnings.push(`${hubs.size} junction${hubs.size === 1 ? "" : "s"} folded into direct links`);
  if (dropped) warnings.push(`${dropped} link${dropped === 1 ? "" : "s"} to an unknown service or empty group dropped`);
  if (relationships.length > MAX_RELATIONSHIPS) {
    return { ok: false, error: { code: "too_large", kind: "architecture", message: `the diagram has ${relationships.length} links; at most ${MAX_RELATIONSHIPS} can be converted at once` } };
  }

  const shapeNode = (s: ArchitectureNode): VisualNode => {
    const icon = s.icon?.toLowerCase();
    const kind = (icon && ICON_KINDS[icon]) ?? kindOfComponent(`${s.label} ${icon?.replace(/^[\w-]+:/, "").replaceAll("-", " ") ?? ""}`, "rect");
    return {
      id: s.id,
      type: "shape",
      sourceSpan: span(s.span),
      stableKey: `mermaid:architecture:service:${s.id}`,
      ...(s.parent && groupIds.has(s.parent) ? { parent: s.parent } : {}),
      content: { shape: kind === "database" ? "cylinder" : "rectangle", label: truncate(s.label, TEXT_LIMITS.shapeLabel), ...(kind ? { kind } : {}) },
    } as VisualNode;
  };
  const groupNode = (id: string, label: string, sourceSpan?: Span): VisualNode =>
    ({
      id,
      type: "group",
      ...(sourceSpan ? { sourceSpan: span(sourceSpan) } : {}),
      stableKey: `mermaid:architecture:group:${id}`,
      content: { label: truncate(label, TEXT_LIMITS.groupLabel), arrangement: "tree", diagram: "architecture" },
    }) as VisualNode;

  const title = graph.title ? truncate(graph.title, TEXT_LIMITS.planTitle) : undefined;
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const summary = `Converted from a Mermaid architecture diagram: ${count(services.length, "service")}, ${count(relationships.length, "link")}.`;
  if (!groupIds.size) {
    // No groups: one architecture plan, framed as one interactive diagram when rendered (`wrapArchitecturePlan`).
    return { ok: true, plan: { version: 1, template: "architecture", nodes: services.map(shapeNode), relationships, metadata: { ...(title ? { title } : {}), summary } }, warnings };
  }
  const nodes: VisualNode[] = [];
  if (title) nodes.push({ id: "architecture_title", type: "heading", role: "title", content: { text: title } } as VisualNode);
  for (const g of groupIds) {
    nodes.push(groupNode(g, byId.get(g)!.label, byId.get(g)!.span));
    nodes.push(...services.filter((s) => s.parent === g).map(shapeNode));
  }
  // Services outside every group share one more section, named after the diagram.
  const loose = services.filter((s) => !s.parent || !groupIds.has(s.parent));
  if (loose.length) {
    const rest = "architecture_rest";
    nodes.push(groupNode(rest, title ?? "Architecture"));
    nodes.push(...loose.map((s) => ({ ...shapeNode(s), parent: rest }) as VisualNode));
  }
  return { ok: true, plan: { version: 1, template: "sectioned", nodes, relationships, metadata: { ...(title ? { title } : {}), summary } }, warnings };
}
