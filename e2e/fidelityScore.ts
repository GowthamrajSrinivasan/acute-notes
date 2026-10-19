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
