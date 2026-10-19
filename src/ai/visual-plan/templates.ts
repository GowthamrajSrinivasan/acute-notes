/**
 * The application-owned template registry (F29, PRD §13.15.2): the
 * templates AI selects and populates (the PRD's 8, plus F42's `sectioned`). Each is deterministic code, not a
 * prompt — new templates are added here by the Acute-Notes team, never
 * invented by a model at runtime.
 *
 * Every entry declares:
 * - `allowedNodeTypes` — a node of any other type is dropped by the validator.
 * - `recommendedRoles` — roles the template is built around; missing ones are
 *   a warning only (`VisualNode.role` is itself optional, so this can never
 *   be a hard requirement without contradicting that).
 * - `allowedRelationTypes` — a relationship of another type is dropped.
 * - `allowSelfLoops` — none of the initial 8 need it; the field exists so a
 *   future template (or a test) can turn it on without a validator change.
 * - `layout` — F30's layout-strategy id. `LAYOUT_STRATEGIES` is exhaustive so
 *   a new template can't ship without F30 having a (possibly stubbed) case
 *   for it.
 */
import { RELATION_TYPES, type RelationType } from "@/domain/types";
import { VISUAL_TEMPLATES, type VisualNodeType, type VisualTemplate } from "./types";

export const LAYOUT_STRATEGIES = [
  "chain-horizontal",
  "three-column",
  "radial-cluster",
  "timeline-axis",
  "tree-top-down",
  "layered-boxes",
  "column-compare",
  "document-stack",
  "grouped-grid",
  // Wave E: `causal_map`'s own strategy id — same underlying layout as `architecture` (see `layout.ts`'s
  // `LAYOUTS` map), kept as its own id so every template still has a distinct one.
  "causal-graph",
] as const;

export type LayoutStrategyId = (typeof LAYOUT_STRATEGIES)[number];

export interface VisualTemplateDefinition {
  id: VisualTemplate;
  name: string;
  /** The PRD's "typical input" for this template — also useful as prompt guidance. */
  description: string;
  allowedNodeTypes: readonly VisualNodeType[];
  recommendedRoles?: readonly string[];
  allowedRelationTypes: readonly RelationType[];
  allowSelfLoops?: boolean;
  layout: LayoutStrategyId;
  /** Below this many surviving nodes, the plan is still valid but the layout may look sparse (a warning, never fatal). */
  recommendedMinNodes?: number;
}

const ALL_RELATIONS = RELATION_TYPES;

export const VISUAL_TEMPLATE_REGISTRY: Readonly<Record<VisualTemplate, VisualTemplateDefinition>> = {
  flow: {
    id: "flow",
    name: "Flow",
    description: "User logs in → API validates → token generated → dashboard",
    allowedNodeTypes: ["heading", "shape", "text", "code"],
    recommendedRoles: ["step"],
    allowedRelationTypes: ["flows_to", "relates_to", "depends_on", "explained_by"],
    layout: "chain-horizontal",
    recommendedMinNodes: 2,
  },
  problem_cause_solution: {
    id: "problem_cause_solution",
    name: "Problem → Cause → Solution",
    description: "App is failing because of three possible causes…",
    allowedNodeTypes: ["heading", "text", "shape", "todo"],
    recommendedRoles: ["problem", "cause", "solution"],
    allowedRelationTypes: ["caused_by", "depends_on", "supports", "blocks", "explained_by"],
    layout: "three-column",
    recommendedMinNodes: 3,
  },
  concept_map: {
    id: "concept_map",
    name: "Concept Map",
    description: "Research notes, explanations of related ideas",
    allowedNodeTypes: ["heading", "text", "shape"],
    recommendedRoles: ["center"],
    allowedRelationTypes: ALL_RELATIONS,
    layout: "radial-cluster",
    recommendedMinNodes: 3,
  },
  timeline: {
    id: "timeline",
    name: "Timeline",
    description: "Dated events, release plans, incident timelines",
    allowedNodeTypes: ["heading", "text", "shape"],
    recommendedRoles: ["event"],
    allowedRelationTypes: ["flows_to", "relates_to", "derived_from", "explained_by"],
    layout: "timeline-axis",
    recommendedMinNodes: 2,
  },
  decision_tree: {
    id: "decision_tree",
    name: "Decision Tree",
    description: "Options, conditions, if/then guidance",
    allowedNodeTypes: ["heading", "shape", "text"],
    recommendedRoles: ["decision", "outcome"],
    allowedRelationTypes: ["flows_to", "depends_on", "relates_to", "blocks", "explained_by"],
    layout: "tree-top-down",
    recommendedMinNodes: 3,
  },
  architecture: {
    id: "architecture",
    name: "Architecture",
    description: "Components, services, data flows",
    allowedNodeTypes: ["heading", "shape", "text", "table"],
    recommendedRoles: ["component"],
    allowedRelationTypes: ["flows_to", "depends_on", "relates_to", "implements", "references", "explained_by"],
    layout: "layered-boxes",
    recommendedMinNodes: 2,
  },
  comparison: {
    id: "comparison",
    name: "Comparison",
    description: "A vs B, pros/cons, option evaluation",
    allowedNodeTypes: ["heading", "table", "text", "shape"],
    // A single table (each row an option) is a complete, valid comparison, so
    // there's no per-node "option" role or node-count minimum worth enforcing.
    allowedRelationTypes: ["relates_to", "supports", "blocks", "explained_by"],
    layout: "column-compare",
  },
  action_plan: {
    id: "action_plan",
    name: "Action Plan",
    description: "Steps, tasks, follow-ups",
    allowedNodeTypes: ["heading", "todo", "text", "table", "code", "page"],
    allowedRelationTypes: ["flows_to", "relates_to", "depends_on", "blocks", "explained_by"],
    layout: "document-stack",
  },
  causal_map: {
    id: "causal_map",
    name: "Causal Map",
    description: "Multiple interacting causes and effects, not a strict 3-column problem/cause/solution",
    allowedNodeTypes: ["heading", "shape", "text"],
    allowedRelationTypes: ["caused_by", "depends_on", "supports", "blocks", "derived_from", "relates_to", "explained_by"],
    // Reuses `architecture`'s own layout function verbatim (see `layout.ts`'s `LAYOUTS` map): `layerGraph`/
    // `layeredPositions` are already multi-root, relationship-driven and cycle-safe — exactly what a free-form
    // causal graph needs, with no new layout code.
    layout: "causal-graph",
    recommendedMinNodes: 3,
  },
  sectioned: {
    id: "sectioned",
    name: "Sections",
    description: "Long or mixed content with several sections of different kinds (options, steps, tables, diagrams)",
    // Every renderable type: each section (a `group`) picks its own arrangement, so one plan can mix a table, a tree and a chain.
    allowedNodeTypes: ["group", "heading", "text", "todo", "table", "code", "page", "shape"],
    allowedRelationTypes: ALL_RELATIONS,
    layout: "grouped-grid",
  },
};

export function templateFor(id: VisualTemplate): VisualTemplateDefinition {
  return VISUAL_TEMPLATE_REGISTRY[id];
}

export function listTemplates(): readonly VisualTemplateDefinition[] {
  return VISUAL_TEMPLATES.map((id) => VISUAL_TEMPLATE_REGISTRY[id]);
}

/**
 * The templates a section's content is populated with — every one but `sectioned`, which is the container
 * the app itself builds around them (F42: one frame per document section, see `groupByUnit`).
 */
export function unitTemplates(): readonly VisualTemplateDefinition[] {
  return listTemplates().filter((t) => t.id !== "sectioned");
}
