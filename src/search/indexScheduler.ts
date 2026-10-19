/**
 * Keeps index work off the interaction path (F22, PRD §8.1): a change only
 * *marks* its source dirty — O(1), safe to call from a scene `onChange` that
 * fires on every pointer move. Work starts after the input has been quiet
 * for `quietMs` (so a drag, a pan or a typing burst is never interrupted),
 * then runs in idle time (`requestIdleCallback`, with a timer fallback) in
 * slices that stop as soon as the idle deadline or `sliceMs` is spent,
 * resuming in the next idle period.
 *
 * A source's plan is computed when its turn comes, from the state at that
 * moment, and a newer mark discards the older plan's queued units: work is
 * never done for a state that has already been superseded.
 *
 * `flush()` runs everything now — for an explicit user action (Ask AI) that
 * needs the index current, never for input handling.
 */
import type { WorkUnit } from "./workspaceIndex";

export interface IdleDeadlineLike {
  timeRemaining(): number;
  readonly didTimeout?: boolean;
}

export interface SchedulerHost {
  now(): number;
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  requestIdle(cb: (deadline: IdleDeadlineLike) => void, timeoutMs: number): unknown;
  cancelIdle(handle: unknown): void;
}

export interface SchedulerOptions {
  /** Input must be quiet this long before any work starts. */
  quietMs: number;
  /** Longest slice of work per idle callback (also bounds a timer-fallback slice). */
  sliceMs: number;
  /** Idle callbacks are forced after this long, so a busy page still catches up. */
  idleTimeoutMs: number;
}

export const DEFAULT_SCHEDULER_OPTIONS: SchedulerOptions = { quietMs: 300, sliceMs: 8, idleTimeoutMs: 2_000 };

/** Browser host: `requestIdleCallback` when available (not in Safari), else a short timer with a synthetic deadline. */
export function browserSchedulerHost(): SchedulerHost {
  const w = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: (d: IdleDeadlineLike) => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (h: number) => void;
  };
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  return {
    now,
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    requestIdle: (cb, timeoutMs) => {
      if (w.requestIdleCallback) return { idle: w.requestIdleCallback(cb, { timeout: timeoutMs }) };
      return {
        timer: setTimeout(() => {
          const start = now();
          cb({ timeRemaining: () => Math.max(0, 8 - (now() - start)) });
        }, 16),
      };
    },
    cancelIdle: (h) => {
      const handle = h as { idle?: number; timer?: ReturnType<typeof setTimeout> };
      if (handle.idle !== undefined) w.cancelIdleCallback?.(handle.idle);
      if (handle.timer !== undefined) clearTimeout(handle.timer);
    },
  };
}

type Plan = () => readonly WorkUnit[];

export class IndexScheduler {
  private readonly dirty = new Map<string, Plan>();
  private queue: { key: string; unit: WorkUnit }[] = [];
  private lastMark = -Infinity;
  private timer: unknown = null;
  private idle: unknown = null;
  private disposed = false;
  /** Work units run so far (observability for tests and the dev perf panel). */
  unitsRun = 0;

  constructor(
    private readonly host: SchedulerHost,
    private readonly options: SchedulerOptions = DEFAULT_SCHEDULER_OPTIONS,
  ) {}

  /** O(1): `key`'s input changed; `plan` is called later, in idle time, to compute the work. */
  markDirty(key: string, plan: Plan): void {
    if (this.disposed) return;
    this.dirty.set(key, plan);
    this.lastMark = this.host.now();
    if (this.timer === null && this.idle === null) this.timer = this.host.setTimer(this.onQuietCheck, this.options.quietMs);
  }

  /** Drops `key`'s pending mark and queued work (its source went away). */
  forget(key: string): void {
    this.dirty.delete(key);
    this.queue = this.queue.filter((q) => q.key !== key);
  }

  /** Whether any work is waiting. */
  get pending(): boolean {
    return this.dirty.size > 0 || this.queue.length > 0;
  }

  /** Runs all pending work now (explicit user actions only). */
  flush(): void {
    this.cancel();
    this.planDirty();
    const queue = this.queue;
    this.queue = [];
    for (const { unit } of queue) this.run(unit);
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.dirty.clear();
    this.queue = [];
  }

  private readonly onQuietCheck = () => {
    this.timer = null;
    const since = this.host.now() - this.lastMark;
    if (since < this.options.quietMs) {
      this.timer = this.host.setTimer(this.onQuietCheck, this.options.quietMs - since);
      return;
    }
    this.idle = this.host.requestIdle(this.onIdle, this.options.idleTimeoutMs);
  };

  private readonly onIdle = (deadline: IdleDeadlineLike) => {
    this.idle = null;
    if (this.disposed) return;
    // Input resumed since this was scheduled: wait for quiet again.
    if (this.host.now() - this.lastMark < this.options.quietMs && this.dirty.size) {
      this.timer = this.host.setTimer(this.onQuietCheck, this.options.quietMs);
      return;
    }
    const start = this.host.now();
    const hasTime = () => deadline.timeRemaining() > 1 && this.host.now() - start < this.options.sliceMs;
    this.planDirty();
    while (this.queue.length && hasTime()) this.run(this.queue.shift()!.unit);
    if (this.pending) this.idle = this.host.requestIdle(this.onIdle, this.options.idleTimeoutMs);
  };

  /** Turns dirty marks into queued units; a newer plan replaces the older one's leftovers. */
  private planDirty(): void {
    if (!this.dirty.size) return;
    const plans = [...this.dirty];
    this.dirty.clear();
    const replaced = new Set(plans.map(([key]) => key));
    this.queue = this.queue.filter((q) => !replaced.has(q.key));
    for (const [key, plan] of plans) {
      let units: readonly WorkUnit[] = [];
      try {
        units = plan();
      } catch (err) {
        console.error(`[acute-notes] Search index planning failed (${key})`, err);
      }
      for (const unit of units) this.queue.push({ key, unit });
    }
  }

  private run(unit: WorkUnit): void {
    this.unitsRun++;
    try {
      unit();
    } catch (err) {
      console.error("[acute-notes] Search index update failed", err);
    }
  }

  private cancel(): void {
    if (this.timer !== null) this.host.clearTimer(this.timer);
    if (this.idle !== null) this.host.cancelIdle(this.idle);
    this.timer = null;
    this.idle = null;
  }
}
