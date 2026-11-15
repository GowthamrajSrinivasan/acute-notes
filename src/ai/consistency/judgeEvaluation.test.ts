/**
 * Stage 4f offline replay (§12.5: record once, replay at no cost): scores rules + AI from each recording under
 * `evaluation/update-engine/consistency/recordings/`, and checks the recording kept the authorized limits. Reports only:
 * passing a gate turns nothing on (§12.9 decision 4). Also the scoring itself, on hand-made judgments, and the two known
 * misses kept as regression cases.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseJsonReply } from "@/ai/runtime";
import { JudgeBudget, planForChange, routeOf } from "./candidates";
import type { EvalPair } from "./evaluation";
import { JUDGE_LIMITS, judgeConsistencyTask } from "./judge";
import { evaluateCombined, formatCombined, formatMatrix, labelAgreement, routingMatrix, withAdjudication, type Adjudication, type RecordedJudgment, type TruthLabel } from "./judgeEvaluation";
import { judgePair } from "./rules";
import { ConsistencyStore } from "./store";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency");
const load = (file: string) => (JSON.parse(readFileSync(join(DIR, file), "utf8")) as { pairs: EvalPair[] }).pairs;
const pair = (id: string, category: string, a: string, b: string, truth: EvalPair["truth"]): EvalPair => ({ id, category, a, b, truth, expected: "possible", rationale: "" });

describe("Stage 4f — scoring rules + AI", () => {
  const pairs = [
    pair("x1", "ownership", "The payments team is the sole owner of the gateway.", "The platform team is the sole owner of the gateway.", "contradiction"),
    pair("x2", "environment", "In staging, retries happen five times.", "Retries happen three times.", "compatible"),
    pair("x3", "numeric", "Retries happen three times.", "The worker retries five times.", "contradiction"),
  ];

  it("counts likely as a conflict call, hides on compatible answers, and reports context contradictions the guard held back", () => {
    const r = evaluateCombined(pairs, new Map<string, RecordedJudgment>([["x1", { answer: "contradicts" }], ["x2", { answer: "contradicts" }]]));
    expect(r.rows.map((x) => x.shown)).toEqual(["likely", "possible", "conflict"]);
    expect([r.precision, r.contextFalsePositiveRate, r.recall, r.unresolvedPossible, r.sentToAI, r.answered]).toEqual([1, 0, 1, 1, 2, 2]);
    expect(r.contextContradicts).toEqual([{ id: "x2", truth: "compatible", shown: "possible" }]);
    expect(r.aiDisagreesWithLabel.map((d) => d.id)).toEqual(["x2"]);
    const hidden = evaluateCombined(pairs, new Map<string, RecordedJudgment>([["x1", { answer: "compatible" }]]));
    expect(hidden.recall).toBe(0.5); // the model hid a true contradiction
  });

  it("label agreement: model vs model, and both models against the provisional label — never rewriting it", () => {
    const x = new Map<string, TruthLabel>([["x1", "contradiction"], ["x2", "compatible"], ["x3", "contradiction"]]);
    const y = new Map<string, TruthLabel>([["x1", "contradiction"], ["x2", "contradiction"]]);
    const a = labelAgreement(pairs, x, y);
    expect([a.modelsAgree, a.allThreeAgree]).toEqual([1, 1]);
    expect(a.modelDisagreements.map((d) => d.id)).toEqual(["x2"]);
    expect(a.missing).toEqual([{ id: "x3", model: "y" }]);
    expect(pairs[1]!.truth).toBe("compatible");
  });

  it("the two known misses: the rules still don't show them (verdict unchanged), but both now route to the AI as near-misses", () => {
    const r = load("regressions.json");
    expect(r.map((p) => p.id)).toEqual(["r01", "r02"]);
    for (const p of r) expect(judgePair(p.a, p.b).verdict).toBe(p.expected);
    const m = routingMatrix(r);
    expect(m.contradiction.near_miss).toEqual(["r01", "r02"]);
    // Without an answer they wait for the AI (tracked, not shown); with "contradicts" they're shown as likely conflicts.
    expect(evaluateCombined(r, new Map(), "near_miss").awaitingAI).toBe(2);
    const answered = evaluateCombined(r, new Map<string, RecordedJudgment>([["r01", { answer: "contradicts" }], ["r02", { answer: "contradicts" }]]), "near_miss");
    expect([answered.recall, answered.rows.map((x) => x.shown)]).toEqual([1, ["likely", "likely"]]);
    expect(evaluateCombined(r, new Map<string, RecordedJudgment>([["r01", { answer: "contradicts" }]])).recall).toBe(0); // baseline routing never sends them
  });

  it("priority on the set: every dev + regression candidate in one change — the one 10-pair call takes all the contradictions; harmless context pairs wait", () => {
    const pairs = [...load("dev.json"), ...load("regressions.json")];
    const truth = new Map(pairs.map((p) => [p.id, p.truth] as const));
    const plan = planForChange("one-change", pairs.map((p) => ({ key: p.id, a: { sentence: p.a }, b: { sentence: p.b }, judgement: judgePair(p.a, p.b) })), new JudgeBudget({ now: () => 0 }), { aiEnabled: true });
    const routedContradictions = pairs.filter((p) => p.truth === "contradiction" && ["possible", "near_miss"].includes(routeOf(judgePair(p.a, p.b)))).map((p) => p.id);
    expect(routedContradictions.every((id) => plan.call!.keys.includes(id))).toBe(true);
    expect(plan.pending.every((p) => truth.get(p.key) === "compatible" && p.reason === "over_call_limit")).toBe(true);
    console.log(`one change, all candidates: call ${plan.call!.keys.join(", ")} · pending ${plan.pending.length} (all compatible, over the call limit)`);
  });

  it("dev: near-miss routing excludes every compatible pair the rules exclude today (no new routed compatible pair)", () => {
    const m = routingMatrix(load("dev.json"));
    expect(m.compatible.near_miss).toEqual([]);
    expect(m.ambiguous.near_miss).toEqual([]);
  });

  it("adjudication: stored apart, original labels untouched, decisions applied only as an overlay", () => {
    const file = JSON.parse(readFileSync(join(DIR, "adjudication.json"), "utf8")) as { entries: (Adjudication & { split: string; a: string; b: string })[] };
    const byId = new Map([...load("dev.json"), ...load("heldout.json"), ...load("regressions.json")].map((p) => [p.id, p] as const));
    for (const e of file.entries) {
      const p = byId.get(e.id)!;
      expect([e.originalLabel, e.a, e.b]).toEqual([p.truth, p.a, p.b]);
    }
    expect(file.entries.filter((e) => e.decision).map((e) => e.id)).toEqual(["d19", "d37", "d55", "d56", "d01", "d17", "d21", "h07", "h08", "h14", "h19", "r02"]);
    expect(withAdjudication(load("regressions.json"), file.entries).find((p) => p.id === "r02")!.truth).toBe("ambiguous");
    expect(load("regressions.json").find((p) => p.id === "r02")!.truth).toBe("contradiction"); // the regression file is unchanged
    const dev = load("dev.json");
    const over = withAdjudication(dev, file.entries);
    expect(over.find((p) => p.id === "d19")!.truth).toBe("ambiguous");
    expect(dev.find((p) => p.id === "d19")!.truth).toBe("contradiction"); // the set itself is unchanged
  });
});

const RECORDINGS = join(DIR, "recordings");
const runs = existsSync(RECORDINGS) ? readdirSync(RECORDINGS).filter((d) => existsSync(join(RECORDINGS, d, "meta.json"))) : [];

describe.skipIf(!runs.length)("Stage 4f — replay of the recordings", () => {
  for (const run of runs) {
    it(`${run}: kept the authorized limits, and its rules + AI scores (reported, never a switch)`, () => {
      const read = <T,>(f: string) => JSON.parse(readFileSync(join(RECORDINGS, run, f), "utf8")) as T;
      const calls = read<{ status: string; pairIds: string[]; purpose: string; split: string; usage?: { total_tokens?: number } }[]>("calls.json").filter((c) => c.status !== "skipped");
      const judgments = read<Record<string, Record<string, RecordedJudgment>>>("judgments.json");
      const labels = read<Record<string, Record<string, { label: TruthLabel }>>>("labels.json");
      expect(calls.length).toBeLessThanOrEqual(50);
      for (const c of calls) expect(c.pairIds.length).toBeLessThanOrEqual(JUDGE_LIMITS.pairs);
      // The held-out split was classified once: every held-out pair in at most one classify call.
      const heldoutIds = calls.filter((c) => c.purpose === "classify" && c.split === "heldout").flatMap((c) => c.pairIds);
      expect(new Set(heldoutIds).size).toBe(heldoutIds.length);
      const over = calls.filter((c) => (c.usage?.total_tokens ?? 0) > JUDGE_LIMITS.totalTokens).length;
      console.log(`${run}: ${calls.length} calls; ${over} over ${JUDGE_LIMITS.totalTokens} tokens`);
      // As recorded (baseline routing: possible pairs only), every split.
      // (The held-out split is not re-scored here: §12.19.)
      for (const split of ["dev", "regressions"] as const) {
        console.log(formatCombined(`${run} ${split} [baseline routing]`, evaluateCombined(load(`${split}.json`), new Map(Object.entries(judgments[split] ?? {})))));
      }
      // §12.15 near-miss routing, replayed from the same answers (no call): dev and regressions only — the held-out split
      // isn't re-evaluated here (it was reported once, plan §12.15).
      for (const split of ["dev", "regressions"] as const) {
        console.log(formatMatrix(`${run} ${split}`, routingMatrix(load(`${split}.json`))));
        console.log(formatCombined(`${run} ${split} [near-miss routing]`, evaluateCombined(load(`${split}.json`), new Map(Object.entries(judgments[split] ?? {})), "near_miss")));
      }
      // The same replays under the reviewer's adjudicated labels (an overlay; the sets and the recording are unchanged).
      const adjudications = (JSON.parse(readFileSync(join(DIR, "adjudication.json"), "utf8")) as { entries: Adjudication[] }).entries;
      for (const split of ["dev", "regressions"] as const) {
        const adjudicated = withAdjudication(load(`${split}.json`), adjudications);
        console.log(formatMatrix(`${run} ${split} [adjudicated labels]`, routingMatrix(adjudicated)));
        for (const routing of ["baseline", "near_miss"] as const) console.log(formatCombined(`${run} ${split} [adjudicated labels, ${routing} routing]`, evaluateCombined(adjudicated, new Map(Object.entries(judgments[split] ?? {})), routing)));
      }
      // Latency, the parts measurable offline: the provider's (recorded), parsing + validation and the store update (measured here).
      const classify = read<{ purpose: string; raw?: string; ms: number; status: string }[]>("calls.json").filter((c) => c.purpose === "classify" && c.status === "ok");
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) for (const c of classify) judgeConsistencyTask.outputSchema.safeParse(parseJsonReply(c.raw ?? ""));
      const parseMs = (performance.now() - t0) / (20 * classify.length);
      const store = new ConsistencyStore({ get: async () => undefined, set: async () => undefined });
      const t1 = performance.now();
      for (let i = 0; i < 20; i++) store.record(`cv${i}`, "rev:1", Array.from({ length: 10 }, (_, k) => ({ a: { elementId: `a${k}`, sentence: `Retries happen ${k} times.`, cardName: "A" }, b: { elementId: `b${k}`, sentence: `The worker retries ${k + 1} times.`, cardName: "B" }, kind: "differs" as const, strength: "possible" as const, reason: "r" })));
      const storeMs = (performance.now() - t1) / 20;
      const provider = classify.map((c) => c.ms).sort((x, y) => x - y);
      console.log(`${run} latency per call: provider p50 ${provider[Math.floor((provider.length - 1) / 2)]} ms (recorded; max ${provider.at(-1)}) · parse + validate ${parseMs.toFixed(2)} ms · store update (10 pairs) ${storeMs.toFixed(2)} ms · queue wait and edit-to-visible: not measurable until wired (not authorized)`);
      expect(parseMs).toBeLessThan(50);
      const [mx, my] = Object.keys(labels);
      if (mx && my) {
        const m = (k: string) => new Map(Object.entries(labels[k]!).map(([id, v]) => [id, v.label] as const));
        const all = [...load("dev.json"), ...load("heldout.json"), ...load("regressions.json")];
        const a = labelAgreement(all, m(mx), m(my));
        console.log(`${run} labels (${mx} / ${my}): models agree ${a.modelsAgree}/${a.n}, all three ${a.allThreeAgree}, model disagreements ${a.modelDisagreements.length}, models against the provisional label ${a.modelsAgainstAuthor.length}, missing ${a.missing.length}`);
      }
    });
  }
});
