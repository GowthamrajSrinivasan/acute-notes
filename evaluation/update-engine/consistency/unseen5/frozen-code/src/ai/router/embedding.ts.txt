/**
 * The embedding tier (intelligent-update-engine-plan Stage 2a): vectors for what the workspace index holds, behind the
 * index's own `SearchIndex` seam, so the context builder and every other consumer are untouched.
 *
 * - `Embedder` is the seam for a real embedding model. No provider offers embeddings today (`AICapabilities.embeddings`
 *   is false everywhere), so the default is `localEmbedder`: deterministic, local, no AI call or spend — hashed features
 *   of a text's significant words (stemmed), the pairs of words in order, and each word's letter trigrams (so "retry",
 *   "retries" and "retried" meet), in a sparse vector, L2-normalised. Cosine similarity is a dot product.
 * - `VectorTier` wraps a `WorkspaceIndex`: same queries, plus `nearest(text)`. It stays in step incrementally — a
 *   refresh re-embeds only objects whose title or text changed since it last saw them, and drops the ones that are gone.
 *
 * Sparse on purpose: 25,000 objects × a dense 1,024-float vector would be ~100 MB; a card's vector has a few hundred
 * non-zero entries.
 */
import { cyrb53 } from "@/ai/content/fingerprint";
import { significant } from "@/ai/fidelity/information";
import { stem } from "@/ai/fidelity/meaning";
import type { IndexKindFilter, IndexQuery, IndexResult, IndexedObject, RelationEdge, SearchIndex, WorkspaceIndex } from "@/search/workspaceIndex";

/** A sparse vector: sorted indices and their values, L2-normalised (empty for a text with no words). */
export interface SparseVector {
  idx: Int32Array;
  val: Float32Array;
}

/** Turns text into a vector. `id` names the model, so vectors from different embedders are never compared. */
export interface Embedder {
  readonly id: string;
  embed(text: string): SparseVector;
}

export const LOCAL_DIMS = 1 << 16;
const WEIGHTS = { word: 1, pair: 0.6, trigram: 0.25 } as const;

/** The default embedder (see module doc). */
export const localEmbedder: Embedder = {
  id: "local-hash-v1",
  embed(text: string): SparseVector {
    const stems = significant(text).map(stem).filter(Boolean);
    const counts = new Map<number, number>();
    const add = (feature: string, weight: number) => {
      const h = fnv1a(feature);
      const bucket = h & (LOCAL_DIMS - 1);
      // Signed hashing: collisions cancel out on average instead of piling up.
      const sign = h >>> 31 ? -1 : 1;
      counts.set(bucket, (counts.get(bucket) ?? 0) + sign * weight);
    };
    stems.forEach((s, i) => {
      add(`w:${s}`, WEIGHTS.word);
      if (i > 0) add(`p:${stems[i - 1]}_${s}`, WEIGHTS.pair);
      const padded = `^${s}$`;
      for (let k = 0; k + 3 <= padded.length; k++) add(`t:${padded.slice(k, k + 3)}`, WEIGHTS.trigram);
    });
    return sparse(counts);
  },
};

/** FNV-1a, 32-bit: a fast, stable feature hash. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Sublinear term weights, L2-normalised, sorted by index. */
function sparse(counts: ReadonlyMap<number, number>): SparseVector {
  const entries = [...counts].filter(([, v]) => v !== 0).sort((a, b) => a[0] - b[0]);
  const idx = new Int32Array(entries.length);
  const val = new Float32Array(entries.length);
  let norm = 0;
  entries.forEach(([i, v], k) => {
    const w = Math.sign(v) * (1 + Math.log(Math.abs(v) || 1));
    idx[k] = i;
    val[k] = w;
    norm += w * w;
  });
  norm = Math.sqrt(norm) || 1;
  for (let k = 0; k < val.length; k++) val[k]! /= norm;
  return { idx, val };
}

/** Cosine similarity of two normalised sparse vectors (0 when either is empty). */
export function cosine(a: SparseVector, b: SparseVector): number {
  let i = 0;
  let j = 0;
  let dot = 0;
  while (i < a.idx.length && j < b.idx.length) {
    const x = a.idx[i]!;
    const y = b.idx[j]!;
    if (x === y) dot += a.val[i++]! * b.val[j++]!;
    else if (x < y) i++;
    else j++;
  }
  return dot;
}

/** The average of several vectors, normalised (a section's centre from its cards). */
export function centroid(vectors: readonly SparseVector[]): SparseVector {
  const sum = new Map<number, number>();
  for (const v of vectors) for (let k = 0; k < v.idx.length; k++) sum.set(v.idx[k]!, (sum.get(v.idx[k]!) ?? 0) + v.val[k]!);
  const entries = [...sum].filter(([, x]) => x !== 0).sort((a, b) => a[0] - b[0]);
  const norm = Math.sqrt(entries.reduce((n, [, x]) => n + x * x, 0)) || 1;
  return { idx: Int32Array.from(entries.map(([i]) => i)), val: Float32Array.from(entries.map(([, x]) => x / norm)) };
}

/** What a vector is made from: an object's title and text. */
export const embeddedText = (o: Pick<IndexedObject, "title" | "text">) => (o.title && !o.text.startsWith(o.title) ? `${o.title}\n${o.text}` : o.text);

export interface NearestQuery {
  canvasId?: string;
  kinds?: readonly IndexKindFilter[];
  exclude?: ReadonlySet<string>;
  limit?: number;
  /** Leave out objects less similar than this (default 0: anything sharing a feature). */
  minScore?: number;
}

/** See module doc. */
export class VectorTier implements SearchIndex {
  private readonly vectors = new Map<string, { hash: string; vector: SparseVector }>();
  private seen = -1;
  /** Objects embedded in all, across refreshes (tests check the tier stays incremental). */
  embedded = 0;

  constructor(
    readonly base: WorkspaceIndex,
    readonly embedder: Embedder = localEmbedder,
  ) {}

  get workspaceId(): string {
    return this.base.workspaceId;
  }
  get size(): number {
    return this.base.size;
  }
  query(q: IndexQuery): IndexResult {
    return this.base.query(q);
  }
  get(id: string): IndexedObject | undefined {
    return this.base.get(id);
  }
  relations(canvasId?: string): readonly RelationEdge[] {
    return this.base.relations(canvasId);
  }
  frequency(term: string): number {
    return this.base.frequency(term);
  }

  /** Brings vectors in step with the index: only changed objects are embedded again. Returns how many were. */
  refresh(): number {
    if (this.seen === this.base.version) return 0;
    const live = new Set<string>();
    let count = 0;
    for (const o of this.base.objects()) {
      live.add(o.id);
      const hash = `${this.embedder.id}:${cyrb53(embeddedText(o))}`;
      if (this.vectors.get(o.id)?.hash === hash) continue;
      this.vectors.set(o.id, { hash, vector: this.embedder.embed(embeddedText(o)) });
      count++;
    }
    for (const id of this.vectors.keys()) if (!live.has(id)) this.vectors.delete(id);
    this.seen = this.base.version;
    this.embedded += count;
    return count;
  }

  vectorOf(id: string): SparseVector | undefined {
    this.refresh();
    return this.vectors.get(id)?.vector;
  }

  embed(text: string): SparseVector {
    return this.embedder.embed(text);
  }

  /** The indexed objects most similar to `text` (or to a vector), best first. */
  nearest(text: string | SparseVector, q: NearestQuery = {}): { id: string; score: number }[] {
    this.refresh();
    const v = typeof text === "string" ? this.embed(text) : text;
    const out: { id: string; score: number }[] = [];
    for (const o of this.base.objects({ ...(q.canvasId ? { canvasId: q.canvasId } : {}), ...(q.kinds ? { kinds: q.kinds } : {}) })) {
      if (q.exclude?.has(o.id)) continue;
      const vec = this.vectors.get(o.id)?.vector;
      const score = vec ? cosine(v, vec) : 0;
      if (score > (q.minScore ?? 0)) out.push({ id: o.id, score });
    }
    return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, q.limit ?? 20);
  }
}
