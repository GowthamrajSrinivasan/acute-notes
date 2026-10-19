/**
 * Validation for interactive diagram semantics arriving from untrusted input (a VisualPlan from AI or MCP, a change
 * set). Lenient per field, like the rest of the plan schema: a bad kind or an over-long sublabel drops that one
 * field, never the node or relationship it's on. The shapes match `diagram.ts`, which normalises them on write.
 */
import { z } from "zod";
import { NODE_KINDS } from "./diagram";

export const DIAGRAM_LIMITS = {
  sublabel: 200,
  tag: 80,
  detail: 200,
  details: 8,
  explanation: 300,
  cardTitle: 120,
  cardItem: 200,
  cardItems: 8,
  cards: 6,
} as const;

const optionalText = (max: number) => z.string().trim().min(1).max(max).optional().catch(undefined);

export const nodeKindSchema = z.enum(NODE_KINDS).optional().catch(undefined);

/** A shape's semantic fields (sit beside `shape` and `label` in a plan's shape content). */
export const nodeSemanticsFields = {
  kind: nodeKindSchema,
  sublabel: optionalText(DIAGRAM_LIMITS.sublabel),
  tag: optionalText(DIAGRAM_LIMITS.tag),
  details: z.array(z.string().trim().min(1).max(DIAGRAM_LIMITS.detail)).max(DIAGRAM_LIMITS.details).optional().catch(undefined),
};

export const nodeSemanticsSchema = z.object(nodeSemanticsFields);

export const explanationSchema = optionalText(DIAGRAM_LIMITS.explanation);
/** How sure a model was that a link exists (0–1, Lens plan §6.3); dropped, not refused, when out of range. */
export const confidenceSchema = z.number().min(0).max(1).optional().catch(undefined);

export const diagramCardSchema = z.object({
  kind: nodeKindSchema,
  title: z.string().trim().min(1).max(DIAGRAM_LIMITS.cardTitle),
  items: z.array(z.string().trim().min(1).max(DIAGRAM_LIMITS.cardItem)).max(DIAGRAM_LIMITS.cardItems),
});

/** A frame's info cards: an unusable list is dropped whole, never the frame it's on. */
export const diagramCardsSchema = z.array(diagramCardSchema).max(DIAGRAM_LIMITS.cards).optional().catch(undefined);
