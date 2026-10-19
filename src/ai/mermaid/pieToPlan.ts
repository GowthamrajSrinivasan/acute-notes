/**
 * `PieGraph` → `VisualPlan` (Wave E): one `table` node (label/value columns, one row per slice) under the
 * `comparison` template — a bare table is already fully supported there, so a pie becomes the table it already
 * is. No new node type. Proportions (actual chart arcs) aren't drawn in this first cut.
 */
import { TEXT_LIMITS } from "@/ai/visual-plan/schema";
import type { VisualPlan } from "@/ai/visual-plan/types";
import type { MermaidConversionError, PieGraph } from "./types";

export type PieBuildResult = { ok: true; plan: VisualPlan; warnings: string[] } | { ok: false; error: MermaidConversionError };

const truncate = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

export function buildPiePlan(graph: PieGraph): PieBuildResult {
  if (graph.slices.length > TEXT_LIMITS.tableRows) {
    return { ok: false, error: { code: "too_large", kind: "pie", message: `the diagram has ${graph.slices.length} slices; at most ${TEXT_LIMITS.tableRows} can be converted at once` } };
  }
  const total = graph.slices.reduce((sum, s) => sum + s.value, 0);
  const rows = graph.slices.map((s) => [truncate(s.label, TEXT_LIMITS.tableCell), String(s.value), total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : "—"]);
  const title = graph.title ? truncate(graph.title, TEXT_LIMITS.planTitle) : undefined;
  const plan: VisualPlan = {
    version: 1,
    template: "comparison",
    nodes: [{ id: "slices", stableKey: "mermaid:pie:table", type: "table", content: { columns: ["Label", "Value", "Share"], rows } }],
    relationships: [],
    metadata: {
      ...(title ? { title } : {}),
      summary: `Converted from a Mermaid pie chart: ${graph.slices.length} slice${graph.slices.length === 1 ? "" : "s"}.`,
    },
  };
  return { ok: true, plan, warnings: [] };
}
