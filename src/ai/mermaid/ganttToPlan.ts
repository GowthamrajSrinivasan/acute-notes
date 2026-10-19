/**
 * `GanttGraph` → `VisualPlan` (Wave E): one `shape` step per task, in source order, chained `flows_to` — the
 * `timeline` template's own layout (array order, alternating rows; no date math at all, confirmed by exploration)
 * reads this the same way `flow`-style steps do. Nothing is lost: a task's section, start and duration are folded
 * into its label so they're visible even though no duration bar or per-section lane is drawn (that's a follow-on,
 * same as sequence diagrams' lifeline layout).
 */
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { MAX_PLAN_NODES, MAX_RELATIONSHIPS } from "@/ai/visual-plan/validate";
import type { GanttGraph, MermaidConversionError } from "./types";

export type GanttBuildResult = { ok: true; plan: VisualPlan; warnings: string[] } | { ok: false; error: MermaidConversionError };

export interface GanttBuildOptions {
  sourceOffset?: number;
}

const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export function buildGanttPlan(graph: GanttGraph, options: GanttBuildOptions = {}): GanttBuildResult {
  const offset = options.sourceOffset ?? 0;
  const warnings = [...graph.skipped];
  if (graph.tasks.length > MAX_PLAN_NODES) {
    return { ok: false, error: { code: "too_large", kind: "gantt", message: `the diagram has ${graph.tasks.length} tasks; at most ${MAX_PLAN_NODES} can be converted at once` } };
  }

  const stepId = (i: number) => `task${i + 1}`;
  const nodes: VisualNode[] = [];
  const relationships: VisualRelationship[] = [];
  let truncatedLabels = 0;

  graph.tasks.forEach((task, i) => {
    const when = [task.start, task.duration].filter(Boolean).join(" · ");
    const raw = [task.section ? `[${task.section}] ` : "", task.label, when ? ` (${when})` : ""].join("");
    const label = truncate(raw, TEXT_LIMITS.shapeLabel);
    if (label.length < raw.length) truncatedLabels++;
    nodes.push({
      id: stepId(i),
      role: "event",
      sourceSpan: { start: task.span.start + offset, end: task.span.end + offset },
      stableKey: `mermaid:gantt:task:${i}`,
      type: "shape",
      content: { shape: "rectangle", label },
    });
    if (i > 0) relationships.push({ from: stepId(i - 1), to: stepId(i), type: "flows_to" });
  });

  if (relationships.length > MAX_RELATIONSHIPS) {
    return { ok: false, error: { code: "too_large", kind: "gantt", message: `the diagram has ${relationships.length} links; at most ${MAX_RELATIONSHIPS} can be converted at once` } };
  }
  if (truncatedLabels) warnings.push(`${truncatedLabels} task${truncatedLabels === 1 ? "" : "s"} over ${TEXT_LIMITS.shapeLabel} characters shortened`);

  const title = graph.title ? truncate(graph.title, TEXT_LIMITS.planTitle) : undefined;
  const plan: VisualPlan = {
    version: 1,
    template: "timeline",
    nodes,
    relationships,
    metadata: {
      ...(title ? { title } : {}),
      summary: `Converted from a Mermaid gantt chart: ${graph.tasks.length} task${graph.tasks.length === 1 ? "" : "s"}.`,
    },
  };
  return { ok: true, plan, warnings };
}
