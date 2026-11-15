// Experimental annotation schema v3.1 draft: bounded multiple claim links (user decision 2026-11-14, §2).
// Evaluation-only. Not imported by production code; does not change domain types, AIMetadata or the update engine.
// Snapshot v3 stays as frozen (one link per record). A future v3.1 dataset would be built from it by documented
// migration with new hashes, never by editing v3.

export type Verdict = "claim" | "set" | "ambiguous" | "not_a_condition";

export interface ClaimLink {
  /** `local`: the claim in the clause's own sentence or immediate passage; `section`: a broader section-level claim. */
  level: "local" | "section";
  units: string[];
  /** Exact quote of the claim. */
  claimQuote: string;
  /** Exact source span that shows the clause limits this claim (positive evidence; required for a `section` link). */
  evidence: string;
  /** Why the clause materially limits this claim. */
  justification: string;
  /** Binding is per link: the clause can be `claim`-bound to its sentence but only `set`-bound to the section claim. */
  binding: Exclude<Verdict, "not_a_condition">;
}

export interface ClauseRecordV31 {
  id: string;
  units: string[];
  clause: string;
  verdict: Verdict; // The strongest binding over its links (claim > ambiguous > set), or not_a_condition.
  links: ClaimLink[]; // 0 for not_a_condition, else 1 or 2.
  /**
   * Presentation is decided separately from attachment. `one_carrier` (default): a single visible carrier of the clause
   * satisfies every claim-bound link whose claim cards it reaches; counted once, so no duplicate warnings.
   * `per_link`: each claim-bound link needs the condition visible on its own claim card (only when the two claims are
   * presented on different cards and a reader of either would act wrongly without it).
   */
  presentation: "one_carrier" | "per_link";
  /** For ambiguous: the competing readings stay; a second link is never added to dissolve a disagreement. */
  readingA?: string;
  readingB?: string;
  decidingQuestion?: string;
  confidence: "high" | "medium" | "low";
}

const RANK: Record<string, number> = { claim: 3, ambiguous: 2, set: 1 };

export function validateClauseRecordV31(r: ClauseRecordV31): string[] {
  const errs: string[] = [];
  if (r.verdict === "not_a_condition") {
    if (r.links.length) errs.push("not_a_condition has no links");
    return errs;
  }
  if (r.links.length < 1 || r.links.length > 2) errs.push("1 or 2 links");
  const [a, b] = r.links;
  if (a && b) {
    if (a.level === b.level) errs.push("two links must be one local and one section");
    if (a.units.some((u) => b.units.includes(u))) errs.push("two links must name different claims");
  }
  for (const l of r.links) {
    if (!l.claimQuote.trim()) errs.push("link needs claimQuote");
    if (l.level === "section" && !l.evidence.trim()) errs.push("section link needs positive source evidence");
    if (!l.justification.trim()) errs.push("link needs justification");
  }
  const strongest = r.links.reduce((m, l) => Math.max(m, RANK[l.binding] ?? 0), 0);
  if (r.links.length && RANK[r.verdict] !== strongest) errs.push("verdict must be the strongest link binding");
  if (r.verdict === "ambiguous" && !(r.readingA && r.readingB && r.decidingQuestion))
    errs.push("ambiguous keeps both readings and the deciding question");
  if (r.presentation === "per_link" && r.links.filter((l) => l.binding === "claim").length < 2)
    errs.push("per_link presentation only applies when both links are claim-bound");
  return errs;
}

/** Presentation obligations a note must meet for this record: one per record unless `per_link`. */
export function presentationObligations(r: ClauseRecordV31): { claimUnits: string[] }[] {
  const bound = r.links.filter((l) => l.binding === "claim");
  if (!bound.length) return [];
  return r.presentation === "per_link" ? bound.map((l) => ({ claimUnits: l.units })) : [{ claimUnits: bound.flatMap((l) => l.units) }];
}
