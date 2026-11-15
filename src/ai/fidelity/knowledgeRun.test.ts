/**
 * A distil run as a whole (WP1.10–1.12): accounting over the whole document, citations onto the validated plan (also
 * through nodes the plan folded away), each card's knowledge by stable key, and the latest run per source for the dev hook.
 */
import { describe, expect, it } from "vitest";
import type { VisualPlan } from "@/ai/visual-plan/types";
import type { SourceUnit, UnitSet } from "./contracts";
import type { SectionKnowledge } from "./knowledgeCheck";
import { accountRun, finishKnowledgeRun, knowledgeRunOf, knowledgeRunWithPlan, onPlan, rememberKnowledgeRun } from "./knowledgeRun";

const unit = (id: string, text: string, topic = "t1"): SourceUnit => ({ id, kind: "sentence", text, hash: id, topic, span: { start: 0, end: 1 } });
const UNITS: UnitSet = {
  units: [unit("u1", "Retries can improve reliability when the cache holds a valid result."), unit("u2", "The cache keeps at most 500 entries per tenant.", "t2"), unit("u3", "We once kept 100 entries.", "t2")],
  nextId: 4,
};
const section = (over: Partial<SectionKnowledge> & { key: string; label: string }): SectionKnowledge & { key: string; label: string } => ({
  units: [],
  ideas: [],
  omitted: [],
  problems: [],
  flags: [],
  hints: [],
  reviews: {},
  restored: { items: [], units: [] },
  needsReview: 0,
  exactMissing: [],
  ...over,
});
const SECTIONS = [
  section({ key: "s1", label: "Retries", units: ["u1"], ideas: [{ id: "u1_n1", title: "Retries help", body: "Retries can improve reliability when the cache holds a valid result.", cites: ["u1"] }] }),
  section({
    key: "s2",
    label: "Limits",
    units: ["u2"],
    ideas: [
      { id: "u2_n1", title: "Bounded", body: "At most 500 entries per tenant.", cites: ["u2"] },
      { id: "u2_n2", title: "Per tenant", body: "Counted per tenant.", cites: ["u2"] },
    ],
    flags: [{ code: "uncited_card", card: "u2_n2", detail: "the card cites no passage of the source" }],
    reviews: { u2_n2: { reasons: ["the card cites no passage of the source"] } },
  }),
];
const PLAN: VisualPlan = {
  version: 1,
  template: "sectioned",
  nodes: [
    { id: "u1_n1", type: "text", title: "Retries help", stableKey: "s1 § text#1", content: { markdown: "Retries can improve reliability when the cache holds a valid result." } },
    // u2_n2 was merged into u2_n1 (`mergeDetailCards`): its text now lives there.
    { id: "u2_n1", type: "text", stableKey: "s2 § text#1", content: { markdown: "**Bounded**\n\nAt most 500 entries per tenant.\n\n**Per tenant**\n\nCounted per tenant." } },
  ],
  relationships: [],
} as VisualPlan;

describe("a distil run as a whole", () => {
  it("a unit whose only citing card drops its condition is Needs review over the whole run, not Represented", () => {
    const dropped = section({
      key: "s1",
      label: "Retries",
      units: ["u1"],
      ideas: [{ id: "u1_n1", title: "Retries help", body: "Retrying makes calls more reliable.", cites: ["u1"] }],
      flags: [{ code: "critical_dropped", card: "u1_n1", unit: "u1", detail: 'the card drops the condition "when the cache holds a valid result"' }],
    });
    const run = accountRun(UNITS, [dropped, SECTIONS[1]!], { superseded: ["We once kept 100 entries."] });
    expect(run.accounting.outcome.u1).toBe("needs_review");
    expect(run.flags.filter((f) => f.unit === "u1").map((f) => f.code)).toEqual(["critical_dropped"]);
  });

  it("report v2 counts the model check's verdicts over the run (OD5b), by section summed", () => {
    const checked = [
      { ...SECTIONS[0]!, checked: { cards: 3, supported: 2, partly: 1, notSupported: 0, unanswered: 0 } },
      { ...SECTIONS[1]!, checked: { cards: 2, supported: 0, partly: 0, notSupported: 1, unanswered: 1 } },
    ];
    const { report } = finishKnowledgeRun({ units: UNITS, plan: PLAN, sections: checked, superseded: ["We once kept 100 entries."] });
    expect(report.modelCheck).toEqual({ cards: 5, supported: 2, partly: 1, notSupported: 1, unanswered: 1 });
    expect(finishKnowledgeRun({ units: UNITS, plan: PLAN, sections: SECTIONS }).report.modelCheck).toBeUndefined();
  });

  it("accounts over the whole document: a unit no section holds is superseded when a later statement revised it, else unaccounted", () => {
    const run = accountRun(UNITS, SECTIONS, { superseded: ["We once kept 100 entries."] });
    expect(run.accounting.outcome).toEqual({ u1: "represented", u2: "represented", u3: "omitted" });
    expect(run.omitted).toEqual([{ unit: "u3", reason: "superseded" }]);
    expect(accountRun(UNITS, SECTIONS).accounting.outcome.u3).toBe("needs_review");
  });

  it("puts citations and reviews on the plan's nodes, following a node the plan folded into another", () => {
    const placed = onPlan(PLAN, SECTIONS);
    expect(placed.cites).toEqual({ u1_n1: ["u1"], u2_n1: ["u2"] });
    expect(placed.reviews).toEqual({ u2_n1: { reasons: ["the card cites no passage of the source"] } });
    expect(placed.lost).toEqual([]);
  });

  it("finishes the run: each card's knowledge by stable key, report v2 and the run output", () => {
    const done = finishKnowledgeRun({ units: UNITS, plan: PLAN, sections: SECTIONS, superseded: ["We once kept 100 entries."] });
    expect(done.cards).toEqual({
      "s1 § text#1": { sourceUnits: ["u1"] },
      "s2 § text#1": { sourceUnits: ["u2"], review: { reasons: ["the card cites no passage of the source"] } },
    });
    expect(done.report).toMatchObject({ units: 3, outcomes: { represented: 2, omitted: 1, needsReview: 0 }, cards: { total: 3, needsReview: 1 }, flags: [{ code: "uncited_card", count: 1 }], lostCitations: 0 });
    expect(done.run).toMatchObject({ noteModel: "distil", units: UNITS, cites: placed(), omitted: [{ unit: "u3", reason: "superseded" }] });
    expect(done.run.flags!.map((f) => f.code)).toEqual(["uncited_card"]);
    function placed() {
      return { u1_n1: ["u1"], u2_n1: ["u2"] };
    }
  });

  it("keeps the latest run per source; the dev hook's copy has no plan", () => {
    const done = finishKnowledgeRun({ units: UNITS, plan: PLAN, sections: SECTIONS });
    rememberKnowledgeRun("src_a", done.run);
    expect(knowledgeRunWithPlan("src_a")!.plan).toBe(PLAN);
    const hook = knowledgeRunOf("src_a")!;
    expect(hook).not.toHaveProperty("plan");
    expect(hook.cites).toEqual(done.run.cites);
    expect(knowledgeRunOf("src_unknown")).toBeNull();
    // Serialisable as the recorder writes it.
    expect(JSON.parse(JSON.stringify(hook))).toEqual(hook);
  });
});
