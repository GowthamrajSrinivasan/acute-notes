import { describe, expect, it } from "vitest";
import { foldOverflow } from "./repair";
import { templateFor } from "./templates";
import type { VisualNode } from "./types";

describe("foldOverflow on an update's flat sectioned plan", () => {
  // An outlined section's key is its units joined, often hundreds of characters (live chat-import merge, 2026-10-10).
  const section = Array.from({ length: 12 }, (_, i) => `A long heading about part ${i} of the conversation`).join(" ⨁ ");
  const node = (i: number): VisualNode => ({ id: `n${i}`, type: "text", stableKey: `${section} § text#${i}`, content: { markdown: `${"Detail ".repeat(250)}${i}` } });

  it("counts each node against its own section, and gives every overflow page its own id even under a long section key", () => {
    const nodes = Array.from({ length: 90 }, (_, i) => node(i));
    const { nodes: kept, folded } = foldOverflow(nodes, templateFor("sectioned"), { plan: 60, section: 60, sectionedPlan: 300 });
    expect(folded).toBe(30);
    const pages = kept.filter((n) => n.id.startsWith("more~"));
    expect(pages.length).toBeGreaterThan(1);
    expect(new Set(pages.map((p) => p.id)).size).toBe(pages.length);
    expect(pages.every((p) => p.id.length <= 200)).toBe(true);
  });
});

describe("foldOverflow and plain cards (origin \"plain\": a merge's unplaced parts)", () => {
  const caps = { plan: 60, section: 60, sectionedPlan: 300 };
  const ordinary = (i: number): VisualNode => ({ id: `n${i}`, type: "text", stableKey: `S${i % 20} § text#${i}`, content: { markdown: `Detail ${i}` } });
  const card = (i: number): VisualNode => ({ id: `c${i}`, type: "text", origin: "plain", stableKey: `Card ${i} § text#0`, content: { markdown: `## Card ${i}\n\nVerbatim ${i}` } });

  it("the plan limit is unchanged: the 301st ordinary node is folded, in order", () => {
    const { nodes, folded } = foldOverflow(Array.from({ length: 301 }, (_, i) => ordinary(i)), templateFor("sectioned"), caps);
    expect(folded).toBe(1);
    expect(nodes.filter((n) => n.id.startsWith("more~"))).toHaveLength(1);
  });

  it("a plain card past the plan limit stays a card: not counted, not folded into a page that has lost its heading", () => {
    const all = [...Array.from({ length: 300 }, (_, i) => ordinary(i)), ...Array.from({ length: 46 }, (_, i) => card(i))];
    const { nodes, folded } = foldOverflow(all, templateFor("sectioned"), caps);
    expect(folded).toBe(0);
    expect(nodes.filter((n) => n.origin === "plain")).toHaveLength(46);
    expect(nodes.some((n) => n.id.startsWith("more~"))).toBe(false);
  });
});

describe("foldOverflow with existing nodes (an update's previous plan)", () => {
  const caps = { plan: 60, section: 60, sectionedPlan: 300 };
  const node = (id: string, section: string): VisualNode => ({ id, type: "text", stableKey: `${section} § text#${id}`, content: { markdown: `Detail ${id}` } });

  it("never folds what is already there, counts it first, and folds only the nodes added on top of the limit", () => {
    const old = Array.from({ length: 290 }, (_, i) => node(`o${i}`, `S${i % 20}`));
    const added = Array.from({ length: 30 }, (_, i) => node(`a${i}`, `S${i % 20}`));
    const existing = new Set(old.map((n) => n.stableKey!));
    // The new nodes come first in the list; the old ones still keep their place.
    const { nodes, folded } = foldOverflow([...added, ...old], templateFor("sectioned"), caps, existing);
    expect(folded).toBe(20); // 300 − 290 = 10 added nodes fit; the other 20 fold
    expect(old.every((n) => nodes.some((k) => k.id === n.id))).toBe(true);
    expect(nodes.filter((n) => n.id.startsWith("a"))).toHaveLength(10);
  });

  it("without existing nodes the same list folds in order, as before", () => {
    const all = Array.from({ length: 320 }, (_, i) => node(`n${i}`, `S${i % 20}`));
    expect(foldOverflow(all, templateFor("sectioned"), caps).folded).toBe(20);
  });
});
