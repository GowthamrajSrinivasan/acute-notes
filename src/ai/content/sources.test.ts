import { describe, expect, it } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
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

  it("keeps plain text and the accepted plan, nothing else", async () => {
    const { contentSources } = createMemoryServices();
    const id = newContentSourceId();
    await recordAcceptedSource(contentSources, home, record(id, 1, "hello"), 1);
    expect(Object.keys((await contentSources.getVersion(id, 1))!).sort()).toEqual(["createdAt", "plan", "sourceId", "text", "version"]);
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
