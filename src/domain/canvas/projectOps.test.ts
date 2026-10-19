import { describe, expect, it } from "vitest";
import { chooseOptionPatch, nextPromotion, uniqueKey, withoutRef, withRef } from "./projectOps";

describe("Promote (D33)", () => {
  it("walks a finding ephemeral → validated → decision, on the same node", () => {
    expect(nextPromotion("finding", { stage: "ephemeral" })).toMatchObject({ label: "Mark validated", patch: { stage: "validated" } });
    expect(nextPromotion("finding", undefined)).toMatchObject({ label: "Mark validated" });
    const toDecision = nextPromotion("finding", { stage: "validated" });
    expect(toDecision).toMatchObject({ label: "Promote to decision", kind: "decision", patch: { status: "proposed" } });
  });

  it("accepts a proposed decision, and blocks it while options exist and none is chosen", () => {
    expect(nextPromotion("decision", { status: "proposed" })).toEqual({ label: "Accept decision", patch: { status: "accepted" } });
    expect(nextPromotion("decision", undefined)).toMatchObject({ label: "Accept decision" });
    expect(nextPromotion("decision", { status: "proposed", options: [{ label: "A" }, { label: "B" }] })?.blocked).toBe("Choose an option first");
    expect(nextPromotion("decision", { status: "proposed", options: [{ label: "A" }], chosen: "A" })?.blocked).toBeUndefined();
  });

  it("has no promotion for the rest, or for an already accepted decision", () => {
    expect(nextPromotion("decision", { status: "accepted" })).toBeNull();
    expect(nextPromotion("decision", { status: "superseded" })).toBeNull();
    for (const k of ["project", "constraint", "open_question", "risk", "milestone", "progress_item", "annotation"] as const) expect(nextPromotion(k, {})).toBeNull();
    expect(nextPromotion(undefined, {})).toBeNull();
  });
});

describe("Choose (D34)", () => {
  const p = { status: "proposed" as const, options: [{ label: "Redis" }, { label: "Memcached" }] };
  it("chooses an option and accepts a proposed decision", () => {
    expect(chooseOptionPatch(p, "Redis")).toEqual({ chosen: "Redis", status: "accepted" });
  });
  it("keeps a superseded decision superseded", () => {
    expect(chooseOptionPatch({ ...p, status: "superseded" }, "Redis")).toEqual({ chosen: "Redis", status: "superseded" });
  });
  it("refuses a label that is not an option, and reopens with null", () => {
    expect(chooseOptionPatch(p, "Postgres")).toBeNull();
    expect(chooseOptionPatch(undefined, "Redis")).toBeNull();
    expect(chooseOptionPatch({ ...p, chosen: "Redis", status: "accepted" }, null)).toEqual({ chosen: undefined, status: "proposed" });
  });
});

describe("refs and keys", () => {
  it("adds a ref once and removes it", () => {
    expect(withRef(undefined, " a ")).toEqual(["a"]);
    expect(withRef(["a"], "a")).toEqual(["a"]);
    expect(withRef(["a"], "  ")).toEqual(["a"]);
    expect(withoutRef(["a", "b"], "a")).toEqual(["b"]);
  });
  it("makes a node key unique so it can resolve (D53)", () => {
    expect(uniqueKey("p.new-decision", new Set())).toBe("p.new-decision");
    expect(uniqueKey("p.new-decision", new Set(["p.new-decision"]))).toBe("p.new-decision-2");
    expect(uniqueKey("p.new-decision", new Set(["p.new-decision", "p.new-decision-2"]))).toBe("p.new-decision-3");
  });
});
