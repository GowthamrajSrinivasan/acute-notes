/**
 * The index invariant, made explicit (intelligent-update-engine-plan Stage 4b, refinement A): the live index reflects the
 * latest committed canvas state — accepted changes, manual edits, deletions, undo and redo — or it says it doesn't.
 *
 * Per canvas, one of:
 * - `fresh` — last verified against the scene and in sync;
 * - `stale` — a plan or work unit failed, or verification found objects out of date; a rebuild is scheduled;
 * - `rebuilding` — the canvas's index is being rebuilt from the scene (the source of truth);
 * - `failed` — `MAX_REBUILDS` rebuilds in a row didn't bring it in sync; it stays so, visibly, until Retry.
 * Nothing that needs the index current (the consistency check, Stage 4d) runs unless it is `fresh` (`whenFresh`).
 *
 * Pure: the index work, the clock and the timers are injected (`liveIndex.ts` wires the browser's).
 */

export type IndexState =
  | { state: "fresh"; verifiedAt: number }
  | { state: "stale" | "rebuilding" | "failed"; reason: string; since: number; attempts: number };

export interface IndexHealthDeps {
  /** Rebuilds one canvas's index from its scene now; throws when it can't. */
  rebuild(canvasId: string): void;
  /** Objects out of date for one canvas (`WorkspaceIndex.verifyScene`); null when the canvas isn't indexed here. */
  verify(canvasId: string): { stale: string[]; extra: string[] } | null;
  now(): number;
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

/** A canvas nothing has reported on: fresh (one shared object, so a UI store sees a stable snapshot). */
const UNCHECKED: IndexState = Object.freeze({ state: "fresh", verifiedAt: 0 });

/** Rebuilds tried in a row before the canvas is left `failed` (Retry starts again). */
export const MAX_REBUILDS = 3;
/** Wait before each rebuild attempt (first, second, third). */
export const REBUILD_BACKOFF_MS = [0, 1_000, 5_000] as const;

export class IndexHealth {
  private readonly states = new Map<string, IndexState>();
  private readonly timers = new Map<string, unknown>();
  private readonly listeners = new Set<() => void>();
  private readonly waiters = new Map<string, Set<(fresh: boolean) => void>>();
  /** A failure reported while that canvas's own rebuild runs: the rebuild counts as failed. */
  private readonly failedDuring = new Map<string, string>();
  private readonly rebuildingNow = new Set<string>();

  constructor(private readonly deps: IndexHealthDeps) {}

  status(canvasId: string): IndexState {
    return this.states.get(canvasId) ?? UNCHECKED;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A plan or work unit for `canvasId` failed: stale, and a rebuild is scheduled (unless one is running or it already failed). */
  markStale(canvasId: string, reason: string): void {
    if (this.rebuildingNow.has(canvasId)) {
      this.failedDuring.set(canvasId, reason);
      return;
    }
    const s = this.status(canvasId);
    if (s.state === "failed") return; // stays visibly failed until Retry
    const attempts = s.state === "fresh" ? 0 : s.attempts;
    this.set(canvasId, { state: "stale", reason, since: s.state === "fresh" ? this.deps.now() : s.since, attempts });
    this.schedule(canvasId);
  }

  /** Verifies a canvas against its scene (after a commit, before a check): stale when anything is out of date. */
  check(canvasId: string): IndexState {
    const s = this.status(canvasId);
    if (s.state !== "fresh") return s;
    const v = this.deps.verify(canvasId);
    if (v && (v.stale.length || v.extra.length)) this.markStale(canvasId, `${v.stale.length + v.extra.length} object(s) out of date`);
    else this.set(canvasId, { state: "fresh", verifiedAt: this.deps.now() });
    return this.status(canvasId);
  }

  /** The user's Retry: rebuild now, with a new count of attempts. */
  retry(canvasId: string): void {
    const s = this.status(canvasId);
    if (s.state === "fresh") return;
    this.set(canvasId, { ...s, state: "stale", attempts: 0 });
    this.cancel(canvasId);
    this.rebuildNow(canvasId);
  }

  /** Resolves true once the canvas is fresh, false if it fails or `timeoutMs` passes first. */
  whenFresh(canvasId: string, timeoutMs = 10_000): Promise<boolean> {
    const s = this.status(canvasId);
    if (s.state === "fresh") return Promise.resolve(true);
    if (s.state === "failed") return Promise.resolve(false);
    return new Promise((resolve) => {
      const set = this.waiters.get(canvasId) ?? new Set();
      this.waiters.set(canvasId, set);
      const done = (fresh: boolean) => {
        set.delete(done);
        this.deps.clearTimer(timer);
        resolve(fresh);
      };
      const timer = this.deps.setTimer(() => done(false), timeoutMs);
      set.add(done);
    });
  }

  /** Forgets a canvas (it was closed): no timers left behind. */
  forget(canvasId: string): void {
    this.cancel(canvasId);
    this.states.delete(canvasId);
    for (const w of [...(this.waiters.get(canvasId) ?? [])]) w(false);
    this.emit();
  }

  private schedule(canvasId: string): void {
    if (this.timers.has(canvasId)) return;
    const s = this.status(canvasId);
    const attempts = s.state === "fresh" ? 0 : s.attempts;
    const wait = REBUILD_BACKOFF_MS[Math.min(attempts, REBUILD_BACKOFF_MS.length - 1)]!;
    this.timers.set(
      canvasId,
      this.deps.setTimer(() => {
        this.timers.delete(canvasId);
        this.rebuildNow(canvasId);
      }, wait),
    );
  }

  private rebuildNow(canvasId: string): void {
    const before = this.status(canvasId);
    if (before.state === "fresh") return;
    const attempts = before.attempts + 1;
    this.set(canvasId, { state: "rebuilding", reason: before.reason, since: before.since, attempts });
    this.rebuildingNow.add(canvasId);
    this.failedDuring.delete(canvasId);
    let failure: string | null = null;
    try {
      this.deps.rebuild(canvasId);
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      this.rebuildingNow.delete(canvasId);
    }
    failure ??= this.failedDuring.get(canvasId) ?? null;
    this.failedDuring.delete(canvasId);
    if (!failure) {
      const v = this.deps.verify(canvasId);
      if (v && (v.stale.length || v.extra.length)) failure = `${v.stale.length + v.extra.length} object(s) still out of date after rebuilding`;
    }
    if (!failure) {
      this.set(canvasId, { state: "fresh", verifiedAt: this.deps.now() });
      return;
    }
    if (attempts >= MAX_REBUILDS) {
      this.set(canvasId, { state: "failed", reason: failure, since: before.since, attempts });
      return;
    }
    this.set(canvasId, { state: "stale", reason: failure, since: before.since, attempts });
    this.schedule(canvasId);
  }

  private cancel(canvasId: string): void {
    const t = this.timers.get(canvasId);
    if (t !== undefined) this.deps.clearTimer(t);
    this.timers.delete(canvasId);
  }

  private set(canvasId: string, next: IndexState): void {
    this.states.set(canvasId, next);
    if (next.state === "fresh" || next.state === "failed") for (const w of [...(this.waiters.get(canvasId) ?? [])]) w(next.state === "fresh");
    this.emit();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
