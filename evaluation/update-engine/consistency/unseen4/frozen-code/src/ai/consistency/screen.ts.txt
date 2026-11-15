/**
 * The Stage 4f candidate pipeline after the second unseen evaluation (intelligent-update-engine-plan §12.21):
 * **retrieval for recall, judgment for precision.** Offline only — nothing in the app calls it; Stage 4f stays OFF.
 *
 *   new or changed sentence → related sentences (high recall) → deterministic screen → budgeted AI judgment → evidence
 *   and safety guards (`combine`) → the user's review.
 *
 * The screen's philosophy is the reverse of the near-miss selector's: a related pair is **forwarded to the AI unless there
 * is positive evidence** that it is compatible or unrelated. Low shared wording is never evidence: paraphrased opposites
 * ("accessible" / "cannot reach") share little and contradict.
 *
 * - **Rule conflict** (shown without the AI) only when the tier-1 rules find a conflict *and* the two statements are the
 *   same claim word for word apart from their values — precision first ("120 rooms" / "95 rooms available for booking",
 *   "the Premium plan" / "the Team plan" go to the AI instead).
 * - **Excluded**, each with its reason: unrelated (no shared meaningful word, not near by the local embedder); the values
 *   agree or one sits inside the other's limit; the same frequency written differently; different named metrics; a
 *   different scope stated on both sides (staging / production, Android / iOS, version 2 / 3, 2022 / 2024); a pure
 *   extension (one says everything the other says and more, with no exclusivity word on the shorter side).
 * - **Forwarded** — everything else that is related — ranked by deterministic evidence of incompatibility.
 *
 * The tier-1 rules (`rules.ts`) are unchanged by this module; the live rules-only consistency panel keeps using them.
 */
import { quantitiesOf } from "@/ai/fidelity/quantities";
import { significant } from "@/ai/fidelity/information";
import { cosine, localEmbedder } from "@/ai/router/embedding";
import { contentOf, frequencyOf, isExclusive, judgePair, MODAL_CLASH, markersOf, modalityOf, polarity, sharedCount, stem, unmatched, type PairJudgement } from "./rules";

export type Exclusion = "unrelated" | "values_agree" | "same_frequency" | "different_metrics" | "different_scope" | "extension";

export interface Screened {
  decision: "rule_conflict" | "forward" | "excluded";
  exclusion?: Exclusion;
  reason: string;
  /** The tier-1 rules' own result, kept as evidence. */
  rule: PairJudgement;
  /** A scope difference strong enough that the AI's "contradicts" alone stays possible (the context guard). */
  scoped: boolean;
  /** A statement says only one value can hold. */
  exclusive: boolean;
  evidence: { incompatibility: "strong" | "medium" | "weak"; sameClaim: boolean };
  /** Local embedder cosine (0–1), a tie-break. */
  similarity: number;
  /** Too little said to identify the subject, or changes without a baseline (the thin guard). */
  thin: boolean;
  /** Higher first; 0 when not forwarded. */
  priority: number;
}

/** Words too general to relate two statements on their own. */
const GENERIC = new Set(["use", "get", "make", "take", "need", "include", "also", "new", "one", "time", "day", "year", "thing", "way", "part", "people", "many", "much", "every", "each", "all", "only"]);
const VALUE_WORDS = new Set(["most", "least", "up", "maximum", "minimum", "limited", "capped", "limit", "about", "around", "roughly", "approximately", "nearly", "almost", "more", "less", "than", "over", "under", "below", "above", "within"]);
const SCOPE_KINDS = new Set(["env", "platform", "region", "version"]);
/**
 * Countries, as a region scope (§12.24 review): "In Germany the fee is €8" / "The fee is £5" are two contexts. Names only
 * — demonyms ("French fries", "Chinese wall") are too often not a place. `rules.ts` keeps its own short region list.
 */
const COUNTRIES = new Set(["germany", "france", "spain", "italy", "ireland", "canada", "australia", "india", "japan", "china", "brazil", "mexico", "netherlands", "sweden", "norway", "denmark", "finland", "poland", "portugal", "switzerland", "austria", "belgium", "singapore", "scotland", "wales", "england", "britain", "korea", "argentina", "chile", "egypt", "nigeria", "kenya", "turkey", "greece", "israel", "indonesia", "vietnam", "thailand", "philippines"]);
/** Time words that name an ended or a specific time, each enough on its own when one side states it and the other doesn't. */
const SPECIFIC_TIME_WORDS = new Set(["until", "previously", "formerly", "originally", "earlier", "yesterday"]);
/**
 * Environment words that are also everyday English ("a local cheesemaker", "the main stage", "a blood test"). They count
 * as an environment only next to a word that makes it one ("local environment", "test server", "on local"); the
 * unambiguous ones (staging, production, sandbox, …) always count (§12.24).
 */
const AMBIGUOUS_ENV: Record<string, string> = { "env:local": "local", "env:staging": "stage", "env:test": "test", "env:testing": "testing", "env:preview": "preview" };
const ENV_NOUNS = new Set(["environment", "environments", "env", "server", "servers", "build", "builds", "instance", "instances", "cluster", "deployment", "deployments", "machine", "machines", "mode", "setup", "stack", "site", "database", "db", "tenant"]);

/** Is this ambiguous environment marker an environment here? (See `AMBIGUOUS_ENV`.) */
function envIsStated(sentence: string, marker: string): boolean {
  const word = AMBIGUOUS_ENV[marker];
  if (!word) return true;
  const t: string[] = sentence.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  if (marker === "env:staging" && t.includes("staging")) return true;
  return t.some((w, i) => w === word && (ENV_NOUNS.has(t[i + 1] ?? "") || ["on", "in", "during"].includes(t[i - 1] ?? "")));
}

/** Both sentences state at least one value of the same kind (time, size, count, …), so "the values agree" compared something. */
export function valuesCompared(a: string, b: string): boolean {
  const qb = quantitiesOf(b);
  return quantitiesOf(a).some((x) => qb.some((y) => y.dimension === x.dimension));
}

/** The sentence's meaningful stems with its values (numbers, units, bound words) taken out. */
function claimWords(sentence: string): string[] {
  const qs = quantitiesOf(sentence);
  const text = qs.reduceRight((t, q) => `${t.slice(0, q.start)} ${t.slice(q.end)}`, sentence);
  return contentOf(text).filter((w) => !VALUE_WORDS.has(w) && !/^\d/.test(w));
}

/** Related at all? A shared meaningful word, or near by the local embedder. Recall first: this only drops the clearly unrelated. */
export function relatedness(a: string, b: string): { related: boolean; similarity: number; shared: number } {
  const wa = significant(a).map(stem).filter((w) => !GENERIC.has(w) && !/^\d/.test(w));
  const wb = significant(b).map(stem).filter((w) => !GENERIC.has(w) && !/^\d/.test(w));
  const shared = sharedCount([...new Set(wa)], [...new Set(wb)]);
  const similarity = cosine(localEmbedder.embed(a), localEmbedder.embed(b));
  return { related: shared >= 1 || similarity >= 0.2, similarity, shared };
}

/**
 * The scope of a statement (§12.24): its context markers, and its **specific times** — the times that place it, as
 * opposed to words that only carry tense.
 * - Specific: a year, a month, a quarter, "last quarter", "until", "previously", …; "before / after / during the X" only
 *   when it leads the sentence ("Before the migration, …"; mid-sentence it is an order or a precondition: "sign before
 *   the firm opens a file", w44).
 * - Not specific: the past tense alone ("was", "had": "the limit was set to 10" is not about another time); "since";
 *   a year or month anchored to the present by "since" or "as of" ("since the 2024 change" is about now, w32).
 * - Markers that aren't a context here: an everyday environment word ("a local cheesemaker", w40); a "version" or
 *   "release" not followed by a number ("the release was delayed").
 */
function scopeOf(sentence: string) {
  const lower = sentence.toLowerCase();
  const tokens: string[] = lower.match(/[a-z0-9']+/g) ?? [];
  const markers = [...markersOf(sentence)].filter((m) => envIsStated(sentence, m) && (!m.startsWith("version:") || /^v?\d/.test(m.slice(8))));
  if (tokens.includes("locally")) markers.push("env:local");
  for (const w of tokens) if (COUNTRIES.has(w)) markers.push(`region:${w}`);
  const headWords = lower.split(/[,;:]/)[0]!.split(/\s+/).slice(0, 4);
  const head = headWords.join(" ");
  if (headWords[0] === "during" && headWords[1]) markers.push(`time:during-${(headWords[1] === "the" ? headWords[2] : headWords[1])?.replace(/[^a-z0-9]/g, "")}`);
  // Years and months the sentence anchors to the present ("since 2024", "as of March").
  const anchored = new Set<string>();
  tokens.forEach((w, i) => {
    const before = tokens.slice(Math.max(0, i - 3), i);
    if (before.includes("since") || before.join(" ").includes("as of")) anchored.add(w);
  });
  // A dated past event places the statement in its time ("was raised to £60 in January"); in the present tense a month or
  // "last year" mid-sentence is a schedule or an aside ("audits once a year, in August", v53; "a risk identified last
  // year", w28).
  const pastTense = markers.includes("time:past") || tokens.some((w) => ["previously", "formerly", "originally", "stopped"].includes(w));
  const afterBoundary = (w: string) => tokens.some((t, i) => t === w && ["until", "before", "after", "from", "by"].includes(tokens[i - 1] ?? ""));
  const specific = markers.filter((m) => {
    if (!m.startsWith("time:")) return false;
    const v = m.slice(5);
    if (v === "past" || v === "since" || v.startsWith("next-")) return false;
    if (/^(before|after|during)-/.test(v)) return head.includes(v.split("-")[0]!);
    if (anchored.has(v)) return false;
    if (/^\d{4}$/.test(v)) return true;
    // "until 7 p.m.", "until midnight", "until 30 June": a closing time or a deadline is a value, not a time context.
    if (v === "until") return tokens.some((t, i) => t === "until" && !/^(\d|midnight|noon|end)/.test(tokens[i + 1] ?? ""));
    if (SPECIFIC_TIME_WORDS.has(v)) return true;
    const first = v.split("-")[0]!;
    return head.includes(first) || pastTense || afterBoundary(first);
  });
  return { markers, times: markers.filter((m) => m.startsWith("time:")), specific, explicit: markers.filter((m) => SCOPE_KINDS.has(m.split(":")[0]!)) };
}

/**
 * The context guard (refined §12.21, narrowed and corrected §12.24): a scope difference holds the AI's "contradicts" at
 * possible only on **positive evidence of a material difference** in scope, time, subject or environment:
 * - both sides state the same kind of scope with different values (`bothSided`: staging / production, UK / Germany — the
 *   only case the screen may **exclude** on);
 * - both sides state different specific times (`timeBothSided`: "signed in 2023" / "signed in 2024"). **Never excluded**:
 *   two dates for the same event is a classic contradiction, so the pair goes to the AI and is held for the user;
 * - one side states an environment / platform / region / version, or a specific time, the other doesn't.
 * Not a scope: a unit ("per order"), a period inside the claim, an observation checked against a limit, a precondition,
 * a present anchor, the past tense alone, an everyday word that is also an environment name.
 */
function scopeDiffers(a: string, b: string, observationVsLimit: boolean): { scoped: boolean; bothSided: boolean; timeBothSided: boolean } {
  const sa = scopeOf(a);
  const sb = scopeOf(b);
  const kinds = (ms: string[]) => new Map(ms.filter((m) => !m.startsWith("time:")).map((m) => [m.split(":")[0]!, m] as const));
  const ka = kinds(sa.markers);
  const kb = kinds(sb.markers);
  const bothSided = [...ka].some(([k, m]) => kb.has(k) && kb.get(k) !== m);
  if (bothSided) return { scoped: true, bothSided: true, timeBothSided: false };
  const ownTime = (s: typeof sa, other: typeof sa) => s.specific.some((m) => !other.times.includes(m));
  const timeBothSided = sa.specific.length > 0 && sb.specific.length > 0 && ownTime(sa, sb) && ownTime(sb, sa);
  if (timeBothSided) return { scoped: true, bothSided: false, timeBothSided: true };
  if (observationVsLimit) return { scoped: false, bothSided: false, timeBothSided: false };
  const explicit = sa.explicit.filter((m) => !sb.markers.includes(m)).length + sb.explicit.filter((m) => !sa.markers.includes(m)).length > 0;
  return { scoped: explicit || ownTime(sa, sb) || ownTime(sb, sa), bothSided: false, timeBothSided: false };
}

/** Screens one sentence pair (see module doc). Symmetric in what it decides. */
export function screenPair(a: string, b: string): Screened {
  const rule = judgePair(a, b);
  const rel = relatedness(a, b);
  const exclusive = isExclusive(a) || isExclusive(b);
  const thin = Math.min(claimWords(a).length, claimWords(b).length) < 2 || /too little context|baseline/.test(rule.reason);
  const base = { rule, exclusive, thin, similarity: rel.similarity };
  const exclude = (exclusion: Exclusion, reason: string): Screened => ({ ...base, decision: "excluded", exclusion, reason, scoped: false, evidence: { incompatibility: "weak", sameClaim: false }, priority: 0 });
  if (!rel.related) return exclude("unrelated", "no shared meaningful word, not near");

  const ca = claimWords(a);
  const cb = claimWords(b);
  const identical = unmatched(ca, cb) === 0;
  const negationDiffers = polarity(a).negated !== polarity(b).negated;
  const ma = modalityOf(a);
  const mb = modalityOf(b);
  const modalClash = !!ma && !!mb && MODAL_CLASH.has(`${ma}/${mb}`);
  const reason = rule.nearMiss?.reason ?? rule.reason;

  // Positive evidence of compatibility — each needs something stated, never only a lack of shared words.
  if (rule.verdict === "compatible" && !rule.nearMiss && rule.reason === "different metrics") return exclude("different_metrics", "different named metrics");
  // "The values agree" is evidence only when values of the same kind were actually compared (§12.23, w31): "24 hours a
  // day, 7 days a week" against "closed … between midnight and 5 a.m." compares nothing — durations on one side, a bare
  // count on the other — so the rule's "agree" is vacuous and the pair goes on to the AI.
  if (rule.verdict === "compatible" && !rule.nearMiss && rule.reason === "the values agree" && !negationDiffers && !modalClash && valuesCompared(a, b)) return exclude("values_agree", "the values agree, or one sits inside the other's limit");
  const fa = frequencyOf(a);
  const fb = frequencyOf(b);
  if (fa && fb && Math.abs(Math.log(fa.perYear / fb.perYear)) <= 0.02 && !negationDiffers && unmatched(claimWords(a.toLowerCase().replace(fa.text, " ")), claimWords(b.toLowerCase().replace(fb.text, " "))) <= 2) return exclude("same_frequency", `“${fa.text}” = “${fb.text}”`);
  const observationVsLimit = rule.verdict === "conflict" && /at most|at least/.test(rule.reason);
  const scope = scopeDiffers(a, b, observationVsLimit);
  if (scope.bothSided && rule.verdict !== "conflict") return exclude("different_scope", "a different scope stated on both sides");
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  const shortSentence = ca.length <= cb.length ? a : b;
  if (short.length >= 2 && long.length > short.length && unmatched(short, long) === long.length - short.length && !negationDiffers && !modalClash && !isExclusive(shortSentence) && rule.verdict === "compatible" && !rule.nearMiss)
    return exclude("extension", "one says all the other says, and more");

  // Precision first: a definite rule conflict only for the same claim word for word (apart from the values).
  if (rule.verdict === "conflict" && (identical || rule.kind === "contradicts"))
    return { ...base, decision: "rule_conflict", reason: rule.reason, scoped: false, evidence: { incompatibility: "strong", sameClaim: true }, priority: 0 };

  // Forward: ranked by evidence of incompatibility, then by how surely it is the same claim.
  const valuesDiffer = rule.verdict === "conflict" || (!!rule.nearMiss && ["value", "date", "frequency", "limit"].includes(rule.nearMiss.kind));
  const incompatibility: Screened["evidence"]["incompatibility"] =
    valuesDiffer || negationDiffers || modalClash || rule.nearMiss?.kind === "negation" || rule.nearMiss?.kind === "modality" || (rule.verdict === "possible" && rule.kind === "contradicts") ? "strong"
    : exclusive || (rule.verdict === "possible" && rule.kind === "value") || rule.verdict === "possible" ? "medium"
    : "weak";
  const sameClaim = identical || unmatched(ca, cb) <= 2 || rel.similarity >= 0.45;
  const inc = incompatibility === "strong" ? 3 : incompatibility === "medium" ? 2 : 1;
  const priority = scope.scoped ? 1 + rel.similarity / 10 : 2 * inc + (sameClaim ? 1 : 0) + rel.similarity / 10;
  return { ...base, decision: "forward", reason, scoped: scope.scoped, evidence: { incompatibility, sameClaim }, priority };
}

/** The judgement `combine` reads for a forwarded pair: possible, with the pipeline's own scope and exclusivity. */
export function judgementForCombine(s: Screened): PairJudgement {
  if (s.decision === "rule_conflict") return s.rule;
  if (s.decision === "excluded") return { verdict: "compatible", reason: s.reason };
  const swap = s.rule.verdict === "possible" && s.rule.kind === "value";
  return { verdict: "possible", kind: swap ? "value" : "differs", reason: s.reason, ...(s.scoped ? { contextDiffers: true as const } : {}), ...(s.exclusive ? { exclusive: true as const } : {}), ...(s.thin ? { thin: true as const } : {}) };
}
