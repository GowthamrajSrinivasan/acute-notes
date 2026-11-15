/**
 * Stage 4b (intelligent-update-engine-plan §12.9 A): the index's health per canvas — a failure gives an explicit stale
 * state, a rebuild from the scene recovers it, repeated failures end visibly `failed` until Retry, and nothing waiting for
 * a fresh index is let through while it is stale.
 */
import { describe, expect, it } from "vitest";
import { IndexHealth, MAX_REBUILDS, REBUILD_BACKOFF_MS, type IndexHealthDeps } from "./indexHealth";

function world(opts: { failRebuilds?: number; outOfDate?: () => string[] } = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; cb: () => void }>();
  let failures = opts.failRebuilds ?? 0;
  const rebuilds: string[] = [];
  const deps: IndexHealthDeps = {
    rebuild: (canvasId) => {
      rebuilds.push(canvasId);
      if (failures > 0) {
        failures--;
        throw new Error("Simulated index failure");
      }
    },
    verify: () => ({ stale: opts.outOfDate?.() ?? [], extra: [] }),
    now: () => now,
    setTimer: (cb, ms) => (timers.set(++seq, { at: now + ms, cb }), seq),
    clearTimer: (h) => void timers.delete(h as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) continue;
      timers.delete(id);
      t.cb();
    }
  };
  const health = new IndexHealth(deps);
  const states: string[] = [];
  health.subscribe(() => states.push(health.status("cv").state));
  return { health, advance, rebuilds, states, setFailures: (n: number) => (failures = n) };
}

describe("Stage 4b — index health", () => {
  it("a failure makes the canvas stale; the rebuild from the scene brings it back to fresh", () => {
    const w = world();
    expect(w.health.status("cv").state).toBe("fresh");
    w.health.markStale("cv", "Simulated index failure");
    expect(w.health.status("cv")).toMatchObject({ state: "stale", reason: "Simulated index failure", attempts: 0 });
    w.advance(REBUILD_BACKOFF_MS[0]);
    expect(w.rebuilds).toEqual(["cv"]);
    expect(w.health.status("cv").state).toBe("fresh");
    expect(w.states).toEqual(["stale", "rebuilding", "fresh"]);
  });

  it("rebuilds back off and stop: after MAX_REBUILDS failures the canvas stays visibly failed until Retry", () => {
    const w = world({ failRebuilds: 10 });
    w.health.markStale("cv", "boom");
    for (const ms of REBUILD_BACKOFF_MS) w.advance(ms);
    expect(w.rebuilds).toHaveLength(MAX_REBUILDS);
    expect(w.health.status("cv")).toMatchObject({ state: "failed", attempts: MAX_REBUILDS, reason: "Simulated index failure" });
    // Further failures don't restart it on their own; no timer is left running.
    w.health.markStale("cv", "again");
    w.advance(60_000);
    expect(w.rebuilds).toHaveLength(MAX_REBUILDS);
    // Retry: a new count of attempts, and this time it works.
    w.setFailures(0);
    w.health.retry("cv");
    expect(w.health.status("cv").state).toBe("fresh");
  });

  it("a failure reported during the canvas's own rebuild counts that rebuild as failed (no rebuild storm)", () => {
    const w = world();
    let inside = false;
    const health = new IndexHealth({
      rebuild: () => {
        if (!inside) {
          inside = true;
          health.markStale("cv", "a unit failed while rebuilding");
        }
      },
      verify: () => ({ stale: [], extra: [] }),
      now: () => 0,
      setTimer: (cb) => (cb(), 1),
      clearTimer: () => undefined,
    });
    health.markStale("cv", "first");
    // First rebuild failed from inside, the second (scheduled once) succeeded.
    expect(health.status("cv").state).toBe("fresh");
    void w;
  });

  it("verification after a commit: objects out of date make it stale; in sync stays fresh", () => {
    let behind: string[] = [];
    const w = world({ outOfDate: () => behind });
    expect(w.health.check("cv").state).toBe("fresh");
    behind = ["el_1"];
    expect(w.health.check("cv")).toMatchObject({ state: "stale", reason: "1 object(s) out of date" });
    behind = [];
    w.advance(0);
    expect(w.health.status("cv").state).toBe("fresh");
  });

  it("whenFresh holds a waiting check until the index is fresh, and says false when it fails or times out", async () => {
    const w = world({ failRebuilds: 1 });
    w.health.markStale("cv", "boom");
    const waiting = w.health.whenFresh("cv", 30_000);
    w.advance(0); // first rebuild fails
    w.advance(REBUILD_BACKOFF_MS[1]); // second succeeds
    await expect(waiting).resolves.toBe(true);

    const f = world({ failRebuilds: 10 });
    f.health.markStale("cv", "boom");
    const never = f.health.whenFresh("cv", 30_000);
    for (const ms of REBUILD_BACKOFF_MS) f.advance(ms);
    await expect(never).resolves.toBe(false);

    const t = world({ failRebuilds: 10 });
    t.health.markStale("cv", "boom");
    const slow = t.health.whenFresh("cv", 100);
    t.advance(100);
    await expect(slow).resolves.toBe(false);
  });

  it("canvases are independent; forgetting one leaves no timer", () => {
    const w = world();
    w.health.markStale("other", "boom");
    expect(w.health.status("cv").state).toBe("fresh");
    w.health.forget("other");
    w.advance(10_000);
    expect(w.rebuilds).toEqual([]);
  });
});
