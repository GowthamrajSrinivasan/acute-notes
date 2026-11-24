/**
 * Semantic placement's vectors kept across page loads (intelligent-update-engine-plan §18 "not done", built 2026-11-24):
 * a canvas's items embed once per device, not once per page load.
 *
 * - **A cache, nothing else.** Its own small IndexedDB database (`acute-notes-embeddings`), not the app's: no migration of
 *   the main database, never in a workspace export or sync, safe to delete (the vectors are recomputed). Best-effort: any
 *   failure (no IndexedDB, quota, a private window) reads as a miss and writes are dropped.
 * - **Keyed by the embedder and a SHA-256 of the text** (`<embedder>|<hex>`): a different model never reads another's
 *   vectors, and the text itself is not stored — only its hash and its quantised vector (one byte per dimension).
 * - **Bounded:** at most `MAX_VECTORS`; past that, the oldest-written are removed.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { QuantizedVector } from "./embeddingProvider";

export const VECTOR_DB_NAME = "acute-notes-embeddings";
/** About 384 bytes each for MiniLM-L6: ~20 MB at most (provisional, 2026-11-24). */
export const MAX_VECTORS = 50_000;

/** What the route embedder needs from a persistent cache. */
export interface VectorStore {
  /** The stored vectors for these texts (a miss is simply absent). Never throws. */
  getMany(embedder: string, texts: readonly string[]): Promise<Map<string, QuantizedVector>>;
  /** Stores vectors; fire and forget. Never throws. */
  putMany(embedder: string, entries: readonly (readonly [string, QuantizedVector])[]): Promise<void>;
}

interface StoredVector {
  key: string;
  q: Int8Array;
  scale: number;
  at: number;
}
interface VectorDB extends DBSchema {
  vectors: { key: string; value: StoredVector; indexes: { byAt: number } };
}

async function keyOf(embedder: string, text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `${embedder}|${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The IndexedDB vector store, or null where there is no IndexedDB (the server, a test without it). */
export function indexedDbVectorStore(options: { name?: string; max?: number; now?: () => number } = {}): VectorStore | null {
  if (typeof indexedDB === "undefined" || typeof crypto === "undefined" || !crypto.subtle) return null;
  const max = options.max ?? MAX_VECTORS;
  const now = options.now ?? Date.now;
  let db: Promise<IDBPDatabase<VectorDB> | null> | null = null;
  const open = () =>
    (db ??= openDB<VectorDB>(options.name ?? VECTOR_DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore("vectors", { keyPath: "key" }).createIndex("byAt", "at");
      },
    }).catch(() => null));

  return {
    async getMany(embedder, texts) {
      const out = new Map<string, QuantizedVector>();
      try {
        const d = await open();
        if (!d || !texts.length) return out;
        const keys = await Promise.all(texts.map((t) => keyOf(embedder, t)));
        const tx = d.transaction("vectors", "readonly");
        const rows = await Promise.all(keys.map((k) => tx.store.get(k)));
        await tx.done;
        rows.forEach((row, i) => {
          if (row && row.q instanceof Int8Array && typeof row.scale === "number") out.set(texts[i]!, { embedder, q: row.q, scale: row.scale });
        });
      } catch {
        /* a miss */
      }
      return out;
    },

    async putMany(embedder, entries) {
      try {
        const d = await open();
        if (!d || !entries.length) return;
        const rows = await Promise.all(entries.map(async ([t, v]) => ({ key: await keyOf(embedder, t), q: v.q, scale: v.scale, at: now() })));
        const tx = d.transaction("vectors", "readwrite");
        await Promise.all(rows.map((r) => tx.store.put(r)));
        const count = await tx.store.count();
        let over = count - max;
        if (over > 0) {
          for (let cursor = await tx.store.index("byAt").openCursor(); cursor && over > 0; cursor = await cursor.continue()) {
            await cursor.delete();
            over--;
          }
        }
        await tx.done;
      } catch {
        /* dropped: it's a cache */
      }
    },
  };
}
