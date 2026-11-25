/**
 * Stage 5a (intelligent-update-engine-plan §13.2): a small sentence-embedding model run on the device, through
 * transformers.js and the ONNX runtime. One implementation of `EmbeddingProvider` (`embeddingProvider.ts`).
 *
 * - **No network unless allowed.** `allowDownload` is false by default: weights come from `localModelPath` (bundled)
 *   or `cacheDir` (downloaded earlier). The spike turns downloads on explicitly.
 * - **The library loads on first use** (`ready()` / `embed()`), by dynamic import, so merely importing this file costs
 *   nothing and pulls no runtime into a bundle's main chunk.
 * - Weights are the 8-bit quantised ONNX export (`dtype: "q8"`). Vectors are mean- or CLS-pooled per the model card
 *   and L2-normalised, so similarity is a dot product.
 * - Not yet in a worker: the spike measures in Node. Wiring (§13.7 step 4) runs it off the UI thread.
 *
 * transformers.js keeps its settings (`env`) globally; the last provider to load sets them. Fine while one model is
 * configured at a time, which the factory guarantees.
 */
import type { EmbeddingProvider, EmbeddingReadiness, EmbeddingThresholds, EmbeddingVector } from "./embeddingProvider";

export interface LocalModelSpec {
  /** Hugging Face repository of the ONNX export. */
  readonly hub: string;
  readonly dims: number;
  readonly pooling: "mean" | "cls";
  /** Prepended to every text (e5 expects "query: " for symmetric similarity). */
  readonly prefix: string;
  readonly languages: "en" | "multilingual";
  /** Size of the q8 weights file, bytes (checked 2026-11-14), before tokenizer and config files. */
  readonly weightBytes: number;
  /** Provisional, from the 5a spike (§13.9) — recalibrated on the locate evaluation set (§13.6). */
  readonly thresholds: EmbeddingThresholds;
}

/**
 * The spike's candidates (§13.2, results §13.9). Keys are stable; they become part of the embedder id.
 *
 * `thresholds.related` was checked in the spike for **minilm-l6 only** (0.3: 95 % of blind paraphrases pass, 0 % of
 * unrelated pairs). The others score unrelated text high (arctic-xs 0.69, e5 0.79, bge 0.44 on average), so 0.3 lets
 * everything through: calibrate before using any of them.
 *
 * `thresholds.claim` (impact discovery, #14) was set for **minilm-l6 only**, on hand-written sentence pairs, and checked once
 * on a set written before that run (plan §19.6; `impactMeaning.model.test.ts`). The others have none, so impact discovery
 * stays lexical with them.
 */
export const LOCAL_MODELS = {
  "minilm-l6": { hub: "Xenova/all-MiniLM-L6-v2", dims: 384, pooling: "mean", prefix: "", languages: "en", weightBytes: 22_972_370, thresholds: { related: 0.3, claim: { same: 0.6, other: 0.55 } } },
  "arctic-xs": { hub: "Snowflake/snowflake-arctic-embed-xs", dims: 384, pooling: "cls", prefix: "", languages: "en", weightBytes: 22_972_992, thresholds: { related: 0.3 } },
  "bge-small-en": { hub: "Xenova/bge-small-en-v1.5", dims: 384, pooling: "cls", prefix: "", languages: "en", weightBytes: 34_014_426, thresholds: { related: 0.3 } },
  "e5-small-multi": { hub: "Xenova/multilingual-e5-small", dims: 384, pooling: "mean", prefix: "query: ", languages: "multilingual", weightBytes: 118_308_185, thresholds: { related: 0.3 } },
  "minilm-l12-multi": { hub: "Xenova/paraphrase-multilingual-MiniLM-L12-v2", dims: 384, pooling: "mean", prefix: "", languages: "multilingual", weightBytes: 118_308_126, thresholds: { related: 0.3 } },
} as const satisfies Record<string, LocalModelSpec>;

export type LocalModelKey = keyof typeof LOCAL_MODELS;

/** Where the weights come from. */
export interface LocalModelSource {
  /** Directory of bundled models (`<path>/<hub repo>/…`). */
  localModelPath?: string;
  /** Directory downloaded weights are kept in. */
  cacheDir?: string;
  /** Allow fetching weights from the Hugging Face hub. Default false: no network. */
  allowDownload?: boolean;
}

type Extractor = (texts: string[], options: { pooling: "mean" | "cls"; normalize: boolean }) => Promise<{ data: ArrayLike<number>; dims: readonly number[] }>;

/** See module doc. */
export class LocalModelProvider implements EmbeddingProvider {
  readonly kind = "local" as const;
  readonly id: string;
  readonly dims: number;
  readonly thresholds: EmbeddingThresholds;
  readonly spec: LocalModelSpec;
  private loading?: Promise<EmbeddingReadiness>;
  private extractor?: Extractor;

  constructor(
    readonly model: LocalModelKey,
    private readonly source: LocalModelSource = {},
    readonly batchSize = 32,
  ) {
    this.spec = LOCAL_MODELS[model];
    this.id = `local-${model}-q8-v1`;
    this.dims = this.spec.dims;
    this.thresholds = this.spec.thresholds;
  }

  ready(): Promise<EmbeddingReadiness> {
    return (this.loading ??= this.load());
  }

  private async load(): Promise<EmbeddingReadiness> {
    try {
      const t = await import("@huggingface/transformers");
      // The download cache has the same layout as a bundled-model folder (`<dir>/<hub repo>/…`), so offline the cache
      // is read as the local model folder. transformers.js refuses to start with both local and remote loading off.
      const offline = this.source.localModelPath ?? this.source.cacheDir;
      t.env.allowRemoteModels = this.source.allowDownload ?? false;
      t.env.allowLocalModels = Boolean(offline);
      if (offline) t.env.localModelPath = offline;
      if (this.source.cacheDir) t.env.cacheDir = this.source.cacheDir;
      const pipe = await t.pipeline("feature-extraction", this.spec.hub, { dtype: "q8" });
      this.extractor = (texts, options) => pipe(texts, options) as unknown as ReturnType<Extractor>;
      return { state: "ready" };
    } catch (e) {
      return { state: "unavailable", reason: e instanceof Error ? e.message : String(e) };
    }
  }

  async embed(texts: readonly string[]): Promise<EmbeddingVector[]> {
    const r = await this.ready();
    if (r.state !== "ready" || !this.extractor) {
      const { EmbeddingProviderUnavailableError } = await import("./embeddingProvider");
      throw new EmbeddingProviderUnavailableError(this.id, r.state === "unavailable" ? r.reason : "not loaded");
    }
    const out: EmbeddingVector[] = new Array(texts.length);
    // Blank texts get a zero vector without a model call (similarity 0 with everything).
    const todo = texts.map((t, i) => [i, t.trim()] as const).filter(([, t]) => t.length > 0);
    texts.forEach((t, i) => {
      if (!t.trim()) out[i] = { embedder: this.id, dense: new Float32Array(this.dims) };
    });
    for (let k = 0; k < todo.length; k += this.batchSize) {
      const batch = todo.slice(k, k + this.batchSize);
      const tensor = await this.extractor(
        batch.map(([, t]) => this.spec.prefix + t),
        { pooling: this.spec.pooling, normalize: true },
      );
      const data = Float32Array.from(tensor.data);
      batch.forEach(([i], j) => {
        out[i] = { embedder: this.id, dense: data.slice(j * this.dims, (j + 1) * this.dims) };
      });
    }
    return out;
  }
}
