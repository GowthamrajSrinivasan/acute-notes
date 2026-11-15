/**
 * The golden layout gate measures with the product's `geometryOf` (organisation-layout plan F0/F1). These tests keep
 * it honest: on every reference it reports exactly what the gate's own copies of the overlap and containment checks
 * reported before (kept here as the oracle), and the frame-order robustness tooling is reproducible.
 */
import { describe, expect, it } from "vitest";
import type { Box } from "@/ai/changes/changeSet";
import { checkProposal } from "@/ai/changes/proposalGeometry";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import { loadDataset } from "./load";
import { evaluate } from "./evaluate";
import { crossFrameLinks, shuffledGroupOrders } from "./frameOrder";
import { renderFacts, renderGolden } from "./render";

const TOLERANCE = 1;
const overlap = (a: Box, b: Box) => a.x + a.width - TOLERANCE > b.x && b.x + b.width - TOLERANCE > a.x && a.y + a.height - TOLERANCE > b.y && b.y + b.height - TOLERANCE > a.y;
const inside = (i: Box, o: Box) => i.x >= o.x - TOLERANCE && i.y >= o.y - TOLERANCE && i.x + i.width <= o.x + o.width + TOLERANCE && i.y + i.height <= o.y + o.height + TOLERANCE;

const { cases } = loadDataset();

describe("renderFacts on geometryOf", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s: the same overlaps, containment and layout report as the gate's old checks", async (_id, c) => {
    const plan = validateVisualPlan(c.referencePlan).plan;
    const changes = (await renderGolden(plan)).changes;
    // The old render.ts, verbatim in substance, except that a sub-topic backdrop (behind its cards by design) is not a
    // card: the old copy predates any reference with sub-topics (kn-13 is the first) and would count each backdrop as
    // overlapping the cards it groups. `facts.cards` still counts every created object, as before.
    const all = changes.flatMap((x) => (x.kind === "create_block" || x.kind === "create_shape" || x.kind === "create_page" ? [{ key: x.key, box: x.box, backdrop: x.kind === "create_shape" && !!x.backdrop }] : []));
    const created = all.filter((x) => !x.backdrop);
    const frames = changes.flatMap((x) => (x.kind === "create_frame" ? [{ key: x.key, box: x.box, children: x.children }] : []));
    const boxOf = new Map(created.map((x) => [x.key, x.box]));
    const cardOverlaps: string[] = [];
    for (let i = 0; i < created.length; i++) for (let j = i + 1; j < created.length; j++) if (overlap(created[i]!.box, created[j]!.box)) cardOverlaps.push(`${created[i]!.key} × ${created[j]!.key}`);
    const outsideFrames = frames.flatMap((f) => f.children.filter((k) => boxOf.has(k) && !inside(boxOf.get(k)!, f.box)).map((k) => `${k} outside ${f.key}`));
    const frameOverlaps: string[] = [];
    for (let i = 0; i < frames.length; i++) for (let j = i + 1; j < frames.length; j++) if (overlap(frames[i]!.box, frames[j]!.box)) frameOverlaps.push(`${frames[i]!.key} × ${frames[j]!.key}`);

    const facts = await renderFacts(plan);
    expect(facts.cardOverlaps).toEqual(cardOverlaps);
    expect(facts.outsideFrames).toEqual(outsideFrames);
    expect(facts.frameOverlaps).toEqual(frameOverlaps);
    expect(facts.layout).toEqual(checkProposal(changes, []));
    expect(facts.cards).toBe(all.length);
    expect(facts.frames).toBe(frames.length);
    // A v1 render never reorders frames.
    expect(facts.geometry.readingOrder.inversions).toBe(0);
  });
});

describe("frame order robustness tooling", () => {
  const kn07 = cases.find((c) => c.id.startsWith("kn-07"))!;
  const plan = validateVisualPlan(kn07.referencePlan).plan;

  it("shuffles only the group nodes, in place, the same way every time", () => {
    const a = shuffledGroupOrders(plan, 5);
    const b = shuffledGroupOrders(plan, 5);
    expect(a).toEqual(b);
    for (const order of a) {
      expect(order.nodes.map((n) => (n.type === "group" ? "group" : n.id))).toEqual(plan.nodes.map((n) => (n.type === "group" ? "group" : n.id)));
      expect(new Set(order.nodes.filter((n) => n.type === "group").map((n) => n.id))).toEqual(new Set(plan.nodes.filter((n) => n.type === "group").map((n) => n.id)));
    }
    expect(a.some((o) => o.nodes.some((n, i) => n.id !== plan.nodes[i]!.id))).toBe(true);
  });

  it("counts links across frames", () => {
    expect(crossFrameLinks(plan)).toBeGreaterThan(0);
  });
});

describe("organisation v2 on the references", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s: every render assertion still passes, with no more crossings than v1", async (_id, c) => {
    const plan = validateVisualPlan(c.referencePlan).plan;
    const v1 = await renderFacts(plan);
    const v2 = await renderFacts(plan, { organisation: "v2" });
    const render = c.evaluation.assertions.filter((a) => a.method === "deterministic" && a.support !== "future" && a.target === "render" && (!a.organisation || a.organisation === "v2"));
    const results = evaluate(render, c, { plan, render: v2 });
    expect(results.filter((r) => r.status !== "pass").map((r) => `${r.id}: ${r.detail}`)).toEqual([]);
    expect(v2.layout.counts.crossings).toBeLessThanOrEqual(v1.layout.counts.crossings);
    expect(v2.layout.counts.throughCards).toBe(0);
  });
});
