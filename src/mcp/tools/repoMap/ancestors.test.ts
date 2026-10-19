import { describe, expect, it } from "vitest";
import { affectedAncestors } from "./ancestors";

/** L1 overview → L2 payments (under mod:payments) → L4 ops (under comp:charge); orders has no detail. */
const SECTIONS = {
  "mod:overview": { nodes: { "mod:payments": {}, "mod:orders": {} } },
  "mod:payments:parts": { parent: "mod:payments", nodes: { "comp:charge": {}, "comp:refund": {} } },
  "mod:payments:ops": { parent: "comp:charge", nodes: { "sym:charge": {}, "sym:capture": {} } },
};

describe("affectedAncestors (Lens plan §8.1 rule 4)", () => {
  it("walks a stale card's parent chain up the levels, nearest first", () => {
    expect(affectedAncestors(SECTIONS, ["sym:charge"])).toEqual(["comp:charge", "mod:payments"]);
    expect(affectedAncestors(SECTIONS, ["comp:refund"])).toEqual(["mod:payments"]);
  });

  it("lists each ancestor once, never one of the given keys, and level by level across several keys", () => {
    expect(affectedAncestors(SECTIONS, ["sym:charge", "sym:capture", "comp:refund"])).toEqual(["comp:charge", "mod:payments"]);
    // comp:charge is itself stale: it isn't repeated as an ancestor, but the walk still goes through it.
    expect(affectedAncestors(SECTIONS, ["sym:charge", "comp:charge"])).toEqual(["mod:payments"]);
  });

  it("a top-level card, a section key and an unknown key", () => {
    expect(affectedAncestors(SECTIONS, ["mod:orders"])).toEqual([]);
    expect(affectedAncestors(SECTIONS, ["mod:payments:ops"])).toEqual(["comp:charge", "mod:payments"]);
    expect(affectedAncestors(SECTIONS, ["nope"])).toEqual([]);
  });

  it("stops where a parent chain loops", () => {
    const loop = { a: { parent: "y", nodes: { x: {} } }, b: { parent: "x", nodes: { y: {} } } };
    expect(affectedAncestors(loop, ["x"])).toEqual(["y"]);
  });
});
