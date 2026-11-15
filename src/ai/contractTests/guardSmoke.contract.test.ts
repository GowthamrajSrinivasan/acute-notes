/**
 * The LIVE retry-guard smoke test (plan §12.30–12.32) — PAID, ONE run. Approved 2026-11-15 (Stage 4f decision review):
 * ≤ 1 forwarded provider request, ≤ 4,500 worst-case tokens (this test only), ≤ $0.01.
 *
 *   COPILOT_GUARD_SMOKE_RUN=2026-11-16-guard-smoke COPILOT_GUARD_SMOKE_APPROVED_BY="<name>" \
 *     COPILOT_GUARD_SMOKE_MAX_REQUESTS=1 COPILOT_GUARD_SMOKE_MAX_TOKENS=4500 COPILOT_GUARD_SMOKE_MAX_USD=0.01 \
 *     npx vitest run --config vitest.contract.config.ts guardSmoke
 *
 * The real Copilot SDK host runtime (pinned SDK) → the counting proxy (BYOK baseUrl) → AICredits, gpt-oss-120b. Counted at
 * the proxy, below the SDK boundary. Cases 1–2 inject a 429 / 500 at the proxy (never forwarded, never billed); case 3 is
 * the one real request. Every ceiling is enforced by the proxy BEFORE forwarding. Refuses on any change to the frozen
 * files, an existing run, or a missing ceiling; `started.json` is written before the first request.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUARD_SMOKE_LIMITS, runGuardSmoke } from "./guardSmoke";
import { getByokCredentials } from "./testEnv";

const ROOT = process.cwd();
const DIR = join(ROOT, "evaluation", "update-engine", "guard-smoke");
const RUNS = join(DIR, "runs");
const RUN = process.env.COPILOT_GUARD_SMOKE_RUN ?? "";
const RUN_DIR = join(RUNS, RUN);
const APPROVED_BY = (process.env.COPILOT_GUARD_SMOKE_APPROVED_BY ?? "").trim();
const MAX_REQUESTS = Math.min(GUARD_SMOKE_LIMITS.forwarded, Number(process.env.COPILOT_GUARD_SMOKE_MAX_REQUESTS) || 0);
const MAX_TOKENS = Math.min(GUARD_SMOKE_LIMITS.tokens, Number(process.env.COPILOT_GUARD_SMOKE_MAX_TOKENS) || 0);
const MAX_USD = Math.min(GUARD_SMOKE_LIMITS.usd, Number(process.env.COPILOT_GUARD_SMOKE_MAX_USD) || 0);
const MODEL = "openai/gpt-oss-120b";
const ENDPOINT = "https://api.aicredits.in/v1";
const creds = getByokCredentials("aicredits");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

function refusal(): string {
  if (!RUN) return "COPILOT_GUARD_SMOKE_RUN is not set";
  if (!/^\d{4}-\d{2}-\d{2}-guard-smoke$/.test(RUN)) return "COPILOT_GUARD_SMOKE_RUN must look like 2026-11-16-guard-smoke";
  if (!existsSync(join(DIR, "FREEZE.json"))) return "guard-smoke/FREEZE.json is missing: freeze the harness first";
  const freeze = JSON.parse(readFileSync(join(DIR, "FREEZE.json"), "utf8")) as { files: Record<string, string> };
  const changed = Object.entries(freeze.files).filter(([f, h]) => !existsSync(join(ROOT, f)) || sha(join(ROOT, f)) !== h).map(([f]) => f);
  if (changed.length) return `changed since the freeze: ${changed.join(", ")}`;
  if (existsSync(RUNS) && readdirSync(RUNS).length) return `a guard smoke run already exists (${readdirSync(RUNS).join(", ")}): no paid reruns`;
  const verified = (JSON.parse(readFileSync(join(ROOT, "src/ai/host/copilot/retryGuardVerification.json"), "utf8")) as { sdkVersion: string }).sdkVersion;
  const installed = (JSON.parse(readFileSync(join(ROOT, "node_modules/@github/copilot-sdk/package.json"), "utf8")) as { version: string }).version;
  if (installed !== verified) return `installed Copilot SDK ${installed} is not the verified ${verified}: rerun the retry spike first`;
  if (!APPROVED_BY) return "COPILOT_GUARD_SMOKE_APPROVED_BY is not set";
  if (!MAX_REQUESTS) return "COPILOT_GUARD_SMOKE_MAX_REQUESTS is not set";
  if (!MAX_TOKENS) return "COPILOT_GUARD_SMOKE_MAX_TOKENS is not set";
  if (!MAX_USD) return "COPILOT_GUARD_SMOKE_MAX_USD is not set";
  if (!creds) return "no AICredits credentials";
  return "";
}

describe.skipIf(!!refusal())("live retry-guard smoke test — PAID, one run", () => {
  it(`guard smoke ${RUN}`, async () => {
    const catalogue = (await (await fetch(`${ENDPOINT}/models`, { headers: { authorization: `Bearer ${creds!.apiKey}` } })).json()) as { data: { id: string; input_cost_per_token: number; output_cost_per_token: number }[] };
    const price = catalogue.data.find((m) => m.id === MODEL);
    expect(price, "model price not found: nothing sent").toBeTruthy();
    mkdirSync(RUN_DIR, { recursive: true });
    writeFileSync(join(RUN_DIR, "started.json"), JSON.stringify({ run: RUN, startedAt: new Date().toISOString(), approvedBy: APPROVED_BY, ceilings: { providerRequests: MAX_REQUESTS, tokens: MAX_TOKENS, usd: MAX_USD }, model: MODEL, endpoint: ENDPOINT, sdk: JSON.parse(readFileSync(join(ROOT, "node_modules/@github/copilot-sdk/package.json"), "utf8")).version, freezeSha256: sha(join(DIR, "FREEZE.json")) }, null, 2) + "\n");
    const result = await runGuardSmoke({ upstream: ENDPOINT, apiKey: creds!.apiKey, model: MODEL, maxForwarded: MAX_REQUESTS, maxTokens: MAX_TOKENS, maxUsd: MAX_USD, price: { input: price!.input_cost_per_token, output: price!.output_cost_per_token } });
    const live = result.cases.find((c) => c.name === "live");
    // Conservative cost: the reported tokens at the larger per-token price.
    const costUsd = (live?.usedTokens ?? 0) * Math.max(price!.input_cost_per_token, price!.output_cost_per_token);
    writeFileSync(join(RUN_DIR, "result.json"), JSON.stringify({ ...result, costUsdUpperBound: costUsd, price: { input: price!.input_cost_per_token, output: price!.output_cost_per_token } }, null, 2) + "\n");
    const report = [
      `# Live retry-guard smoke test — ${RUN}`,
      "",
      `Approved by ${APPROVED_BY}; ${MODEL} on AICredits through the Copilot SDK host runtime (BYOK, SDK pinned), one consistency check per case through runJudgeCheck; ceilings ≤ ${MAX_REQUESTS} forwarded request, ≤ ${MAX_TOKENS} worst-case tokens, ≤ $${MAX_USD}; one run.`,
      "",
      `Result: **${result.passed ? "PASS" : "FAIL"}** — provider-bound requests: ${result.arrivals.filter((a) => a.method === "POST").length} arrived at the proxy, ${result.totalForwarded} forwarded, ${result.refusedByCeiling} refused by a ceiling; cost ≤ $${costUsd.toFixed(6)}.`,
      "",
      "| Case | Status | Arrivals | Forwarded | max_tokens carried / expected | temperature | providerRequests | Reserved → budget after | Ledger | Pass |",
      "|---|---|---|---|---|---|---|---|---|---|",
      ...result.cases.map((c) => `| ${c.name} | ${c.status}${c.failure ? ` (${c.failure})` : ""} | ${c.arrivals} | ${c.forwarded} | ${c.carried?.maxTokens ?? "—"} / ${c.expectedMaxTokens} | ${c.carried?.temperature ?? "—"} | ${c.providerRequests ?? "—"} | ${c.reserved} → ${c.budgetTokensAfter} | ${c.ledgerState ?? "—"} | ${c.pass ? "✓" : "✗"} |`),
      "",
      "Checks:",
      ...result.cases.map((c) => `- ${c.name}: ${Object.entries(c.checks).map(([k, v]) => `${v ? "✓" : "✗"} ${k}`).join(", ")}`),
      "",
      `Live: used ${live?.usedTokens ?? "—"} tokens; request ${live?.requestBytes ?? "—"} bytes; late overwrite ignored: ${live?.lateOverwriteIgnored ?? "—"}.`,
      "",
    ].join("\n");
    writeFileSync(join(RUN_DIR, "report.md"), report);
    console.log(report);
    expect(result.totalForwarded).toBeLessThanOrEqual(MAX_REQUESTS);
  }, 600_000);
});

describe("live retry-guard smoke test — refusal", () => {
  it("says why it did not run", () => {
    const why = refusal();
    if (why) console.log(`guardSmoke not run: ${why}`);
    expect(true).toBe(true);
  });
});
