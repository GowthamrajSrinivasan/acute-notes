/**
 * Stage 5a (intelligent-update-engine-plan §13.2): the provider-neutral embedding seam — offline, no model weights,
 * no network. The model itself is measured by `embeddingSpike.test.ts` (opt-in).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cosine, localEmbedder } from "./embedding";
import {
  createEmbeddingProvider,
  dequantize,
  EmbedderMismatchError,
  embeddingConfigFrom,
  EmbeddingProviderUnavailableError,
  hashedProvider,
  quantize,
  similarity,
  withFallback,
  type EmbeddingProvider,
  type EmbeddingVector,
} from "./embeddingProvider";
import { LocalModelProvider } from "./localModelEmbedding";

/** A stand-in for any dense embedder (a model or a provider API): deterministic, no weights. */
function fakeDense(id: string, kind: "local" | "remote" = "local", ready = true): EmbeddingProvider & { calls: number } {
  const p = {
    id,
    dims: 4,
    kind,
    thresholds: { related: 0.5 },
    calls: 0,
    ready: async () => (ready ? ({ state: "ready" } as const) : ({ state: "unavailable", reason: "no weights" } as const)),
    embed: async (texts: readonly string[]) => {
      p.calls++;
      return texts.map((t) => {
        const v = Float32Array.from([t.length, t.split(" ").length, 1, t.includes("key") ? 3 : 0]);
        const n = Math.hypot(...v);
        return { embedder: id, dense: v.map((x) => x / n) };
      });
    },
  };
  return p;
}

describe("5a — the hashed embedder on the new seam", () => {
  it("gives the same vectors and similarities as the Stage 2a embedder", async () => {
    const [a, b] = await hashedProvider.embed(["Signing keys rotate monthly.", "Key rotation happens every month."]);
    expect(a!.embedder).toBe(localEmbedder.id);
    expect(similarity(a!, b!)).toBeCloseTo(cosine(localEmbedder.embed("Signing keys rotate monthly."), localEmbedder.embed("Key rotation happens every month.")), 10);
    expect(hashedProvider.thresholds.related).toBe(0.2);
    expect(await hashedProvider.ready()).toEqual({ state: "ready" });
  });
});

describe("5a — vectors from two embedders are never compared", () => {
  it("similarity refuses a pair from different embedders", async () => {
    const [h] = await hashedProvider.embed(["Retries happen five times."]);
    const [m] = await fakeDense("local-fake-v1").embed(["Retries happen five times."]);
    expect(() => similarity(h!, m!)).toThrow(EmbedderMismatchError);
  });

  it("refuses a malformed pair from one embedder (one dense, one sparse)", () => {
    const sparse: EmbeddingVector = { embedder: "x", sparse: localEmbedder.embed("a b") };
    const dense: EmbeddingVector = { embedder: "x", dense: new Float32Array([1, 0]) };
    expect(() => similarity(sparse, dense)).toThrow(/one dense, one sparse/);
  });
});

describe("5a — storage at one byte per dimension", () => {
  it("quantise → dequantise keeps similarity within 0.01, at a quarter of the size", () => {
    const rnd = (seed: number) => Float32Array.from({ length: 384 }, (_, i) => Math.sin(seed * 31 + i * 7.3));
    const norm = (v: Float32Array) => v.map((x) => x / Math.hypot(...v));
    const a: EmbeddingVector = { embedder: "m", dense: norm(rnd(1)) };
    const b: EmbeddingVector = { embedder: "m", dense: norm(rnd(2)) };
    const qa = quantize(a);
    expect(qa.q.byteLength).toBe(a.dense!.byteLength / 4);
    expect(Math.abs(similarity(dequantize(qa), dequantize(quantize(b))) - similarity(a, b))).toBeLessThan(0.01);
    expect(dequantize(qa).embedder).toBe("m");
  });

  it("refuses to quantise a sparse vector", async () => {
    const [h] = await hashedProvider.embed(["x y"]);
    expect(() => quantize(h!)).toThrow(/sparse/);
  });
});

describe("5a — configuration picks the embedder; callers never do", () => {
  it("reads the configuration string; anything unknown is the hashed default", () => {
    expect(embeddingConfigFrom(undefined)).toEqual({ provider: "hashed" });
    expect(embeddingConfigFrom("hashed")).toEqual({ provider: "hashed" });
    expect(embeddingConfigFrom("local-model:minilm-l6")).toEqual({ provider: "local-model", model: "minilm-l6" });
    expect(embeddingConfigFrom("local-model:no-such-model")).toEqual({ provider: "hashed" });
    expect(embeddingConfigFrom("remote:acme:embed-1")).toEqual({ provider: "remote", name: "acme", model: "embed-1" });
    expect(embeddingConfigFrom("garbage")).toEqual({ provider: "hashed" });
  });

  it("the default is the hashed embedder (nothing changes until the model passes its gate)", () => {
    expect(createEmbeddingProvider()).toBe(hashedProvider);
  });

  it("a local model is created without loading anything, with the hashed embedder as its fallback", () => {
    const p = createEmbeddingProvider({ provider: "local-model", model: "minilm-l6" });
    expect(p.id).toBe("local-minilm-l6-q8-v1");
    expect(p.kind).toBe("local");
    expect(p.dims).toBe(384);
  });

  it("a provider API is a drop-in: the same interface, plugged in by configuration", async () => {
    expect(() => createEmbeddingProvider({ provider: "remote", name: "acme", model: "embed-1" })).toThrow(EmbeddingProviderUnavailableError);
    const remote = createEmbeddingProvider({ provider: "remote", name: "acme", model: "embed-1" }, { remote: (c) => fakeDense(`remote-${c.name}-${c.model}`, "remote") });
    expect(remote.kind).toBe("remote");
    const [a, b] = await remote.embed(["Signing keys rotate monthly.", "Signing keys rotate monthly."]);
    expect(similarity(a!, b!)).toBeCloseTo(1, 6);
    expect(a!.embedder).toBe("remote-acme-embed-1");
  });
});

describe("5a — the AI feature switch (review 2026-11-14)", () => {
  it("with AI off, a local model or a provider API is never created: only the hashed embedder runs", () => {
    const before = process.env.NEXT_PUBLIC_AI_FEATURE;
    process.env.NEXT_PUBLIC_AI_FEATURE = "off";
    try {
      expect(createEmbeddingProvider({ provider: "local-model", model: "minilm-l6", source: { allowDownload: true } })).toBe(hashedProvider);
      expect(createEmbeddingProvider({ provider: "remote", name: "acme", model: "embed-1" }, { remote: (c) => fakeDense(`remote-${c.name}`, "remote") })).toBe(hashedProvider);
      expect(createEmbeddingProvider({ provider: "hashed" })).toBe(hashedProvider);
    } finally {
      process.env.NEXT_PUBLIC_AI_FEATURE = before;
    }
  });
});

describe("5a — fallback when the model can't load", () => {
  it("uses the primary when it is ready", async () => {
    const primary = fakeDense("local-fake-v1");
    const p = withFallback(primary, hashedProvider);
    const [v] = await p.embed(["key rotation"]);
    expect(v!.embedder).toBe("local-fake-v1");
    expect(p.id).toBe("local-fake-v1");
  });

  it("switches to the fallback when the primary is unavailable; ids and thresholds follow, vectors stay tagged", async () => {
    const p = withFallback(fakeDense("local-fake-v1", "local", false), hashedProvider);
    expect(await p.ready()).toEqual({ state: "ready" });
    const [v] = await p.embed(["key rotation"]);
    expect(v!.embedder).toBe(hashedProvider.id);
    expect(p.id).toBe(hashedProvider.id);
    expect(p.thresholds).toBe(hashedProvider.thresholds);
    expect(p.active()).toBe(hashedProvider);
  });
});

describe("5a — the local model never downloads unless allowed", () => {
  const empty = mkdtempSync(join(tmpdir(), "acute-embed-"));
  afterAll(() => rmSync(empty, { recursive: true, force: true }));

  it("with no weights on disk and downloads off, it reports unavailable and embed() throws", async () => {
    const m = new LocalModelProvider("minilm-l6", { cacheDir: empty, allowDownload: false });
    const r = await m.ready();
    expect(r.state).toBe("unavailable");
    await expect(m.embed(["x"])).rejects.toThrow(EmbeddingProviderUnavailableError);
  }, 60_000);

  it("through the factory, the same case falls back to the hashed embedder and keeps working", async () => {
    const p = createEmbeddingProvider({ provider: "local-model", model: "minilm-l6", source: { cacheDir: empty, allowDownload: false } });
    const [v] = await p.embed(["Retries happen five times."]);
    expect(v!.embedder).toBe(hashedProvider.id);
  }, 60_000);
});
