/**
 * Pins the Phase 1 close-out live verification (2026-11-16): ONE call through the integrated Stage 4f path
 * (`contractTests/aiCheckIntegration.contract.test.ts`, under the execution envelope). Offline: reads the recorded result
 * only. Never rerun — the recorder refuses when the result exists.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "evaluation/update-engine/consistency/phase1-integration/2026-11-16-phase1-integration");
const read = <T,>(f: string) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as T;

describe("Phase 1 integration — the recorded live call", () => {
  const r = read<{ routeCalls: number; run_result: { status: string; sent: number; classified: number; failed: number; recorded: number; usedTokens: number; providerRequests: number }; pairs: { ledger: { state: string; answer?: string; attempts: number } }[]; records: { status: string; by: string; ai: { answer: string; shown: string } }[]; status: { budget: { callsLeft: number; tokensLeft: number }; backlog: { pendingPairs: number } } }>("result.json");
  const e = read<{ limits: { maxRequests: number; maxTokens: number; maxUsd: number }; totals: { sent: number; refused: number; spentTokens: number; spentUsdUpperBound: number }; log: { maxTokens: number }[] }>("envelope.json");

  it("one route call, one provider request, inside the envelope's ceilings", () => {
    expect(r.routeCalls).toBe(1);
    expect(r.run_result).toEqual({ status: "answered", sent: 2, classified: 2, failed: 0, recorded: 2, usedTokens: 1055, providerRequests: 1 });
    expect(e.limits).toMatchObject({ maxRequests: 1, maxTokens: 3000, maxUsd: 0.01 });
    expect(e.totals).toMatchObject({ sent: 1, refused: 0, spentTokens: 1055 });
    expect(e.totals.spentUsdUpperBound).toBeLessThan(0.001);
    expect(e.log[0]!.maxTokens).toBe(2 * 60 + 700);
  });

  it("both pairs classified once; readings recorded review-only (possible, found by the AI check); budget settled to actual use", () => {
    expect(r.pairs.map((p) => [p.ledger.state, p.ledger.answer, p.ledger.attempts])).toEqual([
      ["classified", "contradicts", 1],
      ["classified", "unclear", 1],
    ]);
    expect(r.records.map((c) => [c.status, c.by, c.ai.answer, c.ai.shown])).toEqual([
      ["possible", "ai", "contradicts", "likely"],
      ["possible", "ai", "unclear", "possible"],
    ]);
    expect(r.status.budget).toEqual({ callsLeft: 49, tokensLeft: 90_000 - 1055, dailyCalls: 50, dailyTokens: 90_000 });
    expect(r.status.backlog.pendingPairs).toBe(0);
  });

  it("no credential in the recorded files", () => {
    for (const f of ["result.json", "envelope.json"]) expect(readFileSync(join(DIR, f), "utf8")).not.toMatch(/sk-[A-Za-z0-9]{8,}|Bearer /);
  });
});
