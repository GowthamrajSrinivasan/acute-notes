/**
 * Scores the tier-1 rules on the consistency evaluation set (intelligent-update-engine-plan §12.5, §12.9 D): overall and
 * per category, rules alone (rules + AI is measured once Stage 4f is authorized).
 */
import { judgePair, type Verdict } from "./rules";

export interface EvalPair {
  id: string;
  category: string;
  a: string;
  b: string;
  truth: "contradiction" | "compatible" | "ambiguous";
  expected: Verdict;
  rationale: string;
}

export interface CategoryScore {
  category: string;
  n: number;
  /** Pairs whose verdict is the one expected. */
  matches: number;
  /** Of the pairs called `conflict`, how many are true contradictions (null: none called conflict). */
  precision: number | null;
  /** Of the true contradictions, how many are shown (`conflict` or `possible`) (null: none in the category). */
  recall: number | null;
  calledConflict: number;
}

export interface EvalReport {
  n: number;
  /** Of every pair called `conflict`, the share that are true contradictions. */
  rulePrecision: number | null;
  /** Of the compatible temporal / environment / scope pairs, the share called `conflict`. */
  contextFalsePositiveRate: number | null;
  /** Of the true contradictions, the share shown at all. */
  recall: number | null;
  /** Of the compatible pairs, the share shown as `possible` (noise the user or the AI tier has to look at). */
  possibleOnCompatible: number | null;
  matches: number;
  categories: CategoryScore[];
  misses: { id: string; category: string; expected: Verdict; got: Verdict; reason: string }[];
}

const CONTEXT = new Set(["temporal", "environment", "scope", "platform", "region", "version"]);
const ratio = (num: number, den: number) => (den ? Math.round((num / den) * 1000) / 1000 : null);

export function evaluate(pairs: readonly EvalPair[]): EvalReport {
  const judged = pairs.map((p) => ({ p, j: judgePair(p.a, p.b) }));
  const score = (rows: typeof judged) => {
    const conflicts = rows.filter((r) => r.j.verdict === "conflict");
    const contradictions = rows.filter((r) => r.p.truth === "contradiction");
    return {
      precision: conflicts.length ? ratio(conflicts.filter((r) => r.p.truth === "contradiction").length, conflicts.filter((r) => r.p.truth !== "ambiguous").length) : null,
      recall: ratio(contradictions.filter((r) => r.j.verdict !== "compatible").length, contradictions.length),
      calledConflict: conflicts.length,
    };
  };
  const categories = [...new Set(pairs.map((p) => p.category))].map((category) => {
    const rows = judged.filter((r) => r.p.category === category);
    return { category, n: rows.length, matches: rows.filter((r) => r.j.verdict === r.p.expected).length, ...score(rows) };
  });
  const all = score(judged);
  const context = judged.filter((r) => CONTEXT.has(r.p.category) && r.p.truth === "compatible");
  const compatible = judged.filter((r) => r.p.truth === "compatible");
  return {
    n: pairs.length,
    rulePrecision: all.precision,
    contextFalsePositiveRate: ratio(context.filter((r) => r.j.verdict === "conflict").length, context.length),
    recall: all.recall,
    possibleOnCompatible: ratio(compatible.filter((r) => r.j.verdict === "possible").length, compatible.length),
    matches: judged.filter((r) => r.j.verdict === r.p.expected).length,
    categories,
    misses: judged.filter((r) => r.j.verdict !== r.p.expected).map((r) => ({ id: r.p.id, category: r.p.category, expected: r.p.expected, got: r.j.verdict, reason: r.j.reason })),
  };
}

/** The report as a table for the console and the plan. */
export function formatReport(title: string, r: EvalReport): string {
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const rows = r.categories.map((c) => `| ${c.category} | ${c.n} | ${c.matches}/${c.n} | ${pct(c.precision)} | ${pct(c.recall)} |`);
  return [
    `${title}: ${r.n} pairs · rule precision ${pct(r.rulePrecision)} · context FP ${pct(r.contextFalsePositiveRate)} · recall (rules alone) ${pct(r.recall)} · possible on compatible ${pct(r.possibleOnCompatible)} · matches ${r.matches}/${r.n}`,
    "| category | n | matches expected | precision (conflict) | recall (shown) |",
    "|---|---|---|---|---|",
    ...rows,
    ...r.misses.map((m) => `- ${m.id} (${m.category}): expected ${m.expected}, got ${m.got} — ${m.reason}`),
  ].join("\n");
}
