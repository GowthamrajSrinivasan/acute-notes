/**
 * Measures the §12.21 pipeline (`screen.ts`) offline: what reaches the AI, what fits the budget, and — from recorded answers
 * where they exist — what the user would be shown. No model call.
 *
 * Two recalls, never merged (§12.21 review):
 * - **candidate-generation recall** — of the true contradictions, the share the screen doesn't exclude (rule conflict or
 *   forwarded). A pair the generator finds is NOT counted as recovered by that alone;
 * - **budgeted selection recall** — of the true contradictions, the share that reach the AI within the real limits: each
 *   pair's first statement is an accepted change, competing against every related sentence of the pool (`pool` mode: the
 *   whole set, as cards on one canvas; `batch` mode: its batch), and only its one call of ≤ 10 pairs counts.
 */
import { DAILY_CALL_CAP, JudgeBudget, planForChange, type Candidate } from "./candidates";
import type { EvalPair } from "./evaluation";
import { combine } from "./judge";
import type { RecordedJudgment } from "./judgeEvaluation";
import { judgementForCombine, screenPair, type Exclusion, type Screened } from "./screen";

const CONTEXT = new Set(["temporal", "environment", "scope", "platform", "region", "version"]);
const pct = ([n, d]: [number, number]) => (d ? `${Math.round((100 * n) / d)}% (${n}/${d})` : "— (0/0)");

export interface PipelineRow {
  id: string;
  category: string;
  truth: EvalPair["truth"];
  screened: Screened;
  ai?: RecordedJudgment;
  /** conflict / likely / possible / hidden; `pending` — forwarded but no recorded answer (counts as missed). */
  shown: "conflict" | "likely" | "possible" | "hidden" | "pending";
}

export interface PipelineReport {
  n: number;
  routes: Record<EvalPair["truth"], { rule_conflict: string[]; forward: string[]; excluded: string[] }>;
  generationRecall: [number, number];
  /** With recorded answers: shown at all (conflict, likely or possible) / strict (conflict or likely). Pending = missed. */
  recall: [number, number];
  strictRecall: [number, number];
  precision: [number, number];
  contextFP: [number, number];
  /** Rule conflicts on pairs not labelled contradiction. */
  ruleFalsePositives: { id: string; truth: string; reason: string }[];
  /** True contradictions the screen excluded, with the reason. */
  falseExclusions: { id: string; category: string; exclusion: Exclusion; reason: string }[];
  /** Ambiguous pairs shown as a conflict or likely (unsupported conflict calls). */
  unsupported: string[];
  forwardedWithoutAnswer: number;
  rows: PipelineRow[];
}

export function evaluatePipeline(pairs: readonly EvalPair[], answers: ReadonlyMap<string, RecordedJudgment> = new Map()): PipelineReport {
  const rows: PipelineRow[] = pairs.map((p) => {
    const s = screenPair(p.a, p.b);
    if (s.decision === "rule_conflict") return { id: p.id, category: p.category, truth: p.truth, screened: s, shown: "conflict" };
    if (s.decision === "excluded") return { id: p.id, category: p.category, truth: p.truth, screened: s, shown: "hidden" };
    const ai = answers.get(p.id);
    if (!ai) return { id: p.id, category: p.category, truth: p.truth, screened: s, shown: "pending" };
    return { id: p.id, category: p.category, truth: p.truth, screened: s, ai, shown: combine(judgementForCombine(s), ai).shown as PipelineRow["shown"] };
  });
  const empty = () => ({ rule_conflict: [] as string[], forward: [] as string[], excluded: [] as string[] });
  const routes = { contradiction: empty(), compatible: empty(), ambiguous: empty() };
  for (const r of rows) routes[r.truth][r.screened.decision].push(r.id);
  const contra = rows.filter((r) => r.truth === "contradiction");
  const call = (r: PipelineRow) => r.shown === "conflict" || r.shown === "likely";
  const calls = rows.filter((r) => call(r) && r.truth !== "ambiguous");
  const context = rows.filter((r) => CONTEXT.has(r.category) && r.truth === "compatible");
  return {
    n: rows.length,
    routes,
    generationRecall: [contra.filter((r) => r.screened.decision !== "excluded").length, contra.length],
    recall: [contra.filter((r) => ["conflict", "likely", "possible"].includes(r.shown)).length, contra.length],
    strictRecall: [contra.filter(call).length, contra.length],
    precision: [calls.filter((r) => r.truth === "contradiction").length, calls.length],
    contextFP: [context.filter(call).length, context.length],
    ruleFalsePositives: rows.filter((r) => r.screened.decision === "rule_conflict" && r.truth !== "contradiction").map((r) => ({ id: r.id, truth: r.truth, reason: r.screened.reason })),
    falseExclusions: contra.filter((r) => r.screened.decision === "excluded").map((r) => ({ id: r.id, category: r.category, exclusion: r.screened.exclusion!, reason: r.screened.reason })),
    unsupported: rows.filter((r) => r.truth === "ambiguous" && call(r)).map((r) => r.id),
    forwardedWithoutAnswer: rows.filter((r) => r.shown === "pending").length,
    rows,
  };
}

export interface BudgetReport {
  changes: number;
  /** Candidates (forwarded related pairs) per change: min / median / max. */
  candidatesPerChange: { min: number; median: number; max: number };
  /** Of the true contradictions, the share whose partner made its change's one call. */
  budgetedSelectionRecall: [number, number];
  /** Contradictions that were candidates but waited (over the call limit), and what outranked them. */
  waited: { id: string; rank: number; outrankedBy: number }[];
  pendingTotal: number;
  /** Retry calls the pending candidates would need, and days at the daily cap if every change happened on one day. */
  pendingCalls: number;
  daysAtCap: number;
}

/**
 * Each pair's `a` is an accepted change; its candidates are every related sentence of its pool (the whole set, or its
 * batch), screened and ranked; one call of ≤ 10 pairs. A contradiction counts when its own `b` is in that call.
 */
export function budgetedSelection(pairs: readonly (EvalPair & { batch?: string })[], mode: "pool" | "batch" = "pool"): BudgetReport {
  const counts: number[] = [];
  let hits = 0;
  let total = 0;
  let pendingTotal = 0;
  const waited: BudgetReport["waited"] = [];
  for (const p of pairs) {
    const pool = pairs
      .filter((q) => (mode === "batch" ? q.batch !== undefined && q.batch === p.batch : true))
      .flatMap((q) => (q.id === p.id ? [{ key: `${q.id}:b`, text: q.b }] : [{ key: `${q.id}:a`, text: q.a }, { key: `${q.id}:b`, text: q.b }]))
      .filter((x) => x.text !== p.a);
    const candidates: Candidate[] = [];
    for (const x of pool) {
      const s = screenPair(p.a, x.text);
      if (s.decision !== "forward") continue;
      candidates.push({ key: x.key, a: { sentence: p.a }, b: { sentence: x.text }, judgement: judgementForCombine(s), priority: s.priority });
    }
    counts.push(candidates.length);
    const plan = planForChange(`rev:${p.id}`, candidates, new JudgeBudget({ now: () => 0 }), { aiEnabled: true });
    pendingTotal += plan.pending.length;
    if (p.truth !== "contradiction") continue;
    const own = screenPair(p.a, p.b);
    if (own.decision === "rule_conflict") continue; // shown without the AI: not a selection question
    total++;
    const key = `${p.id}:b`;
    if (plan.call?.keys.includes(key)) hits++;
    else if (own.decision === "forward") {
      const ranked = [...candidates].sort((x, y) => (y.priority ?? 0) - (x.priority ?? 0));
      const rank = ranked.findIndex((c) => c.key === key);
      waited.push({ id: p.id, rank: rank + 1, outrankedBy: rank });
    }
  }
  const sorted = [...counts].sort((x, y) => x - y);
  const pendingCalls = Math.ceil(pendingTotal / 10);
  return {
    changes: pairs.length,
    candidatesPerChange: { min: sorted[0] ?? 0, median: sorted[Math.floor((sorted.length - 1) / 2)] ?? 0, max: sorted.at(-1) ?? 0 },
    budgetedSelectionRecall: [hits, total],
    waited,
    pendingTotal,
    pendingCalls,
    daysAtCap: Math.ceil((pairs.length + pendingCalls) / DAILY_CALL_CAP),
  };
}

export function formatPipeline(title: string, r: PipelineReport, b?: BudgetReport): string {
  const list = (ids: string[]) => (ids.length <= 6 ? ids.join(", ") : `${ids.slice(0, 6).join(", ")}, …`);
  return [
    `${title}: ${r.n} pairs`,
    "| truth | rule conflict | forwarded → AI | excluded |",
    "|---|---|---|---|",
    ...(["contradiction", "compatible", "ambiguous"] as const).map((t) => `| ${t} | ${r.routes[t].rule_conflict.length} | ${r.routes[t].forward.length} | ${r.routes[t].excluded.length}${r.routes[t].excluded.length && t !== "compatible" ? ` (${list(r.routes[t].excluded)})` : ""} |`),
    `- candidate-generation recall ${pct(r.generationRecall)}${b ? ` · budgeted selection recall ${pct(b.budgetedSelectionRecall)}` : ""}`,
    `- with recorded answers (forwarded without one = missed: ${r.forwardedWithoutAnswer}): recall ${pct(r.recall)} · strict ${pct(r.strictRecall)} · precision ${pct(r.precision)} · context FP ${pct(r.contextFP)} · unsupported ${r.unsupported.join(", ") || "none"}`,
    ...r.ruleFalsePositives.map((x) => `- rule false positive ${x.id} (${x.truth}): ${x.reason}`),
    ...r.falseExclusions.map((x) => `- false exclusion ${x.id} (${x.category}, ${x.exclusion}): ${x.reason}`),
    ...(b ? [`- budget: candidates per change ${b.candidatesPerChange.min}/${b.candidatesPerChange.median}/${b.candidatesPerChange.max} (min/median/max) · pending ${b.pendingTotal} → ${b.pendingCalls} Retry calls · ${b.daysAtCap} day(s) at ${DAILY_CALL_CAP} calls/day`, ...b.waited.map((w) => `- waited: ${w.id} ranked ${w.rank} (outranked by ${w.outrankedBy})`)] : []),
  ].join("\n");
}
