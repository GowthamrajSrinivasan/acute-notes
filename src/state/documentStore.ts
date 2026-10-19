/**
 * In-memory cache of document records (block/page metadata + preview
 * snapshots) over `DocumentRepository`.
 *
 * Previews subscribe per document id, so a snapshot change re-renders exactly
 * one preview. Lists (the page sidebar) subscribe per kind and are notified
 * only when a record of that kind changes. Snapshot writes are debounced per
 * document and never awaited by the editor.
 */
import type { DocumentRecord, RichContent } from "@/domain/types";
import type { DocumentRepository } from "@/persistence";

const WRITE_DELAY_MS = 400;

type Kind = DocumentRecord["kind"];

export class DocumentStore {
  private readonly records = new Map<string, DocumentRecord | null>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly loading = new Map<string, Promise<void>>();
  private readonly dirty = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly kindListeners = new Map<Kind, Set<() => void>>();
  private readonly kindVersions = new Map<Kind, number>();
  private readonly listed = new Map<string, Promise<void>>();

  constructor(private readonly repo: DocumentRepository) {}

  /** Synchronous read: `undefined` = not loaded yet, `null` = missing. */
  get(id: string): DocumentRecord | null | undefined {
    return this.records.get(id);
  }

  load(id: string): Promise<void> {
    if (this.records.has(id)) return Promise.resolve();
    let p = this.loading.get(id);
    if (!p) {
      p = this.repo.get(id).then(
        (rec) => {
          this.loading.delete(id);
          if (!this.records.has(id)) this.setRecord(id, rec);
        },
        (err: unknown) => {
          this.loading.delete(id);
          console.error(`[acute-notes] Failed to load document ${id}`, err);
        },
      );
      this.loading.set(id, p);
    }
    return p;
  }

  subscribe(id: string, listener: () => void): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(listener);
    void this.load(id);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(id);
    };
  }

  /** Notified whenever any record of `kind` is added, changed or deleted. */
  subscribeKind(kind: Kind, listener: () => void): () => void {
    let set = this.kindListeners.get(kind);
    if (!set) this.kindListeners.set(kind, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) this.kindListeners.delete(kind);
    };
  }

  /** Changes on every notification for `kind` (a `useSyncExternalStore` snapshot). */
  kindVersion(kind: Kind): number {
    return this.kindVersions.get(kind) ?? 0;
  }

  /** Loads every record of one kind in a workspace into the cache (once). */
  loadKind(workspaceId: string, kind: Kind): Promise<void> {
    const key = `${workspaceId}\u0000${kind}`;
    let p = this.listed.get(key);
    if (!p) {
      p = this.repo.listByWorkspace(workspaceId, kind).then(
        (records) => {
          // Records already cached may hold newer, unsaved edits.
          for (const rec of records) {
            if (this.records.get(rec.id)) continue;
            this.records.set(rec.id, rec);
            const set = this.listeners.get(rec.id);
            if (set) for (const l of set) l();
          }
          this.emitKind(kind);
        },
        (err: unknown) => {
          this.listed.delete(key);
          console.error(`[acute-notes] Failed to list ${kind} documents`, err);
        },
      );
      this.listed.set(key, p);
    }
    return p;
  }

  /** Cached records of one kind in a workspace (see `loadKind`). */
  list(workspaceId: string, kind: Kind): DocumentRecord[] {
    const out: DocumentRecord[] = [];
    for (const rec of this.records.values()) {
      if (rec && rec.kind === kind && rec.workspaceId === workspaceId) out.push(rec);
    }
    return out;
  }

  /**
   * Caches records read elsewhere (e.g. while opening a canvas) so previews
   * render without one storage read each. Cached records are kept: they may
   * hold newer, unsaved edits.
   */
  prime(records: Iterable<DocumentRecord>): void {
    const kinds = new Set<Kind>();
    for (const rec of records) {
      if (this.records.get(rec.id)) continue;
      this.records.set(rec.id, rec);
      const set = this.listeners.get(rec.id);
      if (set) for (const l of set) l();
      kinds.add(rec.kind);
    }
    for (const kind of kinds) this.emitKind(kind);
  }

  /** Removes a record; subscribers see `null` (missing). */
  async delete(id: string): Promise<void> {
    const t = this.dirty.get(id);
    if (t) clearTimeout(t);
    this.dirty.delete(id);
    this.setRecord(id, null);
    await this.repo.delete(id);
  }

  /**
   * Re-reads records changed directly in storage (a canvas moved or deleted)
   * so cached copies and lists reflect them. Callers flush first.
   */
  async reload(ids: Iterable<string>): Promise<void> {
    await Promise.all(
      [...ids].map(async (id) => {
        if (!this.records.has(id) || this.dirty.has(id)) return;
        this.setRecord(id, await this.repo.get(id));
      }),
    );
  }

  /** Creates (or replaces) a record and persists it immediately. */
  put(record: DocumentRecord): Promise<void> {
    this.setRecord(record.id, record);
    return this.repo.put(record);
  }

  /** Updates cached fields and schedules a debounced write. */
  update(id: string, patch: Partial<Pick<DocumentRecord, "title" | "snapshot" | "metadata">>): void {
    const current = this.records.get(id);
    if (!current) return;
    this.setRecord(id, { ...current, ...patch, updatedAt: Date.now() });
    const pending = this.dirty.get(id);
    if (pending) clearTimeout(pending);
    this.dirty.set(id, setTimeout(() => void this.write(id), WRITE_DELAY_MS));
  }

  updateSnapshot(id: string, snapshot: RichContent, title?: string): void {
    this.update(id, title === undefined ? { snapshot } : { snapshot, title });
  }

  /** Writes all pending changes now (e.g. on pagehide). */
  async flush(): Promise<void> {
    await Promise.all([...this.dirty.keys()].map((id) => this.write(id)));
  }

  private async write(id: string): Promise<void> {
    const t = this.dirty.get(id);
    if (t) clearTimeout(t);
    this.dirty.delete(id);
    const rec = this.records.get(id);
    if (rec) await this.repo.put(rec).catch((err: unknown) => console.error(`[acute-notes] Failed to save ${id}`, err));
  }

  private setRecord(id: string, rec: DocumentRecord | null): void {
    const previous = this.records.get(id);
    this.records.set(id, rec);
    const set = this.listeners.get(id);
    if (set) for (const l of set) l();
    const kind = rec?.kind ?? previous?.kind;
    if (kind) this.emitKind(kind);
  }

  private emitKind(kind: Kind): void {
    this.kindVersions.set(kind, this.kindVersion(kind) + 1);
    const set = this.kindListeners.get(kind);
    if (set) for (const l of set) l();
  }
}
