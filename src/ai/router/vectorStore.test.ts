import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, expect, it, vi } from "vitest";
import { quantize } from "./embeddingProvider";
import { RouteEmbeddingProvider } from "./routeEmbedding";
import { indexedDbVectorStore } from "./vectorStore";

const EMBEDDER = "local-minilm-l6-q8-v1";
const vec = (seed: number) => {
  const d = new Float32Array(4).map((_v, i) => Math.sin(seed + i));
  const n = Math.hypot(...d);
  return quantize({ embedder: EMBEDDER, dense: d.map((x) => x / n) });
};
let dbs = 0;
const fresh = (options: Parameters<typeof indexedDbVectorStore>[0] = {}) => {
  const name = `vectors-test-${++dbs}`;
  return { name, store: indexedDbVectorStore({ name, ...options })! };
};

describe("indexedDbVectorStore", () => {
  it("keeps a vector per embedder and text; another embedder's are a miss", async () => {
    const { store } = fresh();
    await store.putMany(EMBEDDER, [
      ["Retries happen five times.", vec(1)],
      ["The API timeout is 30 seconds.", vec(2)],
    ]);
    const got = await store.getMany(EMBEDDER, ["Retries happen five times.", "unknown", "The API timeout is 30 seconds."]);
    expect([...got.keys()]).toEqual(["Retries happen five times.", "The API timeout is 30 seconds."]);
    expect(got.get("Retries happen five times.")).toEqual({ embedder: EMBEDDER, q: vec(1).q, scale: vec(1).scale });
    expect((await store.getMany("another-model", ["Retries happen five times."])).size).toBe(0);
  });

  it("stores the text's hash, never the text", async () => {
    const { name, store } = fresh();
    await store.putMany(EMBEDDER, [["A private sentence about payroll.", vec(3)]]);
    const db = await openDB(name, 1);
    const rows = await db.getAll("vectors");
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toMatch(new RegExp(`^${EMBEDDER}\\|[0-9a-f]{64}$`));
    expect(JSON.stringify(rows[0])).not.toContain("payroll");
  });

  it("bounded: past the limit, the oldest-written go", async () => {
    let t = 0;
    const { store } = fresh({ max: 3, now: () => ++t });
    await store.putMany(EMBEDDER, [["a", vec(1)], ["b", vec(2)]]);
    await store.putMany(EMBEDDER, [["c", vec(3)], ["d", vec(4)]]);
    const got = await store.getMany(EMBEDDER, ["a", "b", "c", "d"]);
    expect([...got.keys()].sort()).toEqual(["b", "c", "d"]);
  });

  it("no IndexedDB (the server): no store, and the embedder works as before", () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error — removed for this check
    delete globalThis.indexedDB;
    try {
      expect(indexedDbVectorStore()).toBeNull();
    } finally {
      globalThis.indexedDB = saved;
    }
  });
});

describe("RouteEmbeddingProvider with the store: a page load later, nothing is embedded again", () => {
  const b64 = (q: Int8Array) => Buffer.from(q.buffer, q.byteOffset, q.byteLength).toString("base64");
  function fakeRoute() {
    const posts: string[][] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "GET") return Response.json({ embedder: EMBEDDER, dims: 4, related: 0.3 });
      const texts = (JSON.parse(String(init!.body)) as { texts: string[] }).texts;
      posts.push(texts);
      return Response.json({ embedder: EMBEDDER, vectors: texts.map((t) => ({ q: b64(vec(t.length).q), scale: vec(t.length).scale })) });
    });
    return { fetcher, posts };
  }

  it("the second page's provider reads the stored vectors and asks the route only for new text", async () => {
    const { store } = fresh();
    const first = fakeRoute();
    const a = await new RouteEmbeddingProvider(first.fetcher, "/api/ai/embed", store).embed(["one", "three"]);
    expect(first.posts).toEqual([["one", "three"]]);
    await vi.waitFor(async () => expect((await store.getMany(EMBEDDER, ["one", "three"])).size).toBe(2));

    const second = fakeRoute();
    const b = await new RouteEmbeddingProvider(second.fetcher, "/api/ai/embed", store).embed(["three", "one", "seven"]);
    expect(second.posts).toEqual([["seven"]]);
    expect(b[1]!.dense).toEqual(a[0]!.dense);
    expect(b[0]!.dense).toEqual(a[1]!.dense);
  });

  it("a store that fails is a miss: the route answers", async () => {
    const broken = { getMany: vi.fn(async () => new Map()), putMany: vi.fn(async () => undefined) };
    const route = fakeRoute();
    await new RouteEmbeddingProvider(route.fetcher, "/api/ai/embed", broken).embed(["one"]);
    expect(route.posts).toEqual([["one"]]);
    expect(broken.putMany).toHaveBeenCalledWith(EMBEDDER, [["one", expect.objectContaining({ embedder: EMBEDDER })]]);
  });
});
