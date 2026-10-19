/**
 * Accumulates a `MermaidGraph` while a parser walks the source: nodes in
 * order of first mention (a later mention with a shape/label redefines the
 * label, as in Mermaid), subgraph membership (a node belongs to the innermost
 * subgraph it is first mentioned in), and edges.
 */
import type { ConvertibleKind, Direction, GraphEdge, GraphNode, GraphSubgraph, MermaidGraph, MermaidShape, Span } from "./types";

export class GraphBuilder {
  private readonly nodes = new Map<string, GraphNode & { defined: boolean }>();
  private readonly edges: GraphEdge[] = [];
  private readonly subgraphs: GraphSubgraph[] = [];
  private readonly stack: GraphSubgraph[] = [];
  readonly notes: string[] = [];
  direction: Direction = "TB";
  title?: string;

  constructor(readonly kind: ConvertibleKind) {}

  get currentSubgraph(): GraphSubgraph | undefined {
    return this.stack[this.stack.length - 1];
  }

  get depth(): number {
    return this.stack.length;
  }

  /** Records a mention of `id`; `def` is given when this mention carries a shape and/or label. */
  mention(id: string, span: Span, def?: { label?: string; shape?: MermaidShape }): void {
    const existing = this.nodes.get(id);
    const subgraph = this.currentSubgraph?.id;
    if (!existing) {
      this.nodes.set(id, {
        id,
        label: def?.label || id,
        shape: def?.shape ?? "default",
        span,
        ...(subgraph ? { subgraph } : {}),
        defined: !!def,
      });
      return;
    }
    if (!existing.subgraph && subgraph) existing.subgraph = subgraph;
    if (def) {
      if (def.label) existing.label = def.label;
      if (def.shape && (def.shape !== "default" || !existing.defined)) existing.shape = def.shape;
      if (!existing.defined) existing.span = span;
      existing.defined = true;
    }
  }

  private anonymous = 0;
  /** An id for a subgraph written without one (`subgraph` alone), unique within this parse. */
  anonymousSubgraphId(): string {
    return `subgraph${++this.anonymous}`;
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  /** Whether `id` was ever given a shape or label (vs. only referenced). */
  isDefined(id: string): boolean {
    return this.nodes.get(id)?.defined ?? false;
  }

  node(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  edge(edge: GraphEdge): void {
    this.edges.push(edge);
  }

  openSubgraph(id: string, title: string, start: number): void {
    const parent = this.currentSubgraph?.id;
    const sg: GraphSubgraph = { id, title, span: { start, end: start }, ...(parent ? { parent } : {}) };
    this.subgraphs.push(sg);
    this.stack.push(sg);
  }

  /** Closes the innermost subgraph; false when none is open. */
  closeSubgraph(end: number): boolean {
    const sg = this.stack.pop();
    if (!sg) return false;
    sg.span = { start: sg.span.start, end };
    return true;
  }

  build(): MermaidGraph {
    return {
      kind: this.kind,
      direction: this.direction,
      ...(this.title ? { title: this.title } : {}),
      nodes: [...this.nodes.values()].map(({ defined: _defined, ...n }) => n),
      edges: this.edges,
      subgraphs: this.subgraphs,
      notes: this.notes,
    };
  }
}

/** `TD` is Mermaid's alias for `TB`. */
export function normaliseDirection(d: string): Direction {
  const up = d.toUpperCase();
  return up === "TD" ? "TB" : (up as Direction);
}
