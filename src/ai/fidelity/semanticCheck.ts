/**
 * The model check of the meaning of cards (`.ai/docs/knowledge-notes-plan.md` §3.4, OD5): one batched request that
 * asks, per card, whether it is supported by the text it cites. Pure: builds the request text and parses the reply;
 * the caller sends it with whatever connection it has. Measured offline against the labelled paraphrase set before
 * anything relies on it (`meaning.model.eval.test.ts`, recordings in `__fixtures__/meaning/model-check/`).
 *
 * A verdict never marks a card verified (OD5): `supported` lets it leave Needs review as "checked by AI"; `partly`
 * and `not_supported` keep it there, with the reason.
 */

export type SemanticVerdict = "supported" | "partly" | "not_supported";

export interface SemanticCheckItem {
  /** Opaque per request ("c1", "c2"…): the reply is matched by it. */
  ref: string;
  /** The cited source text (one unit or several, joined). */
  source: string;
  /** The card's text (title and body). */
  card: string;
}

export interface SemanticCheckAnswer {
  ref: string;
  verdict: SemanticVerdict;
  /** The false or unsupported belief, in one sentence; empty for `supported`. */
  reason: string;
}

/** Bumped whenever the wording changes, so recordings say which prompt they measured. */
export const SEMANTIC_CHECK_PROMPT_VERSION = "1";

export const SEMANTIC_CHECK_SYSTEM = [
  "You check notes against their sources. For each item you get a SOURCE (what the author wrote) and a CARD (a note that restates it).",
  "Question: would a reader of the CARD alone come away believing something the SOURCE does not say?",
  "Answer per item with one verdict:",
  '- "supported": the card says what the source says, possibly shorter or in other words. Nothing it claims is stronger, wider, reversed or new.',
  '- "not_supported": you can name a false belief the card creates: a hedge removed (can/may/usually → certain), a condition, exception or scope dropped, widened or inverted, a negation lost or flipped, cause and effect swapped or reversed, a correlation or coincidence turned into a cause, a number, unit or limit changed (a limit "up to N" made exact, a range collapsed), a cost or caveat dropped or inverted, or an absolute added.',
  '- "partly": mostly right, but one detail a careful reader might care about is bent, and you cannot point to a clearly false claim.',
  "Rules: judge meaning, not style; the card stands alone; one false belief is enough. Hedges are equivalent within their class (can/may/might/could; usually/typically/generally). Numbers are equal across formats and units (2,000 = two thousand; 250 ms = 0.25 s; p99 = 99th percentile). A requirement for N means at least N unless an exact count is stated. Leaving out a detail that does not limit the claim is fine.",
  'Reply with JSON only: {"results":[{"ref":"c1","verdict":"supported|partly|not_supported","reason":"one sentence, empty when supported"}]} with one entry per item, in any order.',
].join("\n");

export function semanticCheckRequest(items: readonly SemanticCheckItem[]): string {
  return items.map((i) => `ITEM ${i.ref}\nSOURCE: ${i.source}\nCARD: ${i.card}`).join("\n\n");
}

const VERDICTS: readonly SemanticVerdict[] = ["supported", "partly", "not_supported"];

/**
 * The answers in a reply, lenient about fences and stray text around the JSON. An item missing from the reply, or
 * with an unknown verdict, gets no answer: the caller keeps that card in Needs review, never treats it as supported.
 */
export function parseSemanticCheckReply(reply: string, refs: readonly string[]): { answers: SemanticCheckAnswer[]; missing: string[] } {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  let results: unknown = [];
  if (start >= 0 && end > start) {
    try {
      results = (JSON.parse(reply.slice(start, end + 1)) as { results?: unknown }).results ?? [];
    } catch {
      results = [];
    }
  }
  const wanted = new Set(refs);
  const answers: SemanticCheckAnswer[] = [];
  for (const r of Array.isArray(results) ? results : []) {
    if (typeof r !== "object" || r === null) continue;
    const { ref, verdict, reason } = r as Record<string, unknown>;
    const v = typeof verdict === "string" ? verdict.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
    if (typeof ref !== "string" || !wanted.has(ref) || !VERDICTS.includes(v as SemanticVerdict)) continue;
    if (answers.some((a) => a.ref === ref)) continue;
    answers.push({ ref, verdict: v as SemanticVerdict, reason: typeof reason === "string" ? reason.trim() : "" });
  }
  return { answers, missing: refs.filter((ref) => !answers.some((a) => a.ref === ref)) };
}
