/**
 * Stale-target protection (P0, 2026-11-15), end to end on the pure pipeline: a proposal's `update_block` is stamped with
 * its target's baseline when proposed, compared with the live target at Accept, and an edit made in between is never
 * overwritten — it becomes a Keep mine / Use proposed decision. Covers an edit during review, a reload (persisted
 * proposals, legacy ones without a baseline), both decisions, multi-target atomicity and undo — for `update_block` and,
 * the same way, for `update_shape` (a shape's label).
 */
import { describe, expect, it } from "vitest";
import { fingerprintContent, fingerprintShape } from "@/ai/content/fingerprint";
import { withDecisions } from "@/ai/reconcile/conflicts";
import { CanvasHistory } from "@/history/canvasHistory";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { RichContent } from "@/domain/types";
import { acceptChangeSet, type ChangeSetCanvas } from "./accept";
import { describeDropped, parseChangeSet, resolveChangeSet, type ChangeSet, type ProposedChange } from "./changeSet";
import { PendingChanges } from "./pendingChanges";
import { PENDING_KEY, restorePendingProposals } from "./pendingPersistence";
import { afterAccept, followUpId, markLegacyBaselines, shapeBaseline, UNKNOWN_BASELINE, withBaselines } from "./staleTarget";

const para = (text: string): RichContent => [{ type: "paragraph", content: text }];
const fp = (text: string) => fingerprintContent(para(text));

interface El {
  id: string;
  version: number;
  index: string;
  isDeleted: boolean;
  /** The block's document (re-pointed to a fresh one by an update, as the real writer does, so undo restores the old). */
  doc: string;
}

/** Two blocks, "Retry limit: 5" and "Timeout: 30 s", on a canvas with the real history; documents live outside it, like the document store. */
function canvasWith(texts: Record<string, string>) {
  const docs = new Map<string, RichContent>();
  let scene: El[] = Object.keys(texts).map((id, i) => {
    docs.set(`d_${id}`, para(texts[id]!));
    return { id, version: 1, index: `a${i}`, isDeleted: false, doc: `d_${id}` };
  });
  const history = new CanvasHistory<El>({
    getElements: () => scene,
    apply: (elements) => (scene = elements),
    bump: (t, above) => ({ ...t, version: above + 1 }),
    markDeleted: (el) => ({ ...el, isDeleted: true }),
  });
  history.init(scene);
  let n = 0;
  const live = (id: string) => scene.find((e) => e.id === id && !e.isDeleted);
  const text = (id: string) => {
    const c = docs.get(live(id)!.doc)![0]!.content;
    return typeof c === "string" ? c : "";
  };
  const fingerprint = (id: string) => {
    const el = live(id);
    return el ? fingerprintContent(docs.get(el.doc)!) : null;
  };
  const canvas: ChangeSetCanvas = {
    boxOf: (id) => (live(id) ? { x: 0, y: 0, width: 10, height: 10 } : undefined),
    contentOf: (id) => {
      const el = live(id);
      return el ? { content: docs.get(el.doc)!, fingerprint: fingerprintContent(docs.get(el.doc)!) } : null;
    },
    write(_set: ChangeSet, changes: readonly ProposedChange[]) {
      for (const c of changes) {
        if (c.kind !== "update_block") continue;
        const doc = `d_${c.target}_${++n}`;
        docs.set(doc, c.content);
        scene = scene.map((e) => (e.id === c.target ? { ...e, doc, version: e.version + 1 } : e));
      }
      return new Map();
    },
  };
  /** The user's edit in the block's editor: its document changes, not the canvas history. */
  const edit = (id: string, t: string) => docs.set(live(id)!.doc, para(t));
  return { history, canvas, text, fingerprint, edit };
}

const proposal = (targets: Record<string, string>, extra: Partial<ChangeSet> = {}) => ({
  operationId: "op_mcp",
  title: "ChatGPT: Update blocks",
  metadata: { createdBy: "mcp" },
  session: "mcp_1",
  changes: Object.entries(targets).map(([target, t]) => ({ kind: "update_block", target, content: para(t) })),
  ...extra,
});

/** The pending store as the app has it: proposals stamped from the live canvas. */
const pendingOn = (c: ReturnType<typeof canvasWith>) => new PendingChanges({ baselineOf: () => (id) => c.fingerprint(id) });

/** What `acceptPendingSet` does, on the pure pipeline: decisions, one transaction, then what stays under review. */
function accept(pending: PendingChanges, c: ReturnType<typeof canvasWith>, decisions = new Map<string, "apply" | "keep">()) {
  const set = pending.get("cv")!;
  const r = acceptChangeSet(withDecisions(set, decisions), c.canvas, c.history);
  const after = afterAccept(set, decisions, r.stale, r.applied.length > 0);
  if (after.rest) pending.replace("cv", set.operationId, after.rest);
  else pending.settle("cv", set.operationId);
  return { ...r, ...after };
}

describe("baselines at proposal time", () => {
  it("the pending store stamps each update_block (changes and conflicts) with its target's fingerprint now; a producer's own is kept", () => {
    const c = canvasWith({ retry: "Retry limit: 5", timeout: "Timeout: 30 s" });
    const pending = pendingOn(c);
    const set = pending.propose("cv", {
      ...proposal({ retry: "Retry limit: 3" }),
      changes: [
        { kind: "update_block", target: "retry", content: para("Retry limit: 3") },
        { kind: "update_block", target: "timeout", content: para("Timeout: 10 s"), expectedFingerprint: "from_producer" },
      ],
    });
    expect(set.changes.map((x) => (x.kind === "update_block" ? x.expectedFingerprint : null))).toEqual([fp("Retry limit: 5"), "from_producer"]);
    // A target whose content can't be read gets the unknown baseline: it will ask, never overwrite.
    expect(withBaselines(parseChangeSet(proposal({ x: "y" })), () => null).changes[0]).toMatchObject({ expectedFingerprint: UNKNOWN_BASELINE });
    // Without a reader (a store with no canvas), sets stay as proposed.
    expect(new PendingChanges().propose("cv", proposal({ retry: "R" })).changes[0]).not.toHaveProperty("expectedFingerprint");
  });

  it("the baseline survives validation and a reload's round trip (parseChangeSet keeps it, and the decision marker)", () => {
    const set = parseChangeSet({
      ...proposal({ retry: "Retry limit: 3" }),
      changes: [{ kind: "update_block", target: "retry", content: para("Retry limit: 3"), expectedFingerprint: "c1" }],
      conflicts: [{ target: "t", apply: { kind: "update_block", target: "t", content: para("x"), expectedFingerprint: "c2" }, changedSinceProposal: true }],
    });
    expect(parseChangeSet(JSON.parse(JSON.stringify(set)))).toEqual(set);
  });
});

describe("comparison at Accept", () => {
  it("an untouched target is written; an edited one is withheld as a Keep mine / Use proposed decision", () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const set = withBaselines(parseChangeSet(proposal({ retry: "Retry limit: 3" })), c.fingerprint);
    expect(resolveChangeSet(set, () => true, c.canvas.contentOf).changes).toHaveLength(1);
    c.edit("retry", "Retry limit: 4");
    const r = resolveChangeSet(set, () => true, c.canvas.contentOf);
    expect(r.changes).toEqual([]);
    expect(r.dropped).toEqual([]);
    // "Use proposed" is baselined to what the user sees now, so it is checked again at its own Accept.
    expect(r.stale).toEqual([{ target: "retry", apply: { ...set.changes[0], expectedFingerprint: fp("Retry limit: 4") }, changedSinceProposal: true }]);
    // The review's preview (no content reader) shows it as proposed.
    expect(resolveChangeSet(set, () => true).changes).toHaveLength(1);
  });

  it("an edit that already says what was proposed is not a conflict; a change with no baseline is written as before", () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const set = withBaselines(parseChangeSet(proposal({ retry: "Retry limit: 3" })), c.fingerprint);
    c.edit("retry", "Retry limit: 3");
    expect(resolveChangeSet(set, () => true, c.canvas.contentOf).stale).toEqual([]);
    c.edit("retry", "Retry limit: 4");
    expect(resolveChangeSet(parseChangeSet(proposal({ retry: "Retry limit: 3" })), () => true, c.canvas.contentOf).changes).toHaveLength(1);
  });

  it("an edit immediately before Accept (no review in between) is still caught: the comparison runs in the accept itself", () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const pending = pendingOn(c);
    pending.propose("cv", proposal({ retry: "Retry limit: 3" }));
    c.edit("retry", "Retry limit: 4");
    const r = accept(pending, c);
    expect(r.stepId).toBeNull();
    expect(c.text("retry")).toBe("Retry limit: 4");
    expect(c.history.canUndo).toBe(false);
  });
});

describe("decisions and atomicity", () => {
  it("multi-target: the untouched target applies as one undo step, the edited one waits under review; undo restores only the applied one", () => {
    const c = canvasWith({ retry: "Retry limit: 5", timeout: "Timeout: 30 s" });
    const pending = pendingOn(c);
    pending.propose("cv", proposal({ retry: "Retry limit: 3", timeout: "Timeout: 10 s" }));
    c.edit("retry", "Retry limit: 4");
    const r = accept(pending, c);
    expect(r.applied.map((x) => ("target" in x ? x.target : ""))).toEqual(["timeout"]);
    expect(c.text("timeout")).toBe("Timeout: 10 s");
    expect(c.text("retry")).toBe("Retry limit: 4");
    // The decision stays under review — the written part's id is committed, so it waits under the follow-up id.
    const waiting = pending.get("cv")!;
    expect(waiting.operationId).toBe("op_mcp.r1");
    expect(waiting.changes).toEqual([]);
    expect(waiting.conflicts).toMatchObject([{ target: "retry", changedSinceProposal: true }]);
    expect(waiting.session).toBe("mcp_1");
    c.history.undo();
    expect(c.text("timeout")).toBe("Timeout: 30 s");
    expect(c.text("retry")).toBe("Retry limit: 4");
  });

  it("Keep mine: nothing is written and the review ends", () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const pending = pendingOn(c);
    pending.propose("cv", proposal({ retry: "Retry limit: 3" }));
    c.edit("retry", "Retry limit: 4");
    accept(pending, c);
    // Nothing was written, so the proposal keeps its id.
    expect(pending.get("cv")!.operationId).toBe("op_mcp");
    const r = accept(pending, c, new Map([["retry", "keep"]]));
    expect(r).toMatchObject({ stepId: null, applied: [], waiting: [], kept: 1, rest: null });
    expect(c.text("retry")).toBe("Retry limit: 4");
    expect(pending.get("cv")).toBeNull();
    expect(c.history.canUndo).toBe(false);
  });

  it("Use proposed: the proposal replaces the edit as one undo step, which undo reverts to the user's edit", () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const pending = pendingOn(c);
    pending.propose("cv", proposal({ retry: "Retry limit: 3" }));
    c.edit("retry", "Retry limit: 4");
    accept(pending, c);
    const r = accept(pending, c, new Map([["retry", "apply"]]));
    expect(r.applied).toHaveLength(1);
    expect(r.waiting).toEqual([]);
    expect(c.text("retry")).toBe("Retry limit: 3");
    expect(pending.get("cv")).toBeNull();
    c.history.undo();
    expect(c.text("retry")).toBe("Retry limit: 4");
  });

  it("Use proposed after another edit is checked again: it asks once more instead of overwriting", () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const pending = pendingOn(c);
    pending.propose("cv", proposal({ retry: "Retry limit: 3" }));
    c.edit("retry", "Retry limit: 4");
    accept(pending, c);
    c.edit("retry", "Retry limit: 6");
    const r = accept(pending, c, new Map([["retry", "apply"]]));
    expect(r.applied).toEqual([]);
    expect(c.text("retry")).toBe("Retry limit: 6");
    expect(pending.get("cv")!.conflicts![0]!.apply).toMatchObject({ expectedFingerprint: fp("Retry limit: 6") });
  });

  it("an undecided stale-target decision is never dropped by an accept of the others", () => {
    const c = canvasWith({ a: "A1", b: "B1" });
    const pending = pendingOn(c);
    pending.propose("cv", proposal({ a: "A2", b: "B2" }));
    c.edit("a", "A-mine");
    c.edit("b", "B-mine");
    accept(pending, c);
    const r = accept(pending, c, new Map([["a", "apply"]]));
    expect(c.text("a")).toBe("A2");
    expect(r.waiting.map((w) => w.target)).toEqual(["b"]);
    expect(pending.get("cv")!.conflicts!.map((x) => x.target)).toEqual(["b"]);
  });

  it("follow-up ids count up; a merged set's accept reports a changed target instead of writing it", () => {
    expect(followUpId("op_x")).toBe("op_x.r1");
    expect(followUpId("op_x.r1")).toBe("op_x.r2");
    expect(describeDropped([{ change: { kind: "update_block", target: "x", content: para("y") }, reason: "target_changed" }])).toMatch(/edited since it was proposed, and your edit was kept/);
  });
});

describe("reload", () => {
  it("a persisted proposal keeps its baseline: an edit after the reload is still caught", async () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const meta = createMemoryServices().meta;
    const before = pendingOn(c);
    await restorePendingProposals(meta, before);
    before.propose("cv", proposal({ retry: "Retry limit: 3" }));
    await new Promise((r) => setTimeout(r, 5));
    // The tab reloads; the user edits before accepting.
    const after = pendingOn(c);
    expect(await restorePendingProposals(meta, after)).toBe(1);
    c.edit("retry", "Retry limit: 4");
    accept(after, c);
    expect(c.text("retry")).toBe("Retry limit: 4");
    expect(after.get("cv")!.conflicts).toMatchObject([{ target: "retry", changedSinceProposal: true }]);
  });

  it("a legacy proposal (stored without a baseline) asks Keep mine / Use proposed — even if edited before the reload", async () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const meta = createMemoryServices().meta;
    await meta.set(PENDING_KEY, [{ canvasId: "cv", set: proposal({ retry: "Retry limit: 3" }), savedAt: Date.now() }]);
    c.edit("retry", "Retry limit: 4"); // made before the reload: a baseline stamped now would hide it
    const pending = pendingOn(c);
    expect(await restorePendingProposals(meta, pending)).toBe(1);
    expect(pending.get("cv")!.changes[0]).toMatchObject({ expectedFingerprint: UNKNOWN_BASELINE });
    accept(pending, c);
    expect(c.text("retry")).toBe("Retry limit: 4");
    expect(pending.get("cv")!.conflicts).toHaveLength(1);
    // Unless the block already says what was proposed: nothing of the user's would be lost.
    c.edit("retry", "Retry limit: 3");
    const legacy = parseChangeSet(markLegacyBaselines(proposal({ retry: "Retry limit: 3" })));
    expect(resolveChangeSet(legacy, () => true, c.canvas.contentOf).changes).toHaveLength(1);
    // Anything that isn't an update_block, or isn't a set, passes through for validation to judge.
    expect(markLegacyBaselines({ changes: [{ kind: "move" }] })).toEqual({ changes: [{ kind: "move" }] });
    expect(markLegacyBaselines(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// update_shape (2026-11-15): the same protection for a shape's label.

interface MixedEl {
  id: string;
  version: number;
  index: string;
  isDeleted: boolean;
  /** A block's document. */
  doc?: string;
  /** A shape's kind and bound label (on the element here, so the history restores it, as Excalidraw's does). */
  shape?: string;
  label?: string;
}

/** A canvas of blocks and shapes, with the real history; `shapeOf` reads a shape's label as the real writer does. */
function mixedCanvas(blocks: Record<string, string>, shapes: Record<string, string>) {
  const docs = new Map<string, RichContent>();
  let scene: MixedEl[] = [
    ...Object.keys(blocks).map((id) => {
      docs.set(`d_${id}`, para(blocks[id]!));
      return { id, doc: `d_${id}` };
    }),
    ...Object.keys(shapes).map((id) => ({ id, shape: "rectangle", label: shapes[id]! })),
  ].map((e, i) => ({ ...e, version: 1, index: `a${i}`, isDeleted: false }));
  const history = new CanvasHistory<MixedEl>({
    getElements: () => scene,
    apply: (elements) => (scene = elements),
    bump: (t, above) => ({ ...t, version: above + 1 }),
    markDeleted: (el) => ({ ...el, isDeleted: true }),
  });
  history.init(scene);
  let n = 0;
  const live = (id: string) => scene.find((e) => e.id === id && !e.isDeleted);
  const fingerprint = (id: string) => {
    const el = live(id);
    if (!el) return null;
    return el.shape ? fingerprintShape(el.shape, el.label ?? "") : fingerprintContent(docs.get(el.doc!)!);
  };
  const canvas: ChangeSetCanvas = {
    boxOf: (id) => (live(id) ? { x: 0, y: 0, width: 10, height: 10 } : undefined),
    contentOf: (id) => {
      const el = live(id);
      return el?.doc ? { content: docs.get(el.doc)!, fingerprint: fingerprintContent(docs.get(el.doc)!) } : null;
    },
    shapeOf: (id) => {
      const el = live(id);
      return el?.shape ? { shape: el.shape, fingerprint: fingerprintShape(el.shape, el.label ?? "") } : null;
    },
    write(_set: ChangeSet, changes: readonly ProposedChange[]) {
      for (const c of changes) {
        if (c.kind === "update_block") {
          const doc = `d_${c.target}_${++n}`;
          docs.set(doc, c.content);
          scene = scene.map((e) => (e.id === c.target ? { ...e, doc, version: e.version + 1 } : e));
        } else if (c.kind === "update_shape") scene = scene.map((e) => (e.id === c.target ? { ...e, label: c.label, version: e.version + 1 } : e));
      }
      return new Map();
    },
  };
  const text = (id: string) => {
    const el = live(id)!;
    if (el.shape) return el.label;
    const c = docs.get(el.doc!)![0]!.content;
    return typeof c === "string" ? c : "";
  };
  /** The user's edit: a block's document (in its editor), or a shape's label typed on the canvas (its own undo step). */
  const edit = (id: string, t: string) => {
    const el = live(id)!;
    if (el.shape) history.record(() => (scene = scene.map((e) => (e.id === id ? { ...e, label: t, version: e.version + 1 } : e))));
    else docs.set(el.doc!, para(t));
  };
  return { history, canvas, text, fingerprint, edit };
}

const relabel = (targets: Record<string, string>, blocks: Record<string, string> = {}) => ({
  operationId: "op_map",
  title: "Claude: Repo map",
  metadata: { createdBy: "mcp" },
  session: "mcp_1",
  changes: [
    ...Object.entries(targets).map(([target, label]) => ({ kind: "update_shape", target, label, stableNodeKey: `k:${target}` })),
    ...Object.entries(blocks).map(([target, t]) => ({ kind: "update_block", target, content: para(t) })),
  ],
});

describe("update_shape: a shape's label is protected the same way", () => {
  const pendingOnMixed = (c: ReturnType<typeof mixedCanvas>) => new PendingChanges({ baselineOf: () => (id) => c.fingerprint(id) });
  const acceptMixed = (pending: PendingChanges, c: ReturnType<typeof mixedCanvas>, decisions = new Map<string, "apply" | "keep">()) => {
    const set = pending.get("cv")!;
    const r = acceptChangeSet(withDecisions(set, decisions), c.canvas, c.history);
    const after = afterAccept(set, decisions, r.stale, r.applied.length > 0);
    if (after.rest) pending.replace("cv", set.operationId, after.rest);
    else pending.settle("cv", set.operationId);
    return { ...r, ...after };
  };

  it("the pending store stamps an update_shape with its label's fingerprint; a producer's own (reconciliation's) is kept", () => {
    const c = mixedCanvas({}, { orders: "Orders", pay: "Payments" });
    const set = pendingOnMixed(c).propose("cv", {
      ...relabel({}),
      changes: [
        { kind: "update_shape", target: "orders", label: "Order intake", stableNodeKey: "k:orders" },
        shapeBaseline({ kind: "update_shape", target: "pay", label: "Billing", stableNodeKey: "k:pay" }, "s_planned"),
      ],
    });
    expect(set.changes.map((x) => (x.kind === "update_shape" ? x.expectedFingerprint : null))).toEqual([fingerprintShape("rectangle", "Orders"), "s_planned"]);
    // shapeBaseline stamps only an update_shape; an unknown current is left for the store to stamp.
    expect(shapeBaseline({ kind: "update_shape", target: "x", label: "y", stableNodeKey: "k" }, null)).not.toHaveProperty("expectedFingerprint");
    expect(shapeBaseline({ kind: "remove", target: "x" }, "s1")).toEqual({ kind: "remove", target: "x" });
    // It survives validation and a reload's round trip.
    expect(parseChangeSet(JSON.parse(JSON.stringify(set)))).toEqual(set);
  });

  it("a label edited after the proposal is withheld as a Keep mine / Use proposed decision, never overwritten", () => {
    const c = mixedCanvas({}, { orders: "Orders" });
    const pending = pendingOnMixed(c);
    pending.propose("cv", relabel({ orders: "Order intake" }));
    c.edit("orders", "Orders (mine)");
    const r = acceptMixed(pending, c);
    expect(r.stepId).toBeNull();
    expect(c.text("orders")).toBe("Orders (mine)");
    expect(r.stale).toEqual([
      {
        target: "orders",
        stableNodeKey: "k:orders",
        apply: { kind: "update_shape", target: "orders", label: "Order intake", stableNodeKey: "k:orders", expectedFingerprint: fingerprintShape("rectangle", "Orders (mine)") },
        changedSinceProposal: true,
      },
    ]);
    expect(pending.get("cv")!.conflicts).toMatchObject([{ target: "orders", changedSinceProposal: true }]);
    // The review's preview (no live readers) still shows it as proposed.
    expect(resolveChangeSet(pending.get("cv")!, () => true).stale).toEqual([]);
  });

  it("Keep mine: nothing is written and the review ends", () => {
    const c = mixedCanvas({}, { orders: "Orders" });
    const pending = pendingOnMixed(c);
    pending.propose("cv", relabel({ orders: "Order intake" }));
    c.edit("orders", "Orders (mine)");
    acceptMixed(pending, c);
    const r = acceptMixed(pending, c, new Map([["orders", "keep"]]));
    expect(r).toMatchObject({ stepId: null, applied: [], waiting: [], kept: 1, rest: null });
    expect(c.text("orders")).toBe("Orders (mine)");
    expect(pending.get("cv")).toBeNull();
  });

  it("Use proposed: the label replaces the edit as one undo step (undo returns the user's label); another edit first asks again", () => {
    const c = mixedCanvas({}, { orders: "Orders" });
    const pending = pendingOnMixed(c);
    pending.propose("cv", relabel({ orders: "Order intake" }));
    c.edit("orders", "Orders (mine)");
    acceptMixed(pending, c);
    c.edit("orders", "Orders (mine, again)");
    expect(acceptMixed(pending, c, new Map([["orders", "apply"]])).applied).toEqual([]);
    expect(c.text("orders")).toBe("Orders (mine, again)");
    const r = acceptMixed(pending, c, new Map([["orders", "apply"]]));
    expect(r.applied).toHaveLength(1);
    expect(c.text("orders")).toBe("Order intake");
    expect(pending.get("cv")).toBeNull();
    c.history.undo();
    expect(c.text("orders")).toBe("Orders (mine, again)");
  });

  it("an untouched label is written; one already changed to the proposed label is not a conflict; no baseline: as before", () => {
    const c = mixedCanvas({}, { a: "A", b: "B" });
    const set = withBaselines(parseChangeSet(relabel({ a: "A2", b: "B2" })), c.fingerprint);
    c.edit("b", "B2");
    const r = resolveChangeSet(set, () => true, c.canvas.contentOf, c.canvas.shapeOf);
    expect(r.changes.map((x) => ("target" in x ? x.target : ""))).toEqual(["a", "b"]);
    expect(r.stale).toEqual([]);
    c.edit("a", "A-mine");
    expect(resolveChangeSet(parseChangeSet(relabel({ a: "A2" })), () => true, c.canvas.contentOf, c.canvas.shapeOf).changes).toHaveLength(1);
    // A baselined relabel the canvas can't read as a shape asks; it is never written blind.
    expect(resolveChangeSet(set, () => true, c.canvas.contentOf, () => null).stale).toHaveLength(2);
  });

  it("a legacy proposal (stored without a baseline) asks Keep mine / Use proposed for a relabel too", async () => {
    const c = mixedCanvas({}, { orders: "Orders" });
    const meta = createMemoryServices().meta;
    await meta.set(PENDING_KEY, [{ canvasId: "cv", set: relabel({ orders: "Order intake" }), savedAt: Date.now() }]);
    c.edit("orders", "Orders (mine)"); // before the reload: a baseline stamped now would hide it
    const pending = pendingOnMixed(c);
    expect(await restorePendingProposals(meta, pending)).toBe(1);
    expect(pending.get("cv")!.changes[0]).toMatchObject({ kind: "update_shape", expectedFingerprint: UNKNOWN_BASELINE });
    acceptMixed(pending, c);
    expect(c.text("orders")).toBe("Orders (mine)");
    expect(pending.get("cv")!.conflicts).toMatchObject([{ target: "orders", changedSinceProposal: true }]);
    // Unless the shape already says what was proposed.
    c.edit("orders", "Order intake");
    const legacy = parseChangeSet(markLegacyBaselines(relabel({ orders: "Order intake" })));
    expect(resolveChangeSet(legacy, () => true, c.canvas.contentOf, c.canvas.shapeOf).changes).toHaveLength(1);
  });

  it("multi-target, one shape and one block: the untouched one applies as one undo step, the edited one waits; undo restores only the applied", () => {
    for (const edited of ["shape", "block"] as const) {
      const c = mixedCanvas({ retry: "Retry limit: 5" }, { orders: "Orders" });
      const pending = pendingOnMixed(c);
      pending.propose("cv", relabel({ orders: "Order intake" }, { retry: "Retry limit: 3" }));
      if (edited === "shape") c.edit("orders", "Orders (mine)");
      else c.edit("retry", "Retry limit: 4");
      const r = acceptMixed(pending, c);
      const [writtenId, waitingId] = edited === "shape" ? ["retry", "orders"] : ["orders", "retry"];
      expect(r.applied.map((x) => ("target" in x ? x.target : ""))).toEqual([writtenId]);
      expect(r.stepId).not.toBeNull();
      expect(pending.get("cv")!).toMatchObject({ operationId: "op_map.r1", changes: [], conflicts: [{ target: waitingId, changedSinceProposal: true }] });
      expect(c.text("orders")).toBe(edited === "shape" ? "Orders (mine)" : "Order intake");
      expect(c.text("retry")).toBe(edited === "shape" ? "Retry limit: 3" : "Retry limit: 4");
      c.history.undo();
      expect(c.text("orders")).toBe(edited === "shape" ? "Orders (mine)" : "Orders");
      expect(c.text("retry")).toBe(edited === "shape" ? "Retry limit: 5" : "Retry limit: 4");
    }
  });
});
