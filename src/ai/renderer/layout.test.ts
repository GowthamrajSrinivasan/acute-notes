import { describe, expect, it } from "vitest";
import { VALID_PLAN_FIXTURES } from "@/ai/visual-plan/fixtures";
import { groupTitleKey } from "@/ai/visual-plan/groups";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { GROUP_ROW_MAX_WIDTH, layoutPlan, SECTIONS_MAX_WIDTH } from "./layout";

/** Every node placed, with a finite, non-overlapping-with-itself box (plus one title box per group, F42). */
function assertFullyPlaced(plan: VisualPlan, layout: ReturnType<typeof layoutPlan>) {
  expect(layout.size).toBe(plan.nodes.length + plan.nodes.filter((n) => n.type === "group").length);
  for (const n of plan.nodes) {
    const box = layout.get(n.id);
    expect(box, n.id).toBeDefined();
    expect(Number.isFinite(box!.x) && Number.isFinite(box!.y)).toBe(true);
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  }
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe("layoutPlan — child explanations (F38b)", () => {
  const shape = (id: string, label: string): VisualNode => ({ id, type: "shape", content: { shape: "rectangle", label } });
  const detail = (id: string): VisualNode => ({ id, type: "text", content: { markdown: "JWT-based ID tokens with claims such as user ID, email and custom claims." } });
  const chain: VisualRelationship[] = [
    { from: "a", to: "b", type: "relates_to" },
    { from: "b", to: "c", type: "relates_to" },
  ];
  const flow: VisualPlan = { version: 1, template: "flow", nodes: [shape("a", "Firebase Auth"), shape("b", "Backend validates token"), shape("c", "Session created")], relationships: chain };

  for (const template of ["flow", "architecture", "action_plan", "concept_map"] as const) {
    it(`${template}: an explanation hangs below its concept and leaves the concepts' own layout exactly as it was`, () => {
      const plain = { ...flow, template };
      const withDetail: VisualPlan = { ...plain, nodes: [...plain.nodes, detail("d")], relationships: [...chain, { from: "a", to: "d", type: "explained_by" }] };
      const before = layoutPlan(plain);
      const after = layoutPlan(withDetail);
      for (const id of ["a", "b", "c"]) expect(after.get(id)).toEqual(before.get(id));
      const parent = after.get("a")!;
      const d = after.get("d")!;
      expect(d.x).toBe(parent.x);
      expect(d.y).toBeGreaterThan(parent.y + parent.height);
      for (const id of ["a", "b", "c"]) expect(overlaps(d, after.get(id)!)).toBe(false);
    });
  }

  it("nested explanations go deeper, and two explanations never overlap", () => {
    const plan: VisualPlan = {
      ...flow,
      nodes: [...flow.nodes, detail("d1"), detail("d2"), detail("d3")],
      relationships: [...chain, { from: "a", to: "d1", type: "explained_by" }, { from: "d1", to: "d2", type: "explained_by" }, { from: "a", to: "d3", type: "explained_by" }],
    };
    const layout = layoutPlan(plan);
    assertFullyPlaced(plan, layout);
    expect(layout.get("d2")!.y).toBeGreaterThan(layout.get("d1")!.y + layout.get("d1")!.height);
    const ids = plan.nodes.map((n) => n.id);
    for (const x of ids) for (const y of ids) if (x < y) expect(overlaps(layout.get(x)!, layout.get(y)!), `${x}/${y}`).toBe(false);
  });

  it("an explained_by cycle never leaves a node unplaced", () => {
    const plan: VisualPlan = { ...flow, relationships: [{ from: "a", to: "b", type: "explained_by" }, { from: "b", to: "a", type: "explained_by" }] };
    assertFullyPlaced(plan, layoutPlan(plan));
  });
});

describe("layoutPlan — geometry snapshot per template", () => {
  for (const [template, fixture] of Object.entries(VALID_PLAN_FIXTURES)) {
    it(`places every node of the "${template}" fixture deterministically`, () => {
      const layout = layoutPlan(fixture);
      assertFullyPlaced(fixture, layout);
      const snapshot = fixture.nodes.map((n) => [n.id, layout.get(n.id)]);
      expect(snapshot).toMatchSnapshot();
      // Same fixture, rendered again: identical geometry (F30's own acceptance criterion).
      expect(layoutPlan(fixture)).toEqual(layout);
    });
  }
});

describe("layoutPlan never drops a node", () => {
  const node = (id: string, role?: string): VisualNode => ({ id, type: "shape", role, content: { shape: "rectangle", label: id } });

  it("problem_cause_solution places untagged nodes round-robin across its 3 columns instead of dropping them", () => {
    const plan: VisualPlan = {
      version: 1,
      template: "problem_cause_solution",
      nodes: [node("a"), node("b"), node("c"), node("d")], // no roles at all
      relationships: [],
    };
    assertFullyPlaced(plan, layoutPlan(plan));
  });

  it("decision_tree and architecture place nodes unreachable by any relationship, not just connected ones", () => {
    const plan: VisualPlan = {
      version: 1,
      template: "architecture",
      nodes: [node("a"), node("b"), node("orphan")],
      relationships: [{ from: "a", to: "b", type: "depends_on" }],
    };
    const layout = layoutPlan(plan);
    assertFullyPlaced(plan, layout);
    expect(layout.get("orphan")).toBeDefined();
  });

  it("concept_map places every node even with no role-tagged center", () => {
    const plan: VisualPlan = { version: 1, template: "concept_map", nodes: [node("a"), node("b"), node("c")], relationships: [] };
    assertFullyPlaced(plan, layoutPlan(plan));
  });

  it("handles a single node for every template without throwing", () => {
    for (const template of Object.keys(VALID_PLAN_FIXTURES) as VisualPlan["template"][]) {
      const plan: VisualPlan = { version: 1, template, nodes: [node("solo")], relationships: [] };
      expect(() => assertFullyPlaced(plan, layoutPlan(plan)), template).not.toThrow();
    }
  });
});

describe("layoutPlan produces a real layout, not just a fallback grid", () => {
  it("flow lines its steps up left to right in plan order", () => {
    const nodes: VisualNode[] = [
      { id: "n1", type: "shape", content: { shape: "rectangle", label: "One" } },
      { id: "n2", type: "shape", content: { shape: "rectangle", label: "Two" } },
      { id: "n3", type: "shape", content: { shape: "rectangle", label: "Three" } },
    ];
    const layout = layoutPlan({ version: 1, template: "flow", nodes, relationships: [] });
    const xs = nodes.map((n) => layout.get(n.id)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(3); // distinct positions
    const ys = nodes.map((n) => layout.get(n.id)!.y);
    expect(new Set(ys).size).toBe(1); // a shared centre line
  });

  it("architecture places a dependency strictly to the right of what it depends on", () => {
    const nodes: VisualNode[] = [
      { id: "web", type: "shape", content: { shape: "rectangle", label: "Web" } },
      { id: "api", type: "shape", content: { shape: "rectangle", label: "API" } },
      { id: "db", type: "shape", content: { shape: "rectangle", label: "DB" } },
    ];
    const relationships: VisualRelationship[] = [
      { from: "web", to: "api", type: "depends_on" },
      { from: "api", to: "db", type: "depends_on" },
    ];
    const layout = layoutPlan({ version: 1, template: "architecture", nodes, relationships });
    expect(layout.get("web")!.x).toBeLessThan(layout.get("api")!.x);
    expect(layout.get("api")!.x).toBeLessThan(layout.get("db")!.x);
  });

  it("causal_map (Wave E): a branching, multi-root causal graph places every node, causes left of their effects", () => {
    const nodes: VisualNode[] = [
      { id: "rain", type: "shape", content: { shape: "rectangle", label: "Heavy rain" } },
      { id: "traffic", type: "shape", content: { shape: "rectangle", label: "Traffic jam" } },
      { id: "staffing", type: "shape", content: { shape: "rectangle", label: "Low staffing" } },
      { id: "delay", type: "shape", content: { shape: "rectangle", label: "Delivery delay" } },
      { id: "complaint", type: "shape", content: { shape: "rectangle", label: "Customer complaint" } },
    ];
    const relationships: VisualRelationship[] = [
      { from: "rain", to: "traffic", type: "caused_by" },
      { from: "traffic", to: "delay", type: "caused_by" },
      { from: "staffing", to: "delay", type: "caused_by" }, // a second, independent root feeding the same effect
      { from: "delay", to: "complaint", type: "caused_by" },
    ];
    const layout = layoutPlan({ version: 1, template: "causal_map", nodes, relationships });
    expect(new Set(nodes.map((n) => n.id).map((id) => `${layout.get(id)!.x},${layout.get(id)!.y}`)).size).toBe(5); // every node placed, none dropped
    expect(layout.get("rain")!.x).toBeLessThan(layout.get("traffic")!.x);
    expect(layout.get("traffic")!.x).toBeLessThan(layout.get("delay")!.x);
    expect(layout.get("staffing")!.x).toBeLessThan(layout.get("delay")!.x);
    expect(layout.get("delay")!.x).toBeLessThan(layout.get("complaint")!.x);
  });

  it("decision_tree places branches strictly below their decision", () => {
    const nodes: VisualNode[] = [
      { id: "d", type: "shape", role: "decision", content: { shape: "diamond", label: "OK?" } },
      { id: "yes", type: "shape", content: { shape: "rectangle", label: "Yes" } },
      { id: "no", type: "shape", content: { shape: "rectangle", label: "No" } },
    ];
    const relationships: VisualRelationship[] = [
      { from: "d", to: "yes", type: "depends_on" },
      { from: "d", to: "no", type: "depends_on" },
    ];
    const layout = layoutPlan({ version: 1, template: "decision_tree", nodes, relationships });
    expect(layout.get("d")!.y).toBeLessThan(layout.get("yes")!.y);
    expect(layout.get("d")!.y).toBeLessThan(layout.get("no")!.y);
    expect(layout.get("yes")!.x).not.toBe(layout.get("no")!.x); // siblings side by side, not stacked
  });

  describe("loops (a retry path, a state returning to an earlier one)", () => {
    const box = (id: string): VisualNode => ({ id, type: "shape", content: { shape: "rectangle", label: id } });
    const nodes = ["start", "try", "check", "done"].map(box);
    const relationships: VisualRelationship[] = [
      { from: "start", to: "try", type: "flows_to" },
      { from: "try", to: "check", type: "flows_to" },
      { from: "check", to: "try", type: "flows_to", label: "retry" },
      { from: "check", to: "done", type: "flows_to" },
    ];

    for (const template of ["decision_tree", "architecture", "causal_map"] as const) {
      it(`${template}: terminates and keeps the forward order, ignoring the link back`, () => {
        const layout = layoutPlan({ version: 1, template, nodes, relationships });
        const axis = template === "decision_tree" ? "y" : "x";
        const order = ["start", "try", "check", "done"].map((id) => layout.get(id)![axis]);
        expect(order).toEqual([...order].sort((a, b) => a - b));
        expect(new Set(order).size).toBe(4);
      });
    }

    it("a graph that is only a loop starts from its first node", () => {
      const ring: VisualRelationship[] = [
        { from: "start", to: "try", type: "flows_to" },
        { from: "try", to: "check", type: "flows_to" },
        { from: "check", to: "start", type: "flows_to" },
      ];
      const layout = layoutPlan({ version: 1, template: "decision_tree", nodes: nodes.slice(0, 3), relationships: ring });
      expect(layout.get("start")!.y).toBeLessThan(layout.get("try")!.y);
      expect(layout.get("try")!.y).toBeLessThan(layout.get("check")!.y);
    });
  });

  it("action_plan stacks nodes vertically in plan order, none overlapping", () => {
    const nodes: VisualNode[] = [
      { id: "h", type: "heading", content: { text: "Plan" } },
      { id: "t", type: "todo", content: { items: [{ text: "a", checked: false }] } },
      { id: "x", type: "text", content: { markdown: "note" } },
    ];
    const layout = layoutPlan({ version: 1, template: "action_plan", nodes, relationships: [] });
    expect(layout.get("h")!.y).toBeLessThan(layout.get("t")!.y);
    expect(layout.get("t")!.y).toBeLessThan(layout.get("x")!.y);
    const boxes = nodes.map((n) => layout.get(n.id)!);
    expect(overlaps(boxes[0]!, boxes[1]!)).toBe(false);
    expect(overlaps(boxes[1]!, boxes[2]!)).toBe(false);
  });

  it("concept_map places the center node in the middle and others around it, none overlapping", () => {
    const nodes: VisualNode[] = [
      { id: "c", type: "shape", role: "center", content: { shape: "ellipse", label: "Idea" } },
      { id: "a", type: "shape", content: { shape: "ellipse", label: "A" } },
      { id: "b", type: "shape", content: { shape: "ellipse", label: "B" } },
      { id: "d", type: "shape", content: { shape: "ellipse", label: "D" } },
    ];
    const layout = layoutPlan({ version: 1, template: "concept_map", nodes, relationships: [] });
    const boxes = nodes.map((n) => layout.get(n.id)!);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `${i},${j}`).toBe(false);
    const centre = (b: (typeof boxes)[number]) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    const c = centre(boxes[0]!);
    for (const b of boxes.slice(1)) {
      const p = centre(b);
      expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeGreaterThan(0);
    }
  });

  it("no two nodes overlap in any template's fixture", () => {
    for (const fixture of Object.values(VALID_PLAN_FIXTURES)) {
      const layout = layoutPlan(fixture);
      // A group's frame contains its members by design; the frames themselves are checked below (F42).
      const boxes = fixture.nodes.filter((n) => n.type !== "group").map((n) => layout.get(n.id)!);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!), `${fixture.template} ${i},${j}`).toBe(false);
      }
    }
  });
});

describe("layoutPlan — sections (F42)", () => {
  const card = (id: string, parent: string, words = 3): VisualNode => ({ id, type: "text", parent, content: { markdown: Array.from({ length: words }, (_, i) => `word${i}`).join(" ") } });
  const group = (id: string, label: string, arrangement: "grid" | "chain" | "tree" = "grid"): VisualNode => ({ id, type: "group", content: { label, arrangement } });
  const inside = (outer: { x: number; y: number; width: number; height: number }, b: typeof outer) =>
    b.x >= outer.x && b.y >= outer.y && b.x + b.width <= outer.x + outer.width && b.y + b.height <= outer.y + outer.height;

  it("each section's members, and its title, sit inside its frame; frames never overlap", () => {
    const plan = VALID_PLAN_FIXTURES.sectioned;
    const layout = layoutPlan(plan);
    const groups = plan.nodes.filter((n) => n.type === "group");
    for (const g of groups) {
      const frame = layout.get(g.id)!;
      const title = layout.get(groupTitleKey(g.id))!;
      expect(inside(frame, title), g.id).toBe(true);
      for (const n of plan.nodes.filter((m) => m.parent === g.id)) {
        expect(inside(frame, layout.get(n.id)!), n.id).toBe(true);
        expect(layout.get(n.id)!.y, `${n.id} is below its section's title`).toBeGreaterThanOrEqual(title.y + title.height);
      }
    }
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) expect(overlaps(layout.get(groups[i]!.id)!, layout.get(groups[j]!.id)!)).toBe(false);
  });

  it("the title band spans the frame's width, so the title text centres over the section", () => {
    const layout = layoutPlan(VALID_PLAN_FIXTURES.sectioned);
    const frame = layout.get("g1")!;
    const title = layout.get(groupTitleKey("g1"))!;
    expect(title.x - frame.x).toBeCloseTo(frame.x + frame.width - (title.x + title.width));
  });

  it("a section's members read left to right: one row while it fits, then a 2- or 3-column matrix", () => {
    const row: VisualPlan = { version: 1, template: "sectioned", nodes: [group("g", "Steps"), card("a", "g"), card("b", "g"), card("c", "g")], relationships: [] };
    const r = layoutPlan(row);
    expect(new Set(["a", "b", "c"].map((id) => r.get(id)!.y)).size).toBe(1);
    expect(r.get("a")!.x).toBeLessThan(r.get("b")!.x);

    const wide = (n: number): VisualPlan => ({
      version: 1,
      template: "sectioned",
      nodes: [group("g", "Many"), ...Array.from({ length: n }, (_, i) => card(`m${i}`, "g", 60))],
      relationships: [],
    });
    const four = layoutPlan(wide(4));
    const width = (ids: string[]) => Math.max(...ids.map((id) => four.get(id)!.x + four.get(id)!.width)) - Math.min(...ids.map((id) => four.get(id)!.x));
    expect(width(["m0", "m1", "m2", "m3"])).toBeLessThanOrEqual(GROUP_ROW_MAX_WIDTH);
    expect(four.get("m0")!.y).toBe(four.get("m1")!.y); // 2 × 2
    expect(four.get("m2")!.y).toBeGreaterThan(four.get("m0")!.y);
    expect(four.get("m2")!.x).toBe(four.get("m0")!.x);

    const six = layoutPlan(wide(6));
    expect(new Set(["m0", "m1", "m2"].map((id) => six.get(id)!.y)).size).toBe(1); // 3 × 2
    expect(six.get("m3")!.x).toBe(six.get("m0")!.x);
  });

  it("frames follow their content: a small section is a small frame", () => {
    const plan: VisualPlan = { version: 1, template: "sectioned", nodes: [group("s", "Small"), card("a", "s"), group("b", "Big"), card("x", "b", 200), card("y", "b", 200)], relationships: [] };
    const layout = layoutPlan(plan);
    expect(layout.get("s")!.width).toBeLessThan(layout.get("b")!.width);
    expect(layout.get("s")!.height).toBeLessThan(layout.get("b")!.height);
  });

  it("sections pack side by side (not one tall column) below a centred document title", () => {
    const plan: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "t", type: "heading", role: "title", content: { text: "Plan" } },
        group("g1", "One"),
        card("a", "g1"),
        group("g2", "Two"),
        card("b", "g2"),
        group("g3", "Three"),
        card("c", "g3"),
      ],
      relationships: [],
    };
    const layout = layoutPlan(plan);
    expect(layout.get("g1")!.y).toBe(layout.get("g2")!.y);
    expect(layout.get("g2")!.x).toBeGreaterThan(layout.get("g1")!.x);
    const title = layout.get("t")!;
    for (const g of ["g1", "g2", "g3"]) expect(layout.get(g)!.y).toBeGreaterThan(title.y + title.height);
    const right = Math.max(...["g1", "g2", "g3"].map((g) => layout.get(g)!.x + layout.get(g)!.width));
    expect(title.x + title.width / 2).toBeCloseTo(right / 2, 0);
  });

  it("wide and narrow sections mixed never collapse into one tall column: wide ones get their own row, narrow ones share", () => {
    const wideTable = (id: string, parent: string): VisualNode => ({
      id,
      type: "table",
      parent,
      content: { columns: ["", "Free", "Pro", "Lifetime", "Team", "Enterprise"], rows: [["Price", "₹0 forever", "₹299/month", "One-time payment", "Per seat", "Contact us"]] },
    });
    const plan: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [group("w1", "Plans"), wideTable("t1", "w1"), wideTable("t2", "w1"), group("w2", "More plans"), wideTable("t3", "w2"), wideTable("t4", "w2"), group("n1", "A"), card("a", "n1"), group("n2", "B"), card("b", "n2"), group("n3", "C"), card("c", "n3")],
      relationships: [],
    };
    const layout = layoutPlan(plan);
    const ys = ["w1", "w2", "n1", "n2", "n3"].map((g) => layout.get(g)!.y);
    expect(new Set(ys).size).toBeLessThan(5); // some sections share a row
    expect(layout.get("n3")!.y).toBe(layout.get("n2")!.y); // narrow ones sit side by side
    expect(new Set(["w1", "w2", "n1", "n2", "n3"].map((g) => layout.get(g)!.x)).size).toBeGreaterThan(1); // not one column
    for (const g of ["w1", "w2", "n1", "n2", "n3"]) expect(layout.get(g)!.x + layout.get(g)!.width).toBeLessThanOrEqual(SECTIONS_MAX_WIDTH + 1);
  });

  it("a tree places each child under its own parent, whatever the plan order (no crossing arrows)", () => {
    const s = (id: string): VisualNode => ({ id, type: "shape", parent: "g", content: { shape: "rectangle", label: id } });
    // Plan order lists Pro's child first, then Free's: a plain layer-by-plan-order layout would cross the arrows.
    const plan: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [group("g", "Model", "tree"), s("acute"), s("free"), s("paid"), s("subscription"), s("editor")],
      relationships: [
        { from: "acute", to: "free", type: "relates_to" },
        { from: "acute", to: "paid", type: "relates_to" },
        { from: "paid", to: "subscription", type: "relates_to" },
        { from: "free", to: "editor", type: "relates_to" },
      ],
    };
    const layout = layoutPlan(plan);
    const x = (id: string) => layout.get(id)!.x;
    expect(x("free")).toBeLessThan(x("paid"));
    expect(x("editor")).toBeLessThan(x("subscription")); // Free's child left of Paid's child
  });

  it("an explanation stays in the section of the node it explains", () => {
    const plan: VisualPlan = {
      version: 1,
      template: "sectioned",
      nodes: [group("g", "Auth"), card("a", "g"), { id: "e", type: "text", content: { markdown: "Details of a." } }],
      relationships: [{ from: "a", to: "e", type: "explained_by" }],
    };
    const layout = layoutPlan(plan);
    expect(inside(layout.get("g")!, layout.get("e")!)).toBe(true);
    expect(layout.get("e")!.y).toBeGreaterThan(layout.get("a")!.y);
  });
});

describe("layoutPlan performance (F30: a 50-node plan must stay cheap)", () => {
  it("lays out 60 nodes and 59 relationships (F29's own cap) in well under a frame", () => {
    const nodes: VisualNode[] = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, type: "shape", content: { shape: "rectangle", label: `Node ${i}` } }));
    const relationships: VisualRelationship[] = Array.from({ length: 59 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, type: "relates_to" }));
    const plan: VisualPlan = { version: 1, template: "architecture", nodes, relationships };
    const t0 = performance.now();
    const layout = layoutPlan(plan);
    const ms = performance.now() - t0;
    assertFullyPlaced(plan, layout);
    expect(ms).toBeLessThan(50);
  });
});

describe("layoutPlan — architecture column gaps fit link labels", () => {
  const plan = (label?: string): VisualPlan => ({
    version: 1,
    template: "architecture",
    nodes: [
      { id: "a", type: "shape", role: "component", content: { shape: "rectangle", label: "A" } },
      { id: "b", type: "shape", role: "component", content: { shape: "rectangle", label: "B" } },
    ],
    relationships: [{ from: "a", to: "b", type: "relates_to", ...(label ? { label } : {}) }],
  });
  const gap = (p: VisualPlan) => {
    const boxes = layoutPlan(p);
    return boxes.get("b")!.x - (boxes.get("a")!.x + boxes.get("a")!.width);
  };

  it("keeps the plain gap without a label, and widens it for a long one", () => {
    expect(gap(plan())).toBe(48);
    expect(gap(plan("places (1 to 0..*)"))).toBeGreaterThanOrEqual(18 * 16 * 0.56 + 64);
  });

  it("never widens past the cap", () => {
    expect(gap(plan("x".repeat(200)))).toBe(320);
  });
});
