/**
 * The free fidelity check of generated notes (`.ai/docs/openui-live-2026-11-13.md`, "Step 1"): the cards
 * `generate_openui_notes` produced, checked against their source's units by distil Visualize's own deterministic checks
 * (`inspectSection`: protected details kept, conditions kept with their claim, citations related to the card, every
 * unit accounted for). Pure and instant; no model call. Like distil, a card is Needs review only for a deterministic
 * reason; the meaning rules' findings are hints (shown as detail, never a verdict).
 *
 * Wording follows the review UI: "needs review", never "verified" or "correct" — passing these checks means nothing
 * mechanical was found, not that the card is true.
 */
import type { CardReview, SourceUnit } from "@/ai/fidelity/contracts";
import { cardReviews, inspectSection, CITES, UNCITED } from "@/ai/fidelity/knowledgeCheck";
import type { GeneratedCard } from "./notesTask";

export interface NotesCheck {
  /** Per card key: its review, only for cards with a Needs review reason or hints. */
  reviews: Record<string, CardReview>;
  /** Cards with at least one Needs review reason. */
  cardsNeedingReview: number;
  /** Source units no card represents (neither cited cleanly nor omitted). */
  unitsNotCovered: number;
  /** Protected details (numbers, identifiers, paths…) missing from every card citing their unit. */
  detailsMissing: number;
  units: number;
}

/** Checks `cards` against the units they were generated from. Units outside `checkedUnits` (a truncated input) are ignored. */
export function checkGeneratedCards(cards: readonly Pick<GeneratedCard, "key" | "title" | "body" | "detail" | "cites">[], units: readonly SourceUnit[], checkedUnits?: ReadonlySet<string>): NotesCheck {
  const scope = checkedUnits ? units.filter((u) => checkedUnits.has(u.id)) : [...units];
  const raw = {
    nodes: cards.map((c) => ({
      id: c.key,
      type: "text",
      title: c.title,
      content: { markdown: [c.body, c.detail].filter(Boolean).join("\n\n") },
      ...(c.cites.length ? { [CITES]: [...c.cites] } : { [UNCITED]: true }),
    })),
  };
  const inspection = inspectSection(raw, scope, []);
  const reviews = cardReviews(inspection);
  const outcomes = Object.values(inspection.accounting.outcome);
  return {
    reviews,
    cardsNeedingReview: Object.values(reviews).filter((r) => r.reasons.length > 0).length,
    unitsNotCovered: outcomes.filter((o) => o !== "represented" && o !== "omitted").length,
    detailsMissing: inspection.exactMissing.length,
    units: scope.length,
  };
}
