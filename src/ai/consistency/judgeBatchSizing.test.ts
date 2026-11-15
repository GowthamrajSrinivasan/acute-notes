/**
 * Batch size, from existing recordings only (intelligent-update-engine-plan §12.27, review item 4). No network, no model:
 * latency and token use come from the five recorded runs; reservations are computed exactly with `callTokens` on the
 * unseen4 pairs in their routed order. Prints the comparison; asserts the facts the report relies on.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { callTokens, DAILY_CALL_CAP, DAILY_TOKEN_CAP } from "./candidates";
import { JUDGE_BUDGET, JUDGE_CALL_CEILING, JUDGE_CALL_TIMEOUT_MS, type JudgeInput } from "./judge";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency");
const read = <T,>(p: string) => JSON.parse(readFileSync(join(DIR, p), "utf8")) as T;

interface Call { keys?: string[]; pairIds?: string[]; ms?: number; status?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }
const RUNS = ["recordings/2026-11-13-judge-baseline", "unseen/runs/2026-11-13-unseen", "unseen2/runs/2026-11-13-unseen2", "unseen3/runs/2026-11-14-unseen3", "unseen4/runs/2026-11-15-unseen4"];

function observations() {
  const answered: { run: string; pairs: number; ms: number; completion: number }[] = [];
  const timedOut: { run: string; pairs: number; ms: number }[] = [];
  for (const run of RUNS) {
    const calls = read<Call[] | { calls: Call[] }>(`${run}/calls.json`);
    for (const c of Array.isArray(calls) ? calls : calls.calls) {
      const pairs = (c.keys ?? c.pairIds ?? []).length;
      if (c.usage?.completion_tokens && c.ms) answered.push({ run, pairs, ms: c.ms, completion: c.usage.completion_tokens });
      else if (c.status === "call_error" && c.ms) timedOut.push({ run, pairs, ms: c.ms });
    }
  }
  return { answered, timedOut };
}

/** Least squares y = a + b·x. */
function fit(xs: number[], ys: number[]) {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return { a: my - b * mx, b };
}

describe("§12.27 batch size, from recordings only", () => {
  it("compares 2–10 pairs a call: latency, the worst case at the output cap, calls and reserved tokens for unseen4's 72 pairs, and daily capacity", () => {
    const { answered, timedOut } = observations();
    // The current provider speed: unseen4 is the only run with the §12.24 prompt and the latest latency.
    const now = answered.filter((o) => o.run.startsWith("unseen4"));
    const msPerToken = Math.max(...now.map((o) => o.ms / o.completion)); // the slowest observed generation rate
    const tokensFit = fit(now.map((o) => o.pairs), now.map((o) => o.completion));
    const latencyFit = fit(answered.map((o) => o.completion), answered.map((o) => o.ms));

    // Exact reservations: unseen4's forwarded pairs in their routed order, split into calls of k.
    const pairs = new Map(read<{ pairs: { id: string; a: string; b: string }[] }>("unseen4/pairs.json").pairs.map((p) => [p.id, p] as const));
    const order = read<{ plannedCalls: { keys: string[] }[] }>("unseen4/runs/2026-11-15-unseen4/routing.json").plannedCalls.flatMap((c) => c.keys);
    const rows = [10, 8, 6, 5, 4, 3, 2].map((k) => {
      const calls: number[] = [];
      for (let i = 0; i < order.length; i += k) {
        const input: JudgeInput = { pairs: order.slice(i, i + k).map((id, j) => ({ ref: `p${j + 1}`, a: { sentence: pairs.get(id)!.a }, b: { sentence: pairs.get(id)!.b } })) };
        calls.push(callTokens(input));
      }
      const fullCall = calls[0]!;
      const typicalCompletion = tokensFit.a + tokensFit.b * k;
      const capCompletion = k * JUDGE_BUDGET.answerTokensPerPair + JUDGE_BUDGET.reasoningTokens;
      const perDay = Math.min(DAILY_CALL_CAP, Math.floor(DAILY_TOKEN_CAP / fullCall));
      return {
        k,
        typicalS: (typicalCompletion * msPerToken) / 1000,
        worstAtCapS: (capCompletion * msPerToken) / 1000,
        calls: calls.length,
        reserved: calls.reduce((s, t) => s + t, 0),
        maxCall: Math.max(...calls),
        callsPerDay: perDay,
        pairsPerDay: perDay * k,
      };
    });

    const table = [
      `Observations: ${answered.length} answered calls in ${RUNS.length} runs; ${timedOut.length} timed out (all unseen4, all 10 pairs, at ≈ 30 s).`,
      `unseen4 generation rate: ${now.map((o) => (o.ms / o.completion).toFixed(1)).join(", ")} ms/token → slowest ${msPerToken.toFixed(1)} ms/token used below.`,
      `unseen4 completion tokens ≈ ${tokensFit.a.toFixed(0)} + ${tokensFit.b.toFixed(1)} × pairs. All runs: latency ≈ ${(latencyFit.a / 1000).toFixed(1)} s + ${latencyFit.b.toFixed(1)} ms × completion tokens.`,
      "",
      "| Pairs a call | Typical latency | Worst at the output cap | Calls for 72 pairs | Reserved tokens (72 pairs) | Largest call | Calls a day (90k / 50) | Pairs a day |",
      "|---|---|---|---|---|---|---|---|",
      ...rows.map((r) => `| ${r.k} | ${r.typicalS.toFixed(1)} s | ${r.worstAtCapS.toFixed(1)} s | ${r.calls} | ${r.reserved.toLocaleString("en-GB")} | ${r.maxCall.toLocaleString("en-GB")} | ${r.callsPerDay} | ${r.pairsPerDay} |`),
    ].join("\n");
    console.log(`\n${table}\n`);

    // The facts the report relies on.
    expect(answered.length).toBeGreaterThanOrEqual(30);
    expect(timedOut.length).toBe(4);
    expect(timedOut.every((t) => t.pairs === 10 && t.ms >= 30_000)).toBe(true);
    for (const r of rows) {
      expect(r.maxCall).toBeLessThanOrEqual(JUDGE_CALL_CEILING);
      // Even a call that uses its whole output allowance at the slowest observed rate finishes well inside 90 s.
      expect(r.worstAtCapS * 1000).toBeLessThan(JUDGE_CALL_TIMEOUT_MS * 0.6);
    }
    // At the slowest observed rate, every size's worst case at the cap passes the OLD 30 s limit: batch size alone
    // couldn't have fixed it — the reasoning reserve (700 tokens) dominates small calls.
    expect(rows.every((r) => r.worstAtCapS > 30)).toBe(true);
    const r10 = rows.find((r) => r.k === 10)!;
    const r5 = rows.find((r) => r.k === 5)!;
    expect(r5.reserved).toBeGreaterThan(r10.reserved * 1.4);
    expect(r5.pairsPerDay).toBeLessThan(r10.pairsPerDay);
  });
});
