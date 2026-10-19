/**
 * Mermaid → `VisualPlan` (F33, PRD §13.15.5): the types shared by detection,
 * the hand-written parsers and the plan builder.
 *
 * Mermaid is only ever an *input* representation: a parsed diagram becomes a
 * `VisualPlan` (nodes + relationships), which goes through F29 validation and
 * F30 rendering like any other plan. Nothing here is stored as canvas data.
 */
import type { RelationType } from "@/domain/types";
import type { VisualPlan } from "@/ai/visual-plan/types";

/** Every diagram kind Mermaid's own detector knows, by its header keyword; only some are convertible. */
export const MERMAID_DIAGRAM_KINDS = [
  "flowchart",
  "state",
  "sequence",
  "class",
  "er",
  "journey",
  "gantt",
  "pie",
  "quadrant",
  "requirement",
  "gitgraph",
  "c4",
  "mindmap",
  "timeline",
  "zenuml",
  "sankey",
  "xychart",
  "block",
  "packet",
  "kanban",
  "architecture",
  "radar",
  "treemap",
] as const;

export type MermaidDiagramKind = (typeof MERMAID_DIAGRAM_KINDS)[number];

/** The kinds `convertMermaid` turns into a plan today. */
export const CONVERTIBLE_KINDS = ["flowchart", "state", "class", "er"] as const satisfies readonly MermaidDiagramKind[];
export type ConvertibleKind = (typeof CONVERTIBLE_KINDS)[number];

/** A convertible kind in words, e.g. "class diagram". Includes `sequence`/`pie`/`gantt`, which each convert via their own parser/builder rather than `CONVERTIBLE_KINDS`. */
export const KIND_WORDS: Record<ConvertibleKind | "sequence" | "pie" | "gantt" | "architecture", string> = {
  flowchart: "flowchart",
  state: "state diagram",
  class: "class diagram",
  er: "entity-relationship diagram",
  sequence: "sequence diagram",
  pie: "pie chart",
  gantt: "gantt chart",
  architecture: "architecture diagram",
};

export interface MermaidDetection {
  kind: MermaidDiagramKind;
  /** Whether `convertMermaid` can convert this kind. */
  supported: boolean;
  /** The header keyword as written, e.g. "graph", "flowchart", "stateDiagram-v2". */
  keyword: string;
  /** The diagram's header line, as UTF-16 offsets into the input. */
  headerSpan: { start: number; end: number };
}

/** Mermaid's flow direction. `TD` is normalised to `TB`. */
export type Direction = "TB" | "BT" | "LR" | "RL";

/** The Mermaid shape as written (fidelity for tests/preview), before it is mapped onto the plan's three shapes. */
export type MermaidShape =
  | "default"
  | "rect"
  | "round"
  | "stadium"
  | "subroutine"
  | "cylinder"
  | "circle"
  | "double-circle"
  | "asymmetric"
  | "rhombus"
  | "hexagon"
  | "parallelogram"
  | "parallelogram-alt"
  | "trapezoid"
  | "trapezoid-alt"
  | "document"
  | "start"
  | "end"
  | "fork"
  | "choice";

export interface Span {
  start: number;
  end: number;
}

export interface GraphNode {
  /** The Mermaid id, verbatim (also the plan node id and the root of its `stableKey`). */
  id: string;
  label: string;
  shape: MermaidShape;
  /** The node's defining mention (the first one with a shape/label, else its first mention). */
  span: Span;
  /** The innermost subgraph / composite state / namespace it belongs to. */
  subgraph?: string;
  /**
   * Content richer than a label (class members, entity attributes): the node
   * becomes a card of this type titled with `label`, instead of a shape.
   */
  body?: { type: "text"; markdown: string } | { type: "table"; columns: string[]; rows: string[][] };
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  line: "solid" | "dotted" | "thick" | "invisible";
  /** The head at the `to` end. */
  arrow: "none" | "arrow" | "circle" | "cross";
  /** A head at the `from` end too (`<-->`, `o--o`, `x--x`). */
  bidirectional: boolean;
  /** The plan relationship type, when the diagram says more than "flows to" (class inheritance, ER relationships…). */
  relation?: RelationType;
  span: Span;
}

export interface GraphSubgraph {
  id: string;
  title: string;
  /** The enclosing subgraph, if nested. */
  parent?: string;
  direction?: Direction;
  /** From the `subgraph` line to its `end`. */
  span: Span;
}

/** A parsed diagram, independent of its Mermaid kind: what the plan builder consumes. */
export interface MermaidGraph {
  kind: ConvertibleKind;
  direction: Direction;
  title?: string;
  /** In order of first mention. */
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraphs: GraphSubgraph[];
  /** Things the parser deliberately skipped (styling, notes…), in plain language. */
  notes: string[];
}

export type MermaidErrorCode =
  /** Nothing but whitespace/comments. */
  | "empty"
  /** No Mermaid diagram header. */
  | "not_mermaid"
  /** A real Mermaid kind this converter doesn't handle (sequence, class, gantt…). */
  | "unsupported_diagram"
  /** Malformed syntax; `line`/`column` point at it. */
  | "syntax"
  /** Parsed, but has no nodes to draw. */
  | "no_nodes"
  /** More nodes/relationships than a plan may carry (F29's limits). */
  | "too_large"
  /** The built plan failed F29 validation (an internal bug if it ever happens). */
  | "invalid_plan";

export interface MermaidConversionError {
  code: MermaidErrorCode;
  message: string;
  kind?: MermaidDiagramKind;
  /** 1-based, for `syntax`. */
  line?: number;
  /** 1-based, for `syntax`. */
  column?: number;
}

export type ParseResult = { ok: true; graph: MermaidGraph } | { ok: false; error: MermaidConversionError };

/**
 * A sequence diagram's parsed shape (`sequence.ts`): participants and messages, in script order. It doesn't fit
 * `MermaidGraph` — messages routinely repeat the same `(from, to, label)` tuple, and what matters is their order,
 * not their connectivity — so it's built and converted by its own parser/builder (`sequence.ts`,
 * `sequenceToPlan.ts`), not `GraphBuilder`/`graphToPlan`. Defined here (not in `sequence.ts`) so
 * `MermaidConversionResult` can reference it without a circular import.
 */
export interface SequenceParticipant {
  id: string;
  label: string;
  span: Span;
}

export interface SequenceMessage {
  from: string;
  to: string;
  /** The message text, with its active block's label prefixed (e.g. "[loop: Retry] Submit") and " (async)" appended for a dotted line. */
  text: string;
  span: Span;
}

export interface SequenceNote {
  /** The message this note follows; attached to the first message when it precedes every message (nothing to follow yet). */
  afterMessageIndex: number;
  text: string;
}

export interface SequenceGraph {
  kind: "sequence";
  title?: string;
  participants: SequenceParticipant[];
  messages: SequenceMessage[];
  notes: SequenceNote[];
  /** Plain-language notes: activation bars, `box`/`rect` grouping — read past, never silently dropped. */
  skipped: string[];
}

/**
 * A pie chart's parsed shape (`pie.ts`): label/value slices. No edges, no connectivity — a bare table is the
 * natural (and already fully supported) fallback, so this is its own parser/builder too, not `graphToPlan`.
 */
export interface PieSlice {
  label: string;
  value: number;
  span: Span;
}

export interface PieGraph {
  kind: "pie";
  title?: string;
  showData: boolean;
  slices: PieSlice[];
}

/**
 * A gantt chart's parsed shape (`gantt.ts`): tasks with an optional section, start and duration, always kept in
 * source order (gantt source lists tasks chronologically by convention; `MermaidGraph` has no date field and the
 * `timeline` layout does no date math at all, so this doesn't attempt calendar math or reordering — `start`/
 * `duration` are kept as written and folded into each task's label at build time, `ganttToPlan.ts`). Not drawn as
 * duration bars or per-section lanes in this first cut (see the content-fidelity plan's Wave E notes).
 */
export interface GanttTask {
  label: string;
  section?: string;
  /** As written: a literal date, or `after <id>` — never resolved to a calendar date. */
  start?: string;
  duration?: string;
  span: Span;
}

export interface GanttGraph {
  kind: "gantt";
  title?: string;
  tasks: GanttTask[];
  skipped: string[];
}

/** A Mermaid `architecture-beta` node (`architecture.ts`): a group, a service, or a junction joining lines. */
export interface ArchitectureNode {
  kind: "group" | "service" | "junction";
  id: string;
  /** As written: a built-in icon (`database`, `server`, …) or an iconify name (`logos:aws-s3`). */
  icon?: string;
  label: string;
  /** The group it's `in`. */
  parent?: string;
  span: Span;
}

/** A Mermaid `architecture-beta` diagram, as parsed (`architecture.ts`). Edge sides are layout hints and not kept. */
export interface ArchitectureGraph {
  kind: "architecture";
  title?: string;
  nodes: ArchitectureNode[];
  /** `into`: an arrowhead at `from`'s end (`<--`); `out`: at `to`'s end (`-->`); `…Group`: the endpoint means its group. */
  edges: { from: string; fromGroup: boolean; to: string; toGroup: boolean; into: boolean; out: boolean; label?: string; span: Span }[];
  notes: string[];
}

export type MermaidConversionResult =
  | {
      ok: true;
      kind: ConvertibleKind | "sequence" | "pie" | "gantt" | "architecture";
      /** `validateVisualPlan`'s output: safe to hand to `renderVisualPlan` as is. */
      plan: VisualPlan;
      /** What was simplified, skipped or dropped on the way, in plain language (parser notes, then builder, then validator). */
      warnings: string[];
      /** The parsed diagram, for callers that want more than the plan (e.g. a preview or provenance). */
      graph: MermaidGraph | SequenceGraph | PieGraph | GanttGraph | ArchitectureGraph;
    }
  | { ok: false; error: MermaidConversionError };

export interface ConvertMermaidOptions {
  /** The code block's fence language, if any; `mermaid` lets an unknown header report as `unsupported_diagram` rather than `not_mermaid`. */
  language?: string;
  /** Added to every `sourceSpan`, so spans point into the containing document when `source` is a code block's body. */
  sourceOffset?: number;
}
