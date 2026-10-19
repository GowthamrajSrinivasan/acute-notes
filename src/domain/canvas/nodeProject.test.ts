import { describe, expect, it } from "vitest";
import { getNodeLens, getNodeSemantics, withNodeLens, withNodeProject, withNodeSemantics } from "./diagram";
import { getNodeProject, normalizeProject, PROJECT_KINDS, projectKindOf } from "./nodeProject";

const node = (acuteNode: Record<string, unknown>) => ({ customData: { acuteNode } });

describe("project-knowledge fields (D33)", () => {
  it("has the nine kinds D33 fixes", () => {
    expect([...PROJECT_KINDS]).toEqual(["project", "decision", "constraint", "finding", "open_question", "risk", "milestone", "progress_item", "annotation"]);
  });

  it("reads a decision with options and a chosen option, dropping a chosen that is not an option (D34)", () => {
    const ok = getNodeProject(node({ kind: "decision", status: "accepted", reason: " Latency ", options: [{ label: "Redis", tradeoffs: "fast" }, { label: "Memcached" }], chosen: "Redis", enforce: true }));
    expect(ok).toEqual({ status: "accepted", reason: "Latency", options: [{ label: "Redis", tradeoffs: "fast" }, { label: "Memcached" }], chosen: "Redis", enforce: true });
    const bad = getNodeProject(node({ kind: "decision", options: [{ label: "Redis" }], chosen: "Postgres" }));
    expect(bad?.chosen).toBeUndefined();
    expect(getNodeProject(node({ kind: "decision", chosen: "Redis" }))?.chosen).toBeUndefined();
  });

  it("drops fields that do not belong to the node's kind, one field at a time", () => {
    expect(getNodeProject(node({ kind: "finding", stage: "validated", note: "hypothesis", status: "done", severity: "high", enforce: true }))).toEqual({ stage: "validated", note: "hypothesis" });
    expect(getNodeProject(node({ kind: "constraint", enforce: true, status: "accepted" }))).toEqual({ status: "accepted" }); // a constraint always warns: no flag
    expect(getNodeProject(node({ kind: "progress_item", status: "blocked", order: 2, next: true, intent: "note" }))).toEqual({ status: "blocked", order: 2, next: true });
    expect(getNodeProject(node({ kind: "open_question", status: "answered", answer: "yes" }))).toEqual({ status: "answered", answer: "yes" });
    expect(getNodeProject(node({ kind: "risk", severity: "medium" }))).toEqual({ severity: "medium" });
    expect(getNodeProject(node({ kind: "milestone", order: 1 }))).toEqual({ order: 1 });
    expect(getNodeProject(node({ kind: "annotation", intent: "preference" }))).toEqual({ intent: "preference" });
    expect(getNodeProject(node({ kind: "project", style: "modular", focus: "auth" }))).toEqual({ style: "modular", focus: "auth" });
  });

  it("drops an invalid enum, an oversized text and a bad number without touching the others", () => {
    const p = getNodeProject(node({ kind: "progress_item", status: "finished", order: -1, next: "yes" }));
    expect(p).toBeUndefined();
    expect(getNodeProject(node({ kind: "decision", status: "accepted", reason: "x".repeat(900) }))?.reason).toHaveLength(500);
    expect(getNodeProject(node({ kind: "milestone", order: 1e9 }))).toBeUndefined();
  });

  it("limits options to six distinct labels", () => {
    const options = Array.from({ length: 9 }, (_, i) => ({ label: `o${i % 8}` }));
    expect(getNodeProject(node({ kind: "decision", options }))?.options).toHaveLength(6);
    expect(getNodeProject(node({ kind: "decision", options: [{ label: "a" }, { label: "a" }, { nope: 1 }] }))?.options).toEqual([{ label: "a" }]);
  });

  it("accepts project scope and refs on any node, deduplicated and capped (D39, D53)", () => {
    expect(getNodeProject(node({ project: "acme", refs: ["a.b", "a.b", " c ", 3, "x\ny"] }))).toEqual({ project: "acme", refs: ["a.b", "c"] });
    expect(getNodeProject(node({ kind: "backend", refs: ["k"] }))).toEqual({ refs: ["k"] });
    const many = Array.from({ length: 40 }, (_, i) => `k${i}`);
    expect(getNodeProject(node({ refs: many }))?.refs).toHaveLength(20);
    expect(getNodeProject(node({ refs: ["k".repeat(201)] }))).toBeUndefined();
  });

  it("is invisible to non-project input and tolerates a missing bag", () => {
    expect(getNodeProject({})).toBeUndefined();
    expect(getNodeProject({ customData: { acuteNode: "nope" } })).toBeUndefined();
    expect(projectKindOf(node({ kind: "decision" }))).toBe("decision");
    expect(projectKindOf(node({ kind: "backend" }))).toBeUndefined();
    expect(normalizeProject("finding", { stage: "ephemeral" })).toEqual({ stage: "ephemeral" });
  });
});

describe("the three halves of acuteNode keep each other", () => {
  const base = { acuteNode: { kind: "decision", sublabel: "s", key: "p.use-redis", expandsTo: { frameKey: "f2" }, status: "proposed", refs: ["cache"], project: "acme" } };

  it("setting the kind keeps the Lens and project halves", () => {
    const next = withNodeSemantics(base, { kind: "constraint", sublabel: "s" });
    expect(getNodeSemantics({ customData: next })?.kind).toBe("constraint");
    expect(getNodeLens({ customData: next })).toEqual({ key: "p.use-redis", expandsTo: { frameKey: "f2" } });
    expect(getNodeProject({ customData: next })).toEqual({ project: "acme", refs: ["cache"], status: "proposed" });
  });

  it("setting a Lens link keeps the semantics and project halves", () => {
    const next = withNodeLens(base, { key: "p.use-redis", expandsTo: undefined });
    expect(getNodeSemantics({ customData: next })).toEqual({ kind: "decision", sublabel: "s" });
    expect(getNodeProject({ customData: next })).toEqual({ project: "acme", refs: ["cache"], status: "proposed" });
    expect(getNodeLens({ customData: next })).toEqual({ key: "p.use-redis" });
  });

  it("setting project fields keeps the other halves and validates against the node's current kind", () => {
    const next = withNodeProject(base, { status: "accepted", options: [{ label: "Redis" }], chosen: "Redis", stage: "validated" });
    expect(getNodeProject({ customData: next })).toEqual({ status: "accepted", options: [{ label: "Redis" }], chosen: "Redis" });
    expect(getNodeLens({ customData: next })?.key).toBe("p.use-redis");
    expect(getNodeSemantics({ customData: next })).toEqual({ kind: "decision", sublabel: "s" });
  });

  it("clearing every half removes acuteNode", () => {
    const only = { acuteNode: { refs: ["k"] }, other: 1 };
    const cleared = withNodeProject(only, undefined);
    expect(cleared.acuteNode).toBeUndefined();
    expect(cleared.other).toBe(1);
  });

  it("a finding promoted to a decision keeps its key and refs, and sheds the finding-only fields (D33)", () => {
    const finding = { acuteNode: { kind: "finding", stage: "validated", note: "discovery", key: "p.f1", refs: ["cache"], project: "acme" } };
    const retyped = withNodeSemantics(finding, { kind: "decision" });
    // `withNodeProject` replaces the half (like `withNodeLens`), so a caller spreads what is there.
    const asDecision = withNodeProject(retyped, { ...getNodeProject({ customData: retyped }), status: "proposed", reason: "Validated in staging" });
    expect(getNodeSemantics({ customData: asDecision })?.kind).toBe("decision");
    expect(getNodeLens({ customData: asDecision })?.key).toBe("p.f1");
    expect(getNodeProject({ customData: asDecision })).toEqual({ project: "acme", refs: ["cache"], status: "proposed", reason: "Validated in staging" });
  });
});
