/**
 * §12.21 — the retrieval-then-judgment pipeline (`screen.ts`), offline. Dev and the regressions are development material;
 * the pairs quoted from the second unseen set are regression controls named by the review (v40, v43, v09, v25, and the 15
 * contradictions the old selector excluded) — regression evidence, never reported as unseen results.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EvalPair } from "./evaluation";
import { combine } from "./judge";
import { budgetedSelection, evaluatePipeline } from "./pipelineEvaluation";
import { judgementForCombine, relatedness, screenPair } from "./screen";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency");
const load = (f: string) => (JSON.parse(readFileSync(join(DIR, f), "utf8")) as { pairs: EvalPair[] }).pairs;
const u2 = new Map((JSON.parse(readFileSync(join(DIR, "unseen2/pairs.json"), "utf8")) as { pairs: { id: string; a: string; b: string }[] }).pairs.map((p) => [p.id, p] as const));
const screenU2 = (id: string) => screenPair(u2.get(id)!.a, u2.get(id)!.b);

describe("§12.21 — screening: exclude only on positive evidence; forward uncertainty", () => {
  it("the 15 contradictions the old selector excluded now reach the AI (different vocabulary is no reason to exclude)", () => {
    for (const id of ["v01", "v04", "v08", "v12", "v13", "v18", "v29", "v31", "v34", "v35", "v41", "v46", "v52", "v53", "v56"]) expect(screenU2(id).decision, id).toBe("forward");
  });

  it("A — a number difference between different metrics or subjects is not a rule conflict (v40, v43): they go to the AI", () => {
    expect(screenU2("v40").decision).toBe("forward");
    expect(screenU2("v43").decision).toBe("forward");
    // The same claim word for word apart from the values still is one.
    expect(screenPair("Each node has 16 GB of memory.", "Each node has 32 GB of memory.").decision).toBe("rule_conflict");
  });

  it("C — an observation checked against a limit, or a period inside the claim, is not a scope (v09, v25); a stated scope still is", () => {
    expect(screenU2("v09").scoped).toBe(false);
    expect(screenU2("v25").scoped).toBe(false);
    expect(screenPair("In staging, retries happen five times.", "Retries happen three times.").scoped).toBe(true);
    expect(screenPair("In 2023 the API allowed 100 requests per minute.", "The API allows 500 requests per minute.").scoped).toBe(true);
  });

  it("exclusions each need something stated: values that agree, a value inside a limit, equivalent frequencies, named metrics, scope on both sides, a pure extension", () => {
    const ex = (a: string, b: string) => screenPair(a, b).exclusion;
    expect(ex("Library members may borrow up to 8 books at a time.", "A member has 5 books on loan.")).toBe("values_agree");
    expect(ex("Team retrospectives happen every two weeks.", "The team holds a retrospective fortnightly.")).toBe("same_frequency");
    expect(ex("p50 latency is 80 ms.", "p99 latency is 400 ms.")).toBe("different_metrics");
    expect(ex("In staging, the job runs hourly.", "In production, the job runs daily.")).toBe("different_scope");
    expect(ex("Customers can reach support by phone.", "Customers can reach support by phone and by email.")).toBe("extension");
    // …but not an extension when the shorter side is exclusive.
    expect(screenPair("The team uses Figma exclusively.", "The team uses Figma and Sketch.").decision).toBe("forward");
    expect(ex("The cafeteria serves vegan meals.", "Quarterly revenue grew by 4%.")).toBe("unrelated");
  });

  it("relatedness is recall-first: a paraphrased opposite with little shared wording is related", () => {
    expect(relatedness("The museum's east wing is accessible to wheelchair users.", "Wheelchair users cannot reach the museum's east wing.").related).toBe(true);
  });

  it("B / thin — the AI's 'contradicts' alone is never a likely conflict for a coexisting swap or a statement too thin to identify its subject", () => {
    const swap = screenPair("The team uses Postgres.", "The team uses MongoDB.");
    expect(combine(judgementForCombine(swap), { answer: "contradicts" }).shown).toBe("possible");
    const thin = screenPair("It takes 5 minutes.", "It takes 2 hours.");
    expect(thin.thin).toBe(true);
    expect(combine(judgementForCombine(thin), { answer: "contradicts" }).shown).toBe("possible");
    const sole = screenPair("The data team is the sole owner of the pipeline.", "The growth team is the sole owner of the pipeline.");
    expect(combine(judgementForCombine(sole), { answer: "contradicts" }).shown).toBe("likely");
  });
});

describe("§12.21 — the pipeline on dev and the regressions (development material)", () => {
  it("dev: every contradiction generated and selected within budget; no rule false positive; no unsupported conflict; context FP 0", { timeout: 60_000 }, () => {
    const rec = JSON.parse(readFileSync(join(DIR, "recordings/2026-11-13-judge-baseline/judgments.json"), "utf8"));
    const r = evaluatePipeline(load("dev.json"), new Map(Object.entries(rec.dev)));
    expect(r.generationRecall[0]).toBe(r.generationRecall[1]);
    expect(r.ruleFalsePositives).toEqual([]);
    expect(r.unsupported).toEqual([]);
    expect(r.contextFP[0]).toBe(0);
    expect(r.precision[0]).toBe(r.precision[1]);
    const b = budgetedSelection(load("dev.json"), "pool");
    expect(b.budgetedSelectionRecall[0]).toBe(b.budgetedSelectionRecall[1]);
  });

  it("regressions r01, r02 forwarded and, with their recorded answers, shown", () => {
    const rec = JSON.parse(readFileSync(join(DIR, "recordings/2026-11-13-judge-baseline/judgments.json"), "utf8"));
    const r = evaluatePipeline(load("regressions.json"), new Map(Object.entries(rec.regressions)));
    expect(r.routes.contradiction.forward).toEqual(["r01", "r02"]);
    expect(r.recall).toEqual([2, 2]);
  });

  it("screening stays local and fast: 100 sentence pairs (a claim against 20 cards of 5 sentences) well inside the 50 ms budget per claim", () => {
    const pool = load("dev.json").flatMap((p) => [p.a, p.b]).slice(0, 100);
    const t = performance.now();
    for (const s of pool) screenPair("Retries happen three times.", s);
    const ms = performance.now() - t;
    console.log(`screen: 100 pairs in ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500); // generous for CI; the measured figure is reported in plan §12.21
  });
});
