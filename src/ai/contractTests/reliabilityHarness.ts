/**
 * Execution-reliability check (intelligent-update-engine-plan §12.28 P3 proposal, approved 2026-11-15 as §12.29 P2).
 *
 * An EXECUTION check, never a semantic evaluation: it sends a fixed workload of statement pairs through the app's own
 * execution core (`sendJudgeCall` + a `JudgeLedger`) and measures completion, timeouts, latency, truncation and usage
 * accounting. The workload carries NO labels, so no accuracy can be computed or reported.
 *
 * Three independent counts per call (the review's "application call vs actual outbound provider attempts"):
 * - `appCalls`: `transport.send` invocations (always 1 per sent call);
 * - `transportRequests`: what the transport announced at its physical boundary (`onProviderRequest`);
 * - `wireRequests`: model requests seen leaving the process by `wire` (the runner counts undici's
 *   `undici:request:create` diagnostics channel, below fetch).
 *
 * Every ceiling (calls, tokens, dollars) is checked on the worst case BEFORE a call; a call that would pass one is not
 * sent. No retries of any kind. This module is vendor-neutral and fully exercised offline (reliabilityHarness.test.ts).
 */
import { callTokens } from "@/ai/consistency/candidates";
import { JUDGE_CALL_CEILING, JUDGE_CALL_TIMEOUT_MS, planCalls } from "@/ai/consistency/judge";
import { sendJudgeCall, type JudgeTransport } from "@/ai/consistency/judgeCall";
import { JudgeLedger } from "@/ai/consistency/judgeLedger";

export const RELIABILITY_LIMITS = Object.freeze({ calls: 6, tokens: 16_800, usd: 0.02, pairsPerCall: 10 });
/** Pass criteria, fixed before the run (§12.28 P3). */
export const RELIABILITY_CRITERIA = Object.freeze({ minClassifiedShare: 0.95, p95LatencyMs: 60_000, timeoutMs: JUDGE_CALL_TIMEOUT_MS });

export interface WorkloadPair {
  id: string;
  a: string;
  b: string;
}

export interface Exchange {
  status: number;
  body: string;
  ms: number;
}

export interface ReliabilityOptions {
  run: string;
  pairs: readonly WorkloadPair[];
  transport: JudgeTransport;
  ceilings: { calls: number; tokens: number; usd: number };
  price: { input: number; output: number };
  /** Model requests seen leaving the process so far (the runner's wire counter). */
  wire: () => number;
  /** The raw exchange of the most recent request, when the transport records it. */
  lastExchange?: () => Exchange | undefined;
  clearExchange?: () => void;
  now?: () => number;
}

export interface CallRecord {
  n: number;
  keys: string[];
  status: "answered" | "partial" | "unreadable" | "call_error" | "not_sent" | string;
  reason?: string;
  failure?: string;
  error?: string;
  startedAt?: string;
  endedAt?: string;
  ms?: number;
  httpStatus?: number | null;
  finishReason?: string | null;
  reserved: number;
  settledTokens?: number | null;
  usage?: { promptTokens?: number; completionTokens?: number; reasoningTokens?: number; totalTokens?: number };
  usageReported?: boolean;
  overReservation?: boolean;
  costUsd?: number;
  appCalls: number;
  transportRequests: number;
  wireRequests: number;
  pairs: Record<string, string>;
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ReliabilityResult {
  run: string;
  calls: CallRecord[];
  totals: { sent: number; pairsSent: number; classified: number; failed: number; reserved: number; charged: number; reportedTokens: number; costUsd: number; worstUsd: number; wireRequests: number; transportRequests: number; appCalls: number };
  latency: { samplesMs: number[]; p50Ms: number | null; p95Ms: number | null; maxMs: number | null; method: string };
  criteria: Check[];
  assertions: Check[];
  passed: boolean;
}

/** Nearest-rank percentile. With 6 samples, p95 is the largest (stated in the report). */
export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1]!;
}

function parseExchange(body: string | undefined): { finishReason: string | null; usage?: CallRecord["usage"] } {
  try {
    const j = JSON.parse(body ?? "") as { choices?: { finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } } };
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
    const u = j.usage;
    const usage = u
      ? Object.fromEntries(
          Object.entries({ promptTokens: n(u.prompt_tokens), completionTokens: n(u.completion_tokens), reasoningTokens: n(u.completion_tokens_details?.reasoning_tokens), totalTokens: n(u.total_tokens) }).filter(([, v]) => v !== undefined),
        )
      : undefined;
    return { finishReason: typeof j.choices?.[0]?.finish_reason === "string" ? (j.choices[0].finish_reason as string) : null, ...(usage ? { usage } : {}) };
  } catch {
    return { finishReason: null };
  }
}

/**
 * Sends the workload as sequential calls of up to `pairsPerCall` pairs, within every ceiling, and checks the result.
 * Never sends more than `min(ceilings.calls, RELIABILITY_LIMITS.calls)` calls.
 */
export async function runReliabilityCheck(o: ReliabilityOptions): Promise<ReliabilityResult> {
  const now = o.now ?? Date.now;
  const maxCalls = Math.min(o.ceilings.calls, RELIABILITY_LIMITS.calls);
  const maxTokens = Math.min(o.ceilings.tokens, RELIABILITY_LIMITS.tokens);
  const maxUsd = Math.min(o.ceilings.usd, RELIABILITY_LIMITS.usd);
  const worst = (tokens: number) => tokens * Math.max(o.price.input, o.price.output);
  const CANVAS = "reliability";
  const ledger = new JudgeLedger(undefined, now);
  const byId = new Map(o.pairs.map((p) => [p.id, p] as const));
  if (byId.size !== o.pairs.length) throw new Error("workload ids must be unique");

  // Fixed groups of `pairsPerCall`, in workload order; each group must fit one call (planCalls with one call).
  const groups: string[][] = [];
  for (let i = 0; i < o.pairs.length; i += RELIABILITY_LIMITS.pairsPerCall) groups.push(o.pairs.slice(i, i + RELIABILITY_LIMITS.pairsPerCall).map((p) => p.id));

  const calls: CallRecord[] = [];
  let sent = 0;
  let reserved = 0;
  let charged = 0;
  let worstUsd = 0;
  for (const keys of groups) {
    const planned = planCalls(keys.map((k) => ({ key: k, a: { sentence: byId.get(k)!.a }, b: { sentence: byId.get(k)!.b } })), 1);
    const one = planned.calls[0];
    const reserve = one ? callTokens(one.input) : 0;
    const reason = !one || planned.skipped.length ? "does not fit one call" : reserve > JUDGE_CALL_CEILING ? "per-call ceiling" : sent >= maxCalls ? "call limit" : reserved + reserve > maxTokens ? "token ceiling" : worstUsd + worst(reserve) > maxUsd ? "dollar ceiling" : "";
    if (reason) {
      ledger.markPending(CANVAS, o.run, keys.map((key) => ({ key, reason: "over_call_limit" })));
      calls.push({ n: 0, keys, status: "not_sent", reason, reserved: 0, appCalls: 0, transportRequests: 0, wireRequests: 0, pairs: Object.fromEntries(keys.map((k) => [k, "not_sent"])) });
      continue;
    }
    sent++;
    reserved += reserve;
    worstUsd += worst(reserve);
    const callId = `call:${sent}`;
    ledger.markSent(CANVAS, o.run, keys, callId);
    o.clearExchange?.();
    let appCalls = 0;
    const counted: JudgeTransport = { ...o.transport, send: (r) => (appCalls++, o.transport.send(r)) };
    const wireBefore = o.wire();
    const startedAt = now();
    let settled: number | null | undefined;
    const result = await sendJudgeCall({ canvasId: CANVAS, revision: o.run, keys, input: one!.input, reservation: callId, reserved: reserve, transport: counted, ledger, settle: (actual) => void (settled = actual) });
    const endedAt = now();
    const wireRequests = o.wire() - wireBefore;
    // What the budget is charged: reported usage, or the whole reservation when none was reported (§12.28).
    const charge = settled === null || settled === undefined ? reserve : settled;
    charged += charge;
    if (settled !== null && settled !== undefined && settled > reserve) {
      // An overrun counts against the ceilings for the calls that follow (§12.28 review #7).
      reserved += settled - reserve;
      worstUsd += worst(settled - reserve);
    }
    const ex = o.lastExchange?.();
    const parsed = parseExchange(ex?.body);
    const costUsd = (parsed.usage?.promptTokens ?? 0) * o.price.input + (parsed.usage?.completionTokens ?? 0) * o.price.output;
    calls.push({
      n: sent,
      keys,
      status: result.status === "answered" ? result.reading!.status : result.status,
      ...(result.failure ? { failure: result.failure } : {}),
      ...(result.error ? { error: result.error } : {}),
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      ms: endedAt - startedAt,
      httpStatus: ex?.status ?? null,
      finishReason: parsed.finishReason,
      reserved: reserve,
      settledTokens: settled ?? null,
      ...(parsed.usage ? { usage: parsed.usage } : {}),
      usageReported: parsed.usage?.promptTokens !== undefined && parsed.usage?.completionTokens !== undefined,
      ...(result.overReservation ? { overReservation: true } : {}),
      costUsd,
      appCalls,
      transportRequests: result.providerRequests ?? 0,
      wireRequests,
      pairs: Object.fromEntries(keys.map((k) => {
        const p = ledger.get(CANVAS, k);
        return [k, p ? (p.state === "failed" ? `failed: ${p.reason ?? ""}` : p.state) : "missing"];
      })),
    });
  }

  const outcome = ledger.list(CANVAS);
  const sentCalls = calls.filter((c) => c.status !== "not_sent");
  const sentKeys = sentCalls.flatMap((c) => c.keys);
  const classified = outcome.filter((p) => p.state === "classified").length;
  const failed = outcome.filter((p) => p.state === "failed").length;
  const samples = sentCalls.map((c) => c.ms!);
  const latency = { samplesMs: samples, p50Ms: percentile(samples, 50), p95Ms: percentile(samples, 95), maxMs: samples.length ? Math.max(...samples) : null, method: `nearest rank over ${samples.length} end-to-end call latencies (non-streaming; queue time not separable); with ${samples.length} samples p95 is the ${samples.length <= 20 ? "largest" : "nearest-rank"} value — an operational check, not a statistically robust estimate` };
  const reportedTokens = sentCalls.reduce((s, c) => s + (c.usage?.promptTokens ?? 0) + (c.usage?.completionTokens ?? 0), 0);
  const totals = { sent, pairsSent: sentKeys.length, classified, failed, reserved, charged, reportedTokens, costUsd: sentCalls.reduce((s, c) => s + (c.costUsd ?? 0), 0), worstUsd, wireRequests: sentCalls.reduce((s, c) => s + c.wireRequests, 0), transportRequests: sentCalls.reduce((s, c) => s + c.transportRequests, 0), appCalls: sentCalls.reduce((s, c) => s + c.appCalls, 0) };

  const timeouts = sentCalls.filter((c) => c.failure === "timeout" || (c.ms ?? 0) >= RELIABILITY_CRITERIA.timeoutMs);
  const truncated = sentCalls.filter((c) => c.finishReason === "length");
  const need = Math.ceil(RELIABILITY_CRITERIA.minClassifiedShare * o.pairs.length);
  const criteria: Check[] = [
    { name: "pairs classified ≥ 95 %", pass: classified >= need, detail: `${classified}/${o.pairs.length} (need ≥ ${need})` },
    { name: "no call reached the 90 s timeout", pass: timeouts.length === 0, detail: timeouts.length ? `calls ${timeouts.map((c) => c.n).join(", ")}` : "none" },
    { name: "p95 latency ≤ 60 s", pass: latency.p95Ms !== null && latency.p95Ms <= RELIABILITY_CRITERIA.p95LatencyMs, detail: `p95 ${latency.p95Ms ?? "n/a"} ms (p50 ${latency.p50Ms ?? "n/a"} ms, ${samples.length} samples)` },
    { name: "no truncated reply (finish_reason length)", pass: truncated.length === 0, detail: truncated.length ? `calls ${truncated.map((c) => c.n).join(", ")}` : "none" },
    { name: "complete usage accounting", pass: sentCalls.every((c) => (c.status === "call_error" ? c.settledTokens === null : c.usageReported === true)), detail: "every answered call reported prompt and completion tokens; every failed call kept its whole reservation" },
    { name: "total usage within 16,800 tokens (or the overrun flagged and charged)", pass: charged <= maxTokens || sentCalls.some((c) => c.overReservation), detail: `charged ${charged}, reserved ${reserved}, reported ${reportedTokens}` },
  ];

  const states = new Map(outcome.map((p) => [p.key, p] as const));
  const assertions: Check[] = [
    { name: "never more calls than the ceiling", pass: sent <= maxCalls, detail: `${sent} ≤ ${maxCalls}` },
    { name: "one application call per sent call", pass: sentCalls.every((c) => c.appCalls === 1), detail: sentCalls.map((c) => c.appCalls).join(",") || "no calls" },
    { name: "one physical request per call at the transport boundary", pass: sentCalls.every((c) => c.transportRequests === 1), detail: sentCalls.map((c) => c.transportRequests).join(",") || "no calls" },
    { name: "one model request per call on the wire", pass: sentCalls.every((c) => c.wireRequests === 1), detail: sentCalls.map((c) => c.wireRequests).join(",") || "no calls" },
    { name: "every sent pair ends classified or failed (none in flight or pending)", pass: sentKeys.every((k) => ["classified", "failed"].includes(states.get(k)?.state ?? "")), detail: `${sentKeys.filter((k) => !["classified", "failed"].includes(states.get(k)?.state ?? "")).length} left` },
    { name: "a failed call fails exactly its own pairs and keeps its reservation", pass: sentCalls.filter((c) => c.status === "call_error").every((c) => c.settledTokens === null && c.keys.every((k) => states.get(k)?.state === "failed" && states.get(k)?.reason === "call_error")), detail: `${sentCalls.filter((c) => c.status === "call_error").length} failed calls` },
    { name: "no pair classified without a validated answer", pass: outcome.filter((p) => p.state === "classified").every((p) => typeof p.answer === "string" && p.answer.length > 0), detail: `${classified} classified` },
    { name: "ledger, budget and call records agree", pass: classified + failed === sentKeys.length && calls.flatMap((c) => c.keys).length === o.pairs.length && charged === sentCalls.reduce((s, c) => s + (c.settledTokens ?? c.reserved), 0), detail: `ledger ${classified}+${failed}, calls ${sentKeys.length}, charged ${charged}` },
    { name: "within the token and dollar ceilings (worst case)", pass: reserved <= maxTokens && worstUsd <= maxUsd, detail: `${reserved} ≤ ${maxTokens} tokens; $${worstUsd.toFixed(5)} ≤ $${maxUsd}` },
  ];
  return { run: o.run, calls, totals, latency, criteria, assertions, passed: criteria.every((c) => c.pass) && assertions.every((c) => c.pass) };
}

export function formatReliability(r: ReliabilityResult, header: string): string {
  const row = (c: Check) => `| ${c.pass ? "✓" : "✗"} | ${c.name} | ${c.detail} |`;
  return [
    `# Execution-reliability check — ${r.run}`,
    "",
    header,
    "",
    "**An execution check, not a semantic evaluation: the workload has no labels and no accuracy is computed or reported.**",
    "",
    `Result: **${r.passed ? "PASS" : "FAIL"}** — sent ${r.totals.sent} calls / ${r.totals.pairsSent} pairs; classified ${r.totals.classified}, failed ${r.totals.failed}.`,
    "",
    "## Pass criteria",
    "",
    "| | Criterion | Observed |",
    "|---|---|---|",
    ...r.criteria.map(row),
    "",
    "## Failure-handling assertions",
    "",
    "| | Assertion | Observed |",
    "|---|---|---|",
    ...r.assertions.map(row),
    "",
    "## Requests (application call vs physical provider requests)",
    "",
    `Application calls ${r.totals.appCalls} · transport-boundary requests ${r.totals.transportRequests} · wire requests ${r.totals.wireRequests}.`,
    "",
    "## Usage",
    "",
    `Reserved ${r.totals.reserved} tokens · charged ${r.totals.charged} · reported ${r.totals.reportedTokens} · cost $${r.totals.costUsd.toFixed(6)} (worst case $${r.totals.worstUsd.toFixed(5)}).`,
    "",
    "## Latency",
    "",
    `${r.latency.samplesMs.join(", ")} ms. p50 ${r.latency.p50Ms ?? "n/a"} ms, p95 ${r.latency.p95Ms ?? "n/a"} ms. ${r.latency.method}.`,
    "",
    "## Calls",
    "",
    "| # | Status | HTTP | finish | ms | reserved | prompt | completion | reasoning | app/transport/wire |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...r.calls.map((c) => `| ${c.n || "—"} | ${c.status}${c.failure ? ` (${c.failure})` : ""}${c.reason ? ` (${c.reason})` : ""} | ${c.httpStatus ?? "—"} | ${c.finishReason ?? "—"} | ${c.ms ?? "—"} | ${c.reserved} | ${c.usage?.promptTokens ?? "—"} | ${c.usage?.completionTokens ?? "—"} | ${c.usage?.reasoningTokens ?? "—"} | ${c.appCalls}/${c.transportRequests}/${c.wireRequests} |`),
    "",
  ].join("\n");
}

/** Outputs of a reliability run; any of them existing means the run happened (no second run). */
export const RELIABILITY_OUTPUTS = ["calls.json", "pair-outcomes.json", "result.json", "report.md"] as const;

