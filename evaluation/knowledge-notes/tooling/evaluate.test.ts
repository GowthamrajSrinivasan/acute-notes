/** The checkers themselves, on tiny hand-made inputs: each check passes on a good input and fails, with a reason, on a bad one. */
import { describe, expect, it } from "vitest";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { evaluate, matchesAll, normalize, verdict } from "./evaluate";
import type { Assertion, Check, ExpectedCanvas, ExpectedLens, ExpectedReconcile, LensProjection } from "./schemas";

const canvas: ExpectedCanvas = {
  datasetVersion: "1.0.0",
  caseId: "kn-99-test",
  template: "sectioned",
  frames: [
    { id: "f.a", title: "Retrieval", titleMatch: { all: [["retrieval"]] }, purpose: "p", rationale: "r", children: ["e.claim", "e.example"], requirement: "mandatory", support: "implemented" },
    { id: "f.b", title: "Ranking", titleMatch: { all: [["ranking"]] }, purpose: "p", rationale: "r", children: ["e.rerank"], requirement: "mandatory", support: "implemented" },
  ],
  elements: [
    { id: "e.claim", element: "text_card", planNodeTypes: ["text"], role: "main", content: "c", knowledge: ["ku.x"], match: { all: [["hybrid"]] }, hierarchy: "primary", frame: "f.a", requirement: "mandatory", support: "implemented" },
    { id: "e.example", element: "text_card", planNodeTypes: ["text"], role: "example", content: "c", knowledge: ["ku.x"], match: { all: [["for example"]] }, hierarchy: "detail", frame: "f.a", requirement: "mandatory", support: "implemented" },
    { id: "e.rerank", element: "shape", planNodeTypes: ["shape"], role: "component", content: "c", knowledge: ["ku.x"], match: { all: [["reranker"]] }, hierarchy: "secondary", frame: "f.b", requirement: "mandatory", support: "implemented" },
  ],
  relationships: [
    { id: "r.feeds", from: "e.claim", to: "e.rerank", type: "flows_to", label: { required: true, match: { all: [["50"]] } }, direction: "directed", explanation: "x", evidence: ["u1"], provenance: "explicit", inferenceAllowed: false, reviewRequired: false, requirement: "mandatory", support: "implemented" },
  ],
};

function plan(over: Partial<VisualPlan> = {}): VisualPlan {
  return {
    version: 1,
    template: "sectioned",
    nodes: [
      { id: "g1", type: "group", content: { label: "Retrieval", arrangement: "grid" } },
      { id: "g2", type: "group", content: { label: "Ranking", arrangement: "grid" } },
      { id: "n1", type: "text", parent: "g1", importance: "high", content: { markdown: "Hybrid search **can** improve recall when signals are complementary." } },
      { id: "n2", type: "text", parent: "g1", importance: "low", content: { markdown: "For example, an exact error code." } },
      { id: "n3", type: "shape", parent: "g2", content: { shape: "rectangle", label: "Reranker", kind: "backend" } },
    ],
    relationships: [{ from: "n1", to: "n3", type: "flows_to", label: "top 50 candidates" }],
    ...over,
  } as VisualPlan;
}

const run = (check: Check, p: VisualPlan = plan()) => {
  const a: Assertion = { id: "a.t", dimension: "grouping", severity: "critical", method: "deterministic", target: "plan", support: "implemented", description: "t", check };
  return evaluate([a], { canvas }, { plan: p })[0]!;
};

describe("normalize and match", () => {
  it("ignores case, emphasis, curly quotes, dashes and thousands separators", () => {
    expect(normalize("**Can** “improve” 1,000 – `k`")).toBe('can "improve" 1000 - k');
    expect(matchesAll("Uses 1,000 tokens", [["1000"], ["token"]])).toBe(true);
    expect(matchesAll("Uses tokens", [["1000"], ["token"]])).toBe(false);
  });
});

describe("plan checks", () => {
  it("element_present passes on a match and says what's missing otherwise", () => {
    expect(run({ check: "element_present", element: "e.claim" }).status).toBe("pass");
    const r = run({ check: "element_present", element: "e.claim" }, plan({ nodes: plan().nodes.filter((n) => n.id !== "n1") }));
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("e.claim");
  });

  it("only counts nodes of the allowed types", () => {
    const p = plan({ nodes: [...plan().nodes.filter((n) => n.id !== "n3"), { id: "n9", type: "text", content: { markdown: "the reranker" } }] as VisualPlan["nodes"] });
    expect(run({ check: "element_present", element: "e.rerank" }, p).status).toBe("fail");
  });

  it("element_in_frame and together/apart read the group a node sits in", () => {
    expect(run({ check: "element_in_frame", element: "e.claim", frame: "f.a" }).status).toBe("pass");
    expect(run({ check: "element_in_frame", element: "e.rerank", frame: "f.a" }).status).toBe("fail");
    expect(run({ check: "together", elements: ["e.claim", "e.example"], why: "w" }).status).toBe("pass");
    expect(run({ check: "together", elements: ["e.claim", "e.rerank"], why: "w" }).status).toBe("fail");
    expect(run({ check: "apart", elements: ["e.claim", "e.rerank"], why: "w" }).status).toBe("pass");
    expect(run({ check: "apart", elements: ["e.claim", "e.example"], why: "w" }).status).toBe("fail");
  });

  it("hierarchy fails when the example is weighted above the main idea", () => {
    expect(run({ check: "hierarchy", main: "e.claim", supporting: ["e.example"], why: "w" }).status).toBe("pass");
    const p = plan({ nodes: plan().nodes.map((n) => (n.id === "n1" ? { ...n, importance: "low" } : n.id === "n2" ? { ...n, importance: "high" } : n)) as VisualPlan["nodes"] });
    expect(run({ check: "hierarchy", main: "e.claim", supporting: ["e.example"], why: "w" }, p).status).toBe("fail");
  });

  it("relationship_present distinguishes missing, reversed, wrong type, unlabeled and mislabeled", () => {
    expect(run({ check: "relationship_present", relationship: "r.feeds" }).status).toBe("pass");
    const rel = (r: Partial<VisualPlan["relationships"][number]>) => plan({ relationships: [{ from: "n1", to: "n3", type: "flows_to", label: "top 50 candidates", ...r }] });
    expect(run({ check: "relationship_present", relationship: "r.feeds" }, rel({ from: "n3", to: "n1" })).detail).toContain("reversed");
    expect(run({ check: "relationship_present", relationship: "r.feeds" }, rel({ type: "depends_on" })).detail).toContain("type");
    expect(run({ check: "relationship_present", relationship: "r.feeds" }, rel({ label: undefined })).detail).toContain("unlabeled");
    expect(run({ check: "relationship_present", relationship: "r.feeds" }, rel({ label: "candidates" })).status).toBe("fail");
    expect(run({ check: "relationship_present", relationship: "r.feeds" }, plan({ relationships: [] })).status).toBe("fail");
  });

  it("relationship_absent and architecture_edges_labeled", () => {
    expect(run({ check: "relationship_absent", from: "e.rerank", to: "e.claim", why: "w" }).status).toBe("pass");
    expect(run({ check: "relationship_absent", from: "e.claim", to: "e.rerank", why: "w" }).status).toBe("fail");
    expect(run({ check: "architecture_edges_labeled", types: ["flows_to"] }).status).toBe("pass");
    expect(run({ check: "architecture_edges_labeled", types: ["flows_to"] }, plan({ relationships: [{ from: "n1", to: "n3", type: "flows_to" }] })).status).toBe("fail");
  });

  it("text_present keeps a condition on its own card; text_absent catches an added absolute", () => {
    expect(run({ check: "text_present", element: "e.claim", all: [["can", "may"], ["complementary"]], why: "w" }).status).toBe("pass");
    const distorted = plan({ nodes: plan().nodes.map((n) => (n.id === "n1" ? { ...n, content: { markdown: "Hybrid search always improves recall." } } : n)) as VisualPlan["nodes"] });
    expect(run({ check: "text_present", element: "e.claim", all: [["can", "may"], ["complementary"]], why: "w" }, distorted).status).toBe("fail");
    expect(run({ check: "text_absent", pattern: "\\balways\\b", why: "w" }).status).toBe("pass");
    expect(run({ check: "text_absent", pattern: "\\balways\\b", why: "w" }, distorted).status).toBe("fail");
  });

  it("frame_count", () => {
    expect(run({ check: "frame_count", min: 2, max: 2 }).status).toBe("pass");
    expect(run({ check: "frame_count", min: 1, max: 1 }).status).toBe("fail");
  });
});

describe("Lens checks", () => {
  const lens: ExpectedLens = {
    datasetVersion: "1.0.0",
    caseId: "kn-99-test",
    profile: "architecture",
    levels: [
      { level: 1, name: "Architecture", frameKey: "l1", title: "t", availability: "available", reveals: "r", nodes: ["svc", "db"], edges: ["r.reads"] },
      { level: 2, name: "Component", frameKey: "l2", title: "t", availability: "available", reveals: "r", nodes: ["part"], edges: [] },
    ],
    nodes: [
      { key: "svc", label: "Service", match: { all: [["service"]] }, kind: "backend", level: 1, expandsTo: "l2", knowledge: ["ku.x"], evidence: [] },
      { key: "db", label: "Store", match: { all: [["store"]] }, kind: "database", level: 1, knowledge: ["ku.x"], evidence: [] },
      { key: "part", label: "Part", match: { all: [["part"]] }, kind: "backend", level: 2, parent: "svc", knowledge: ["ku.x"], evidence: [] },
    ],
    edges: [{ id: "r.reads", from: "svc", to: "db", relation: "reads", label: "reads rows", level: 1, explanation: "x", evidence: ["u1"], provenance: "explicit" }],
    navigationPaths: [{ id: "p.down", description: "d", path: ["db", "svc", "part"] }],
    invariants: ["i"],
    interactions: [],
  };
  const proj = (): LensProjection => ({
    levels: [
      { level: 1, frameKey: "F1", nodes: [{ key: "k1", label: "Service", kind: "backend" }, { key: "k2", label: "Store", kind: "database" }], edges: [{ from: "k1", to: "k2", relation: "reads", label: "reads rows" }] },
      { level: 2, frameKey: "F2", nodes: [{ key: "k3", label: "Part", kind: "backend" }], edges: [] },
    ],
    drills: [{ from: "k1", toFrameKey: "F2" }],
  });
  const lensRun = (check: Check, p = proj()) => evaluate([{ id: "a.l", dimension: "architecture_lens", severity: "critical", method: "deterministic", target: "lens", support: "implemented", description: "l", check }], { canvas, lens }, { lens: p })[0]!;

  it("matches by label, not by the product's keys", () => {
    expect(lensRun({ check: "lens_node", key: "svc" }).status).toBe("pass");
    expect(lensRun({ check: "lens_edge", edge: "r.reads" }).status).toBe("pass");
    expect(lensRun({ check: "lens_drill", from: "svc", to: "l2" }).status).toBe("pass");
    expect(lensRun({ check: "lens_path", path: "p.down" }).status).toBe("fail"); // db → svc has no edge in that direction
  });

  it("catches a reversed edge, a duplicated identity and an invented drill", () => {
    const reversed = proj();
    reversed.levels[0]!.edges = [{ from: "k2", to: "k1", relation: "reads", label: "reads rows" }];
    expect(lensRun({ check: "lens_edge", edge: "r.reads" }, reversed).detail).toContain("reversed");
    const dup = proj();
    dup.levels[1]!.nodes.push({ key: "k9", label: "Service again", kind: "backend" });
    expect(lensRun({ check: "lens_identity", key: "svc" }, dup).status).toBe("fail");
    expect(lensRun({ check: "lens_identity", key: "svc" }).status).toBe("pass");
    const drilled = proj();
    drilled.drills.push({ from: "k2", toFrameKey: "F2" });
    expect(lensRun({ check: "lens_no_children", key: "db", why: "w" }, drilled).status).toBe("fail");
    expect(lensRun({ check: "lens_no_children", key: "db", why: "w" }).status).toBe("pass");
  });
});

describe("reconcile checks", () => {
  const reconcile: ExpectedReconcile = {
    datasetVersion: "1.0.0",
    caseId: "kn-99-test",
    fromVersion: 1,
    toVersion: 2,
    userEdits: [],
    items: [{ id: "i.edited", element: "e.claim", match: { all: [["hybrid"]] }, change: "user_edited", states: ["update_conflict", "unchanged"], mustKeep: ["my note"], unitsBefore: [], unitsAfter: [], explanation: "x", support: "implemented" }],
  };
  const rRun = (items: { key: string; text: string; state: "unchanged" | "update_clean" | "update_conflict" | "add" | "remove" | "review" }[]) =>
    evaluate([{ id: "a.r", dimension: "traceability", severity: "critical", method: "deterministic", target: "reconcile", support: "implemented", description: "r", check: { check: "reconcile_state", item: "i.edited" } }], { canvas, reconcile }, { reconcile: { items } })[0]!;

  it("passes when the user's edit survives as a conflict, fails when it is overwritten", () => {
    expect(rRun([{ key: "k", text: "Hybrid search — my note", state: "update_conflict" }]).status).toBe("pass");
    expect(rRun([{ key: "k", text: "Hybrid search (v2 wording)", state: "update_clean" }]).status).toBe("fail");
    expect(rRun([{ key: "k", text: "Hybrid search (v2 wording)", state: "update_conflict" }]).detail).toContain("lost");
  });
});

describe("statuses that are never a pass", () => {
  it("judged, future and missing-input assertions are reported as such", () => {
    const base = { dimension: "coverage", severity: "critical", target: "plan", description: "d" } as const;
    const results = evaluate(
      [
        { ...base, id: "a.j", method: "model_judge", support: "implemented", judge: { question: "q", pass: "p", fail: "f" } },
        { ...base, id: "a.f", method: "deterministic", support: "future", requires: ["ai.cites"] },
        { ...base, id: "a.n", method: "deterministic", support: "implemented", check: { check: "element_present", element: "e.claim" } },
      ],
      { canvas },
      {},
    );
    expect(results.map((r) => r.status)).toEqual(["needs_judgement", "not_evaluable", "no_input"]);
    expect(verdict(results).gates[0]!.undecided).toBe(3);
  });

  it("a critical failure fails its gate; a minor one doesn't", () => {
    const r = (severity: "critical" | "minor") => verdict(evaluate([{ id: "a.x", dimension: "coverage", severity, method: "deterministic", target: "plan", support: "implemented", description: "d", check: { check: "element_present", element: "e.claim" } }], { canvas }, { plan: plan({ nodes: [] }) }));
    expect(r("critical").pass).toBe(false);
    expect(r("minor").pass).toBe(true);
  });
});
