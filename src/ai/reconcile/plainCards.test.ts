import { describe, expect, it } from "vitest";
import { economyCards, plainRuns, plainRunsBySpans } from "./plainCards";
import type { AnalysisUnit } from "./units";

const unit = (key: string, text: string, start: number, end: number): AnalysisUnit => ({ key, text, span: { start, end } });

describe("plain cards: finding an unplaced section's units", () => {
  const units = [unit("R › A", "## A\n\nalpha", 0, 13), unit("R › B", "## B\n\nbeta", 13, 25), unit("R › C", "## C\n\ngamma", 25, 38)];

  it("by position: the units that start inside a span, whatever their text reads (a unit's span runs on to the next heading)", () => {
    // the merge's text for B differs from the unit's (extra trailing characters): matching text would miss it, the span does not
    const runs = plainRunsBySpans(units, [{ start: 13, end: 23 }]);
    expect(runs.map((r) => r.map((u) => u.key))).toEqual([["R › B"]]);
    expect(plainRuns(units, new Set(["## B\n\nbeta!"]))).toEqual([]);
  });

  it("a span with no unit gives no run; units outside every span are left to the model", () => {
    expect(plainRunsBySpans(units, [{ start: 100, end: 120 }])).toEqual([]);
  });

  it("by text, as before: consecutive units that together read as one section", () => {
    expect(plainRuns(units, new Set(["## A\n\nalpha\n\n## B\n\nbeta"])).map((r) => r.map((u) => u.key))).toEqual([["R › A", "R › B"]]);
  });
});

describe("economyCards", () => {
  it("one verbatim text card per paragraph, with a stable key made from its text, and no links", () => {
    const raw = economyCards(["First paragraph.", "Second one."]) as { nodes: { id: string; type: string; stableKey: string; content: { markdown: string } }[]; relationships: unknown[] };
    expect(raw.nodes.map((n) => n.content.markdown)).toEqual(["First paragraph.", "Second one."]);
    expect(raw.nodes.every((n) => n.type === "text" && n.stableKey.startsWith("added#"))).toBe(true);
    expect(new Set(raw.nodes.map((n) => n.stableKey)).size).toBe(2);
    expect(raw.relationships).toEqual([]);
    expect((economyCards(["First paragraph."]) as typeof raw).nodes[0]!.stableKey).toBe(raw.nodes[0]!.stableKey);
  });
});
