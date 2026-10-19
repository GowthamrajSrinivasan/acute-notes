import { describe, expect, it } from "vitest";
import { layoutProjectLanes, laneOf, projectBadge, projectSummary, type LaneNode } from "./projectLanes";

const box = { x: 0, y: 0, width: 100, height: 40 };
const n = (id: string, kind: string, project: LaneNode["project"] = {}, y = 0, key = id): LaneNode => ({ id, key, label: id, semantics: { kind: kind as never }, box: { ...box, y }, project });

describe("project lanes (D25, §3.6)", () => {
  it("assigns each kind to one lane", () => {
    expect(laneOf("milestone")).toBe("plan");
    expect(laneOf("progress_item")).toBe("plan");
    expect(laneOf("decision")).toBe("decisions");
    expect(laneOf("constraint")).toBe("decisions");
    expect(laneOf("finding")).toBe("knowledge");
    expect(laneOf("open_question")).toBe("knowledge");
    expect(laneOf("risk")).toBe("knowledge");
    expect(laneOf("annotation")).toBe("notes");
    expect(laneOf("project")).toBeUndefined();
    expect(laneOf(undefined)).toBeUndefined();
  });

  it("orders the Plan lane: milestones by order, their items under them by order, unassigned items last", () => {
    const nodes = [
      n("i3", "progress_item", { order: 1 }, 5),
      n("m2", "milestone", { order: 2 }, 0, "m2"),
      n("i1", "progress_item", { order: 2, refs: ["m1"] }, 20),
      n("m1", "milestone", { order: 1 }, 10, "m1"),
      n("i0", "progress_item", { order: 1, refs: ["m1"] }, 30),
      n("i2", "progress_item", { order: 1, refs: ["m2"] }, 40),
    ];
    const laid = layoutProjectLanes(nodes);
    const plan = laid.lanes.find((l) => l.id === "plan")!;
    const inPlan = laid.nodes.filter((x) => x.box.x >= plan.box.x && x.box.x < plan.box.x + plan.box.width).sort((a, b) => a.box.y - b.box.y);
    expect(inPlan.map((x) => x.id)).toEqual(["m1", "i0", "i1", "m2", "i2", "i3"]);
    // items are indented under their milestone
    expect(laid.nodes.find((x) => x.id === "i0")!.box.x).toBeGreaterThan(laid.nodes.find((x) => x.id === "m1")!.box.x);
    expect(laid.nodes.find((x) => x.id === "i3")!.box.x).toBe(laid.nodes.find((x) => x.id === "m1")!.box.x);
  });

  it("puts constraints first, then proposed decisions, in the Decisions lane", () => {
    const nodes = [n("d-acc", "decision", { status: "accepted" }, 0), n("d-prop", "decision", { status: "proposed" }, 50), n("c", "constraint", { status: "accepted" }, 100), n("d-sup", "decision", { status: "superseded" }, 10)];
    const laid = layoutProjectLanes(nodes);
    const lane = laid.lanes.find((l) => l.id === "decisions")!;
    const ids = laid.nodes.filter((x) => x.box.x === lane.box.x).sort((a, b) => a.box.y - b.box.y).map((x) => x.id);
    expect(ids).toEqual(["c", "d-prop", "d-acc", "d-sup"]);
  });

  it("puts open questions, then risks by severity, then findings, in Working knowledge", () => {
    const nodes = [n("f", "finding", { stage: "ephemeral" }), n("r-low", "risk", { severity: "low" }), n("r-high", "risk", { severity: "high" }), n("q", "open_question", { status: "open" }), n("q-done", "open_question", { status: "answered" })];
    const laid = layoutProjectLanes(nodes);
    const lane = laid.lanes.find((l) => l.id === "knowledge")!;
    const ids = laid.nodes.filter((x) => x.box.x === lane.box.x).sort((a, b) => a.box.y - b.box.y).map((x) => x.id);
    expect(ids).toEqual(["q", "r-high", "r-low", "f", "q-done"]);
  });

  it("lays the project node out as a full-width banner above all four lanes and sizes the view to fit", () => {
    const laid = layoutProjectLanes([n("p", "project", { focus: "auth" }), n("d", "decision")]);
    const banner = laid.nodes.find((x) => x.id === "p")!;
    expect(laid.lanes.map((l) => l.id)).toEqual(["plan", "decisions", "knowledge", "notes"]);
    expect(banner.box.y).toBeLessThan(laid.lanes[0]!.box.y);
    expect(banner.box.width).toBeGreaterThan(laid.lanes[0]!.box.width * 3);
    expect(laid.box.width).toBeGreaterThan(banner.box.width);
    expect(laid.box.height).toBeGreaterThanOrEqual(laid.lanes[0]!.box.y + laid.lanes[0]!.box.height);
  });

  it("keeps a node with no project lane in Notes rather than dropping it", () => {
    const laid = layoutProjectLanes([n("arch", "backend"), n("blank", "")]);
    expect(laid.lanes.find((l) => l.id === "notes")!.count).toBe(2);
    expect(laid.nodes).toHaveLength(2);
  });

  it("summarises the project: milestones done, item states, proposed decisions, warnings, open questions", () => {
    const s = projectSummary([
      n("p", "project", { focus: "Ship auth", style: "modular" }, 0, "acme"),
      n("m1", "milestone", { order: 1 }, 0, "m1"),
      n("m2", "milestone", { order: 2 }, 0, "m2"),
      n("a", "progress_item", { status: "done", refs: ["m1"] }),
      n("b", "progress_item", { status: "done", refs: ["m1"] }),
      n("c", "progress_item", { status: "in_progress", refs: ["m2"] }),
      n("d", "progress_item"),
      n("dec1", "decision", { status: "proposed" }),
      n("dec2", "decision", { status: "accepted", enforce: true }),
      n("con", "constraint", { status: "accepted" }),
      n("q1", "open_question", { status: "open" }),
      n("q2", "open_question", { status: "answered" }),
    ]);
    expect(s.project).toEqual({ key: "acme", label: "p", focus: "Ship auth", style: "modular" });
    expect(s.milestones).toEqual({ total: 2, done: 1 });
    expect(s.items).toEqual({ not_started: 1, in_progress: 1, done: 2, blocked: 0 });
    expect(s.proposedDecisions).toBe(1);
    expect(s.warnings).toBe(2);
    expect(s.openQuestions).toBe(1);
  });

  it("writes a short badge per kind", () => {
    expect(projectBadge("decision", { chosen: "Redis", options: [{ label: "Redis" }] })).toBe("✓ Redis");
    expect(projectBadge("decision", { status: "proposed" })).toBe("Proposed");
    expect(projectBadge("progress_item", { status: "in_progress", next: true })).toBe("In progress · next");
    expect(projectBadge("finding", { stage: "validated" })).toBe("Validated");
    expect(projectBadge("risk", { severity: "high" })).toBe("high");
    expect(projectBadge("milestone", {})).toBeUndefined();
    expect(projectBadge(undefined, { status: "done" })).toBeUndefined();
  });
});
