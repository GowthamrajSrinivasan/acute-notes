import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { liveSavedIds, STALE_MARKER_DAYS, staleMarkers, staleMetaKey } from "./staleMarkersStore";

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("repo map stale markers (F43)", () => {
  beforeEach(() => staleMarkers.reset());

  it("survive a reload through the device-local meta store, and dismissals are saved too", async () => {
    const { meta } = createMemoryServices();
    await staleMarkers.restore("cv", meta);
    staleMarkers.set("cv", ["a", "b"]);
    await settle();
    expect(await meta.get(staleMetaKey("cv"))).toEqual({ ids: ["a", "b"], savedAt: expect.any(Number) });

    // A reload: memory is gone, the saved markers come back.
    staleMarkers.reset();
    expect(staleMarkers.get("cv").size).toBe(0);
    await staleMarkers.restore("cv", meta);
    expect([...staleMarkers.get("cv")]).toEqual(["a", "b"]);

    staleMarkers.clear("cv", ["a", "b"]);
    await settle();
    expect(await meta.get(staleMetaKey("cv"))).toBeUndefined();
  });

  it("markers set before the saved ones load win, and replace them in the store", async () => {
    const { meta } = createMemoryServices();
    await meta.set(staleMetaKey("cv"), ["old"]);
    staleMarkers.set("cv", ["new"]);
    await settle();
    expect(await meta.get(staleMetaKey("cv"))).toEqual(["old"]);
    await staleMarkers.restore("cv", meta);
    expect([...staleMarkers.get("cv")]).toEqual(["new"]);
    await settle();
    expect(await meta.get(staleMetaKey("cv"))).toEqual({ ids: ["new"], savedAt: expect.any(Number) });
  });

  it("are dropped after the age limit instead of kept forever; the older array format still loads", async () => {
    const day = 24 * 60 * 60 * 1000;
    const now = Date.now();
    expect(liveSavedIds({ ids: ["a"], savedAt: now - (STALE_MARKER_DAYS - 1) * day }, now)).toEqual(["a"]);
    expect(liveSavedIds({ ids: ["a"], savedAt: now - (STALE_MARKER_DAYS + 1) * day }, now)).toEqual([]);
    expect(liveSavedIds(["old", 3], now)).toEqual(["old"]);
    expect(liveSavedIds(null, now)).toEqual([]);

    const { meta } = createMemoryServices();
    await meta.set(staleMetaKey("cv"), { ids: ["x"], savedAt: now - (STALE_MARKER_DAYS + 1) * day });
    await staleMarkers.restore("cv", meta);
    expect(staleMarkers.get("cv").size).toBe(0);
    await settle();
    expect(await meta.get(staleMetaKey("cv"))).toBeUndefined();
  });
});
