/**
 * Architecture plans as interactive diagram frames (plan: .ai/docs/interactive-architecture-frames-plan.md, Phase 2).
 *
 * - A section (`group`) is a diagram when it says so (`diagram: "architecture"`) or when any of its shapes has a
 *   `kind`: a model that gives components kinds is describing an architecture.
 * - A standalone `architecture` plan (no sections) whose shapes have kinds is wrapped in one section, so it lands
 *   in a frame that can be interactive. A plan without kinds keeps its template's own layout, as before.
 */
import type { VisualNode, VisualPlan } from "./types";

type GroupNode = Extract<VisualNode, { type: "group" }>;

const hasKind = (n: VisualNode) => n.type === "shape" && !!n.content.kind;

/** Whether this section renders as an interactive architecture diagram frame. */
export function isDiagramGroup(plan: VisualPlan, group: GroupNode): boolean {
  return group.content.diagram === "architecture" || plan.nodes.some((n) => n.parent === group.id && hasKind(n));
}

/** Id of the section `wrapArchitecturePlan` adds (plan node ids can't contain "::", so it never collides). */
export const ARCHITECTURE_GROUP_ID = "architecture::frame";

/** A standalone semantic architecture plan, wrapped in one diagram section; any other plan unchanged. */
export function wrapArchitecturePlan(plan: VisualPlan): VisualPlan {
  if (plan.template !== "architecture" || plan.nodes.some((n) => n.type === "group") || !plan.nodes.some(hasKind)) return plan;
  // The document title stays above the frame; the frame is named after it.
  const title = plan.nodes.find((n) => n.type === "heading" && n.role === "title");
  const label = plan.metadata?.title?.trim() || (title?.type === "heading" ? title.content.text : "") || "Architecture";
  const group: GroupNode = {
    id: ARCHITECTURE_GROUP_ID,
    type: "group",
    content: { label, arrangement: "tree", diagram: "architecture", ...(plan.metadata?.cards?.length ? { cards: plan.metadata.cards } : {}) },
  };
  const nodes = plan.nodes.map((n): VisualNode => (n === title ? n : { ...n, parent: ARCHITECTURE_GROUP_ID }));
  return { ...plan, nodes: [...(title ? [title] : []), group, ...nodes.filter((n) => n !== title)] };
}
