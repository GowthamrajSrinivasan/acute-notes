/**
 * The live AI check (Stage 4f, Phase 1 close-out), end to end with a mocked transport: discovery through the screen,
 * the manual one-call run, review-only recording, observable states and the budget. No network.
 */
import { describe, expect, it, vi } from "vitest";
import { AICheckQueue, aiCheckStatus, backlogOf, BUDGET_KEY, callsAdmitted, discoverForAI, PLANNING, isOptedIn, MAX_QUEUED, runAICheck, setOptIn, type QueuedPair } from "./aiCheck";
import { DAILY_TOKEN_CAP } from "./candidates";
import { inProcessSection, type JudgeTransport, type JudgeTransportRequest } from "./judgeCall";
import { JudgeLedger } from "./judgeLedger";
import { ConsistencyStore } from "./store";

function memoryMeta() {
  const m = new Map<string, unknown>();
  return { m, get: async <T,>(k: string) => structuredClone(m.get(k)) as T | undefined, set: async (k: string, v: unknown) => void m.set(k, structuredClone(v)) };
}

/** Cards: "new" says the claim; the others say one sentence each. */
const CARDS: Record<string, { elementId: string; name: string; sentences: string[] }> = {
  n: { elementId: "n", name: "Ops notes", sentences: ["Backups run every night at 2 a.m.", "Customers can request a refund within 14 days."] },
  x: { elementId: "x", name: "Runbook", sentences: ["Backups run once a week on Sunday."] },
  y: { elementId: "y", name: "Policy", sentences: ["The refund window is 30 days from delivery."] },
  z: { elementId: "z", name: "Office", sentences: ["The office is in Berlin."] },
};
const cardOf = (id: string) => CARDS[id] ?? null;
const claims = CARDS.n!.sentences.map((sentence) => ({ elementId: "n", sentence }));
const everyOther = () => ["x", "y", "z", "n"];

/** A transport that answers each pair from `answers` (by the order sent), counting requests. */
function fakeTransport(answers: string[], extra: Partial<JudgeTransport> = {}) {
  const sent: JudgeTransportRequest[] = [];
  const t: JudgeTransport = {
    id: "fake",
    capsOutput: true,
    singleAttempt: true,
    async send(request) {
      request.onProviderRequest?.();
      sent.push(request);
      const refs = [...request.prompt.matchAll(/^p(\d+)$/gm)].map((m) => `p${m[1]}`);
      return { text: JSON.stringify({ results: refs.map((ref, i) => ({ ref, answer: answers[i] ?? "unclear", why: `reason ${ref}` })) }), finishReason: "stop", usage: { promptTokens: 800, completionTokens: 200 }, providerRequests: 1 };
    },
    ...extra,
  };
  return { t, sent };
}

async function setup() {
  const meta = memoryMeta();
  const queue = new AICheckQueue(meta);
  const ledger = new JudgeLedger(meta);
  const store = new ConsistencyStore(meta);
  const found = discoverForAI(claims, cardOf, everyOther, "rev:1", 1);
  await queue.load("cv");
  await queue.update("cv", found);
  return { meta, queue, ledger, store, found };
}
const deps = (s: Awaited<ReturnType<typeof setup>>, transport: JudgeTransport | null) => ({ canvasId: "cv", meta: s.meta, queue: s.queue, ledger: s.ledger, store: s.store, transport, stillSaid: () => true, section: inProcessSection() });

describe("discoverForAI — the screen, not the rules alone", () => {
  it("queues the near-misses the live rules don't show (two clashing schedules, two refund windows); never an unrelated card or the card itself", () => {
    const found = discoverForAI(claims, cardOf, everyOther, "rev:1", 1);
    expect(found.map((q) => [q.a.elementId, q.b.elementId]).sort()).toEqual([["n", "x"], ["n", "y"]]);
    expect(found.every((q) => q.revision === "rev:1")).toBe(true);
  });

  it("never queues the same statement on two cards (a title on a frame and on its block): it can't disagree with itself", () => {
    const cards: Record<string, { elementId: string; name: string; sentences: string[] }> = { f: { elementId: "f", name: "Ops", sentences: ["Ops"] }, g: { elementId: "g", name: "Ops", sentences: ["Ops", "  ops "] } };
    expect(discoverForAI([{ elementId: "f", sentence: "Ops" }], (id) => cards[id] ?? null, () => ["g"], "r", 1)).toEqual([]);
  });
});

describe("runAICheck — one manual call, review-only", () => {
  it("sends one call with the queued pairs and records the readings as evidence: likely conflict added, compatible not added", async () => {
    const s = await setup();
    const { t, sent } = fakeTransport(["contradicts", "compatible"]);
    const r = await runAICheck(deps(s, t));
    expect(sent).toHaveLength(1);
    expect(r).toMatchObject({ status: "answered", sent: 2, classified: 2, failed: 0, providerRequests: 1, usedTokens: 1000 });
    const records = s.store.list("cv");
    // Only the pair read as a contradiction becomes a record — `possible` (the user decides), found by the AI check.
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "possible", strength: "possible", evidence: { by: "ai" } });
    expect(records[0]!.ai?.answer).toBe("contradicts");
    expect(records[0]!.ai?.shown === "likely" || records[0]!.ai?.shown === "possible").toBe(true);
  });

  it("never re-sends a classified pair; a second press with nothing new sends nothing", async () => {
    const s = await setup();
    const { t, sent } = fakeTransport(["contradicts", "compatible"]);
    await runAICheck(deps(s, t));
    const again = await runAICheck(deps(s, t));
    expect(again.status).toBe("nothing_queued");
    expect(sent).toHaveLength(1);
  });

  it("a record the rules already found keeps its status; the AI reading is attached, even 'compatible' (no auto-dismiss)", async () => {
    const s = await setup();
    const q = s.found[0]!;
    s.store.record("cv", "rev:1", [{ a: q.a, b: q.b, kind: "differs", strength: "possible", reason: "rule reason" }]);
    const { t } = fakeTransport(["compatible", "compatible"]);
    await runAICheck(deps(s, t));
    const rec = s.store.list("cv");
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ status: "possible", evidence: { by: "rule", reason: "rule reason" }, ai: { answer: "compatible", shown: "hidden" } });
  });

  it("no connection → nothing sent; a call error fails the pairs (shown as failed), keeps the reservation, never reads compatible", async () => {
    const s = await setup();
    expect((await runAICheck(deps(s, null))).status).toBe("no_connection");
    const failing = fakeTransport([], { send: vi.fn(async () => Promise.reject(new Error("http 503"))) });
    const r = await runAICheck(deps(s, failing.t));
    expect(r.status).toBe("call_error");
    expect(failing.t.send).toHaveBeenCalledTimes(1);
    expect(s.store.list("cv")).toHaveLength(0);
    const st = await aiCheckStatus({ canvasId: "cv", meta: s.meta, queue: s.queue, ledger: s.ledger });
    expect(st).toMatchObject({ notChecked: 0, failed: 2, checkedCompatible: 0, checkedShown: 0 });
  });

  it("a transport that can't cap output or may retry sends nothing", async () => {
    for (const extra of [{ capsOutput: false }, { singleAttempt: false }]) {
      const s = await setup();
      const { t, sent } = fakeTransport(["contradicts"], extra);
      const r = await runAICheck(deps(s, t));
      expect(["no_output_cap", "no_single_attempt"]).toContain(r.status);
      expect(sent).toHaveLength(0);
    }
  });

  it("over today's tokens: nothing sent, the pairs wait with the reason (observable)", async () => {
    const s = await setup();
    const today = new Date().toISOString().slice(0, 10);
    await s.meta.set(BUDGET_KEY, { day: today, used: 1, tokens: DAILY_TOKEN_CAP - 100, changes: [], open: {} });
    const { t, sent } = fakeTransport(["contradicts", "contradicts"]);
    const r = await runAICheck(deps(s, t));
    expect(r.status).toBe("nothing_to_send");
    expect(sent).toHaveLength(0);
    const st = await aiCheckStatus({ canvasId: "cv", meta: s.meta, queue: s.queue, ledger: s.ledger });
    expect(st.notChecked).toBe(2);
    expect(st.waiting).toEqual([expect.objectContaining({ reason: "daily_tokens", count: 2 })]);
    expect(st.budget.tokensLeft).toBe(100);
  });

  it("drops pairs a card no longer says, and pairs the user dismissed, before planning", async () => {
    const s = await setup();
    const { t, sent } = fakeTransport(["contradicts"]);
    const r = await runAICheck({ ...deps(s, t), stillSaid: (q: QueuedPair) => q.b.elementId !== "x" });
    expect(r.sent).toBe(1);
    expect(sent[0]!.prompt).not.toContain("once a week");
  });
});

describe("aiCheckStatus — 'not yet checked' is never 'checked compatible'", () => {
  it("separates queued, checked-shown and checked-compatible; reports the day's budget", async () => {
    const s = await setup();
    let st = await aiCheckStatus({ canvasId: "cv", meta: s.meta, queue: s.queue, ledger: s.ledger });
    expect(st).toMatchObject({ notChecked: 2, checkedShown: 0, checkedCompatible: 0, failed: 0 });
    expect(st.budget).toMatchObject({ tokensLeft: DAILY_TOKEN_CAP, callsLeft: 50 });
    await runAICheck(deps(s, fakeTransport(["contradicts", "compatible"]).t));
    st = await aiCheckStatus({ canvasId: "cv", meta: s.meta, queue: s.queue, ledger: s.ledger });
    expect(st).toMatchObject({ notChecked: 0, checkedShown: 1, checkedCompatible: 1, failed: 0 });
    expect(st.budget.tokensLeft).toBe(DAILY_TOKEN_CAP - 1000);
    expect(st.budget.callsLeft).toBe(49);
  });

  it("an unreadable stored budget reads as used up (fail closed)", async () => {
    const s = await setup();
    await s.meta.set(BUDGET_KEY, { day: new Date().toISOString().slice(0, 10), used: "x", tokens: null });
    const st = await aiCheckStatus({ canvasId: "cv", meta: s.meta, queue: s.queue, ledger: s.ledger });
    expect(st.budget.callsLeft).toBe(0);
  });
});

describe("opt-in and the queue", () => {
  it("opt-in is off by default and is a plain switch", async () => {
    const meta = memoryMeta();
    expect(await isOptedIn(meta)).toBe(false);
    await setOptIn(meta, true);
    expect(await isOptedIn(meta)).toBe(true);
    await setOptIn(meta, false);
    expect(await isOptedIn(meta)).toBe(false);
  });

  it("the queue is bounded, persisted, and reads stored entries by shape", async () => {
    const meta = memoryMeta();
    const q = new AICheckQueue(meta);
    const many = Array.from({ length: MAX_QUEUED + 5 }, (_, i) => ({ key: `k${i}`, a: { elementId: "a", sentence: `s${i}`, cardName: "A" }, b: { elementId: "b", sentence: "t", cardName: "B" }, revision: "r", at: i }));
    await q.update("cv", many);
    meta.m.set("consistency.aiQueue.cv", [...(meta.m.get("consistency.aiQueue.cv") as unknown[]), { bogus: true }]);
    const back = await new AICheckQueue(meta).load("cv");
    expect(back).toHaveLength(MAX_QUEUED);
    expect(back[0]!.key).toBe("k5");
  });
});

describe("backlog on the 90,000-token day — each figure separately", () => {
  it("a full day admits 46 typical calls (measured mean 1,920 settled, ~2,450 reserved), 32 at the 2,800 worst case, never more than 50", () => {
    expect(callsAdmitted(50, DAILY_TOKEN_CAP, PLANNING.typicalSettledTokens, PLANNING.typicalReservation)).toBe(46);
    expect(callsAdmitted(50, DAILY_TOKEN_CAP, PLANNING.worstCaseTokens, PLANNING.worstCaseTokens)).toBe(32);
    expect(callsAdmitted(50, 10_000_000, 1, 1)).toBe(50);
  });

  it("pairs → calls → days, with today's remaining budget first; oldest age kept apart", () => {
    const full = { callsLeft: 50, tokensLeft: DAILY_TOKEN_CAP };
    expect(backlogOf(0, null, full)).toEqual({ pendingPairs: 0, requiredCalls: 0, budgetDays: { typical: 0, worstCase: 0 }, oldestPendingAt: null });
    expect(backlogOf(95, 7, full)).toEqual({ pendingPairs: 95, requiredCalls: 10, budgetDays: { typical: 1, worstCase: 1 }, oldestPendingAt: 7 });
    // 1,000 pairs = 100 calls: 46 + 46 + 8 typical (3 days); 32 × 3 + 4 worst case (4 days).
    expect(backlogOf(1000, 1, full).budgetDays).toEqual({ typical: 3, worstCase: 4 });
    // Today used up: everything waits for tomorrow.
    expect(backlogOf(10, 1, { callsLeft: 0, tokensLeft: 0 }).budgetDays).toEqual({ typical: 2, worstCase: 2 });
  });

  it("the status reports the backlog from the queue: pending pairs, calls, days and the oldest queued time", async () => {
    const s = await setup();
    const st = await aiCheckStatus({ canvasId: "cv", meta: s.meta, queue: s.queue, ledger: s.ledger });
    expect(st.backlog).toEqual({ pendingPairs: 2, requiredCalls: 1, budgetDays: { typical: 1, worstCase: 1 }, oldestPendingAt: 1 });
    await runAICheck(deps(s, fakeTransport(["contradicts", "compatible"]).t));
    const after = await aiCheckStatus({ canvasId: "cv", meta: s.meta, queue: s.queue, ledger: s.ledger });
    expect(after.backlog).toMatchObject({ pendingPairs: 0, requiredCalls: 0, oldestPendingAt: null });
  });
});
