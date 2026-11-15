/**
 * The execution-reliability check (intelligent-update-engine-plan §12.29 P2) — PAID, ONE run, separately authorized
 * (2026-11-15 review: ≤ 6 calls, ≤ 16,800 reserved tokens, ≤ $0.02, gpt-oss-120b on AICredits, unseen4's settings, no
 * retries, no paid reruns). An execution check only: the workload has no labels and no accuracy is reported.
 *
 *   CONSISTENCY_RELIABILITY_RUN=2026-11-15-reliability CONSISTENCY_RELIABILITY_APPROVED_BY="<name>" \
 *     CONSISTENCY_RELIABILITY_MAX_CALLS=6 CONSISTENCY_RELIABILITY_MAX_TOKENS=16800 CONSISTENCY_RELIABILITY_MAX_USD=0.02 \
 *     npx vitest run --config vitest.contract.config.ts consistencyReliability
 *
 * Refuses unless every file in reliability/FREEZE.json still has its frozen hash, every ceiling is set, and NO earlier
 * run exists (any folder under reliability/runs/ — the approval covers one run). A `started.json` marker is written
 * before the first request, so even an interrupted run blocks a second one.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openAICompatibleJudgeTransport } from "./judgeHttpTransport";
import { formatReliability, RELIABILITY_LIMITS, runReliabilityCheck, type Exchange, type WorkloadPair } from "./reliabilityHarness";
import { getByokCredentials } from "./testEnv";
import { countModelRequestsOnTheWire } from "./wireCounter";

const ROOT = process.cwd();
const DIR = join(ROOT, "evaluation", "update-engine", "consistency", "reliability");
const RUNS = join(DIR, "runs");
const RUN = process.env.CONSISTENCY_RELIABILITY_RUN ?? "";
const RUN_DIR = join(RUNS, RUN);
const APPROVED_BY = (process.env.CONSISTENCY_RELIABILITY_APPROVED_BY ?? "").trim();
const MAX_CALLS = Math.min(RELIABILITY_LIMITS.calls, Number(process.env.CONSISTENCY_RELIABILITY_MAX_CALLS) || 0);
const MAX_TOKENS = Math.min(RELIABILITY_LIMITS.tokens, Number(process.env.CONSISTENCY_RELIABILITY_MAX_TOKENS) || 0);
const MAX_USD = Math.min(RELIABILITY_LIMITS.usd, Number(process.env.CONSISTENCY_RELIABILITY_MAX_USD) || 0);
const MODEL = "openai/gpt-oss-120b";
const ENDPOINT = "https://api.aicredits.in/v1";
const creds = getByokCredentials("aicredits");

const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function refusal(): string {
  if (!RUN) return "CONSISTENCY_RELIABILITY_RUN is not set";
  if (!/^\d{4}-\d{2}-\d{2}-reliability$/.test(RUN)) return "CONSISTENCY_RELIABILITY_RUN must look like 2026-11-15-reliability";
  if (!existsSync(join(DIR, "FREEZE.json"))) return "reliability/FREEZE.json is missing: freeze the harness first";
  const freeze = JSON.parse(readFileSync(join(DIR, "FREEZE.json"), "utf8")) as { files: Record<string, string> };
  const changed = Object.entries(freeze.files).filter(([f, h]) => !existsSync(join(ROOT, f)) || sha(join(ROOT, f)) !== h).map(([f]) => f);
  if (changed.length) return `changed since the freeze: ${changed.join(", ")}`;
  if (existsSync(RUNS) && readdirSync(RUNS).length) return `a reliability run already exists (${readdirSync(RUNS).join(", ")}): no paid reruns`;
  if (!APPROVED_BY) return "CONSISTENCY_RELIABILITY_APPROVED_BY is not set";
  if (!MAX_CALLS) return "CONSISTENCY_RELIABILITY_MAX_CALLS is not set";
  if (!MAX_TOKENS) return "CONSISTENCY_RELIABILITY_MAX_TOKENS is not set";
  if (!MAX_USD) return "CONSISTENCY_RELIABILITY_MAX_USD is not set";
  if (!creds) return "no AICredits credentials";
  return "";
}

describe.skipIf(!!refusal())("execution-reliability check — PAID, one run", () => {
  it(`reliability ${RUN}`, async () => {
    const pairs = (JSON.parse(readFileSync(join(DIR, "workload.json"), "utf8")) as { pairs: WorkloadPair[] }).pairs;
    // The price, before any model request (a GET; the wire counter counts model POSTs only).
    const catalogue = (await (await fetch(`${ENDPOINT}/models`, { headers: { authorization: `Bearer ${creds!.apiKey}` } })).json()) as { data: { id: string; input_cost_per_token: number; output_cost_per_token: number }[] };
    const price = catalogue.data.find((m) => m.id === MODEL);
    expect(price, "model price not found: nothing sent").toBeTruthy();
    mkdirSync(RUN_DIR, { recursive: true });
    writeFileSync(join(RUN_DIR, "started.json"), JSON.stringify({ run: RUN, startedAt: new Date().toISOString(), approvedBy: APPROVED_BY, ceilings: { calls: MAX_CALLS, tokens: MAX_TOKENS, usd: MAX_USD }, model: MODEL, endpoint: ENDPOINT, freezeSha256: sha(join(DIR, "FREEZE.json")) }, null, 2) + "\n");
    const exchanges: Exchange[] = [];
    const last: { x?: Exchange } = {};
    const wire = countModelRequestsOnTheWire();
    let result;
    try {
      const transport = openAICompatibleJudgeTransport({ endpoint: ENDPOINT, apiKey: creds!.apiKey, model: MODEL, onExchange: (x) => void (exchanges.push(x), (last.x = x)) });
      result = await runReliabilityCheck({
        run: RUN,
        pairs,
        transport,
        ceilings: { calls: MAX_CALLS, tokens: MAX_TOKENS, usd: MAX_USD },
        price: { input: price!.input_cost_per_token, output: price!.output_cost_per_token },
        wire: wire.count,
        lastExchange: () => last.x,
        clearExchange: () => void delete last.x,
      });
    } finally {
      wire.dispose();
    }
    writeFileSync(join(RUN_DIR, "calls.json"), JSON.stringify(result.calls, null, 2) + "\n");
    writeFileSync(join(RUN_DIR, "exchanges.json"), JSON.stringify(exchanges, null, 2) + "\n");
    writeFileSync(join(RUN_DIR, "pair-outcomes.json"), JSON.stringify(Object.fromEntries(result.calls.flatMap((c) => Object.entries(c.pairs))), null, 2) + "\n");
    writeFileSync(join(RUN_DIR, "result.json"), JSON.stringify({ ...result, calls: undefined, price: { input: price!.input_cost_per_token, output: price!.output_cost_per_token } }, null, 2) + "\n");
    const report = formatReliability(result, `Approved by ${APPROVED_BY}; ${MODEL} on AICredits; ceilings ≤ ${MAX_CALLS} calls, ≤ ${MAX_TOKENS} reserved tokens, ≤ $${MAX_USD}; no retries; one run.`);
    writeFileSync(join(RUN_DIR, "report.md"), report);
    console.log(report);
    // The ceilings are hard assertions; the pass criteria are reported, not asserted (a FAIL is a valid result).
    expect(result.totals.sent).toBeLessThanOrEqual(MAX_CALLS);
    expect(result.totals.reserved).toBeLessThanOrEqual(MAX_TOKENS);
    expect(result.totals.wireRequests).toBe(result.totals.sent);
  }, 900_000);
});

describe("execution-reliability check — refusal", () => {
  it("says why it did not run", () => {
    const why = refusal();
    if (why) console.log(`consistencyReliability not run: ${why}`);
    expect(true).toBe(true);
  });
});
