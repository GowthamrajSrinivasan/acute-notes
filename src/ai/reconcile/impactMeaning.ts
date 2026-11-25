/**
 * Impact discovery by meaning (#14, intelligent-update-engine-plan §19.6). The word-overlap scan (`impact.ts`) can't tell
 * "our worker retries five times" from "deploys happen five times": both share the changed words and enough others. When
 * the local embedding model is running (the semantic placement switch, §18) and its embedder is calibrated for it
 * (`thresholds.claim`), each sentence the scan matched is checked for meaning, and the sentences it skipped are read too:
 *
 * - an offer ("Update this too") or a related card whose sentence is about **something else** (below `other`) is dropped —
 *   the model only vetoes what word overlap found, it never turns an offer into anything else;
 * - a card the scan found nothing on, with a sentence that states a changed claim **in other words** (at or above `same`),
 *   is listed as related — never offered as an edit, because meaning alone can't say where the changed words are.
 *
 * Not caught: a sentence that is the claim with only its subject swapped ("Timeouts happen five times" for "Retries happen
 * five times") reads as close as a true restatement to this model, so it stays an offer, as before (the 5e relate call, #20).
 *
 * Nothing here is a model *call*: the model runs on the user's own machine, nothing is spent, and it never edits content.
 * Any failure, a missing calibration or the time budget running out returns the scan's own answer.
 */
import { significant } from "@/ai/fidelity/information";
import { similarity, type ClaimThresholds, type EmbeddingProvider } from "@/ai/router/embeddingProvider";
import { assembleImpact, MAX_IMPACT, scanImpact, wholeWordIndexes, type CardScan, type ChangedClaim, type ImpactInput, type ImpactResult } from "./impact";

export type ClaimVerdict = "same" | "unsure" | "other";

/** At most this many sentences the scan skipped are read per update (closest in words first). */
export const MAX_MEANING_SENTENCES = 400;
/** A sentence with fewer significant words than this says too little to be read for meaning. */
const MIN_WORDS = 3;
/** The meaning pass gives up after this long and the scan's answer stands. */
export const MEANING_BUDGET_MS = 3_000;

export interface MeaningOptions {
  budgetMs?: number;
  maxSentences?: number;
}

export function claimVerdict(s: number, t: ClaimThresholds): ClaimVerdict {
  return s < t.other ? "other" : s >= t.same ? "same" : "unsure";
}

/** Same claim or not, for each pair (sentence, claim sentence). One embedding request; each text embedded once. */
export async function judgeClaims(provider: EmbeddingProvider, thresholds: ClaimThresholds, pairs: readonly (readonly [string, string])[]): Promise<{ verdict: ClaimVerdict; s: number }[]> {
  if (!pairs.length) return [];
  const unique = [...new Set(pairs.flat())];
  const vectors = await provider.embed(unique);
  const at = new Map(unique.map((t, i) => [t, vectors[i]!] as const));
  return pairs.map(([a, b]) => {
    const s = similarity(at.get(a)!, at.get(b)!);
    return { verdict: claimVerdict(s, thresholds), s };
  });
}

/**
 * `discoverImpact` with the meaning pass (see module doc). `provider` must be ready; without `thresholds.claim` (an
 * embedder not calibrated for it, the hashed one) this is `discoverImpact` exactly.
 */
export async function discoverImpactByMeaning(input: ImpactInput, provider: EmbeddingProvider, options: MeaningOptions = {}): Promise<ImpactResult> {
  const { claims, cards } = scanImpact(input);
  const limit = input.limit ?? MAX_IMPACT;
  const thresholds = provider.thresholds.claim;
  if (!thresholds || !claims.length || !cards.length) return assembleImpact(claims, cards, limit);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), options.budgetMs ?? MEANING_BUDGET_MS)));
  try {
    const refined = await Promise.race([refine(cards, claims, provider, thresholds, options.maxSentences ?? MAX_MEANING_SENTENCES), timeout]);
    return assembleImpact(claims, refined ?? cards, limit);
  } catch (err) {
    console.warn("[acute-notes] Impact discovery by meaning failed; using word overlap", err);
    return assembleImpact(claims, cards, limit);
  } finally {
    clearTimeout(timer);
  }
}

type Pair = { card: number; sentence: string; claim: ChangedClaim } & ({ kind: "restate" | "related"; index: number } | { kind: "widen" });

/** The cards with each finding checked for meaning (new objects; `cards` is left as it was, for the fallback). */
async function refine(cards: readonly CardScan[], claims: readonly ChangedClaim[], provider: EmbeddingProvider, thresholds: ClaimThresholds, maxSentences: number): Promise<CardScan[]> {
  const pairs: Pair[] = [];
  cards.forEach((card, i) => {
    card.restates.forEach((r, index) => pairs.push({ kind: "restate", index, card: i, sentence: r.sentence, claim: r.claim }));
    card.related.forEach((r, index) => pairs.push({ kind: "related", index, card: i, sentence: r.sentence, claim: r.claim }));
  });
  // Sentences the scan skipped, on cards it found nothing on: closest in words first, up to `maxSentences`.
  const skipped = cards
    .flatMap((card, i) => (card.locked || card.restates.length || card.related.length ? [] : card.unmatched.map((u) => ({ card: i, ...u }))))
    .filter((u) => significant(u.sentence).length >= MIN_WORDS)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, maxSentences);
  for (const u of skipped) {
    for (const claim of claims) {
      // Already says it the new way: nothing to point out.
      if (wholeWordIndexes(u.sentence, claim.replacement).length && !wholeWordIndexes(u.sentence, claim.old).length) continue;
      pairs.push({ kind: "widen", card: u.card, sentence: u.sentence, claim });
    }
  }
  if (!pairs.length) return [...cards];
  const verdicts = await judgeClaims(provider, thresholds, pairs.map((p) => [p.sentence, p.claim.before] as const));

  const dropped = new Set<string>();
  const meaning = new Map<number, NonNullable<CardScan["meaning"]>>();
  pairs.forEach((p, k) => {
    const { verdict, s } = verdicts[k]!;
    if (p.kind !== "widen") {
      if (verdict === "other") dropped.add(`${p.kind}:${p.card}:${p.index}`);
      return;
    }
    const card = cards[p.card]!;
    if (verdict === "same" && s > (meaning.get(p.card)?.score ?? -1)) {
      meaning.set(p.card, { target: card.el.id, name: card.name, reason: `seems to say ${quote(p.claim.before)} in other words — not edited; check it`, score: s });
    }
  });
  return cards.map((card, i) => ({
    ...card,
    restates: card.restates.filter((_r, k) => !dropped.has(`restate:${i}:${k}`)),
    related: card.related.filter((_r, k) => !dropped.has(`related:${i}:${k}`)),
    meaning: meaning.get(i) ?? null,
  }));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const quote = (s: string, n = 60) => `“${clip(s, n)}”`;
