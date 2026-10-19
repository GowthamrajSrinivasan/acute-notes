import { describe, expect, it } from "vitest";
import { getNodeLens, getNodeSemantics, withNodeLens, withNodeProject, withNodeSemantics } from "./diagram";
import { applyNodePatch, describeNodePatch, kindChangeStyle, nodeKindIn } from "./nodePatch";
import { getNodeProject } from "./nodeProject";
import { NODE_KIND_STYLES, PLAIN_NODE_STYLE } from "./nodeKindStyle";

const lens = { key: "k1", expandsTo: { frameKey: "f1" }, sources: [{ path: "a.ts" }] };

function nodeData(kind: string, project: Record<string, unknown> = {}) {
  let cd = withNodeSemantics({ other: 1 }, { kind: kind as never, sublabel: "sub" });
  cd = withNodeLens(cd, lens);
  return withNodeProject(cd, project);
}

describe("applyNodePatch", () => {
  it("merges: status done keeps key, refs and project", () => {
    const cd = nodeData("progress_item", { project: "p1", refs: ["x"], status: "in_progress", order: 2 });
    const next = applyNodePatch(cd, { status: "done" });
    expect(getNodeProject({ customData: next })).toEqual({ project: "p1", refs: ["x"], status: "done", order: 2 });
    expect(getNodeLens({ customData: next })).toEqual(lens);
    expect(getNodeSemantics({ customData: next })).toEqual({ kind: "progress_item", sublabel: "sub" });
    expect(next.other).toBe(1);
  });

  it("null clears a field", () => {
    const cd = nodeData("progress_item", { refs: ["x"], status: "blocked" });
    const next = applyNodePatch(cd, { refs: null, sublabel: null });
    expect(getNodeProject({ customData: next })).toEqual({ status: "blocked" });
    expect(getNodeSemantics({ customData: next })).toEqual({ kind: "progress_item" });
  });

  it("promotes a finding to a decision, keeping key and refs and shedding stage", () => {
    const cd = nodeData("finding", { refs: ["r"], stage: "validated", note: "hypothesis" });
    const next = applyNodePatch(cd, { kind: "decision", status: "proposed", reason: "because" });
    expect(getNodeSemantics({ customData: next })?.kind).toBe("decision");
    expect(getNodeProject({ customData: next })).toEqual({ refs: ["r"], status: "proposed", reason: "because" });
    expect(getNodeLens({ customData: next })?.key).toBe("k1");
  });

  it("drops only a chosen that is not among the options", () => {
    const cd = nodeData("decision", { status: "proposed", options: [{ label: "A" }, { label: "B" }] });
    const bad = applyNodePatch(cd, { chosen: "Z", status: "accepted" });
    expect(getNodeProject({ customData: bad })).toEqual({ status: "accepted", options: [{ label: "A" }, { label: "B" }] });
    const ok = applyNodePatch(cd, { chosen: "B" });
    expect(getNodeProject({ customData: ok })?.chosen).toBe("B");
  });

  it("drops project fields that do not apply to the resulting kind, not the whole patch", () => {
    const cd = nodeData("finding", {});
    const next = applyNodePatch(cd, { severity: "high", stage: "validated", tag: "t" });
    expect(getNodeProject({ customData: next })).toEqual({ stage: "validated" });
    expect(getNodeSemantics({ customData: next })?.tag).toBe("t");
  });

  it("never lets Lens fields through, even if present on the object", () => {
    const cd = nodeData("backend");
    const next = applyNodePatch(cd, { key: "evil", expandsTo: { frameKey: "x" }, sources: [] } as never);
    expect(getNodeLens({ customData: next })).toEqual(lens);
  });

  it("works on a node with no customData", () => {
    const next = applyNodePatch(undefined, { kind: "risk", severity: "high" });
    expect(getNodeSemantics({ customData: next })?.kind).toBe("risk");
    expect(getNodeProject({ customData: next })).toEqual({ severity: "high" });
  });
});

describe("kindChangeStyle", () => {
  it("styles a new kind, restores plain only when untouched, and ignores no change", () => {
    expect(kindChangeStyle({}, "finding", "decision")).toEqual({ strokeColor: NODE_KIND_STYLES.decision.strokeColor, backgroundColor: NODE_KIND_STYLES.decision.backgroundColor });
    expect(kindChangeStyle({ ...NODE_KIND_STYLES.finding }, "finding", undefined)).toEqual(PLAIN_NODE_STYLE);
    expect(kindChangeStyle({ strokeColor: "#000", backgroundColor: "#fff" }, "finding", undefined)).toBeUndefined();
    expect(kindChangeStyle({}, "finding", "finding")).toBeUndefined();
    expect(nodeKindIn(nodeData("risk"))).toBe("risk");
  });
});

describe("describeNodePatch", () => {
  it("lists changes and clears", () => {
    expect(describeNodePatch({ status: "in_progress", reason: null, refs: ["a", "b"] })).toBe("refs → 2, status → in progress, reason cleared");
  });
});
