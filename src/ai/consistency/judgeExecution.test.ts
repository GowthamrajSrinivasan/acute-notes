/**
 * Execution reliability, offline (intelligent-update-engine-plan §12.27): delayed replies, timeouts, cancellation,
 * restart, partial batches and usage limits — fake timers and mocked transports only, no network, no model.
 * Unanswered pairs must stay failed (or pending), never compatible.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DAILY_TOKEN_CAP, JudgeBudget, type Candidate } from "./candidates";
import { combine, JUDGE_CALL_CEILING, JUDGE_CALL_TIMEOUT_MS } from "./judge";
import { JUDGE_DEADLINE_GRACE_MS, runJudgeCheck, sendJudgeCall, type JudgeTransport, type JudgeTransportRequest } from "./judgeCall";
import { IN_FLIGHT_STALE_MS, JudgeLedger, ledgerKey } from "./judgeLedger";
import { judgePair } from "./rules";
import { judgementForCombine, screenPair } from "./screen";

const A = "The team uses PostgreSQL.";
const B = "The team uses MongoDB.";
const cand = (key: string): Candidate => ({ key, a: { sentence: A }, b: { sentence: B }, judgement: judgePair(A, B) });
const answers = (request: JudgeTransportRequest, n?: number) => {
  const all = (request.prompt.match(/^p\d+$/gm) ?? []).length;
  return JSON.stringify({ results: Array.from({ length: n ?? all }, (_, i) => ({ ref: `p${i + 1}`, answer: "compatible" })) });
};
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

/** A transport that answers after `delayMs`. `honoursAbort: false` simulates one that ignores its signal (the path's backstop must then fire). */
function slowTransport(delayMs: number, options: { honoursAbort?: boolean; answered?: number; usage?: { promptTokens?: number; completionTokens?: number } } = {}): JudgeTransport & { sent: number; finished: number } {
  const t = {
    id: "slow",
    capsOutput: true,
    sent: 0,
    finished: 0,
    async send(request: JudgeTransportRequest) {
      t.sent++;
      await sleep(delayMs, options.honoursAbort === false ? undefined : request.signal);
      t.finished++;
      return { text: answers(request, options.answered), finishReason: "stop", usage: options.usage ?? { promptTokens: 900, completionTokens: 400 } };
    },
  };
  return t;
}

/** Ten pairs → one 10-pair call. */
const ten = Array.from({ length: 10 }, (_, i) => cand(`k${i + 1}`));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 15, 12));
});
afterEach(() => vi.useRealTimers());

describe("§12.27 configuration", () => {
  it("request timeout 90 s; in-flight recovery window 180 s, separate and at least twice the timeout; backstop just past the timeout", () => {
    expect(JUDGE_CALL_TIMEOUT_MS).toBe(90_000);
    expect(IN_FLIGHT_STALE_MS).toBe(180_000);
    expect(IN_FLIGHT_STALE_MS).toBeGreaterThanOrEqual(2 * JUDGE_CALL_TIMEOUT_MS);
    expect(JUDGE_DEADLINE_GRACE_MS).toBeLessThanOrEqual(10_000);
  });

  it("the request carries the 90 s timeout to the transport", async () => {
    const t = slowTransport(1_000);
    const spy = vi.spyOn(t, "send");
    const run = runJudgeCheck({ canvasId: "c", revision: "r", candidates: ten, budget: new JudgeBudget(), ledger: new JudgeLedger(), transport: t, aiEnabled: true });
    await vi.advanceTimersByTimeAsync(1_000);
    await run;
    expect(spy.mock.calls[0]![0].timeoutMs).toBe(90_000);
  });
});

describe("§12.27 delayed replies and timeouts", () => {
  it("a 45 s reply — which the old 30 s limit cut off — is now answered", async () => {
    const ledger = new JudgeLedger();
    const run = runJudgeCheck({ canvasId: "c", revision: "r", candidates: ten, budget: new JudgeBudget(), ledger, transport: slowTransport(45_000), aiEnabled: true });
    await vi.advanceTimersByTimeAsync(45_000);
    const r = await run;
    expect(r.status).toBe("answered");
    expect(ledger.list("c", ["classified"]).length).toBe(10);
  });

  it("no reply within 90 s (the transport honours its signal): a timeout — every pair failed, the reservation kept", async () => {
    const ledger = new JudgeLedger();
    const budget = new JudgeBudget();
    const t = slowTransport(10 * 60_000);
    const run = runJudgeCheck({ canvasId: "c", revision: "r", candidates: ten, budget, ledger, transport: t, aiEnabled: true });
    await vi.advanceTimersByTimeAsync(JUDGE_CALL_TIMEOUT_MS + JUDGE_DEADLINE_GRACE_MS);
    const r = await run;
    expect(r.call).toMatchObject({ status: "call_error", failure: "timeout" });
    expect(ledger.list("c", ["failed"]).length).toBe(10);
    expect(ledger.list("c", ["classified"]).length).toBe(0);
    expect(budget.state().tokens).toBe(r.plan.call!.tokens); // may have been billed: kept
  });

  it("a transport that ignores its timeout is stopped by the path's own deadline; its late reply is never recorded", async () => {
    const ledger = new JudgeLedger();
    const t = slowTransport(200_000, { honoursAbort: false });
    const run = runJudgeCheck({ canvasId: "c", revision: "r", candidates: ten, budget: new JudgeBudget(), ledger, transport: t, aiEnabled: true });
    await vi.advanceTimersByTimeAsync(JUDGE_CALL_TIMEOUT_MS + JUDGE_DEADLINE_GRACE_MS);
    const r = await run;
    expect(r.call?.failure).toBe("timeout");
    await vi.advanceTimersByTimeAsync(200_000); // the late reply arrives
    expect(t.finished).toBe(1);
    expect(ledger.list("c", ["classified"]).length).toBe(0);
    expect(ledger.list("c", ["failed"]).every((p) => p.reason === "call_error" && /timeout/.test(p.detail ?? ""))).toBe(true);
  });
});

describe("§12.27 cancellation", () => {
  it("cancelled mid-call: every pair failed as cancelled, the reservation kept (it may have been billed)", async () => {
    const ledger = new JudgeLedger();
    const budget = new JudgeBudget();
    const ac = new AbortController();
    const run = runJudgeCheck({ canvasId: "c", revision: "r", candidates: ten, budget, ledger, transport: slowTransport(60_000), aiEnabled: true, signal: ac.signal });
    await vi.advanceTimersByTimeAsync(5_000);
    ac.abort();
    const r = await run;
    expect(r.call).toMatchObject({ status: "call_error", failure: "cancelled" });
    expect(ledger.list("c", ["failed"]).length).toBe(10);
    expect(budget.state().tokens).toBe(r.plan.call!.tokens);
  });

  it("cancelled before sending: nothing sent, the reservation released", async () => {
    const ledger = new JudgeLedger();
    const t = slowTransport(1_000);
    let settled: number | null | undefined;
    const ac = new AbortController();
    ac.abort();
    const r = await sendJudgeCall({ canvasId: "c", revision: "r", keys: ["k1"], input: { pairs: [{ ref: "p1", a: { sentence: A }, b: { sentence: B } }] }, reservation: "res", reserved: 1_500, transport: t, ledger, settle: (x) => void (settled = x), signal: ac.signal });
    expect(r).toMatchObject({ status: "call_error", failure: "cancelled" });
    expect(t.sent).toBe(0);
    expect(settled).toBe(0);
  });
});

describe("§12.27 restart (in-flight recovery)", () => {
  function memoryMeta() {
    const data = new Map<string, unknown>();
    return { data, get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined, set: async (k: string, v: unknown) => void data.set(k, structuredClone(v)) };
  }

  it("a call still inside the recovery window stays in flight after a reload (another tab's slow call is not resent)", async () => {
    const meta = memoryMeta();
    const tab = new JudgeLedger(meta);
    tab.markSent("c", "r", ["k1"], "res-1");
    await tab.flushed();
    vi.advanceTimersByTime(100_000); // past the 90 s timeout, inside the 180 s window
    const reloaded = new JudgeLedger(meta);
    await reloaded.load("c");
    expect(reloaded.get("c", "k1")?.state).toBe("in_flight");
    expect(reloaded.retryable("c")).toEqual([]);
    expect(reloaded.blocksResend("c", "k1")).toBe(true);
  });

  it("past the window it was interrupted: failed with the attempt counted, retryable — never compatible", async () => {
    const meta = memoryMeta();
    const tab = new JudgeLedger(meta);
    tab.markSent("c", "r", ["k1"], "res-1");
    await tab.flushed();
    vi.advanceTimersByTime(IN_FLIGHT_STALE_MS + 1);
    const reloaded = new JudgeLedger(meta);
    await reloaded.load("c");
    expect(reloaded.get("c", "k1")).toMatchObject({ state: "failed", reason: "call_error", attempts: 1 });
    expect(reloaded.get("c", "k1")?.answer).toBeUndefined();
    expect(reloaded.retryable("c")).toEqual(["k1"]);
    expect(meta.data.has(ledgerKey("c"))).toBe(true);
  });
});

describe("§12.27 partial batches and unanswered pairs", () => {
  it("a reply answering 6 of 10 pairs: 6 classified, 4 failed as missing — none compatible by default", async () => {
    const ledger = new JudgeLedger();
    const run = runJudgeCheck({ canvasId: "c", revision: "r", candidates: ten, budget: new JudgeBudget(), ledger, transport: slowTransport(1_000, { answered: 6 }), aiEnabled: true });
    await vi.advanceTimersByTimeAsync(1_000);
    const r = await run;
    expect(r.call?.reading?.status).toBe("partial");
    expect(ledger.list("c", ["classified"]).length).toBe(6);
    const missing = ledger.list("c", ["failed"]);
    expect(missing.map((p) => p.reason)).toEqual(Array(4).fill("missing_answer"));
    expect(missing.every((p) => p.answer === undefined)).toBe(true);
  });

  it("a pair with no AI answer is shown as possible (not checked), never hidden as compatible", () => {
    const s = screenPair(A, B);
    expect(s.decision).toBe("forward");
    expect(combine(judgementForCombine(s), undefined)).toMatchObject({ shown: "possible" });
  });
});

describe("§12.27 usage limits", () => {
  it("timed-out calls still count against the day: the 90,000 cap stops further calls", async () => {
    const budget = new JudgeBudget();
    const ledger = new JudgeLedger();
    const t = slowTransport(10 * 60_000);
    let sent = 0;
    // Full 10-pair calls (≈ 2,300 tokens each): the token cap binds before the 50-call cap.
    for (let i = 0; i < 45; i++) {
      const run = runJudgeCheck({ canvasId: "c", revision: `r${i}`, candidates: Array.from({ length: 10 }, (_, j) => cand(`p${i}-${j}`)), budget, ledger, transport: t, aiEnabled: true });
      await vi.advanceTimersByTimeAsync(JUDGE_CALL_TIMEOUT_MS + JUDGE_DEADLINE_GRACE_MS);
      const r = await run;
      if (r.call) sent++;
      else expect(r.plan.pending[0]?.reason).toBe("daily_tokens");
    }
    expect(budget.state().tokens).toBeLessThanOrEqual(DAILY_TOKEN_CAP);
    expect(sent).toBeLessThan(45);
    expect(sent).toBeGreaterThanOrEqual(30);
    expect(t.sent).toBe(sent);
  });

  it("an overrun that exhausts the day blocks the next call: usage above the reservation is charged, then nothing more is sent", async () => {
    const budget = new JudgeBudget({ state: { day: "2026-11-15", used: 0, tokens: DAILY_TOKEN_CAP - 3_000, changes: [], open: {} } });
    const ledger = new JudgeLedger();
    // The provider reports far more than reserved (a provider that ignores the cap): the whole amount is charged.
    const t = slowTransport(1_000, { usage: { promptTokens: 2_500, completionTokens: 2_500 } });
    const first = runJudgeCheck({ canvasId: "c", revision: "r1", candidates: ten, budget, ledger, transport: t, aiEnabled: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await first).call?.overReservation).toBe(true);
    expect(budget.state().tokens).toBe(DAILY_TOKEN_CAP - 3_000 + 5_000); // over the cap: recorded, not hidden
    expect(budget.remainingTokens()).toBe(0);
    const second = await runJudgeCheck({ canvasId: "c", revision: "r2", candidates: [cand("other")], budget, ledger, transport: t, aiEnabled: true });
    expect(second.status).toBe("nothing_to_send");
    expect(second.plan.pending[0]?.reason).toBe("daily_tokens");
    expect(t.sent).toBe(1);
  });

  it("no call reserves above the 2,800 ceiling; reported usage above the reservation is charged", async () => {
    const budget = new JudgeBudget();
    const run = runJudgeCheck({ canvasId: "c", revision: "r", candidates: ten, budget, ledger: new JudgeLedger(), transport: slowTransport(1_000, { usage: { promptTokens: 2_600, completionTokens: 1_300 } }), aiEnabled: true });
    await vi.advanceTimersByTimeAsync(1_000);
    const r = await run;
    expect(r.plan.call!.tokens).toBeLessThanOrEqual(JUDGE_CALL_CEILING);
    expect(r.call).toMatchObject({ usedTokens: 3_900, overReservation: true });
    expect(budget.state().tokens).toBe(3_900);
  });
});
