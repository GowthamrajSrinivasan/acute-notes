import { describe, expect, it } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { ContentSourceVersion } from "@/domain/types";
import type { ContentSourceRecord } from "@/ai/changes/changeSet";
import { loadLatest, newContentSourceId, recordAcceptedSource } from "./sources";

const home = { workspaceId: "ws", canvasId: "cv" };
const record = (sourceId: string, version: number, text: string) =>
  ({ sourceId, version, origin: "paste", tier: "local", template: "action_plan", text, plan: { version: 1, text } }) as const;

describe("content sources (F37)", () => {
  it("two accepted runs against the same source are two versions of one source, not two sources", async () => {
    const { contentSources } = createMemoryServices();
    const id = newContentSourceId();
    await recordAcceptedSource(contentSources, home, record(id, 1, "original"), 1);
    await recordAcceptedSource(contentSources, home, record(id, 2, "edited"), 2);

    expect(await contentSources.listByCanvas("cv")).toHaveLength(1);
    const latest = await loadLatest(contentSources, id);
    expect(latest?.source).toMatchObject({ id, latestVersion: 2, tier: "local", template: "action_plan", createdAt: 1, updatedAt: 2 });
    expect(latest?.version.text).toBe("edited");
    expect((await contentSources.getVersion(id, 1))?.text).toBe("original");
  });

  it("keeps plain text, the accepted plan and the text's source units, nothing else", async () => {
    const { contentSources } = createMemoryServices();
    const id = newContentSourceId();
    await recordAcceptedSource(contentSources, home, record(id, 1, "hello"), 1);
    expect(Object.keys((await contentSources.getVersion(id, 1))!).sort()).toEqual(["createdAt", "plan", "sourceId", "text", "units", "version"]);
  });

  it("loadLatest waits for a version still being recorded (Accept doesn't wait for the write)", async () => {
    const { contentSources } = createMemoryServices();
    const id = newContentSourceId();
    await recordAcceptedSource(contentSources, home, record(id, 1, "original"), 1);
    // Fire and forget, like Accept; read in the same tick.
    void recordAcceptedSource(contentSources, home, record(id, 2, "accepted just now"), 2);
    expect((await loadLatest(contentSources, id))?.version).toMatchObject({ version: 2, text: "accepted just now" });
    // Back-to-back writes keep their order.
    void recordAcceptedSource(contentSources, home, record(id, 3, "three"), 3);
    void recordAcceptedSource(contentSources, home, record(id, 4, "four"), 4);
    expect((await loadLatest(contentSources, id))?.source.latestVersion).toBe(4);
  });

  it("loadLatest is null for a source this device doesn't have (e.g. objects imported from elsewhere)", async () => {
    const { contentSources } = createMemoryServices();
    expect(await loadLatest(contentSources, "src_missing")).toBeNull();
    expect(newContentSourceId()).toMatch(/^src_/);
  });
});

describe("content sources: unit ids and lineage (knowledge-notes-plan §3.1, §6.3, WP1.3)", () => {
  const V1 = ["## Retries", "", "Retries can improve reliability when the cache holds a valid result.", "", "- Use an idempotency key", "- Log every retry"].join("\n");
  const ai = (sourceId: string, version: number, text: string, extra: Partial<ContentSourceRecord> = {}): ContentSourceRecord => ({
    sourceId,
    version,
    origin: "paste",
    tier: "ai",
    template: "sectioned",
    text,
    plan: { version: 1 },
    ...extra,
  });

  it("a first version gets fresh unit ids and no lineage", async () => {
    const { contentSources } = createMemoryServices();
    await recordAcceptedSource(contentSources, home, ai("s", 1, V1), 1);
    const v1 = (await contentSources.getVersion("s", 1))!;
    expect(v1.units!.units.map((u) => [u.id, u.kind, u.text])).toEqual([
      ["u1", "sentence", "Retries can improve reliability when the cache holds a valid result."],
      ["u2", "list_item", "Use an idempotency key"],
      ["u3", "list_item", "Log every retry"],
    ]);
    expect(v1.units!.nextId).toBe(4);
    expect(v1).not.toHaveProperty("lineage");
  });

  it("the next version carries ids over and records the lineage", async () => {
    const { contentSources } = createMemoryServices();
    await recordAcceptedSource(contentSources, home, ai("s", 1, V1), 1);
    await recordAcceptedSource(contentSources, home, ai("s", 2, `${V1}
- Alert after three failures`), 2);
    const v2 = (await contentSources.getVersion("s", 2))!;
    expect(v2.units!.units.map((u) => u.id)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(v2.lineage).toMatchObject({ fromVersion: 1, toVersion: 2 });
    expect(v2.lineage!.entries).toEqual([
      { state: "unchanged", from: "u1", to: "u1" },
      { state: "unchanged", from: "u2", to: "u2" },
      { state: "unchanged", from: "u3", to: "u3" },
      { state: "added", to: "u4" },
    ]);
  });

  it("a renamed section keeps its units' topic: unchanged, never a move (Lane B's pathIds request)", async () => {
    const { contentSources } = createMemoryServices();
    await recordAcceptedSource(contentSources, home, ai("s", 1, V1), 1);
    const renamed = V1.replace("## Retries", "## Retry policy");
    // Without pathIds on the record (e.g. "update the source from an edit"), they come from `nextPathIds`.
    await recordAcceptedSource(contentSources, home, ai("s", 2, renamed), 2);
    const v2 = (await contentSources.getVersion("s", 2))!;
    expect(v2.lineage!.entries.every((e) => e.state === "unchanged" && !e.moved)).toBe(true);
    const v1Topic = (await contentSources.getVersion("s", 1))!.units!.units[0]!.topic;
    expect(v2.units!.units[0]!.topic).toBe(v1Topic);
    // With the update's own pathIds on the record, the same.
    await recordAcceptedSource(contentSources, home, ai("s", 3, renamed.replace("## Retry policy", "## Retrying"), { pathIds: { Retrying: v1Topic } }), 3);
    const v3 = (await contentSources.getVersion("s", 3))!;
    expect(v3.units!.units[0]!.topic).toBe(v1Topic);
    expect(v3.lineage!.entries.some((e) => e.moved)).toBe(false);
    // The stored pathIds are only ever the record's own (nothing computed is written back).
    expect(v3.pathIds).toEqual({ Retrying: v1Topic });
    expect((await contentSources.getVersion("s", 2))!).not.toHaveProperty("pathIds");
  });

  it("stores the units and lineage a record already carries, as they are", async () => {
    const { contentSources } = createMemoryServices();
    const units = { units: [{ id: "u9", kind: "sentence" as const, text: "x", hash: "h", topic: "", span: { start: 0, end: 1 } }], nextId: 10 };
    const lineage = { fromVersion: 1, toVersion: 2, entries: [{ state: "added" as const, to: "u9" }] };
    await recordAcceptedSource(contentSources, home, ai("s", 2, "x", { units, lineage }), 1);
    expect(await contentSources.getVersion("s", 2)).toMatchObject({ units, lineage });
  });

  it("an old record (before unit ids) still loads, and the version after it gets fresh ids and no lineage", async () => {
    const { contentSources } = createMemoryServices();
    // Written as a version was before WP1.3: no units, no lineage.
    const old: ContentSourceVersion = { sourceId: "s", version: 1, text: V1, plan: { version: 1 }, pathIds: { Retries: "Retries" }, createdAt: 1 };
    await contentSources.append({ id: "s", workspaceId: "ws", canvasId: "cv", origin: "paste", tier: "ai", template: "sectioned", latestVersion: 1, createdAt: 1, updatedAt: 1 }, old);
    expect((await loadLatest(contentSources, "s"))?.version).toEqual(old);
    await recordAcceptedSource(contentSources, home, ai("s", 2, `${V1}
- Alert after three failures`), 2);
    const v2 = (await contentSources.getVersion("s", 2))!;
    expect(v2.units!.units.map((u) => u.id)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(v2).not.toHaveProperty("lineage");
    expect(await contentSources.getVersion("s", 1)).toEqual(old);
  });

  it("units an imported bundle passed through unreadable are ignored, and a text that can't be split is stored without units", async () => {
    const { contentSources } = createMemoryServices();
    const header = { id: "s", workspaceId: "ws", canvasId: "cv", origin: "paste" as const, tier: "ai" as const, template: "sectioned", latestVersion: 1, createdAt: 1, updatedAt: 1 };
    await contentSources.append(header, { sourceId: "s", version: 1, text: V1, plan: {}, units: { units: "broken" } as never, createdAt: 1 });
    await recordAcceptedSource(contentSources, home, ai("s", 2, V1), 2);
    expect((await contentSources.getVersion("s", 2))!.units!.units).toHaveLength(3);
    expect((await contentSources.getVersion("s", 2))!).not.toHaveProperty("lineage");
  });
});
