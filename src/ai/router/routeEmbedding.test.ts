/**
 * The browser side of the local model (Stage 5a wiring, §18): the route's answers, the per-text cache, batching, and the
 * fallback to the hashed embedder when the route is off or has no weights. A fake fetch; no server, no model.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashedProvider, quantize, withFallback } from "./embeddingProvider";
import { isModel, resetSemanticEmbedder, RouteEmbeddingProvider, semanticEmbedder } from "./routeEmbedding";

const vec = (seed: number) => {
  const d = new Float32Array(4).map((_v, i) => Math.sin(seed + i));
  const n = Math.hypot(...d);
  return quantize({ embedder: "local-minilm-l6-q8-v1", dense: d.map((x) => x / n) });
};
const b64 = (q: Int8Array) => Buffer.from(q.buffer, q.byteOffset, q.byteLength).toString("base64");

function fakeRoute(status = 200) {
  const posts: string[][] = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "GET") return status === 200 ? Response.json({ embedder: "local-minilm-l6-q8-v1", dims: 4, related: 0.3 }) : new Response("no", { status });
    const texts = (JSON.parse(String(init!.body)) as { texts: string[] }).texts;
    posts.push(texts);
    return Response.json({ embedder: "local-minilm-l6-q8-v1", dims: 4, related: 0.3, vectors: texts.map((t) => ({ q: b64(vec(t.length).q), scale: vec(t.length).scale })) });
  });
  return { fetcher, posts };
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetSemanticEmbedder();
});

describe("RouteEmbeddingProvider", () => {
  it("takes the server's model id, and embeds each distinct text once (cached), in order", async () => {
    const { fetcher, posts } = fakeRoute();
    const p = new RouteEmbeddingProvider(fetcher);
    expect(await p.ready()).toEqual({ state: "ready" });
    expect(p.id).toBe("local-minilm-l6-q8-v1");
    const a = await p.embed(["one", "three", "one"]);
    expect(a.map((v) => v.embedder)).toEqual(["local-minilm-l6-q8-v1", "local-minilm-l6-q8-v1", "local-minilm-l6-q8-v1"]);
    expect(a[0]!.dense).toEqual(a[2]!.dense);
    await p.embed(["three", "four"]);
    expect(posts).toEqual([["one", "three"], ["four"]]);
  });

  it("off (404) or no weights (503): unavailable, and the shared embedder falls back to hashed — which the dialog doesn't use", async () => {
    for (const status of [404, 503]) {
      const p = new RouteEmbeddingProvider(fakeRoute(status).fetcher);
      expect((await p.ready()).state).toBe("unavailable");
      await expect(p.embed(["x"])).rejects.toThrow(/unavailable/);
      const shared = withFallback(p, hashedProvider);
      await shared.ready();
      expect(isModel(shared)).toBe(false);
    }
  });

  it("the build's switch off: the hashed embedder, and no request at all", async () => {
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "on");
    vi.stubEnv("NEXT_PUBLIC_SEMANTIC_PLACEMENT", "off");
    const spy = vi.spyOn(globalThis, "fetch");
    const e = semanticEmbedder();
    await e.ready();
    expect(isModel(e)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
