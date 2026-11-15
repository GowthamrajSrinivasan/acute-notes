/**
 * Section chips and bar totals in outcome words for a distil change set (knowledge-notes-plan §5.3, WP2.5): Lane H's
 * `sectionOutcomeChips` / `outcomeTotals` over the set's report v2 (`ChangeSet.knowledge.report`). Null for any other
 * set, so `SectionChips` and `CoverageRow` keep their wording ("AI placed N% · +N from source") for preserve exactly.
 */
import type { ChangeSet } from "@/ai/changes/changeSet";
import { outcomeTotals, sectionOutcomeChips, type OutcomeTotals, type SectionOutcomeChip } from "./sectionChips";

type Report = NonNullable<NonNullable<ChangeSet["knowledge"]>["report"]>;

const asSections = (report: Report) =>
  report.sections.map((s) => ({ topic: s.key, represented: s.represented, omitted: s.omitted, needsReview: s.needsReview, highOmittedShare: s.highOmittedShare }));

/** Chips by section label (frames are matched to sections by their title, as `sectionReviews` does). */
export function outcomeChipsOfSet(set: Pick<ChangeSet, "knowledge">): Map<string, SectionOutcomeChip> | null {
  const report = set.knowledge?.report;
  if (!report) return null;
  const labels = Object.fromEntries(report.sections.map((s) => [s.key, s.label]));
  return new Map(sectionOutcomeChips(asSections(report), labels).map((c) => [c.label ?? c.topic, c] as const));
}

/** The bar's totals in outcome words, with the model-tier warning when the model is a weak tier. */
export function outcomeTotalsOfSet(set: Pick<ChangeSet, "knowledge">, options: { weakModel?: boolean } = {}): OutcomeTotals | null {
  const report = set.knowledge?.report;
  return report ? outcomeTotals(asSections(report), options) : null;
}
