/**
 * Study Phase 4 support (plan §6): the concept remembers the cards that teach it (`cards`, ≤ 3, canvas object ids only),
 * written by the Notes view on an answer and on each Study snapshot, so `get_weak_concepts` can name cards without
 * reading provenance. Memory meta store.
 */
import { describe, expect, it } from "vitest";
import type { MetaRepository } from "@/persistence/repositories/types";
import { conceptKey, type Concept } from "./concept";
import { MAX_CARD_REFS, readStudyShard, recordAttempt, snapshotCardStatus, studyShardKey } from "./store";

function memoryMeta() {
  const keys = new Map<string, unknown>();
  const meta: MetaRepository = { get: async <T,>(k: string) => structuredClone(keys.get(k)) as T | undefined, set: async (k, v) => void keys.set(k, structuredClone(v)), delete: async (k) => void keys.delete(k) };
  return { meta, keys };
}
const concept = (units: string[], sourceId = "s1", version = 1): Concept => ({ key: conceptKey(sourceId, units), local: false, sourceId, units, sourceVersion: version });
const cardsOf = async (meta: MetaRepository, key: string) => readStudyShard(await meta.get(studyShardKey("ws", "s1")))!.concepts[key]?.cards;

describe("Study — the cards a concept remembers", () => {
  it("an answer remembers its card first; repeats aren't duplicated; at most MAX_CARD_REFS", async () => {
    const { meta } = memoryMeta();
    const c = concept(["u1"]);
    const answer = (objectId: string, at: number) => recordAttempt(meta, "ws", { concept: c, canvasId: "cv", title: "T", kind: "quiz", correct: false, objectId, at });
    await answer("a", 1);
    await answer("b", 2);
    await answer("a", 3);
    expect(await cardsOf(meta, c.key)).toEqual([{ objectId: "a", canvasId: "cv" }, { objectId: "b", canvasId: "cv" }]);
    for (let i = 0; i < 5; i++) await answer(`x${i}`, 10 + i);
    expect(await cardsOf(meta, c.key)).toHaveLength(MAX_CARD_REFS);
  });

  it("an answer without an object id (an older caller) remembers nothing and still records", async () => {
    const { meta } = memoryMeta();
    const c = concept(["u1"]);
    const rec = await recordAttempt(meta, "ws", { concept: c, canvasId: "cv", title: "T", kind: "quiz", correct: true, at: 1 });
    expect(rec.cards).toBeUndefined();
    expect(rec.attempts).toHaveLength(1);
  });

  it("a snapshot adds the teaching card and drops one that now teaches another concept or is gone from that canvas", async () => {
    const { meta } = memoryMeta();
    const a = concept(["u1"]);
    const b = concept(["u2"]);
    await recordAttempt(meta, "ws", { concept: a, canvasId: "cv", title: "A", kind: "quiz", correct: false, objectId: "card1", at: 1 });
    await recordAttempt(meta, "ws", { concept: a, canvasId: "other", title: "A", kind: "quiz", correct: false, objectId: "far", at: 2 });
    await recordAttempt(meta, "ws", { concept: b, canvasId: "cv", title: "B", kind: "quiz", correct: false, objectId: "card2", at: 3 });
    // card1 was regenerated to teach b; card2 was deleted. The snapshot is every card of canvas "cv".
    expect(await snapshotCardStatus(meta, "ws", [{ concept: b, canvasId: "cv", open: false, objectId: "card1" }], 4)).toBe(1);
    expect(await cardsOf(meta, a.key)).toEqual([{ objectId: "far", canvasId: "other" }]); // other canvases untouched
    expect(await cardsOf(meta, b.key)).toEqual([{ objectId: "card1", canvasId: "cv" }]);
    // Nothing changed: nothing is written.
    expect(await snapshotCardStatus(meta, "ws", [{ concept: b, canvasId: "cv", open: false, objectId: "card1" }], 5)).toBe(0);
  });

  it("the lenient reader drops malformed card refs and bounds the list", () => {
    const shard = readStudyShard({ concepts: { k: { title: "t", attempts: [], cards: [{ objectId: "a", canvasId: "cv" }, { objectId: "" , canvasId: "cv" }, { objectId: 3 }, "junk", ...Array.from({ length: 5 }, (_, i) => ({ objectId: `z${i}`, canvasId: "cv" }))] } } });
    expect(shard!.concepts.k!.cards!.map((c) => c.objectId)).toEqual(["a", "z0", "z1"]);
  });
});
