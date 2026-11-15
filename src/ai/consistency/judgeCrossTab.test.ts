/**
 * The final implementation review's failure sequences (intelligent-update-engine-plan §12.28), pinned as regressions.
 * Several "tabs" = separate JudgeLedger / JudgeBudget instances sharing one stored ledger, one stored budget and one
 * critical section (the in-process mutex standing in for the cross-tab Web Lock). Mocked transports, fake timers only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JudgeBudget, type BudgetState, type Candidate } from "./candidates";
import { JUDGE_CALL_TIMEOUT_MS } from "./judge";
import { inProcessSection, JUDGE_DEADLINE_GRACE_MS, runJudgeCheck, type BudgetStore, type CriticalSection, type JudgeTransport, type JudgeTransportRequest } from "./judgeCall";
import { IN_FLIGHT_STALE_MS, JudgeLedger, ledgerKey } from "./judgeLedger";
import { judgePair } from "./rules";

const A = "The team uses PostgreSQL.";
const B = "The team uses MongoDB.";
const cand = (key: string): Candidate => ({ key, a: { sentence: A }, b: { sentence: B }, judgement: judgePair(A, B) });
const reply = () => ({ text: JSON.stringify({ results: [{ ref: "p1", answer: "compatible" }] }), finishReason: "stop", usage: { promptTokens: 900, completionTokens: 300 } });

function memoryMeta(options: { failSets?: () => boolean } = {}) {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined,
    set: async (k: string, v: unknown) => {
      if (options.failSets?.()) throw new Error("disk full");
      data.set(k, structuredClone(v));
    },
  };
}
function memoryBudgetStore(options: { failSaves?: () => boolean } = {}): BudgetStore {
  let state: BudgetState | undefined;
  return {
    load: async () => (state ? structuredClone(state) : undefined),
    save: async (s) => {
      if (options.failSaves?.()) throw new Error("disk full");
      state = structuredClone(s);
    },
  };
}
/** A transport whose replies are released by hand, one per call, in any order. */
function gatedTransport(options: { honoursAbort?: boolean } = {}) {
  const gates: { request: JudgeTransportRequest; release: () => void }[] = [];
  const t: JudgeTransport & { sent: number } = {
    id: "gated",
    capsOutput: true,
    sent: 0,
    send: (request) =>
      new Promise((resolve, reject) => {
        t.sent++;
        gates.push({ request, release: () => resolve(reply()) });
        if (options.honoursAbort !== false) request.signal?.addEventListener("abort", () => reject(request.signal!.reason), { once: true });
      }),
  };
  return { t, gates };
}

interface World { meta: ReturnType<typeof memoryMeta>; budgetStore: BudgetStore; section: CriticalSection }
const world = (): World => ({ meta: memoryMeta(), budgetStore: memoryBudgetStore(), section: inProcessSection() });
const tab = (w: World) => ({ ledger: new JudgeLedger(w.meta), budget: new JudgeBudget() });
const check = (w: World, t: ReturnType<typeof tab>, transport: JudgeTransport, key: string, extra: Partial<Parameters<typeof runJudgeCheck>[0]> = {}) =>
  runJudgeCheck({ canvasId: "c", revision: `rev:${key}:${Math.random()}`, candidates: [cand(key)], budget: t.budget, ledger: t.ledger, transport, aiEnabled: true, section: w.section, budgetStore: w.budgetStore, ...extra });
const stored = (w: World) => Object.fromEntries(((w.meta.data.get(ledgerKey("c")) as { key: string; state: string }[]) ?? []).map((p) => [p.key, p.state]));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 10, 15, 12));
});
afterEach(() => vi.useRealTimers());

describe("§12.28 review #1 — tabs never overwrite each other's ledger records", () => {
  it("P2: tab A's reply doesn't wipe tab B's in-flight mark, so tab C doesn't resend B's pair", async () => {
    const w = world();
    const { t, gates } = gatedTransport();
    const a = check(w, tab(w), t, "x");
    await vi.waitFor(() => expect(gates.length).toBe(1));
    const b = check(w, tab(w), t, "y");
    await vi.waitFor(() => expect(gates.length).toBe(2));
    gates[0]!.release(); // A's reply lands
    await a;
    expect(stored(w)).toMatchObject({ x: "classified", y: "in_flight" });
    const c = await check(w, tab(w), t, "y"); // tab C, while B's call is still out
    expect(c.status).toBe("nothing_to_send");
    expect(t.sent).toBe(2);
    gates[1]!.release();
    await b;
    expect(stored(w)).toEqual({ x: "classified", y: "classified" });
  });

  it("P2b: B's later write (holding a stale in-flight copy of x) doesn't overwrite A's classification of x", async () => {
    const w = world();
    const { t, gates } = gatedTransport();
    const a = check(w, tab(w), t, "x");
    await vi.waitFor(() => expect(gates.length).toBe(1));
    const tabB = tab(w);
    const b = check(w, tabB, t, "y"); // B refreshes and sees x in flight
    await vi.waitFor(() => expect(gates.length).toBe(2));
    expect(tabB.ledger.get("c", "x")?.state).toBe("in_flight");
    gates[0]!.release();
    await a;
    gates[1]!.release();
    await b;
    expect(stored(w)).toEqual({ x: "classified", y: "classified" });
  });
});

describe("§12.28 review #2 and #3 — late replies are never recorded", () => {
  it("P1: a reply after cancellation (from a transport that ignores its signal) is not recorded", async () => {
    const w = world();
    const t1 = tab(w);
    const { t, gates } = gatedTransport({ honoursAbort: false });
    const ac = new AbortController();
    const run = check(w, t1, t, "x", { signal: ac.signal });
    await vi.waitFor(() => expect(gates.length).toBe(1));
    ac.abort();
    gates[0]!.release();
    const r = await run;
    expect(r.call).toMatchObject({ status: "call_error", failure: "cancelled" });
    expect(t1.ledger.get("c", "x")?.state).toBe("failed");
    expect(stored(w).x).toBe("failed");
  });

  it("P4: a frozen tab's late timer can't let a reply older than the deadline through (wall-clock check)", async () => {
    const w = world();
    const t1 = tab(w);
    const { t, gates } = gatedTransport({ honoursAbort: false });
    const run = check(w, t1, t, "x");
    await vi.waitFor(() => expect(gates.length).toBe(1));
    vi.setSystemTime(Date.now() + 200_000); // the clock moves; the deadline timer hasn't run (throttled tab)
    gates[0]!.release();
    const r = await run;
    expect(r.call).toMatchObject({ status: "call_error", failure: "timeout" });
    expect(t1.ledger.get("c", "x")?.answer).toBeUndefined();
  });
});

describe("§12.28 review #4 — a long-lived tab sees an in-flight pair go stale", () => {
  it("P3: past the 180 s window, the in-memory in-flight pair is failed and retryable, in the same ledger", async () => {
    const meta = memoryMeta();
    const ledger = new JudgeLedger(meta);
    ledger.markSent("c", "r", ["x"], "res-1");
    await ledger.flushed();
    expect(ledger.blocksResend("c", "x")).toBe(true);
    vi.advanceTimersByTime(IN_FLIGHT_STALE_MS + 1);
    await ledger.refresh("c");
    expect(ledger.blocksResend("c", "x")).toBe(false);
    expect(ledger.retryable("c")).toEqual(["x"]);
    expect(ledger.get("c", "x")).toMatchObject({ state: "failed", attempts: 1, reason: "call_error" });
  });

  it("the backstop is well inside the window: a live call is always answered or timed out before it could go stale", () => {
    expect(JUDGE_CALL_TIMEOUT_MS + JUDGE_DEADLINE_GRACE_MS).toBeLessThan(IN_FLIGHT_STALE_MS);
  });
});

describe("§12.28 review #5 — storage failures never send, never charge an attempt", () => {
  it("P5: the budget can't be saved → nothing marked in flight, nothing sent, no attempt counted", async () => {
    const w: World = { meta: memoryMeta(), budgetStore: memoryBudgetStore({ failSaves: () => true }), section: inProcessSection() };
    const t1 = tab(w);
    const { t } = gatedTransport();
    await expect(check(w, t1, t, "x")).rejects.toThrow("disk full");
    expect(t.sent).toBe(0);
    expect(t1.ledger.get("c", "x")).toBeUndefined();
  });

  it("the ledger can't be saved → the call is not sent, the reservation released, the pair pending with no attempt", async () => {
    let failing = true;
    const w: World = { meta: memoryMeta({ failSets: () => failing }), budgetStore: memoryBudgetStore(), section: inProcessSection() };
    const t1 = tab(w);
    const { t } = gatedTransport();
    const r = await check(w, t1, t, "x");
    expect(r.status).toBe("nothing_to_send");
    expect(r.note).toMatch(/couldn't be saved/);
    expect(t.sent).toBe(0);
    expect(t1.budget.state().tokens).toBe(0);
    expect(t1.ledger.get("c", "x")).toMatchObject({ state: "pending", attempts: 0 });
    failing = false;
  });
});

describe("§12.28 review #6 — an overrun across UTC midnight is still charged", () => {
  it("P6: reserved at 23:59:30, settled after midnight with usage above the reservation → the excess is charged to the new day", () => {
    vi.setSystemTime(Date.UTC(2026, 10, 15, 23, 59, 30));
    const budget = new JudgeBudget();
    const r = budget.reserve("rev:1", 2_000);
    expect(r.ok).toBe(true);
    vi.setSystemTime(Date.UTC(2026, 10, 16, 0, 0, 30));
    budget.settle(r.ok ? r.reservation : "", 7_000, 2_000);
    expect(budget.state()).toMatchObject({ day: "2026-11-16", tokens: 5_000 });
  });
});
