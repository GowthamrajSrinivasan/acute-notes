/**
 * Jev's real answers (32 parts of a three-chat ChatGPT merge, recorded 2026-10-10 for $0.0137) read through today's
 * assignment code, with no model call. It documents what the production path does with them and is the zero-cost
 * yardstick for an assignment change: a stricter or parent-aware policy should be run against these same answers.
 *
 * "Today's behaviour" tests are CHARACTERISATION tests: when the assignment policy is changed on purpose (for example to
 * keep an unsure fragment with its parent instead of making it a new topic), update the expected numbers deliberately.
 * The evidence tests describe the recorded data itself and should not change.
 */
import { describe, expect, it } from "vitest";
import type { DecisionAnswer } from "@/ai/decisions/types";
import fixture from "./__fixtures__/jevSampleAnswers.json";
import { assignToTopicsDecision, UNSURE, validateAssignment, type AssignInput } from "./assign";
import { settleUnsure } from "./unsure";

interface Recorded {
  i: number;
  key: string;
  parent: string;
  leaf: string;
  chars: number;
  topic: string;
  confidence: number;
  nothingNew: number;
  contradicts: number;
  path: "jev-existing" | "jev-new" | "fallback-new" | "fallback-existing";
}
const rows = fixture.answers as Recorded[];

/** The assignment input the answers were given for: 95 topics, the 32 sampled parts (text of the same length; no content needed). */
const input: AssignInput = {
  topics: Array.from({ length: 95 }, (_, i) => ({ key: `topic-${i + 1}`, label: `Topic ${i + 1}`, text: `Text of topic ${i + 1}.` })),
  parts: rows.map((r) => ({ key: r.key, text: "x".repeat(Math.max(1, r.chars)) })),
};

/** The typed answers Jev gave, under the question names the request uses (`p<n>_topic` …, n counted within the input). */
const answers: Record<string, DecisionAnswer> = Object.fromEntries(
  rows.flatMap((r, n) => [
    [`p${n + 1}_topic`, { type: "choice", choice: r.topic, confidence: r.confidence, probabilities: {} } as DecisionAnswer],
    [`p${n + 1}_relation`, { type: "choice", choice: "adds", confidence: 1, probabilities: { contradicts: r.contradicts } } as DecisionAnswer],
    [`p${n + 1}_nothing_new`, { type: "boolean", probability: r.nothingNew } as DecisionAnswer],
  ]),
);

describe("the recorded Jev answers (evidence)", () => {
  it("32 parts, stratified, each with the production path recorded at the time", () => {
    expect(rows).toHaveLength(32);
    expect(new Set(rows.map((r) => r.parent)).size).toBe(32);
  });

  it("Jev itself said 'new' for 3 parts; most 'new' outcomes were the low-confidence fallback", () => {
    expect(rows.filter((r) => r.topic === "new")).toHaveLength(3);
    const outcomeNew = rows.filter((r) => r.path === "jev-new" || r.path === "fallback-new");
    expect(outcomeNew).toHaveLength(11);
    expect(outcomeNew.filter((r) => r.path === "fallback-new")).toHaveLength(9);
  });

  it("confidence: 21 of 32 at 0.5 or more; most of the fallbacks are tiny fragments", () => {
    expect(rows.filter((r) => r.confidence >= 0.5)).toHaveLength(21);
    const fallbacks = rows.filter((r) => r.path.startsWith("fallback"));
    expect(fallbacks).toHaveLength(11);
    expect(fallbacks.filter((r) => r.chars < 60)).toHaveLength(6);
  });
});

describe("today's assignment on those answers (characterisation — change deliberately)", () => {
  const raw = assignToTopicsDecision.interpret(answers, input) as { assignments: { part: string; topic: string }[] } | null;

  it("takes the topic Jev chose at 0.5 confidence or more; below that the part is 'unsure' (2026-10-10: was left to the local answer)", () => {
    expect(raw).not.toBeNull();
    expect(raw!.assignments).toHaveLength(32);
    for (const a of raw!.assignments) {
      const n = Number(a.part.slice(1)) - 1;
      expect(a.topic).toBe(rows[n]!.confidence >= 0.5 ? rows[n]!.topic : UNSURE);
    }
    expect(raw!.assignments.filter((a) => a.topic === UNSURE)).toHaveLength(11);
  });

  it("an unsure part is no longer made a new topic for that reason alone; in this sample (every part a different parent) only the local match can place one", () => {
    const local = new Map(rows.map((r) => [r.key, r.path === "fallback-existing" ? "topic-local" : null] as [string, string | null]));
    const checked = validateAssignment(raw, input, local);
    expect(checked.fromModel).toBe(21);
    expect(checked.unsure.size).toBe(11);
    const parts = rows.map((r) => ({ key: r.key, text: "x".repeat(Math.max(1, r.chars)), span: { start: 0, end: 1 } }));
    const settled = settleUnsure(parts, checked.assignment, checked.unsure, local);
    const how = [...settled.how.values()];
    // No sibling or parent of a sampled part is in the sample, so grouping can't show here: the 2 the local match places go to
    // that topic, the other 9 are unplaced (named in the review as unsure). Jev's own "new" (2 confident) stay new.
    expect(how.filter((h) => h === "local")).toHaveLength(2);
    expect(how.filter((h) => h === "unplaced")).toHaveLength(9);
    expect(rows.filter((r) => settled.assignment.get(r.key) === null)).toHaveLength(11);
  });

  it("no part is judged to contradict or to add nothing: neither round-two nor 'nothing new' is exercised by this sample", () => {
    expect(rows.every((r) => r.contradicts < 0.5 && r.nothingNew < 0.5)).toBe(true);
  });
});
