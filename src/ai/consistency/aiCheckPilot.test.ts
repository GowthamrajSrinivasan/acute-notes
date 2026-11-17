/**
 * Fixes from the independent Stage 4f pilot review (2026-11-17, plan §16): D2 wording on held-back contradictions, D4
 * dropped pairs counted, D7 an off server costs nothing, D8 `recordAI` never overrides a user's decision, condition 5
 * pilot feedback counts. Mocked transport; no network.
 */
import { describe, expect, it } from "vitest";
import { AI_FOUND_REASON, AICheckQueue, aiCheckStatus, BUDGET_KEY, discoverForAI, MAX_QUEUED, noteForUser, pilotFeedback, runAICheck, type QueuedPair } from "./aiCheck";
import { inProcessSection, type JudgeTransport } from "./judgeCall";
import { JudgeLedger } from "./judgeLedger";
import { ConsistencyStore, pairId, type Detection } from "./store";

function memoryMeta() {
  const m = new Map<string, unknown>();
  return { m, get: async <T,>(k: string) => structuredClone(m.get(k)) as T | undefined, set: async (k: string, v: unknown) => void m.set(k, structuredClone(v)) };
}

const CARDS: Record<string, { elementId: string; name: string; sentences: string[] }> = {
  n: { elementId: "n", name: "Ops notes", sentences: ["Backups run every night at 2 a.m."] },
  x: { elementId: "x", name: "Runbook", sentences: ["Backups run once a week on Sunday."] },
};
const claims = [{ elementId: "n", sentence: "Backups run every night at 2 a.m." }];

function transport(answer: string) {
  let calls = 0;
  const t: JudgeTransport = {
    id: "fake",
    capsOutput: true,
    singleAttempt: true,
    async send(request) {
      calls++;
      request.onProviderRequest?.();
      const refs = [...request.prompt.matchAll(/^p(\d+)$/gm)].map((m) => `p${m[1]}`);
      return { text: JSON.stringify({ results: refs.map((ref) => ({ ref, answer, why: "nightly vs weekly" })) }), finishReason: "stop", usage: { promptTokens: 800, completionTokens: 200 }, providerRequests: 1 };
    },
  };
  return { t, calls: () => calls };
}

async function setup() {
  const meta = memoryMeta();
  const queue = new AICheckQueue(meta);
  const ledger = new JudgeLedger(meta);
  const store = new ConsistencyStore(meta);
  const found = discoverForAI(claims, (id) => CARDS[id] ?? null, () => ["x"], "rev:1", 1);
  await queue.load("cv");
  await queue.update("cv", found);
  return { meta, queue, ledger, store, found };
}
const deps = (s: Awaited<ReturnType<typeof setup>>, t: JudgeTransport, extra: Record<string, unknown> = {}) => ({ canvasId: "cv", meta: s.meta, queue: s.queue, ledger: s.ledger, store: s.store, transport: t, stillSaid: () => true, section: inProcessSection(), ...extra });

const detection = (q: QueuedPair): Detection => ({ a: q.a, b: q.b, kind: "differs", strength: "possible", reason: "rule: differs" });

describe("D7 — an AI-check switch that is off on the server costs nothing", () => {
  it("asks the server first: off → status server_off, no request, no budget reserved, no attempt counted", async () => {
    const s = await setup();
    const { t, calls } = transport("contradicts");
    const r = await runAICheck(deps(s, t, { serverReady: async () => false }));
    expect(r.status).toBe("server_off");
    expect(calls()).toBe(0);
    expect(s.meta.m.has(BUDGET_KEY)).toBe(false);
    expect(s.ledger.get("cv", s.found[0]!.key)).toBeUndefined();
    // The pair still waits as "not checked yet", and a later check (switch on) sends it.
    expect((await aiCheckStatus({ ...s, canvasId: "cv" })).notChecked).toBe(1);
    expect((await runAICheck(deps(s, t, { serverReady: async () => true }))).status).toBe("answered");
    expect(calls()).toBe(1);
  });

  it("a failing readiness check reads as off (never as on)", async () => {
    const s = await setup();
    const { t, calls } = transport("contradicts");
    const r = await runAICheck(deps(s, t, { serverReady: () => Promise.reject(new Error("network")) }));
    expect(r.status).toBe("server_off");
    expect(calls()).toBe(0);
  });
});

describe("D2 — an AI-raised record says who found it and leads with the AI's reading", () => {
  it("reason names the AI check (not the screen's 'no disagreement found'); the note starts with the AI's reading", async () => {
    const s = await setup();
    await runAICheck(deps(s, transport("contradicts").t));
    const [rec] = s.store.list("cv");
    expect(rec!.evidence.reason).toBe(AI_FOUND_REASON);
    expect(rec!.evidence.reason).not.toMatch(/no disagreement found/);
    expect(rec!.ai!.note).not.toMatch(/^no disagreement/i);
    expect(rec!.ai!.note).toMatch(/^AI/);
  });

  it("noteForUser drops only the screen's own reason in front", () => {
    expect(noteForUser("no disagreement found; AI reads a contradiction: x, but the contexts differ — needs a look", "no disagreement found")).toBe("AI reads a contradiction: x, but the contexts differ — needs a look");
    expect(noteForUser("AI: likely conflict: x", "no disagreement found")).toBe("AI: likely conflict: x");
  });
});

describe("D4 — a full queue drops its oldest pairs, counted and shown", () => {
  it("counts every pair dropped past MAX_QUEUED, persists the count, and the status reports it", async () => {
    const meta = memoryMeta();
    const queue = new AICheckQueue(meta);
    const mk = (i: number): QueuedPair => ({ key: `k${i}`, a: { elementId: `a${i}`, sentence: `s${i}`, cardName: "A" }, b: { elementId: `b${i}`, sentence: `t${i}`, cardName: "B" }, revision: "r", at: i });
    await queue.load("cv");
    await queue.update("cv", Array.from({ length: MAX_QUEUED + 3 }, (_, i) => mk(i)));
    expect(queue.list("cv")).toHaveLength(MAX_QUEUED);
    expect(queue.list("cv").some((q) => q.key === "k0")).toBe(false);
    await queue.update("cv", [mk(1000), mk(1001)]);
    expect(await queue.dropped("cv")).toBe(5);
    expect(await new AICheckQueue(meta).dropped("cv")).toBe(5);
    const status = await aiCheckStatus({ canvasId: "cv", meta, queue, ledger: new JudgeLedger(meta) });
    expect(status.droppedPairs).toBe(5);
  });

  it("removing pairs (gone from the canvas, dismissed) is not counted as dropped", async () => {
    const s = await setup();
    await s.queue.update("cv", [], () => false);
    expect(await s.queue.dropped("cv")).toBe(0);
  });
});

describe("D8 — recordAI never overrides a user's decision", () => {
  const reading = (shown: "likely" | "hidden") => ({ ai: { answer: shown === "likely" ? ("contradicts" as const) : ("compatible" as const) }, shown, note: "AI note" });

  it("confirmed stays confirmed and deferred stays deferred, with the reading attached as evidence — whatever the AI says", async () => {
    for (const decision of ["confirm", "defer"] as const) {
      for (const shown of ["likely", "hidden"] as const) {
        const s = await setup();
        const q = s.found[0]!;
        s.store.record("cv", "rev:1", [detection(q)]);
        s.store.decide("cv", pairId(q.a, q.b), decision);
        const before = s.store.get("cv", pairId(q.a, q.b))!.status;
        s.store.recordAI("cv", "ai-check:1", [{ detection: detection(q), ...reading(shown) }]);
        const after = s.store.get("cv", pairId(q.a, q.b))!;
        expect(after.status).toBe(before);
        expect(after.ai?.shown).toBe(shown);
      }
    }
  });

  it("dismissed stays dismissed and gets nothing attached", async () => {
    const s = await setup();
    const q = s.found[0]!;
    s.store.record("cv", "rev:1", [detection(q)]);
    s.store.decide("cv", pairId(q.a, q.b), "dismiss");
    s.store.recordAI("cv", "ai-check:1", [{ detection: detection(q), ...reading("likely") }]);
    const after = s.store.get("cv", pairId(q.a, q.b))!;
    expect(after.status).toBe("dismissed");
    expect(after.ai).toBeUndefined();
  });

  it("a closed record (its statements no longer disagreed) is raised again as possible when the AI shows it — like the rules do — never as confirmed", async () => {
    const s = await setup();
    const q = s.found[0]!;
    s.store.record("cv", "rev:1", [detection(q)]);
    s.store.reevaluate("cv", { sentencesOf: (id) => CARDS[id]?.sentences ?? null, fingerprintOf: () => null, stillDisagree: () => false });
    expect(s.store.get("cv", pairId(q.a, q.b))!.status).toBe("closed");
    s.store.recordAI("cv", "ai-check:1", [{ detection: detection(q), ...reading("likely") }]);
    expect(s.store.get("cv", pairId(q.a, q.b))!.status).toBe("possible");
    // Read as compatible: a closed record stays closed.
    const t = await setup();
    const q2 = t.found[0]!;
    t.store.record("cv", "rev:1", [detection(q2)]);
    t.store.reevaluate("cv", { sentencesOf: (id) => CARDS[id]?.sentences ?? null, fingerprintOf: () => null, stillDisagree: () => false });
    t.store.recordAI("cv", "ai-check:1", [{ detection: detection(q2), ...reading("hidden") }]);
    expect(t.store.get("cv", pairId(q2.a, q2.b))!.status).toBe("closed");
  });
});

describe("Condition 5 — pilot feedback counts", () => {
  it("counts records the AI showed, by the user's decision; compatible readings and rule-only records are not counted", () => {
    const r = (status: string, shown?: string) => ({ status, ...(shown ? { ai: { answer: "contradicts", shown, note: "", at: 1 } } : {}) }) as Parameters<typeof pilotFeedback>[0][number];
    expect(pilotFeedback([r("confirmed", "likely"), r("dismissed", "likely"), r("possible", "likely"), r("deferred", "possible"), r("dismissed", "possible"), r("possible", "hidden"), r("possible")])).toEqual({
      likely: { open: 1, confirmed: 1, dismissed: 1 },
      possible: { open: 1, confirmed: 0, dismissed: 1 },
    });
  });

  it("the status carries them when given the store", async () => {
    const s = await setup();
    await runAICheck(deps(s, transport("contradicts").t));
    const status = await aiCheckStatus({ ...s, canvasId: "cv" });
    const total = (b: { open: number; confirmed: number; dismissed: number }) => b.open + b.confirmed + b.dismissed;
    expect(total(status.pilot.likely) + total(status.pilot.possible)).toBe(1);
  });
});
