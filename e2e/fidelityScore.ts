/**
 * Content fidelity score (content fidelity plan §3): how much of a source document survives on the canvas after
 * Visualize. Deterministic, no AI judge — so a score is repeatable and every miss can be listed.
 *
 * - Source units: each line, split into sentences; a tab-separated line (a table row) is one unit. Markdown
 *   markers (`- `, `1. `, `**`, backticks) don't count.
 * - A unit is covered when at least `UNIT_THRESHOLD` of its significant words (not stop words; 3+ letters or with
 *   a digit) appear anywhere in the canvas text — so rewording a unit keeps it, dropping it doesn't.
 * - Key terms: numbers, versions, paths and identifiers (`18.7786`, `0.5`, `tolerances.aggregate_gap_pct`,
 *   `wl5_inj`) — the details a condensed summary drops first. Each must appear verbatim.
 * - Score: 50% unit coverage, 30% key-term coverage, 20% word coverage.
 */
import type { KnowledgeRunOutput } from "../src/ai/fidelity/contracts";
import { COVERAGE_THRESHOLD, keyTerms, significant, words } from "../src/ai/fidelity/information";

export const UNIT_THRESHOLD = COVERAGE_THRESHOLD;
export { significant };

export interface SourceUnit {
  text: string;
  kind: "row" | "sentence";
}

export function sourceUnits(text: string): SourceUnit[] {
  const units: SourceUnit[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/\*\*|`/g, "")
      .trim();
    if (!line) continue;
    if (line.includes("\t")) {
      units.push({ text: line.replace(/\t+/g, " · "), kind: "row" });
      continue;
    }
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/)) {
      if (significant(sentence).length >= 2) units.push({ text: sentence.trim(), kind: "sentence" });
    }
  }
  return units;
}

export interface FidelityScore {
  score: number;
  units: { total: number; covered: number; pct: number };
  keyTerms: { total: number; kept: number; pct: number };
  words: { total: number; kept: number; pct: number };
  skipped: { text: string; kind: SourceUnit["kind"]; kept: number }[];
  missingKeyTerms: string[];
}

export function fidelityScore(source: string, canvasText: readonly string[]): FidelityScore {
  const canvas = new Set(canvasText.flatMap((t) => words(t)));
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 100);

  const units = sourceUnits(source);
  const skipped: FidelityScore["skipped"] = [];
  let covered = 0;
  for (const u of units) {
    const sig = [...new Set(significant(u.text))];
    const kept = sig.filter((w) => canvas.has(w)).length / (sig.length || 1);
    if (kept >= UNIT_THRESHOLD) covered++;
    else skipped.push({ text: u.text, kind: u.kind, kept: Math.round(kept * 100) });
  }

  const terms = keyTerms(source);
  const missingKeyTerms = terms.filter((t) => !canvas.has(t));
  const vocab = [...new Set(significant(source))];
  const keptWords = vocab.filter((w) => canvas.has(w)).length;

  const u = pct(covered, units.length);
  const k = pct(terms.length - missingKeyTerms.length, terms.length);
  const w = pct(keptWords, vocab.length);
  return {
    score: Math.round(0.5 * u + 0.3 * k + 0.2 * w),
    units: { total: units.length, covered, pct: u },
    keyTerms: { total: terms.length, kept: terms.length - missingKeyTerms.length, pct: k },
    words: { total: vocab.length, kept: keptWords, pct: w },
    skipped,
    missingKeyTerms,
  };
}

/** Wave F1: the same document, same model, varies run to run — median is the headline, range shows how much. */
export function median(ns: readonly number[]): number {
  const sorted = [...ns].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function range(ns: readonly number[]): { min: number; max: number } {
  return { min: Math.min(...ns), max: Math.max(...ns) };
}

export interface FidelityRun {
  /** "AI placed N%" from the review bar's coverage row — the honest, model-authored share (Wave A3). */
  aiPlacedPct: number;
  /** The deterministic fidelity score, visible-on-cards only (without opening pages) — the "nothing lost" guard. */
  visibleScore: number;
  /** The deterministic fidelity score including page content. */
  allScore: number;
  seconds: number;
  /** Summed across every AI call in the run (not every provider reports usage) — a cost figure, not a quality one, so summed, not medianed. */
  promptTokens?: number;
  completionTokens?: number;
}

/** Wave F1: a case run several times — median and range for "AI placed" (the headline) and the coverage guard. */
export function multiRunSummaryMarkdown(title: string, runs: readonly FidelityRun[]): string {
  const aiPlaced = runs.map((r) => r.aiPlacedPct);
  const visible = runs.map((r) => r.visibleScore);
  const all = runs.map((r) => r.allScore);
  const fmt = (ns: readonly number[]) => `median ${median(ns)} (range ${range(ns).min}–${range(ns).max})`;
  const promptTokens = runs.reduce((n, r) => n + (r.promptTokens ?? 0), 0);
  const completionTokens = runs.reduce((n, r) => n + (r.completionTokens ?? 0), 0);
  return [
    `# ${title} — ${runs.length} runs`,
    "",
    `**AI placed: ${fmt(aiPlaced)}%** (target ≥ 85 after Wave B)`,
    `Fidelity score, visible: ${fmt(visible)}/100 (guard: median ≥ 95) · all: ${fmt(all)}/100`,
    `Tokens across all ${runs.length} runs: ${promptTokens.toLocaleString()} prompt + ${completionTokens.toLocaleString()} completion = ${(promptTokens + completionTokens).toLocaleString()} total`,
    "",
    "| Run | AI placed | Visible score | All score | Seconds | Tokens (prompt+completion) |",
    "|---|---|---|---|---|---|",
    ...runs.map((r, i) => `| ${i + 1} | ${r.aiPlacedPct}% | ${r.visibleScore} | ${r.allScore} | ${r.seconds}s | ${r.promptTokens ?? "?"} + ${r.completionTokens ?? "?"} |`),
    "",
  ].join("\n");
}

/** A Markdown report of one case. */
export function reportMarkdown(title: string, s: FidelityScore, visibleOnly: FidelityScore, extra: string[] = []): string {
  const row = (label: string, a: { total: number; pct: number } & ({ covered: number } | { kept: number })) =>
    `| ${label} | ${"covered" in a ? a.covered : a.kept} / ${a.total} | ${a.pct}% |`;
  return [
    `# ${title}`,
    "",
    `**Fidelity score: ${s.score}/100** (visible on cards, without opening pages: ${visibleOnly.score}/100)`,
    "",
    ...extra,
    "",
    "| Measure | Kept | % |",
    "|---|---|---|",
    row("Source units (sentences, list items, table rows) covered", s.units),
    row("Key terms (numbers, paths, identifiers) kept verbatim", s.keyTerms),
    row("Distinct significant words kept", s.words),
    "",
    `## Skipped units (${s.skipped.length}) — fewer than ${UNIT_THRESHOLD * 100}% of their words on the canvas`,
    "",
    ...(s.skipped.length ? s.skipped.map((x) => `- (${x.kept}% kept) ${x.text}`) : ["None."]),
    "",
    `## Missing key terms (${s.missingKeyTerms.length})`,
    "",
    s.missingKeyTerms.length ? s.missingKeyTerms.map((t) => `\`${t}\``).join(", ") : "None.",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------- report v2: distil runs (knowledge-notes-plan §7.3, §9, WP1.12)

/** What report v2 reads of a run: its `KnowledgeRunOutput` (`__acuteDev.knowledgeRun`), with or without the plan. */
export type KnowledgeRunLike = Pick<KnowledgeRunOutput, "noteModel" | "units" | "cites" | "omitted" | "accounting" | "flags" | "hints" | "reviews"> &
  Partial<Pick<KnowledgeRunOutput, "cardGroups">>;

/** One distil run, measured for the release gates (§9). Nothing here calls a model. */
export interface KnowledgeScore {
  units: number;
  represented: number;
  omitted: number;
  needsReview: number;
  /** Units of failed or cut-off sections (each must carry the Wave A notice, G3). */
  pending: number;
  /** Cards as the reader sees them (see `knowledgeScore`: a card of several nodes counts once). */
  cards: number;
  cardsNeedsReview: number;
  /** G1: the share of cards in Needs review (median ≤ 15% across runs). Cards, not nodes (plan §9 G1). */
  cardsNeedsReviewPct: number;
  /** Cards the model check answered "supported" ("checked by AI"). */
  checkedByAI: number;
  /**
   * The model check's verdicts (OD5b: every citing card in distil mode): cards it was asked about, and how many it
   * answered "partly", "not supported", or not at all (all three stay in Needs review). The live stand-in for G2's
   * "distortions flagged": the labelled set's kinds can't be told apart on real output.
   */
  aiChecked: number;
  aiPartly: number;
  aiNotSupported: number;
  aiUnanswered: number;
  /** Cards the meaning rules hint about (hints only, never Needs review on their own). */
  hinted: number;
  /** Cards longer than the source passages they cite (`longer_than_source`, a hint only; words are observed, not gated). */
  longerThanSource?: number;
  /** G3 (every run): critical units omitted for a reason other than duplicate or superseded, outside Needs review. */
  criticalSilentlyOmitted: number;
  /** G4 (every run): exact details still missing at the end of the run. */
  exactMissing: number;
  /** Observed, not gated (§9): canvas words as a share of source words, when both texts are given. */
  wordsSharePct?: number;
  /** Needs review reasons by code (the run's flags). Not a measure: left out of the median and worst. */
  reasonsByCode?: Record<string, number>;
}

/**
 * One run's report v2 measures.
 *
 * **G1 counts cards, not nodes** (knowledge-notes-plan §9 G1: "the median share of cards in Needs review ≤ 15%"). A card
 * is what the reader sees as one idea: a plan node, or several nodes the run grouped as one (`run.cardGroups`: a diagram
 * shape with the text that explains it via `explained_by`, a label-only shape with the full card citing its units;
 * `cardViews` in `src/ai/fidelity/representation.ts`). A grouped card is in Needs review when any of its nodes is, and
 * counts once. Without `cardGroups` (runs recorded before 2026-10-20) every node is a card, as before. `checkedByAI` and
 * the model check's counts are per card too (the check answers once per card).
 */
export function knowledgeScore(run: KnowledgeRunLike, texts?: { source: string; canvas: readonly string[] }): KnowledgeScore {
  const outcome = run.accounting?.outcome ?? {};
  const count = (o: string) => Object.values(outcome).filter((x) => x === o).length;
  const omittedBy = new Map((run.omitted ?? []).map((o) => [o.unit, o.reason] as const));
  const critical = run.accounting?.critical ?? {};
  const criticalSilentlyOmitted = Object.keys(critical).filter((u) => outcome[u] === "omitted" && !["duplicate", "superseded"].includes(omittedBy.get(u) ?? "")).length;
  const headOf = new Map((run.cardGroups ?? []).flatMap((members) => members.map((m) => [m, members[0]!] as const)));
  const head = (id: string) => headOf.get(id) ?? id;
  const cards = new Set([...Object.keys(run.cites ?? {}), ...Object.keys(run.reviews ?? {})].map(head));
  // Each card's reviews (one per node of it that has one); a card is in Needs review when any of them is open.
  const byCard = new Map<string, NonNullable<KnowledgeRunLike["reviews"]>[string][]>();
  for (const [id, r] of Object.entries(run.reviews ?? {})) byCard.set(head(id), [...(byCard.get(head(id)) ?? []), r]);
  const reviews = [...byCard.values()].map((rs) => ({
    reasons: rs.flatMap((r) => (r.resolved ? [] : r.reasons)),
    checked: rs.find((r) => r.checked)?.checked,
  }));
  const cardsNeedsReview = reviews.filter((r) => r.reasons.length > 0).length;
  const wordCount = (t: string) => t.split(/\s+/).filter(Boolean).length;
  const sourceWords = texts ? wordCount(texts.source) : 0;
  return {
    units: run.units?.units.length ?? Object.keys(outcome).length,
    represented: count("represented"),
    omitted: count("omitted"),
    needsReview: count("needs_review"),
    pending: Object.values(run.accounting?.state ?? {}).filter((s) => s === "pending").length,
    cards: cards.size,
    cardsNeedsReview,
    cardsNeedsReviewPct: cards.size ? Math.round((cardsNeedsReview / cards.size) * 1000) / 10 : 0,
    checkedByAI: reviews.filter((r) => r.checked?.verdict === "supported").length,
    aiChecked: reviews.filter((r) => r.checked || r.reasons.some((x) => x.startsWith(NO_ANSWER))).length,
    aiPartly: reviews.filter((r) => r.checked?.verdict === "partly").length,
    aiNotSupported: reviews.filter((r) => r.checked?.verdict === "not_supported").length,
    aiUnanswered: reviews.filter((r) => !r.checked && r.reasons.some((x) => x.startsWith(NO_ANSWER))).length,
    hinted: new Set((run.hints ?? []).flatMap((h) => (h.card && h.code !== "longer_than_source" ? [head(h.card)] : []))).size,
    longerThanSource: new Set((run.hints ?? []).flatMap((h) => (h.card && h.code === "longer_than_source" ? [head(h.card)] : []))).size,
    criticalSilentlyOmitted,
    exactMissing: (run.flags ?? []).filter((f) => f.code === "exact_missing").length,
    ...(texts && sourceWords ? { wordsSharePct: Math.round((texts.canvas.reduce((n, t) => n + wordCount(t), 0) / sourceWords) * 1000) / 10 } : {}),
    reasonsByCode: Object.fromEntries(
      [...(run.flags ?? []).reduce((m, f) => m.set(f.code, (m.get(f.code) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    ),
  };
}

/** The model check's "no answer" reason, as `verdictFlags` words it. */
const NO_ANSWER = "checked by AI: no answer";

/** Measures where more is worse; the rest (represented) are worse when fewer. */
const WORSE_WHEN_MORE: readonly (keyof KnowledgeScore)[] = ["omitted", "needsReview", "pending", "cardsNeedsReview", "cardsNeedsReviewPct", "aiPartly", "aiNotSupported", "aiUnanswered", "longerThanSource", "criticalSilentlyOmitted", "exactMissing", "wordsSharePct"];

/** The same fixture run several times (§7.3: 3 per approved live check): the median and the worst run, measure by measure. */
export function knowledgeSummary(runs: readonly KnowledgeScore[]): { runs: number; median: KnowledgeScore; worst: KnowledgeScore } {
  // Numeric measures only (`reasonsByCode` is a breakdown, summed by `reasonsAcross` instead).
  const keys = (Object.keys(runs[0] ?? {}) as (keyof KnowledgeScore)[]).filter((k) => typeof runs[0]![k] === "number");
  const pick = (f: (ns: number[], key: keyof KnowledgeScore) => number) =>
    Object.fromEntries(keys.map((k) => [k, f(runs.map((r) => Number(r[k] ?? 0)), k)])) as unknown as KnowledgeScore;
  return {
    runs: runs.length,
    median: pick((ns) => median(ns)),
    worst: pick((ns, k) => (WORSE_WHEN_MORE.includes(k) ? Math.max(...ns) : Math.min(...ns))),
  };
}

/** Needs review reasons by code over several runs, summed, most frequent first. */
export function reasonsAcross(runs: readonly KnowledgeScore[]): [string, number][] {
  const sum = new Map<string, number>();
  for (const r of runs) for (const [code, n] of Object.entries(r.reasonsByCode ?? {})) sum.set(code, (sum.get(code) ?? 0) + n);
  return [...sum].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The model check's verdicts over a set of runs (OD5b): the G2-type numbers a live run can give (per kind it can't). */
export interface ModelCheckCounts {
  /** Whether the check answered on every run that had cards. */
  ranEveryRun: boolean;
  cards: number;
  supported: number;
  partly: number;
  notSupported: number;
  unanswered: number;
}

/**
 * Which gates a set of runs meets (§9): G1's card share on the median; G3 and G4 on every run. `modelCheck` counts the
 * model check's verdicts (reported, not a gate: G2's planted-distortion recall needs the labelled set or mock fixtures).
 */
export function knowledgeGates(runs: readonly KnowledgeScore[]): { g1CardsInReview: boolean; g3NoSilentCriticalOmission: boolean; g4NoExactMissing: boolean; modelCheck: ModelCheckCounts } {
  const { median: m } = knowledgeSummary(runs);
  const total = (k: "aiChecked" | "checkedByAI" | "aiPartly" | "aiNotSupported" | "aiUnanswered") => runs.reduce((n, r) => n + (r[k] ?? 0), 0);
  return {
    g1CardsInReview: m.cardsNeedsReviewPct <= 15,
    g3NoSilentCriticalOmission: runs.every((r) => r.criticalSilentlyOmitted === 0),
    g4NoExactMissing: runs.every((r) => r.exactMissing === 0),
    modelCheck: {
      ranEveryRun: runs.every((r) => r.cards === 0 || (r.aiChecked ?? 0) > 0),
      cards: total("aiChecked"),
      supported: total("checkedByAI"),
      partly: total("aiPartly"),
      notSupported: total("aiNotSupported"),
      unanswered: total("aiUnanswered"),
    },
  };
}

/** Just the three release gates (G1, G3, G4) of `knowledgeGates`, for an assertion. */
export function gatesMet(runs: readonly KnowledgeScore[]): { g1CardsInReview: boolean; g3NoSilentCriticalOmission: boolean; g4NoExactMissing: boolean } {
  const { g1CardsInReview, g3NoSilentCriticalOmission, g4NoExactMissing } = knowledgeGates(runs);
  return { g1CardsInReview, g3NoSilentCriticalOmission, g4NoExactMissing };
}

/** Report v2 of one fixture's runs, as Markdown: median and worst, then each run. */
export function knowledgeSummaryMarkdown(title: string, runs: readonly KnowledgeScore[]): string {
  const { median: m, worst: w } = knowledgeSummary(runs);
  const gates = knowledgeGates(runs);
  const yes = (b: boolean) => (b ? "met" : "**not met**");
  const row = (label: string, s: KnowledgeScore) =>
    `| ${label} | ${s.represented} | ${s.omitted} | ${s.needsReview} | ${s.pending} | ${s.cardsNeedsReview}/${s.cards} (${s.cardsNeedsReviewPct}%) | ${s.aiChecked ?? 0}: ${s.checkedByAI} / ${s.aiPartly ?? 0} / ${s.aiNotSupported ?? 0} / ${s.aiUnanswered ?? 0} | ${s.hinted} | ${s.criticalSilentlyOmitted} | ${s.exactMissing} | ${s.wordsSharePct ?? "–"} |`;
  const mc = gates.modelCheck;
  const reasons = reasonsAcross(runs);
  return [
    `# ${title} — distil, ${runs.length} runs (report v2)`,
    "",
    `G1 cards in Needs review, median ≤ 15%: ${yes(gates.g1CardsInReview)} · G3 no critical unit silently omitted, every run: ${yes(gates.g3NoSilentCriticalOmission)} · G4 no exact detail missing, every run: ${yes(gates.g4NoExactMissing)}`,
    "",
    `Model check ("checked by AI", OD5b), all runs: ${mc.cards} cards checked: ${mc.supported} supported, ${mc.partly} partly, ${mc.notSupported} not supported, ${mc.unanswered} unanswered${mc.ranEveryRun ? "" : " (**did not run on every run**)"}`,
    "",
    "| Run | Represented | Omitted | Needs review | Pending | Cards in review | Checked by AI: cards: supported / partly / not / no answer | Hinted | Critical silently omitted | Exact missing | Canvas words % |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    row("median", m),
    row("worst", w),
    ...runs.map((r, i) => row(String(i + 1), r)),
    "",
    `Needs review reasons by code, all runs: ${reasons.length ? reasons.map(([c, n]) => `${c} ${n}`).join(", ") : "none"}`,
    "",
  ].join("\n");
}
