/**
 * Zod schema for `VisualPlan` (F29): one definition validates untrusted plans
 * (a model's structured output, the local planner, an MCP `render_visual_plan`
 * call) and generates the JSON Schema handed to a provider as its structured-
 * output contract (§13.15.4's own type comments call this out).
 *
 * This module only shapes and bounds *individual* nodes/relationships/the
 * top-level envelope — content is typed per node type, so no `unknown`
 * content can reach the renderer, and unknown fields are stripped by zod's
 * own default object behaviour (`z.object` drops keys it doesn't declare).
 * It does not decide what happens when a node or relationship is invalid;
 * `validate.ts` does that (lenient, per-item recovery) and is what every
 * producer actually calls.
 */
import { LENS_MAX_LEVEL, NODE_KINDS } from "@/domain/canvas/diagram";
import { confidenceSchema, diagramCardsSchema, explanationSchema, nodeSemanticsFields } from "@/domain/canvas/diagramSchema";
import { z } from "zod";
import { RELATION_TYPES } from "@/domain/types";
import { GROUP_ARRANGEMENTS, PLAN_SHAPES, VISUAL_TEMPLATES } from "./types";

/** Text limits (PRD F29 "text length limits"). A node/relationship over its limit fails here, so `validate.ts` drops it as oversized content — never truncated, never rejecting the whole plan for it. */
export const TEXT_LIMITS = {
  title: 200,
  heading: 300,
  shapeLabel: 300,
  relationshipLabel: 200,
  markdown: 20_000,
  codeSource: 20_000,
  language: 40,
  todoItem: 500,
  todoItems: 100,
  tableCell: 2_000,
  tableColumns: 30,
  tableRows: 300,
  planTitle: 200,
  planSummary: 2_000,
  takeaway: 300,
  assetRef: 300,
  imageAlt: 300,
  groupLabel: 200,
} as const;

const span = z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });
const id = z.string().min(1).max(200);
const role = z.string().min(1).max(100);

/** A stable key's length limit (the change set's `stableNodeKey` has the same one). */
export const STABLE_KEY_MAX = 300;

/** FNV-1a, 32-bit, as 8 hex digits: a deterministic fingerprint of a long key. */
function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/**
 * A stable key over the limit, compacted instead of rejected: a section merging several parts with long headings
 * has a long key, and every node in it carries it as a prefix — rejecting those dropped the whole section
 * (content fidelity: validation never drops content). The start and the node's own end ("… § table#1") are kept,
 * with a fingerprint of the whole key between them, so it stays unique and the same across regenerations.
 */
export function compactStableKey(key: string): string {
  if (key.length <= STABLE_KEY_MAX) return key;
  const tail = key.slice(-80);
  return `${key.slice(0, STABLE_KEY_MAX - tail.length - 11)}~${fnv(key)}~${tail}`;
}

const nodeCommon = {
  id,
  // The optional fields below are dropped when malformed (an unknown importance, a fractional span…), never a
  // reason to reject the node: a rejected node keeps only its text, and a table loses its rows and columns.
  role: role.optional().catch(undefined),
  title: z.string().max(TEXT_LIMITS.title).optional(),
  importance: z.enum(["low", "medium", "high"]).optional().catch(undefined),
  sourceSpan: span.optional().catch(undefined),
  stableKey: z.preprocess((v) => (typeof v === "string" ? compactStableKey(v) : v), z.string().min(1).max(STABLE_KEY_MAX)).optional().catch(undefined),
  parent: id.optional().catch(undefined),
  // Anything but "analysis" or "plain" is simply neither: dropped, never a reason to reject the node.
  origin: z.enum(["analysis", "plain"]).optional().catch(undefined),
  // A card's architecture kind (Lens Phase 2); an unknown one is dropped, never the node.
  kind: z.enum(NODE_KINDS).optional().catch(undefined),
};

const nodeSchemas = {
  heading: z.object({ ...nodeCommon, type: z.literal("heading"), content: z.object({ text: z.string().min(1).max(TEXT_LIMITS.heading) }) }),
  text: z.object({ ...nodeCommon, type: z.literal("text"), content: z.object({ markdown: z.string().min(1).max(TEXT_LIMITS.markdown) }) }),
  todo: z.object({
    ...nodeCommon,
    type: z.literal("todo"),
    content: z.object({ items: z.array(z.object({ text: z.string().min(1).max(TEXT_LIMITS.todoItem), checked: z.boolean() })).max(TEXT_LIMITS.todoItems) }),
  }),
  table: z.object({
    ...nodeCommon,
    type: z.literal("table"),
    content: z.object({
      columns: z.array(z.string().max(TEXT_LIMITS.tableCell)).max(TEXT_LIMITS.tableColumns),
      rows: z.array(z.array(z.string().max(TEXT_LIMITS.tableCell)).max(TEXT_LIMITS.tableColumns)).max(TEXT_LIMITS.tableRows),
    }),
  }),
  code: z.object({
    ...nodeCommon,
    type: z.literal("code"),
    content: z.object({ language: z.string().max(TEXT_LIMITS.language).optional(), source: z.string().min(1).max(TEXT_LIMITS.codeSource) }),
  }),
  page: z.object({
    ...nodeCommon,
    type: z.literal("page"),
    content: z.object({ title: z.string().min(1).max(TEXT_LIMITS.title), markdown: z.string().max(TEXT_LIMITS.markdown) }),
  }),
  shape: z.object({
    ...nodeCommon,
    type: z.literal("shape"),
    content: z.object({ shape: z.enum(PLAN_SHAPES), label: z.string().min(1).max(TEXT_LIMITS.shapeLabel), ...nodeSemanticsFields }),
  }),
  image: z.object({
    ...nodeCommon,
    type: z.literal("image"),
    content: z.object({ assetRef: z.string().min(1).max(TEXT_LIMITS.assetRef), alt: z.string().max(TEXT_LIMITS.imageAlt).optional() }),
  }),
  group: z.object({
    ...nodeCommon,
    type: z.literal("group"),
    // An unknown or missing arrangement falls back to a grid rather than dropping the whole section.
    content: z.object({
      label: z.string().min(1).max(TEXT_LIMITS.groupLabel),
      arrangement: z.enum(GROUP_ARRANGEMENTS).catch("grid"),
      // A missing or unusable takeaway leaves the section without one; it never drops the section.
      takeaway: z.string().min(1).max(TEXT_LIMITS.takeaway).optional().catch(undefined),
      diagram: z.literal("architecture").optional().catch(undefined),
      cards: diagramCardsSchema,
      level: z.number().int().min(0).max(LENS_MAX_LEVEL).optional().catch(undefined),
    }),
  }),
} as const;

/** One node, any type — for per-node lenient parsing (`validate.ts`) and JSON Schema generation. */
export const visualNodeSchema = z.discriminatedUnion("type", [
  nodeSchemas.heading,
  nodeSchemas.text,
  nodeSchemas.todo,
  nodeSchemas.table,
  nodeSchemas.code,
  nodeSchemas.page,
  nodeSchemas.shape,
  nodeSchemas.image,
  nodeSchemas.group,
]);

export const visualRelationshipSchema = z.object({
  from: id,
  to: id,
  type: z.enum(RELATION_TYPES),
  label: z.string().max(TEXT_LIMITS.relationshipLabel).optional(),
  explanation: explanationSchema,
  confidence: confidenceSchema,
});

/**
 * The full envelope, strict (every node/relationship must parse). Used to
 * generate the JSON Schema sent to a provider as its structured-output
 * contract — never to validate a real plan end to end; `validate.ts` parses
 * `nodes`/`relationships` item by item so one bad entry doesn't sink the rest.
 */
export const visualPlanSchema = z.object({
  version: z.literal(1),
  template: z.enum(VISUAL_TEMPLATES),
  nodes: z.array(visualNodeSchema).max(1000),
  relationships: z.array(visualRelationshipSchema).max(1000),
  metadata: z
    .object({ title: z.string().max(TEXT_LIMITS.planTitle).optional(), summary: z.string().max(TEXT_LIMITS.planSummary).optional(), cards: diagramCardsSchema })
    .optional(),
});

let cachedJsonSchema: unknown;

/** The JSON Schema for `VisualPlan`, for a provider's structured-output request. Computed once. */
export function visualPlanJsonSchema(): unknown {
  cachedJsonSchema ??= z.toJSONSchema(visualPlanSchema);
  return cachedJsonSchema;
}

/**
 * Loosest possible check that `input` is shaped like a plan at all, before any
 * per-item work. `nodes` must be an array — with nothing to render, the plan
 * is unusable outright — but `relationships` and `metadata` are secondary, so
 * a wrong shape there is left to `validate.ts` to drop leniently instead of
 * failing the whole plan.
 */
export const planEnvelopeSchema = z.object({
  version: z.literal(1),
  template: z.enum(VISUAL_TEMPLATES),
  nodes: z.array(z.unknown()),
  relationships: z.unknown().optional(),
  metadata: z.unknown().optional(),
});
