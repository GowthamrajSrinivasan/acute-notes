/**
 * `VisualPlan` (PRD §13.15.4): the provider-independent description of what
 * content means and how it should be represented. The local planner (F28),
 * an AI model (F31) or an MCP client produces it; Acute-Notes validates (F29)
 * and renders it (F30), deciding ids, positions, sizes and styling itself.
 *
 * These are the PRD's types as written. F29 adds the schema that validates
 * untrusted plans against them, plus the template registry.
 */
import type { ArchitectureKind } from "@/domain/canvas/diagram";
import { COMPOSITE_SHAPES } from "@/domain/canvas/compositeShapes";
import type { DiagramCard, NodeSemantics } from "@/domain/canvas/diagram";
import type { RelationType } from "@/domain/types";

export const VISUAL_TEMPLATES = [
  "flow",
  "problem_cause_solution",
  "concept_map",
  "timeline",
  "decision_tree",
  "architecture",
  "comparison",
  "action_plan",
  "sectioned",
  // Wave E: a free-form causes/effects graph, not pinned to 3 named roles (problem_cause_solution's own limit).
  "causal_map",
] as const;

export type VisualTemplate = (typeof VISUAL_TEMPLATES)[number];

/** Shapes a plan can draw: Excalidraw's own, plus composite ones (`domain/canvas/compositeShapes.ts`). */
export const PLAN_SHAPES = ["rectangle", "diamond", "ellipse", ...COMPOSITE_SHAPES] as const;
export type PlanShape = (typeof PLAN_SHAPES)[number];

export interface VisualPlan {
  version: 1;
  template: VisualTemplate;
  nodes: VisualNode[];
  relationships: VisualRelationship[];
  metadata?: {
    title?: string;
    summary?: string;
    /** An architecture plan's info cards, shown under its diagram frame (interactive architecture frames). */
    cards?: DiagramCard[];
  };
}

export type VisualNodeContent =
  | { type: "heading"; content: { text: string } }
  | { type: "text"; content: { markdown: string } }
  | { type: "todo"; content: { items: { text: string; checked: boolean }[] } }
  | { type: "table"; content: { columns: string[]; rows: string[][] } }
  | { type: "code"; content: { language?: string; source: string } }
  | { type: "page"; content: { title: string; markdown: string } }
  /**
   * `kind`, `sublabel`, `tag`, `details`: an architecture component's semantics (interactive architecture frames):
   * the kind colours the shape, the rest shows in the card when it's selected. The label stays the shape's text.
   */
  | { type: "shape"; content: { shape: PlanShape; label: string } & NodeSemantics }
  | { type: "image"; content: { assetRef: string; alt?: string } }
  /**
   * A section (F42): a titled container, rendered as a frame, whose members are the nodes naming it as `parent`.
   * `takeaway`: the section's main point in one line (content fidelity Wave B), shown under its title.
   */
  | {
      type: "group";
      content: {
        label: string;
        arrangement: GroupArrangement;
        takeaway?: string;
        /** The section is an architecture diagram: its frame is interactive (also implied by a member shape with a `kind`). */
        diagram?: "architecture";
        /** Info cards shown under the section's frame when it's a diagram. */
        cards?: DiagramCard[];
        /** The section's Lens level (Acute Lens Phase 2: a Repo Map section's `level`). */
        level?: number;
      };
    };

/**
 * How a group lays out its members (F42): `grid` is one row while it fits, else a 2- or 3-column matrix;
 * `chain` is the same in reading order for a sequence; `tree` is top-down layers along the group's
 * relationships; `compare` is always one top-aligned row; `radial` circles a "center" member; `stack` is one column.
 */
export const GROUP_ARRANGEMENTS = ["grid", "chain", "tree", "compare", "radial", "stack"] as const;
export type GroupArrangement = (typeof GROUP_ARRANGEMENTS)[number];

export type VisualNodeType = VisualNodeContent["type"];

export type VisualNode = {
  /** Plan-local id; NOT the Acute object id. */
  id: string;
  /** Template slot, e.g. "problem", "cause", "step". */
  role?: string;
  title?: string;
  importance?: "low" | "medium" | "high";
  /** Where in the input it came from. */
  sourceSpan?: { start: number; end: number };
  /** Identity stable across regenerations of the same content (§13.15.19); compared for equality only. */
  stableKey?: string;
  /** The id of the `group` node this node belongs to (F42). Groups themselves are never nested. */
  parent?: string;
  /** A card's architecture kind (Acute Lens Phase 2, from a Repo Map node); a shape carries its kind in its content. */
  kind?: ArchitectureKind;
  /**
   * "analysis": the model's own reading of the content (a conclusion, what is decided or open, a trade-off it
   * implies), not a fact stated in it (content fidelity D-R2.1). Rendered with an "Analysis" tag.
   * "plain": content shown as it is, with no model's reading of it (a merge's unplaced part, `reconcile/plainCards.ts`); never folded into
   * a "More from this section" page.
   */
  origin?: "analysis" | "plain";
} & VisualNodeContent;

export interface VisualRelationship {
  /** VisualNode.id (a group's id links the whole section) */
  from: string;
  /** VisualNode.id */
  to: string;
  type: RelationType;
  label?: string;
  /** Why the connection exists, shown when the relationship is inspected in a diagram frame. */
  explanation?: string;
  /** How sure the model was that it exists (0–1), when it said (Lens `lens_expand`, plan §6.3). */
  confidence?: number;
}
