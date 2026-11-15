/**
 * Source restoration never attaches unrelated history (Study review 2026-11-15). A source delete retires its concepts
 * (`source_missing`, history kept). Then:
 * - **Restored by import** (`portability/workspaceBundle.ts` `restoreSources`): the source gets a new id, so its cards'
 *   concepts get new keys and start empty; the retired history stays with the old key.
 * - **Back under the same id** (no app path does this today; covered so it stays safe): loading doesn't revive anything.
 *   Studying the concept again starts it afresh: the old answers stay, stale, and never count.
 */
import { describe, expect, it } from "vitest";
import type { ContentSource, ContentSourceVersion } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { MetaRepository } from "@/persistence/repositories/types";
import { conceptKey, type Concept } from "./concept";
import { deleteContentSource } from "./cleanup";
import { bandOf, freshAttempts, isWeak, masteryOf } from "./mastery";
import { loadStudy, recordAttempt } from "./store";

function services() {
  const keys = new Map<string, unknown>();
  const meta: MetaRepository = { get: async <T,>(k: string) => structuredClone(keys.get(k)) as T | undefined, set: async (k, v) => void keys.set(k, structuredClone(v)), delete: async (k) => void keys.delete(k) };
  return { ...createMemoryServices(), meta, keys };
}
const source = (id: string, v: number): ContentSource => ({ id, workspaceId: "ws1", canvasId: "cv1", origin: "paste", tier: "local", template: "auto", latestVersion: v, createdAt: 1, updatedAt: 1 });
const version = (sourceId: string, v: number): ContentSourceVersion => ({ sourceId, version: v, text: `v${v}`, plan: null, createdAt: v }) as unknown as ContentSourceVersion;
const concept = (sourceId: string, units: string[]): Concept => ({ key: conceptKey(sourceId, units), local: false, sourceId, units, sourceVersion: 1 });
const DAY = 24 * 60 * 60 * 1000;

async function studiedThenDeleted() {
  const s = services();
  await s.contentSources.append(source("src_old", 1), version("src_old", 1));
  const old = concept("src_old", ["u1"]);
  for (let i = 0; i < 3; i++) await recordAttempt(s.meta, "ws1", { concept: old, canvasId: "cv1", title: "Old", kind: "quiz", correct: false, objectId: "card", at: 1 + i });
  await deleteContentSource(s, "src_old", 10);
  return { s, old };
}

describe("source restoration never attaches unrelated history", () => {
  it("restored by import (a new source id): the same passages are a new, empty concept; the old history stays retired under its own key", async () => {
    const { s, old } = await studiedThenDeleted();
    await s.contentSources.append(source("src_new", 1), version("src_new", 1));
    const restored = concept("src_new", ["u1"]);
    expect(restored.key).not.toBe(old.key);

    const loaded = await loadStudy(s.meta, "ws1", { now: 20, sources: s.contentSources });
    expect(loaded.get(restored.key)).toBeUndefined();
    expect(loaded.get(old.key)!.record).toMatchObject({ state: "retired", reason: "source_missing" });

    const rec = await recordAttempt(s.meta, "ws1", { concept: restored, canvasId: "cv1", title: "New", kind: "quiz", correct: true, objectId: "card", at: 30 });
    expect(rec.attempts).toHaveLength(1);
    expect((await loadStudy(s.meta, "ws1", { now: 40 })).get(old.key)!.record.attempts).toHaveLength(3);
  });

  it("back under the same id: loading leaves it retired (no silent re-attach)", async () => {
    const { s, old } = await studiedThenDeleted();
    await s.contentSources.append(source("src_old", 1), version("src_old", 1));
    const loaded = await loadStudy(s.meta, "ws1", { now: 20, sources: s.contentSources });
    expect(loaded.get(old.key)!.record).toMatchObject({ state: "retired", reason: "source_missing" });
    expect(isWeak(loaded.get(old.key)!.record)).toBe(false);
  });

  it("back under the same id and studied again: a fresh start — old answers kept but stale, never counted", async () => {
    const { s, old } = await studiedThenDeleted();
    await s.contentSources.append(source("src_old", 1), version("src_old", 1));
    const now = 100 * DAY;
    const rec = await recordAttempt(s.meta, "ws1", { concept: old, canvasId: "cv1", title: "Old", kind: "quiz", correct: true, objectId: "card", at: now });
    expect(rec.state).toBeUndefined();
    expect(rec.reason).toBeUndefined();
    expect(rec.attempts).toHaveLength(4); // the audit history stays
    expect(rec.attempts.slice(0, 3).every((a) => (a[3] & 2) !== 0)).toBe(true); // stale
    expect(freshAttempts(rec)).toHaveLength(1);
    expect(isWeak(rec)).toBe(false); // the three old misses don't make it weak
    expect(bandOf(rec, now)).toBe("new");
    expect(masteryOf(rec, now).m).toBeGreaterThan(0.5);
  });
});
