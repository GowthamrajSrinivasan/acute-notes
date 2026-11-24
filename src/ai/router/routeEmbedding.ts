/**
 * Stage 5a wiring (intelligent-update-engine-plan §18): the browser's `EmbeddingProvider` for the local model, which the
 * app's own server runs (`/api/ai/embed`, `serverEmbedding.ts`). Kind "local": the route refuses to run unless the server
 * is the user's own machine.
 *
 * - `ready()` asks the route once (GET); a 404 (switched off) or 503 (no weights) is "unavailable", and `semanticEmbedder()`
 *   then falls back to the hashed embedder — whose results the placement dialog doesn't use (it keeps today's router).
 * - Vectors are cached per text for this page's life (bounded), so a canvas's items, sections and notes embed once — and,
 *   in the browser, kept across page loads in IndexedDB (`vectorStore.ts`, 2026-11-24), so they embed once per device.
 * - Batched: one request per `BATCH` texts.
 */
import { isSemanticPlacementUiEnabled } from "@/config/features";
import { dequantize, EmbeddingProviderUnavailableError, hashedProvider, withFallback, type EmbeddingProvider, type EmbeddingReadiness, type EmbeddingThresholds, type EmbeddingVector, type QuantizedVector } from "./embeddingProvider";
import { indexedDbVectorStore, type VectorStore } from "./vectorStore";

const BATCH = 128;
const CACHE = 20_000;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function fromBase64(s: string): Int8Array {
  const bin = atob(s);
  const out = new Int8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = (bin.charCodeAt(i) << 24) >> 24;
  return out;
}

/** See module doc. */
export class RouteEmbeddingProvider implements EmbeddingProvider {
  readonly kind = "local" as const;
  private info: { embedder: string; dims: number; related: number } | null = null;
  private loading?: Promise<EmbeddingReadiness>;
  private readonly cache = new Map<string, EmbeddingVector>();

  constructor(
    private readonly fetcher: Fetch = (i, init) => fetch(i, init),
    private readonly url = "/api/ai/embed",
    /** Vectors kept across page loads (`vectorStore.ts`); null keeps them for this page's life only. */
    private readonly store: VectorStore | null = null,
  ) {}

  /** The server's embedder id once known (it names the model); a placeholder before, never used for a vector. */
  get id(): string {
    return this.info?.embedder ?? "local-route-pending";
  }
  get dims(): number {
    return this.info?.dims ?? 0;
  }
  get thresholds(): EmbeddingThresholds {
    return { related: this.info?.related ?? 0.3 };
  }

  ready(): Promise<EmbeddingReadiness> {
    return (this.loading ??= this.load());
  }

  private async load(): Promise<EmbeddingReadiness> {
    try {
      const res = await this.fetcher(this.url, { method: "GET", cache: "no-store" });
      if (!res.ok) return { state: "unavailable", reason: res.status === 404 ? "semantic placement is off on this server" : `the local model isn't available (${res.status})` };
      const info = (await res.json()) as { embedder?: unknown; dims?: unknown; related?: unknown };
      if (typeof info.embedder !== "string" || typeof info.dims !== "number") return { state: "unavailable", reason: "unexpected answer from the embedding route" };
      this.info = { embedder: info.embedder, dims: info.dims, related: typeof info.related === "number" ? info.related : 0.3 };
      return { state: "ready" };
    } catch (e) {
      return { state: "unavailable", reason: e instanceof Error ? e.message : String(e) };
    }
  }

  async embed(texts: readonly string[]): Promise<EmbeddingVector[]> {
    const r = await this.ready();
    if (r.state !== "ready" || !this.info) throw new EmbeddingProviderUnavailableError(this.id, r.state === "unavailable" ? r.reason : "not loaded");
    const out: (EmbeddingVector | undefined)[] = texts.map((t) => this.cache.get(t));
    let todo = [...new Set(texts.filter((_t, i) => !out[i]))];
    if (todo.length && this.store) {
      const kept = await this.store.getMany(this.info.embedder, todo);
      for (const [t, v] of kept) this.remember(t, dequantize(v));
      todo = todo.filter((t) => !kept.has(t));
    }
    for (let k = 0; k < todo.length; k += BATCH) {
      const batch = todo.slice(k, k + BATCH);
      const res = await this.fetcher(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ texts: batch }) });
      if (!res.ok) throw new EmbeddingProviderUnavailableError(this.id, `the embedding route answered ${res.status}`);
      const reply = (await res.json()) as { embedder: string; vectors: { q: string; scale: number }[] };
      if (reply.embedder !== this.info.embedder || reply.vectors?.length !== batch.length) throw new EmbeddingProviderUnavailableError(this.id, "the server's embedder changed; reload to re-embed");
      const fresh: [string, QuantizedVector][] = reply.vectors.map((v, i) => [batch[i]!, { embedder: reply.embedder, q: fromBase64(v.q), scale: v.scale }]);
      for (const [t, q] of fresh) this.remember(t, dequantize(q));
      if (this.store) void this.store.putMany(reply.embedder, fresh);
    }
    return texts.map((t, i) => out[i] ?? this.cache.get(t)!);
  }

  private remember(text: string, v: EmbeddingVector): void {
    if (this.cache.size >= CACHE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(text, v);
  }
}

let shared: (EmbeddingProvider & { active(): EmbeddingProvider }) | null = null;

/**
 * The embedder semantic placement uses: the local model through the route when the build offers it (and the route
 * answers), else the hashed embedder. `isModel` says which one is active after `ready()`.
 */
export function semanticEmbedder(): EmbeddingProvider & { active(): EmbeddingProvider } {
  if (!isSemanticPlacementUiEnabled()) return withFallback(hashedProvider, hashedProvider);
  return (shared ??= withFallback(new RouteEmbeddingProvider(undefined, undefined, indexedDbVectorStore()), hashedProvider));
}

/** Whether `provider` (after `ready()`) is a real model, not the hashed fallback. Descent with hashed vectors routes worse than today's router (§13.13). */
export function isModel(provider: EmbeddingProvider & { active(): EmbeddingProvider }): boolean {
  return provider.active().id !== hashedProvider.id;
}

/** Test seam. */
export function resetSemanticEmbedder(): void {
  shared = null;
}
