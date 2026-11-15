/**
 * Stage 4a (intelligent-update-engine-plan §12.9 B): the shared commit is idempotent — one accepted change is one
 * committed revision with one consistency-check job; repeated accepts, retries and reloads never write twice.
 */
import { describe, expect, it } from "vitest";
import type { ChangeSetCanvas } from "./accept";
import type { ChangeSet, ProposedChange } from "./changeSet";
import { checkJobId, commitChangeSet, commitParts, CommitJournal, JOURNAL_KEY, revisionId, touchedBy } from "./commit";
import { PendingChanges } from "./pendingChanges";
import { PENDING_KEY, restorePendingProposals } from "./pendingPersistence";

const box = { x: 0, y: 0, width: 100, height: 50 };
const create = (key: string): ProposedChange => ({ kind: "create_block", key, blockType: "text", content: [{ type: "paragraph", content: key }], box });
const set = (operationId: string, changes: ProposedChange[], extra: Partial<ChangeSet> = {}): ChangeSet => ({ operationId, title: "t", metadata: { createdBy: "ai" }, changes, ...extra });

function world() {
  const writes: ProposedChange[][] = [];
  let n = 0;
  const canvas: ChangeSetCanvas = {
    boxOf: (id) => (id === "gone" ? undefined : box),
    write: (_s, changes) => {
      writes.push([...changes]);
      return new Map(changes.flatMap((c) => ("key" in c ? [[c.key, `el_${c.key}`] as const] : [])));
    },
  };
  const history = { record: (f: () => void) => (f(), ++n) };
  const data = new Map<string, unknown>();
  const store = { get: async <T>(k: string) => data.get(k) as T | undefined, set: async (k: string, v: unknown) => void data.set(k, structuredClone(v)), delete: async (k: string) => void data.delete(k) };
  return { writes, canvas, history, store, data };
}

describe("Stage 4a — the shared commit is idempotent", () => {
  it("one accepted set: one write, one revision with stable ids, one check job; accepting it again writes nothing", () => {
    const w = world();
    const journal = new CommitJournal();
    const s = set("op_1", [create("a"), { kind: "update_block", target: "el_x", content: [{ type: "paragraph", content: "x" }] }]);
    const first = commitChangeSet(s, w.canvas, w.history, { canvasId: "cv", journal, now: () => 5 })!;
    expect(first.stepId).toBe(1);
    expect(first.revision).toEqual({
      id: "rev:op_1",
      operationId: "op_1",
      canvasId: "cv",
      stepId: 1,
      touched: ["el_a", "el_x"],
      committedAt: 5,
      check: { id: "check:rev:op_1", status: "awaiting_checker", attempts: 0 },
    });
    // A repeated event, a retry: nothing written, no second revision or job.
    expect(commitChangeSet(s, w.canvas, w.history, { canvasId: "cv", journal })).toBeNull();
    expect(commitChangeSet({ ...s }, w.canvas, w.history, { canvasId: "cv", journal })).toBeNull();
    expect(w.writes).toHaveLength(1);
    expect(journal.list()).toHaveLength(1);
    expect(checkJobId(revisionId("op_1"))).toBe("check:rev:op_1");
  });

  it("a commit that wrote nothing (every change dropped) has no revision and no job", () => {
    const w = world();
    const journal = new CommitJournal();
    const r = commitChangeSet(set("op_2", [{ kind: "remove", target: "gone" }]), w.canvas, w.history, { canvasId: "cv", journal })!;
    expect(r.stepId).toBeNull();
    expect(r.revision).toBeNull();
    expect(journal.list()).toEqual([]);
  });

  it("the journal survives a reload: a new journal on the same store still refuses the operation", async () => {
    const w = world();
    const before = new CommitJournal(w.store);
    commitChangeSet(set("op_3", [create("a")]), w.canvas, w.history, { canvasId: "cv", journal: before });
    await before.flushed();
    expect((w.data.get(JOURNAL_KEY) as unknown[]).length).toBe(1);
    const after = new CommitJournal(w.store);
    await after.load();
    expect(commitChangeSet(set("op_3", [create("a")]), w.canvas, w.history, { canvasId: "cv", journal: after })).toBeNull();
    expect(w.writes).toHaveLength(1);
  });

  it("a merged set: each part is written once, whatever order or repetition the accepts come in", () => {
    const w = world();
    const journal = new CommitJournal();
    const merged = set("op_m", [create("a1"), create("b1"), create("c1")], {
      parts: [
        { key: "A", title: "A", changes: 1, conflicts: 0 },
        { key: "B", title: "B", changes: 1, conflicts: 0 },
        { key: "C", title: "C", changes: 1, conflicts: 0 },
      ],
    });
    const ctx = { canvasId: "cv", journal };
    const a = commitParts(merged, new Set(["A"]), new Map(), () => w.canvas, w.history, ctx)!;
    expect(a.revision).toMatchObject({ id: "rev:op_m#A", parts: ["A"] });
    // "Accept all" after "Accept section A" on the original set: only B and C are written.
    const rest = commitParts(merged, null, new Map(), () => w.canvas, w.history, ctx)!;
    expect(rest.revision).toMatchObject({ id: "rev:op_m#B+C", parts: ["B", "C"] });
    expect(commitParts(merged, null, new Map(), () => w.canvas, w.history, ctx)).toBeNull();
    expect(commitParts(merged, new Set(["A"]), new Map(), () => w.canvas, w.history, ctx)).toBeNull();
    expect(w.writes.flat().map((c) => ("key" in c ? c.key : ""))).toEqual(["a1", "b1", "c1"]);
    // One check job per revision, never per part twice.
    expect(journal.list().map((r) => r.check.id)).toEqual(["check:rev:op_m#A", "check:rev:op_m#B+C"]);
  });

  it("a check job is updated on its revision, never duplicated", () => {
    const w = world();
    const journal = new CommitJournal();
    const r = commitChangeSet(set("op_4", [create("a")]), w.canvas, w.history, { canvasId: "cv", journal })!.revision!;
    journal.updateCheck(r.id, { status: "failed", attempts: 1, lastError: "boom" });
    journal.updateCheck(r.id, { status: "pending" });
    expect(journal.list()).toHaveLength(1);
    expect(journal.get(r.id)!.check).toEqual({ id: "check:rev:op_4", status: "pending", attempts: 1, lastError: "boom" });
  });

  it("a proposal saved for review but already committed (a reload in between) is not restored; others are", async () => {
    const w = world();
    const journal = new CommitJournal();
    commitChangeSet(set("op_done", [create("a")]), w.canvas, w.history, { canvasId: "cv", journal });
    await w.store.set(PENDING_KEY, [
      { canvasId: "cv", set: set("op_done", [create("a")], { session: "mcp:1" }), savedAt: Date.now() },
      { canvasId: "cv2", set: set("op_open", [create("b")], { session: "mcp:1" }), savedAt: Date.now() },
    ]);
    const pending = new PendingChanges();
    const restored = await restorePendingProposals(w.store, pending, Date.now, (op) => journal.committed(op));
    expect(restored).toBe(1);
    expect(pending.all().map((p) => p.set.operationId)).toEqual(["op_open"]);
  });

  it("touched: created, changed, removed and grouped objects", () => {
    expect(
      touchedBy(
        [
          { kind: "update_block", target: "u", content: [] },
          { kind: "remove", target: "r" },
          { kind: "group_objects", targets: ["g1", "g2"] } as unknown as ProposedChange,
        ],
        new Map([["k", "c"]]),
      ).sort(),
    ).toEqual(["c", "g1", "g2", "r", "u"]);
  });
});
