/**
 * Opt-in (UNSEEN5_PROBE=1): reads the frozen unseen5 recording with the frozen scorer and prints per-pair outcomes and the
 * budget-constrained figures (the pair the budget simulation leaves waiting — y24 — counted as pending, i.e. missed).
 * Reporting only: no model call, nothing written, no tuning.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePipeline } from "./pipelineEvaluation";

const DIR = join(process.cwd(), "evaluation/update-engine/consistency/unseen5");
const read = <T,>(f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as T;

describe.skipIf(process.env.UNSEEN5_PROBE !== "1")("unseen5 report probe", () => {
  it("per-pair pipeline outcomes, all answered and budget-constrained", () => {
    const pairs = read<{ pairs: { id: string; a: string; b: string; batch?: string }[] }>("pairs.json").pairs;
    const labels = read<{ labels: Record<string, { label: "contradiction" | "compatible" | "ambiguous" }> }>("labels.json").labels;
    const cats = read<{ drafts: Record<string, { category: string }> }>("author-draft-key.json").drafts;
    const judgments = read<Record<string, { answer: string; why?: string }>>("runs/2026-11-15-unseen5/judgments.json");
    const routing = read<{ pipeline: { budgetPool: { waited: { id: string }[] } } }>("runs/2026-11-15-unseen5/routing.json");
    const evalPairs = pairs.map((p) => ({ id: p.id, a: p.a, b: p.b, category: cats[p.id]!.category, truth: labels[p.id]!.label, expected: "compatible" as const, rationale: "" }));
    const all = new Map(Object.entries(judgments)) as never;
    const waited = new Set(routing.pipeline.budgetPool.waited.map((w) => w.id));
    const budgeted = new Map(Object.entries(judgments).filter(([k]) => !waited.has(k))) as never;
    const A = evaluatePipeline(evalPairs as never, all) as unknown as { rows: { id: string; truth: string; shown: string }[]; recall: number[]; strictRecall: number[]; precision: number[]; contextFalsePositives: number[] } & Record<string, unknown>;
    const B = evaluatePipeline(evalPairs as never, budgeted) as unknown as typeof A;
    const contra = A.rows.filter((r) => r.truth === "contradiction");
    const byShown: Record<string, string[]> = {};
    for (const r of contra) (byShown[r.shown] ??= []).push(r.id);
    const nonContraConflict = A.rows.filter((r) => r.truth !== "contradiction" && (r.shown === "conflict" || r.shown === "likely")).map((r) => `${r.id}:${r.truth}:${r.shown}`);
    const pick = (x: typeof A) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== "rows" && k !== "byCategory"));
    console.log(JSON.stringify({ waited: [...waited], contradictionsByShown: byShown, nonContradictionsShownAsConflict: nonContraConflict, allAnswered: pick(A), budgetConstrained: pick(B) }, null, 1));
    expect(contra).toHaveLength(40);
  });
});
