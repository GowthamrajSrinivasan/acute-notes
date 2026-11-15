/**
 * Phase 2: does a node's visible text convey a condition? An offline extension of the existing representation check
 * (`src/ai/fidelity/representation.ts`: `criticalClausesOf` + `cardKeepsClause`, a significant-word overlap). That check is
 * reused unchanged; this adds what it can't do, for the claim–condition prototype only:
 *  - **quantities by value** (`quantitiesOf` / `sameQuantity`): "60 seconds" = "one minute" = "60 s";
 *  - **polarity**: a negated condition ("does not help", "cannot be shortened") is only conveyed by a negated card;
 *  - **restrictive operators as classes**, so a paraphrase keeps the kind of limit ("at most" ~ "maximum" ~ "no more than";
 *    "only" ~ "as long as" ~ "while"; "unless" ~ "except" ~ "rather than");
 *  - **conditions in other sentences**: the condition is the condition unit's clause (or the unit), not the claim's.
 *
 * Citations are never read here: whether a node conveys a condition is decided by its visible text alone (the user's
 * architectural requirement, 2026-11-13).
 */
import { plainText } from "@/ai/fidelity/exactness";
import { significant } from "@/ai/fidelity/information";
import { stem } from "@/ai/fidelity/meaning";
import { normalizeQuantities, quantitiesOf, sameQuantity, type Quantity } from "@/ai/fidelity/quantities";
import { criticalClausesOf } from "@/ai/fidelity/representation";

const stemOf = (w: string) => stem(w).replace(/([b-df-hj-np-tv-z])\1$/, "$1");
export function stemsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of significant(normalizeQuantities(plainText(text)))) {
    out.add(stemOf(w));
    if (w.includes("-")) for (const part of significant(w.replace(/-/g, " "))) out.add(stemOf(part));
  }
  return out;
}
const overlapShare = (need: ReadonlySet<string>, have: ReadonlySet<string>) => (need.size ? [...need].filter((x) => have.has(x)).length / need.size : 1);

/** Operator classes (whole words / phrases, lower case). */
const OPS = {
  neg: ["not", "no", "never", "cannot", "can't", "don't", "doesn't", "won't", "isn't", "aren't", "wasn't", "without", "nothing", "none", "nor", "neither", "fails to", "unable"],
  restrict: [
    "at most", "up to", "no more than", "maximum", "max", "cap", "capped", "limit", "limited", "within", "under", "below", "not exceed", "bounded",
    "at least", "minimum", "no less than",
    "only", "just", "solely", "exclusively",
    "if", "when", "whenever", "provided", "as long as", "while", "so long as",
    "unless", "except", "other than", "rather than", "apart from", "excluding", "reject", "refuse",
    "until", "after", "before", "expire", "expires", "expiry", "window", "once",
    "must", "need", "needs", "require", "requires", "required", "have to", "has to", "should",
  ],
};
const hasOp = (text: string, ops: readonly string[]) => ops.some((o) => new RegExp(`(?<![\\p{L}])${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu").test(text) || (o === "not" && /n't\b/i.test(text)));

export interface ConditionSignature {
  /** The condition's words, as the source has them (clause or unit). */
  text: string;
  quantities: Quantity[];
  stems: Set<string>;
  negated: boolean;
  restrictive: boolean;
}

/**
 * What a carrier must convey for a condition. Intra-unit (claim and condition the same unit): the unit's critical clauses
 * (`criticalClausesOf`), else the unit. Cross-unit: the condition unit's text without its leading discourse marker.
 */
export function signatureOf(conditionTexts: readonly string[], intra: boolean): ConditionSignature {
  const joined = conditionTexts.join(" ");
  let text = joined;
  if (intra) {
    const clauses = conditionTexts.flatMap((t) => criticalClausesOf(t));
    if (clauses.length) text = clauses.map((c) => `${c.marker} ${c.clause}`).join(" ; ");
  }
  const plain = plainText(text).replace(/^\s*(but|however|also|and|so|still|in short|note that)[,:]?\s+/i, "");
  return { text: plain, quantities: quantitiesOf(plain), stems: stemsOf(plain), negated: hasOp(plain, OPS.neg), restrictive: hasOp(plain, OPS.restrict) };
}

export interface ClauseOptions {
  /** Share of the condition's significant words a carrier needs when the condition has no quantity. */
  overlap: number;
  /** …and when it has quantities (which then must all be present). */
  overlapWithQuantities: number;
}
export const DEFAULT_CLAUSE_OPTIONS: ClauseOptions = { overlap: 0.5, overlapWithQuantities: 0.25 };

/** Whether `nodeText` (visible text only) conveys the condition. */
export function conveys(nodeText: string, sig: ConditionSignature, options: ClauseOptions = DEFAULT_CLAUSE_OPTIONS): boolean {
  const text = plainText(nodeText);
  const stems = stemsOf(text);
  if (sig.quantities.length) {
    const have = quantitiesOf(text);
    if (!sig.quantities.every((q) => have.some((h) => sameQuantity(q, h)))) return false;
    return overlapShare(sig.stems, stems) >= options.overlapWithQuantities;
  }
  if (sig.negated && !hasOp(text, OPS.neg)) return false;
  if (sig.restrictive && !sig.negated && !hasOp(text, OPS.restrict)) return false;
  return overlapShare(sig.stems, stems) >= options.overlap;
}
