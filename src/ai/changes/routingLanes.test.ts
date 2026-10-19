import { describe, expect, it } from "vitest";
import { checkLayout } from "./layoutCheck";
import { LANE_SPACING, PORT_SPACING, placeLabel, routeConnectors } from "./routing";

const box = (id: string, x: number, y: number, width: number, height: number) => ({ id, x, y, width, height });

/**
 * The live run of 2026-10-08: two sections on top, three below; one top section links to all three below and the
 * other to one of them — the links left together, ran along one line in the gutter and their labels stacked.
 */
const units = box("units", 0, 0, 600, 500);
const wording = box("wording", 700, 0, 700, 400);
const safe = box("safe", 0, 600, 380, 500);
const tests = box("tests", 476, 600, 380, 650);
const deck = box("deck", 952, 600, 480, 800);
const frames = [units, wording, safe, tests, deck];
const others = (a: { id: string }, b: { id: string }) => frames.filter((f) => f.id !== a.id && f.id !== b.id);
const link = (key: string, from: typeof units, to: typeof units) => ({ key, from, to, avoid: others(from, to), wide: true });
const requests = [link("explains", units, safe), link("validated", units, tests), link("verified", units, deck), link("verifiedW", wording, deck)];
const labels: Record<string, string> = { explains: "explained by", validated: "validated by", verified: "verified in", verifiedW: "verified in" };

describe("links between sections", () => {
  const routes = routeConnectors(requests, []);

  it("leave a frame's side spread across it, not PORT_SPACING apart", () => {
    const starts = requests.filter((r) => r.from === units).map((r) => routes.get(r.key)!.points[0]!.x).sort((a, b) => a - b);
    expect(starts[1]! - starts[0]!).toBeGreaterThan(PORT_SPACING * 4);
    expect(starts[2]! - starts[1]!).toBeGreaterThan(PORT_SPACING * 4);
  });

  it("don't share a corridor in the gutter, and their labels don't collide", () => {
    const taken: { x: number; y: number; width: number; height: number }[] = [];
    const links = requests.map((r) => {
      const points = routes.get(r.key)!.points;
      const label = labels[r.key]!;
      const width = label.length * 8.5 + 8;
      const at = placeLabel(points, width, 24, taken);
      taken.push({ x: at.x - width / 2, y: at.y - 12, width, height: 24 });
      return { key: r.key, fromId: r.from.id, toId: r.to.id, points, label, labelAt: at };
    });
    const report = checkLayout({ cards: [], frames, links });
    expect(report.counts.sharedCorridors).toBe(0);
    expect(report.counts.labelCollisions).toBe(0);
    // Every link still leaves and enters its frames, and crosses none of the other sections.
    for (const r of requests) expect(routes.get(r.key)!.crossings).toBe(0);
  });

  it("parallel runs in one gutter sit LANE_SPACING apart", () => {
    const runs = requests
      .map((r) => routes.get(r.key)!.points)
      .flatMap((p) => p.slice(1, -2).map((a, i) => [a, p[i + 2]!] as const))
      .filter(([a, b]) => Math.abs(a.y - b.y) < 0.5)
      .map(([a]) => a.y)
      .sort((a, b) => a - b);
    for (let i = 1; i < runs.length; i += 1) expect(runs[i]! - runs[i - 1]!).toBeGreaterThanOrEqual(LANE_SPACING - 0.5);
  });
});

describe("placeLabel", () => {
  it("goes to the longest segment's middle when that is clear, else slides along the route", () => {
    const points = [{ x: 0, y: 0 }, { x: 400, y: 0 }];
    expect(placeLabel(points, 80, 24, [])).toEqual({ x: 200, y: 0 });
    const moved = placeLabel(points, 80, 24, [{ x: 160, y: -12, width: 80, height: 24 }]);
    expect(Math.abs(moved.x - 200)).toBeGreaterThanOrEqual(80);
    expect(moved.y).toBe(0);
  });
});
