/**
 * Scores rules + AI on the consistency evaluation set from a recording (plan §12.5, §12.9 D, §12.14) — offline, as
 * often as needed, at no AI cost. Rules alone are `evaluation.ts`; this is the same set seen through `combine`.
 *
 * Counted as a **conflict call** (for precision and the context false-positive rate): what the user is shown as a
 * conflict — a rule `conflict`, or `likely` (rules possible + the model reads a contradiction). Both still wait for the
 * user's confirmation; nothing is confirmed automatically.
 */
import { routeOf, type Route } from "./candidates";
import { combine, type JudgeAnswer, type Shown } from "./judge";
import type { EvalPair } from "./evaluation";
import { judgePair } from "./rules";

export interface RecordedJudgment {
  answer: JudgeAnswer;
  why?: string;
  suggestion?: string;
}

export type TruthLabel = "contradiction" | "compatible" | "ambiguous";

const CONTEXT = new Set(["temporal", "environment", "scope", "platform", "region", "version"]);
const ratio = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 1000 : null);

/**
 * Which rule results the AI may see: `baseline` — `possible` only (the 2026-11-13 recording); `near_miss` — `possible`
 * and near-misses (§12.15).
 */
export type Routing = "baseline" | "near_miss";

export interface CombinedRow {
  id: string;
  category: string;
  truth: TruthLabel;
  rule: string;
  route: Route;
  /** A routed pair with no recorded answer: awaiting the AI (a replay never makes a call). */
  awaitingAI: boolean;
  ruleContextDiffers: boolean;
  ai?: RecordedJudgment;
  shown: Shown;
  note: string;
}

export interface CombinedReport {
  n: number;
  precision: number | null;
  contextFalsePositiveRate: number | null;
  recall: number | null;
  /** Pairs still shown as `possible` (no AI answer, or the model couldn't tell, or held back by the context guard). */
  unresolvedPossible: number;
  /** Routed near-misses with no recorded answer (not shown; tracked). */
  awaitingAI: number;
  /** Of the true contradictions, the share a rule shows or routes to the AI (the most rules + AI recall can reach). */
  routingRecall: number | null;
  /** Of the true contradictions, the share shown as a conflict or a likely conflict (not merely possible). A candidate
   * awaiting the AI counts as not detected, in this and in `recall`. */
  strictRecall: number | null;
  /** Pairs the rules left possible: how many the model answered. */
  sentToAI: number;
  answered: number;
  /** The model's answer against the provisional label, on the pairs it saw (ambiguous pairs left out). */
  aiDisagreesWithLabel: { id: string; truth: TruthLabel; answer: JudgeAnswer; why?: string }[];
  /** Context pairs where the model said "contradicts", and what the guard did with it. */
  contextContradicts: { id: string; truth: TruthLabel; shown: Shown }[];
  /** Compatible pairs shown as a conflict call — false positives, with the route that produced them and the evidence. */
  falsePositives: { id: string; category: string; route: Route; shown: Shown; note: string }[];
  /** Ambiguous pairs shown as a conflict call — kept apart (left out of precision; neither right nor wrong). */
  ambiguousConflictCalls: string[];
  /** Every rate's numerator and denominator, so no percentage stands alone. */
  counts: { precision: [number, number]; contextFP: [number, number]; recall: [number, number]; strictRecall: [number, number]; routingRecall: [number, number] };
  categories: { category: string; n: number; precision: number | null; recall: number | null }[];
  rows: CombinedRow[];
}

const isConflictCall = (s: Shown) => s === "conflict" || s === "likely";

export function combineAll(pairs: readonly EvalPair[], judgments: ReadonlyMap<string, RecordedJudgment>, routing: Routing = "baseline"): CombinedRow[] {
  return pairs.map((p) => {
    const rule = judgePair(p.a, p.b);
    const route = routeOf(rule);
    const routed = route === "possible" || (routing === "near_miss" && route === "near_miss");
    const ai = routed ? judgments.get(p.id) : undefined;
    const c = combine(routing === "near_miss" ? rule : { ...rule, nearMiss: undefined }, ai);
    return { id: p.id, category: p.category, truth: p.truth, rule: rule.verdict, route, awaitingAI: !!c.awaitingAI, ruleContextDiffers: !!rule.contextDiffers, ...(ai ? { ai } : {}), shown: c.shown, note: c.note };
  });
}

export function evaluateCombined(pairs: readonly EvalPair[], judgments: ReadonlyMap<string, RecordedJudgment>, routing: Routing = "baseline"): CombinedReport {
  const rows = combineAll(pairs, judgments, routing);
  const score = (rs: readonly CombinedRow[]) => {
    const calls = rs.filter((r) => isConflictCall(r.shown) && r.truth !== "ambiguous");
    const contradictions = rs.filter((r) => r.truth === "contradiction");
    return {
      precision: calls.length ? ratio(calls.filter((r) => r.truth === "contradiction").length, calls.length) : null,
      recall: ratio(contradictions.filter((r) => r.shown !== "hidden").length, contradictions.length),
    };
  };
  const context = rows.filter((r) => CONTEXT.has(r.category) && r.truth === "compatible");
  const sent = rows.filter((r) => r.route === "possible" || (routing === "near_miss" && r.route === "near_miss"));
  const contradictions = rows.filter((r) => r.truth === "contradiction");
  const all = score(rows);
  const calls = rows.filter((r) => isConflictCall(r.shown) && r.truth !== "ambiguous");
  const routedOrRule = (r: CombinedRow) => r.route === "rule_conflict" || r.route === "possible" || (routing === "near_miss" && r.route === "near_miss");
  const counts: CombinedReport["counts"] = {
    precision: [calls.filter((r) => r.truth === "contradiction").length, calls.length],
    contextFP: [context.filter((r) => isConflictCall(r.shown)).length, context.length],
    recall: [contradictions.filter((r) => r.shown !== "hidden").length, contradictions.length],
    strictRecall: [contradictions.filter((r) => isConflictCall(r.shown)).length, contradictions.length],
    routingRecall: [contradictions.filter(routedOrRule).length, contradictions.length],
  };
  return {
    counts,
    ambiguousConflictCalls: rows.filter((r) => isConflictCall(r.shown) && r.truth === "ambiguous").map((r) => r.id),
    n: rows.length,
    precision: all.precision,
    contextFalsePositiveRate: ratio(context.filter((r) => isConflictCall(r.shown)).length, context.length),
    recall: all.recall,
    unresolvedPossible: rows.filter((r) => r.shown === "possible").length,
    awaitingAI: rows.filter((r) => r.awaitingAI).length,
    strictRecall: ratio(contradictions.filter((r) => isConflictCall(r.shown)).length, contradictions.length),
    routingRecall: ratio(contradictions.filter((r) => r.route === "rule_conflict" || r.route === "possible" || (routing === "near_miss" && r.route === "near_miss")).length, contradictions.length),
    sentToAI: sent.length,
    answered: sent.filter((r) => r.ai).length,
    aiDisagreesWithLabel: sent
      .filter((r) => r.ai && r.truth !== "ambiguous" && r.ai.answer !== "unclear" && (r.ai.answer === "contradicts") !== (r.truth === "contradiction"))
      .map((r) => ({ id: r.id, truth: r.truth, answer: r.ai!.answer, ...(r.ai!.why ? { why: r.ai!.why } : {}) })),
    contextContradicts: sent.filter((r) => r.ai?.answer === "contradicts" && (r.ruleContextDiffers || CONTEXT.has(r.category))).map((r) => ({ id: r.id, truth: r.truth, shown: r.shown })),
    falsePositives: rows.filter((r) => isConflictCall(r.shown) && r.truth === "compatible").map((r) => ({ id: r.id, category: r.category, route: r.route, shown: r.shown, note: r.note })),
    categories: [...new Set(rows.map((r) => r.category))].map((category) => {
      const rs = rows.filter((r) => r.category === category);
      return { category, n: rs.length, ...score(rs) };
    }),
    rows,
  };
}

/** Truth × route: where each kind of pair goes before any AI answer (the routing confusion matrix). */
export function routingMatrix(pairs: readonly EvalPair[]): Record<TruthLabel, Record<Route, string[]>> {
  const empty = (): Record<Route, string[]> => ({ rule_conflict: [], possible: [], near_miss: [], excluded: [] });
  const m: Record<TruthLabel, Record<Route, string[]>> = { contradiction: empty(), compatible: empty(), ambiguous: empty() };
  for (const p of pairs) m[p.truth][routeOf(judgePair(p.a, p.b))].push(p.id);
  return m;
}

export function formatMatrix(title: string, m: ReturnType<typeof routingMatrix>): string {
  const cell = (ids: string[]) => (ids.length ? `${ids.length}${ids.length <= 4 ? ` (${ids.join(", ")})` : ""}` : "0");
  return [
    `${title} — routing (truth × route)`,
    "| truth | rule conflict | possible → AI | near-miss → AI | excluded |",
    "|---|---|---|---|---|",
    ...(["contradiction", "compatible", "ambiguous"] as const).map((t) => `| ${t} | ${cell(m[t].rule_conflict)} | ${cell(m[t].possible)} | ${cell(m[t].near_miss)} | ${cell(m[t].excluded)} |`),
  ].join("\n");
}

/** A reviewer's decision on a pair's label, stored apart from the evaluation set (the original label is never changed). */
export interface Adjudication {
  id: string;
  originalLabel: TruthLabel;
  decision?: { label: TruthLabel; reason: string; reviewer: string; date: string; provisional?: boolean };
}

/** The pairs with each reviewer decision applied (a copy); pairs without a decision keep their original label. */
export function withAdjudication(pairs: readonly EvalPair[], adjudications: readonly Adjudication[]): EvalPair[] {
  const byId = new Map(adjudications.filter((a) => a.decision).map((a) => [a.id, a.decision!.label] as const));
  return pairs.map((p) => (byId.has(p.id) ? { ...p, truth: byId.get(p.id)! } : p));
}

export interface LabelAgreement {
  n: number;
  /** The two models gave the same label. */
  modelsAgree: number;
  /** …and it is the provisional (author) label too. */
  allThreeAgree: number;
  /** The two models disagree with each other — for human review. */
  modelDisagreements: { id: string; author: TruthLabel; x: TruthLabel; y: TruthLabel }[];
  /** Both models agree with each other but not with the author label — the strongest signal a label may be wrong. */
  modelsAgainstAuthor: { id: string; author: TruthLabel; models: TruthLabel }[];
  /** Pairs a model gave no usable label for. */
  missing: { id: string; model: "x" | "y" }[];
}

/** Agreement of two independent model labellers with each other and with the provisional labels. Never rewrites a label. */
export function labelAgreement(pairs: readonly EvalPair[], x: ReadonlyMap<string, TruthLabel>, y: ReadonlyMap<string, TruthLabel>): LabelAgreement {
  const out: LabelAgreement = { n: pairs.length, modelsAgree: 0, allThreeAgree: 0, modelDisagreements: [], modelsAgainstAuthor: [], missing: [] };
  for (const p of pairs) {
    const lx = x.get(p.id);
    const ly = y.get(p.id);
    if (!lx) out.missing.push({ id: p.id, model: "x" });
    if (!ly) out.missing.push({ id: p.id, model: "y" });
    if (!lx || !ly) continue;
    if (lx !== ly) {
      out.modelDisagreements.push({ id: p.id, author: p.truth, x: lx, y: ly });
      continue;
    }
    out.modelsAgree++;
    if (lx === p.truth) out.allThreeAgree++;
    else out.modelsAgainstAuthor.push({ id: p.id, author: p.truth, models: lx });
  }
  return out;
}

/** The report as a table for the console and the plan. */
export function formatCombined(title: string, r: CombinedReport): string {
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
  const frac = ([n, d]: [number, number]) => `(${n}/${d})`;
  return [
    `${title} (rules + AI): ${r.n} pairs · precision ${pct(r.precision)} ${frac(r.counts.precision)} · context FP ${pct(r.contextFalsePositiveRate)} ${frac(r.counts.contextFP)} · recall ${pct(r.recall)} ${frac(r.counts.recall)} · strict recall ${pct(r.strictRecall)} ${frac(r.counts.strictRecall)} · routing recall ${pct(r.routingRecall)} ${frac(r.counts.routingRecall)} · unresolved possible ${r.unresolvedPossible} · routed ${r.sentToAI} (answered ${r.answered}, awaiting AI ${r.awaitingAI}) · ambiguous shown as conflict ${r.ambiguousConflictCalls.length ? r.ambiguousConflictCalls.join(", ") : "none"}`,
    "| category | n | precision | recall |",
    "|---|---|---|---|",
    ...r.categories.map((c) => `| ${c.category} | ${c.n} | ${pct(c.precision)} | ${pct(c.recall)} |`),
    ...r.aiDisagreesWithLabel.map((d) => `- AI vs label ${d.id}: label ${d.truth}, AI ${d.answer}${d.why ? ` — ${d.why}` : ""}`),
    ...r.contextContradicts.map((d) => `- context + AI "contradicts" ${d.id}: label ${d.truth}, shown ${d.shown}`),
    ...r.falsePositives.map((d) => `- false positive ${d.id} (${d.category}, via ${d.route}): ${d.shown} — ${d.note}`),
  ].join("\n");
}
