/**
 * Study Mode Phase 2 (study-mode-implementation-plan §2, §4, §9): the device-local store on a memory meta repository —
 * round trip, lenient reader, bounds and eviction order, serialised writes, remap on load (narrowing and the §4 collision
 * rule), card-status snapshots and deletion. Offline; no model.
 */
import { describe, expect, it } from "vitest";
import type { Lineage } from "@/ai/fidelity/contracts";
import type { MetaRepository } from "@/persistence/repositories/types";
import { conceptKey, localConceptKey, type Concept } from "./concept";
import { bandOf, FLAG_UNVERIFIED, isWeak } from "./mastery";
import {
  clearStudy,
  clearStudySource,
  FLAG_STALE,
  loadStudy,
  MAX_ATTEMPTS,
  MAX_SHARD_CONCEPTS,
  MAX_WORKSPACE_CONCEPTS,
  readStudyIndex,
  readStudyShard,
  recordAttempt,
  remapShard,
  snapshotCardStatus,
  studyIndexKey,
  studyShardKey,
  studyWritesSettled,
  type StudyShard,
} from "./store";

/** A memory meta repository that counts writes and can be inspected. */
function memoryMeta(delay = 0) {
  const map = new Map<string, unknown>();
  const sets: string[] = [];
  const meta: MetaRepository = {
    get: async <T,>(key: string) => {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      return structuredClone(map.get(key)) as T | undefined;
    },
    set: async (key, value) => {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      sets.push(key);
      map.set(key, structuredClone(value));
    },
    delete: async (key) => void map.delete(key),
  };
  return { meta, map, sets };
}

const WS = "ws1";
const src = (units: string[], version = 1, sourceId = "s1"): Concept => ({ key: conceptKey(sourceId, units), local: false, sourceId, units, sourceVersion: version });
const local = (objectId: string, canvasId = "cv1"): Concept => ({ key: localConceptKey(canvasId, objectId), local: true });
const quiz = (concept: Concept, correct: boolean, at: number, extra: { unverified?: boolean; title?: string } = {}) => ({
  concept,
  canvasId: "cv1",
  title: extra.title ?? "Card",
  kind: "quiz" as const,
  correct,
  at,
  ...(extra.unverified ? { unverified: true } : {}),
});

describe("Study store — keys and round trip", () => {
  it("records into sharded keys: the index, a source shard, a local shard; reload gives the same records", async () => {
    const { meta, map } = memoryMeta();
    await recordAttempt(meta, WS, quiz(src(["u7", "u6"]), false, 100, { title: "Idempotency" }));
    await recordAttempt(meta, WS, quiz(local("el1"), true, 200));
    expect([...map.keys()].sort()).toEqual(["study.ws1", "study.ws1.local.cv1", "study.ws1.s1"]);
    expect(map.get("study.ws1")).toEqual({ version: 1, shards: { s1: { concepts: 1, updatedAt: 100 }, "local:cv1": { concepts: 1, updatedAt: 200 } } });

    const loaded = await loadStudy(meta, WS, { now: 300 });
    const rec = loaded.get("c:s1:u6+u7")!;
    expect(rec.shardId).toBe("s1");
    expect(rec.record).toEqual({ title: "Idempotency", attempts: [[100, "q", 0, 0]], units: ["u6", "u7"], sourceVersion: 1, cardStatus: { status: "none", at: 100, version: 1 } });
    expect(loaded.get("l:cv1:el1")!.record.attempts).toEqual([[200, "q", 1, 0]]);
    expect(isWeak(rec.record)).toBe(true);
  });

  it("stores no answer or choice text and caps the title at 120 chars", async () => {
    const { meta, map } = memoryMeta();
    await recordAttempt(meta, WS, quiz(src(["u1"]), true, 1, { title: "x".repeat(500) }));
    const shard = map.get("study.ws1.s1") as StudyShard;
    expect(shard.concepts["c:s1:u1"]!.title).toHaveLength(120);
    expect(Object.keys(shard.concepts["c:s1:u1"]!).sort()).toEqual(["attempts", "cardStatus", "sourceVersion", "title", "units"]);
  });

  it("an attempt on a card under review is flagged unverified and caps the band at learning (issue A)", async () => {
    const { meta } = memoryMeta();
    const c = src(["u1"]);
    for (let i = 0; i < 5; i++) await recordAttempt(meta, WS, quiz(c, true, i, { unverified: i === 0 }));
    const rec = (await loadStudy(meta, WS, { now: 10 })).get(c.key)!.record;
    expect(rec.attempts[0]![3] & FLAG_UNVERIFIED).toBe(FLAG_UNVERIFIED);
    expect(bandOf(rec, 10)).toBe("learning");
  });

  it("writes one set per attempt once the shard exists (the index only when the concept count changes)", async () => {
    const { meta, sets } = memoryMeta();
    await recordAttempt(meta, WS, quiz(src(["u1"]), true, 1));
    expect(sets).toEqual(["study.ws1", "study.ws1.s1"]);
    sets.length = 0;
    await recordAttempt(meta, WS, quiz(src(["u1"]), false, 2));
    expect(sets).toEqual(["study.ws1.s1"]);
    sets.length = 0;
    await recordAttempt(meta, WS, quiz(src(["u2"]), false, 3));
    expect(sets).toEqual(["study.ws1", "study.ws1.s1"]);
  });
});

describe("Study store — lenient reader", () => {
  it("drops malformed concepts, attempts and fields; never throws", () => {
    for (const garbage of [null, undefined, 3, "x", [], { concepts: [] }, { concepts: null }]) expect(readStudyShard(garbage)).toBeNull();
    expect(readStudyIndex({ shards: { a: { concepts: "1", updatedAt: 1 }, b: { concepts: 2, updatedAt: 3 } } })).toEqual({ version: 1, shards: { b: { concepts: 2, updatedAt: 3 } } });
    const shard = readStudyShard({
      sourceId: "s1",
      concepts: {
        good: { title: "T", attempts: [[1, "q", 1, 0], [2, "x", 1, 0], [3, "f", 2, 0], "junk", [4, "f", 0, 1]], state: "bogus", reason: "narrowed", related: [{ key: "k", rel: "nope" }, { key: "k2", rel: "overlaps" }], cardStatus: { status: "maybe", at: 1 } },
        noAttempts: { title: "T" },
        notObject: 5,
      },
    })!;
    expect(Object.keys(shard.concepts)).toEqual(["good"]);
    expect(shard.concepts.good).toEqual({ title: "T", attempts: [[1, "q", 1, 0], [4, "f", 0, 1]], reason: "narrowed", related: [{ key: "k2", rel: "overlaps" }] });
  });

  it("a garbage shard or index in the store reads as empty and is overwritten by the next attempt", async () => {
    const { meta, map } = memoryMeta();
    map.set("study.ws1", "garbage");
    map.set("study.ws1.s1", { concepts: "nope" });
    expect((await loadStudy(meta, WS, { now: 1 })).size).toBe(0);
    await recordAttempt(meta, WS, quiz(src(["u1"]), true, 1));
    expect((await loadStudy(meta, WS, { now: 2 })).get("c:s1:u1")!.record.attempts).toHaveLength(1);
  });
});

describe("Study store — bounds and eviction order", () => {
  it("keeps the last 20 attempts per concept", async () => {
    const { meta } = memoryMeta();
    for (let i = 0; i < 25; i++) await recordAttempt(meta, WS, quiz(src(["u1"]), i % 2 === 0, i));
    const rec = (await loadStudy(meta, WS, { now: 99 })).get("c:s1:u1")!.record;
    expect(rec.attempts).toHaveLength(MAX_ATTEMPTS);
    expect(rec.attempts[0]![0]).toBe(5);
  });

  it("500 concepts per shard: retired go first, then the least recently attempted; the one studied stays", async () => {
    const { meta, map } = memoryMeta();
    const concepts: StudyShard["concepts"] = {};
    for (let i = 1; i <= MAX_SHARD_CONCEPTS; i++) concepts[`c:s1:u${i}`] = { title: "", attempts: [[1000 + i, "q", 1, 0]], units: [`u${i}`], sourceVersion: 1 };
    concepts["c:s1:u400"]!.state = "retired"; // recent but retired: goes first
    map.set(studyShardKey(WS, "s1"), { version: 1, sourceId: "s1", concepts });
    map.set(studyIndexKey(WS), { version: 1, shards: { s1: { concepts: MAX_SHARD_CONCEPTS, updatedAt: 1 } } });

    await recordAttempt(meta, WS, quiz(src(["u9001"]), false, 1));
    let shard = map.get("study.ws1.s1") as StudyShard;
    expect(Object.keys(shard.concepts)).toHaveLength(MAX_SHARD_CONCEPTS);
    expect(shard.concepts["c:s1:u400"]).toBeUndefined();
    expect(shard.concepts["c:s1:u9001"]).toBeDefined(); // oldest timestamp of all, but just studied

    await recordAttempt(meta, WS, quiz(src(["u9002"]), false, 5000));
    shard = map.get("study.ws1.s1") as StudyShard;
    expect(shard.concepts["c:s1:u9001"]).toBeUndefined(); // now the least recently attempted
    expect(shard.concepts["c:s1:u1"]).toBeDefined();
    expect((map.get("study.ws1") as { shards: Record<string, { concepts: number }> }).shards.s1!.concepts).toBe(MAX_SHARD_CONCEPTS);
  });

  it("2,000 concepts per workspace, evicted across shards in the same order", async () => {
    const { meta, map } = memoryMeta();
    const shards: Record<string, { concepts: number; updatedAt: number }> = {};
    for (let s = 0; s < 4; s++) {
      const concepts: StudyShard["concepts"] = {};
      for (let i = 1; i <= 500; i++) concepts[`c:s${s}:u${i}`] = { title: "", attempts: [[s * 1000 + i, "q", 1, 0]], units: [`u${i}`], sourceVersion: 1 };
      map.set(studyShardKey(WS, `s${s}`), { version: 1, sourceId: `s${s}`, concepts });
      shards[`s${s}`] = { concepts: 500, updatedAt: 1 };
    }
    map.set(studyIndexKey(WS), { version: 1, shards });
    await recordAttempt(meta, WS, quiz(local("el1"), true, 10_000));
    const total = Object.values((map.get("study.ws1") as { shards: Record<string, { concepts: number }> }).shards).reduce((n, x) => n + x.concepts, 0);
    expect(total).toBe(MAX_WORKSPACE_CONCEPTS);
    expect((map.get("study.ws1.s0") as StudyShard).concepts["c:s0:u1"]).toBeUndefined(); // the oldest attempt in the workspace
    expect(Object.keys((map.get("study.ws1.s0") as StudyShard).concepts)).toHaveLength(499);
    expect((map.get("study.ws1.local.cv1") as StudyShard).concepts["l:cv1:el1"]).toBeDefined();
  });
});

describe("Study store — serialised writes", () => {
  it("concurrent attempts on one shard are all kept (no lost update)", async () => {
    const { meta } = memoryMeta(1);
    await Promise.all(Array.from({ length: 12 }, (_, i) => recordAttempt(meta, WS, quiz(src([`u${(i % 3) + 1}`]), i % 2 === 0, i))));
    await studyWritesSettled(meta, WS);
    const loaded = await loadStudy(meta, WS, { now: 99 });
    expect([...loaded.values()].reduce((n, c) => n + c.record.attempts.length, 0)).toBe(12);
    expect(loaded.size).toBe(3);
  });

  it("a failed write doesn't block later ones", async () => {
    const { meta } = memoryMeta();
    const failing: MetaRepository = { ...meta, set: async () => Promise.reject(new Error("disk full")) };
    await expect(recordAttempt(failing, WS, quiz(src(["u1"]), true, 1))).rejects.toThrow("disk full");
    await recordAttempt(meta, WS, quiz(src(["u1"]), true, 2));
    expect((await loadStudy(meta, WS, { now: 3 })).get("c:s1:u1")!.record.attempts).toHaveLength(1);
  });
});

describe("Study store — relations and the collision rule (§4)", () => {
  it("a split concept links split_from, a merged one merged_from, a ≥ 0.5 overlap overlaps; attempts are never copied", async () => {
    const { meta } = memoryMeta();
    await recordAttempt(meta, WS, quiz(src(["u6", "u7"]), false, 1));
    await recordAttempt(meta, WS, quiz(src(["u6"]), true, 2));
    await recordAttempt(meta, WS, quiz(src(["u6", "u7", "u8"]), true, 3));
    await recordAttempt(meta, WS, quiz(src(["u7", "u8", "u9"]), true, 4));
    const loaded = await loadStudy(meta, WS, { now: 5 });
    expect(loaded.get("c:s1:u6")!.record.related).toEqual([{ key: "c:s1:u6+u7", rel: "split_from" }]);
    expect(loaded.get("c:s1:u6+u7+u8")!.record.related).toEqual([
      { key: "c:s1:u6", rel: "merged_from" },
      { key: "c:s1:u6+u7", rel: "merged_from" },
    ]);
    expect(loaded.get("c:s1:u7+u8+u9")!.record.related).toEqual([{ key: "c:s1:u6+u7+u8", rel: "overlaps" }]);
    expect(loaded.get("c:s1:u6")!.record.attempts).toEqual([[2, "q", 1, 0]]);
  });

  const step = (entries: Lineage["entries"]): Lineage => ({ fromVersion: 1, toVersion: 2, entries });
  const shardWith = (concepts: StudyShard["concepts"]): StudyShard => ({ version: 1, sourceId: "s1", concepts });

  it("narrowing moves the record to its new key, stale, carriedFrom the old key; a second pass changes nothing", () => {
    const shard = shardWith({ "c:s1:u6+u7": { title: "T", attempts: [[1, "q", 0, 0]], units: ["u6", "u7"], sourceVersion: 1 } });
    const lineage = step([{ state: "unchanged", from: "u6", to: "u6" }, { state: "removed", from: "u7" }] as Lineage["entries"]);
    const input = { latestVersion: 2, lineageOf: (v: number) => (v === 2 ? lineage : undefined), sourceExists: true, now: 50 };
    expect(remapShard(shard, input).changed).toBe(true);
    expect(shard.concepts).toEqual({
      "c:s1:u6": { title: "T", attempts: [[1, "q", 0, FLAG_STALE]], units: ["u6"], sourceVersion: 2, freshSince: 50, state: "source_changed", reason: "narrowed", carriedFrom: "c:s1:u6+u7" },
    });
    expect(remapShard(shard, { ...input, now: 99 }).changed).toBe(false);
    expect(shard.concepts["c:s1:u6"]!.freshSince).toBe(50);
  });

  it("collision: the target keeps its history and gets merged_from; the narrowed one keeps its old key, source_changed", () => {
    const shard = shardWith({
      "c:s1:u6+u7": { title: "Pair", attempts: [[1, "q", 0, 0]], units: ["u6", "u7"], sourceVersion: 1 },
      "c:s1:u6": { title: "One", attempts: [[2, "q", 1, 0]], units: ["u6"], sourceVersion: 2 },
    });
    const lineage = step([{ state: "unchanged", from: "u6", to: "u6" }, { state: "removed", from: "u7" }] as Lineage["entries"]);
    remapShard(shard, { latestVersion: 2, lineageOf: () => lineage, sourceExists: true, now: 50 });
    expect(shard.concepts["c:s1:u6"]).toEqual({ title: "One", attempts: [[2, "q", 1, 0]], units: ["u6"], sourceVersion: 2, related: [{ key: "c:s1:u6+u7", rel: "merged_from" }] });
    expect(shard.concepts["c:s1:u6+u7"]).toMatchObject({ title: "Pair", attempts: [[1, "q", 0, FLAG_STALE]], state: "source_changed", reason: "narrowed", sourceVersion: 2 });
    expect(remapShard(shard, { latestVersion: 2, lineageOf: () => lineage, sourceExists: true, now: 60 }).changed).toBe(false);
  });

  it("changed units: same key, earlier attempts stale; ambiguous: needs_review; all removed or source gone: retired", () => {
    const base = () => shardWith({ "c:s1:u1": { title: "T", attempts: [[1, "q", 1, 0]], units: ["u1"], sourceVersion: 1 } });
    const run = (entries: Lineage["entries"], sourceExists = true) => {
      const s = base();
      remapShard(s, { latestVersion: 2, lineageOf: () => step(entries), sourceExists, now: 9 });
      return s.concepts["c:s1:u1"]!;
    };
    expect(run([{ state: "changed", from: "u1", to: "u1" }] as Lineage["entries"])).toMatchObject({ state: "source_changed", freshSince: 9, sourceVersion: 2 });
    expect(run([{ state: "ambiguous", to: "u5", candidates: ["u1"] }] as Lineage["entries"])).toMatchObject({ state: "needs_review", sourceVersion: 1 });
    expect(run([{ state: "removed", from: "u1" }] as Lineage["entries"])).toMatchObject({ state: "retired" });
    expect(run([], false)).toMatchObject({ state: "retired", reason: "source_missing" });
  });

  it("loadStudy remaps through the sources and writes the shard back; studying again clears source_changed", async () => {
    const { meta } = memoryMeta();
    await recordAttempt(meta, WS, quiz(src(["u1"]), true, 1));
    const sources = {
      get: async () => ({ latestVersion: 2 }),
      getVersion: async (_id: string, v: number) => (v === 2 ? { lineage: step([{ state: "changed", from: "u1", to: "u1" }] as Lineage["entries"]) } : null),
    };
    const rec = (await loadStudy(meta, WS, { sources, now: 10 })).get("c:s1:u1")!.record;
    expect(rec).toMatchObject({ state: "source_changed", freshSince: 10, sourceVersion: 2 });
    expect((await loadStudy(meta, WS, { now: 11 })).get("c:s1:u1")!.record.state).toBe("source_changed"); // persisted
    const after = await recordAttempt(meta, WS, quiz(src(["u1"], 2), false, 20));
    expect(after.state).toBeUndefined();
    expect(after.freshSince).toBe(10);
  });
});

describe("Study store — card status snapshot", () => {
  it("updates studied concepts only, and writes nothing when nothing changed", async () => {
    const { meta, sets } = memoryMeta();
    await recordAttempt(meta, WS, quiz(src(["u1"]), true, 1));
    sets.length = 0;
    expect(await snapshotCardStatus(meta, WS, [{ concept: src(["u1"]), canvasId: "cv1", open: true }, { concept: src(["u9"]), canvasId: "cv1", open: true }], 5)).toBe(1);
    expect(sets).toEqual(["study.ws1.s1"]);
    const loaded = await loadStudy(meta, WS, { now: 6 });
    expect(loaded.get("c:s1:u1")!.record.cardStatus).toEqual({ status: "open", at: 5, version: 1 });
    expect(loaded.has("c:s1:u9")).toBe(false);
    sets.length = 0;
    expect(await snapshotCardStatus(meta, WS, [{ concept: src(["u1"]), canvasId: "cv1", open: true }], 7)).toBe(0);
    expect(sets).toEqual([]);
  });
});

describe("Study store — deletion", () => {
  it("clearStudy removes the index and every shard it lists, and nothing of another workspace", async () => {
    const { meta, map } = memoryMeta();
    await recordAttempt(meta, WS, quiz(src(["u1"]), true, 1));
    await recordAttempt(meta, WS, quiz(src(["u1"], 1, "s2"), true, 1));
    await recordAttempt(meta, WS, quiz(local("el1"), true, 1));
    await recordAttempt(meta, "ws2", quiz(src(["u1"]), true, 1));
    await clearStudy(meta, WS);
    expect([...map.keys()].filter((k) => k === "study.ws1" || k.startsWith("study.ws1."))).toEqual([]);
    expect([...map.keys()].sort()).toEqual(["study.ws2", "study.ws2.s1"]);
  });

  it("clearStudySource removes one shard and its index entry", async () => {
    const { meta, map } = memoryMeta();
    await recordAttempt(meta, WS, quiz(src(["u1"]), true, 1));
    await recordAttempt(meta, WS, quiz(src(["u1"], 1, "s2"), true, 1));
    await clearStudySource(meta, WS, "s1");
    expect(map.has("study.ws1.s1")).toBe(false);
    expect(Object.keys((map.get("study.ws1") as { shards: object }).shards)).toEqual(["s2"]);
  });
});
