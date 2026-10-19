import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { buildWorkspaceGraph, frameLevelOf, resolve, type GraphNode } from "@/domain/project/workspaceGraph";
import { locateInLens } from "./locate";
import type { SceneSource } from "./lensView";
import { findTraceEnd, reachableFrom, reachKey, tracePath } from "./trace";

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return { x: 0, y: 0, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#1e1e1e", backgroundColor: "transparent", strokeWidth: 2, strokeStyle: "solid", ...partial };
}
const node = (id: string, label: string, frameId: string, extra: Record<string, unknown> = {}) => [
  el({ id, type: "rectangle", frameId, customData: { acuteNode: { kind: "backend", key: id, ...extra } } }),
  el({ id: `${id}_t`, type: "text", text: label, containerId: id, frameId }),
];
const frame = (id: string, name: string, diagram: Record<string, unknown> = { type: "architecture", interactive: true }) =>
  ({ ...el({ id, type: "frame", width: 600, height: 300, customData: { acuteDiagram: diagram } }), name }) as SceneElement;
const arrow = (id: string, from: string, to: string, relation?: string, explanation?: string) =>
  el({ id, type: "arrow", startBinding: { elementId: from }, endBinding: { elementId: to }, customData: { ...(relation ? { acuteRelation: relation } : {}), ...(explanation ? { acuteEdge: { explanation } } : {}) } } as never);

/**
 * Canvas "arch": L1 "Shop" — Checkout calls Payments, Payments writes Ledger; Payments drills into "Payments detail"
 * (L2) — Webhook flows_to Handler. Canvas "ops": L1 "Ops" — Alerts depends_on Handler? No: cross-canvas arrows don't
 * exist; Ops' "Monitor" drills (expandsTo, across canvases) into "Payments detail".
 */
const ARCH: SceneElement[] = [
  frame("shop", "Shop"),
  ...node("checkout", "Checkout", "shop"),
  ...node("payments", "Payments", "shop", { expandsTo: { frameKey: "pay-detail" } }),
  ...node("ledger", "Ledger", "shop", { sources: [{ path: "src/ledger.ts", lines: [3, 9] }] }),
  arrow("a1", "checkout", "payments", "calls", "Checkout charges the card"),
  arrow("a2", "payments", "ledger", "writes"),
  { ...frame("pd", "Payments detail", { type: "architecture", interactive: true, lensKey: "pay-detail" }) },
  ...node("webhook", "Webhook", "pd"),
  ...node("handler", "Handler", "pd"),
  arrow("a3", "webhook", "handler", "flows_to"),
];
const OPS: SceneElement[] = [frame("ops", "Ops"), ...node("monitor", "Monitor", "ops", { expandsTo: { frameKey: "pay-detail", canvasId: "arch" } }), ...node("pager", "Pager", "ops"), arrow("a4", "pager", "monitor", "depends_on")];

const g = buildWorkspaceGraph([
  { canvasId: "arch", elements: ARCH },
  { canvasId: "ops", elements: OPS },
]);
const n = (ref: string) => resolve(g, ref) as GraphNode;

describe("tracePath (Phase 3 BFS)", () => {
  it("follows relations along the arrows, naming each hop and its explanation", () => {
    const path = tracePath(g, n("checkout"), n("ledger"))!;
    expect(path.directed).toBe(true);
    expect(path.stops.map((s) => s.label)).toEqual(["Checkout", "Payments", "Ledger"]);
    expect(path.hops.map((h) => h.text)).toEqual(["Checkout calls Payments", "Payments writes Ledger"]);
    expect(path.hops[0]).toMatchObject({ via: "relation", relation: "calls", forward: true, arrowId: "a1", explanation: "Checkout charges the card" });
    // Evidence per stop: the Ledger's code.
    expect(path.stops[2]!.code.map((c) => c.label)).toEqual(["src/ledger.ts:3-9"]);
  });

  it("crosses levels through drill links (zoom in), with the levels named", () => {
    const path = tracePath(g, n("checkout"), n("handler"))!;
    expect(path.stops.map((s) => s.label)).toEqual(["Checkout", "Payments", "Handler"]);
    expect(path.hops[1]).toMatchObject({ via: "zoom_in", text: "Payments contains Handler (zoom in, L1 → L2)" });
    expect(path.stops.map((s) => s.level)).toEqual([1, 1, 2]);
  });

  it("crosses canvases through an expandsTo link, and zooms out", () => {
    const path = tracePath(g, n("pager"), n("ledger"))!;
    expect(path.stops.map((s) => `${s.canvasId}:${s.label}`)).toEqual(["ops:Pager", "ops:Monitor", "arch:Webhook", "arch:Payments", "arch:Ledger"]);
    expect(path.hops.map((h) => h.via)).toEqual(["relation", "zoom_in", "zoom_out", "relation"]);
  });

  it("filters relations by kind; level hops are always allowed", () => {
    // Data: flows_to and writes count, calls doesn't.
    expect(tracePath(g, n("checkout"), n("ledger"), "data")).toBeUndefined();
    expect(tracePath(g, n("payments"), n("ledger"), "data")?.hops.map((h) => h.relation)).toEqual(["writes"]);
    // Execution follows calls; then a level hop.
    expect(tracePath(g, n("checkout"), n("webhook"), "execution")?.hops.map((h) => h.via)).toEqual(["relation", "zoom_in"]);
  });

  it("prefers a path along the arrows; falls back to one against them, marking the hops", () => {
    const back = tracePath(g, n("ledger"), n("checkout"))!;
    expect(back.directed).toBe(false);
    expect(back.hops.map((h) => h.forward)).toEqual([false, false]);
    expect(back.hops[0]!.text).toBe("Payments writes Ledger (against the arrow)");
  });

  it("returns a zero-hop path for the same node, and none past maxHops", () => {
    expect(tracePath(g, n("checkout"), n("checkout"))).toMatchObject({ stops: [{ label: "Checkout" }], hops: [] });
    expect(tracePath(g, n("checkout"), n("ledger"), "any", 1)).toBeUndefined();
  });
});

describe("reachableFrom (the pick-the-end step)", () => {
  const ids = (m: ReturnType<typeof reachableFrom>) => [...m.values()].map((r) => r.node.id).sort();

  it("lists what a trace can end at, across levels, leaving the start out", () => {
    const reach = reachableFrom(g, n("checkout"));
    // Through Payments' drill link into its detail level, and on across canvases to Ops' Monitor and Pager.
    expect(ids(reach)).toEqual(["handler", "ledger", "monitor", "pager", "payments", "webhook"]);
    expect(reach.has(reachKey(n("checkout")))).toBe(false);
  });

  it("marks nodes only reachable against the arrows as not directed", () => {
    const reach = reachableFrom(g, n("ledger"));
    expect(reach.get(reachKey(n("payments")))?.directed).toBe(false);
    expect(reach.get(reachKey(n("checkout")))?.directed).toBe(false);
    expect(reachableFrom(g, n("checkout")).get(reachKey(n("ledger")))?.directed).toBe(true);
  });

  it("agrees with tracePath: a node is listed exactly when picking it gives a path", () => {
    for (const kind of ["any", "data", "execution", "dependency"] as const) {
      for (const from of g.nodes) {
        const reach = reachableFrom(g, from, kind);
        for (const to of g.nodes) {
          if (to === from) continue;
          expect(reach.has(reachKey(to)), `${kind}: ${from.id} → ${to.id}`).toBe(!!tracePath(g, from, to, kind));
        }
      }
    }
  });

  it("respects the kind filter and maxHops", () => {
    // Checkout only calls (not data), so nothing is reachable from it as data; Payments writes and zooms in.
    expect(ids(reachableFrom(g, n("checkout"), "data"))).toEqual([]);
    expect(ids(reachableFrom(g, n("payments"), "data"))).toEqual(["handler", "ledger", "monitor", "webhook"]);
    expect(ids(reachableFrom(g, n("checkout"), "any", 1))).toEqual(["payments"]);
  });
});

describe("findTraceEnd", () => {
  it("resolves keys, ids and labels; a frame names the node that drills into it", () => {
    expect(findTraceEnd(g, "payments")).toMatchObject({ ok: true, node: { label: "Payments" } });
    expect(findTraceEnd(g, "ledger_t")).toMatchObject({ ok: false });
    expect(findTraceEnd(g, "WEBHOOK")).toMatchObject({ ok: true, node: { id: "webhook" } });
    expect(findTraceEnd(g, "Handl")).toMatchObject({ ok: true, node: { id: "handler" } });
    expect(findTraceEnd(g, "pay-detail")).toMatchObject({ ok: true, node: { id: "payments" } });
    expect(findTraceEnd(g, "shop")).toMatchObject({ ok: false, reason: "not_a_node" });
  });

  it("refuses an ambiguous label with candidates, and an unknown one", () => {
    const end = findTraceEnd(g, "e"); // in Checkout, Ledger, Webhook, Handler, Monitor, Pager
    expect(end).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(!end.ok && end.candidates.length).toBeGreaterThan(1);
    expect(findTraceEnd(g, "Nothing like it")).toMatchObject({ ok: false, reason: "not_found" });
  });
});

describe("levels and locating a node in Lens", () => {
  it("infers a frame's level from its drill parent; an explicit level wins", () => {
    const pd = g.frames.find((f) => f.id === "pd")!;
    expect(frameLevelOf(g, pd)).toBe(2);
    const g2 = buildWorkspaceGraph([{ canvasId: "arch", elements: ARCH.map((e) => (e.id === "shop" ? { ...e, customData: { acuteDiagram: { type: "architecture", interactive: true, level: 0 } } } : e)) }]);
    expect(frameLevelOf(g2, g2.frames.find((f) => f.id === "pd")!)).toBe(1);
  });

  it("finds the root and the drill path to a node's level", () => {
    const byId = new Map([
      ["arch", ARCH],
      ["ops", OPS],
    ]);
    const scenes: SceneSource = { elements: (id) => byId.get(id) };
    expect(locateInLens(g, scenes, n("handler"))).toEqual({ root: { canvasId: "arch", frameId: "shop" }, path: ["payments"], nodeKey: "handler" });
    expect(locateInLens(g, scenes, n("checkout"))).toEqual({ root: { canvasId: "arch", frameId: "shop" }, path: [], nodeKey: "checkout" });
  });
});
