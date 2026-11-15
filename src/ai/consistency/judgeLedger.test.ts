/**
 * Plan §12.23 fix C: per-pair completion accounting, persistence, bounded retries inside the daily budget, and no
 * duplicate conflict records on retry. Offline; the unseen3 replies are replayed, never re-sent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JudgeBudget, planForChange, type Candidate } from "./candidates";
import { JudgeLedger, ledgerKey, MAX_ATTEMPTS } from "./judgeLedger";
import { readJudgeReply, type PairOutcome } from "./judgeReply";
import { judgePair } from "./rules";
import { ConsistencyStore, pairId } from "./store";

const RUN = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency/unseen3/runs/2026-11-14-unseen3");
const recorded = Object.values(JSON.parse(readFileSync(join(RUN, "calls.json"), "utf8")) as Record<string, { status: string; keys: string[]; raw: string }>);

/** A device-local meta store in memory. */
function memoryMeta() {
  const data = new Map<string, unknown>();
  return { data, get: async <T,>(k: string) => structuredClone(data.get(k)) as T | undefined, set: async (k: string, v: unknown) => void data.set(k, structuredClone(v)) };
}
const classified = (answer: "contradicts" | "compatible"): PairOutcome => ({ state: "classified", answer });
const failed: PairOutcome = { state: "failed", reason: "truncated", detail: "cut off" };
const reading = (entries: [string, PairOutcome][]) => ({ pairs: new Map(entries) });

describe("§12.23 fix C — the ledger", () => {
  it("replays unseen3's two failed calls: the rejected one now classifies 10 pairs, the truncated one leaves 10 failed and retryable", () => {
    const ledger = new JudgeLedger();
    const unreadable = recorded.find((c) => c.status === "unreadable")!;
    const truncated = recorded.find((c) => c.status === "truncated")!;
    expect(ledger.recordReading("cv", "rev:5", readJudgeReply(unreadable.raw, unreadable.keys))).toEqual({ classified: 10, failed: 0, ignored: 0 });
    expect(ledger.recordReading("cv", "rev:3", readJudgeReply(truncated.raw, truncated.keys, { finishReason: "length" }))).toEqual({ classified: 0, failed: 10, ignored: 0 });
    expect(ledger.list("cv", ["failed"]).map((p) => p.reason)).toEqual(Array(10).fill("truncated"));
    expect(ledger.retryable("cv").sort()).toEqual([...truncated.keys].sort());
    // A failed pair is never shown as compatible: it has no answer.
    for (const p of ledger.list("cv", ["failed"])) expect(p.answer).toBeUndefined();
  });

  it("classified once: a later answer, a replay or a retry never changes or duplicates it", () => {
    const ledger = new JudgeLedger();
    ledger.recordReading("cv", "rev:1", reading([["k1", classified("contradicts")]]));
    expect(ledger.recordReading("cv", "rev:2", reading([["k1", classified("compatible")]]))).toEqual({ classified: 0, failed: 0, ignored: 1 });
    expect(ledger.get("cv", "k1")).toMatchObject({ state: "classified", answer: "contradicts", attempts: 1, revision: "rev:1" });
    expect(ledger.list("cv")).toHaveLength(1);
  });

  it("failed attempts are counted; at the limit a pair gives up (shown as not checked, never as compatible)", () => {
    const ledger = new JudgeLedger();
    for (let i = 1; i <= MAX_ATTEMPTS; i++) ledger.recordReading("cv", `rev:${i}`, reading([["k1", failed]]));
    expect(ledger.get("cv", "k1")).toMatchObject({ state: "gave_up", attempts: MAX_ATTEMPTS, reason: "truncated" });
    expect(ledger.retryable("cv")).toEqual([]);
    ledger.recordCallError("cv", "rev:x", ["k2"], "timeout");
    expect(ledger.get("cv", "k2")).toMatchObject({ state: "failed", reason: "call_error", attempts: 1 });
  });

  it("pending pairs keep the planner's reason; a pending mark never downgrades a classified or failed pair", () => {
    const ledger = new JudgeLedger();
    ledger.recordReading("cv", "rev:1", reading([["done", classified("compatible")], ["bad", failed]]));
    ledger.markPending("cv", "rev:2", [{ key: "done", reason: "daily_cap" }, { key: "bad", reason: "daily_cap" }, { key: "new", reason: "over_call_limit" }]);
    expect(ledger.get("cv", "done")!.state).toBe("classified");
    expect(ledger.get("cv", "bad")).toMatchObject({ state: "failed", reason: "truncated" });
    expect(ledger.get("cv", "new")).toMatchObject({ state: "pending", reason: "over_call_limit", attempts: 0 });
  });

  it("persists pending, failed and classified pairs, and reads a damaged store leniently", async () => {
    const meta = memoryMeta();
    const a = new JudgeLedger(meta);
    a.recordReading("cv", "rev:1", reading([["k1", classified("contradicts")], ["k2", failed]]));
    a.markPending("cv", "rev:1", [{ key: "k3", reason: "daily_tokens" }]);
    await a.flushed();
    const b = new JudgeLedger(meta);
    await b.load("cv");
    expect(b.list("cv").map((p) => [p.key, p.state, p.reason ?? p.answer]).sort()).toEqual([
      ["k1", "classified", "contradicts"],
      ["k2", "failed", "truncated"],
      ["k3", "pending", "daily_tokens"],
    ]);
    meta.data.set(ledgerKey("cv2"), [null, { key: 1 }, { key: "ok", state: "failed", revision: "r", attempts: "x" }, "junk"]);
    const c = new JudgeLedger(meta);
    await c.load("cv2");
    expect(c.list("cv2").map((p) => [p.key, p.attempts])).toEqual([["ok", 0]]);
  });
});

describe("§12.23 fix C — bounded retries inside the daily budget", () => {
  const cand = (key: string): Candidate => ({ key, fingerprint: key, a: { sentence: `The quota for ${key} is 10 jobs.` }, b: { sentence: `The quota for ${key} is 20 jobs.` }, judgement: judgePair(`The quota for ${key} is 10 jobs.`, `The quota for ${key} is 20 jobs.`), priority: 5 });

  it("a Retry sends only failed and pending pairs: classified ones are skipped as already judged", () => {
    const ledger = new JudgeLedger();
    ledger.recordReading("cv", "rev:1", reading([["k1", classified("contradicts")], ["k2", failed]]));
    ledger.markPending("cv", "rev:1", [{ key: "k3", reason: "over_call_limit" }]);
    const plan = planForChange("rev:1", ["k1", "k2", "k3"].map(cand), new JudgeBudget({ now: () => 0 }), { aiEnabled: true, retry: true, judged: (fp) => ledger.isClassified("cv", fp) });
    expect(plan.call!.keys.sort()).toEqual(["k2", "k3"]);
    expect(plan.skipped).toEqual([{ key: "k1", reason: "already_judged" }]);
  });

  it("a Retry still passes the daily caps: with today's calls used, the pairs wait with the reason and stay failed", () => {
    const ledger = new JudgeLedger();
    ledger.recordReading("cv", "rev:1", reading([["k2", failed]]));
    const budget = new JudgeBudget({ now: () => 0, dailyCap: 1 });
    expect(budget.reserve("rev:other", 100).ok).toBe(true);
    const plan = planForChange("rev:1", [cand("k2")], budget, { aiEnabled: true, retry: true, judged: (fp) => ledger.isClassified("cv", fp) });
    expect(plan.call).toBeUndefined();
    expect(plan.pending).toEqual([{ key: "k2", reason: "daily_cap" }]);
    ledger.markPending("cv", "rev:1", plan.pending);
    expect(ledger.get("cv", "k2")).toMatchObject({ state: "failed", attempts: 1 });
  });

  it("no duplicate conflict records on retry: the same contradiction found twice is one record", () => {
    const store = new ConsistencyStore(undefined, () => 1);
    const a = { elementId: "c1", sentence: "The quota is 10 jobs.", cardName: "Quotas" };
    const b = { elementId: "c2", sentence: "The quota is 20 jobs.", cardName: "Limits" };
    const detection = { a, b, kind: "value" as const, strength: "possible" as const, reason: "AI: likely conflict" };
    store.record("cv", "rev:1", [detection]);
    store.record("cv", "rev:1-retry", [detection]);
    expect(store.list("cv")).toHaveLength(1);
    expect(store.list("cv")[0]!.id).toBe(pairId(a, b));
  });
});

describe("§12.24 review fixes — ledger, budget and reader", () => {
  it("a replayed reading for the same call changes nothing and costs no attempt", () => {
    const ledger = new JudgeLedger();
    ledger.markSent("c", "rev:1", ["k"], "r1");
    for (let i = 0; i < 3; i++) ledger.recordReading("c", "rev:1", reading([["k", failed]]), "r1");
    expect(ledger.get("c", "k")).toMatchObject({ state: "failed", attempts: 1 });
  });

  it("a pair whose call is out is never retryable, and a planner's pending mark doesn't knock it back", () => {
    const ledger = new JudgeLedger();
    ledger.markSent("c", "rev:1", ["k"], "r1");
    expect(ledger.retryable("c")).toEqual([]);
    ledger.markPending("c", "rev:2", [{ key: "k", reason: "daily_cap" }]);
    expect(ledger.get("c", "k")?.state).toBe("in_flight");
    ledger.recordReading("c", "rev:1", reading([["k", classified("compatible")]]), "r1");
    expect(ledger.get("c", "k")?.state).toBe("classified");
  });

  it("reads stored pairs by a whitelist: a classified pair without a valid answer is dropped; attempts are clamped; an interrupted call reads as failed", async () => {
    const meta = memoryMeta();
    meta.data.set(ledgerKey("c"), [
      { key: "a", state: "classified", revision: "r", attempts: 1 },
      { key: "b", state: "classified", revision: "r", answer: "maybe" },
      { key: "c", state: "failed", revision: "r", attempts: -50, reason: "truncated", extra: "x".repeat(10_000) },
      { key: "d", state: "in_flight", revision: "r", attempts: 1 },
      { key: "e", state: "classified", revision: "r", answer: "contradicts", why: "w".repeat(5_000) },
    ]);
    const ledger = new JudgeLedger(meta);
    await ledger.load("c");
    expect(ledger.get("c", "a")).toBeUndefined();
    expect(ledger.get("c", "b")).toBeUndefined();
    expect(ledger.get("c", "c")).toMatchObject({ state: "failed", attempts: 0 });
    expect(ledger.get("c", "c")).not.toHaveProperty("extra");
    expect(ledger.get("c", "d")).toMatchObject({ state: "failed", attempts: 2, reason: "call_error" });
    expect(ledger.get("c", "e")!.why!.length).toBe(400);
    expect(ledger.retryable("c").sort()).toEqual(["c", "d"]);
  });

  it("a write made while the stored ledger is loading never overwrites the stored pairs", async () => {
    const meta = memoryMeta();
    meta.data.set(ledgerKey("c"), [{ key: "old", state: "classified", revision: "r", answer: "compatible", attempts: 1, updatedAt: 1 }]);
    const ledger = new JudgeLedger(meta);
    const loading = ledger.load("c");
    ledger.recordReading("c", "rev:2", reading([["new", classified("contradicts")]]));
    await loading;
    await ledger.flushed();
    expect((meta.data.get(ledgerKey("c")) as { key: string }[]).map((p) => p.key).sort()).toEqual(["new", "old"]);
  });

  it("the budget reads persisted state fail-closed, refuses non-positive reservations, never collides ids, and rolls forward only", () => {
    const day = Date.UTC(2026, 10, 15);
    expect(new JudgeBudget({ now: () => day, state: { day: "2026-11-15", tokens: 0, changes: [] } as never }).reserve("rev:1", 100)).toEqual({ ok: false, reason: "daily_cap" });
    expect(() => new JudgeBudget({ now: () => day, state: { day: "2026-11-15", used: 0, tokens: 0 } as never })).not.toThrow();
    const b = new JudgeBudget({ now: () => day });
    for (const t of [-5_000, 0, 1.5, Number.NaN]) expect(b.reserve("rev:1", t, { retry: true })).toEqual({ ok: false, reason: "over_call_limit" });
    expect(b.state()).toMatchObject({ used: 0, tokens: 0 });
    const clash = new JudgeBudget({ now: () => day, state: { day: "2026-11-15", used: 0, tokens: 100, changes: [], open: { "2026-11-15#1": 100 } } });
    const r = clash.reserve("rev:2", 200);
    expect(r.ok && r.reservation).not.toBe("2026-11-15#1");
    expect(Object.keys(clash.state().open!).length).toBe(2);
    let now = day;
    const back = new JudgeBudget({ now: () => now });
    back.reserve("rev:1", 100);
    now = day - 86_400_000;
    expect(back.state()).toMatchObject({ used: 1, tokens: 100 });
  });

  it("the planner skips a pair the ledger knows by its key, with or without a fingerprint", () => {
    const ledger = new JudgeLedger();
    ledger.recordReading("c", "rev:1", reading([["k1", classified("compatible")]]));
    const [sa, sb] = ["The team uses PostgreSQL.", "The team uses MongoDB."];
    expect(judgePair(sa, sb).verdict).toBe("possible");
    const cands: Candidate[] = [{ key: "k1", a: { sentence: sa }, b: { sentence: sb }, judgement: judgePair(sa, sb) }];
    expect(planForChange("rev:0", cands, new JudgeBudget({ now: () => 0 }), { aiEnabled: true }).call?.keys).toEqual(["k1"]);
    const plan = planForChange("rev:2", cands, new JudgeBudget({ now: () => 0 }), { aiEnabled: true, judged: (k) => ledger.isClassified("c", k) });
    expect(plan.skipped).toEqual([{ key: "k1", reason: "already_judged" }]);
    expect(plan.call).toBeUndefined();
  });

  it("the reader: a reply that ends inside JSON is cut off even after a complete block; too many items is unreadable", () => {
    const cut = readJudgeReply('```json\n{"results":[{"ref":"p1","answer":"compatible"}]}\n```\nWait, correction: {"results":[{"ref":"p1","answer":"contradi', ["k"]);
    expect(cut.status).toBe("truncated");
    const many = readJudgeReply(JSON.stringify({ results: [{ ref: "p1", answer: "contradicts" }, ...Array.from({ length: 20 }, () => ({ ref: "p9", answer: "compatible" })), { ref: "p1", answer: "compatible" }] }), ["k"]);
    expect(many.status).toBe("unreadable");
    expect(many.pairs.get("k")?.state).toBe("failed");
  });
});
