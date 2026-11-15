import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { VALID_PLAN_FIXTURES } from "@/ai/visual-plan/fixtures";
import { clearlyBetter, compareScores } from "./frameOrder";
import { geometryOf } from "./geometry";
import { layoutPlan } from "./layout";
import { renderVisualPlan } from "./render";

/** The golden references (evaluation/knowledge-notes), read as data: the cases whose frames are linked card to card. */
const CASES = join(process.cwd(), "evaluation", "knowledge-notes", "cases");
const reference = (dir: string): VisualPlan => validateVisualPlan(JSON.parse(readFileSync(join(CASES, dir, "reference", "plan.json"), "utf8"))).plan;

/** Group nodes shuffled in place (same slots), with a small fixed PRNG: the same orders on every run. */
function shuffles(plan: VisualPlan, count: number, seed: number): VisualPlan[] {
  let a = seed >>> 0;
  const random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const slots = plan.nodes.flatMap((n, i) => (n.type === "group" ? [i] : []));
  return Array.from({ length: count }, () => {
    const groups = slots.map((i) => plan.nodes[i]!);
    for (let i = groups.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [groups[i], groups[j]] = [groups[j]!, groups[i]!];
    }
    const nodes = [...plan.nodes];
    slots.forEach((slot, i) => (nodes[slot] = groups[i]!));
    return { ...plan, nodes };
  });
}

async function measure(plan: VisualPlan, organisation: "v1" | "v2") {
  const set = await renderVisualPlan(plan, {
    operationId: "op",
    title: "t",
    metadata: { createdBy: "ai", task: "generate_visual_plan", operationId: "op" },
    context: { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 1000 } },
    parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }],
    organisation,
  });
  return geometryOf(set.changes, []);
}

describe("frame order by links (v2)", () => {
  const linked = [
    ["kn-06", "kn-06-hybrid-search-reranking"],
    ["kn-07", "kn-07-photo-sharing-hld"],
    ["kn-10", "kn-10-inventory-architecture-frames"],
  ] as const;

  for (const [name, dir] of linked) {
    it(`${name}: no shuffled frame order routes a link through a card, and the reference gets no more crossings`, async () => {
      const plan = reference(dir);
      const v1 = await measure(plan, "v1");
      const v2 = await measure(plan, "v2");
      expect(v2.layout.counts.throughCards).toBe(0);
      expect(v2.layout.counts.crossings).toBeLessThanOrEqual(v1.layout.counts.crossings);
      expect(v2.cardOverlaps).toEqual([]);
      expect(v2.outsideFrames).toEqual([]);
      expect(v2.frameOverlaps).toEqual([]);
      // The full 120-order measurement is the golden report's (reports/gates.md); a dozen here keeps the unit suite quick.
      for (const order of shuffles(plan, 12, 7)) expect((await measure(order, "v2")).layout.counts.throughCards).toBe(0);
    }, 60_000);
  }

  it("not vacuous: some of those shuffled orders do route a link through a card in v1", async () => {
    const plan = reference("kn-07-photo-sharing-hld");
    const fatal = [];
    for (const order of shuffles(plan, 12, 7)) fatal.push((await measure(order, "v1")).layout.counts.throughCards);
    expect(fatal.some((n) => n > 0)).toBe(true);
  }, 60_000);

  it("keeps the plan's order when nothing is gained: links inside frames (kn-08), or one frame (kn-01)", () => {
    for (const dir of ["kn-08-helpdesk-answers-hld-lld", "kn-01-idempotency-keys"]) {
      const plan = reference(dir);
      expect(layoutPlan(plan, { organisation: "v2" })).toEqual(layoutPlan(plan));
    }
  });

  it("is deterministic", () => {
    const plan = reference("kn-10-inventory-architecture-frames");
    expect(layoutPlan(plan, { organisation: "v2" })).toEqual(layoutPlan(plan, { organisation: "v2" }));
  });

  it("v1 is untouched: every fixture lays out exactly as without the option", () => {
    for (const fixture of Object.values(VALID_PLAN_FIXTURES)) expect(layoutPlan(fixture, { organisation: "v1" })).toEqual(layoutPlan(fixture));
  });
});

describe("the plan's order wins unless a candidate is clearly better", () => {
  const s = (fatal: number, cost: number, inversions = 0) => ({ fatal, cost, inversions });

  it("fewer fatal issues always wins", () => {
    expect(clearlyBetter(s(0, 30), s(1, 0))).toBe(true);
    expect(clearlyBetter(s(2, 0), s(1, 30))).toBe(false);
  });

  it("between clean layouts, a gain of at least 3 crossings and 25% is needed", () => {
    expect(clearlyBetter(s(0, 9), s(0, 12))).toBe(true);
    expect(clearlyBetter(s(0, 10), s(0, 12))).toBe(false);
    expect(clearlyBetter(s(0, 17), s(0, 20))).toBe(false);
    expect(clearlyBetter(s(0, 0), s(0, 2))).toBe(false);
  });

  it("scores compare fatal, then cost, then reading order", () => {
    expect(compareScores(s(0, 5, 3), s(1, 0, 0))).toBeLessThan(0);
    expect(compareScores(s(0, 5, 3), s(0, 6, 0))).toBeLessThan(0);
    expect(compareScores(s(0, 5, 1), s(0, 5, 2))).toBeLessThan(0);
  });
});
