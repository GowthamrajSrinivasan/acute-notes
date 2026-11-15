/**
 * Update-intent classification (intelligent-update-engine-plan Stage 1a, reviewer refinement A): what a change to one
 * claim *means* — decided before an edit operation is chosen, and kept separate from it. Detecting a contradiction
 * never implies an overwrite: the planner escalates it instead.
 *
 * - `DUPLICATE`: the claim says the same as before (no change).
 * - `NEW`: there was no claim before.
 * - `EXTENDS`: the claim keeps every significant word and every quantity it had, and adds more.
 * - `SUPERSEDES`: the same claim with a value or term replaced (a quantity changed, or most words kept).
 * - `CONTRADICTS`: the claim now says the opposite — a negation flip, or something moving the opposite way.
 * - `UNCLEAR`: too little is kept to tell (a rewrite), or the claim is gone.
 *
 * A deterministic pre-pass (the plan's open question: deterministic, LLM or hybrid). It reuses the meaning rules
 * (`fidelity/meaning.ts`) for contradictions and `fidelity/quantities.ts` for values, so the same English cue words
 * decide both; an LLM step can later refine `UNCLEAR` without changing this contract.
 */
import type { UpdateIntent } from "@/ai/changes/claimPatch";
import type { SourceUnit } from "@/ai/fidelity/contracts";
import { normalizeForCompare, plainText } from "@/ai/fidelity/exactness";
import { significant } from "@/ai/fidelity/information";
import { checkMeaning } from "@/ai/fidelity/meaning";
import { quantitiesOf, sameQuantity } from "@/ai/fidelity/quantities";
import { wordOverlap } from "@/ai/fidelity/sourceUnits";

export interface IntentVerdict {
  intent: UpdateIntent;
  /** Why, in a line the review can show. */
  detail: string;
}

/** Below this share of significant words kept (and no quantity to explain the change), a changed claim is `UNCLEAR`. */
export const SUPERSEDE_OVERLAP = 0.5;

/** A changed quantity supersedes only within the same claim: at least this share of the words around the quantities is kept. */
export const QUANTITY_CONTEXT_OVERLAP = 0.34;

/** Intents a planner must not apply on its own: they need a decision. */
export const ESCALATED_INTENTS: ReadonlySet<UpdateIntent> = new Set(["CONTRADICTS", "UNCLEAR"]);

/** Classifies one claim's change from `before` to `after` (either may be null or empty: no claim on that side). */
export function classifyClaimChange(before: string | null, after: string | null): IntentVerdict {
  const was = plainText(before ?? "").trim();
  const now = plainText(after ?? "").trim();
  if (!was && !now) return { intent: "DUPLICATE", detail: "nothing on either side" };
  if (!was) return { intent: "NEW", detail: "a claim that wasn't there before" };
  if (!now) return { intent: "UNCLEAR", detail: "the claim is gone" };
  if (normalizeForCompare(was) === normalizeForCompare(now)) return { intent: "DUPLICATE", detail: "says the same as before" };

  const flip = contradiction(was, now);
  if (flip) return { intent: "CONTRADICTS", detail: flip };

  const qWas = quantitiesOf(was);
  const qNow = quantitiesOf(now);
  const lost = qWas.filter((q) => !qNow.some((n) => sameQuantity(q, n)));
  const wordsWas = new Set(significant(was));
  const wordsNow = new Set(significant(now));
  const keptAll = [...wordsWas].every((w) => wordsNow.has(w));
  if (!lost.length && keptAll && (wordsNow.size > wordsWas.size || qNow.length > qWas.length)) return { intent: "EXTENDS", detail: "keeps what it said and adds to it" };
  if (lost.length && wordOverlap(withoutQuantities(was), withoutQuantities(now)) >= QUANTITY_CONTEXT_OVERLAP) {
    const gained = qNow.filter((q) => !qWas.some((w) => sameQuantity(q, w)));
    return { intent: "SUPERSEDES", detail: gained.length ? `“${lost[0]!.text}” is now “${gained[0]!.text}”` : `“${lost[0]!.text}” is no longer stated` };
  }
  if (wordOverlap(was, now) >= SUPERSEDE_OVERLAP) return { intent: "SUPERSEDES", detail: "the same claim with a term replaced" };
  return { intent: "UNCLEAR", detail: "too little of the claim is kept to tell what changed" };
}

/** `text` with its quantities taken out, so a claim's own words can be compared apart from its values. */
function withoutQuantities(text: string): string {
  let out = "";
  let last = 0;
  for (const q of quantitiesOf(text)) {
    out += `${text.slice(last, q.start)} `;
    last = q.end;
  }
  return out + text.slice(last);
}

/** The meaning rules' verdict that `now` says the opposite of `was`, read both ways; null when it doesn't. */
function contradiction(was: string, now: string): string | null {
  for (const [from, to] of [
    [was, now],
    [now, was],
  ] as const) {
    const unit: SourceUnit = { id: "u1", kind: "sentence", text: from, hash: "", topic: "", span: { start: 0, end: from.length } };
    // `analysis`: the rules that flag what the source doesn't state (a cause added, a new number) aren't contradictions here.
    const flags = checkMeaning({ id: "claim", title: "", body: to, cites: ["u1"], origin: "analysis" }, [unit]);
    const hit = flags.find((f) => f.code === "negation_flip" || f.code === "cause_changed");
    if (hit) return hit.code === "negation_flip" ? "one version says it isn't so" : "it now moves the opposite way";
  }
  return null;
}
