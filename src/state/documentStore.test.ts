import { afterEach, describe, expect, it, vi } from "vitest";
import type { DocumentRecord } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { DocumentStore } from "./documentStore";

const record = (id: string): DocumentRecord => ({
  id,
  workspaceId: "ws",
  kind: "block",
  title: "Untitled",
  snapshot: [],
  createdAt: 1,
  updatedAt: 1,
});

afterEach(() => vi.useRealTimers());

describe("DocumentStore", () => {
  it("loads lazily and notifies only the subscribed id", async () => {
    const { documents } = createMemoryServices();
    await documents.put(record("a"));
    await documents.put(record("b"));
    const store = new DocumentStore(documents);
    const a = vi.fn();
    const b = vi.fn();
    store.subscribe("a", a);
    store.subscribe("b", b);
    await store.load("a");
    await store.load("b");
    a.mockClear();
    b.mockClear();

    store.updateSnapshot("a", [{ type: "paragraph", content: "hi" }], "hi");
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    expect(store.get("a")?.title).toBe("hi");
  });

  it("debounces writes and flushes on demand", async () => {
    vi.useFakeTimers();
    const { documents } = createMemoryServices();
    const store = new DocumentStore(documents);
    await store.put(record("a"));
    const put = vi.spyOn(documents, "put");
    for (let i = 0; i < 10; i++) store.updateSnapshot("a", [{ type: "paragraph", content: `v${i}` }]);
    expect(put).not.toHaveBeenCalled();
    await store.flush();
    expect(put).toHaveBeenCalledOnce();
    expect((await documents.get("a"))?.snapshot).toEqual([{ type: "paragraph", content: "v9" }]);
  });

  it("reports missing records as null", async () => {
    const store = new DocumentStore(createMemoryServices().documents);
    expect(store.get("nope")).toBeUndefined();
    await store.load("nope");
    expect(store.get("nope")).toBeNull();
  });

  it("lists one kind per workspace and notifies kind subscribers only for that kind", async () => {
    const { documents } = createMemoryServices();
    await documents.put({ ...record("page_1"), kind: "page" });
    await documents.put(record("doc_1"));
    const store = new DocumentStore(documents);
    const pages = vi.fn();
    store.subscribeKind("page", pages);

    await store.loadKind("ws", "page");
    expect(store.list("ws", "page").map((r) => r.id)).toEqual(["page_1"]);
    expect(store.get("doc_1")).toBeUndefined();
    expect(pages).toHaveBeenCalledOnce();

    const before = store.kindVersion("page");
    await store.put(record("doc_2"));
    expect(store.kindVersion("page")).toBe(before);

    store.update("page_1", { title: "Renamed" });
    expect(store.kindVersion("page")).toBe(before + 1);
    expect(pages).toHaveBeenCalledTimes(2);
  });

  it("deletes a record: cache reports it missing and pending writes are dropped", async () => {
    vi.useFakeTimers();
    const { documents } = createMemoryServices();
    const store = new DocumentStore(documents);
    await store.put({ ...record("page_1"), kind: "page" });
    store.update("page_1", { title: "Pending" });
    await store.delete("page_1");
    await vi.runAllTimersAsync();
    expect(store.get("page_1")).toBeNull();
    expect(await documents.get("page_1")).toBeNull();
    expect(store.list("ws", "page")).toEqual([]);
  });
});
