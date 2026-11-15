/**
 * Study-mode plan issue C, as decided 2026-11-15 (option a): deleting a content source removes every
 * `sourceReview:<sourceId>@<v>` key, which used to leak (regression test), but keeps its study history, retired as
 * `source_missing`. Memory repositories.
 */
import { describe, expect, it } from "vitest";
import { saveSourceOutcomes, sourceReviewKey } from "@/ai/content/sourceReview";
import type { ContentSource, ContentSourceVersion } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { MetaRepository } from "@/persistence/repositories/types";
import { conceptKey } from "./concept";
import { deleteContentSource } from "./cleanup";
import { clearStudy, loadStudy, recordAttempt, studyIndexKey } from "./store";

function services() {
  const keys = new Map<string, unknown>();
  const meta: MetaRepository = {
    get: async <T,>(k: string) => keys.get(k) as T | undefined,
    set: async (k, v) => void keys.set(k, v),
    delete: async (k) => void keys.delete(k),
  };
  return { ...createMemoryServices(), meta, keys };
}

const source = (id: string, latestVersion: number): ContentSource => ({ id, workspaceId: "ws1", canvasId: "cv1", origin: "paste", tier: "local", template: "auto", latestVersion, createdAt: 1, updatedAt: 1 });
const version = (sourceId: string, v: number): ContentSourceVersion => ({ sourceId, version: v, text: `v${v}`, plan: null, createdAt: v }) as unknown as ContentSourceVersion;

async function seed(s: ReturnType<typeof services>, id: string, versions: number) {
  for (let v = 1; v <= versions; v++) {
    await s.contentSources.append(source(id, v), version(id, v));
    await saveSourceOutcomes(s.meta, id, v, { outcome: { u1: "represented" }, reasons: {}, flags: [] });
  }
  await recordAttempt(s.meta, "ws1", { concept: { key: conceptKey(id, ["u1"]), local: false, sourceId: id, units: ["u1"], sourceVersion: versions }, canvasId: "cv1", title: "T", kind: "quiz", correct: false, at: 1 });
}

describe("deleting a content source (issue C)", () => {
  it("removes the source and every sourceReview:<id>@v key; keeps its study history, retired as source_missing (option a)", async () => {
    const s = services();
    await seed(s, "src_a", 3);
    await seed(s, "src_b", 2);
    expect([...s.keys.keys()].filter((k) => k.startsWith("sourceReview:src_a@"))).toHaveLength(3);

    expect(await deleteContentSource(s, "src_a", 50)).toBe(true);
    expect(await s.contentSources.get("src_a")).toBeNull();
    const left = [...s.keys.keys()];
    expect(left.filter((k) => k.startsWith("sourceReview:src_a@"))).toEqual([]);
    expect(Object.keys((s.keys.get(studyIndexKey("ws1")) as { shards: object }).shards).sort()).toEqual(["src_a", "src_b"]);
    expect(left.filter((k) => k.startsWith("sourceReview:src_b@")).sort()).toEqual([sourceReviewKey("src_b", 1), sourceReviewKey("src_b", 2)]);

    // Audit history kept: the attempt is still there, the concept is retired with the reason the Weak view explains.
    const loaded = await loadStudy(s.meta, "ws1", { now: 60, sources: s.contentSources });
    const a = loaded.get(conceptKey("src_a", ["u1"]))!;
    expect(a.record).toMatchObject({ state: "retired", reason: "source_missing" });
    expect(a.record.attempts).toHaveLength(1);
    expect(loaded.get(conceptKey("src_b", ["u1"]))!.record.state).toBeUndefined();
  });

  it("a workspace's 'Clear study history' still wipes a deleted source's retired history", async () => {
    const s = services();
    await seed(s, "src_a", 1);
    await deleteContentSource(s, "src_a", 50);
    await clearStudy(s.meta, "ws1");
    expect([...s.keys.keys()].filter((k) => k.startsWith("study."))).toEqual([]);
  });

  it("regression: the store's own delete alone leaves sourceReview keys behind (the leak this fixes)", async () => {
    const s = services();
    await seed(s, "src_a", 2);
    await s.contentSources.delete("src_a");
    expect([...s.keys.keys()].filter((k) => k.startsWith("sourceReview:src_a@"))).toHaveLength(2);
    // deleteContentSource on an already-deleted source finds nothing to enumerate: the cleanup must run with the delete.
    expect(await deleteContentSource(s, "src_a")).toBe(false);
  });

  it("a source that doesn't exist is a no-op", async () => {
    const s = services();
    expect(await deleteContentSource(s, "nope")).toBe(false);
    expect(s.keys.size).toBe(0);
  });
});
