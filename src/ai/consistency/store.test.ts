/**
 * Stage 4e (§12.4, refinement C): conflict records keep detection apart from resolution — found as `possible`, changed
 * only by the user's decision (confirm / dismiss / defer) or because a statement itself changed (closed); exact-pair
 * dismissals; persistence across a reload.
 */
import { describe, expect, it } from "vitest";
import { ConsistencyStore, pairId, sentenceHash, storeKey, type Detection } from "./store";

const det = (a: string, b: string, strength: "conflict" | "possible" = "conflict"): Detection => ({
  a: { elementId: "A", sentence: a, cardName: "Limits" },
  b: { elementId: "B", sentence: b, cardName: "Worker" },
  kind: "differs",
  strength,
  reason: "values differ",
});

function world() {
  let now = 1;
  const data = new Map<string, unknown>();
  const meta = { get: async <T>(k: string) => structuredClone(data.get(k)) as T | undefined, set: async (k: string, v: unknown) => void data.set(k, structuredClone(v)) };
  const store = new ConsistencyStore(meta, () => now);
  const cards: Record<string, string[]> = { A: ["Retries happen three times."], B: ["The worker retries five times."] };
  const fp: Record<string, string> = { A: "a1", B: "b1" };
  const look = { sentencesOf: (id: string) => cards[id] ?? null, fingerprintOf: (id: string) => fp[id] ?? null, stillDisagree: () => true };
  return { store, meta, data, cards, fp, look, tick: () => ++now };
}

const D = det("Retries happen three times.", "The worker retries five times.");

describe("Stage 4e — conflict records", () => {
  it("a detection is a possible conflict; finding it again keeps one record and its status; only the user confirms", () => {
    const w = world();
    expect(w.store.record("cv", "rev:1", [D]).map((c) => c.status)).toEqual(["possible"]);
    expect(w.store.record("cv", "rev:2", [D])).toEqual([]); // the same pair: one record
    const [c] = w.store.list("cv");
    expect(c).toMatchObject({ status: "possible", strength: "conflict", raisedBy: "rev:1", evidence: { by: "rule" } });
    w.store.decide("cv", c!.id, "confirm");
    w.store.record("cv", "rev:3", [D]);
    expect(w.store.get("cv", c!.id)!.status).toBe("confirmed"); // a later detection never changes a decision
    expect(w.store.get("cv", c!.id)!.history.map((h) => h.status)).toEqual(["possible", "confirmed"]);
  });

  it("dismissal holds for the exact pair; a material change to either statement is a new pair, eligible again", () => {
    const w = world();
    const [c] = w.store.record("cv", "rev:1", [D]);
    w.store.decide("cv", c!.id, "dismiss");
    expect(w.store.record("cv", "rev:2", [D])).toEqual([]);
    expect(w.store.list("cv", ["possible"])).toEqual([]);
    const changed = det("Retries happen two times.", "The worker retries five times.");
    expect(pairId(changed.a, changed.b)).not.toBe(c!.id);
    expect(w.store.record("cv", "rev:3", [changed]).map((x) => x.status)).toEqual(["possible"]);
  });

  it("Stage 3 'Leave as is': the pair is recorded dismissed, never shown, and stays so", () => {
    const w = world();
    w.store.dismissPair("cv", "rev:1", D, "Left as is in the update review");
    expect(w.store.record("cv", "rev:1", [D])).toEqual([]);
    expect(w.store.list("cv", ["possible", "confirmed"])).toEqual([]);
    expect(w.store.list("cv")[0]).toMatchObject({ status: "dismissed", note: "Left as is in the update review" });
  });

  it("closed only because a statement changed (an edit, an undo) or they no longer disagree — never by itself", () => {
    const w = world();
    const [c] = w.store.record("cv", "rev:1", [D]);
    expect(w.store.reevaluate("cv", w.look)).toEqual([]); // nothing changed: stays possible
    w.cards.B = ["The worker retries three times."]; // the user fixed it by hand
    const closed = w.store.reevaluate("cv", w.look);
    expect(closed.map((x) => [x.id, x.status, x.note])).toEqual([[c!.id, "closed", "statement changed"]]);

    const v = world();
    const [d] = v.store.record("cv", "rev:1", [D]);
    v.store.reevaluate("cv", { ...v.look, stillDisagree: () => false });
    expect(v.store.get("cv", d!.id)).toMatchObject({ status: "closed", note: "no longer disagree" });

    const u = world();
    const [e] = u.store.record("cv", "rev:1", [D]);
    delete (u.cards as Record<string, unknown>).A; // the commit that added it was undone: the card is gone
    u.store.reevaluate("cv", u.look);
    expect(u.store.get("cv", e!.id)!.status).toBe("closed");
  });

  it("deferred until the next change: hidden, back as possible once either card changes; or until a time", () => {
    const w = world();
    const [c] = w.store.record("cv", "rev:1", [D]);
    w.store.decide("cv", c!.id, "defer", { until: "next_change", fingerprints: { a: "a1", b: "b1" } });
    expect(w.store.reevaluate("cv", w.look)).toEqual([]);
    w.fp.A = "a2"; // another sentence of card A edited
    expect(w.store.reevaluate("cv", w.look).map((x) => x.status)).toEqual(["possible"]);

    const t = world();
    const [d] = t.store.record("cv", "rev:1", [D]);
    t.store.decide("cv", d!.id, "defer", { until: 5 });
    expect(t.store.reevaluate("cv", t.look)).toEqual([]);
    for (let i = 0; i < 5; i++) t.tick();
    expect(t.store.reevaluate("cv", t.look).map((x) => x.status)).toEqual(["possible"]);
  });

  it("re-checks only the touched cards when told which", () => {
    const w = world();
    w.store.record("cv", "rev:1", [D]);
    w.cards.B = [];
    expect(w.store.reevaluate("cv", w.look, new Set(["Z"]))).toEqual([]);
    expect(w.store.reevaluate("cv", w.look, new Set(["B"])).length).toBe(1);
  });

  it("persists per canvas and reloads; a sentence's hash ignores spacing and case", async () => {
    const w = world();
    w.store.record("cv", "rev:1", [D]);
    await w.store.flushed();
    expect((w.data.get(storeKey("cv")) as unknown[]).length).toBe(1);
    const again = new ConsistencyStore(w.meta);
    await again.load("cv");
    expect(again.list("cv").map((c) => c.status)).toEqual(["possible"]);
    expect(sentenceHash("Retries  happen three times.")).toBe(sentenceHash("retries happen three times."));
  });
});
