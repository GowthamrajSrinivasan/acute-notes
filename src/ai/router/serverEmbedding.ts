/**
 * Stage 5a wiring (intelligent-update-engine-plan §18): the local sentence-embedding model, run by the app's own Node
 * server (`/api/ai/embed`) — the process the 5a spike measured — for the browser's `RouteEmbeddingProvider`.
 *
 * - **Server only.** Imported by the route handler alone; transformers.js and the ONNX runtime are on Next's built-in
 *   server-external list, so they load with Node's own `require`, never into a client bundle.
 * - **One model, loaded once per server process**, from `ACUTE_EMBEDDINGS` (`local-model:<key>`, `LOCAL_MODELS`).
 * - **No network unless allowed.** Weights are read from `ACUTE_EMBEDDING_MODELS_DIR` (default: the spike's cache,
 *   `node_modules/.cache/acute-embedding-models`). `ACUTE_EMBEDDINGS_DOWNLOAD=on` lets the first use fetch them from the
 *   model hub (weights only; no user text leaves the machine). The desktop build is to ship them instead (pending).
 * - **Never answers with another embedder's vectors.** The factory falls back to the hashed embedder when the model can't
 *   load; the route then reports "unavailable", and the browser uses its own hashed embedder (and today's router).
 * - Vectors go over the wire quantised (one byte per dimension, `quantize`), base64.
 */
import path from "node:path";
import { createEmbeddingProvider, embeddingConfigFrom, hashedProvider, quantize, type ClaimThresholds, type EmbeddingProvider } from "./embeddingProvider";

/** What one request may carry: the dialog embeds a note, its sections and the canvas's changed items. */
export const EMBED_LIMITS = { texts: 512, charsPerText: 2_000, totalChars: 400_000 } as const;

export interface EmbedInfo {
  embedder: string;
  dims: number;
  related: number;
  /** The embedder's same-claim thresholds (impact discovery, #14), when it has them. */
  claim?: ClaimThresholds;
}

export interface EmbedReply extends EmbedInfo {
  /** One per text, in order: the quantised vector (base64 of its int8 bytes) and its scale. */
  vectors: { q: string; scale: number }[];
}

export type ServerEmbedding = { state: "ready"; info: EmbedInfo; embed(texts: readonly string[]): Promise<EmbedReply> } | { state: "unavailable"; reason: string };

let loaded: { key: string; provider: EmbeddingProvider } | null = null;

/** The configured model, loaded once (see module doc). Never throws. */
export async function serverEmbedding(env: NodeJS.ProcessEnv = process.env): Promise<ServerEmbedding> {
  const config = embeddingConfigFrom(env.ACUTE_EMBEDDINGS);
  if (config.provider !== "local-model") return { state: "unavailable", reason: "no local model is configured (ACUTE_EMBEDDINGS)" };
  const source = {
    cacheDir: env.ACUTE_EMBEDDING_MODELS_DIR || path.join(process.cwd(), "node_modules", ".cache", "acute-embedding-models"),
    allowDownload: env.ACUTE_EMBEDDINGS_DOWNLOAD === "on",
  };
  const key = `${config.model}|${source.cacheDir}|${source.allowDownload}`;
  if (loaded?.key !== key) loaded = { key, provider: createEmbeddingProvider({ ...config, source }) };
  const provider = loaded.provider;
  const ready = await provider.ready();
  // The factory's fallback is the hashed embedder: the browser has that one itself, so the route never serves it.
  if (ready.state !== "ready" || provider.id === hashedProvider.id) {
    const reason = ready.state === "unavailable" ? ready.reason : "the local model could not be loaded";
    loaded = null; // tried again on the next request (weights may have arrived)
    return { state: "unavailable", reason };
  }
  const info: EmbedInfo = { embedder: provider.id, dims: provider.dims, related: provider.thresholds.related, ...(provider.thresholds.claim ? { claim: provider.thresholds.claim } : {}) };
  return {
    state: "ready",
    info,
    async embed(texts) {
      const vs = await provider.embed(texts.map((t) => t.slice(0, EMBED_LIMITS.charsPerText)));
      return {
        ...info,
        vectors: vs.map((v) => {
          if (v.embedder !== info.embedder) throw new Error(`embedder changed mid-request (${v.embedder})`);
          const q = quantize(v);
          return { q: Buffer.from(q.q.buffer, q.q.byteOffset, q.q.byteLength).toString("base64"), scale: q.scale };
        }),
      };
    },
  };
}

/** Test seam: forget the loaded model. */
export function resetServerEmbedding(): void {
  loaded = null;
}
