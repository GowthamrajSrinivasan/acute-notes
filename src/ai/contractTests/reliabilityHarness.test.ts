/**
 * Offline simulations of the execution-reliability harness (§12.29 P2): a REAL local HTTP server, the real one-request
 * transport, the real wire counter and the real execution core. No provider, no model, no spend. The paid run is only
 * allowed once these pass and the harness is frozen (reliabilityFreeze.test.ts).
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { callTokens } from "@/ai/consistency/candidates";
import { JUDGE_CALL_CEILING, planCalls } from "@/ai/consistency/judge";
import type { JudgeTransport } from "@/ai/consistency/judgeCall";
import { openAICompatibleJudgeTransport } from "./judgeHttpTransport";
import { percentile, RELIABILITY_LIMITS, runReliabilityCheck, type Exchange, type WorkloadPair } from "./reliabilityHarness";
import { countModelRequestsOnTheWire } from "./wireCounter";

const WORKLOAD = join(process.cwd(), "evaluation", "update-engine", "consistency", "reliability", "workload.json");
const workload = (JSON.parse(readFileSync(WORKLOAD, "utf8")) as { pairs: WorkloadPair[] }).pairs;
const PRICE = { input: 1e-7, output: 5e-7 };
const CEILINGS = { calls: 6, tokens: 16_800, usd: 0.02 };

type Behaviour = "ok" | "500" | "length" | "no_usage" | "bad_json";
let script: Behaviour[] = [];
let hits = 0;
let server: Server;
let endpoint = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits++;
      const behaviour = script.shift() ?? "ok";
      if (behaviour === "500") return void res.writeHead(500, { "content-type": "application/json" }).end('{"error":{"message":"boom"}}');
      const prompt = (JSON.parse(body) as { messages: { content: string }[] }).messages[1]!.content;
      const n = (prompt.match(/^p\d+$/gm) ?? []).length;
      const content = behaviour === "bad_json" ? "not json" : JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ ref: `p${i + 1}`, answer: "compatible", why: "x" })) });
      const usage = behaviour === "no_usage" ? undefined : { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200, completion_tokens_details: { reasoning_tokens: 120 } };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content }, finish_reason: behaviour === "length" ? "length" : "stop" }], ...(usage ? { usage } : {}) }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

async function simulate(options: { behaviours?: Behaviour[]; ceilings?: typeof CEILINGS; transport?: (base: JudgeTransport) => JudgeTransport; pairs?: WorkloadPair[] } = {}) {
  script = [...(options.behaviours ?? [])];
  hits = 0;
  const wire = countModelRequestsOnTheWire();
  const last: { x?: Exchange } = {};
  const base = openAICompatibleJudgeTransport({ endpoint, apiKey: "local", model: "m", onExchange: (x) => void (last.x = x) });
  try {
    const r = await runReliabilityCheck({
      run: "sim",
      pairs: options.pairs ?? workload,
      transport: options.transport ? options.transport(base) : base,
      ceilings: options.ceilings ?? CEILINGS,
      price: PRICE,
      wire: wire.count,
      lastExchange: () => last.x,
      clearExchange: () => void delete last.x,
    });
    return { r, hits };
  } finally {
    wire.dispose();
  }
}
const check = (list: { name: string; pass: boolean }[], name: RegExp) => list.find((c) => name.test(c.name))!.pass;

describe("the frozen workload", () => {
  it("60 unique pairs, statements only (no labels anywhere), 6 groups of 10 that each fit ONE call under the 2,800 ceiling", () => {
    expect(workload).toHaveLength(60);
    expect(new Set(workload.map((p) => p.id)).size).toBe(60);
    for (const p of workload) expect(Object.keys(p).sort()).toEqual(["a", "b", "id"]);
    expect(readFileSync(WORKLOAD, "utf8")).not.toMatch(/"(truth|expected|label|answer)"/);
    let total = 0;
    for (let i = 0; i < 60; i += 10) {
      const planned = planCalls(workload.slice(i, i + 10).map((p) => ({ key: p.id, a: { sentence: p.a }, b: { sentence: p.b } })), 1);
      expect(planned.skipped).toEqual([]);
      const t = callTokens(planned.calls[0]!.input);
      expect(t).toBeLessThanOrEqual(JUDGE_CALL_CEILING);
      total += t;
    }
    expect(total).toBeLessThanOrEqual(RELIABILITY_LIMITS.tokens);
  });
});

describe("reliability harness — offline simulations (local server, real transport, real wire counter)", () => {
  it("all calls answered: PASS; 6 calls, and 1 application call = 1 transport request = 1 wire request each", async () => {
    const { r, hits } = await simulate();
    expect(r.passed).toBe(true);
    expect(r.totals).toMatchObject({ sent: 6, pairsSent: 60, classified: 60, failed: 0, appCalls: 6, transportRequests: 6, wireRequests: 6 });
    expect(hits).toBe(6);
    expect(r.calls.every((c) => c.usage?.reasoningTokens === 120 && c.httpStatus === 200 && c.finishReason === "stop")).toBe(true);
  });

  it("a 500 fails exactly its call's 10 pairs, keeps the reservation, is NOT retried (one request on the wire) — and the run fails the 95 % criterion", async () => {
    const { r, hits } = await simulate({ behaviours: ["ok", "500"] });
    expect(hits).toBe(6);
    const c2 = r.calls[1]!;
    expect(c2).toMatchObject({ status: "call_error", failure: "transport", wireRequests: 1, transportRequests: 1, settledTokens: null, httpStatus: 500 });
    expect(Object.values(c2.pairs).every((s) => s === "failed: call_error")).toBe(true);
    expect(r.totals).toMatchObject({ classified: 50, failed: 10 });
    expect(check(r.assertions, /failed call fails exactly/)).toBe(true);
    expect(check(r.criteria, /95 %/)).toBe(false);
    expect(r.passed).toBe(false);
  });

  it("a truncated reply (finish_reason length) fails its pairs and the truncation criterion", async () => {
    const { r } = await simulate({ behaviours: ["length"] });
    expect(r.calls[0]!.finishReason).toBe("length");
    expect(check(r.criteria, /truncated/)).toBe(false);
  });

  it("an answer without usage fails the usage-accounting criterion (the whole reservation is charged)", async () => {
    const { r } = await simulate({ behaviours: ["no_usage"] });
    expect(r.calls[0]!.usageReported).toBe(false);
    expect(check(r.criteria, /usage accounting/)).toBe(false);
  });

  it("an unreadable reply is one request, no repair call; its pairs fail", async () => {
    const { r, hits } = await simulate({ behaviours: ["bad_json"] });
    expect(hits).toBe(6);
    expect(r.calls[0]!.status).toBe("unreadable");
    expect(r.totals.classified).toBe(50);
  });

  it("a timeout fails its pairs, keeps the reservation, and fails the timeout criterion", async () => {
    const { r } = await simulate({
      transport: (base) => ({ ...base, send: async (req) => (req.onProviderRequest?.(), Promise.reject(new DOMException("no reply within 90 s", "TimeoutError"))) }),
      pairs: workload.slice(0, 10),
    });
    expect(r.calls[0]).toMatchObject({ status: "call_error", failure: "timeout", settledTokens: null });
    expect(check(r.criteria, /timeout/)).toBe(false);
  });

  it("a transport that silently retries is caught ON THE WIRE even though its own count says 1", async () => {
    const { r } = await simulate({
      pairs: workload.slice(0, 10),
      transport: (base) => ({
        ...base,
        send: async (req) => {
          // A hidden retry below the transport's boundary: one announced request, two on the wire.
          await fetch(`${endpoint}/chat/completions`, { method: "POST", body: JSON.stringify({ messages: [{ content: "" }, { content: "" }] }) }).then((x) => x.text());
          return base.send(req);
        },
      }),
    });
    expect(r.calls[0]).toMatchObject({ transportRequests: 1, wireRequests: 2 });
    expect(check(r.assertions, /on the wire/)).toBe(false);
    expect(r.passed).toBe(false);
  });

  it("the call ceiling is enforced before sending: with 3 approved calls, 3 are sent and 30 pairs are not", async () => {
    const { r, hits } = await simulate({ ceilings: { ...CEILINGS, calls: 3 } });
    expect(hits).toBe(3);
    expect(r.calls.filter((c) => c.status === "not_sent").map((c) => c.reason)).toEqual(["call limit", "call limit", "call limit"]);
  });

  it("the dollar and token ceilings are enforced before sending (worst case)", async () => {
    expect((await simulate({ ceilings: { ...CEILINGS, usd: 0.0000001 } })).hits).toBe(0);
    expect((await simulate({ ceilings: { ...CEILINGS, tokens: 1_000 } })).hits).toBe(0);
  });

  it("the code caps cannot be raised from outside (6 calls, 16,800 tokens, $0.02)", async () => {
    const { r } = await simulate({ ceilings: { calls: 100, tokens: 1e9, usd: 100 }, pairs: [...workload, ...workload.map((p) => ({ ...p, id: `${p.id}-x` }))] });
    expect(r.totals.sent).toBe(6);
    expect(r.calls.filter((c) => c.status === "not_sent")).toHaveLength(6);
  });

  it("nearest-rank percentile: with 6 samples p95 is the largest", () => {
    expect(percentile([5, 1, 4, 2, 6, 3], 95)).toBe(6);
    expect(percentile([5, 1, 4, 2, 6, 3], 50)).toBe(3);
    expect(percentile([], 95)).toBeNull();
  });
});
