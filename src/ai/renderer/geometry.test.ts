import { describe, expect, it } from "vitest";
import type { Box, ProposedChange } from "@/ai/changes/changeSet";
import { checkProposal } from "@/ai/changes/proposalGeometry";
import type { SceneElement } from "@/domain/canvas/adapter";
import { VALID_PLAN_FIXTURES } from "@/ai/visual-plan/fixtures";
import { geometryOf, readingOrderOf, rowMajorOrder } from "./geometry";
import { renderVisualPlan } from "./render";

const block = (key: string, box: Box): ProposedChange => ({ kind: "create_block", key, blockType: "text", content: [], box });
const frame = (key: string, box: Box, children: string[]): ProposedChange => ({ kind: "create_frame", key, title: key, box, children });
const connect = (key: string, from: string, to: string): ProposedChange => ({ kind: "connect", key, from: { created: from }, to: { created: to } });
const el = (id: string, type: string, box: Box, extra: Partial<SceneElement> = {}): SceneElement =>
  ({ id, type, ...box, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 1, strokeStyle: "solid", ...extra }) as SceneElement;

describe("geometryOf: each field on hand-made change sets", () => {
  it("reports overlapping cards, but never a backdrop behind its cards", () => {
    const r = geometryOf(
      [block("a", { x: 0, y: 0, width: 100, height: 100 }), block("b", { x: 50, y: 50, width: 100, height: 100 }), block("c", { x: 300, y: 0, width: 100, height: 100 }), { kind: "create_shape", key: "bd", shape: "rectangle", backdrop: true, box: { x: -10, y: -10, width: 500, height: 200 } }],
      [],
    );
    expect(r.cardOverlaps).toEqual(["a × b"]);
  });

  it("touching within 1 px is not an overlap", () => {
    expect(geometryOf([block("a", { x: 0, y: 0, width: 100, height: 100 }), block("b", { x: 99.5, y: 0, width: 100, height: 100 })], []).cardOverlaps).toEqual([]);
  });

  it("reports a card outside the frame that lists it, and overlapping frames", () => {
    const r = geometryOf(
      [frame("f1", { x: 0, y: 0, width: 300, height: 300 }, ["in", "out"]), frame("f2", { x: 250, y: 0, width: 300, height: 300 }, []), block("in", { x: 10, y: 10, width: 50, height: 50 }), block("out", { x: 280, y: 10, width: 50, height: 50 })],
      [],
    );
    expect(r.outsideFrames).toEqual(["out outside f1"]);
    expect(r.frameOverlaps).toEqual(["f1 × f2"]);
  });

  it("reports a sub-group member outside its backdrop", () => {
    const r = geometryOf(
      [{ kind: "create_shape", key: "g::sub0", shape: "rectangle", backdrop: true, box: { x: 0, y: 0, width: 200, height: 200 } }, block("m1", { x: 10, y: 10, width: 50, height: 50 }), block("m2", { x: 300, y: 10, width: 50, height: 50 })],
      [],
      { subGroups: new Map([["g::sub0", ["m1", "m2"]]]) },
    );
    expect(r.outsideSubGroups).toEqual(["m2 outside g::sub0"]);
  });

  it("reports a link that passes over a third frame, not over its own ends' frames", () => {
    // Three frames in a row; a link from the left frame's card to the right frame's card runs over the middle frame.
    const r = geometryOf(
      [
        frame("A", { x: 0, y: 0, width: 200, height: 200 }, ["a"]),
        frame("B", { x: 300, y: 0, width: 200, height: 200 }, ["b"]),
        frame("C", { x: 600, y: 0, width: 200, height: 200 }, ["c"]),
        block("a", { x: 50, y: 75, width: 100, height: 50 }),
        block("b", { x: 350, y: 150, width: 100, height: 40 }),
        block("c", { x: 650, y: 75, width: 100, height: 50 }),
        connect("ac", "a", "c"),
        connect("ab", "a", "b"),
      ],
      [],
    );
    expect(r.linksOverFrames).toContain("ac over B");
    expect(r.linksOverFrames.filter((x) => x.startsWith("ab "))).toEqual([]);
  });

  it("counts reading-order inversions: frames out of plan order, read row by row", () => {
    const frames = [
      { id: "A", box: { x: 0, y: 0, width: 100, height: 100 } },
      { id: "B", box: { x: 200, y: 20, width: 100, height: 100 } },
      { id: "C", box: { x: 0, y: 300, width: 100, height: 100 } },
    ];
    expect(rowMajorOrder(frames)).toEqual(["A", "B", "C"]);
    expect(readingOrderOf(frames, ["A", "B", "C"]).inversions).toBe(0);
    const swapped = readingOrderOf(frames, ["C", "A", "B"]);
    expect(swapped.inversions).toBe(2);
    expect(swapped.detail).toEqual(["A reads before C", "B reads before C"]);
    // From a change set: plan order is the create_frame order by default.
    const r = geometryOf([frame("B", frames[1]!.box, []), frame("A", frames[0]!.box, [])], []);
    expect(r.readingOrder.inversions).toBe(1);
  });

  it("reports a frame too big to read whole at 50% zoom on a 1600 × 900 screen", () => {
    const r = geometryOf([frame("big", { x: 0, y: 0, width: 3300, height: 500 }, []), frame("tall", { x: 0, y: 600, width: 500, height: 1900 }, []), frame("ok", { x: 4000, y: 0, width: 3200, height: 1800 }, [])], []);
    expect(r.oversizedFrames).toEqual(["big (3300 × 500)", "tall (500 × 1900)"]);
  });

  it("reports moved objects the user placed, not those still where Acute put them", () => {
    const scene = [
      el("mine", "rectangle", { x: 500, y: 500, width: 100, height: 100 }, { customData: { acuteLayout: { x: 0, y: 0 } } }),
      el("acute", "rectangle", { x: 0, y: 300, width: 100, height: 100 }, { customData: { acuteLayout: { x: 0, y: 300 } } }),
      el("nohint", "rectangle", { x: 900, y: 900, width: 100, height: 100 }),
    ];
    const r = geometryOf(
      [
        { kind: "move", target: "mine", to: { x: 0, y: 0 } },
        { kind: "move", target: "acute", to: { x: 0, y: 200 } },
        { kind: "move", target: "nohint", to: { x: 900, y: 1200 } },
      ],
      scene,
    );
    expect(r.movedUserPlaced).toEqual(["mine", "nohint"]);
  });

  it("reports changes outside the scope frames, and nothing without a scope", () => {
    const scene = [
      el("fA", "frame", { x: 0, y: 0, width: 500, height: 500 }),
      el("fB", "frame", { x: 1000, y: 0, width: 500, height: 500 }),
      el("a1", "rectangle", { x: 10, y: 10, width: 50, height: 50 }, { frameId: "fA" }),
      el("b1", "rectangle", { x: 1010, y: 10, width: 50, height: 50 }, { frameId: "fB" }),
      el("bdB", "rectangle", { x: 1005, y: 5, width: 80, height: 80 }, { frameId: "fB", customData: { acuteBackdrop: true } }),
    ];
    const changes: ProposedChange[] = [
      { kind: "move", target: "a1", to: { x: 20, y: 20 } },
      { kind: "move", target: "b1", to: { x: 1020, y: 20 } },
      { kind: "remove", target: "bdB" },
      { kind: "create_shape", key: "gA::sub0", shape: "rectangle", backdrop: true, box: { x: 5, y: 5, width: 100, height: 100 } },
      { kind: "update_frame", target: "fA", add: ["gA::sub0"] },
      { kind: "create_shape", key: "loose", shape: "rectangle", box: { x: 2000, y: 0, width: 50, height: 50 } },
    ];
    expect(geometryOf(changes, scene).outsideScope).toEqual([]);
    expect(geometryOf(changes, scene, { scope: new Set(["fA"]) }).outsideScope).toEqual(["move b1", "remove bdB", "create_shape loose"]);
    expect(geometryOf(changes.slice(0, 1), scene, { scope: new Set(["fA"]) }).outsideScope).toEqual([]);
  });
});

describe("geometryOf on a scene with moves and removals", () => {
  const scene = [el("x", "rectangle", { x: 0, y: 0, width: 100, height: 100 }), el("y", "rectangle", { x: 400, y: 0, width: 100, height: 100 }), el("z", "rectangle", { x: 800, y: 0, width: 100, height: 100 })];

  it("judges objects where the set leaves them: a move onto another card overlaps, a removed card no longer does", () => {
    const moved = geometryOf([{ kind: "move", target: "y", to: { x: 50, y: 50 } }], scene);
    expect(moved.cardOverlaps).toEqual(["x × y"]);
    const removed = geometryOf([{ kind: "remove", target: "x" }, { kind: "move", target: "y", to: { x: 50, y: 50 } }], scene);
    expect(removed.cardOverlaps).toEqual([]);
  });

  it("two existing cards that already overlap and aren't touched are not this set's doing", () => {
    const messy = [...scene, el("w", "rectangle", { x: 10, y: 10, width: 100, height: 100 })];
    expect(geometryOf([block("new", { x: 2000, y: 0, width: 10, height: 10 })], messy).cardOverlaps).toEqual([]);
  });

  it("its layout report is checkProposal's", () => {
    const changes: ProposedChange[] = [{ kind: "move", target: "y", to: { x: 400, y: 300 } }, block("n", { x: 200, y: 0, width: 100, height: 100 }), { kind: "connect", key: "l", from: { existing: "x" }, to: { existing: "z" } }];
    expect(geometryOf(changes, scene).layout).toEqual(checkProposal(changes, scene));
  });
});

describe("geometryOf on a first render", () => {
  it("a v1 render of a sectioned plan is clean: no overlaps, everything inside its frame, reading order kept", async () => {
    const set = await renderVisualPlan(VALID_PLAN_FIXTURES.sectioned, {
      operationId: "op",
      title: "t",
      metadata: { createdBy: "ai", task: "generate_visual_plan", operationId: "op" },
      context: { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 1000 } },
      parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }],
    });
    const r = geometryOf(set.changes, []);
    expect(r.cardOverlaps).toEqual([]);
    expect(r.outsideFrames).toEqual([]);
    expect(r.frameOverlaps).toEqual([]);
    expect(r.readingOrder.inversions).toBe(0);
    expect(r.movedUserPlaced).toEqual([]);
  });
});
