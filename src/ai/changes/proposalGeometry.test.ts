/**
 * Sub-topic and sub-group backdrops in the proposal geometry: a link inside a sub-topic runs over its own backdrop by
 * design, so a backdrop is never a card a link crosses (fatal `link_through_card`); real cards still are.
 */
import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { ProposedChange } from "./changeSet";
import { checkProposal, proposalGeometry } from "./proposalGeometry";

const box = (x: number, y: number, width = 100, height = 60) => ({ x, y, width, height });
const el = (id: string, type: string, b: ReturnType<typeof box>, extra: Partial<SceneElement> = {}): SceneElement => ({
  ...b,
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

/** Two cards stacked inside one sub-topic backdrop, linked top to bottom. */
const inSubTopic = (): ProposedChange[] => [
  { kind: "create_shape", key: "g1::sub0", shape: "rectangle", box: box(-20, -20, 140, 300), backdrop: true },
  { kind: "create_shape", key: "a", shape: "rectangle", label: "A", box: box(0, 0) },
  { kind: "create_shape", key: "b", shape: "rectangle", label: "B", box: box(0, 200) },
  { kind: "connect", key: "a-b", from: { created: "a" }, to: { created: "b" } },
];

describe("backdrops in the proposal geometry", () => {
  it("a link between two cards inside one sub-topic backdrop is not fatal", () => {
    const changes = inSubTopic();
    const g = proposalGeometry(changes, []);
    expect(g.cards.map((c) => c.id)).toEqual(["created:a", "created:b"]);
    expect(g.backdrops.map((c) => c.id)).toEqual(["created:g1::sub0"]);
    const report = checkProposal(changes, []);
    expect(report.counts.throughCards).toBe(0);
    expect(report.issues.filter((i) => i.severity === "fatal")).toEqual([]);
  });

  it("a backdrop already on the canvas (customData.acuteBackdrop) is not an obstacle for an existing link either", () => {
    const scene = [
      el("bd", "rectangle", box(-20, -20, 140, 300), { customData: { acuteBackdrop: true } }),
      el("a", "rectangle", box(0, 0)),
      el("b", "rectangle", box(0, 200)),
      el("arr", "arrow", { x: 50, y: 66, width: 0, height: 128 }, { points: [[0, 0], [0, 128]], startBinding: { elementId: "a" }, endBinding: { elementId: "b" } }),
    ];
    // A new card elsewhere makes the set non-empty; the existing link over its backdrop is not reported.
    const changes: ProposedChange[] = [{ kind: "move", target: "a", to: { x: 0, y: 0 } }];
    expect(checkProposal(changes, scene).issues).toEqual([]);
    expect(proposalGeometry(changes, scene).backdrops.map((b) => b.id)).toEqual(["bd"]);
  });

  it("a link through a real card inside the backdrop is still fatal", () => {
    const scene = [
      el("bd", "rectangle", box(-20, -20, 140, 500), { customData: { acuteBackdrop: true } }),
      el("a", "rectangle", box(0, 0)),
      el("b", "rectangle", box(0, 400)),
      el("arr", "arrow", { x: 50, y: 66, width: 0, height: 328 }, { points: [[0, 0], [0, 328]], startBinding: { elementId: "a" }, endBinding: { elementId: "b" } }),
    ];
    const land: ProposedChange[] = [{ kind: "create_shape", key: "mid", shape: "rectangle", box: box(0, 200) }];
    const report = checkProposal(land, scene);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({ code: "link_through_card", severity: "fatal", subject: ["arr", "created:mid"] });
  });
});
