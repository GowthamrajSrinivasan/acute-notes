/**
 * The content fidelity report of an AI Visualize run (content fidelity plan): per section, how many source points
 * (sentences, list items, table rows, code blocks) the AI's plan placed itself, how many the safety net added from
 * the source, and which key terms (numbers, paths, identifiers) the AI left out. Carried on the change set for the
 * review's coverage row; built from `attachUncovered`'s counts, so it costs no extra model call.
 */
import { z } from "zod";
import { FIDELITY_CONFIG, type FidelityConfig } from "@/config/fidelity";
import type { SectionCoverage } from "./safetyNet";

export interface FidelitySection {
  /** The section's key (its units' keys joined): what "Regenerate" asks for. */
  key: string;
  label: string;
  /** Source points in the section. */
  units: number;
  /** Placed by the AI's own plan. */
  placedByAI: number;
  /** Added from the source by the safety net (the AI left them out). */
  addedFromSource: number;
  /** The added points' text, in source order. */
  added: string[];
  keyTerms: { total: number; placedByAI: number; missing: string[] };
}

export interface FidelityReport {
  units: number;
  placedByAI: number;
  addedFromSource: number;
  /** Distinct terms across the document: one missed in a section but placed in another counts as placed. */
  keyTerms: { total: number; placedByAI: number; missing: string[] };
  sections: FidelitySection[];
}

export function sectionOf(key: string, label: string, coverage: SectionCoverage): FidelitySection & { terms: string[] } {
  return {
    terms: coverage.keyTerms.all,
    key,
    label,
    units: coverage.total,
    placedByAI: coverage.covered,
    addedFromSource: coverage.attached,
    added: coverage.added,
    keyTerms: { total: coverage.keyTerms.total, placedByAI: coverage.keyTerms.placedByAI, missing: coverage.keyTerms.missing },
  };
}

export function buildReport(sections: readonly (FidelitySection & { terms?: readonly string[] })[]): FidelityReport {
  const sum = (f: (s: FidelitySection) => number) => sections.reduce((n, s) => n + f(s), 0);
  // Distinct terms: a term the AI missed in one section but placed in another is placed.
  const missingIn = new Set(sections.flatMap((s) => s.keyTerms.missing));
  const placed = new Set(sections.flatMap((s) => (s.terms ?? []).filter((t) => !s.keyTerms.missing.includes(t))));
  const all = new Set([...sections.flatMap((s) => s.terms ?? []), ...missingIn]);
  const missing = [...missingIn].filter((t) => !placed.has(t));
  return {
    units: sum((s) => s.units),
    placedByAI: sum((s) => s.placedByAI),
    addedFromSource: sum((s) => s.addedFromSource),
    keyTerms: { total: all.size, placedByAI: all.size - missing.length, missing },
    sections: sections.map(({ terms: _terms, ...s }) => s),
  };
}

/**
 * Which of two coverages of the same section is better: > 0 when `a` is. The share of source points the AI placed
 * itself decides; key terms kept break a tie. (Used to keep the better reply when a section is regenerated.)
 */
export function compareCoverage(a: SectionCoverage, b: SectionCoverage): number {
  const share = (c: SectionCoverage) => (c.total ? c.covered / c.total : 1);
  const d = share(a) - share(b);
  if (Math.abs(d) > 1e-9) return d;
  return a.keyTerms.placedByAI - b.keyTerms.placedByAI;
}

/** A share as a whole percentage (100 for nothing to measure). */
export const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 100);

/**
 * The sections "Regenerate" is offered for, per `FIDELITY_CONFIG.regenerate`: none when it is disabled; else those
 * where the AI placed less than `whenAIPlacedBelow` of the points, or left out `whenKeyTermsMissingAtLeast` key terms.
 */
export function sectionsToRegenerate(report: FidelityReport, config: FidelityConfig["regenerate"] = FIDELITY_CONFIG.regenerate): FidelitySection[] {
  if (!config.enabled) return [];
  return report.sections.filter((s) => {
    const share = s.units ? s.placedByAI / s.units : 1;
    return (s.addedFromSource > 0 && share < config.whenAIPlacedBelow) || s.keyTerms.missing.length >= config.whenKeyTermsMissingAtLeast;
  });
}

const terms = z.object({ total: z.number().int().nonnegative(), placedByAI: z.number().int().nonnegative(), missing: z.array(z.string().max(300)).max(2_000) });

/** The report as a change set carries it (validated like the rest of the set). */
export const fidelityReportSchema = z.object({
  units: z.number().int().nonnegative(),
  placedByAI: z.number().int().nonnegative(),
  addedFromSource: z.number().int().nonnegative(),
  keyTerms: terms,
  sections: z
    .array(
      z.object({
        key: z.string().min(1).max(2_000),
        label: z.string().max(300),
        units: z.number().int().nonnegative(),
        placedByAI: z.number().int().nonnegative(),
        addedFromSource: z.number().int().nonnegative(),
        added: z.array(z.string().max(20_000)).max(2_000),
        keyTerms: terms,
      }),
    )
    .max(200),
});
