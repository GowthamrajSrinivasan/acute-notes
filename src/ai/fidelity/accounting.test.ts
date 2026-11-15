import { describe, expect, it } from "vitest";
import type { Idea, Omission, ReviewFlag, SourceUnit } from "./contracts";
import { accountUnits, criticalReasonsOf } from "./accounting";

function unit(id: string, text: string, topic = "t1"): SourceUnit {
  return { id, kind: "sentence", text, hash: id, topic, span: { start: 0, end: text.length } };
}

function idea(id: string, cites: string[], title = "A card"): Idea {
  return { id, title, body: "", cites };
}

/** 40 plain units, none critical: statements with no cue words. */
function plainUnits(n: number, topic = "t1"): SourceUnit[] {
  return Array.from({ length: n }, (_, i) => unit(`u${i + 1}`, `The dashboard shows chart number ${i + 1} in blue.`, topic));
}

describe("criticalReasonsOf (§3.2)", () => {
  it("finds limitations, requirements, conditions, the takeaway and protected content", () => {
    expect(criticalReasonsOf(unit("u1", "However, the cache is not suitable for large files."), {})).toEqual(["limitation"]);
    expect(criticalReasonsOf(unit("u1", "Tokens must be rotated every 90 days."), {})).toEqual(["requirement"]);
    expect(criticalReasonsOf(unit("u1", "Retry the request if it times out."), {})).toEqual(["condition"]);
    expect(criticalReasonsOf(unit("u1", "The chart is blue."), { takeawayCites: ["u1"], protectedUnits: new Set(["u1"]) })).toEqual(["takeaway", "protected"]);
    expect(criticalReasonsOf(unit("u1", "The chart is blue."), {})).toEqual([]);
  });

  it("greetings, sign-offs and meta lines are not critical, even with \"if\" or \"when\" (the live run of 2026-10-19)", () => {
    for (const line of [
      "Hope this helps — let me know if you want a sample consumer!",
      "Let me know when you've had a chance to look.",
      "Feel free to ping me if you have any questions.",
      "As discussed, thanks everyone.",
      "If that helps, great question by the way.",
    ])
      expect(criticalReasonsOf(unit("u1", line), {}), line).toEqual([]);
    // What the line says besides its meta phrase still counts.
    expect(criticalReasonsOf(unit("u1", "As discussed, the limit must be 500 per tenant."), {})).toEqual(["requirement"]);
    expect(criticalReasonsOf(unit("u1", "Thanks — retry only when the cache holds a valid result."), {})).toContain("condition");
  });

  it("a sign-off omitted as filler is Intentionally omitted, not a critical_omitted alarm", () => {
    const units = [unit("u1", "The consumer reads from the queue."), unit("u2", "Hope this helps — let me know if you want a sample consumer!")];
    const r = accountUnits({ units, ideas: [idea("n1", ["u1"])], omitted: [{ unit: "u2", reason: "filler" }] });
    expect(r.outcome.u2).toBe("omitted");
    expect(r.flags).toEqual([]);
  });

  it("a decision, or the group's assent to one, is critical: left out as filler it is Needs review (kn-05, 2026-10-19)", () => {
    expect(criticalReasonsOf(unit("u1", "Agreed: lower the checkout alert to 5% over 5 minutes."), {})).toContain("decision");
    expect(criticalReasonsOf(unit("u1", "Leila: No objection from me."), {})).toEqual(["decision"]);
    expect(criticalReasonsOf(unit("u1", "Tomás: I'm fine with that."), {})).toEqual(["decision"]);
    const units = [unit("u1", "Agreed: config moves into the repo."), unit("u2", "Tomás: I'm fine with that.")];
    const r = accountUnits({ units, ideas: [idea("n1", ["u1"])], omitted: [{ unit: "u2", reason: "filler" }] });
    expect(r.outcome.u2).toBe("needs_review");
    expect(r.flags).toEqual([expect.objectContaining({ code: "critical_omitted", unit: "u2" })]);
  });

  it("reads curly apostrophes and matches whole words only", () => {
    expect(criticalReasonsOf(unit("u1", "The importer doesn’t keep blank rows."), {})).toContain("limitation");
    // "button" contains "but", "ifconfig" contains "if": not cues.
    expect(criticalReasonsOf(unit("u1", "Press the button and run ifconfig."), {})).toEqual([]);
  });
});

describe("accountUnits (§3.2)", () => {
  it("accounts for every unit: cited ones are represented, filler omissions are omitted", () => {
    const units = plainUnits(4);
    const r = accountUnits({ units, ideas: [idea("n1", ["u1", "u2"]), idea("n2", ["u3"])], omitted: [{ unit: "u4", reason: "filler" }] });
    expect(r.state).toEqual({ u1: "cited", u2: "cited", u3: "cited", u4: "omitted" });
    expect(r.outcome).toEqual({ u1: "represented", u2: "represented", u3: "represented", u4: "omitted" });
    expect(r.flags).toEqual([]);
    expect(r.sections).toEqual([{ topic: "t1", represented: 3, omitted: 1, needsReview: 0, highOmittedShare: false }]);
  });

  it("one critical caveat omitted among 40 units → Needs review, even as the only omission", () => {
    const units = plainUnits(40);
    units[17] = unit("u18", "Note that the export does not include archived boards.");
    const ideas = [idea("n1", units.filter((u) => u.id !== "u18").map((u) => u.id))];
    const r = accountUnits({ units, ideas, omitted: [{ unit: "u18", reason: "filler" }] });
    expect(r.state.u18).toBe("review");
    expect(r.outcome.u18).toBe("needs_review");
    expect(r.critical.u18).toContain("limitation");
    expect(r.flags).toEqual([expect.objectContaining({ code: "critical_omitted", unit: "u18" })]);
    expect(r.sections[0]).toMatchObject({ represented: 39, omitted: 0, needsReview: 1, highOmittedShare: false });
  });

  it("lets a critical unit go as a duplicate of a cited unit, or as superseded", () => {
    const units = [unit("u1", "Tokens must be rotated every 90 days."), unit("u2", "Again: tokens must be rotated every 90 days."), unit("u3", "Never share tokens."), unit("u4", "Never share tokens in chat.")];
    const omitted: Omission[] = [
      { unit: "u2", reason: "duplicate", of: "u1" },
      { unit: "u3", reason: "superseded" },
    ];
    const r = accountUnits({ units, ideas: [idea("n1", ["u1", "u4"])], omitted });
    expect(r.state).toMatchObject({ u2: "omitted", u3: "omitted" });
    expect(r.flags).toEqual([]);
  });

  it("restores a protected unit that was omitted", () => {
    const units = [unit("u1", "The timeout is 30 s."), unit("u2", "The chart is blue.")];
    const r = accountUnits({ units, ideas: [idea("n1", ["u2"])], omitted: [{ unit: "u1", reason: "filler" }], protectedUnits: new Set(["u1"]) });
    expect(r.state.u1).toBe("restored");
    expect(r.outcome.u1).toBe("represented");
    expect(r.critical.u1).toEqual(["protected"]);
  });

  it("never restores a protected unit omitted as superseded (a revised value stays off the canvas)", () => {
    const units = [unit("u1", "The timeout is 30 s."), unit("u2", "The timeout is now 45 s.")];
    const r = accountUnits({ units, ideas: [idea("n1", ["u2"])], omitted: [{ unit: "u1", reason: "superseded" }], protectedUnits: new Set(["u1", "u2"]) });
    expect(r.state.u1).toBe("omitted");
    expect(r.outcome.u1).toBe("omitted");
    expect(r.flags).toEqual([]);
  });

  it("sends a duplicate of an uncited unit, or one that names nothing, to Needs review", () => {
    const units = plainUnits(3);
    const r = accountUnits({
      units,
      ideas: [idea("n1", ["u1"])],
      omitted: [
        { unit: "u2", reason: "duplicate", of: "u3" },
        { unit: "u3", reason: "duplicate" },
      ],
    });
    expect(r.state).toMatchObject({ u2: "review", u3: "review" });
    expect(r.flags.map((f) => f.code)).toEqual(["duplicate_of_uncited", "duplicate_of_uncited"]);
  });

  it("marks units of a failed section pending, never complete, whatever the model said", () => {
    const units = plainUnits(3);
    const r = accountUnits({ units, ideas: [idea("n1", ["u1"])], omitted: [{ unit: "u2", reason: "filler" }], pending: ["u1", "u2", "u3"] });
    expect(Object.values(r.state)).toEqual(["pending", "pending", "pending"]);
    expect(Object.values(r.outcome)).toEqual(["needs_review", "needs_review", "needs_review"]);
    expect(r.flags.every((f) => f.code === "pending")).toBe(true);
  });

  it("sends a unit neither cited nor omitted, or omitted for an unknown reason, to Needs review", () => {
    const units = plainUnits(2);
    const r = accountUnits({ units, ideas: [], omitted: [{ unit: "u2", reason: "boring" as Omission["reason"] }] });
    expect(r.state).toEqual({ u1: "review", u2: "review" });
    expect(r.flags.map((f) => f.code)).toEqual(["unaccounted", "unaccounted"]);
  });

  it("puts a cited unit in review only when every citing card is flagged about it", () => {
    const units = plainUnits(3);
    const ideas = [idea("n1", ["u1", "u2"]), idea("n2", ["u2"]), idea("n3", ["u3"])];
    const flags: ReviewFlag[] = [
      { code: "qualifier_dropped", unit: "u2", card: "n1", detail: "x" },
      { code: "absolute_added", card: "n3", detail: "y" },
    ];
    const r = accountUnits({ units, ideas, omitted: [], flags });
    expect(r.state).toEqual({ u1: "cited", u2: "cited", u3: "review" });
    // The flags still reach the queue: a flagged card is Needs review through its flags.
    expect(r.flags).toEqual(flags);
    const both = accountUnits({ units, ideas, omitted: [], flags: [...flags, { code: "negation_flip", unit: "u2", card: "n2", detail: "z" }] });
    expect(both.state.u2).toBe("review");
  });

  it("notes a section with a high omitted share (OD4), per topic", () => {
    const units = [...plainUnits(10, "a").map((u) => ({ ...u, id: `a${u.id}` })), ...plainUnits(10, "b").map((u) => ({ ...u, id: `b${u.id}` }))];
    const omitted: Omission[] = ["au1", "au2", "au3", "bu1", "bu2"].map((u) => ({ unit: u, reason: "filler" }));
    const cited = units.map((u) => u.id).filter((id) => !omitted.some((o) => o.unit === id));
    const r = accountUnits({ units, ideas: [idea("n1", cited)], omitted });
    expect(r.sections).toEqual([
      { topic: "a", represented: 7, omitted: 3, needsReview: 0, highOmittedShare: true },
      { topic: "b", represented: 8, omitted: 2, needsReview: 0, highOmittedShare: false },
    ]);
  });

  it("ignores citations and omissions of unknown units", () => {
    const r = accountUnits({ units: plainUnits(1), ideas: [idea("n1", ["u1", "u99"])], omitted: [{ unit: "u42", reason: "filler" }] });
    expect(r.state).toEqual({ u1: "cited" });
  });
});
