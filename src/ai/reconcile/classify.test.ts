import { describe, expect, it } from "vitest";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { reconcile, reviewItems, type ExistingObject } from "./classify";

const node = (key: string, label: string): VisualNode => ({ id: key, stableKey: key, type: "shape", content: { shape: "rectangle", label } });
const plan = (...nodes: VisualNode[]): VisualPlan => ({ version: 1, template: "flow", nodes, relationships: [] });
const fp = (n: VisualNode) => (n.type === "shape" ? `fp:${n.content.label}` : "fp:?");
/** An object as AI wrote it (current == baseline), optionally edited by the user since. */
const obj = (key: string, label: string, extra: Partial<ExistingObject> = {}): ExistingObject => ({
  objectId: `el_${key}`,
  stableNodeKey: key,
  baseline: `fp:${label}`,
  current: `fp:${label}`,
  excluded: false,
  shape: "shape",
  ...extra,
});

function run(previous: VisualPlan | null, next: VisualPlan, existing: ExistingObject[]) {
  return reconcile({ previous, next, existing, fingerprint: fp, objectKind: () => ({ shape: "shape" }) });
}
const states = (r: ReturnType<typeof run>) => r.items.map((i) => `${i.state}:${"node" in i ? i.node.stableKey : i.object.stableNodeKey}`);

const v1 = plan(node("a", "A"), node("b", "B"), node("c", "C"));
const onCanvas = () => [obj("a", "A"), obj("b", "B"), obj("c", "C")];

describe("reconcile — fixtures", () => {
  it("no change: every node unchanged, nothing to review", () => {
    const r = run(v1, v1, onCanvas());
    expect(states(r)).toEqual(["unchanged:a", "unchanged:b", "unchanged:c"]);
    expect(reviewItems(r)).toEqual([]);
  });

  it("add-only", () => {
    expect(states(run(v1, plan(...v1.nodes, node("d", "D")), onCanvas())).filter((s) => !s.startsWith("unchanged"))).toEqual(["add:d"]);
  });

  it("remove-only: a node gone from the content is a proposed removal, never silent", () => {
    expect(states(run(v1, plan(node("a", "A"), node("c", "C")), onCanvas())).filter((s) => !s.startsWith("unchanged"))).toEqual(["remove:b"]);
  });

  it("clean update: untouched since AI wrote it", () => {
    expect(states(run(v1, plan(node("a", "A"), node("b", "B2"), node("c", "C")), onCanvas()))).toEqual(["unchanged:a", "update_clean:b", "unchanged:c"]);
  });

  it("conflicting update: the user edited it since, so it is never clean", () => {
    const existing = [obj("a", "A"), obj("b", "B", { current: "fp:B (my edit)" }), obj("c", "C")];
    expect(states(run(v1, plan(node("a", "A"), node("b", "B2"), node("c", "C")), existing))).toEqual(["unchanged:a", "update_conflict:b", "unchanged:c"]);
  });

  it("a mix of all four in one document", () => {
    const existing = [obj("a", "A", { current: "fp:mine" }), obj("b", "B"), obj("c", "C")];
    const next = plan(node("a", "A2"), node("b", "B2"), node("d", "D")); // c removed
    expect(states(run(v1, next, existing))).toEqual(["update_conflict:a", "update_clean:b", "add:d", "remove:c"]);
  });
});

describe("reconcile — rules that keep user edits safe", () => {
  it("a user edit on a node whose source didn't change is left alone (not re-flagged every run)", () => {
    const existing = [obj("a", "A", { current: "fp:mine" }), obj("b", "B"), obj("c", "C")];
    expect(states(run(v1, v1, existing))).toEqual(["unchanged:a", "unchanged:b", "unchanged:c"]);
  });

  it("an accepted update that was undone is proposed again when the same text is re-run", () => {
    // v2 changed b to B2 and was accepted (source now at v2), then Ctrl+Z put b back at its v1 content.
    const v2 = plan(node("a", "A"), node("b", "B2"), node("c", "C"));
    const existing = [obj("a", "A", { version: 1 }), obj("b", "B", { version: 1 }), obj("c", "C", { version: 1 })];
    const r = reconcile({ previous: v2, previousVersion: 2, next: v2, existing, fingerprint: fp, objectKind: () => ({ shape: "shape" }) });
    expect(states(r)).toEqual(["unchanged:a", "update_clean:b", "unchanged:c"]);
  });

  it("a “Keep mine” (baseline = the user's content, stamped at the version) is not overwritten when nothing further changed", () => {
    const v2 = plan(node("a", "A2"), node("b", "B"), node("c", "C"));
    const existing = [obj("a", "mine", { version: 2 }), obj("b", "B", { version: 1 }), obj("c", "C", { version: 1 })];
    const r = reconcile({ previous: v2, previousVersion: 2, next: v2, existing, fingerprint: fp, objectKind: () => ({ shape: "shape" }) });
    expect(reviewItems(r)).toEqual([]);
  });

  it("an object whose content isn't loaded counts as edited: never overwritten blind", () => {
    const existing = [obj("a", "A", { current: null }), obj("b", "B"), obj("c", "C")];
    expect(states(run(v1, plan(node("a", "A2"), node("b", "B"), node("c", "C")), existing))[0]).toBe("update_conflict:a");
  });

  it("an object already showing the proposal is unchanged (e.g. the user typed exactly the new text)", () => {
    const existing = [obj("a", "A", { current: "fp:A2" }), obj("b", "B"), obj("c", "C")];
    expect(states(run(v1, plan(node("a", "A2"), node("b", "B"), node("c", "C")), existing))[0]).toBe("unchanged:a");
  });

  it("an opted-out object is skipped whatever happens to its node — updated, removed or not", () => {
    const existing = [obj("a", "A", { excluded: true }), obj("b", "B", { excluded: true }), obj("c", "C")];
    const r = run(v1, plan(node("a", "A2"), node("c", "C")), existing);
    expect(states(r)).toEqual(["unchanged:c"]);
    expect(r.skipped.map((o) => o.stableNodeKey).sort()).toEqual(["a", "b"]);
  });

  it("matches by key, never by position: reordering changes nothing", () => {
    expect(reviewItems(run(v1, plan(node("c", "C"), node("a", "A"), node("b", "B")), onCanvas()))).toEqual([]);
  });

  it("a node that can't update its object in place (a shape that became a block) is remove + add", () => {
    const r = reconcile({ previous: v1, next: plan(node("a", "A2")), existing: [obj("a", "A")], fingerprint: fp, objectKind: () => ({ shape: "block", blockType: "table" }) });
    expect(r.items.map((i) => i.state)).toEqual(["remove", "add"]);
  });

  it("with no previous plan, a changed proposal on an untouched object is a clean update", () => {
    expect(states(run(null, plan(node("a", "A2")), [obj("a", "A")]))).toEqual(["update_clean:a"]);
  });
});

describe("reconcile — a block the user split (F42 Phase 4)", () => {
  // "b" was split into two pieces; its original object is gone.
  const pieces = (fingerprint = "fp:B", extra: Partial<ExistingObject> = {}) => [
    obj("b ⊃ piece#0", "B1", { objectId: "obj_p0", splitOf: { stableNodeKey: "b", fingerprint }, ...extra }),
    obj("b ⊃ piece#1", "B2", { objectId: "obj_p1", splitOf: { stableNodeKey: "b", fingerprint } }),
  ];
  const split = () => [obj("a", "A"), ...pieces(), obj("c", "C")];

  it("an unchanged source keeps the split: the block isn't added back and no piece is removed", () => {
    const r = run(v1, v1, split());
    expect(reviewItems(r)).toEqual([]);
    expect(r.splits).toEqual([{ node: v1.nodes[1], pieces: pieces(), changed: false }]);
  });

  it("a source that changed the split block keeps the split, and says it changed", () => {
    const r = run(v1, plan(node("a", "A"), node("b", "B, revised"), node("c", "C")), split());
    expect(reviewItems(r)).toEqual([]);
    expect(r.splits.map((s) => [s.node.stableKey, s.changed])).toEqual([["b", true]]);
  });

  it("a change reported once isn't reported again while the source stays silent about it", () => {
    const v2 = plan(node("a", "A"), node("b", "B, revised"), node("c", "C"));
    expect(run(v2, v2, split()).splits[0]!.changed).toBe(false);
  });

  it("a split block the source no longer has: its pieces are removed, an opted-out piece stays", () => {
    const r = run(v1, plan(node("a", "A"), node("c", "C")), [obj("a", "A"), ...pieces("fp:B", { excluded: true }), obj("c", "C")]);
    expect(states(r)).toEqual(["unchanged:a", "unchanged:c", "remove:b ⊃ piece#1"]);
    expect(r.skipped.map((o) => o.objectId)).toEqual(["obj_p0"]);
  });

  it("pieces stay beside a copy of the original block, which is reconciled as usual", () => {
    const r = run(v1, v1, [obj("a", "A"), obj("b", "B"), ...pieces(), obj("c", "C")]);
    expect(reviewItems(r)).toEqual([]);
    expect(r.splits).toEqual([]);
  });
});

describe("reconcile — performance (§13.15.21)", () => {
  it("diff + match for 50 nodes against 50 objects stays far inside a frame", () => {
    const nodes = Array.from({ length: 50 }, (_, i) => node(`k${i}`, `L${i}`));
    const existing = nodes.map((n, i) => obj(n.stableKey!, `L${i}`, i % 5 === 0 ? { current: "fp:edited" } : {}));
    const next = plan(...nodes.map((n, i) => (i % 3 === 0 ? node(n.stableKey!, `L${i} v2`) : n)));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) run(plan(...nodes), next, existing);
    expect((performance.now() - t0) / 20).toBeLessThan(16);
  });
});
