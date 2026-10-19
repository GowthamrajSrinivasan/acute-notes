import { describe, expect, it, vi } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { YUpdateStore } from "@/persistence/repositories/types";
import { DocumentProvider } from "./DocumentProvider";
import type { SyncProvider } from "./SyncProvider";

async function reopen(store: YUpdateStore, docId = "doc/1") {
  const p = new DocumentProvider(docId, store, { flushDelay: 0 });
  await p.load();
  return p;
}

describe("DocumentProvider", () => {
  it("persists local changes and restores them on reload", async () => {
    const { yupdates } = createMemoryServices();
    const p1 = await reopen(yupdates);
    p1.applyLocalChange((doc) => doc.getMap("m").set("title", "Findings"));
    p1.applyLocalChange((doc) => doc.getMap("m").set("count", 3));
    await p1.dispose();

    const p2 = await reopen(yupdates);
    expect(p2.doc.getMap("m").toJSON()).toEqual({ title: "Findings", count: 3 });
  });

  it("batches rapid changes into a single stored update", async () => {
    const { yupdates } = createMemoryServices();
    const p = new DocumentProvider("doc/1", yupdates, { flushDelay: 10_000 });
    await p.load();
    for (let i = 0; i < 20; i++) p.applyLocalChange((doc) => doc.getMap("m").set("i", i));
    await p.flush();
    expect((await yupdates.load("doc/1")).updates).toHaveLength(1);
    await p.dispose();
  });

  it("does not re-persist updates replayed from storage", async () => {
    const { yupdates } = createMemoryServices();
    const p1 = await reopen(yupdates);
    p1.applyLocalChange((doc) => doc.getMap("m").set("a", 1));
    await p1.dispose();

    const p2 = await reopen(yupdates);
    await p2.flush();
    expect((await yupdates.load("doc/1")).updates).toHaveLength(1);
    await p2.dispose();
  });

  it("compacts large logs without losing concurrently appended updates", async () => {
    const services = createMemoryServices();
    const store = services.yupdates;
    const writer = await reopen(store);
    for (let i = 0; i < 5; i++) {
      writer.applyLocalChange((doc) => doc.getMap("m").set(`k${i}`, i));
      await writer.flush();
    }
    await writer.dispose();

    // Simulate another tab appending between our load and our compaction.
    const other = await reopen(store, "doc/1");
    other.applyLocalChange((doc) => doc.getMap("m").set("fromOtherTab", true));
    const originalCompact = store.compact.bind(store);
    const compactSpy = vi.fn(async (docId: string, keys: number[], merged: Uint8Array) => {
      await other.flush();
      await originalCompact(docId, keys, merged);
    });
    const compacting = new DocumentProvider("doc/1", { ...store, compact: compactSpy }, { compactThreshold: 2 });
    await compacting.load();
    expect(compactSpy).toHaveBeenCalledOnce();
    await compacting.dispose();
    await other.dispose();

    const reloaded = await reopen(store);
    expect(reloaded.doc.getMap("m").toJSON()).toMatchObject({ k0: 0, k4: 4, fromOtherTab: true });
    expect((await store.load("doc/1")).updates.length).toBe(2);
  });

  it("forwards local updates to the sync provider but not remote or replayed ones", async () => {
    const { yupdates } = createMemoryServices();
    let remote: ((docId: string, update: Uint8Array) => void) | null = null;
    const sent: Uint8Array[] = [];
    const sync: SyncProvider = {
      connect: async () => {},
      disconnect: async () => {},
      onUpdate: (cb) => ((remote = cb), () => (remote = null)),
      sendUpdate: (_id, u) => void sent.push(u),
    };
    const p = new DocumentProvider("doc/1", yupdates, { sync, flushDelay: 0 });
    await p.load();
    p.applyLocalChange((doc) => doc.getMap("m").set("local", 1));
    expect(sent).toHaveLength(1);

    const peer = new DocumentProvider("doc/peer", yupdates);
    let peerUpdate: Uint8Array | null = null;
    peer.doc.on("update", (u: Uint8Array) => (peerUpdate = u));
    peer.doc.getMap("m").set("remote", 2);
    remote!("doc/1", peerUpdate!);
    expect(sent).toHaveLength(1);
    expect(p.doc.getMap("m").get("remote")).toBe(2);
    await p.dispose();
  });

  it("re-queues data when a write fails", async () => {
    const { yupdates } = createMemoryServices();
    let fail = true;
    const flaky: YUpdateStore = {
      ...yupdates,
      append: async (id, u) => {
        if (fail) throw new Error("quota");
        return yupdates.append(id, u);
      },
    };
    const states: string[] = [];
    const p = new DocumentProvider("doc/1", flaky, { flushDelay: 10_000, onStateChange: (s) => states.push(s) });
    await p.load();
    p.applyLocalChange((doc) => doc.getMap("m").set("a", 1));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await p.flush();
    expect(states).toContain("error");
    fail = false;
    await p.flush();
    errSpy.mockRestore();
    await p.dispose();
    expect((await reopen(yupdates)).doc.getMap("m").get("a")).toBe(1);
  });
});
