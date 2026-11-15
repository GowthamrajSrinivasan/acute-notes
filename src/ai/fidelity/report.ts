/**
 * The content fidelity report of an AI Visualize run (content fidelity plan): per section, how many source points
 * (sentences, list items, table rows, code blocks) the AI's plan placed itself, how many the safety net added from
 * the source, and which key terms (numbers, paths, identifiers) the AI left out. Carried on the change set for the
 * review's coverage row; built from `attachUncovered`'s counts, so it costs no extra model call.
 */
import { z } from "zod";
import { FIDELITY_CONFIG, type FidelityConfig } from "@/config/fidelity";
import { FIDELITY_CUES } from "@/config/fidelityCues";
import type { AccountingResult, Lineage, ReviewCode } from "./contracts";
import type { SectionKnowledge } from "./knowledgeCheck";
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
    keyTerms: { total: coverage.keyTerms.total, placedByAI: coverage.keyTerms.placedByAI, missing: coverage.keyTerms.missing.slice(0, MAX_LISTED_TERMS) },
  };
}

/** The most missed key terms a report lists (its schema's bound); the counts stay exact. */
export const MAX_LISTED_TERMS = 2_000;

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
    keyTerms: { total: all.size, placedByAI: all.size - missing.length, missing: missing.slice(0, MAX_LISTED_TERMS) },
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

// ---------------------------------------------------------------- report v2: distil mode (knowledge-notes-plan §3.2, §5.3, WP1.11)

/** The three outcomes the reader sees (§3.2), as counts of units. */
export interface OutcomeCounts {
  represented: number;
  omitted: number;
  needsReview: number;
}

/** What a unit lineage did between two versions (§3.1), as counts. */
export interface LineageCounts {
  fromVersion: number;
  toVersion: number;
  unchanged: number;
  changed: number;
  moved: number;
  ambiguous: number;
  removed: number;
  added: number;
}

/**
 * The fidelity report of a distil run (report v2): units by outcome (Represented, Intentionally omitted, Needs review)
 * in the document and per section, the Needs review reasons by code, the cards in Needs review and those the model check
 * looked at ("checked by AI"), protected content the app put back, and, on an update, the unit lineage. Built from the
 * run's accounting, so it costs no model call. `preserve` runs keep `FidelityReport`.
 */
export interface KnowledgeReport {
  units: number;
  outcomes: OutcomeCounts;
  /**
   * Cards as the reader sees them: a shape with the text that explains it, or a label shape with the card covering its
   * units, is one card (`SectionKnowledge.cards`; plan §9 G1 counts cards, not nodes).
   */
  cards: {
    total: number;
    /** Cards with a Needs review reason on any of their nodes (never a hint alone: the meaning rules are hints only, WP1.10). */
    needsReview: number;
    /** Cards the model check answered "supported" ("checked by AI"; never "verified"). */
    checkedByAI: number;
    /** Cards the meaning rules hint about (shown as detail, not counted as Needs review). */
    hinted: number;
    /** Cards longer than the source passages they cite (`longer_than_source`, a hint only). */
    longerThanSource?: number;
  };
  /** Needs review reasons by code, most frequent first. */
  flags: { code: ReviewCode; count: number }[];
  /**
   * The model check's verdicts over the run (OD5b: every citing card in distil mode), when it ran: cards asked, and how
   * many it answered "supported", "partly", "not supported", or not at all. "Checked by AI", never "verified".
   */
  modelCheck?: { cards: number; supported: number; partly: number; notSupported: number; unanswered: number };
  sections: (OutcomeCounts & {
    key: string;
    label: string;
    /** OD4's secondary signal: a high share of the section's units omitted. */
    highOmittedShare: boolean;
    pending?: true;
    retry?: { kind: "patch" | "full"; kept: boolean };
    /** The reply's citation problems (`readDistilReply`): the section went to Needs review for them. */
    problems: number;
  })[];
  /**
   * Content put back on the canvas: exact items as "From the source" lines and omitted protected units (§3.3), and
   * dropped conditions, caveats and requirements as "Limit:" lines (`limits`, units).
   */
  restored: { items: number; units: number; limits?: number };
  /** Citations of nodes the validated plan folded away that found no node to go to (expected 0). */
  lostCitations: number;
  lineage?: LineageCounts;
}

/** A lineage's counts (§3.1): moves are counted among unchanged and changed units too. */
export function lineageCounts(lineage: Lineage): LineageCounts {
  const count = (state: string) => lineage.entries.filter((e) => e.state === state).length;
  return {
    fromVersion: lineage.fromVersion,
    toVersion: lineage.toVersion,
    unchanged: count("unchanged"),
    changed: count("changed"),
    moved: lineage.entries.filter((e) => e.moved).length,
    ambiguous: count("ambiguous"),
    removed: count("removed"),
    added: count("added"),
  };
}

export function buildKnowledgeReport(input: {
  sections: readonly (SectionKnowledge & { key: string; label: string })[];
  accounting: AccountingResult;
  lineage?: Lineage;
  lostCitations?: number;
}): KnowledgeReport {
  const { accounting } = input;
  const outcomesOf = (ids: readonly string[]): OutcomeCounts => {
    const c: OutcomeCounts = { represented: 0, omitted: 0, needsReview: 0 };
    for (const id of ids) {
      const o = accounting.outcome[id];
      if (o === "represented") c.represented++;
      else if (o === "omitted") c.omitted++;
      else if (o === "needs_review") c.needsReview++;
    }
    return c;
  };
  const units = Object.keys(accounting.outcome);
  const byCode = new Map<ReviewCode, number>();
  for (const f of accounting.flags) byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
  // A card of several nodes counts once (plan §9 G1): each node → its card's first node.
  const headOf = new Map(input.sections.flatMap((s) => (s.cards ?? []).flatMap((members) => members.map((m) => [m, members[0]!] as const))));
  const head = (id: string) => headOf.get(id) ?? id;
  const byCard = new Map<string, SectionKnowledge["reviews"][string][]>();
  for (const s of input.sections) for (const [id, r] of Object.entries(s.reviews)) byCard.set(head(id), [...(byCard.get(head(id)) ?? []), r]);
  const reviews = [...byCard.values()];
  const checks = input.sections.flatMap((s) => (s.checked ? [s.checked] : []));
  const sum = (k: keyof NonNullable<SectionKnowledge["checked"]>) => checks.reduce((n, c) => n + c[k], 0);
  const hintedBy = (keep: (code: string) => boolean) => new Set(input.sections.flatMap((s) => s.hints.flatMap((h) => (h.card && keep(h.code) ? [head(h.card)] : [])))).size;
  const longer = hintedBy((c) => c === "longer_than_source");
  return {
    units: units.length,
    outcomes: outcomesOf(units),
    cards: {
      total: new Set(input.sections.flatMap((s) => s.ideas.map((i) => head(i.id)))).size,
      needsReview: reviews.filter((rs) => rs.some((r) => r.reasons.length > 0 && !r.resolved)).length,
      checkedByAI: reviews.filter((rs) => rs.some((r) => r.checked?.verdict === "supported")).length,
      hinted: hintedBy((c) => c !== "longer_than_source"),
      ...(longer ? { longerThanSource: longer } : {}),
    },
    flags: [...byCode].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    ...(checks.length ? { modelCheck: { cards: sum("cards"), supported: sum("supported"), partly: sum("partly"), notSupported: sum("notSupported"), unanswered: sum("unanswered") } } : {}),
    sections: input.sections.map((s) => {
      const counts = outcomesOf(s.units);
      const total = counts.represented + counts.omitted + counts.needsReview;
      return {
        key: s.key,
        label: s.label,
        ...counts,
        highOmittedShare: total > 0 && counts.omitted / total >= FIDELITY_CUES.highOmittedShare,
        ...(s.pending ? { pending: true as const } : {}),
        ...(s.retry ? { retry: s.retry } : {}),
        problems: s.problems.length,
      };
    }),
    restored: {
      items: input.sections.reduce((n, s) => n + s.restored.items.length, 0),
      units: input.sections.reduce((n, s) => n + s.restored.units.length, 0),
      ...(input.sections.some((s) => s.restored.limits?.length) ? { limits: input.sections.reduce((n, s) => n + (s.restored.limits?.length ?? 0), 0) } : {}),
    },
    lostCitations: input.lostCitations ?? 0,
    ...(input.lineage ? { lineage: lineageCounts(input.lineage) } : {}),
  };
}

const counts = { represented: z.number().int().nonnegative(), omitted: z.number().int().nonnegative(), needsReview: z.number().int().nonnegative() };
const count = z.number().int().nonnegative();

/** Report v2 as a change set carries it (validated like the rest of the set). */
export const knowledgeReportSchema = z.object({
  units: count,
  outcomes: z.object(counts),
  cards: z.object({ total: count, needsReview: count, checkedByAI: count, hinted: count, longerThanSource: count.optional() }),
  flags: z.array(z.object({ code: z.string().min(1).max(60) as unknown as z.ZodType<ReviewCode>, count })).max(50),
  modelCheck: z.object({ cards: count, supported: count, partly: count, notSupported: count, unanswered: count }).optional(),
  sections: z
    .array(
      z.object({
        key: z.string().min(1).max(2_000),
        label: z.string().max(300),
        ...counts,
        highOmittedShare: z.boolean(),
        pending: z.literal(true).optional(),
        retry: z.object({ kind: z.enum(["patch", "full"]), kept: z.boolean() }).optional(),
        problems: count,
      }),
    )
    .max(200),
  restored: z.object({ items: count, units: count, limits: count.optional() }),
  lostCitations: count,
  lineage: z.object({ fromVersion: count, toVersion: count, unchanged: count, changed: count, moved: count, ambiguous: count, removed: count, added: count }).optional(),
});

