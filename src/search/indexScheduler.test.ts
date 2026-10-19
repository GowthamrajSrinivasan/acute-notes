import { describe, expect, it } from "vitest";
import { IndexScheduler, type IdleDeadlineLike, type SchedulerHost } from "./indexScheduler";
import { block, doc, lookup, note } from "./testFixtures";
import { WorkspaceIndex } from "./workspaceIndex";

/** A manual clock: timers and idle callbacks run only when the test says so. */
function fakeHost() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const idles = new Map<number, (d: IdleDeadlineLike) => void>();
  const host: SchedulerHost = {
    now: () => now,
    setTimer: (cb, ms) => {
      timers.set(++seq, { at: now + ms, cb });
      return seq;
    },
    clearTimer: (h) => {
      timers.delete(h as number);
    },
    requestIdle: (cb) => {
      idles.set(++seq, cb);
      return seq;
    },
    cancelIdle: (h) => void idles.delete(h as number),
  };
  return {
    host,
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at > now) continue;
        timers.delete(id);
        t.cb();
      }
    },
    /** Runs pending idle callbacks, each with `budgetMs` of idle time; the clock moves `costMs` per unit via `tick`. */
    idle(budgetMs = 50) {
      const pending = [...idles];
      idles.clear();
      const start = now;
      for (const [, cb] of pending) cb({ timeRemaining: () => Math.max(0, budgetMs - (now - start)) });
    },
    tick(ms: number) {
      now += ms;
    },
    get idleCount() {
      return idles.size;
    },
    get timerCount() {
      return timers.size;
    },
  };
}

describe("IndexScheduler", () => {
  it("marking dirty does no work; work starts only after input has been quiet, in idle time", () => {
    const h = fakeHost();
    const s = new IndexScheduler(h.host, { quietMs: 300, sliceMs: 8, idleTimeoutMs: 2000 });
    let plans = 0;
    const ran: number[] = [];
    const plan = () => (plans++, [() => ran.push(1)]);
    // A burst of changes (a drag): 100 marks, no planning.
    for (let i = 0; i < 100; i++) {
      s.markDirty("scene", plan);
      h.advance(10);
    }
    expect(plans).toBe(0);
    expect(h.timerCount).toBe(1);
    h.advance(150); // not quiet yet (last mark 10 ms ago → re-armed)
    expect(h.idleCount).toBe(0);
    h.advance(300);
    expect(h.idleCount).toBe(1);
    expect(plans).toBe(0);
    h.idle();
    expect(plans).toBe(1);
    expect(ran).toEqual([1]);
    expect(s.pending).toBe(false);
  });

  it("slices work to the idle deadline and resumes in the next idle period", () => {
    const h = fakeHost();
    const s = new IndexScheduler(h.host, { quietMs: 0, sliceMs: 8, idleTimeoutMs: 2000 });
    let done = 0;
    s.markDirty("docs", () => Array.from({ length: 20 }, () => () => (done++, h.tick(1))));
    h.advance(0);
    h.idle(5);
    expect(done).toBeGreaterThan(0);
    expect(done).toBeLessThan(20);
    expect(h.idleCount).toBe(1);
    while (h.idleCount) h.idle(5);
    expect(done).toBe(20);
  });

  it("a newer mark replaces the older plan's queued work; flush runs everything now", () => {
    const h = fakeHost();
    const s = new IndexScheduler(h.host, { quietMs: 0, sliceMs: 1, idleTimeoutMs: 2000 });
    const ran: string[] = [];
    s.markDirty("k", () => Array.from({ length: 10 }, (_, i) => () => (ran.push(`old${i}`), h.tick(1))));
    h.advance(0);
    h.idle(3);
    const before = ran.length;
    expect(before).toBeLessThan(10);
    s.markDirty("k", () => [() => ran.push("new")]);
    s.flush();
    expect(ran.slice(before)).toEqual(["new"]);
    expect(s.pending).toBe(false);
  });

  it("forget and dispose drop pending work", () => {
    const h = fakeHost();
    const s = new IndexScheduler(h.host);
    let ran = 0;
    s.markDirty("a", () => [() => ran++]);
    s.forget("a");
    s.flush();
    expect(ran).toBe(0);
    s.markDirty("b", () => [() => ran++]);
    s.dispose();
    s.flush();
    expect(ran).toBe(0);
  });

  it("keeps an index current incrementally from scene marks", () => {
    const h = fakeHost();
    const s = new IndexScheduler(h.host, { quietMs: 100, sliceMs: 50, idleTimeoutMs: 2000 });
    const index = new WorkspaceIndex("ws");
    const docs = [doc("d1", [{ type: "paragraph", content: "invoice export" }])];
    let scene = [block("b1", "d1"), note("n1", "draft", { version: 1 } as never)];
    const plan = () => index.planScene("cv", scene, lookup(docs));
    s.markDirty("scene", plan);
    h.advance(100);
    h.idle();
    expect(index.query({ text: "invoice" }).hits.map((x) => x.id)).toEqual(["b1"]);
    scene = [scene[0]!, note("n1", "final invoice", { version: 2 } as never)];
    s.markDirty("scene", plan);
    // Not indexed until quiet + idle.
    expect(index.query({ text: "final" }).hits).toEqual([]);
    h.advance(100);
    h.idle();
    expect(index.query({ text: "final" }).hits.map((x) => x.id)).toEqual(["n1"]);
  });
});
