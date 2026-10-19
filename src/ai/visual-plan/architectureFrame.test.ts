/**
 * Interactive architecture frames, Phase 2: plan semantics validated leniently, a semantic architecture plan
 * wrapped in one diagram section, and the whole thing rendered into a parseable change set whose frame, shapes
 * and connectors carry the diagram data.
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { layoutPlan } from "@/ai/renderer/layout";
import { renderVisualPlan } from "@/ai/renderer/render";
import { ARCHITECTURE_GROUP_ID, isDiagramGroup, wrapArchitecturePlan } from "./architectureFrame";
import { groupTitleKey } from "./groups";
import type { VisualPlan } from "./types";
import { validateVisualPlan } from "./validate";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };
const render = (plan: VisualPlan) =>
  renderVisualPlan(plan, { operationId: "op", title: "Visualize", metadata: { createdBy: "ai" }, context, parseMarkdown: (md) => [{ type: "paragraph", content: md }] });

const raw = {
  version: 1,
  template: "architecture",
  metadata: { title: "KnowFlow RAG", cards: [{ title: "Cost", items: ["~$16 per manual"] }, { title: "", items: [] }] },
  nodes: [
    { id: "ui", type: "shape", content: { shape: "rectangle", label: "CLI", kind: "frontend", sublabel: "query.py", details: ["Interactive mode"] } },
    { id: "router", type: "shape", content: { shape: "rectangle", label: "Router", kind: "nonsense", tag: "free first" } },
    { id: "db", type: "shape", content: { shape: "rectangle", label: "Index", kind: "database", sublabel: "x".repeat(500) } },
  ],
  relationships: [
    { from: "ui", to: "router", type: "flows_to", label: "question", explanation: "Every turn starts here" },
    { from: "router", to: "db", type: "depends_on" },
  ],
};

describe("architecture plan semantics", () => {
  it("validates leniently: a bad field is dropped, never its node", () => {
    const { plan } = validateVisualPlan(raw);
    expect(plan.nodes).toHaveLength(3);
    const [ui, router, db] = plan.nodes;
    expect(ui).toMatchObject({ content: { kind: "frontend", sublabel: "query.py", details: ["Interactive mode"] } });
    expect(router!.type === "shape" && router!.content.kind).toBeUndefined();
    expect(router).toMatchObject({ content: { tag: "free first" } });
    expect(db!.type === "shape" && db!.content.sublabel).toBeUndefined();
    expect(plan.relationships[0]).toMatchObject({ explanation: "Every turn starts here" });
    // One unusable card drops the list (the frame keeps no half-valid cards).
    expect(plan.metadata?.cards).toBeUndefined();
  });

  it("wraps a semantic architecture plan in one diagram section, and leaves others alone", () => {
    const { plan } = validateVisualPlan({ ...raw, metadata: { title: "KnowFlow RAG", cards: [{ title: "Cost", items: ["~$16 per manual"] }] } });
    const wrapped = wrapArchitecturePlan(plan);
    const group = wrapped.nodes.find((n) => n.id === ARCHITECTURE_GROUP_ID);
    expect(group).toMatchObject({ type: "group", content: { label: "KnowFlow RAG", arrangement: "tree", diagram: "architecture", cards: [{ title: "Cost" }] } });
    expect(wrapped.nodes.filter((n) => n.parent === ARCHITECTURE_GROUP_ID).map((n) => n.id)).toEqual(["ui", "router", "db"]);

    const plain = { ...plan, nodes: plan.nodes.map((n) => (n.type === "shape" ? { ...n, content: { shape: n.content.shape, label: n.content.label } } : n)) };
    expect(wrapArchitecturePlan(plain)).toBe(plain);
    expect(wrapArchitecturePlan({ ...plan, template: "flow" })).toEqual({ ...plan, template: "flow" });
  });

  it("treats a section with a component kind as a diagram", () => {
    const plan: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "g", type: "group", content: { label: "Stack", arrangement: "tree" } },
        { id: "a", type: "shape", parent: "g", content: { shape: "rectangle", label: "API", kind: "backend" } },
        { id: "h", type: "group", content: { label: "Notes", arrangement: "grid" } },
      ],
      relationships: [],
    };
    const [g, , h] = plan.nodes as Extract<VisualPlan["nodes"][number], { type: "group" }>[];
    expect(isDiagramGroup(plan, g!)).toBe(true);
    expect(isDiagramGroup(plan, h!)).toBe(false);
  });

  it("renders a change set whose frame, shapes and connectors carry the diagram", async () => {
    const { plan } = validateVisualPlan({ ...raw, metadata: { title: "KnowFlow RAG", cards: [{ kind: "cloud", title: "Cost", items: ["~$16 per manual"] }] } });
    const set = parseChangeSet(await render(plan));
    const frame = set.changes.find((c) => c.kind === "create_frame");
    expect(frame).toMatchObject({ diagram: { cards: [{ kind: "cloud", title: "Cost", items: ["~$16 per manual"] }] }, overview: { title: "KnowFlow RAG" } });
    const shapes = set.changes.filter((c) => c.kind === "create_shape");
    expect(shapes.map((c) => c.kind === "create_shape" && c.semantics)).toEqual([
      { kind: "frontend", sublabel: "query.py", details: ["Interactive mode"] },
      { tag: "free first" },
      { kind: "database" },
    ]);
    const connects = set.changes.filter((c) => c.kind === "connect");
    expect(connects[0]).toMatchObject({ label: "question", explanation: "Every turn starts here" });
    expect(connects[1]).not.toHaveProperty("explanation");
  });

  it("keeps a plain architecture plan's change set as before: no frame, no semantics", async () => {
    const { plan } = validateVisualPlan({
      version: 1,
      template: "architecture",
      nodes: [
        { id: "a", type: "shape", content: { shape: "rectangle", label: "API" } },
        { id: "b", type: "shape", content: { shape: "rectangle", label: "DB" } },
      ],
      relationships: [{ from: "a", to: "b", type: "depends_on" }],
    });
    const set = await render(plan);
    expect(set.changes.some((c) => c.kind === "create_frame")).toBe(false);
    expect(set.changes.some((c) => c.kind === "create_shape" && "semantics" in c)).toBe(false);
  });
});

describe("section title band", () => {
  it("leaves room for a title that wraps in a narrow section: its first member starts below it", () => {
    const plan: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "g", type: "group", content: { label: "A rather long section title that sits over a single small box", arrangement: "stack" } },
        { id: "a", type: "shape", parent: "g", content: { shape: "rectangle", label: "API" } },
      ],
      relationships: [],
    };
    const boxes = layoutPlan(plan);
    const title = boxes.get(groupTitleKey("g"))!;
    const member = boxes.get("a")!;
    // 61 characters at 36 px (about 0.66 em each) can't fit one line under the 1,200 px cap: the band is two lines, and the member is under it.
    expect(title.height).toBeGreaterThan(54);
    expect(member.y).toBeGreaterThanOrEqual(title.y + title.height);
  });
});
