/**
 * Validation for interactive diagram semantics arriving from untrusted input (a VisualPlan from AI or MCP, a change
 * set). Lenient per field, like the rest of the plan schema: a bad kind drops that one field, never the node or
 * relationship it's on. A shape's text is never dropped for being long: an over-long sublabel or detail is shortened
 * (ending in "…"), and details past the limit are left off the list; `shapeTextLosses` says what that cost, so the
 * plan validator can report it and keep the full wording elsewhere. The shapes match `diagram.ts`, which normalises
 * them on write.
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

const ELLIPSIS = "…";

/** `text` cut to `max` characters, ending in "…" when it was longer (the plan repair's `clip`). */
export function clipDiagramText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}${ELLIPSIS}`;
}

/** Trimmed, shortened to `max`; absent when empty or not a string. */
const shortenedText = (max: number) =>
  z
    .preprocess((v) => (typeof v === "string" ? (v.trim() ? clipDiagramText(v.trim(), max) : undefined) : v), z.string().min(1).max(max).optional())
    .catch(undefined);

/** A shape's details: each shortened, empty and non-string items left out, at most `DIAGRAM_LIMITS.details`; absent when none is left. */
const shortenedList = z
  .preprocess((v) => {
    if (!Array.isArray(v)) return v;
    const items = v.flatMap((x) => (typeof x === "string" && x.trim() ? [clipDiagramText(x.trim(), DIAGRAM_LIMITS.detail)] : [])).slice(0, DIAGRAM_LIMITS.details);
    return items.length ? items : undefined;
  }, z.array(z.string().min(1).max(DIAGRAM_LIMITS.detail)).max(DIAGRAM_LIMITS.details).optional())
  .catch(undefined);

export const nodeKindSchema = z.enum(NODE_KINDS).optional().catch(undefined);

/** A shape's semantic fields (sit beside `shape` and `label` in a plan's shape content). */
export const nodeSemanticsFields = {
  kind: nodeKindSchema,
  sublabel: shortenedText(DIAGRAM_LIMITS.sublabel),
  tag: shortenedText(DIAGRAM_LIMITS.tag),
  details: shortenedList,
};

/**
 * What `nodeSemanticsFields` shortens or leaves out of a shape's `sublabel`, `tag` and `details` (raw content, before
 * parsing): one plain note per loss, in the plan repair's wording, and the full text of everything that didn't fit,
 * for keeping in a linked block. Empty when the text fits.
 */
export function shapeTextLosses(content: unknown): { notes: string[]; overflow: string[] } {
  const notes: string[] = [];
  const overflow: string[] = [];
  if (typeof content !== "object" || content === null) return { notes, overflow };
  const c = content as Record<string, unknown>;
  for (const field of ["sublabel", "tag"] as const) {
    const v = c[field];
    const max = DIAGRAM_LIMITS[field];
    if (typeof v === "string" && v.trim().length > max) {
      notes.push(`${field} over ${max} characters shortened`);
      overflow.push(v.trim());
    }
  }
  if (Array.isArray(c.details)) {
    const items = c.details.flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim()] : []));
    const kept = items.slice(0, DIAGRAM_LIMITS.details);
    const long = kept.filter((x) => x.length > DIAGRAM_LIMITS.detail);
    if (long.length) {
      notes.push(`${long.length === 1 ? "a detail" : `${long.length} details`} over ${DIAGRAM_LIMITS.detail} characters shortened`);
      overflow.push(...long);
    }
    const extra = items.slice(DIAGRAM_LIMITS.details);
    if (extra.length) {
      notes.push(`${extra.length === 1 ? "1 detail" : `${extra.length} details`} past ${DIAGRAM_LIMITS.details} left off the shape`);
      overflow.push(...extra);
    }
  }
  return { notes, overflow };
}

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
