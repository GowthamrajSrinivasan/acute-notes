/**
 * Stage 5a (intelligent-update-engine-plan §13.2): the provider-neutral embedding seam.
 *
 * The seam is the deliverable; each embedder is one implementation of `EmbeddingProvider`:
 * - `hashedProvider` — the Stage 2a hashed embedder (`embedding.ts`, unchanged and frozen for the third unseen set),
 *   adapted to this interface. Always available; the fallback.
 * - `LocalModelProvider` (`localModelEmbedding.ts`) — a small sentence-embedding model run on the device. Wired for
 *   semantic placement behind a switch (§18: the app's own server runs it, `serverEmbedding.ts`; the browser reaches it
 *   through `routeEmbedding.ts`). Not the default anywhere else: the router and the consistency screen keep the hashed one.
 * - a provider embeddings API, if ever needed — a third implementation with `kind: "remote"`, passed in through
 *   `EmbeddingFactoryDeps.remote`. Not built: it also needs the AI-spend guards, the user's opt-in (text leaves the
 *   device) and the "AI off" switch (§13.2).
 *
 * Rules that keep the implementations swappable:
 * - callers get a provider from `createEmbeddingProvider(config)` and never import a concrete embedder;
 * - every vector carries the id of the embedder that made it, and `similarity` refuses to compare two embedders;
 * - callers see only vectors and `similarity` — dense or sparse is hidden;
 * - similarity thresholds belong to the embedder (`thresholds`), never to the caller: a cosine of 0.2 means different
 *   things for two models.
 */
import { isAIFeatureEnabled } from "@/config/features";
import { cosine as sparseCosine, localEmbedder, LOCAL_DIMS, type SparseVector } from "./embedding";
import { LOCAL_MODELS, LocalModelProvider, type LocalModelKey, type LocalModelSource } from "./localModelEmbedding";

/** Where vectors are computed. "remote" means text leaves the device and the call counts as AI spend. */
export type EmbeddingKind = "local" | "remote";

/** A vector, tagged with the embedder that made it. Exactly one of `dense` / `sparse` is set; both are L2-normalised. */
export interface EmbeddingVector {
  readonly embedder: string;
  readonly dense?: Float32Array;
  readonly sparse?: SparseVector;
}

/** Per-embedder thresholds (provisional until calibrated against the locate evaluation set, §13.6). */
export interface EmbeddingThresholds {
  /** At or above this, two texts are about the same thing (recall-first: only the clearly unrelated fall below). */
  readonly related: number;
}

export type EmbeddingReadiness = { state: "ready" } | { state: "unavailable"; reason: string };

/** See module doc. */
export interface EmbeddingProvider {
  /** Stable name, part of every vector it makes: "local-hash-v1", "local-minilm-l6-q8-v1", "remote-<name>-<model>". */
  readonly id: string;
  readonly dims: number;
  readonly kind: EmbeddingKind;
  readonly thresholds: EmbeddingThresholds;
  /** Loads whatever the embedder needs. Never throws; "unavailable" says why. Safe to call repeatedly. */
  ready(): Promise<EmbeddingReadiness>;
  /** One vector per text, in order. Batched by the implementation. Throws `EmbeddingProviderUnavailableError` if not ready. */
  embed(texts: readonly string[]): Promise<EmbeddingVector[]>;
}

export class EmbedderMismatchError extends Error {
  constructor(
    readonly a: string,
    readonly b: string,
  ) {
    super(`Vectors from different embedders can't be compared: ${a} vs ${b}`);
    this.name = "EmbedderMismatchError";
  }
}

export class EmbeddingProviderUnavailableError extends Error {
  constructor(
    readonly embedder: string,
    readonly reason: string,
  ) {
    super(`Embedder ${embedder} is unavailable: ${reason}`);
    this.name = "EmbeddingProviderUnavailableError";
  }
}

/** Cosine similarity of two normalised vectors from the same embedder. */
export function similarity(a: EmbeddingVector, b: EmbeddingVector): number {
  if (a.embedder !== b.embedder) throw new EmbedderMismatchError(a.embedder, b.embedder);
  if (a.dense && b.dense) return dot(a.dense, b.dense);
  if (a.sparse && b.sparse) return sparseCosine(a.sparse, b.sparse);
  throw new Error(`Malformed vectors from ${a.embedder}: one dense, one sparse`);
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

// ── Storage form ──────────────────────────────────────────────────────────────────────────────────────────────────

/** A dense vector stored at one byte per dimension (§13.2): 384 dims = 384 bytes instead of 1,536. */
export interface QuantizedVector {
  readonly embedder: string;
  readonly q: Int8Array;
  readonly scale: number;
}

export function quantize(v: EmbeddingVector): QuantizedVector {
  if (!v.dense) throw new Error(`Only dense vectors are quantised (${v.embedder} is sparse)`);
  let max = 0;
  for (const x of v.dense) max = Math.max(max, Math.abs(x));
  const scale = max / 127 || 1;
  const q = new Int8Array(v.dense.length);
  for (let i = 0; i < q.length; i++) q[i] = Math.round(v.dense[i]! / scale);
  return { embedder: v.embedder, q, scale };
}

export function dequantize(v: QuantizedVector): EmbeddingVector {
  const d = new Float32Array(v.q.length);
  let norm = 0;
  for (let i = 0; i < d.length; i++) {
    d[i] = v.q[i]! * v.scale;
    norm += d[i]! * d[i]!;
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < d.length; i++) d[i]! /= norm;
  return { embedder: v.embedder, dense: d };
}

// ── Implementations ───────────────────────────────────────────────────────────────────────────────────────────────

/** The Stage 2a hashed embedder on this interface. `related` = the consistency screen's relatedness line (§12.21). */
export const hashedProvider: EmbeddingProvider = {
  id: localEmbedder.id,
  dims: LOCAL_DIMS,
  kind: "local",
  thresholds: { related: 0.2 },
  ready: async () => ({ state: "ready" }),
  embed: async (texts) => texts.map((t) => ({ embedder: localEmbedder.id, sparse: localEmbedder.embed(t) })),
};

/**
 * Uses `primary` when it is ready, else `fallback`. `id` and `thresholds` follow whichever is active, and each vector
 * carries its own embedder id, so a switch is visible to the index (which then re-embeds) and never mixes vectors.
 */
export function withFallback(primary: EmbeddingProvider, fallback: EmbeddingProvider): EmbeddingProvider & { active(): EmbeddingProvider } {
  let active: EmbeddingProvider | undefined;
  let choosing: Promise<EmbeddingProvider> | undefined;
  const choose = () =>
    (choosing ??= primary.ready().then(async (r) => {
      active = r.state === "ready" ? primary : fallback;
      if (active === fallback) await fallback.ready();
      return active;
    }));
  return {
    get id() {
      return (active ?? primary).id;
    },
    get dims() {
      return (active ?? primary).dims;
    },
    get kind() {
      return (active ?? primary).kind;
    },
    get thresholds() {
      return (active ?? primary).thresholds;
    },
    active: () => active ?? primary,
    ready: async () => (await choose()).ready(),
    embed: async (texts) => (await choose()).embed(texts),
  };
}

// ── Configuration and the factory ─────────────────────────────────────────────────────────────────────────────────

export type EmbeddingConfig =
  | { provider: "hashed" }
  | { provider: "local-model"; model: LocalModelKey; source?: LocalModelSource }
  | { provider: "remote"; name: string; model: string };

/** What the factory can't build by itself. `remote` is how a provider embeddings API is plugged in later. */
export interface EmbeddingFactoryDeps {
  remote?: (config: Extract<EmbeddingConfig, { provider: "remote" }>) => EmbeddingProvider;
}

/** The default while Stage 5a is a spike: the hashed embedder, so nothing changes until the model passes its gate. */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = { provider: "hashed" };

/**
 * Reads a configuration string: "hashed" | "local-model:<model key>" | "remote:<name>:<model>". Anything else, or
 * nothing, gives the default. (For an env value such as NEXT_PUBLIC_EMBEDDINGS once wired.)
 */
export function embeddingConfigFrom(value: string | undefined): EmbeddingConfig {
  // `mode`, not `provider`: this branches on a configuration string, never on a vendor (noVendorLeak.test.ts).
  const [mode, a, b] = (value ?? "").trim().split(":");
  if (mode === "hashed") return { provider: "hashed" };
  if (mode === "local-model" && a && a in LOCAL_MODELS) return { provider: "local-model", model: a as LocalModelKey };
  if (mode === "remote" && a && b) return { provider: "remote", name: a, model: b };
  return DEFAULT_EMBEDDING_CONFIG;
}

/**
 * The only place a concrete embedder is chosen. A local model always falls back to the hashed embedder when it can't
 * load (no weights, no runtime), so routing never stops working.
 *
 * **With the build's AI feature off, only the hashed embedder runs** (review 2026-11-14, plan §13.12): no local model
 * inference and no model download, whatever the configuration says, until the flag's meaning is split into
 * deterministic search / local semantic search / hosted AI. The flag itself is unchanged.
 */
export function createEmbeddingProvider(config: EmbeddingConfig = DEFAULT_EMBEDDING_CONFIG, deps: EmbeddingFactoryDeps = {}): EmbeddingProvider {
  if (config.provider !== "hashed" && !isAIFeatureEnabled()) return hashedProvider;
  switch (config.provider) {
    case "hashed":
      return hashedProvider;
    case "local-model":
      return withFallback(new LocalModelProvider(config.model, config.source), hashedProvider);
    case "remote":
      if (!deps.remote) throw new EmbeddingProviderUnavailableError(`remote-${config.name}-${config.model}`, "remote embeddings are not built (plan §13.2)");
      return deps.remote(config);
  }
}
