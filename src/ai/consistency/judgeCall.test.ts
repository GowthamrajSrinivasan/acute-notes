/**
 * Safety checkpoint for the dedicated AI call path (intelligent-update-engine-plan §12.25). Mocked providers only: no
 * network, no model. Covers the review's list: budget concurrency, fallback / repair prevention, token limits, context
 * identity invalidation, retry behaviour, and failure handling.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AIProvider, AIRequest, AIResponse } from "@/ai/types";
import { DAILY_TOKEN_CAP, JudgeBudget, type BudgetState, type Candidate } from "./candidates";
import { JUDGE_CALL_CEILING, outputBudget } from "./judge";
import { inProcessSection, JUDGE_REASONING_EFFORT, providerJudgeTransport, runJudgeCheck, sendJudgeCall, webLockSection, type BudgetStore, type JudgeTransport, type JudgeTransportRequest } from "./judgeCall";
import { openAICompatibleJudgeTransport } from "@/ai/contractTests/judgeHttpTransport";
import { JudgeLedger, pairContext } from "./judgeLedger";
import { judgePair } from "./rules";

const DAY = Date.UTC(2026, 10, 15, 12);
const now = () => DAY;

/** A pair the rules leave "possible", so it goes to the AI. */
function candidate(key: string, a = "The team uses PostgreSQL.", b = "The team uses MongoDB.", ctx: { cardA?: string; sectionA?: string; cardB?: string; sectionB?: string } = {}): Candidate {
  return { key, a: { sentence: a, ...(ctx.cardA ? { card: ctx.cardA } : {}), ...(ctx.sectionA ? { section: ctx.sectionA } : {}) }, b: { sentence: b, ...(ctx.cardB ? { card: ctx.cardB } : {}), ...(ctx.sectionB ? { section: ctx.sectionB } : {}) }, judgement: judgePair(a, b) };
}

/** A reply answering every pair of the request with `answer`. */
const replyFor = (request: JudgeTransportRequest, answer = "compatible") => {
  const n = (request.prompt.match(/^p\d+$/gm) ?? []).length;
  return { text: JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ ref: `p${i + 1}`, answer, why: "x" })) }), finishReason: "stop", usage: { promptTokens: 700, completionTokens: 300 } };
};

function fakeTransport(behave: (request: JudgeTransportRequest, n: number) => Promise<ReturnType<typeof replyFor>> | ReturnType<typeof replyFor>, capsOutput = true): JudgeTransport & { requests: JudgeTransportRequest[] } {
  const requests: JudgeTransportRequest[] = [];
  return { id: "fake", capsOutput, requests, send: async (r) => (requests.push(r), behave(r, requests.length)) };
}

function memoryBudgetStore(): BudgetStore & { state?: BudgetState } {
  const s: { state?: BudgetState } = {};
  return Object.assign(s, { load: async () => (s.state ? structuredClone(s.state) : undefined), save: async (x: BudgetState) => void (s.state = structuredClone(x)) });
}

function memoryMeta() {
  const data = new Map<string, unknown>();
  return { data, get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined, set: async (k: string, v: unknown) => void data.set(k, structuredClone(v)) };
}

function fakeProvider(generate: (r: AIRequest) => Promise<AIResponse>, outputCap: "passed" | "ignored" | "absent" = "passed"): AIProvider & { calls: AIRequest[] } {
  const calls: AIRequest[] = [];
  return {
    id: "fake-provider",
    name: "Fake",
    authTypes: ["api_key"],
    transport: "ai_host_local",
    capabilities: { streaming: false, structuredOutput: "json_mode", toolCalling: false, vision: false, embeddings: false, modelSelection: false, ...(outputCap !== "absent" ? { outputCap } : {}) },
    isConfigured: async () => true,
    testConnection: async () => ({ ok: true }),
    calls,
    generate: (r) => (calls.push(r), generate(r)),
  } as AIProvider & { calls: AIRequest[] };
}

const run = (over: Partial<Parameters<typeof runJudgeCheck>[0]> & { transport: JudgeTransport }) =>
  runJudgeCheck({ canvasId: "c", revision: "rev:1", candidates: [candidate("k1")], budget: new JudgeBudget({ now }), ledger: new JudgeLedger(undefined, now), aiEnabled: true, ...over });

afterEach(() => vi.unstubAllGlobals());

describe("§12.25 budget — reservation is atomic", () => {
  it("two tabs (two budgets, one stored state, one lock) can't both spend the last call", async () => {
    const store = memoryBudgetStore();
    const section = inProcessSection(); // stands in for the cross-tab Web Lock
    const meta = memoryMeta();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = fakeTransport(async (r) => (await gate, replyFor(r)));
    const tab = (rev: string, key: string) =>
      runJudgeCheck({ canvasId: "c", revision: rev, candidates: [candidate(key)], budget: new JudgeBudget({ now, dailyCap: 1 }), ledger: new JudgeLedger(meta, now), transport: t, aiEnabled: true, section, budgetStore: store });
    const both = Promise.all([tab("rev:1", "k1"), tab("rev:2", "k2")]);
    await vi.waitFor(() => expect(t.requests.length).toBe(1));
    release();
    const [a, b] = await both;
    expect(t.requests.length).toBe(1);
    expect([a.status, b.status].sort()).toEqual(["answered", "nothing_to_send"]);
    expect([...a.plan.pending, ...b.plan.pending].map((p) => p.reason)).toEqual(["daily_cap"]);
    expect(store.state!.used).toBe(1);
  });

  it("the token cap holds the same way under concurrency: never more than 90,000 reserved", async () => {
    const store = memoryBudgetStore();
    store.state = { day: "2026-11-15", used: 0, tokens: DAILY_TOKEN_CAP - JUDGE_CALL_CEILING, changes: [], open: {} };
    const section = inProcessSection();
    const t = fakeTransport((r) => ({ ...replyFor(r), usage: {} as never })); // no usage reported: the whole reservation is kept
    const results = await Promise.all(["k1", "k2", "k3"].map((k, i) => runJudgeCheck({ canvasId: "c", revision: `rev:${i}`, candidates: [candidate(k)], budget: new JudgeBudget({ now }), ledger: new JudgeLedger(undefined, now), transport: t, aiEnabled: true, section, budgetStore: store })));
    expect(t.requests.length).toBe(1);
    expect(results.filter((r) => r.status === "nothing_to_send").every((r) => r.plan.pending[0]!.reason === "daily_tokens")).toBe(true);
    expect(store.state!.tokens).toBeLessThanOrEqual(DAILY_TOKEN_CAP);
  });

  it("the Web Lock is used when the browser has one", async () => {
    const request = vi.fn((_name: string, _o: unknown, fn: () => Promise<unknown>) => fn());
    vi.stubGlobal("navigator", { locks: { request } });
    const section = webLockSection("test-lock");
    expect(await section.run(async () => 42)).toBe(42);
    expect(request).toHaveBeenCalledWith("test-lock", { mode: "exclusive" }, expect.any(Function));
  });

  it("the per-call ceiling (2,800) and the 90,000 daily cap are unchanged", () => {
    expect(JUDGE_CALL_CEILING).toBe(2_800);
    expect(DAILY_TOKEN_CAP).toBe(90_000);
  });
});

describe("§12.25 provider controls — one attempt, no repair, no fallback", () => {
  it("a provider error is one call: no second attempt, no other provider; the pair fails and the reservation is kept", async () => {
    const provider = fakeProvider(async () => {
      throw Object.assign(new Error("model unavailable"), { kind: "model_unavailable" });
    });
    const budget = new JudgeBudget({ now });
    const ledger = new JudgeLedger(undefined, now);
    const r = await run({ transport: providerJudgeTransport(provider), budget, ledger });
    expect(provider.calls.length).toBe(1);
    expect(r.status).toBe("call_error");
    expect(ledger.get("c", "k1")).toMatchObject({ state: "failed", reason: "call_error", attempts: 1 });
    expect(budget.state().tokens).toBe(r.plan.call!.tokens);
  });

  it("an invalid reply gets no repair call: it fails its pairs", async () => {
    const provider = fakeProvider(async () => ({ text: '{"results":[{"ref":"p1","answer":"maybe"}]}', model: "m", finishReason: "stop", usage: { provider: "fake", model: "m" } }));
    const ledger = new JudgeLedger(undefined, now);
    const r = await run({ transport: providerJudgeTransport(provider), ledger });
    expect(provider.calls.length).toBe(1);
    expect(r.call!.reading!.status).toBe("partial");
    expect(ledger.get("c", "k1")).toMatchObject({ state: "failed", reason: "invalid_answer" });
  });

  it("the HTTP transport makes exactly one request, even on a 429 or a 500", async () => {
    for (const status of [429, 500]) {
      const fetchImpl = vi.fn(async () => new Response("busy", { status }));
      const t = openAICompatibleJudgeTransport({ endpoint: "https://x.test/v1", apiKey: "k", model: "m", fetchImpl: fetchImpl as unknown as typeof fetch });
      const r = await run({ transport: t });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(r.status).toBe("call_error");
    }
  });
});

describe("§12.25 output limits — the cap reaches the model, or nothing is sent", () => {
  it("the request carries max_tokens = answer + reasoning reserve, and reasoning effort low", async () => {
    const provider = fakeProvider(async (req) => ({ text: replyFor({ prompt: req.prompt } as JudgeTransportRequest).text, model: "m", finishReason: "stop", usage: { provider: "fake", model: "m", promptTokens: 900, completionTokens: 400 } }));
    const r = await run({ transport: providerJudgeTransport(provider) });
    expect(provider.calls[0]).toMatchObject({ task: "judge_consistency", temperature: 0, maxTokens: outputBudget(r.plan.call!.input), reasoningEffort: JUDGE_REASONING_EFFORT });
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: replyFor({ prompt: JSON.parse(String(init.body)).messages[1].content } as JudgeTransportRequest).text }, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 400 } })));
    await run({ transport: openAICompatibleJudgeTransport({ endpoint: "https://x.test/v1", apiKey: "k", model: "m", fetchImpl: fetchImpl as unknown as typeof fetch }) });
    expect(JSON.parse(String(fetchImpl.mock.calls[0]![1].body))).toMatchObject({ max_tokens: outputBudget(r.plan.call!.input), reasoning_effort: "low", temperature: 0 });
  });

  it("a connection that can't cap output (Copilot subscription) sends nothing and reserves nothing", async () => {
    for (const cap of ["ignored", "absent"] as const) {
      const provider = fakeProvider(async () => {
        throw new Error("must not be called");
      }, cap);
      const budget = new JudgeBudget({ now });
      const ledger = new JudgeLedger(undefined, now);
      const r = await run({ transport: providerJudgeTransport(provider), budget, ledger });
      expect(r.status).toBe("no_output_cap");
      expect(provider.calls.length).toBe(0);
      expect(budget.state()).toMatchObject({ used: 0, tokens: 0 });
      expect(ledger.get("c", "k1")).toMatchObject({ state: "pending", reason: "output_cap_unavailable" });
    }
  });

  it("usage above the reservation is charged and flagged", async () => {
    const budget = new JudgeBudget({ now });
    const t = fakeTransport((r) => ({ ...replyFor(r), usage: { promptTokens: 2_500, completionTokens: 900 } }));
    const r = await run({ transport: t, budget });
    expect(r.call).toMatchObject({ usedTokens: 3_400, overReservation: true });
    expect(budget.state().tokens).toBe(3_400);
  });

  it("a cut-off or malformed reply fails its pairs — never compatible", async () => {
    for (const text of ['{"results":[{"ref":"p1","answer":"compat', "Sorry, I can't help with that.", ""]) {
      const ledger = new JudgeLedger(undefined, now);
      const r = await run({ transport: fakeTransport(() => ({ text, finishReason: "stop", usage: {} as never })), ledger });
      expect(r.call!.reading!.status).not.toBe("ok");
      expect(ledger.get("c", "k1")?.state).toBe("failed");
      expect(ledger.get("c", "k1")?.answer).toBeUndefined();
    }
    const ledger = new JudgeLedger(undefined, now);
    await run({ transport: fakeTransport((r) => ({ ...replyFor(r), finishReason: "length" })), ledger });
    expect(ledger.get("c", "k1")).toMatchObject({ state: "failed", reason: "truncated" });
  });
});

describe("§12.25 idempotency and retries", () => {
  it("a pair already in flight (this tab or another) is not sent again by a concurrent check", async () => {
    const meta = memoryMeta();
    const section = inProcessSection();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = fakeTransport(async (r) => (await gate, replyFor(r)));
    const tab = () => runJudgeCheck({ canvasId: "c", revision: "rev:1", candidates: [candidate("k1")], budget: new JudgeBudget({ now }), ledger: new JudgeLedger(meta, now), transport: t, aiEnabled: true, retry: true, section });
    const first = tab();
    await vi.waitFor(() => expect(t.requests.length).toBe(1));
    const second = await tab(); // another tab, while the first call is out
    expect(second.status).toBe("nothing_to_send");
    expect(second.plan.skipped).toEqual([{ key: "k1", reason: "already_judged" }]);
    release();
    expect((await first).status).toBe("answered");
    expect(t.requests.length).toBe(1);
  });

  it("a classified pair is never resent, even on Retry; a failed one is, within the budget, and gives up after 3 attempts", async () => {
    const ledger = new JudgeLedger(undefined, now);
    const budget = new JudgeBudget({ now });
    const ok = fakeTransport((r) => replyFor(r));
    await run({ transport: ok, ledger, budget });
    const again = await run({ transport: ok, ledger, budget, retry: true, revision: "rev:2" });
    expect(again.status).toBe("nothing_to_send");
    expect(ok.requests.length).toBe(1);

    const failing = fakeTransport(() => ({ text: "", finishReason: "stop", usage: {} as never }));
    const l2 = new JudgeLedger(undefined, now);
    const b2 = new JudgeBudget({ now });
    for (let i = 0; i < 4; i++) await run({ transport: failing, ledger: l2, budget: b2, retry: true, revision: `rev:${i}` });
    expect(failing.requests.length).toBe(3);
    expect(l2.get("c", "k1")).toMatchObject({ state: "gave_up", attempts: 3 });
    expect(b2.state().used).toBe(3);
  });

  it("a late reading of an older call can't overwrite the pair's newer call or a classification", () => {
    const ledger = new JudgeLedger(undefined, now);
    ledger.markSent("c", "rev:1", ["k1"], "old");
    ledger.recordCallError("c", "rev:1", ["k1"], "timeout", "old");
    ledger.markSent("c", "rev:2", ["k1"], "new");
    ledger.recordReading("c", "rev:1", { pairs: new Map([["k1", { state: "classified", answer: "contradicts" }]]) }, "old");
    expect(ledger.get("c", "k1")).toMatchObject({ state: "in_flight", reservation: "new" });
    ledger.recordReading("c", "rev:2", { pairs: new Map([["k1", { state: "classified", answer: "compatible" }]]) }, "new");
    ledger.recordReading("c", "rev:2", { pairs: new Map([["k1", { state: "classified", answer: "contradicts" }]]) }, "new");
    expect(ledger.get("c", "k1")).toMatchObject({ state: "classified", answer: "compatible" });
  });

  it("the AI switch off: nothing planned, nothing sent", async () => {
    const t = fakeTransport((r) => replyFor(r));
    const r = await run({ transport: t, aiEnabled: false });
    expect(r.status).toBe("ai_off");
    expect(t.requests.length).toBe(0);
  });
});

describe("§12.25 context identity — a material move or rename invalidates a stale answer and keeps its history", () => {
  const ctx = { cardA: "Database", sectionA: "Architecture", cardB: "Storage", sectionB: "Architecture" };

  it("renaming a card or moving it to another section sends the pair again; the old answer is kept in history", async () => {
    const ledger = new JudgeLedger(undefined, now);
    const budget = new JudgeBudget({ now });
    const t = fakeTransport((r, n) => replyFor(r, n === 1 ? "compatible" : "contradicts"));
    await run({ transport: t, ledger, budget, candidates: [candidate("k1", undefined, undefined, ctx)] });
    const moved = candidate("k1", undefined, undefined, { ...ctx, sectionB: "Billing" });
    expect(pairContext(moved)).not.toBe(pairContext(candidate("k1", undefined, undefined, ctx)));
    const r = await run({ transport: t, ledger, budget, revision: "rev:2", candidates: [moved] });
    expect(r.status).toBe("answered");
    expect(t.requests.length).toBe(2);
    const p = ledger.get("c", "k1")!;
    expect(p).toMatchObject({ state: "classified", answer: "contradicts", context: pairContext(moved) });
    expect(p.history).toEqual([expect.objectContaining({ answer: "compatible", context: pairContext(candidate("k1", undefined, undefined, ctx)), revision: "rev:1" })]);
    expect(t.requests[1]!.prompt).toContain("Billing");
  });

  it("re-typing the same names (case, spacing, punctuation) is not material: no resend", async () => {
    const ledger = new JudgeLedger(undefined, now);
    const t = fakeTransport((r) => replyFor(r));
    await run({ transport: t, ledger, candidates: [candidate("k1", undefined, undefined, ctx)] });
    const retyped = candidate("k1", undefined, undefined, { cardA: "database ", sectionA: "ARCHITECTURE", cardB: "Storage.", sectionB: "architecture" });
    const r = await run({ transport: t, ledger, revision: "rev:2", candidates: [retyped] });
    expect(r.status).toBe("nothing_to_send");
    expect(t.requests.length).toBe(1);
  });

  it("history survives a save and reload, bounded", async () => {
    const meta = memoryMeta();
    const ledger = new JudgeLedger(meta, now);
    for (let i = 0; i < 5; i++) {
      ledger.markSent("c", `rev:${i}`, ["k1"], `r${i}`, new Map([["k1", `ctx${i}`]]));
      ledger.recordReading("c", `rev:${i}`, { pairs: new Map([["k1", { state: "classified", answer: i % 2 ? "contradicts" : "compatible" }]]) }, `r${i}`);
    }
    await ledger.flushed();
    const reread = new JudgeLedger(meta, now);
    await reread.load("c");
    expect(reread.get("c", "k1")).toMatchObject({ state: "classified", answer: "compatible", context: "ctx4" });
    expect(reread.get("c", "k1")!.history!.map((h) => h.context)).toEqual(["ctx3", "ctx2", "ctx1"]);
  });
});

describe("§12.25 sendJudgeCall used directly (the recorder's path)", () => {
  it("a transport without a cap gets nothing sent and the reservation released", async () => {
    const ledger = new JudgeLedger(undefined, now);
    const t = fakeTransport((r) => replyFor(r), false);
    let settled: number | null | undefined;
    const r = await sendJudgeCall({ canvasId: "c", revision: "x", keys: ["k1"], input: { pairs: [{ ref: "p1", a: { sentence: "A." }, b: { sentence: "B." } }] }, reservation: "r1", reserved: 1_000, transport: t, ledger, settle: (a) => void (settled = a) });
    expect(r.status).toBe("no_output_cap");
    expect(t.requests.length).toBe(0);
    expect(settled).toBe(0);
    expect(ledger.get("c", "k1")?.state).toBe("failed");
  });
});
