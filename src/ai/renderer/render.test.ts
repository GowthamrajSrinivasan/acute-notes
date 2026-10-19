/**
 * F30's integration test: a validated `VisualPlan` all the way to a real,
 * F19-parseable `ChangeSet` — every template, with a stub Markdown parser (no
 * BlockNote/jsdom needed to stay pure; `render.ts`'s real default is exercised
 * separately in the e2e suite against the real editor parser).
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { VALID_PLAN_FIXTURES } from "@/ai/visual-plan/fixtures";
import type { VisualNode, VisualPlan, VisualRelationship } from "@/ai/visual-plan/types";
import { renderVisualPlan, type RenderContext } from "./render";

const stubMarkdown = (md: string) => [{ type: "paragraph" as const, content: md }];
const emptyContext: RenderContext = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };

function provenance(operationId = "op_1") {
  return {
    operationId,
    title: "Visualize",
    metadata: { createdBy: "ai" as const, task: "generate_visual_plan", provider: "mock", operationId },
    context: emptyContext,
    parseMarkdown: stubMarkdown,
  };
}

describe("renderVisualPlan — every template produces a real, F19-parseable change set", () => {
  for (const [template, fixture] of Object.entries(VALID_PLAN_FIXTURES)) {
    it(`renders and validates the "${template}" fixture`, async () => {
      const set = await renderVisualPlan(fixture, provenance());
      expect(() => parseChangeSet(set)).not.toThrow();
      // One change per node (a group is two: its frame and its title), plus one per relationship — nothing dropped, nothing invented.
      const groups = fixture.nodes.filter((n) => n.type === "group").length;
      expect(set.changes.filter((c) => c.kind !== "connect")).toHaveLength(fixture.nodes.length + groups);
      expect(set.changes.filter((c) => c.kind === "connect")).toHaveLength(fixture.relationships.length);
    });
  }

  it("is deterministic: the same plan renders to the same change set", async () => {
    const a = await renderVisualPlan(VALID_PLAN_FIXTURES.architecture, provenance());
    const b = await renderVisualPlan(VALID_PLAN_FIXTURES.architecture, provenance());
    expect(a).toEqual(b);
  });
});

describe("renderVisualPlan — node → change mapping, end to end", () => {
  const plan: VisualPlan = {
    version: 1,
    template: "action_plan",
    nodes: [
      { id: "h", type: "heading", content: { text: "Plan" } },
      { id: "t", type: "todo", content: { items: [{ text: "Ship it", checked: false }] } },
      { id: "p", type: "page", content: { title: "Runbook", markdown: "steps" } },
    ],
    relationships: [{ from: "t", to: "p", type: "depends_on", label: "needs" }],
  };

  it("maps every node to its change and every relationship to a connect between the created objects", async () => {
    const set = await renderVisualPlan(plan, provenance());
    const byKind = Object.fromEntries(set.changes.map((c) => [c.kind === "connect" ? "connect" : "key" in c ? c.key : c.kind, c]));
    expect(byKind.h).toMatchObject({ kind: "create_block", frame: "none" });
    expect(byKind.t).toMatchObject({ kind: "create_block", blockType: "todo" });
    expect(byKind.p).toMatchObject({ kind: "create_page", title: "Runbook" });
    expect(byKind.connect).toMatchObject({ kind: "connect", from: { created: "t" }, to: { created: "p" }, relation: "depends_on", label: "needs" });
  });

  it("stamps the given provenance on the change set itself (F19 stamps it on every created object at Accept)", async () => {
    const set = await renderVisualPlan(plan, provenance("op_specific"));
    expect(set.operationId).toBe("op_specific");
    expect(set.title).toBe("Visualize");
    expect(set.metadata).toMatchObject({ createdBy: "ai", operationId: "op_specific" });
  });

  it("only loads a Markdown parser when a node actually needs one", async () => {
    const onlyShapes: VisualPlan = { version: 1, template: "flow", nodes: [{ id: "s", type: "shape", content: { shape: "rectangle", label: "Go" } }], relationships: [] };
    let called = false;
    await renderVisualPlan(onlyShapes, { ...provenance(), parseMarkdown: () => ((called = true), []) });
    expect(called).toBe(false);
  });
});

describe("renderVisualPlan places the whole plan in free space", () => {
  it("keeps the plan clear of existing objects and returns boxes with real geometry", async () => {
    const plan: VisualPlan = {
      version: 1,
      template: "flow",
      nodes: [
        { id: "a", type: "shape", content: { shape: "rectangle", label: "A" } },
        { id: "b", type: "shape", content: { shape: "rectangle", label: "B" } },
      ],
      relationships: [{ from: "a", to: "b", type: "relates_to" }],
    };
    const existing = [{ x: 500, y: 350, width: 300, height: 100 }]; // sits where the viewport-centre default would land
    const set = await renderVisualPlan(plan, { ...provenance(), context: { existing, viewport: emptyContext.viewport } });
    const boxes = set.changes.filter((c): c is Extract<typeof c, { box: unknown }> => "box" in c).map((c) => c.box);
    const overlaps = (x: (typeof boxes)[number]) => x.x < existing[0]!.x + existing[0]!.width && x.x + x.width > existing[0]!.x && x.y < existing[0]!.y + existing[0]!.height && x.y + x.height > existing[0]!.y;
    for (const b of boxes) expect(overlaps(b)).toBe(false);
  });
});

describe("renderVisualPlan performance (F30's own acceptance criterion: a 50-node plan)", () => {
  it("renders 50 nodes + 49 relationships well inside the interaction budget", async () => {
    const nodes: VisualNode[] = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, type: "shape", content: { shape: "rectangle", label: `Node ${i}` } }));
    const relationships: VisualRelationship[] = Array.from({ length: 49 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, type: "relates_to" }));
    const plan: VisualPlan = { version: 1, template: "concept_map", nodes, relationships };
    const t0 = performance.now();
    const set = await renderVisualPlan(plan, provenance());
    const ms = performance.now() - t0;
    expect(set.changes).toHaveLength(50 + 49);
    expect(() => parseChangeSet(set)).not.toThrow();
    expect(ms).toBeLessThan(100);
  });
});

describe("renderVisualPlan defends against what F29 should already have filtered out", () => {
  it("throws rather than silently rendering an image node (unreachable via any real template, but defensive)", async () => {
    const plan = { version: 1, template: "action_plan", nodes: [{ id: "i", type: "image", content: { assetRef: "a1" } }], relationships: [] } as unknown as VisualPlan;
    await expect(renderVisualPlan(plan, provenance())).rejects.toThrow(/image/);
  });
});
