"use client";

/**
 * Outcome words for a section chip and the review bar's totals (knowledge-notes-plan §5.3, WP2.5; Lane H). The
 * integrator swaps them in for "AI placed N% · +N from source" in `SectionChips.tsx` and `CoverageRow.tsx`, which keep
 * their positioning and actions. Pure wording in `sectionChips.ts`.
 */
import type { SectionOutcomeChip, OutcomeTotals } from "./sectionChips";
import type { OutcomeCounts } from "./wording";
import "./review.css";

function Counts({ c }: { c: OutcomeCounts }) {
  return (
    <>
      <span>{c.represented} represented</span>
      {c.omitted > 0 && <span className="acute-kn-counts__omitted"> · {c.omitted} omitted</span>}
      {c.needsReview > 0 && (
        <span className="acute-kn-counts__review">
          {" "}
          · {c.needsReview} need{c.needsReview === 1 ? "s" : ""} review
        </span>
      )}
    </>
  );
}

/** One section's counts, toned like the existing section chips (warning amber, note muted). */
export function SectionOutcome({ chip }: { chip: SectionOutcomeChip }) {
  return (
    <span
      className={`acute-kn-counts acute-kn-counts--${chip.tone}`}
      role="note"
      aria-label={`${chip.label ? `Section ${chip.label}: ` : ""}${chip.text}`}
      title={[chip.text, ...chip.detail].join("\n")}
    >
      <Counts c={chip} />
    </span>
  );
}

/** The bar's totals, with the model-tier warning under them when there is one. */
export function OutcomeSummary({ totals }: { totals: OutcomeTotals }) {
  return (
    <span className="acute-kn-totals" role="status" aria-label={totals.text}>
      <span className={`acute-kn-counts acute-kn-counts--${totals.needsReview ? "warning" : "ok"}`}>
        <Counts c={totals} />
      </span>
      {totals.warning && <span className="acute-kn-totals__warning">{totals.warning}</span>}
    </span>
  );
}
