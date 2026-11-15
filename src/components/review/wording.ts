/**
 * The words review shows (knowledge-notes-plan §3.2, §5.3; Lane H): one short label per `ReviewCode`, the reason line
 * the queue and chips show, and counts in the three outcome words. Pure; the same words everywhere.
 */
import type { CardReview, ReviewCode, ReviewFlag, UnitOutcome } from "@/ai/fidelity/contracts";

export const OUTCOME_LABEL: Readonly<Record<UnitOutcome, string>> = {
  represented: "Represented",
  omitted: "Intentionally omitted",
  needs_review: "Needs review",
};

/** Short, lowercase: it starts the reason line ("condition changed: source says …"). */
export const REVIEW_CODE_LABEL: Readonly<Record<ReviewCode, string>> = {
  critical_omitted: "important point left out",
  duplicate_of_uncited: "left out as a repeat",
  unaccounted: "not accounted for",
  pending: "not processed",
  uncited_card: "no passage cited",
  exact_missing: "exact detail missing",
  named_term_changed: "name changed",
  qualifier_dropped: "qualifier dropped",
  caveat_dropped: "caveat dropped",
  condition_changed: "condition changed",
  cause_changed: "cause changed",
  absolute_added: "made absolute",
  negation_flip: "meaning reversed",
  unsupported_number: "number not in the source",
  citation_unrelated: "passage doesn't match the card",
  critical_dropped: "limit left off the card",
  // The model check's details already start "checked by AI: …", so the label isn't repeated.
  ai_check: "checked by AI",
  // A hint only (never Needs review): shown as a review's detail.
  longer_than_source: "longer than its source",
  source_changed: "source changed",
  source_ambiguous: "source passage unclear",
};

/** The model-tier warning, in outcome words (§5.3). */
export const WEAK_MODEL_WARNING = "This model may drop conditions; check the items that need review.";

/** "condition changed: source says "…"". The detail is the checker's plain words; the label leads unless it already does. */
export function reasonText(flag: Pick<ReviewFlag, "code" | "detail">): string {
  const label = REVIEW_CODE_LABEL[flag.code] ?? flag.code.replace(/_/g, " ");
  const detail = flag.detail.trim();
  if (!detail) return label;
  return detail.toLowerCase().startsWith(label.toLowerCase()) ? detail : `${label}: ${detail}`;
}

/** `AIMetadata.review` for a card from its flags: the reason lines, deduplicated, in order. Undefined when none. */
export function cardReviewOf(flags: readonly ReviewFlag[]): CardReview | undefined {
  const reasons = [...new Set(flags.map(reasonText))];
  return reasons.length ? { reasons } : undefined;
}

/** True while a card has reasons the user hasn't resolved: amber, and in the queue. */
export function isOpenReview(review: CardReview | undefined): boolean {
  return !!review && review.reasons.length > 0 && !review.resolved;
}

export interface OutcomeCounts {
  represented: number;
  omitted: number;
  needsReview: number;
}

/** "38 represented · 3 omitted · 1 needs review": Represented always, the others when not zero. */
export function outcomeCountsText(c: OutcomeCounts): string {
  const parts = [`${c.represented} represented`];
  if (c.omitted) parts.push(`${c.omitted} omitted`);
  if (c.needsReview) parts.push(`${c.needsReview} need${c.needsReview === 1 ? "s" : ""} review`);
  return parts.join(" · ");
}
