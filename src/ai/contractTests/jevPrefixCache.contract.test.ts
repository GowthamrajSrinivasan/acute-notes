/**
 * Phase 0c, `.ai/docs/topic-shortlist-plan.md`: does Jev reuse a shared topic-list prefix (prompt caching)? A narrowly scoped live experiment:
 * FIVE requests, in order, no retries, hard spend cap; the saved layout D fixture only (headings, sizes, filler words: no real notes or chat text).
 * Raw `fetch` to the decisions endpoint with the request body production builds (`jevRequestBody`), so the whole `usage` object is kept
 * (the app's own `usageOf` drops everything but input/output tokens).
 *
 *   1. cold      part A, the 34 topics
 *   2. warm      part B, the same topics (sent after 1 finished)
 *   3. control   part A, the first topic's text changed at its start (the prefix is broken from the first topic on)
 *   4+5 burst    part A again (byte-identical to 1) and part C, sent at once, after 1-3 finished, on the warm original prefix
 *
 * Baseline result (2026-10-11, `data/jev-prefix-cache-2026-10-11.json`): no cache fields in `usage` or the headers, and billed cost exactly linear
 * in input tokens, even for a byte-identical repeat. That is "no evidence of caching on this endpoint under these conditions", not proof that
 * caching is impossible in every configuration; rerun this only to compare against that baseline after a provider or endpoint change.
 *
 * Runs only with JEV_PREFIX_CACHE_APPROVED=1, and never as part of `npm test` (the default config excludes `*.contract.test.ts`):
 *   JEV_PREFIX_CACHE_APPROVED=1 npx vitest run --config vitest.contract.config.ts jevPrefixCache
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecisionRequest } from "@/ai/decisions/types";
import { DECISION_ENDPOINTS, jevRequestBody } from "@/ai/host/decisions/wire";
import { assignToTopicsDecision, type AssignInput } from "@/ai/merge/assign";
import placement from "@/ai/merge/__fixtures__/layoutDPlacement.json";
import { filler, recorded, sectionText } from "@/ai/merge/__fixtures__/layoutDWorld";
import { JEV_MODEL, openrouter } from "./spikeUtil";

const CAP_USD = 0.005;
/** Assumed worst case for one request before it is sent (about 16k tokens at $0.042/M), used by the spend guard until real costs are known. */
const PER_REQUEST_GUARD_USD = 0.0007;
const OUT = join(process.cwd(), ".ai", "docs", "decision-spike", "data", "jev-prefix-cache-2026-10-11.json");

const SEP = " › ";
const topics = placement.topics.map((t) => ({ key: t.key, label: t.key.split(SEP).at(-1)!, text: filler(t.key, Math.max(40, t.chars - 40)) }));
const partOf = (i: number): AssignInput["parts"][number] => {
  const r = recorded[i]!;
  const under = r.key.split(SEP).slice(0, -1).join(SEP);
  return { key: r.key, text: sectionText(r), ...(under ? { context: under } : {}) };
};
const requestFor = (part: AssignInput["parts"][number], withTopics = topics): DecisionRequest => (assignToTopicsDecision.buildRequest({ topics: withTopics, parts: [part] }) as DecisionRequest[])[0]!;
const A = partOf(5);
const B = partOf(40);
const C = partOf(80);
const altered = topics.map((t, i) => (i === 0 ? { ...t, text: `ALTERED ${t.text}` } : t));

interface Result {
  step: string;
  sentAt: number;
  ms: number;
  status: number;
  requestChars: number;
  usage: unknown;
  cacheFields: Record<string, unknown>;
  cost: number | null;
  answer: { choice?: string; confidence?: number; top?: [string, number][] } | null;
  headers: Record<string, string>;
  error?: string;
}

/** Every key (at any depth) whose name mentions "cache", with its value. */
function cacheFieldsOf(v: unknown, path = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) {
    const p = path ? `${path}.${k}` : k;
    if (/cach/i.test(k)) out[p] = x;
    cacheFieldsOf(x, p, out);
  }
  return out;
}

const spent = (results: readonly Result[]) => results.reduce((n, r) => n + (r.cost ?? PER_REQUEST_GUARD_USD), 0);

describe.skipIf(process.env.JEV_PREFIX_CACHE_APPROVED !== "1" || !openrouter)("Jev prefix caching (live, 5 requests)", () => {
  it("measures cached tokens, cost, latency and answers on the five approved requests", async () => {
    const results: Result[] = [];
    const guard = (n: number) => {
      if (spent(results) + n * PER_REQUEST_GUARD_USD > CAP_USD) throw new Error(`Spend guard: ${spent(results).toFixed(5)} spent, ${n} more request(s) would approach the $${CAP_USD} cap. Stopping.`);
    };
    const t0 = Date.now();
    const send = async (step: string, request: DecisionRequest): Promise<Result> => {
      const body = JSON.stringify(jevRequestBody(JEV_MODEL, request));
      const sentAt = Date.now() - t0;
      const started = Date.now();
      // No retries: any failure is recorded and stops the run.
      const res = await fetch(DECISION_ENDPOINTS.jev!, { method: "POST", headers: { authorization: `Bearer ${openrouter!.apiKey}`, "content-type": "application/json" }, body, signal: AbortSignal.timeout(60_000) });
      const ms = Date.now() - started;
      const headers = Object.fromEntries([...res.headers.entries()].filter(([k]) => /cach|cost|provider|generation|model|ratelimit/i.test(k)));
      const json = (await res.json().catch(() => null)) as { usage?: Record<string, unknown>; answers?: Record<string, { choice?: string; confidence?: number; probabilities?: Record<string, number> }> } | null;
      const topic = Object.entries(json?.answers ?? {}).find(([k]) => k.endsWith("_topic"))?.[1];
      const cost = typeof json?.usage?.cost === "number" ? json.usage.cost : null;
      const result: Result = {
        step,
        sentAt,
        ms,
        status: res.status,
        requestChars: body.length,
        usage: json?.usage ?? null,
        cacheFields: { ...cacheFieldsOf(json?.usage), ...cacheFieldsOf(headers) },
        cost,
        answer: topic ? { choice: topic.choice, confidence: topic.confidence, top: Object.entries(topic.probabilities ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3) } : null,
        headers,
        ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
      };
      results.push(result);
      if (!res.ok) throw new Error(`${step}: HTTP ${res.status}; stopping, no retry.`);
      return result;
    };
    try {
      guard(1);
      await send("1 cold A", requestFor(A));
      guard(1);
      await send("2 warm B", requestFor(B));
      guard(1);
      await send("3 control A (first topic changed)", requestFor(A, altered));
      guard(2);
      await Promise.all([send("4 burst A repeat", requestFor(A)), send("5 burst C", requestFor(C))]);
    } finally {
      mkdirSync(join(OUT, ".."), { recursive: true });
      writeFileSync(OUT, `${JSON.stringify({ recorded: "2026-10-11", model: JEV_MODEL, capUsd: CAP_USD, spentUsdReported: results.reduce((n, r) => n + (r.cost ?? 0), 0), results }, null, 2)}\n`);
      for (const r of results) console.log(`${r.step.padEnd(34)} ${String(r.status)} ${String(r.ms).padStart(6)}ms  chars ${r.requestChars}  cost ${r.cost}  cache ${JSON.stringify(r.cacheFields)}  usage ${JSON.stringify(r.usage)}  answer ${JSON.stringify(r.answer)}`);
    }
    expect(results).toHaveLength(5);
  }, 240_000);
});
