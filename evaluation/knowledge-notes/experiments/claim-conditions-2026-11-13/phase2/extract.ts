/**
 * Phase 2: automatic extraction of claim–condition records from source units. Deterministic, no model call. Tuned on
 * the dev cases only (kn-01–kn-04, PROTOCOL.md "Split"); the final cases are scored with whatever this file says when
 * `FREEZE.json` records its hash.
 *
 * Two kinds:
 *  - intra-sentence: a unit with a critical clause (`criticalClausesOf`, the existing representation check's cues) is its
 *    own claim and condition;
 *  - cross-sentence: a unit that reads as a limit on something said elsewhere (a limitation/requirement/condition cue,
 *    plus a back-reference or a negated/restrictive verb) is attached to the unit it shares most significant words
 *    with, anywhere in the source.
 *
 * Binding: `set` when the condition reads as a cost, risk, estimate or note (the claim stays true); else `claim`.
 */
import type { SourceUnit } from "@/ai/fidelity/contracts";
import { criticalReasonsOf } from "@/ai/fidelity/accounting";
import { plainText } from "@/ai/fidelity/exactness";
import { criticalClausesOf } from "@/ai/fidelity/representation";
import { stemsOf } from "./clauseCheck";

export interface ExtractedRecord {
  id: string;
  claimUnits: string[];
  conditionUnits: string[];
  binding: "claim" | "set";
  why: string;
}

export interface ExtractOptions {
  /** Minimum shared significant words between a cross-sentence condition and its claim. */
  minLink: number;
  /** Also emit intra-sentence records for "caveat" clauses (but/however/does not…). */
  intraCaveats: boolean;
}
export const DEFAULT_EXTRACT: ExtractOptions = { minLink: 2, intraCaveats: false };

const SET_WORDS = /\b(cost|costs|risk|risks|load|slower|expensive|estimate|estimated|may|might|could|assum\w*|note|trade-?off|price|budget|rate limit\w*|tbd|unknown|not (yet )?(measured|tested|estimated))\b/i;
const BACKREF = /^\s*(but|however|this|that|these|those|it|they|neither|both|also|so|still|otherwise|if you do|in that case|until then|after that)\b/i;
const LIMIT_VERB = /\b(only|does not|doesn't|do not|don't|cannot|can't|is not|isn't|are not|aren't|never|must|unless|except|at most|at least|no more than|until|rather than|not (a|an|the)\b)/i;
/** A unit that is a heading, a command, a list lead-in or a sign-off: never a claim or condition. */
/** Restrictive phrasing the existing cue lists don't have (dev, 2026-11-13: "rather than a fresh build", "once, from a single job", "before step 5"). */
const RESTRICT = /\b(only|rather than|instead of|once|before|after|until|within|at most|at least|no more than|unless|except|if|when|whenever|while|as long as)\b/i;
const TRIVIAL = (t: string) => t.length < 25 || /:\s*$/.test(t) || /^\s*(thanks|thank you|happy|that's all|hope)/i.test(t);

export function extractRecords(units: readonly SourceUnit[], options: ExtractOptions = DEFAULT_EXTRACT): ExtractedRecord[] {
  const out: ExtractedRecord[] = [];
  const stems = new Map(units.map((u) => [u.id, stemsOf(u.text)]));
  const add = (r: Omit<ExtractedRecord, "id">) => out.push({ id: `x${out.length + 1}`, ...r });
  for (const [i, u] of units.entries()) {
    const text = plainText(u.text);
    if (TRIVIAL(text)) continue;
    const reasons = criticalReasonsOf(u, {});
    const restrictive = RESTRICT.test(text);
    if (!restrictive && !reasons.some((r) => r === "limitation" || r === "requirement" || r === "condition")) continue;
    const clauses = criticalClausesOf(u.text).filter((c) => options.intraCaveats || c.kind !== "caveat");
    const backref = BACKREF.test(text);
    // Cross-sentence: a back-reference, or a standalone limit (a limit verb with no clause of its own to qualify).
    if (backref || (LIMIT_VERB.test(text) && !clauses.some((c) => c.kind === "condition"))) {
      const mine = stems.get(u.id)!;
      let best: SourceUnit | undefined;
      let bestScore = 0;
      for (const [j, v] of units.entries()) {
        if (j === i || TRIVIAL(plainText(v.text))) continue;
        const shared = [...mine].filter((s) => stems.get(v.id)!.has(s)).length;
        // Prefer the nearer unit on a tie; a back-reference prefers earlier units.
        const score = shared + (backref && j < i ? 0.5 : 0) - Math.abs(i - j) * 0.01;
        if (shared >= options.minLink && score > bestScore) {
          best = v;
          bestScore = score;
        }
      }
      if (best) add({ claimUnits: [best.id], conditionUnits: [u.id], binding: SET_WORDS.test(text) ? "set" : "claim", why: `cross: ${backref ? "back-reference" : "limit verb"}, ${Math.floor(bestScore)} shared words` });
    }
    // Intra-sentence as well (a unit can limit another and carry its own clause).
    if (clauses.length || restrictive) {
      add({ claimUnits: [u.id], conditionUnits: [u.id], binding: (clauses.length && clauses.every((c) => c.kind === "caveat")) || SET_WORDS.test(text) ? "set" : "claim", why: `intra: ${clauses.map((c) => c.marker).join(", ") || "restrictive phrase"}` });
    }
  }
  return out;
}

/** One-to-one matching of extracted to reviewed records: condition units overlap AND claim units overlap. */
export function matchRecords<A extends { claimUnits: string[]; conditionUnits: string[] }, B extends { claimUnits: string[]; conditionUnits: string[] }>(extracted: readonly A[], reviewed: readonly B[]) {
  const used = new Set<number>();
  const pairs: { x: A; r: B }[] = [];
  for (const r of reviewed) {
    const j = extracted.findIndex((x, k) => !used.has(k) && x.conditionUnits.some((u) => r.conditionUnits.includes(u)) && x.claimUnits.some((u) => r.claimUnits.includes(u)));
    if (j >= 0) {
      used.add(j);
      pairs.push({ x: extracted[j]!, r });
    }
  }
  return { pairs, unmatchedReviewed: reviewed.filter((r) => !pairs.some((p) => p.r === r)), unmatchedExtracted: extracted.filter((_, k) => !used.has(k)) };
}
