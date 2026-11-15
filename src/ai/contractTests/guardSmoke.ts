/**
 * The live retry-guard smoke test (plan §12.30–12.31), shared by the free offline rehearsal (upstream = a local mock) and
 * the paid run (upstream = the real provider). Three cases, each ONE consistency check through the app's own path —
 * `runJudgeCheck` (plan → reserve in a real `JudgeBudget` → one call → settle; `JudgeLedger`) over `providerJudgeTransport`
 * over the REAL Copilot SDK host runtime (pinned SDK, `singleAttempt` guard), BYOK `baseUrl` = the counting proxy:
 *   1. the proxy answers the model request with a 429 (never forwarded) — unguarded, the SDK retries 5 times;
 *   2. the same with a 500;
 *   3. one genuine request, forwarded once.
 * Requests are counted at the proxy, below the SDK boundary (every provider-bound request passes through it).
 *
 * Pass, per case and overall (review 2026-11-15):
 * - EXACTLY one model request arrives per case, whatever the token usage: any extra arrival (retry, fallback, repair)
 *   fails the test;
 * - cases 1–2 forward nothing, fail their pair, and keep the whole reservation (nothing is guessed);
 * - case 3 forwards exactly one request carrying the intended `max_tokens` (the call's output budget) and
 *   `temperature: 0`; the pair is classified; the budget is settled to the reported usage; a late reading for another
 *   reservation does not overwrite the terminal result;
 * - in total exactly one request is forwarded and none is refused by a ceiling.
 */
import { JudgeBudget, type Candidate } from "@/ai/consistency/candidates";
import { outputBudget } from "@/ai/consistency/judge";
import { providerJudgeTransport, runJudgeCheck } from "@/ai/consistency/judgeCall";
import { JudgeLedger } from "@/ai/consistency/judgeLedger";
import { judgePair } from "@/ai/consistency/rules";
import { createCopilotHostRuntime } from "@/ai/host/copilot/CopilotHostRuntime";
import type { HostByokProvider, HostRuntime } from "@/ai/host/hostRuntime";
import type { AIProvider } from "@/ai/types";
import { startCountingProxy, worstCaseTokens, type ProxyArrival } from "./countingProxy";

export const GUARD_SMOKE_LIMITS = Object.freeze({ forwarded: 1, tokens: 4_000, usd: 0.01 });

/** An invented pair the rules leave "possible" (it goes to the AI); not from any evaluation set. */
const PAIR = { a: "The Larchfield depot stores its spare tyres in Building C.", b: "The Larchfield depot stores its spare tyres in Building F." };

export interface SmokeCase {
  name: "inject_429" | "inject_500" | "live";
  status: string;
  failure?: string;
  arrivals: number;
  forwarded: number;
  carried?: { maxTokens?: number; temperature?: number; fields: string[] };
  expectedMaxTokens: number;
  providerRequests?: number;
  usedTokens?: number;
  reserved: number;
  budgetTokensAfter: number;
  ledgerState?: string;
  lateOverwriteIgnored?: boolean;
  requestBytes?: number;
  ms: number;
  pass: boolean;
  checks: Record<string, boolean>;
}

export interface SmokeResult {
  cases: SmokeCase[];
  totalForwarded: number;
  refusedByCeiling: number;
  arrivals: Omit<ProxyArrival, "reply">[];
  passed: boolean;
}

/** A test-only provider over the host runtime directly (no Next route): BYOK, the Copilot provider's declared capabilities. */
export function hostRuntimeProvider(runtime: HostRuntime, byok: HostByokProvider, model: string): AIProvider {
  return {
    id: "copilot-byok-smoke",
    name: "Copilot SDK (BYOK, smoke test)",
    authTypes: ["api_key"],
    transport: "ai_host_local",
    capabilities: { streaming: false, structuredOutput: "json_mode", toolCalling: false, vision: false, embeddings: false, modelSelection: true, outputCap: "passed", providerAttempts: "single" },
    isConfigured: async () => true,
    testConnection: async () => ({ ok: true }),
    generate: (request) => runtime.generate({ auth: { kind: "logged_in_user" }, provider: byok, request: { ...request, model } }),
  } as AIProvider;
}

export async function runGuardSmoke(o: {
  upstream: string;
  apiKey: string;
  model: string;
  maxForwarded: number;
  /** Worst-case token and dollar ceilings, checked by the proxy BEFORE forwarding (code caps: 4,000 tokens, $0.01). */
  maxTokens?: number;
  maxUsd?: number;
  price?: { input: number; output: number };
  runtime?: HostRuntime;
  /**
   * The free offline rehearsal only (local mock upstream, nothing billed): a higher token cap than the paid code cap, to
   * exercise every other check. The paid runner never passes it.
   */
  rehearsalTokenCap?: number;
}): Promise<SmokeResult> {
  const maxForwarded = Math.min(o.maxForwarded, GUARD_SMOKE_LIMITS.forwarded);
  const maxTokens = Math.min(o.maxTokens ?? GUARD_SMOKE_LIMITS.tokens, o.rehearsalTokenCap ?? GUARD_SMOKE_LIMITS.tokens);
  const maxUsd = Math.min(o.maxUsd ?? GUARD_SMOKE_LIMITS.usd, GUARD_SMOKE_LIMITS.usd);
  const worstPrice = o.price ? Math.max(o.price.input, o.price.output) : 0;
  const admit = (body: Buffer) => {
    const t = worstCaseTokens(body);
    if (t > maxTokens) return `worst case ${t} tokens exceeds the ${maxTokens}-token ceiling`;
    if (t * worstPrice > maxUsd) return `worst case $${(t * worstPrice).toFixed(5)} exceeds the $${maxUsd} ceiling`;
    return null;
  };
  const proxy = await startCountingProxy({ upstream: o.upstream, maxForwarded, admit });
  const runtime = o.runtime ?? createCopilotHostRuntime();
  const provider = hostRuntimeProvider(runtime, { type: "openai", baseUrl: proxy.url, apiKey: o.apiKey }, o.model);
  const transport = providerJudgeTransport(provider);
  const cases: SmokeCase[] = [];
  try {
    for (const name of ["inject_429", "inject_500", "live"] as const) {
      proxy.resetCase();
      proxy.setInject(name === "live" ? null : () => ({ status: name === "inject_429" ? 429 : 500, body: '{"error":{"message":"injected by the smoke-test proxy"}}' }));
      const before = proxy.arrivals.length;
      const forwardedBefore = proxy.forwarded();
      const budget = new JudgeBudget();
      const ledger = new JudgeLedger();
      const canvas = `guard-smoke:${name}`;
      const candidate: Candidate = { key: "k1", a: { sentence: PAIR.a }, b: { sentence: PAIR.b }, judgement: judgePair(PAIR.a, PAIR.b) };
      const started = Date.now();
      const r = await runJudgeCheck({ canvasId: canvas, revision: `rev:${name}`, candidates: [candidate], budget, ledger, transport, aiEnabled: true });
      const mine = proxy.arrivals.slice(before).filter((a) => a.method === "POST");
      const forwarded = proxy.forwarded() - forwardedBefore;
      const reserved = r.plan.call?.tokens ?? 0;
      const expectedMaxTokens = r.plan.call ? outputBudget(r.plan.call.input) : 0;
      const tokensAfter = budget.state().tokens;
      const pair = ledger.get(canvas, "k1");
      let lateOverwriteIgnored: boolean | undefined;
      if (name === "live" && pair?.state === "classified") {
        // A late reply for another reservation must not overwrite the terminal result.
        const opposite = pair.answer === "contradicts" ? ("compatible" as const) : ("contradicts" as const);
        const out = ledger.recordReading(canvas, `rev:${name}`, { pairs: new Map([["k1", { state: "classified", answer: opposite }]]) }, "res:late");
        lateOverwriteIgnored = out.ignored === 1 && ledger.get(canvas, "k1")?.answer === pair.answer;
      }
      const carried = mine[0]?.carried;
      const checks: Record<string, boolean> =
        name === "live"
          ? {
              exactlyOneArrival: mine.length === 1,
              exactlyOneForwarded: forwarded === 1,
              carriesMaxTokens: carried?.maxTokens === expectedMaxTokens,
              carriesTemperature0: carried?.temperature === 0,
              answered: r.status === "answered",
              pairClassified: pair?.state === "classified",
              providerRequests1: r.call?.providerRequests === 1,
              usageReported: typeof r.call?.usedTokens === "number" && (r.call?.usedTokens ?? 0) > 0,
              settledToUsage: typeof r.call?.usedTokens === "number" && tokensAfter === r.call.usedTokens,
              lateOverwriteIgnored: lateOverwriteIgnored === true,
            }
          : {
              exactlyOneArrival: mine.length === 1,
              nothingForwarded: forwarded === 0,
              callFailed: r.status === "call_error",
              pairFailed: pair?.state === "failed",
              reservationKept: reserved > 0 && tokensAfter === reserved,
              noExtraProviderRequests: !r.call?.extraProviderRequests,
            };
      cases.push({
        name,
        status: r.status,
        ...(r.call?.failure ? { failure: r.call.failure } : {}),
        arrivals: mine.length,
        forwarded,
        ...(carried ? { carried } : {}),
        expectedMaxTokens,
        ...(r.call?.providerRequests !== undefined ? { providerRequests: r.call.providerRequests } : {}),
        ...(r.call?.usedTokens !== undefined ? { usedTokens: r.call.usedTokens } : {}),
        reserved,
        budgetTokensAfter: tokensAfter,
        ...(pair ? { ledgerState: pair.state } : {}),
        ...(lateOverwriteIgnored !== undefined ? { lateOverwriteIgnored } : {}),
        ...(mine[0] ? { requestBytes: mine[0].bytes } : {}),
        ms: Date.now() - started,
        pass: Object.values(checks).every(Boolean),
        checks,
      });
    }
  } finally {
    proxy.setInject(null);
    await proxy.close();
  }
  const refusedByCeiling = proxy.arrivals.filter((a) => a.outcome === "refused_cap" || a.outcome === "refused_admit").length;
  const totalPosts = proxy.arrivals.filter((a) => a.method === "POST").length;
  return {
    cases,
    totalForwarded: proxy.forwarded(),
    refusedByCeiling,
    arrivals: proxy.arrivals.map(({ reply: _reply, ...a }) => a),
    // Any unexpected request — retry, fallback or repair — fails, even within budget: exactly 3 arrivals, 1 forwarded.
    passed: cases.every((c) => c.pass) && refusedByCeiling === 0 && proxy.forwarded() === 1 && totalPosts === 3,
  };
}
