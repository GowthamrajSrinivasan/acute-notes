import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { ProposedChange } from "./changeSet";
import { checkLayout, describeLayout, LAYOUT_LIMITS, type LayoutLink } from "./layoutCheck";
import { checkProposal, proposalGeometry } from "./proposalGeometry";

const card = (id: string, x: number, y: number, width = 100, height = 60) => ({ id, x, y, width, height });
const link = (key: string, fromId: string, toId: string, points: [number, number][], label?: string): LayoutLink => ({
  key,
  fromId,
  toId,
  points: points.map(([x, y]) => ({ x, y })),
  ...(label ? { label } : {}),
});

describe("layout checks (Wave 1b item 4)", () => {
  it("a clean layout has no issues and a zero score", () => {
    const r = checkLayout({ cards: [card("a", 0, 0), card("b", 300, 0)], frames: [], links: [link("l", "a", "b", [[106, 30], [294, 30]])] });
    expect(r).toMatchObject({ issues: [], score: 0, truncated: false });
    expect(describeLayout(r.counts)).toBeNull();
  });

  it("a link through an unrelated card is fatal, with code, subject, evidence and fixes", () => {
    const r = checkLayout({ cards: [card("a", 0, 0), card("mid", 150, 0), card("b", 300, 0)], frames: [], links: [link("l", "a", "b", [[106, 30], [294, 30]])] });
    expect(r.issues).toEqual([
      { code: "link_through_card", severity: "fatal", subject: ["l", "mid"], evidence: "the route of l runs through mid", fixes: expect.arrayContaining([expect.stringContaining("drop the link")]) },
    ]);
    expect(describeLayout(r.counts)).toBe("1 link crosses a card");
    // Touching a card's edge (the routes' own clearance) is not crossing it.
    const grazing = checkLayout({ cards: [card("a", 0, 0), card("mid", 150, 31), card("b", 300, 0)], frames: [], links: [link("l", "a", "b", [[106, 30], [294, 30]])] });
    expect(grazing.issues).toEqual([]);
  });

  it("counts link crossings, shared corridors, frame borders and label collisions", () => {
    const r = checkLayout({
      cards: [card("a", 0, 0), card("b", 400, 0), card("c", 200, -200), card("d", 200, 200)],
      frames: [card("f", -20, 100, 600, 50)],
      links: [
        link("h", "a", "b", [[106, 30], [394, 30]], "calls"),
        link("v", "c", "d", [[250, -134], [250, 194]], "reads"),
        link("h2", "a", "b", [[106, 32], [394, 32]]),
        link("border", "a", "b", [[50, 100], [450, 100]]),
      ],
    });
    expect(r.counts).toMatchObject({ crossings: 3, sharedCorridors: 1, onFrameBorders: 1, labelCollisions: 1 });
    expect(r.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["links_cross", "links_share_corridor", "link_on_frame_border", "label_collision"]));
    expect(r.issues.every((i) => i.severity === "warning")).toBe(true);
  });

  it("focus limits the report to what a proposal adds; the score compares layouts", () => {
    const geometry = { cards: [card("a", 0, 0), card("mid", 150, 0), card("b", 300, 0)], frames: [], links: [link("old", "a", "b", [[106, 30], [294, 30]])] };
    expect(checkLayout(geometry, { focus: new Set(["new"]) }).issues).toEqual([]);
    // A new card placed on an existing link is the proposal's issue.
    expect(checkLayout(geometry, { focus: new Set(["mid"]) }).issues.map((i) => i.code)).toEqual(["link_through_card"]);
    const worse = checkLayout(geometry).score;
    const better = checkLayout({ ...geometry, cards: geometry.cards.filter((c) => c.id !== "mid") }).score;
    expect(better).toBeLessThan(worse);
  });

  it("is bounded", () => {
    const cards = [card("a", 0, 0), card("b", 10_000, 0), ...Array.from({ length: 80 }, (_, i) => card(`m${i}`, 200 + i * 110, 0))];
    const r = checkLayout({ cards, frames: [], links: [link("l", "a", "b", [[106, 30], [9_994, 30]])] });
    expect(r.issues).toHaveLength(LAYOUT_LIMITS.issues);
    expect(r.truncated).toBe(true);
    expect(r.counts.throughCards).toBe(80);
  });
});

const el = (id: string, type: string, box: { x: number; y: number; width: number; height: number }, extra: Partial<SceneElement> = {}): SceneElement => ({
  ...box,
  id,
  type,
  angle: 0,
  locked: false,
  opacity: 100,
  isDeleted: false,
  groupIds: [],
  strokeColor: "#000",
  backgroundColor: "transparent",
  strokeWidth: 1,
  strokeStyle: "solid",
  ...extra,
});

describe("proposal geometry", () => {
  const scene = [el("a", "rectangle", card("", 0, 0)), el("b", "rectangle", card("", 600, 0)), el("f", "frame", card("", -40, -40, 800, 200))];

  it("routes new links like the writer (around every card), so a clear path is clean", () => {
    const changes: ProposedChange[] = [
      { kind: "create_shape", key: "mid", shape: "rectangle", label: "Mid", box: card("", 300, 0) },
      { kind: "connect", key: "c1", from: { existing: "a" }, to: { existing: "b" } },
    ];
    const g = proposalGeometry(changes, scene);
    expect(g.cards.map((c) => c.id)).toEqual(["a", "b", "created:mid"]);
    expect(g.frames.map((f) => f.id)).toEqual(["f"]);
    expect([...g.focus].sort()).toEqual(["c1", "created:mid"]);
    // The router goes around the new card in the middle.
    expect(checkProposal(changes, scene).counts.throughCards).toBe(0);
  });

  it("an existing link that a new card lands on is reported; removed and moved objects count where they end up", () => {
    const arrow = el("arr", "arrow", { x: 106, y: 30, width: 488, height: 0 }, { points: [[0, 0], [488, 0]], startBinding: { elementId: "a" }, endBinding: { elementId: "b" } });
    const withArrow = [...scene, arrow];
    const land: ProposedChange[] = [{ kind: "create_shape", key: "mid", shape: "rectangle", box: card("", 300, 0) }];
    expect(checkProposal(land, withArrow).issues[0]).toMatchObject({ code: "link_through_card", subject: ["arr", "created:mid"] });
    // Removing the arrow in the same set leaves nothing to report.
    expect(checkProposal([...land, { kind: "remove", target: "arr" }], withArrow).issues).toEqual([]);
    // Moving an unrelated card onto the arrow is reported too.
    const other = [...withArrow, el("c", "rectangle", card("", 300, 400))];
    expect(checkProposal([{ kind: "move", target: "c", to: { x: 300, y: 0 } }], other).issues[0]).toMatchObject({ code: "link_through_card", subject: ["arr", "c"] });
  });
});
