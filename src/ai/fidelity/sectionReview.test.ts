import { describe, expect, it } from "vitest";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { sectionReviews } from "./sectionReview";

const frame = (key: string, title: string) => ({ kind: "create_frame" as const, key, title: `1 · ${title}`, box: { x: 0, y: 0, width: 400, height: 300 }, children: [], overview: { title } });
const section = (key: string, label: string, units: number, placedByAI: number, missing: string[] = []) => ({
  key,
  label,
  units,
  placedByAI,
  addedFromSource: units - placedByAI,
  added: Array.from({ length: units - placedByAI }, (_, i) => `${label} point ${i}`),
  keyTerms: { total: 5, placedByAI: 5 - missing.length, missing },
});

function set(extra: Partial<ChangeSet>): ChangeSet {
  return {
    operationId: "op",
    title: "Visualize",
    metadata: { createdBy: "ai", task: "generate_visual_plan", operationId: "op" },
    changes: [frame("g0", "Decisions"), frame("g1", "Metrics"), frame("g2", "Plans"), frame("g3", "Notes")],
    ...extra,
  } as ChangeSet;
}

describe("sectionReviews — each section's review reason, at the section (Wave C)", () => {
  const full = set({
    fidelity: {
      units: 30,
      placedByAI: 24,
      addedFromSource: 6,
      keyTerms: { total: 20, placedByAI: 19, missing: ["0.5"] },
      sections: [section("k-metrics", "Metrics", 10, 4, ["0.5"]), section("k-plans", "Plans", 10, 10), section("k-notes", "Notes", 10, 10)],
    },
    analysis: { mode: "ai", fallbacks: [{ key: "k-decisions", label: "Decisions", cause: "invalid_output: not a plan" }], shallow: ["Notes"] },
  });

  it("says what each section is, with the one action that fits", () => {
    const reviews = sectionReviews(full, { canRegenerate: true });
    const by = new Map(reviews.map((r) => [r.label, r] as const));
    expect(by.get("Decisions")).toMatchObject({ tone: "warning", text: "Structure only: AI couldn't analyse it", detail: ["Why: invalid_output: not a plan"], action: { label: "Retry", key: "k-decisions" } });
    expect(by.get("Metrics")).toMatchObject({ tone: "note", text: "AI placed 40% · +6 from source · 1 key term missed", action: { label: "Regenerate", key: "k-metrics" } });
    expect(by.get("Metrics")!.detail).toEqual(["Added from the source: Metrics point 0", "Added from the source: Metrics point 1", "Added from the source: Metrics point 2", "+3 more added from the source", "Key terms the AI missed: 0.5"]);
    expect(by.get("Plans")).toMatchObject({ tone: "ok", text: "AI placed 100%" });
    expect(by.get("Plans")!.action).toBeUndefined();
    expect(by.get("Notes")).toMatchObject({ tone: "warning", text: "Not analysed · AI placed 100%" });
  });

  it("offers no action when the run can't be regenerated, and not again for a section already regenerated", () => {
    expect(sectionReviews(full, { canRegenerate: false }).some((r) => r.action)).toBe(false);
    const again = sectionReviews(full, { canRegenerate: true, regenerated: new Set(["k-metrics"]) });
    expect(again.find((r) => r.label === "Metrics")!.action).toBeUndefined();
  });

  it("nothing for a proposal without Visualize section frames", () => {
    expect(sectionReviews({ ...full, changes: [] }, { canRegenerate: true })).toEqual([]);
  });
});
