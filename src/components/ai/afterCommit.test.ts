/**
 * Stage 4b (intelligent-update-engine-plan §12.10 checkpoints 4 and 6): after a commit, the index sync and the post-commit
 * steps run in order and in isolation — a stale index holds the check job back (never run against it), and a failing
 * step is recorded on the revision's one job and never thrown: the commit stands.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommittedRevision } from "@/ai/changes/commit";

const index = vi.hoisted(() => ({ state: { state: "fresh", verifiedAt: 1 } as Record<string, unknown>, fresh: Promise.resolve(true) as Promise<boolean> }));
vi.mock("@/search/liveIndex", () => ({
  syncCommitted: () => index.state,
  whenIndexFresh: () => index.fresh,
}));
vi.mock("@/components/canvas/changeSetWriter", () => ({ changeSetCanvas: () => ({}) }));
vi.mock("@/persistence", () => ({ getPersistence: () => ({ meta: { get: async () => undefined, set: async () => undefined } }) }));

const { afterCommit, onCommitted, resumeCheckJobs } = await import("./commitOnCanvas");
const tick = () => new Promise((res) => setTimeout(res, 0));
const { getCommitJournal } = await import("@/ai/changes/commit");

const home = { workspaceId: "ws", canvasId: "cv" } as never;
let n = 0;
function revision(): CommittedRevision {
  const id = `rev:op_${++n}`;
  const r: CommittedRevision = { id, operationId: `op_${n}`, canvasId: "cv", stepId: n, touched: ["el_a"], committedAt: 0, check: { id: `check:${id}`, status: "awaiting_checker", attempts: 0 } };
  getCommitJournal().record(r);
  return r;
}

describe("Stage 4b — after a commit", () => {
  beforeEach(() => {
    index.state = { state: "fresh", verifiedAt: 1 };
    index.fresh = Promise.resolve(true);
  });

  it("a post-commit step that throws (or rejects) is recorded on the job and never thrown; the commit stands", async () => {
    const offA = onCommitted(() => {
      throw new Error("checker crashed");
    });
    const r = revision();
    expect(() => afterCommit(home, r)).not.toThrow();
    await tick();
    expect(getCommitJournal().get(r.id)!.check).toMatchObject({ status: "failed", attempts: 1, lastError: "checker crashed" });
    offA();

    const offB = onCommitted(async () => {
      throw new Error("AI timed out");
    });
    const r2 = revision();
    afterCommit(home, r2);
    await new Promise((res) => setTimeout(res, 0));
    expect(getCommitJournal().get(r2.id)!.check).toMatchObject({ status: "failed", lastError: "AI timed out" });
    expect(getCommitJournal().get(r2.id)!.stepId).toBe(r2.stepId); // the revision itself is untouched
    offB();
  });

  it("a stale index holds the job (waiting_for_index) and no step runs until it is fresh", async () => {
    const ran: string[] = [];
    const off = onCommitted((rev) => void ran.push(rev.id));
    let release!: (ok: boolean) => void;
    index.state = { state: "stale", reason: "Simulated index failure", since: 0, attempts: 0 };
    index.fresh = new Promise((res) => (release = res));
    const r = revision();
    expect(afterCommit(home, r).state).toBe("stale");
    expect(getCommitJournal().get(r.id)!.check.status).toBe("waiting_for_index");
    expect(ran).toEqual([]);
    release(true);
    await new Promise((res) => setTimeout(res, 0));
    expect(ran).toEqual([r.id]);
    expect(getCommitJournal().get(r.id)!.check.status).toBe("done");
    off();
  });

  it("with the index fresh (or on demand, AI off), the steps run at once and the job ends done", async () => {
    const ran: string[] = [];
    const off = onCommitted((rev) => void ran.push(rev.id));
    const a = revision();
    afterCommit(home, a);
    index.state = { state: "on_demand" };
    const b = revision();
    afterCommit(home, b);
    expect(ran).toEqual([a.id, b.id]);
    await tick();
    expect(getCommitJournal().get(a.id)!.check.status).toBe("done");
    off();
  });

  it("a job held for a stale index that never turned fresh in time, or failed with attempts left, is resumed later — once, on its own revision", async () => {
    const ran: string[] = [];
    let failing = true;
    const off = onCommitted((rev) => {
      ran.push(rev.id);
      if (failing) throw new Error("checker crashed");
    });
    index.state = { state: "stale", reason: "x", since: 0, attempts: 0 };
    index.fresh = Promise.resolve(false); // stayed stale past the wait
    const held = revision();
    afterCommit(home, held);
    await tick();
    expect(getCommitJournal().get(held.id)!.check.status).toBe("waiting_for_index");
    index.state = { state: "fresh", verifiedAt: 2 };
    index.fresh = Promise.resolve(true);
    const failed = revision();
    afterCommit(home, failed); // runs and fails
    await tick();
    expect(getCommitJournal().get(failed.id)!.check.status).toBe("failed");
    failing = false;
    ran.length = 0;
    await resumeCheckJobs(home);
    // (Failed jobs left by the earlier tests in this file are resumed too, as they should be.)
    expect(ran).toEqual(expect.arrayContaining([failed.id, held.id]));
    expect(getCommitJournal().get(held.id)!.check.status).toBe("done");
    expect(getCommitJournal().get(failed.id)!.check).toMatchObject({ status: "done", attempts: 2 });
    ran.length = 0;
    await resumeCheckJobs(home); // nothing left to do
    expect(ran).toEqual([]);
    off();
  });
});
