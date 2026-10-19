import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { DocumentProvider } from "./DocumentProvider";
import { DocumentRegistry } from "./documentRegistry";

afterEach(() => vi.useRealTimers());

describe("DocumentRegistry", () => {
  it("opens a document once for concurrent acquirers (strict-mode double mount)", async () => {
    const { yupdates } = createMemoryServices();
    const registry = new DocumentRegistry(0);
    const open = vi.fn(async () => {
      const p = new DocumentProvider("doc/1", yupdates, { flushDelay: 0 });
      await p.load();
      p.applyLocalChange((doc) => doc.getMap("m").set("seeded", ((doc.getMap("m").get("seeded") as number) ?? 0) + 1));
      return p;
    });
    const a = registry.acquire("doc/1", open);
    a.release();
    const b = registry.acquire("doc/1", open);
    const [pa, pb] = await Promise.all([a.provider, b.provider]);
    expect(open).toHaveBeenCalledOnce();
    expect(pa).toBe(pb);
    expect(pb.doc.getMap("m").get("seeded")).toBe(1);
    b.release();
  });

  it("disposes after the grace period once unreferenced", async () => {
    vi.useFakeTimers();
    const { yupdates } = createMemoryServices();
    const registry = new DocumentRegistry(100);
    const provider = new DocumentProvider("doc/1", yupdates);
    const dispose = vi.spyOn(provider, "dispose");
    const lease = registry.acquire("doc/1", async () => provider);
    await lease.provider;
    lease.release();
    lease.release(); // idempotent
    expect(registry.size).toBe(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(registry.size).toBe(0);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
