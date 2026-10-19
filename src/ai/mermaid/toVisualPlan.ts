/**
 * `MermaidGraph` → `VisualPlan` (F33): every Mermaid node becomes a `shape`
 * node (id and `stableKey` from its Mermaid id, `sourceSpan` pointing at its
 * definition), every link with a direction a `flows_to` relationship (an
 * undirected `---` or two-way `<-->` one a `relates_to`), and every subgraph /
 * composite state a `group` (F42) in a `sectioned` plan. The template is
 * chosen from the graph's shape and direction — see `chooseTemplate`.
 *
 * Class and ER diagrams carry more: a node with a `body` (members,
 * attributes) becomes a text or table card titled with its name, and an edge
 * with a `relation` keeps that type (`implements`, `depends_on`…).
 *
 * The result is not validated here; `convertMermaid` passes it through F29's
 * `validateVisualPlan` like every other producer.
 */
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import type { GroupArrangement, PlanShape, VisualNode, VisualPlan, VisualRelationship, VisualTemplate } from "@/ai/visual-plan/types";
import { MAX_PLAN_NODES, MAX_RELATIONSHIPS } from "@/ai/visual-plan/validate";
import { guessComponentKinds } from "./componentKinds";
import { KIND_WORDS, type Direction, type GraphEdge, type GraphNode, type MermaidConversionError, type MermaidGraph, type MermaidShape } from "./types";

const SHAPE_MAP: Record<MermaidShape, PlanShape> = {
  default: "rectangle",
  rect: "rectangle",
  round: "rectangle",
  subroutine: "subroutine",
  asymmetric: "rectangle",
  parallelogram: "parallelogram",
  "parallelogram-alt": "parallelogram",
  trapezoid: "trapezoid",
  "trapezoid-alt": "trapezoid",
  cylinder: "cylinder",
  hexagon: "hexagon",
  document: "document",
  fork: "rectangle",
  rhombus: "diamond",
  choice: "diamond",
  stadium: "ellipse",
  circle: "ellipse",
  "double-circle": "ellipse",
  start: "ellipse",
  end: "ellipse",
};

/** Mermaid shapes that have no close canvas equivalent (reported once, by name). */
const APPROXIMATED: ReadonlySet<MermaidShape> = new Set(["asymmetric"]);
/** Mermaid shapes drawn as their mirror image: the canvas has each one way round only (reported once, by name). */
const MIRRORED: ReadonlySet<MermaidShape> = new Set(["parallelogram-alt", "trapezoid"]);

export type BuildResult = { ok: true; plan: VisualPlan; warnings: string[] } | { ok: false; error: MermaidConversionError };

export interface BuildOptions {
  sourceOffset?: number;
}

const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** A plan-local id: `::` is reserved for group titles (`groupTitleKey`), and ids are bounded. */
const planIdOf = (raw: string) => truncate(raw.replaceAll("::", "_"), 200);

export function graphToPlan(graph: MermaidGraph, options: BuildOptions = {}): BuildResult {
  const offset = options.sourceOffset ?? 0;
  const span = (s: { start: number; end: number }) => ({ start: s.start + offset, end: s.end + offset });
  const warnings: string[] = [];
  const subgraphIds = new Set(graph.subgraphs.map((s) => s.id));

  // A node id that is also a subgraph id *is* that subgraph (Mermaid links to a subgraph by its id).
  const nodes = graph.nodes.filter((n) => !subgraphIds.has(n.id));
  if (!nodes.length) return { ok: false, error: { code: "no_nodes", kind: graph.kind, message: "the diagram has no nodes to draw" } };
  if (nodes.length > MAX_PLAN_NODES) {
    return { ok: false, error: { code: "too_large", kind: graph.kind, message: `the diagram has ${nodes.length} nodes; at most ${MAX_PLAN_NODES} can be converted at once` } };
  }

  // Plan ids: unique, `::`-free, bounded.
  const idOf = new Map<string, string>();
  const used = new Set<string>();
  const assign = (raw: string) => {
    let id = planIdOf(raw);
    for (let i = 2; used.has(id); i++) id = `${planIdOf(raw).slice(0, 195)}_${i}`;
    used.add(id);
    idOf.set(raw, id);
  };
  nodes.forEach((n) => assign(n.id));

  // Sections: each node goes to its innermost subgraph; groups can't nest, so nested subgraphs sit side by side,
  // and a subgraph holding only other subgraphs has nothing of its own to frame.
  const members = new Map<string, GraphNode[]>();
  for (const n of nodes) if (n.subgraph) (members.get(n.subgraph) ?? members.set(n.subgraph, []).get(n.subgraph)!).push(n);
  const liveGroups = graph.subgraphs.filter((s) => members.has(s.id));
  for (const s of graph.subgraphs) {
    if (!members.has(s.id)) warnings.push(`subgraph "${s.title}" has no nodes of its own, so it isn't drawn as a section`);
    else if (s.parent) warnings.push(`subgraph "${s.title}" is nested; it is shown as its own section (sections can't be nested)`);
  }
  liveGroups.forEach((s) => assign(s.id));
  const liveGroupIds = new Set(liveGroups.map((s) => s.id));

  // Relationships.
  const relationships: VisualRelationship[] = [];
  const seen = new Set<string>();
  let invisible = 0;
  let styled = 0;
  for (const e of graph.edges) {
    if (e.line === "invisible") {
      invisible++;
      continue;
    }
    const from = endpointId(e.from, idOf, subgraphIds, liveGroupIds);
    const to = endpointId(e.to, idOf, subgraphIds, liveGroupIds);
    if (!from || !to) {
      warnings.push(`link ${e.from} → ${e.to}: its subgraph isn't drawn, so the link was dropped`);
      continue;
    }
    if (from === to) {
      warnings.push(`link ${e.from} → itself: self-links aren't drawn, dropped`);
      continue;
    }
    const label = e.label ? truncate(e.label, TEXT_LIMITS.relationshipLabel) : undefined;
    const key = `${from}\u0000${to}\u0000${label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isStyled(e)) styled++;
    relationships.push({ from, to, type: e.relation ?? (e.arrow === "none" || e.bidirectional ? "relates_to" : "flows_to"), ...(label ? { label } : {}) });
  }
  if (relationships.length > MAX_RELATIONSHIPS) {
    return { ok: false, error: { code: "too_large", kind: graph.kind, message: `the diagram has ${relationships.length} links; at most ${MAX_RELATIONSHIPS} can be converted at once` } };
  }
  if (invisible) warnings.push(`${invisible} invisible link${invisible === 1 ? "" : "s"} (\`~~~\`) skipped — they only steer Mermaid's own layout`);
  if (styled) warnings.push(`${styled} link${styled === 1 ? "" : "s"} drawn as plain connections (dotted/thick lines, open/circle/cross/two-way heads aren't kept)`);

  const approximated = [...new Set(nodes.filter((n) => APPROXIMATED.has(n.shape)).map((n) => n.shape))];
  if (approximated.length) warnings.push(`shapes without a canvas equivalent (${approximated.join(", ")}) are drawn as rectangles`);
  const mirrored = [...new Set(nodes.filter((n) => MIRRORED.has(n.shape)).map((n) => n.shape))];
  if (mirrored.length) warnings.push(`shapes the canvas draws one way round only (${mirrored.join(", ")}) are drawn mirrored`);
  const tooLong = nodes.filter((n) => n.label.length > (n.body ? TEXT_LIMITS.title : TEXT_LIMITS.shapeLabel)).length;
  if (tooLong) warnings.push(`${tooLong} label${tooLong === 1 ? "" : "s"} over ${TEXT_LIMITS.shapeLabel} characters shortened`);

  const choice = chooseTemplate(graph, nodes, liveGroups.length > 0, relationships, idOf);
  warnings.push(...choice.warnings);

  // A flowchart that reads as an architecture diagram gets component kinds, so it lands in an interactive frame.
  const shapeNodes = nodes.filter((n) => !n.body);
  const componentKinds = graph.kind === "flowchart" ? guessComponentKinds(shapeNodes) : null;
  if (componentKinds) warnings.push(`read as an architecture diagram: guessed component kinds for ${componentKinds.size} of ${shapeNodes.length} nodes from their names and shapes`);

  const kindKey = `mermaid:${graph.kind}`;
  const outgoing = new Set(relationships.map((r) => r.from));
  const shapeNode = (n: GraphNode): VisualNode => {
    const id = idOf.get(n.id)!;
    const shape = SHAPE_MAP[n.shape];
    const parent = n.subgraph && liveGroupIds.has(n.subgraph) ? idOf.get(n.subgraph) : undefined;
    const common = {
      id,
      role: roleOf(choice.template, id, shape, choice.root, outgoing.has(id)),
      sourceSpan: span(n.span),
      stableKey: `${kindKey}:node:${n.id}`,
      ...(parent ? { parent } : {}),
    };
    if (n.body) {
      const title = truncate(n.label, TEXT_LIMITS.title);
      return n.body.type === "text"
        ? { ...common, title, type: "text", content: { markdown: n.body.markdown } }
        : { ...common, title, type: "table", content: { columns: n.body.columns, rows: n.body.rows } };
    }
    const kind = componentKinds?.get(n.id);
    return { ...common, type: "shape", content: { shape, label: truncate(n.label, TEXT_LIMITS.shapeLabel), ...(kind ? { kind } : {}) } };
  };
  const groupNode = (s: (typeof liveGroups)[number]): VisualNode => ({
    id: idOf.get(s.id)!,
    type: "group",
    content: { label: truncate(s.title, TEXT_LIMITS.groupLabel), arrangement: choice.arrangements.get(s.id) ?? "chain" },
    sourceSpan: span(s.span),
    stableKey: `${kindKey}:subgraph:${s.id}`,
  });

  // Order: source order, the root first for a tree, each group just before its first member.
  const byPlanId = new Map(nodes.map((n) => [idOf.get(n.id)!, n] as const));
  const ordered = choice.order
    ? choice.order.map((id) => byPlanId.get(id)!)
    : choice.root
      ? [byPlanId.get(choice.root)!, ...nodes.filter((n) => idOf.get(n.id) !== choice.root)]
      : nodes;
  const planNodes: VisualNode[] = [];
  const placedGroups = new Set<string>();
  for (const n of ordered) {
    const g = n.subgraph && liveGroupIds.has(n.subgraph) ? liveGroups.find((s) => s.id === n.subgraph) : undefined;
    if (g && !placedGroups.has(g.id)) {
      placedGroups.add(g.id);
      planNodes.push(groupNode(g));
    }
    planNodes.push(shapeNode(n));
  }

  const title = graph.title ? truncate(graph.title, TEXT_LIMITS.planTitle) : undefined;
  const what = KIND_WORDS[graph.kind];
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const plan: VisualPlan = {
    version: 1,
    // Components with kinds and no subgraphs: one architecture plan, framed as one interactive diagram (`wrapArchitecturePlan`).
    template: componentKinds && !liveGroups.length ? "architecture" : choice.template,
    nodes: planNodes,
    relationships,
    metadata: {
      ...(title ? { title } : {}),
      summary: `Converted from a Mermaid ${what}: ${count(nodes.length, "node")}, ${count(relationships.length, "link")}${liveGroups.length ? `, ${count(liveGroups.length, "section")}` : ""}.`,
    },
  };
  return { ok: true, plan, warnings };
}

function endpointId(raw: string, idOf: ReadonlyMap<string, string>, subgraphIds: ReadonlySet<string>, liveGroupIds: ReadonlySet<string>): string | undefined {
  if (subgraphIds.has(raw)) return liveGroupIds.has(raw) ? idOf.get(raw) : undefined;
  return idOf.get(raw);
}

function isStyled(e: GraphEdge): boolean {
  return e.line !== "solid" || e.bidirectional || (e.arrow !== "arrow" && e.arrow !== "none");
}

function roleOf(template: VisualTemplate, id: string, shape: PlanShape, root: string | undefined, hasOutgoing: boolean): string {
  switch (template) {
    case "decision_tree":
      // The tree's layout roots at the first "decision" node, which is always `root` (placed first).
      if (id === root || shape === "diamond") return "decision";
      return hasOutgoing ? "step" : "outcome";
    case "architecture":
      return "component";
    case "concept_map":
      return id === root ? "center" : shape === "diamond" ? "decision" : "step";
    default:
      return shape === "diamond" ? "decision" : "step";
  }
}

interface TemplateChoice {
  template: VisualTemplate;
  /** A node to place first (the tree root / radial centre). */
  root?: string;
  /** Plan ids in the order to place them (a chain in path order), overriding source order. */
  order?: string[];
  /** Per live subgraph id, for a sectioned plan. */
  arrangements: Map<string, GroupArrangement>;
  warnings: string[];
}

/**
 * Picks an existing template for the graph:
 *
 * - subgraphs → `sectioned` (one section per subgraph; `tree` inside a
 *   top-down subgraph whose own links are loop-free, else `chain`; `grid`
 *   for a class diagram's namespaces)
 * - a class or ER diagram → `architecture`, whatever its direction
 * - a single chain `A → B → C` → `flow`
 * - loop-free, left-to-right → `architecture` (layered left to right)
 * - loop-free, top-down with one start reaching everything →
 *   `decision_tree` (layered top down from it); several starts →
 *   `architecture`
 *
 * Loops (a retry path, a state returning to an earlier one) take the same
 * route: the layered layouts ignore a link back for depth, and every link is
 * still drawn. A graph where every node has a link in starts from its first
 * node in source order.
 */
export function chooseTemplate(
  graph: MermaidGraph,
  nodes: readonly GraphNode[],
  hasGroups: boolean,
  relationships: readonly VisualRelationship[],
  idOf: ReadonlyMap<string, string>,
): TemplateChoice {
  const warnings: string[] = [];
  const arrangements = new Map<string, GroupArrangement>();
  const ids = nodes.map((n) => idOf.get(n.id)!);
  const vertical = (d: Direction) => d === "TB" || d === "BT";
  const structural = graph.kind === "class" || graph.kind === "er";
  if (!structural && (graph.direction === "BT" || graph.direction === "RL")) {
    warnings.push(`the diagram runs ${graph.direction === "BT" ? "bottom to top" : "right to left"}; it is laid out ${graph.direction === "BT" ? "top to bottom" : "left to right"}`);
  }

  if (hasGroups) {
    for (const s of graph.subgraphs) {
      const groupId = idOf.get(s.id);
      if (!groupId) continue;
      const inside = new Set(nodes.filter((n) => n.subgraph === s.id).map((n) => idOf.get(n.id)!));
      const rels = relationships.filter((r) => inside.has(r.from) && inside.has(r.to));
      const tree = vertical(s.direction ?? graph.direction) && rels.length > 0;
      arrangements.set(s.id, structural ? "grid" : tree ? "tree" : "chain");
    }
    return { template: "sectioned", arrangements, warnings };
  }
  // Classes and entities aren't steps: always layered by their relationships, never a flow or a decision tree.
  if (structural) return { template: "architecture", arrangements, warnings };

  const nodeRels = relationships.filter((r) => ids.includes(r.from) && ids.includes(r.to));
  if (isChain(ids, nodeRels)) return { template: "flow", order: chainOrder(rootsOf(ids, nodeRels)[0]!, nodeRels), arrangements, warnings };
  if (!vertical(graph.direction)) return { template: "architecture", arrangements, warnings };
  const sources = rootsOf(ids, nodeRels);
  const roots = sources.length ? sources : ids.slice(0, 1);
  if (roots.length === 1 && reachesAll(roots[0]!, ids, nodeRels)) return { template: "decision_tree", root: roots[0], arrangements, warnings };
  warnings.push(`the diagram has ${roots.length} starting points, so it is laid out left to right in layers`);
  return { template: "architecture", arrangements, warnings };
}

/** A chain's nodes from its root along its links. */
function chainOrder(root: string, rels: readonly VisualRelationship[]): string[] {
  const next = new Map(rels.map((r) => [r.from, r.to] as const));
  const order = [root];
  for (let at = next.get(root); at !== undefined; at = next.get(at)) order.push(at);
  return order;
}

function rootsOf(ids: readonly string[], rels: readonly VisualRelationship[]): string[] {
  const hasIncoming = new Set(rels.map((r) => r.to));
  return ids.filter((id) => !hasIncoming.has(id));
}

function reachesAll(root: string, ids: readonly string[], rels: readonly VisualRelationship[]): boolean {
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const at = queue.shift()!;
    for (const r of rels) {
      if (r.from !== at || seen.has(r.to)) continue;
      seen.add(r.to);
      queue.push(r.to);
    }
  }
  return ids.every((id) => seen.has(id));
}

/** One path through every node: each has at most one link in and one out, and they connect into a single line. */
function isChain(ids: readonly string[], rels: readonly VisualRelationship[]): boolean {
  if (ids.length < 2 || rels.length !== ids.length - 1) return false;
  const ins = new Map<string, number>();
  const outs = new Map<string, number>();
  for (const r of rels) {
    ins.set(r.to, (ins.get(r.to) ?? 0) + 1);
    outs.set(r.from, (outs.get(r.from) ?? 0) + 1);
  }
  if ([...ins.values(), ...outs.values()].some((n) => n > 1)) return false;
  const roots = rootsOf(ids, rels);
  return roots.length === 1 && reachesAll(roots[0]!, ids, rels);
}

