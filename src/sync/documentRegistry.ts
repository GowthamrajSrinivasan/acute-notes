/**
 * Ref-counted registry of open `DocumentProvider`s.
 *
 * Every view of a document (a canvas block editor, later a page editor) shares
 * one provider and one Y.Doc, so one-time initialisation such as seeding a new
 * document from its template runs exactly once — even under React strict mode
 * double mounts. Released documents are disposed after a short grace period so
 * an immediate re-acquire reuses the loaded state.
 */
import type { DocumentProvider } from "./DocumentProvider";

interface Entry {
  promise: Promise<DocumentProvider>;
  refs: number;
  disposeTimer: ReturnType<typeof setTimeout> | null;
}

export interface DocumentLease {
  provider: Promise<DocumentProvider>;
  release(): void;
}

export class DocumentRegistry {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly graceMs = 1500) {}

  acquire(key: string, open: () => Promise<DocumentProvider>): DocumentLease {
    let entry = this.entries.get(key);
    if (!entry) {
      const promise = open();
      entry = { promise, refs: 0, disposeTimer: null };
      this.entries.set(key, entry);
      promise.catch(() => this.entries.delete(key));
    }
    if (entry.disposeTimer) {
      clearTimeout(entry.disposeTimer);
      entry.disposeTimer = null;
    }
    entry.refs++;
    const current = entry;
    let released = false;
    return {
      provider: current.promise,
      release: () => {
        if (released) return;
        released = true;
        current.refs--;
        if (current.refs > 0) return;
        current.disposeTimer = setTimeout(() => {
          if (this.entries.get(key) !== current || current.refs > 0) return;
          this.entries.delete(key);
          void current.promise.then((p) => p.dispose(), () => undefined);
        }, this.graceMs);
      },
    };
  }

  /** The open provider for `key`, if any view (or its grace period) holds it. */
  peek(key: string): Promise<DocumentProvider> | undefined {
    return this.entries.get(key)?.promise;
  }

  /** Starts writing buffered updates of every open document (e.g. on pagehide). */
  flushAll(): Promise<void> {
    return Promise.all(
      [...this.entries.values()].map((e) => e.promise.then((p) => p.flush(), () => undefined)),
    ).then(() => undefined);
  }

  /** Number of currently registered documents (for tests/diagnostics). */
  get size(): number {
    return this.entries.size;
  }
}

export const documentRegistry = new DocumentRegistry();
