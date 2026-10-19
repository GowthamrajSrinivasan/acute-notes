/**
 * `SequenceGraph` → `VisualPlan` (Wave E, phase 1): each message becomes a
 * `"shape"` step node, in script order, chained `flows_to` — the same
 * representation the `flow` section kind's own rule uses for a sequence
 * ("steps as shapes chained flows_to, in order; a step's detail in a linked
 * text node"). This reuses the `flow` template and its chain layout /
 * numbered-step rendering unchanged; no new node type or template.
 *
 * Deliberately not a lifeline/column layout (participants as columns,
 * messages as horizontal arrows between them) — that needs a new
 * `GroupArrangement`. This is the smaller first cut: nothing from the
 * diagram is lost (every message, in order, with its notes), even though
 * the "who is a column" structure isn't drawn yet.
 */
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { MAX_PLAN_NODES, MAX_RELATIONSHIPS } from "@/ai/visual-plan/validate";
import type { SequenceGraph } from "./sequence";
import type { MermaidConversionError } from "./types";

export type SequenceBuildResult = { ok: true; plan: VisualPlan; warnings: string[] } | { ok: false; error: MermaidConversionError };

export interface SequenceBuildOptions {
  sourceOffset?: number;
}

const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export function buildSequencePlan(graph: SequenceGraph, options: SequenceBuildOptions = {}): SequenceBuildResult {
  const offset = options.sourceOffset ?? 0;
  const warnings = [...graph.skipped];

  if (graph.messages.length > MAX_PLAN_NODES) {
    return { ok: false, error: { code: "too_large", kind: "sequence", message: `the diagram has ${graph.messages.length} messages; at most ${MAX_PLAN_NODES} can be converted at once` } };
  }

  const labelOf = new Map(graph.participants.map((p) => [p.id, p.label] as const));
  const stepId = (i: number) => `msg${i + 1}`;

  const nodes: VisualNode[] = [];
  const relationships: VisualRelationship[] = [];
  let truncatedLabels = 0;

  graph.messages.forEach((m, i) => {
    const from = labelOf.get(m.from) ?? m.from;
    const to = labelOf.get(m.to) ?? m.to;
    const raw = `${from} → ${to}: ${m.text}`;
    const label = truncate(raw, TEXT_LIMITS.shapeLabel);
    if (label.length < raw.length) truncatedLabels++;
    nodes.push({
      id: stepId(i),
      role: "step",
      sourceSpan: { start: m.span.start + offset, end: m.span.end + offset },
      stableKey: `mermaid:sequence:msg:${i}`,
      type: "shape",
      content: { shape: "rectangle", label },
    });
    if (i > 0) relationships.push({ from: stepId(i - 1), to: stepId(i), type: "flows_to" });
  });

  let noteId = 0;
  for (const note of graph.notes) {
    const target = Math.max(0, Math.min(note.afterMessageIndex, graph.messages.length - 1));
    const id = `note${++noteId}`;
    nodes.push({
      id,
      stableKey: `mermaid:sequence:note:${noteId}`,
      type: "text",
      content: { markdown: note.text },
    });
    relationships.push({ from: stepId(target), to: id, type: "explained_by" });
  }

  if (relationships.length > MAX_RELATIONSHIPS) {
    return { ok: false, error: { code: "too_large", kind: "sequence", message: `the diagram has ${relationships.length} links; at most ${MAX_RELATIONSHIPS} can be converted at once` } };
  }
  if (truncatedLabels) warnings.push(`${truncatedLabels} message${truncatedLabels === 1 ? "" : "s"} over ${TEXT_LIMITS.shapeLabel} characters shortened`);

  const title = graph.title ? truncate(graph.title, TEXT_LIMITS.planTitle) : undefined;
  const plan: VisualPlan = {
    version: 1,
    template: "flow",
    nodes,
    relationships,
    metadata: {
      ...(title ? { title } : {}),
      summary: `Converted from a Mermaid sequence diagram: ${graph.participants.length} participant${graph.participants.length === 1 ? "" : "s"}, ${graph.messages.length} message${graph.messages.length === 1 ? "" : "s"}.`,
    },
  };
  return { ok: true, plan, warnings };
}
