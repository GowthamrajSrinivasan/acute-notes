/**
 * Schemas of the Knowledge Notes golden dataset (evaluation/knowledge-notes/README.md).
 *
 * zod is the single definition, as in `ai/visual-plan/schema.ts`: the JSON Schema files in `../schemas/` are generated
 * from these (`dataset.test.ts` fails when they drift; `UPDATE_GOLDEN_SCHEMAS=1` rewrites them). The enums that the
 * product owns (relation types, node kinds, plan node types, templates, Lens levels) are imported from `src`, so a
 * product change shows up here as a validation failure instead of a silent mismatch.
 *
 * Nothing here is used by the app. This is test tooling only.
 */
import { z } from "zod";
import { NODE_KINDS, LENS_MAX_LEVEL } from "@/domain/canvas/diagram";
import { PROJECT_KINDS } from "@/domain/canvas/nodeProject";
import { RELATION_TYPES } from "@/domain/types";
import { GROUP_ARRANGEMENTS, VISUAL_TEMPLATES } from "@/ai/visual-plan/types";

export const DATASET_VERSION = "1.0.0";

// ---------------------------------------------------------------- shared

const caseId = z.string().regex(/^kn-\d{2}-[a-z0-9-]+$/, "case ids look like kn-01-short-name");
const unitId = z.string().regex(/^u\d+$/, "source units are opaque: u1, u2, … (knowledge-notes-plan §3.1)");
const sectionId = z.string().regex(/^s\d+$/);
const knowledgeId = z.string().regex(/^ku\.[a-z0-9-]+$/);
const elementId = z.string().regex(/^e\.[a-z0-9-]+$/);
const frameId = z.string().regex(/^f\.[a-z0-9-]+$/);
const relationshipId = z.string().regex(/^r\.[a-z0-9-]+$/);
const lensKey = z.string().regex(/^[a-z0-9-]+(\.[a-z0-9-]+)*$/, "Lens keys are dotted slugs, e.g. checkout.api");
const assertionId = z.string().regex(/^a\.[a-z0-9-]+$/);
const level = z.number().int().min(0).max(LENS_MAX_LEVEL);
const text = z.string().trim().min(1);

/** Whether the product can produce / render this expectation today (see reports/capability-inventory.md). */
export const SUPPORT = ["implemented", "partial", "future"] as const;
const support = z.enum(SUPPORT);

export const REQUIREMENT = ["mandatory", "optional", "conditional"] as const;

/**
 * Term groups for deterministic matching against generated output. A node matches when its normalised text contains
 * at least one term of **every** group. Terms are lower-case and compared after `normalize()` (evaluate.ts).
 */
const match = z.object({ all: z.array(z.array(text).min(1)).min(1) });

export const RUBRIC_DIMENSIONS = [
  "source_fidelity",
  "coverage",
  "grouping",
  "element_selection",
  "relationships",
  "architecture_lens",
  "traceability",
  "visual",
] as const;

/** Known distortions the dataset must catch (README "Regression cases"). */
export const DISTORTIONS = [
  "possibility_to_guarantee",
  "condition_dropped",
  "correlation_to_causation",
  "critical_exception_omitted",
  "dependency_reversed",
  "unlabeled_architecture_edge",
  "mislabeled_architecture_edge",
  "inconsistent_identity_across_levels",
  "user_edit_overwritten",
  "invented_detail",
  "fabricated_agreement",
  "unsupported_recommendation",
] as const;

const review = z.object({
  status: z.enum(["draft", "reviewed", "approved"]),
  /** Who wrote the expectations. Never the Acute pipeline being evaluated. */
  authoredBy: text,
  reviewers: z.array(text),
  approvedAt: z.string().nullable(),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------- A. source case (case.json)

export const SOURCE_TYPES = [
  "article",
  "technical_documentation",
  "meeting_transcript",
  "tutorial",
  "design_specification",
  "codebase_description",
  "architecture_proposal",
] as const;

/** Omission reasons are the fixed list of knowledge-notes-plan §3.2. */
export const OMISSION_REASONS = ["filler", "duplicate", "superseded", "meta"] as const;

export const CRITICAL_REASONS = ["limitation", "requirement", "condition", "takeaway", "protected", "decision", "action_item", "open_question", "conflict"] as const;

export const PROTECTED_KINDS = ["number", "identifier", "path", "quote", "item_id", "action_item", "formula", "version", "named_term"] as const;

export const UNIT_TAGS = [
  "terminology",
  "definition",
  "formula",
  "numeric",
  "assumption",
  "condition",
  "limitation",
  "example",
  "decision",
  "proposal",
  "action_item",
  "question",
  "disagreement",
  "ambiguous",
  "conflict",
  "repetition",
  "irrelevant",
  "user_edit",
] as const;

export const sourceUnitSchema = z.object({
  id: unitId,
  /** Source version the unit belongs to (case 12 has two). Defaults to 1. */
  version: z.number().int().min(1).optional(),
  section: sectionId,
  kind: z.enum(["sentence", "list_item", "table_row", "table", "code", "quote", "heading", "speaker_turn"]),
  /** Exact text from the source file (after line-ending normalisation). Must occur in that version's source. */
  quote: text,
  /** 1-based, when the quote occurs more than once in the source. */
  occurrence: z.number().int().min(1).optional(),
  tags: z.array(z.enum(UNIT_TAGS)).optional(),
  critical: z.object({ reason: z.enum(CRITICAL_REASONS), note: z.string().optional() }).optional(),
  protected: z.array(z.object({ tier: z.enum(["exact", "warn"]), kind: z.enum(PROTECTED_KINDS), value: text })).optional(),
  omittable: z.object({ reason: z.enum(OMISSION_REASONS), of: unitId.optional(), note: z.string().optional() }).optional(),
  ambiguity: z.object({ note: text, conflictsWith: z.array(unitId).optional() }).optional(),
});

export const sourceCaseSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  id: caseId,
  title: text,
  scenario: text,
  sourceType: z.enum(SOURCE_TYPES),
  audience: text,
  objective: text,
  complexity: z.enum(["low", "medium", "high"]),
  /** One entry per source version. `words` is checked against the file. */
  sourceFiles: z.array(z.object({ version: z.number().int().min(1), path: text, words: z.number().int().positive(), title: text })).min(1),
  sections: z.array(z.object({ id: sectionId, heading: text, version: z.number().int().min(1).optional() })).min(1),
  units: z.array(sourceUnitSchema).min(1),
  /** Material that may be dropped, described for reviewers (the per-unit `omittable` is what is checked). */
  safeToOmit: z.array(z.object({ units: z.array(unitId).min(1), why: text })),
  /** What the case is designed to exercise; ids from reports/capability-inventory.md. */
  capabilities: z.array(text).min(1),
  provenance: z.object({ synthetic: z.literal(true), note: text }),
  review,
});

// ---------------------------------------------------------------- B. expected knowledge (knowledge.json)

export const KNOWLEDGE_TYPES = [
  "concept",
  "definition",
  "principle",
  "component",
  "process",
  "example",
  "evidence",
  "assumption",
  "constraint",
  "caveat",
  "trade_off",
  "decision",
  "question",
  "action_item",
] as const;

/** Relation vocabulary of the expectation: the product's `RELATION_TYPES` first, then extensions the product lacks. */
export const EXTENSION_RELATIONS = ["contrasts_with", "refines", "part_of", "evidenced_by", "causes", "uses", "proposed_by"] as const;
export const ALL_RELATIONS = [...RELATION_TYPES, ...EXTENSION_RELATIONS] as const;
const relation = z.enum(ALL_RELATIONS);

export const knowledgeUnitSchema = z.object({
  id: knowledgeId,
  title: text,
  claim: text,
  explanation: text,
  type: z.enum(KNOWLEDGE_TYPES),
  importance: z.enum(["critical", "important", "supplementary"]),
  sourceUnits: z.array(unitId).min(1),
  /** explicit: stated by the source; inferred: a reasonable reading that must be marked; unknown: the source leaves it open. */
  provenance: z.enum(["explicit", "inferred", "conflicting", "unknown"]),
  related: z.array(z.object({ to: knowledgeId, relation, note: z.string().optional() })).optional(),
  /**
   * This caveat, condition or limit qualifies that claim. It must be carried by the claim's own card, never by a card of
   * its own (knowledge-notes-plan §4.2 "Limits stay with their claim"); `validateDataset` enforces it on the canvas spec.
   */
  limits: knowledgeId.optional(),
  /** Values that must appear verbatim (after normalisation). */
  exactDetails: z.array(text).optional(),
  /** Conditions, qualifiers and caveats that must stay with the claim. */
  mustPreserve: z.array(text).optional(),
  paraphrase: z.object({ allowed: z.boolean(), note: z.string().optional() }),
  omission: z.object({ allowed: z.boolean(), reason: z.string().optional() }),
  review: z.object({ required: z.boolean(), reason: z.string().optional() }).optional(),
});

export const expectedKnowledgeSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  caseId,
  units: z.array(knowledgeUnitSchema).min(1),
  /** Things a faithful result must NOT say (each is a fabricated or distorted claim). */
  mustNotClaim: z.array(z.object({ claim: text, why: text, units: z.array(unitId).optional() })),
});

// ---------------------------------------------------------------- C–E. expected canvas (canvas.json)

/** Framework-independent element vocabulary, mapped to VisualPlan node types (`planNodeTypes`). */
export const ELEMENT_TYPES = ["heading", "text_card", "takeaway", "shape", "table", "code", "todo", "page", "image", "diagram_card"] as const;
/** VisualPlan node types; `group` here means a frame's own title and takeaway (`group.content`). */
export const PLAN_NODE_TYPES = ["heading", "text", "todo", "table", "code", "page", "shape", "image", "group"] as const;

export const expectedElementSchema = z.object({
  id: elementId,
  element: z.enum(ELEMENT_TYPES),
  planNodeTypes: z.array(z.enum(PLAN_NODE_TYPES)).min(1),
  role: text,
  content: text,
  knowledge: z.array(knowledgeId).min(1),
  match,
  hierarchy: z.enum(["primary", "secondary", "detail"]),
  /** Frame the element belongs in; null = deliberately outside every frame (give `outsideFrameReason`). */
  frame: frameId.nullable(),
  outsideFrameReason: z.string().optional(),
  kind: z.enum([...NODE_KINDS, ...PROJECT_KINDS]).optional(),
  layout: z.string().optional(),
  requirement: z.enum(REQUIREMENT),
  condition: z.string().optional(),
  support,
  supportNote: z.string().optional(),
});

export const expectedFrameSchema = z.object({
  id: frameId,
  title: text,
  titleMatch: match,
  purpose: text,
  rationale: text,
  children: z.array(elementId).min(1),
  arrangement: z.enum(GROUP_ARRANGEMENTS).optional(),
  diagram: z.literal("architecture").optional(),
  level: level.optional(),
  expansion: z.string().optional(),
  separateFrom: z.array(z.object({ frame: frameId, reason: text })).optional(),
  requirement: z.enum(REQUIREMENT),
  support,
});

export const expectedRelationshipSchema = z.object({
  id: relationshipId,
  from: elementId,
  to: elementId,
  type: relation,
  /** Product relation types accepted as equivalent in generated output (defaults to `type` when it is a product type). */
  acceptableTypes: z.array(z.enum(RELATION_TYPES)).optional(),
  label: z.object({ required: z.boolean(), text: z.string().optional(), match: match.optional() }),
  direction: z.enum(["directed", "bidirectional"]),
  explanation: text,
  evidence: z.array(unitId).min(1),
  provenance: z.enum(["explicit", "inferred"]),
  inferenceAllowed: z.boolean(),
  reviewRequired: z.boolean(),
  requirement: z.enum(REQUIREMENT),
  support,
});

export const expectedCanvasSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  caseId,
  template: z.enum(VISUAL_TEMPLATES),
  templateNote: z.string().optional(),
  frames: z.array(expectedFrameSchema),
  elements: z.array(expectedElementSchema).min(1),
  relationships: z.array(expectedRelationshipSchema),
  /** Ideas that belong together (one frame), and why. */
  together: z.array(z.object({ elements: z.array(elementId).min(2), reason: text })).optional(),
  /** Concepts that must stay apart (never one frame), and why. */
  keepSeparate: z.array(z.object({ elements: z.array(elementId).min(2), reason: text })).optional(),
  /** The main idea and what supports it (examples, evidence, detail). */
  hierarchy: z.array(z.object({ main: elementId, supporting: z.array(elementId).min(1), reason: text })).optional(),
  /** Expected behaviour where the ideal element is not renderable today. */
  unsupported: z.array(z.object({ capability: text, ideal: text, expectedToday: text })).optional(),
});

// ---------------------------------------------------------------- Lens (lens.json)

export const expectedLensSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  caseId,
  profile: z.literal("architecture"),
  levels: z
    .array(
      z.object({
        level,
        name: z.enum(["System", "Architecture", "Component", "Flow", "Operation", "Source"]),
        frameKey: lensKey,
        title: text,
        availability: z.enum(["available", "partial", "unavailable"]),
        unavailableReason: z.string().optional(),
        /** What becomes visible at this level that was not visible above. */
        reveals: text,
        nodes: z.array(lensKey),
        edges: z.array(relationshipId),
      }),
    )
    .min(1),
  nodes: z.array(
    z.object({
      key: lensKey,
      label: text,
      match,
      kind: z.enum(NODE_KINDS),
      level,
      /** The node one level up whose drill-down shows this node's frame. */
      parent: lensKey.optional(),
      /** The frame this node expands to (drill-down). */
      expandsTo: lensKey.optional(),
      /** Canonical canvas element this node is (Lens is a projection, never a second source of truth). */
      canvasElement: elementId.optional(),
      knowledge: z.array(knowledgeId).min(1),
      evidence: z.array(
        z.object({
          type: z.enum(["source_unit", "code", "none"]),
          unit: unitId.optional(),
          path: z.string().optional(),
          lines: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
          availability: z.enum(["available", "unavailable"]),
          note: z.string().optional(),
        }),
      ),
      uncertainty: z.object({ note: text, reviewRequired: z.boolean() }).optional(),
    }),
  ),
  edges: z.array(
    z.object({
      id: relationshipId,
      from: lensKey,
      to: lensKey,
      relation: z.enum(RELATION_TYPES),
      label: text,
      level,
      explanation: text,
      evidence: z.array(unitId).min(1),
      provenance: z.enum(["explicit", "inferred"]),
      /** The edge one level up that summarises this one (roll-up). */
      rollsUpTo: relationshipId.optional(),
    }),
  ),
  navigationPaths: z.array(z.object({ id: z.string().regex(/^p\.[a-z0-9-]+$/), description: text, path: z.array(lensKey).min(2) })),
  invariants: z.array(text).min(1),
  interactions: z.array(z.object({ id: text, description: text, support, evidence: text })),
});

// ---------------------------------------------------------------- per-case assertions (evaluation.json)

const elementRef = { element: elementId };

/** Deterministic checks: the evaluator in `evaluate.ts` implements exactly these. */
export const checkSchema = z.discriminatedUnion("check", [
  z.object({ check: z.literal("element_present"), ...elementRef }),
  z.object({ check: z.literal("element_in_frame"), ...elementRef, frame: frameId }),
  z.object({ check: z.literal("element_kind"), ...elementRef, kinds: z.array(z.enum(NODE_KINDS)).min(1) }),
  z.object({ check: z.literal("frame_present"), frame: frameId }),
  z.object({ check: z.literal("frame_level"), frame: frameId, level }),
  z.object({ check: z.literal("frame_count"), min: z.number().int().min(0), max: z.number().int().min(0) }),
  /** All the elements sit in one frame. */
  z.object({ check: z.literal("together"), elements: z.array(elementId).min(2), why: text }),
  /** No frame holds both elements. */
  z.object({ check: z.literal("apart"), elements: z.array(elementId).length(2), why: text }),
  /** Each supporting element is linked to the main one, or shares its frame and is not given more weight. */
  z.object({ check: z.literal("hierarchy"), main: elementId, supporting: z.array(elementId).min(1), why: text }),
  z.object({ check: z.literal("relationship_present"), relationship: relationshipId }),
  z.object({ check: z.literal("relationship_absent"), from: elementId, to: elementId, types: z.array(z.enum(RELATION_TYPES)).optional(), why: text }),
  z.object({ check: z.literal("architecture_edges_labeled"), types: z.array(z.enum(RELATION_TYPES)).min(1) }),
  /** Every term group must be present in the matched element's text (or anywhere, without `element`). */
  z.object({ check: z.literal("text_present"), element: elementId.optional(), all: z.array(z.array(text).min(1)).min(1), why: text }),
  /** A case-insensitive regex that must not match the normalised text of any node or relationship label. */
  z.object({ check: z.literal("text_absent"), pattern: text, why: text }),
  z.object({ check: z.literal("lens_node"), key: lensKey }),
  z.object({ check: z.literal("lens_edge"), edge: relationshipId }),
  z.object({ check: z.literal("lens_drill"), from: lensKey, to: lensKey }),
  z.object({ check: z.literal("lens_identity"), key: lensKey }),
  z.object({ check: z.literal("lens_no_children"), key: lensKey, why: text }),
  z.object({ check: z.literal("lens_path"), path: z.string().regex(/^p\.[a-z0-9-]+$/) }),
  z.object({ check: z.literal("reconcile_state"), item: z.string().regex(/^i\.[a-z0-9-]+$/) }),
  // Gate 3, on the plan as the product renders it (tooling/render.ts).
  z.object({ check: z.literal("layout_no_fatal") }),
  z.object({ check: z.literal("layout_crossings_max"), max: z.number().int().min(0) }),
  z.object({ check: z.literal("cards_no_overlap") }),
  z.object({ check: z.literal("children_inside_frames") }),
  z.object({ check: z.literal("frames_no_overlap") }),
]);

export const assertionSchema = z.object({
  id: assertionId,
  dimension: z.enum(RUBRIC_DIMENSIONS),
  severity: z.enum(["critical", "major", "minor"]),
  method: z.enum(["deterministic", "model_judge", "human"]),
  /** What the assertion reads: a VisualPlan, a Lens projection, a reconcile outcome, or the rendered canvas. */
  target: z.enum(["plan", "lens", "reconcile", "render"]),
  support,
  /** Capability ids (reports/capability-inventory.md) the assertion needs; required when support isn't "implemented". */
  requires: z.array(text).optional(),
  regression: z.enum(DISTORTIONS).optional(),
  description: text,
  check: checkSchema.optional(),
  judge: z.object({ question: text, pass: text, fail: text }).optional(),
});

export const caseEvaluationSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  caseId,
  assertions: z.array(assertionSchema).min(1),
});

// ---------------------------------------------------------------- reconcile expectations (reconcile.json, case 12)

/** States of `ai/reconcile/classify.ts` (`ReconciliationItem`), plus `review` for ambiguous matches (knowledge-notes-plan §6.1). */
export const RECONCILE_STATES = ["unchanged", "update_clean", "update_conflict", "add", "remove", "review"] as const;

export const expectedReconcileSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  caseId,
  fromVersion: z.number().int().min(1),
  toVersion: z.number().int().min(2),
  /** A user's edit applied to the v1 canvas before the update. */
  userEdits: z.array(z.object({ element: elementId, before: text, after: text, note: text })),
  items: z.array(
    z.object({
      id: z.string().regex(/^i\.[a-z0-9-]+$/),
      element: elementId,
      match,
      change: z.enum(["unchanged", "edited", "added", "removed", "dependency_changed", "user_edited", "ambiguous"]),
      states: z.array(z.enum(RECONCILE_STATES)).min(1),
      /** Text that must still be present after reconciliation (a user edit). */
      mustKeep: z.array(text).optional(),
      unitsBefore: z.array(unitId),
      unitsAfter: z.array(unitId),
      explanation: text,
      support,
    }),
  ),
});

// ---------------------------------------------------------------- rubrics (rubrics/*.json)

export const rubricSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  dimension: z.enum(RUBRIC_DIMENSIONS),
  title: text,
  definition: text,
  questions: z.array(text).min(1),
  severity: z.object({ critical: text, major: text, minor: text }),
  methods: z.object({ deterministic: z.array(text), model_judge: z.array(text), human: z.array(text) }),
  requiredAssertions: z.array(text).min(1),
  passCriteria: text,
  failCriteria: text,
  passExample: text,
  failExample: text,
  judgeScale: z.array(z.object({ score: z.number().int().min(1).max(5), meaning: text })).length(5).optional(),
});

// ---------------------------------------------------------------- regressions (regressions/*.json)

export const mutationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("replace_text"), node: text, find: text, replace: z.string() }),
  z.object({ op: z.literal("remove_node"), node: text }),
  z.object({ op: z.literal("reverse_relationship"), from: text, to: text }),
  z.object({ op: z.literal("set_label"), from: text, to: text, label: z.string().nullable() }),
  z.object({ op: z.literal("set_relation_type"), from: text, to: text, type: z.enum(RELATION_TYPES) }),
  z.object({ op: z.literal("lens_rekey"), level, key: text, newKey: text, newLabel: z.string().optional() }),
  /** Adds a node to every projected frame at `level` (e.g. a component redrawn with a new identity). */
  z.object({ op: z.literal("lens_add_node"), level, node: z.object({ key: text, label: text, kind: z.string().optional() }) }),
  z.object({ op: z.literal("lens_remove_edge"), level, from: text, to: text }),
  z.object({ op: z.literal("lens_reverse_edge"), level, from: text, to: text }),
  z.object({ op: z.literal("reconcile_set"), item: text, state: z.enum(RECONCILE_STATES), text: z.string().optional() }),
]);

export const regressionSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  id: z.string().regex(/^rg-\d{2}-[a-z0-9-]+$/),
  distortion: z.enum(DISTORTIONS),
  caseId,
  target: z.enum(["plan", "lens", "reconcile"]),
  description: text,
  mutations: z.array(mutationSchema).min(1),
  /** Assertions that must fail on the mutated reference. */
  expectFailing: z.array(assertionId).min(1),
});

// ---------------------------------------------------------------- actual-output formats the evaluator reads

/** A Lens projection, normalised (what `domain/lens/lensView.ts` `lensTree` would be adapted to). */
export const lensProjectionSchema = z.object({
  levels: z.array(
    z.object({
      level,
      frameKey: z.string(),
      nodes: z.array(z.object({ key: z.string(), label: z.string(), kind: z.string().optional(), evidence: z.array(z.object({ path: z.string(), lines: z.tuple([z.number(), z.number()]).optional() })).optional() })),
      edges: z.array(z.object({ from: z.string(), to: z.string(), relation: z.string(), label: z.string().optional() })),
    }),
  ),
  drills: z.array(z.object({ from: z.string(), toFrameKey: z.string() })),
});

/** A reconcile outcome, normalised (from `ai/reconcile/classify.ts` `reconcile` items plus each item's text after Accept). */
export const reconcileOutcomeSchema = z.object({
  items: z.array(z.object({ key: z.string(), text: z.string(), state: z.enum(RECONCILE_STATES) })),
});

/**
 * Quality gates (record-and-replay design, README): gate 1 checks the knowledge, gate 2 the organisation, gate 3 the
 * layout. A canvas that looks right can't hide a bad summary, because gate 1 is reported on its own.
 */
export const GATE_OF_DIMENSION = {
  source_fidelity: 1,
  coverage: 1,
  traceability: 1,
  grouping: 2,
  element_selection: 2,
  relationships: 2,
  architecture_lens: 2,
  visual: 3,
} as const satisfies Record<(typeof RUBRIC_DIMENSIONS)[number], 1 | 2 | 3>;

// ---------------------------------------------------------------- capability inventory (capabilities.json)

export const CAPABILITY_STATUS = ["implemented", "partially_implemented", "planned", "not_found", "needs_verification"] as const;

export const capabilitiesSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  inspectedAt: text,
  capabilities: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
        category: z.enum(["canvas", "pages", "ai_pipeline", "architecture", "lens", "provenance", "reconcile", "mcp", "testing"]),
        status: z.enum(CAPABILITY_STATUS),
        summary: text,
        evidence: z.array(text).min(1),
      }),
    )
    .min(1),
});

// ---------------------------------------------------------------- recordings (recordings/<run>/meta.json)

/** One approved live run, recorded once and replayed offline on every change (README "Record and replay"). */
export const recordingMetaSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  runId: z.string().regex(/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/),
  recordedAt: text,
  /** Who approved spending on this run (no live run happens without it). */
  approvedBy: text,
  provider: text,
  model: text,
  /** What produced the replies: the pipeline mode and prompt version, so a prompt change means a new recording. */
  pipeline: z.object({ noteModel: z.enum(["preserve", "distil"]), promptVersion: text, appVersion: text }),
  /** When true, a critical deterministic failure in this recording fails the replay test. */
  gate: z.boolean(),
  cases: z.array(z.object({ caseId, plan: text.optional(), lens: text.optional(), reconcile: text.optional(), replies: text.optional() })),
});

/**
 * The flat constraints view of a case: the shape requested on 2026-10-19 for loading cases directly. Derived from the
 * full case files by `constraints.ts` (never edited by hand; `dataset.test.ts` keeps it in sync).
 */
export const constraintsViewSchema = z.object({
  id: caseId,
  kind: z.enum(SOURCE_TYPES),
  source: text,
  critical: z.array(z.object({ quote: text, why: text })),
  exact: z.array(text),
  groups: z.object({ together: z.array(z.array(text)), apart: z.array(z.array(text)) }),
  hierarchy: z.array(z.object({ main: text, supporting: z.array(text) })),
  relations: z.array(z.object({ from: text, to: text, type: text, label: z.string().optional() })),
  mustNotSay: z.array(z.object({ text: text, why: text })),
  update: z.object({ v2: text, expect: z.object({ unchanged: z.array(text), changed: z.array(text), added: z.array(text), removed: z.array(text), userEdited: z.array(text) }) }).optional(),
});

// ---------------------------------------------------------------- manifest

export const manifestSchema = z.object({
  datasetVersion: z.literal(DATASET_VERSION),
  name: text,
  description: text,
  cases: z.array(
    z.object({
      id: caseId,
      directory: text,
      scenario: text,
      files: z.object({
        case: text,
        knowledge: text,
        canvas: text,
        evaluation: text,
        constraints: text,
        lens: text.optional(),
        reconcile: text.optional(),
        referencePlan: text,
        referenceLens: text.optional(),
        referenceReconcile: text.optional(),
      }),
    }),
  ),
  rubrics: z.array(text),
  /** Directory of regression files; every *.json in it is loaded. */
  regressionsDir: text,
});

/** The JSON Schema files written to `../schemas/`. */
export const JSON_SCHEMAS = {
  "source-case.schema.json": sourceCaseSchema,
  "expected-knowledge.schema.json": expectedKnowledgeSchema,
  "expected-canvas.schema.json": expectedCanvasSchema,
  "expected-lens.schema.json": expectedLensSchema,
  "expected-reconcile.schema.json": expectedReconcileSchema,
  "case-evaluation.schema.json": caseEvaluationSchema,
  "evaluation-rubric.schema.json": rubricSchema,
  "regression.schema.json": regressionSchema,
  "dataset-manifest.schema.json": manifestSchema,
  "recording-meta.schema.json": recordingMetaSchema,
  "constraints-view.schema.json": constraintsViewSchema,
  "capabilities.schema.json": capabilitiesSchema,
} as const;

export type SourceCase = z.infer<typeof sourceCaseSchema>;
export type ExpectedKnowledge = z.infer<typeof expectedKnowledgeSchema>;
export type ExpectedCanvas = z.infer<typeof expectedCanvasSchema>;
export type ExpectedLens = z.infer<typeof expectedLensSchema>;
export type ExpectedReconcile = z.infer<typeof expectedReconcileSchema>;
export type CaseEvaluation = z.infer<typeof caseEvaluationSchema>;
export type Assertion = z.infer<typeof assertionSchema>;
export type Check = z.infer<typeof checkSchema>;
export type Rubric = z.infer<typeof rubricSchema>;
export type Regression = z.infer<typeof regressionSchema>;
export type Mutation = z.infer<typeof mutationSchema>;
export type LensProjection = z.infer<typeof lensProjectionSchema>;
export type ReconcileOutcome = z.infer<typeof reconcileOutcomeSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Capabilities = z.infer<typeof capabilitiesSchema>;
export type RecordingMeta = z.infer<typeof recordingMetaSchema>;
export type ConstraintsView = z.infer<typeof constraintsViewSchema>;
