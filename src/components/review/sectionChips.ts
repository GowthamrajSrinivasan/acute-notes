/**
 * Section chips and bar totals in outcome words (knowledge-notes-plan §5.3, WP2.5; Lane H): instead of "AI placed N% ·
 * +N from source", a section reads "38 represented · 3 omitted · 1 needs review". Pure, from the accounting's
 * per-topic counts (`AccountingResult.sections`); the integrator matches topics to frames and draws the chip.
 */
import type { AccountingResult } from "@/ai/fidelity/contracts";
import { outcomeCountsText, WEAK_MODEL_WARNING, type OutcomeCounts } from "./wording";

/** Same tones as `fidelity/sectionReview.ts`: warning is amber (look at this), note is muted. */
export type OutcomeTone = "warning" | "note" | "ok";

export interface SectionOutcomeChip extends OutcomeCounts {
  topic: string;
  /** The section's heading, when the caller gave one. */
  label?: string;
  tone: OutcomeTone;
  text: string;
  /** More, for the tooltip. */
  detail: string[];
}

type Section = AccountingResult["sections"][number];

export const HIGH_OMITTED_NOTE = "Much of this section was left out. Check the omitted passages in the source.";

/** One chip per section with units. `labels`: topic → heading. A section with no units gets no chip. */
export function sectionOutcomeChips(sections: readonly Section[], labels: Readonly<Record<string, string>> = {}): SectionOutcomeChip[] {
  return sections.flatMap((s): SectionOutcomeChip[] => {
    if (s.represented + s.omitted + s.needsReview === 0) return [];
    const detail: string[] = [];
    if (s.needsReview) detail.push(`${s.needsReview} ${s.needsReview === 1 ? "passage needs" : "passages need"} review. Open "Review" to step through them.`);
    if (s.highOmittedShare) detail.push(HIGH_OMITTED_NOTE);
    const tone: OutcomeTone = s.needsReview ? "warning" : s.highOmittedShare ? "note" : "ok";
    const label = labels[s.topic];
    return [{ topic: s.topic, ...(label ? { label } : {}), represented: s.represented, omitted: s.omitted, needsReview: s.needsReview, tone, text: outcomeCountsText(s), detail }];
  });
}

export interface OutcomeTotals extends OutcomeCounts {
  text: string;
  /** The model-tier warning, when the caller says the model is a weak tier. */
  warning?: string;
}

/** The bar totals: the sections summed, in the same words. */
export function outcomeTotals(sections: readonly Section[], options: { weakModel?: boolean } = {}): OutcomeTotals {
  const c = sections.reduce<OutcomeCounts>((t, s) => ({ represented: t.represented + s.represented, omitted: t.omitted + s.omitted, needsReview: t.needsReview + s.needsReview }), {
    represented: 0,
    omitted: 0,
    needsReview: 0,
  });
  return { ...c, text: outcomeCountsText(c), ...(options.weakModel ? { warning: WEAK_MODEL_WARNING } : {}) };
}
