import { describe, expect, it } from "vitest";
import { connectorSides, routeConnectors, simplify, type ConnectorRoute, type RoutedBox } from "./routing";

const box = (id: string, x: number, y: number, width = 140, height = 64): RoutedBox => ({ id, x, y, width, height });

const orthogonal = (r: ConnectorRoute) =>
  r.points.slice(1).every((p, i) => Math.abs(p.x - r.points[i]!.x) < 0.5 || Math.abs(p.y - r.points[i]!.y) < 0.5);

const routeOne = (from: RoutedBox, to: RoutedBox, obstacles: RoutedBox[] = []) =>
  routeConnectors([{ key: "c", from, to }], [from, to, ...obstacles]).get("c")!;

describe("connector sides", () => {
  it("uses left/right when the boxes are further apart horizontally, top/bottom when stacked", () => {
    expect(connectorSides(box("a", 0, 0), box("b", 300, 40))).toEqual({ fromSide: "right", toSide: "left" });
    expect(connectorSides(box("a", 300, 0), box("b", 0, 40))).toEqual({ fromSide: "left", toSide: "right" });
    expect(connectorSides(box("a", 0, 0), box("b", 20, 200))).toEqual({ fromSide: "bottom", toSide: "top" });
    expect(connectorSides(box("a", 0, 200), box("b", 20, 0))).toEqual({ fromSide: "top", toSide: "bottom" });
  });
});

describe("routes", () => {
  it("aligned boxes get one straight segment, outside both boxes by the gap", () => {
    const r = routeOne(box("a", 0, 0), box("b", 300, 0));
    expect(r.points).toEqual([
      { x: 148, y: 32 },
      { x: 292, y: 32 },
    ]);
    expect(r.startRatio).toEqual([1, 0.5]);
    expect(r.endRatio).toEqual([0, 0.5]);
  });

  it("offset boxes get a right-angle route that leaves and enters perpendicular to its sides", () => {
    const r = routeOne(box("a", 0, 0), box("b", 300, 150));
    expect(orthogonal(r)).toBe(true);
    expect(r.points.length).toBe(4);
    expect(r.points[0]!.y).toBe(r.points[1]!.y); // leaves horizontally
    expect(r.points[2]!.y).toBe(r.points[3]!.y); // arrives horizontally
    expect(r.crossings).toBe(0);
  });

  it("goes around an unrelated box instead of through it", () => {
    const a = box("a", 0, 0);
    const b = box("b", 600, 0);
    const wall = box("wall", 250, -20, 140, 104); // straight in the way
    const r = routeOne(a, b, [wall]);
    expect(orthogonal(r)).toBe(true);
    expect(r.crossings).toBe(0);
    expect(r.points.some((p) => p.y < wall.y || p.y > wall.y + wall.height)).toBe(true);
  });

  it("spreads connectors that share a side, ordered by the other end, 14 px apart and clear of the corners", () => {
    const hub = box("hub", 0, 100);
    const up = box("up", 400, 0);
    const mid = box("mid", 400, 100);
    const down = box("down", 400, 200);
    const routes = routeConnectors(
      [
        { key: "down", from: hub, to: down },
        { key: "up", from: hub, to: up },
        { key: "mid", from: hub, to: mid },
      ],
      [hub, up, mid, down],
    );
    const ys = ["up", "mid", "down"].map((k) => routes.get(k)!.points[0]!.y);
    expect(ys).toEqual([118, 132, 146]); // centre 132, spacing 14, ordered top to bottom like their targets
    for (const y of ys) {
      expect(y - hub.y).toBeGreaterThanOrEqual(16);
      expect(hub.y + hub.height - y).toBeGreaterThanOrEqual(16);
    }
    for (const r of routes.values()) expect(orthogonal(r)).toBe(true);
  });

  it("when only one end was spread, the other end moves onto its line instead of making a tiny jog", () => {
    const hub = box("hub", 0, 0);
    const next = box("next", 300, 0); // facing hub, only one connector on its left side
    const below = box("below", 300, 60); // hub's right side is shared with this one
    const routes = routeConnectors(
      [
        { key: "next", from: hub, to: next },
        { key: "below", from: hub, to: below },
      ],
      [hub, next, below],
    );
    const r = routes.get("next")!;
    expect(r.points).toHaveLength(2); // straight: no jog
    expect(r.points[0]!.y).toBe(r.points[1]!.y);
    expect(r.points[0]!.y).not.toBe(hub.y + hub.height / 2); // the spread (shared) port was kept
  });

  it("is deterministic", () => {
    const boxes = [box("a", 0, 0), box("b", 300, 150), box("c", 150, 300), box("w", 160, 60, 80, 60)];
    const reqs = [
      { key: "1", from: boxes[0]!, to: boxes[1]! },
      { key: "2", from: boxes[1]!, to: boxes[2]! },
    ];
    expect(routeConnectors(reqs, boxes)).toEqual(routeConnectors(reqs, boxes));
  });

  it("stays fast on a large canvas", () => {
    const boxes: RoutedBox[] = [];
    for (let i = 0; i < 1500; i += 1) boxes.push(box(`b${i}`, (i % 50) * 200, Math.floor(i / 50) * 120));
    const reqs = Array.from({ length: 300 }, (_, i) => ({ key: `c${i}`, from: boxes[i * 3]!, to: boxes[i * 3 + 51]! }));
    const t = performance.now();
    routeConnectors(reqs, boxes);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("simplify", () => {
  it("drops repeated and collinear points", () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]);
  });
});
