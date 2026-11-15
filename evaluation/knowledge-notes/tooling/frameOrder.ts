/**
 * Frame order robustness (organisation-layout plan §1.2, §5.1, report only): how often a plan's layout fails when its
 * frames come in another order, as a real run's outline might give them. The plan's group nodes are shuffled in place
 * (they keep their slots in `nodes`; only which group sits in which slot changes) with a fixed seed, and each order is
 * rendered and checked like the reference. A plan whose links all stay inside frames has nothing to measure.
 */
import { sectionOfNodes } from "@/ai/renderer/layout";
import type { Organisation } from "@/ai/visual-plan/grouping";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { renderFacts } from "./render";

/** Orders tried per case, and the seed: fixed, so the report never changes unless the layout does. */
export const ROBUSTNESS_SHUFFLES = 120;
export const ROBUSTNESS_SEED = 20261019;

/** mulberry32: a small, fixed PRNG (the report must be reproducible on every machine). */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` copies of `plan` with its group nodes shuffled in place (Fisher–Yates over the group slots). */
export function shuffledGroupOrders(plan: VisualPlan, count: number, seed = ROBUSTNESS_SEED): VisualPlan[] {
  const random = prng(seed);
  const slots = plan.nodes.flatMap((n, i) => (n.type === "group" ? [i] : []));
  const out: VisualPlan[] = [];
  for (let k = 0; k < count; k++) {
    const groups = slots.map((i) => plan.nodes[i]!);
    for (let i = groups.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [groups[i], groups[j]] = [groups[j]!, groups[i]!];
    }
    const nodes = [...plan.nodes];
    slots.forEach((slot, i) => (nodes[slot] = groups[i]!));
    out.push({ ...plan, nodes });
  }
  return out;
}

/** Links whose two ends sit in different sections. */
export function crossFrameLinks(plan: VisualPlan): number {
  const section = sectionOfNodes(plan);
  return plan.relationships.filter((r) => section.get(r.from) !== section.get(r.to)).length;
}

export interface Robustness {
  frames: number;
  crossLinks: number;
  /** Orders tried (0 when the plan has no cross-frame links or fewer than 2 frames). */
  orders: number;
  /** Orders with a fatal layout issue (`link_through_card`). */
  fatal: number;
  /** Crossings over the orders tried: the worst, and the median. */
  maxCrossings: number;
  medianCrossings: number;
}

export async function frameOrderRobustness(plan: VisualPlan, options: { organisation?: Organisation; shuffles?: number; seed?: number } = {}): Promise<Robustness> {
  const frames = plan.nodes.filter((n) => n.type === "group").length;
  const crossLinks = crossFrameLinks(plan);
  if (frames < 2 || !crossLinks) return { frames, crossLinks, orders: 0, fatal: 0, maxCrossings: 0, medianCrossings: 0 };
  const orders = shuffledGroupOrders(plan, options.shuffles ?? ROBUSTNESS_SHUFFLES, options.seed);
  let fatal = 0;
  const crossings: number[] = [];
  for (const order of orders) {
    const facts = await renderFacts(order, options.organisation ? { organisation: options.organisation } : {});
    if (facts.layout.counts.throughCards > 0) fatal += 1;
    crossings.push(facts.layout.counts.crossings);
  }
  crossings.sort((a, b) => a - b);
  return { frames, crossLinks, orders: orders.length, fatal, maxCrossings: crossings.at(-1) ?? 0, medianCrossings: crossings[Math.floor(crossings.length / 2)] ?? 0 };
}

/** "101/120 (84%)", or "–" when nothing was tried. */
export function describeFatalShare(r: Robustness): string {
  return r.orders ? `${r.fatal}/${r.orders} (${Math.round((100 * r.fatal) / r.orders)}%)` : "–";
}
