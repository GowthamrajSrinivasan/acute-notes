import { describe, expect, it } from "vitest";
import { RELATION_TYPES } from "../types";
import type { SceneElement } from "./adapter";
import {
  dropsLensKeyOnCopy,
  frameGraph,
  getDiagramMeta,
  getEdgeSemantics,
  getFrameLens,
  getNodeLens,
  getNodeSemantics,
  interactiveFrameOf,
  kindCounts,
  nodeNeighborhood,
  RELATION_LABELS,
  withDiagramMeta,
  withFrameLens,
  withNodeLens,
  withNodeSemantics,
} from "./diagram";

function el(partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    locked: false,
    opacity: 100,
    isDeleted: false,
    groupIds: [],
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    strokeWidth: 2,
    strokeStyle: "solid",
    ...partial,
  };
}

const node = (id: string, label: string, kind?: string, frameId = "f1") => [
  el({ id, type: "rectangle", frameId, ...(kind ? { customData: { acuteNode: { kind, sublabel: `${label} sub` } } } : {}) }),
  el({ id: `${id}_t`, type: "text", text: label, containerId: id, frameId }),
];
const arrow = (id: string, from: string, to: string, extra: Partial<SceneElement> = {}) =>
  el({ id, type: "arrow", x: 10, y: 20, points: [[0, 0], [50, 0]], startBinding: { elementId: from }, endBinding: { elementId: to }, ...extra });

const scene: SceneElement[] = [
  { ...el({ id: "f1", type: "frame", customData: { acuteDiagram: { type: "architecture", interactive: true, cards: [{ title: "Cost", items: ["cheap", ""] }] } } }), name: "RAG" } as SceneElement,
  ...node("ui", "CLI", "frontend"),
  ...node("router", "Router", "backend"),
  ...node("db", "Index", "database"),
  ...node("outside", "Other", "backend", "f2"),
  arrow("a1", "ui", "router"),
  el({ id: "a1_t", type: "text", text: "question", containerId: "a1" }),
  arrow("a2", "router", "db", { customData: { acuteRelation: "depends_on", acuteEdge: { explanation: " owner lookup " } } }),
  arrow("a3", "router", "outside"),
  arrow("a4", "ui", "gone"),
];

describe("diagram semantics", () => {
  it("normalises node semantics and drops unknown kinds and empty text", () => {
    expect(getNodeSemantics({ customData: { acuteNode: { kind: "nope", sublabel: "  ", tag: "x", details: ["a", 3, " "] } } })).toEqual({ tag: "x", details: ["a"] });
    expect(getNodeSemantics({ customData: { acuteNode: {} } })).toBeUndefined();
    expect(withNodeSemantics({ other: 1, acuteNode: { kind: "backend" } }, { sublabel: " " })).toEqual({ other: 1 });
    expect(withNodeSemantics(undefined, { kind: "cloud" })).toEqual({ acuteNode: { kind: "cloud" } });
  });

  it("reads diagram meta only for the architecture type", () => {
    expect(getDiagramMeta({ customData: { acuteDiagram: { type: "flow", interactive: true } } })).toBeUndefined();
    expect(getDiagramMeta(scene[0]!)).toEqual({ type: "architecture", interactive: true, cards: [{ title: "Cost", items: ["cheap"] }] });
    expect(withDiagramMeta({ acuteDiagram: { type: "architecture" } }, undefined)).toEqual({});
  });

  it("reads edge explanations", () => {
    expect(getEdgeSemantics(scene.find((e) => e.id === "a2")!)).toEqual({ explanation: "owner lookup" });
  });

  it("reads an AI link's confidence (0–1, Lens §6.3), dropping one out of range", () => {
    expect(getEdgeSemantics({ customData: { acuteEdge: { confidence: 0.65 } } })).toEqual({ confidence: 0.65 });
    expect(getEdgeSemantics({ customData: { acuteEdge: { confidence: 0 } } })).toEqual({ confidence: 0 });
    expect(getEdgeSemantics({ customData: { acuteEdge: { confidence: 3, explanation: "why" } } })).toEqual({ explanation: "why" });
    expect(getEdgeSemantics({ customData: { acuteEdge: { confidence: "high" } } })).toBeUndefined();
    const withConfidence = scene.map((e) => (e.id === "a2" ? { ...e, customData: { ...e.customData, acuteEdge: { explanation: "owner lookup", confidence: 0.4 } } } : e));
    expect(frameGraph(withConfidence, "f1")!.edges.find((e) => e.id === "a2")).toMatchObject({ explanation: "owner lookup", confidence: 0.4 });
  });

  it("labels every relation type", () => {
    for (const type of RELATION_TYPES) expect(RELATION_LABELS[type]).toMatch(/\S/);
  });
});

describe("Lens fields (acute-lens-plan §3)", () => {
  const lens = { key: "payments.webhook", expandsTo: { frameKey: "webhook-flow", canvasId: "c2" }, sources: [{ path: "src/payment.service.ts", lines: [143, 158] as [number, number], commit: "abc123" }] };

  it("normalises node Lens fields and drops malformed ones", () => {
    expect(getNodeLens({ customData: { acuteNode: { kind: "backend", ...lens } } })).toEqual(lens);
    expect(
      getNodeLens({
        customData: {
          acuteNode: {
            key: "  ",
            expandsTo: { canvasId: "c2" },
            sources: [{ path: "a.ts", lines: [9, 3], commit: "not a sha!" }, { path: "" }, { path: "b.ts", lines: [0, 2] }, "x"],
          },
        },
      }),
    ).toEqual({ sources: [{ path: "a.ts" }, { path: "b.ts" }] });
    expect(getNodeLens({ customData: { acuteNode: { key: "x".repeat(201) } } })).toBeUndefined();
    expect(getNodeLens({ customData: { acuteNode: { key: "a\nb" } } })).toBeUndefined();
    expect(getNodeLens({ customData: { acuteNode: { sources: Array.from({ length: 12 }, (_, i) => ({ path: `f${i}.ts` })) } } })?.sources).toHaveLength(8);
  });

  it("keeps the Lens half when the semantics change, and the semantics when the Lens half changes", () => {
    const withBoth = withNodeLens({ other: 1, acuteNode: { kind: "backend", sublabel: "api" } }, lens);
    expect(withBoth.acuteNode).toEqual({ kind: "backend", sublabel: "api", ...lens });
    // Changing the kind (the panel's Kind field) keeps the detail link…
    const rekinded = withNodeSemantics(withBoth, { ...getNodeSemantics({ customData: withBoth }), kind: "database" });
    expect(getNodeLens({ customData: rekinded })).toEqual(lens);
    // …clearing the semantics keeps it too…
    expect(withNodeSemantics(withBoth, undefined).acuteNode).toEqual(lens);
    // …and clearing the Lens half keeps the semantics.
    expect(withNodeLens(rekinded, undefined)).toEqual({ other: 1, acuteNode: { kind: "database", sublabel: "api" } });
    expect(withNodeLens(withNodeSemantics(withBoth, undefined), undefined)).toEqual({ other: 1 });
  });

  it("never reads Lens fields as semantics, or semantics as Lens fields", () => {
    expect(getNodeSemantics({ customData: { acuteNode: lens } })).toBeUndefined();
    expect(getNodeLens({ customData: { acuteNode: { kind: "backend" } } })).toBeUndefined();
  });

  it("normalises frame Lens fields and keeps them across diagram-meta writes", () => {
    expect(getFrameLens({ customData: { acuteDiagram: { level: 2, lensKey: "payments", profile: "architecture" } } })).toEqual({ level: 2, lensKey: "payments", profile: "architecture" });
    expect(getFrameLens({ customData: { acuteDiagram: { level: 6, lensKey: 3, profile: "meeting" } } })).toBeUndefined();
    expect(getFrameLens({ customData: { acuteDiagram: { level: 1.5 } } })).toBeUndefined();

    const framed = withFrameLens({ acuteDiagram: { type: "architecture", interactive: true } }, { level: 1, lensKey: "platform" });
    // Toggling "Interactive diagram" off and on (diagramNodes.ts) keeps the level and key.
    const off = withDiagramMeta(framed, { ...getDiagramMeta({ customData: framed })!, interactive: false });
    expect(getFrameLens({ customData: off })).toEqual({ level: 1, lensKey: "platform" });
    expect(getDiagramMeta({ customData: off })?.interactive).toBe(false);
    // Removing the diagram meta keeps the Lens half, which alone doesn't make an architecture frame.
    const bare = withDiagramMeta(framed, undefined);
    expect(bare.acuteDiagram).toEqual({ level: 1, lensKey: "platform" });
    expect(getDiagramMeta({ customData: bare })).toBeUndefined();
    expect(withFrameLens(bare, undefined)).toEqual({});
  });
});

describe("frameGraph", () => {
  const graph = frameGraph(scene, "f1")!;

  it("collects the frame's shapes and the arrows between them", () => {
    expect(graph.title).toBe("RAG");
    expect(graph.nodes.map((n) => [n.id, n.label, n.semantics.kind])).toEqual([
      ["ui", "CLI", "frontend"],
      ["router", "Router", "backend"],
      ["db", "Index", "database"],
    ]);
    // a3 leaves the frame, a4 points at nothing: not part of this diagram.
    expect(graph.edges.map((e) => e.id)).toEqual(["a1", "a2"]);
    expect(graph.edges[0]).toMatchObject({ from: "ui", to: "router", label: "question", points: [[10, 20], [60, 20]] });
    expect(graph.edges[1]).toMatchObject({ relation: "depends_on", explanation: "owner lookup" });
  });

  it("gives a node's relationships and reach", () => {
    const hood = nodeNeighborhood(graph, "router")!;
    expect(hood.incoming.map((r) => r.neighbor.id)).toEqual(["ui"]);
    expect(hood.outgoing.map((r) => r.neighbor.id)).toEqual(["db"]);
    expect(nodeNeighborhood(graph, "ui")).toMatchObject({ upstream: 0, downstream: 2 });
    expect(nodeNeighborhood(graph, "db")).toMatchObject({ upstream: 2, downstream: 0 });
    expect(nodeNeighborhood(graph, "outside")).toBeUndefined();
  });

  it("counts kinds for the legend", () => {
    expect(kindCounts(graph)).toEqual([
      { kind: "frontend", count: 1 },
      { kind: "backend", count: 1 },
      { kind: "database", count: 1 },
    ]);
  });

  it("finds the interactive frame of a member, and only when interactive", () => {
    const ui = scene.find((e) => e.id === "ui")!;
    expect(interactiveFrameOf(scene, ui)?.id).toBe("f1");
    const plain = scene.map((e) => (e.id === "f1" ? { ...e, customData: { acuteDiagram: { type: "architecture", interactive: false } } } : e));
    expect(interactiveFrameOf(plain, ui)).toBeUndefined();
  });
});

describe("the Lens copy rule (plan §3.1.1, D59)", () => {
  it("drops a copied node's key and keeps everything else, its own refs and project fields included", () => {
    const copy = el({
      id: "n2",
      type: "rectangle",
      customData: { acuteNode: { kind: "decision", status: "accepted", key: "f.cache", refs: ["f.db"], expandsTo: { frameKey: "f2" }, sources: [{ path: "a.ts" }] }, other: 1 },
    });
    const next = dropsLensKeyOnCopy(copy)!;
    expect(getNodeLens({ customData: next })).toEqual({ expandsTo: { frameKey: "f2" }, sources: [{ path: "a.ts" }] });
    expect(next.acuteNode).toMatchObject({ kind: "decision", status: "accepted", refs: ["f.db"] });
    expect(next.other).toBe(1);
  });

  it("drops a copied frame's lensKey (a moved frame's pinned key stays with the original), keeping level and profile", () => {
    const frame = el({ id: "f9", type: "frame", customData: { acuteDiagram: { type: "architecture", interactive: true, lensKey: "f1", level: 2, profile: "project" } } });
    const next = dropsLensKeyOnCopy(frame)!;
    expect(getFrameLens({ customData: next })).toEqual({ level: 2, profile: "project" });
    expect(getDiagramMeta({ customData: next })).toMatchObject({ interactive: true });
  });

  it("leaves keyless nodes and frames, and non-node elements, alone", () => {
    expect(dropsLensKeyOnCopy(el({ id: "a", type: "rectangle", customData: { acuteNode: { kind: "backend" } } }))).toBeNull();
    expect(dropsLensKeyOnCopy(el({ id: "f", type: "frame", customData: { acuteDiagram: { type: "architecture", interactive: true } } }))).toBeNull();
    expect(dropsLensKeyOnCopy(el({ id: "t", type: "text", customData: { acuteNode: { key: "x" } } }))).toBeNull();
  });
});
