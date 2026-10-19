import { describe, expect, it } from "vitest";
import { AGENT_STATE_LIMITS, autoAcceptable, boundedInverse, changeRecord, diffScenes, planRevert, retain, summarizeArgs, type AgentChangeRecord } from "./agentState";
import { parseChangeSet, type ChangeSet } from "./changeSet";
import { withDecisions } from "@/ai/reconcile/conflicts";

type El = { id: string; type: string; version: number; isDeleted: boolean; customData?: Record<string, unknown>; text?: string; containerId?: string | null; x?: number };
const el = (id: string, version: number, extra: Partial<El> = {}): El => ({ id, type: "rectangle", version, isDeleted: false, ...extra });

const baseSet = (extra: Partial<ChangeSet> = {}): ChangeSet =>
  parseChangeSet({ operationId: "op_1", title: "Codex: Add block", metadata: { createdBy: "mcp", task: "create_block" }, changes: [{ kind: "move", target: "a", to: { x: 0, y: 0 } }], ...extra });

const DAY = 86_400_000;

describe("diffScenes: the inverse is what one write did (D30)", () => {
  it("removes what was added, restores what changed or was deleted, ignores what didn't change", () => {
    const keyed = el("a", 1, { customData: { acuteNode: { key: "f.api" } }, x: 0 });
    const before = [keyed, el("b", 3), el("c", 2)];
    const after = [{ ...keyed, version: 2, x: 50 }, { ...el("b", 4), isDeleted: true }, el("c", 2), el("new", 1), el("new_label", 1, { type: "text", containerId: "new" })];
    const { touched, inverse } = diffScenes(before, after);
    expect(touched).toEqual([
      { elementId: "a", key: "f.api", op: "update", afterVersion: 2 },
      { elementId: "b", op: "remove", afterVersion: 4 },
      { elementId: "new", op: "create", afterVersion: 1 },
      { elementId: "new_label", op: "create", afterVersion: 1 },
    ]);
    expect(inverse).toEqual([
      { op: "restore", element: { ...keyed } },
      { op: "restore", element: el("b", 3) },
      { op: "remove", elementId: "new" },
      { op: "remove", elementId: "new_label" },
    ]);
  });

  it("a snapshot is a plain copy, not the live object", () => {
    const a = el("a", 1, { customData: { nested: { v: 1 } } });
    const { inverse } = diffScenes([a], [{ ...a, version: 2 }]);
    const snap = inverse[0]!.op === "restore" ? inverse[0]!.element : null;
    expect(snap).not.toBe(a);
    expect(snap?.customData).not.toBe(a.customData);
  });

  it("an oversized inverse isn't kept, and the change isn't revertible", () => {
    const big = { op: "restore" as const, element: { id: "x", type: "freedraw", points: "p".repeat(300_000) } };
    expect(boundedInverse([big])).toEqual({ inverse: [], revertible: false });
    expect(boundedInverse([{ op: "remove", elementId: "x" }]).revertible).toBe(true);
    expect(boundedInverse([]).revertible).toBe(false);
  });
});

describe("change records (D32, D46, D61)", () => {
  it("an accepted record carries every attribution field, what it touched and its inverse", () => {
    const set = baseSet({ session: "mcp_1", agent: "Codex", reason: "Make room", args: '{"x":1}' });
    const diff = diffScenes([el("a", 1)], [el("a", 2)]);
    const r = changeRecord({ id: "chg_1", workspaceId: "ws", canvasId: "cv", set, at: 5, outcome: "accepted", diff, result: "applied" });
    expect(r).toMatchObject({ id: "chg_1", workspaceId: "ws", canvasId: "cv", operationId: "op_1", agent: "Codex", session: "mcp_1", tool: "create_block", at: 5, outcome: "accepted", args: '{"x":1}', result: "applied", title: "Codex: Add block", reason: "Make room", revertible: true });
    expect(r.touched).toHaveLength(1);
    expect(r.inverse).toHaveLength(1);
    expect(r.credentialId).toBeUndefined(); // D61: reserved, unset today
  });

  it("rejected and expired records keep no inverse; a reject reason is one bounded line", () => {
    const r = changeRecord({ id: "c", workspaceId: "ws", canvasId: "cv", set: baseSet(), at: 1, outcome: "rejected", rejectReason: "  never   retry\ncard_declined  " });
    expect(r).toMatchObject({ outcome: "rejected", rejectReason: "never retry card_declined", inverse: [], touched: [], revertible: false });
    expect(changeRecord({ id: "c", workspaceId: "ws", canvasId: "cv", set: baseSet(), at: 1, outcome: "expired" }).inverse).toEqual([]);
  });

  it("summarizeArgs redacts secrets and stays within the limit", () => {
    expect(summarizeArgs({ markdown: "token ghp_" + "a".repeat(36) })).not.toContain("ghp_aaaa");
    const long = summarizeArgs({ markdown: "x".repeat(10_000) })!;
    expect(long.length).toBeLessThanOrEqual(AGENT_STATE_LIMITS.argsChars);
    expect(summarizeArgs(undefined)).toBeUndefined();
  });
});

const rec = (id: string, at: number, extra: Partial<AgentChangeRecord> = {}): AgentChangeRecord => ({
  id,
  workspaceId: "ws",
  canvasId: "cv",
  operationId: `op_${id}`,
  tool: "create_block",
  at,
  outcome: "accepted",
  title: id,
  touched: [],
  inverse: [{ op: "remove", elementId: `el_${id}` }],
  revertible: true,
  ...extra,
});

describe("retention (D58: 500 records or 30 days, whichever keeps more)", () => {
  const now = 1_000 * DAY;

  it("keeps the newest 500 revertible even when they are old", () => {
    const records = Array.from({ length: 500 }, (_, i) => rec(`r${i}`, now - 100 * DAY - i));
    const { keep, drop, stripped } = retain(records, now);
    expect(drop).toEqual([]);
    expect(stripped).toEqual([]);
    expect(keep.every((r) => r.revertible)).toBe(true);
  });

  it("keeps everything younger than 30 days revertible, however many", () => {
    const records = Array.from({ length: 700 }, (_, i) => rec(`r${i}`, now - DAY - i));
    expect(retain(records, now).stripped).toEqual([]);
  });

  it("past both bounds a record loses its inverse first, then goes", () => {
    const fresh = Array.from({ length: 500 }, (_, i) => rec(`f${i}`, now - i));
    const middle = rec("middle", now - 40 * DAY);
    const ancient = Array.from({ length: 600 }, (_, i) => rec(`a${i}`, now - 90 * DAY - i));
    const { keep, drop, stripped } = retain([...fresh, middle, ...ancient], now);
    expect(stripped).toContain("middle");
    expect(keep.find((r) => r.id === "middle")).toMatchObject({ inverse: [], revertible: false });
    // 500 fresh + middle + 499 ancient are within twice the record bound; the rest are older than 60 days too.
    expect(drop).toHaveLength(1101 - 1000);
  });
});

describe("planRevert (D30)", () => {
  it("removes what a change created and restores what it updated or removed, oldest before-state per element", () => {
    const records = [
      rec("older", 1, { inverse: [{ op: "restore", element: { id: "a", type: "rectangle", version: 1, x: 0 } }], touched: [{ elementId: "a", op: "update", afterVersion: 2 }] }),
      rec("newer", 2, {
        inverse: [{ op: "restore", element: { id: "a", type: "rectangle", version: 2, x: 10 } }, { op: "remove", elementId: "n" }, { op: "restore", element: { id: "gone", type: "ellipse", version: 4, isDeleted: false } }],
        touched: [{ elementId: "a", op: "update", afterVersion: 3 }, { elementId: "n", op: "create", afterVersion: 1 }, { elementId: "gone", op: "remove", afterVersion: 5 }],
      }),
    ];
    const scene = [el("a", 3), el("n", 1), { ...el("gone", 5), isDeleted: true }];
    const plan = planRevert(records, scene);
    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toEqual([
      { kind: "restore", target: "a", element: { id: "a", type: "rectangle", version: 1, x: 0 } },
      { kind: "remove", target: "n" },
      { kind: "restore", target: "gone", element: { id: "gone", type: "ellipse", version: 4, isDeleted: false } },
    ]);
    // It is an ordinary, valid change set.
    expect(() => parseChangeSet({ operationId: "op_r", title: "Revert", metadata: { createdBy: "import" }, changes: plan.changes })).not.toThrow();
  });

  it("an element edited since the change is a conflict, never overwritten", () => {
    const r = rec("one", 1, { inverse: [{ op: "restore", element: { id: "a", type: "rectangle", version: 1 } }, { op: "remove", elementId: "n" }], touched: [{ elementId: "a", op: "update", afterVersion: 2 }, { elementId: "n", op: "create", afterVersion: 1 }] });
    const plan = planRevert([r], [el("a", 7), el("n", 3), el("lbl", 1, { type: "text", containerId: "n", text: "Webhook" })]);
    expect(plan.changes).toEqual([]);
    expect(plan.conflicts.map((c) => [c.target, c.apply.kind, c.keep, c.name])).toEqual([
      ["a", "restore", undefined, undefined],
      ["n", "remove", undefined, "Webhook"],
    ]);
  });

  it("a shape moved by hand and its bound label are one conflict, decided together", () => {
    // The agent changed a labelled shape; the user then dragged it, which bumps the label's version too.
    const shapeBefore = { id: "s", type: "rectangle", version: 1, x: 0 };
    const labelBefore = { id: "s_lbl", type: "text", version: 1, containerId: "s", text: "API", originalText: "API" };
    const changed = rec("chg", 1, {
      inverse: [{ op: "restore", element: shapeBefore }, { op: "restore", element: labelBefore }],
      touched: [{ elementId: "s", op: "update", afterVersion: 2 }, { elementId: "s_lbl", op: "update", afterVersion: 2 }],
    });
    const moved = [el("s", 3, { x: 40 }), el("s_lbl", 3, { type: "text", containerId: "s", text: "API v2" })];
    const plan = planRevert([changed], moved);
    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toEqual([
      { target: "s", apply: { kind: "restore", target: "s", element: shapeBefore }, name: "API v2", alsoApply: [{ kind: "restore", target: "s_lbl", element: labelBefore }] },
    ]);
    // A valid set, whose single "Revert anyway" restores both, and whose overlap check sees the label.
    const set = parseChangeSet({ operationId: "op_r", title: "Revert", metadata: { createdBy: "import" }, changes: [], conflicts: plan.conflicts });
    expect(withDecisions(set, new Map([["s", "apply"]])).changes.map((c) => "target" in c && c.target)).toEqual(["s", "s_lbl"]);
    expect(withDecisions(set, new Map()).changes).toEqual([]);

    // An added shape and its label, both moved since: one card whose removal takes the label with it.
    const added = rec("add", 1, { inverse: [{ op: "remove", elementId: "n" }, { op: "remove", elementId: "n_lbl" }], touched: [{ elementId: "n", op: "create", afterVersion: 1 }, { elementId: "n_lbl", op: "create", afterVersion: 1 }] });
    const addedPlan = planRevert([added], [el("n", 4), el("n_lbl", 4, { type: "text", containerId: "n", text: "Queue" })]);
    expect(addedPlan.conflicts.map((c) => [c.target, c.apply.kind, c.name, c.alsoApply])).toEqual([["n", "remove", "Queue", undefined]]);

    // A label edited on its own (its shape untouched since) is still its own card.
    const relabelled = planRevert([changed], [el("s", 2), el("s_lbl", 3, { type: "text", containerId: "s", text: "API v2" })]);
    expect(relabelled.changes.map((c) => "target" in c && c.target)).toEqual(["s"]);
    expect(relabelled.conflicts.map((c) => [c.target, c.alsoApply])).toEqual([["s_lbl", undefined]]);
  });

  it("an element deleted since the change — missing from a live-only scene, or deleted at a later version — is a conflict", () => {
    const r = rec("upd", 1, { inverse: [{ op: "restore", element: { id: "a", type: "rectangle", version: 1 } }], touched: [{ elementId: "a", op: "update", afterVersion: 2 }] });
    expect(planRevert([r], []).conflicts.map((c) => c.target)).toEqual(["a"]);
    expect(planRevert([r], [{ ...el("a", 5), isDeleted: true }]).conflicts.map((c) => c.target)).toEqual(["a"]);
    // …but what the change itself removed is restored cleanly when it is still gone.
    const removed = rec("rm", 1, { inverse: [{ op: "restore", element: { id: "b", type: "rectangle", version: 1 } }], touched: [{ elementId: "b", op: "remove", afterVersion: 2 }] });
    expect(planRevert([removed], []).changes.map((c) => c.kind)).toEqual(["restore"]);
  });

  it("drops a removal of something already gone, and skips what can't be reverted", () => {
    const plan = planRevert(
      [rec("created", 1, { touched: [{ elementId: "el_created", op: "create", afterVersion: 1 }] }), rec("rej", 2, { outcome: "rejected" }), rec("done", 3, { revertedBy: "x" }), rec("old", 4, { revertible: false, inverse: [] })],
      [{ ...el("el_created", 2), isDeleted: true }],
    );
    expect(plan.changes).toEqual([]);
    expect(plan.skipped).toEqual([
      { id: "rej", why: "not_accepted" },
      { id: "done", why: "already_reverted" },
      { id: "old", why: "not_revertible" },
    ]);
  });
});

describe("autoAcceptable (D44)", () => {
  const shape = (kind?: string) => ({ kind: "create_shape" as const, key: "k", shape: "rectangle" as const, box: { x: 0, y: 0, width: 10, height: 10 }, ...(kind ? { semantics: { kind: kind as never } } : {}) });
  it("allows ordinary additions and updates", () => {
    expect(autoAcceptable({ changes: [shape("decision"), { kind: "update_node", target: "a", semantics: { status: "done" } }] })).toBe(true);
  });
  it("never removals, restores, new constraints, enforced decisions or conflicts", () => {
    expect(autoAcceptable({ changes: [{ kind: "remove", target: "a" }] })).toBe(false);
    expect(autoAcceptable({ changes: [{ kind: "restore", target: "a", element: { id: "a", type: "rectangle" } }] })).toBe(false);
    expect(autoAcceptable({ changes: [shape("constraint")] })).toBe(false);
    expect(autoAcceptable({ changes: [{ kind: "update_node", target: "a", semantics: { kind: "constraint" } }] })).toBe(false);
    expect(autoAcceptable({ changes: [{ kind: "update_node", target: "a", semantics: { enforce: true } }] })).toBe(false);
    expect(autoAcceptable({ changes: [shape()], conflicts: [{ target: "a", apply: { kind: "remove", target: "a" } }] })).toBe(false);
  });
});
