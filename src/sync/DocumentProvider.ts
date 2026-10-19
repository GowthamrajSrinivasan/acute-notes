/**
 * Yjs document lifecycle over a local update log (F14).
 *
 * - `load()` replays persisted updates, then compacts the log when it grows.
 * - Local changes are buffered, merged and appended asynchronously; callers
 *   never await persistence on an interaction path.
 * - A `SyncProvider` receives every local update (no-op in the MVP).
 *
 * All documents share one IndexedDB database via `YUpdateStore` rather than
 * `y-indexeddb`, which would open one database per document.
 */
import * as Y from "yjs";
import type { YUpdateStore } from "@/persistence/repositories/types";
import { localOnlySync, type SyncProvider } from "./SyncProvider";

/** Transaction origin for updates replayed from local storage. */
export const PERSISTENCE_ORIGIN = Symbol("acute:persistence");
/** Transaction origin for updates received from a SyncProvider. */
export const REMOTE_ORIGIN = Symbol("acute:remote");
/** Default transaction origin for local user/app edits. */
export const LOCAL_ORIGIN = Symbol("acute:local");

export type ProviderState = "saved" | "saving" | "error";

export interface DocumentProviderOptions {
  sync?: SyncProvider;
  /** Delay before buffered updates are written (ms). */
  flushDelay?: number;
  /** Compact the update log when it holds more than this many entries. */
  compactThreshold?: number;
  onStateChange?: (state: ProviderState) => void;
}

export class DocumentProvider {
  readonly doc = new Y.Doc();
  private pending: Uint8Array[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private disposed = false;
  private loaded = false;
  private unsubscribeRemote: (() => void) | null = null;
  private readonly disposeListeners = new Set<() => void>();
  private readonly sync: SyncProvider;
  private readonly flushDelay: number;
  private readonly compactThreshold: number;
  private readonly onStateChange?: (state: ProviderState) => void;

  constructor(
    readonly docId: string,
    private readonly store: YUpdateStore,
    options: DocumentProviderOptions = {},
  ) {
    this.sync = options.sync ?? localOnlySync;
    this.flushDelay = options.flushDelay ?? 200;
    this.compactThreshold = options.compactThreshold ?? 50;
    this.onStateChange = options.onStateChange;
    this.doc.on("update", this.handleUpdate);
  }

  get isLoaded(): boolean {
    return this.loaded;
  }

  async load(): Promise<void> {
    const { keys, updates } = await this.store.load(this.docId);
    if (this.disposed) return;
    if (updates.length) {
      Y.transact(this.doc, () => updates.forEach((u) => Y.applyUpdate(this.doc, u, PERSISTENCE_ORIGIN)), PERSISTENCE_ORIGIN);
    }
    this.loaded = true;

    this.unsubscribeRemote = this.sync.onUpdate((docId, update) => {
      if (docId === this.docId && !this.disposed) Y.applyUpdate(this.doc, update, REMOTE_ORIGIN);
    });
    await this.sync.connect(this.docId);

    if (keys.length > this.compactThreshold) {
      // Replace exactly the loaded entries with one merged snapshot.
      await this.store.compact(this.docId, keys, Y.encodeStateAsUpdate(this.doc));
    }
  }

  /** Runs a local change in one Yjs transaction. */
  applyLocalChange(fn: (doc: Y.Doc) => void, origin: unknown = LOCAL_ORIGIN): void {
    this.doc.transact(() => fn(this.doc), origin);
  }

  subscribe(callback: (update: Uint8Array, origin: unknown) => void): () => void {
    this.doc.on("update", callback);
    return () => this.doc.off("update", callback);
  }

  /** Writes buffered updates now. Safe to call repeatedly (e.g. on pagehide). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending.length) return this.writing;
    const batch = this.pending;
    this.pending = [];
    const merged = batch.length === 1 ? batch[0]! : Y.mergeUpdates(batch);
    this.onStateChange?.("saving");
    this.writing = this.writing
      .then(() => this.store.append(this.docId, merged))
      .then(
        () => {
          if (!this.pending.length) this.onStateChange?.("saved");
        },
        (err: unknown) => {
          console.error(`[acute-notes] Failed to persist ${this.docId}`, err);
          // Keep the data: re-queue so the next flush retries it.
          this.pending.unshift(merged);
          this.onStateChange?.("error");
        },
      );
    return this.writing;
  }

  /** Runs before the Y.Doc is destroyed (e.g. to drop an undo manager bound to it). */
  onDispose(listener: () => void): () => void {
    this.disposeListeners.add(listener);
    return () => this.disposeListeners.delete(listener);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.flush();
    for (const l of this.disposeListeners) l();
    this.disposeListeners.clear();
    this.unsubscribeRemote?.();
    await this.sync.disconnect(this.docId);
    this.doc.off("update", this.handleUpdate);
    this.doc.destroy();
  }

  private handleUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === PERSISTENCE_ORIGIN) return;
    if (origin !== REMOTE_ORIGIN) this.sync.sendUpdate(this.docId, update);
    this.pending.push(update);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.flushDelay);
  };
}
