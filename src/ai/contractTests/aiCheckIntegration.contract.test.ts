/**
 * Phase 1 close-out — ONE live call through the integrated Stage 4f path (approved 2026-11-16: "live call if needed").
 * Opt-in: LIVE_AI_CHECK=1, and run under the execution envelope (vitest.envelope.config.ts) with its ceilings, so at
 * most one model request, a numeric max_tokens and the token/dollar ceilings are enforced on what actually leaves.
 *
 * The app's own code end to end, nothing re-implemented: `runAICheck` → `runJudgeCheck` (budget, ledger, critical
 * section) → `directJudgeTransport` → the real `/api/ai/judge` route handler (called in-process, both switches on) →
 * `hostDirectJudge` → one direct request to AICredits (gpt-oss-120b, the model of every recording) → the reply read →
 * the ledger → `ConsistencyStore.recordAI`. Two near-miss pairs the live rules alone don't show.
 *
 * Writes `evaluation/update-engine/consistency/phase1-integration/<run>/result.json` (no key, no headers).
 * Never rerun once recorded: the test refuses if the result exists.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AICheckQueue, aiCheckStatus, discoverForAI, runAICheck } from "@/ai/consistency/aiCheck";
import { directJudgeTransport } from "@/ai/consistency/directJudgeTransport";
import { inProcessSection } from "@/ai/consistency/judgeCall";
import { JudgeLedger } from "@/ai/consistency/judgeLedger";
import { ConsistencyStore } from "@/ai/consistency/store";
import { POST } from "@/app/api/ai/judge/route";
import { getByokCredentials } from "./testEnv";

const RUN = process.env.LIVE_AI_CHECK_RUN ?? "2026-11-16-phase1-integration";
const OUT = join(process.cwd(), "evaluation/update-engine/consistency/phase1-integration", RUN);
const MODEL = "openai/gpt-oss-120b";
const live = process.env.LIVE_AI_CHECK === "1";

const CARDS: Record<string, { elementId: string; name: string; sentences: string[] }> = {
  n: { elementId: "n", name: "Ops notes", sentences: ["Backups run every night at 2 a.m.", "Customers can request a refund within 14 days."] },
  x: { elementId: "x", name: "Runbook", sentences: ["Backups run once a week on Sunday."] },
  y: { elementId: "y", name: "Policy", sentences: ["The refund window is 30 days from delivery."] },
};

function memoryMeta() {
  const m = new Map<string, unknown>();
  return { m, get: async <T,>(k: string) => structuredClone(m.get(k)) as T | undefined, set: async (k: string, v: unknown) => void m.set(k, structuredClone(v)) };
}

describe.skipIf(!live)("AI check — one live call through the integrated path", () => {
  beforeAll(() => {
    if (existsSync(join(OUT, "result.json"))) throw new Error(`already recorded: ${OUT} (never rerun)`);
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "on");
    vi.stubEnv("CONSISTENCY_AI_CHECK", "on");
  });
  afterAll(() => vi.unstubAllEnvs());

  it("one request, both pairs classified, readings recorded review-only, budget settled to actual use", async () => {
    const creds = getByokCredentials("aicredits");
    if (!creds) throw new Error("no AICredits credentials in .env.local");
    const connection = { connectionId: "aicredits", model: MODEL, provider: { type: "openai" as const, baseUrl: creds.endpoint ?? "https://api.aicredits.in/v1", apiKey: creds.apiKey } };
    // The browser's fetch to the AI host, served by the real route handler in-process.
    const routeCalls: number[] = [];
    const toRoute = (async (url: string, init: RequestInit) => {
      routeCalls.push(Date.now());
      expect(url).toBe("/api/ai/judge");
      return POST(new NextRequest(`http://localhost${url}`, { method: init.method, headers: init.headers as HeadersInit, body: init.body as string, ...(init.signal ? { signal: init.signal } : {}) }));
    }) as unknown as typeof fetch;

    const meta = memoryMeta();
    const queue = new AICheckQueue(meta);
    const ledger = new JudgeLedger(meta);
    const store = new ConsistencyStore(meta);
    const claims = CARDS.n!.sentences.map((sentence) => ({ elementId: "n", sentence }));
    const found = discoverForAI(claims, (id) => CARDS[id] ?? null, () => ["x", "y"], "rev:live", Date.now());
    expect(found).toHaveLength(2);
    await queue.load("cv");
    await queue.update("cv", found);

    const started = Date.now();
    const run = await runAICheck({ canvasId: "cv", meta, queue, ledger, store, transport: directJudgeTransport(connection, { fetchImpl: toRoute }), stillSaid: () => true, section: inProcessSection() });
    const ms = Date.now() - started;
    const status = await aiCheckStatus({ canvasId: "cv", meta, queue, ledger });
    const pairs = found.map((q) => ({ key: q.key, a: q.a.sentence, b: q.b.sentence, ledger: ledger.get("cv", q.key) }));
    const records = store.list("cv").map((c) => ({ a: c.a.sentence, b: c.b.sentence, status: c.status, by: c.evidence.by, ai: c.ai }));

    mkdirSync(OUT, { recursive: true });
    const result = { run: RUN, at: new Date(started).toISOString(), model: MODEL, endpoint: connection.provider.baseUrl, routeCalls: routeCalls.length, ms, run_result: run, pairs, records, status };
    writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2) + "\n");

    expect(routeCalls).toHaveLength(1);
    expect(run).toMatchObject({ status: "answered", sent: 2, providerRequests: 1 });
    expect(run.classified + run.failed).toBe(2);
    expect(run.usedTokens).toBeGreaterThan(0);
    expect(run.usedTokens!).toBeLessThanOrEqual(2_800);
    expect(status.budget.callsLeft).toBe(49);
    expect(status.budget.tokensLeft).toBe(90_000 - run.usedTokens!);
    // Review-only: every record is `possible` (only the user confirms or dismisses).
    expect(records.every((r) => r.status === "possible")).toBe(true);
    expect(JSON.stringify(result)).not.toContain(creds.apiKey);
  }, 120_000);
});
