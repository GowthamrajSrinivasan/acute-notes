import { describe, expect, it } from "vitest";
import { parseChangeSet, type ChangeSet } from "@/ai/changes/changeSet";
import type { SceneElement } from "@/domain/canvas/adapter";
import { lensView, singleScene } from "./lensView";
import { lensPending, pendingFrames } from "./pending";

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return { x: 0, y: 0, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeWidth: 2, strokeStyle: "solid", ...partial };
}
const node = (id: string, label: string, frameId: string, x: number) => [
  el({ id, type: "rectangle", frameId, x, y: 20, customData: { acuteNode: { kind: "backend", key: `k.${id}` } } }),
  el({ id: `${id}_t`, type: "text", text: label, containerId: id, frameId }),
];
const frame = (id: string, name: string, x: number) => ({ ...el({ id, type: "frame", x, y: 0, width: 600, height: 200 }), name }) as SceneElement;

/** Payments (f1) with Orders → Ledger; Billing (f2) far to the right with one node. */
const SCENE: SceneElement[] = [
  frame("f1", "Payments", 0),
  ...node("orders", "Orders", "f1", 20),
  ...node("ledger", "Ledger", "f1", 300),
  el({ id: "a1", type: "arrow", x: 120, y: 45, points: [[0, 0], [180, 0]], startBinding: { elementId: "orders" }, endBinding: { elementId: "ledger" } }),
  frame("f2", "Billing", 2000),
  ...node("invoice", "Invoice", "f2", 2020),
];
const view = lensView(singleScene("c1", SCENE), { canvasId: "c1", frameId: "f1" })!;

const set = (operationId: string, changes: unknown[], extra: Record<string, unknown> = {}): ChangeSet =>
  parseChangeSet({ operationId, title: `Set ${operationId}`, metadata: { createdBy: "mcp", task: "repo_map" }, changes, ...extra });

describe("lensPending: proposed state on a Lens level, apart from its nodes (D3, plan §8.2)", () => {
  it("adds what a set creates inside the level, with its links to the level's nodes; skips what lands elsewhere", () => {
    const pending = lensPending(view, [
      set("op1", [
        { kind: "create_shape", key: "n_fraud", shape: "rectangle", label: "Fraud check", box: { x: 450, y: 120, width: 100, height: 50 }, semantics: { kind: "messagebus" } },
        { kind: "create_shape", key: "n_far", shape: "rectangle", label: "Elsewhere", box: { x: 5000, y: 0, width: 100, height: 50 } },
        { kind: "connect", key: "c1", from: { existing: "ledger" }, to: { created: "n_fraud" }, label: "checks" },
        { kind: "connect", key: "c2", from: { existing: "invoice" }, to: { created: "n_fraud" } },
      ]),
    ])!;
    expect(pending.added).toEqual([{ key: "op1:n_fraud", label: "Fraud check", box: { x: 450, y: 120, width: 100, height: 50 }, kind: "messagebus", operationId: "op1" }]);
    expect(pending.addedEdges).toEqual([{ key: "op1:c1", from: "ledger", to: "op1:n_fraud", label: "checks", operationId: "op1" }]);
    expect(pending.sets).toEqual([{ operationId: "op1", title: "Set op1", count: 2 }]);
    expect(pending.count).toBe(2);
    // The current graph is untouched: the ghost is not a node.
    expect(view.nodes.map((n) => n.label)).toEqual(["Orders", "Ledger"]);
  });

  it("marks what a set changes, removes or relinks, by node key, and a conflict as needing input", () => {
    const pending = lensPending(view, [
      set("op1", [
        { kind: "update_shape", target: "orders", label: "Order intake", stableNodeKey: "k" },
        { kind: "move", target: "orders", to: { x: 40, y: 20 } },
        { kind: "remove", target: "ledger" },
        { kind: "update_connection", target: "a1", relation: "calls" },
        { kind: "update_shape", target: "invoice", label: "Elsewhere", stableNodeKey: "k" },
      ]),
      set("op2", [{ kind: "remove", target: "a1" }], { session: "mcp_2", conflicts: [{ target: "orders", apply: { kind: "remove", target: "orders" } }] }),
    ])!;
    expect([...pending.changed]).toEqual([["k.orders", ["label", "moved", "conflict"]]]);
    expect([...pending.removed]).toEqual(["k.ledger"]);
    expect([...pending.changedEdges]).toEqual(["a1"]);
    expect([...pending.removedEdges]).toEqual(["a1"]);
    expect(pending.sets.map((s) => [s.operationId, s.count])).toEqual([["op1", 4], ["op2", 2]]);
  });

  it("leaves out a new section's cards (a new level), counts objects joining this frame, and is undefined when nothing touches it", () => {
    const section = set("op1", [
      { kind: "create_frame", key: "sec", title: "Detail", box: { x: 0, y: 0, width: 500, height: 150 }, children: ["inside"] },
      { kind: "create_shape", key: "inside", shape: "rectangle", label: "Inside the new section", box: { x: 20, y: 20, width: 100, height: 50 } },
    ]);
    expect(lensPending(view, [section])).toBeUndefined();
    const joining = set("op2", [
      { kind: "create_shape", key: "j", shape: "rectangle", label: "Joins Payments", box: { x: 700, y: 20, width: 100, height: 50 } },
      { kind: "update_frame", target: "f1", add: ["j"] },
    ]);
    expect(lensPending(view, [joining])?.added.map((g) => g.label)).toEqual(["Joins Payments"]);
    expect(lensPending(view, [set("op3", [{ kind: "remove", target: "invoice" }])])).toBeUndefined();
  });
});

describe("pendingFrames: the canvas chip's Δ per frame", () => {
  it("counts changes by the frame of what they touch (a label as its shape), creates by where they land", () => {
    const counts = pendingFrames(
      [
        set("op1", [
          { kind: "update_shape", target: "orders", label: "x", stableNodeKey: "k" },
          { kind: "remove", target: "invoice_t" },
          { kind: "create_shape", key: "n", shape: "rectangle", label: "New", box: { x: 100, y: 100, width: 100, height: 50 } },
          { kind: "create_frame", key: "sec", title: "S", box: { x: 4000, y: 0, width: 300, height: 100 }, children: ["m"] },
          { kind: "create_shape", key: "m", shape: "rectangle", label: "In the new section", box: { x: 4010, y: 10, width: 100, height: 50 } },
        ]),
      ],
      SCENE as never,
    );
    expect([...counts].sort()).toEqual([["f1", 2], ["f2", 1]]);
  });
});
