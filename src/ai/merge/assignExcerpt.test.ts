/**
 * The model sees each new part whole (within a budget), and a part it saw only in part is never judged "nothing new". Live, a
 * contradiction at the end of a 1,900-character part was cut from an 800-character excerpt and filed as a fact (2026-10-09).
 */
import { describe, expect, it } from "vitest";
import type { DecisionAnswer, DecisionRequest } from "@/ai/decisions/types";
import { assignToTopicsDecision, assignToTopicsTask, partExcerptLength, validateAssignment, type AssignInput } from "./assign";

const filler = Array.from({ length: 40 }, (_, i) => `Integration note ${i + 1} lists connector number ${i + 1}.`).join(" ");
const LONG = `## AI connectors\n\n${filler} The app ships its own model key for trial users.`;
const input: AssignInput = {
  topics: [{ key: "Notes › AI access", label: "AI access", text: "## AI access\n\nUsers bring their own AI. The app never ships a model key of its own." }],
  parts: [{ key: "Chat › AI connectors", text: LONG }],
};

describe("what of a new part the model is shown", () => {
  it("the chat prompt shows a 1,900-character part whole — its last sentence included", () => {
    expect(LONG.length).toBeGreaterThan(800 * 2); // well past the old 800-character cut-off
    const { prompt } = assignToTopicsTask.buildPrompt({ input });
    expect(prompt).toContain("The app ships its own model key for trial users.");
  });

  it("the typed model's request shows it whole too", () => {
    const [request] = assignToTopicsDecision.buildRequest(input) as DecisionRequest[];
    expect(JSON.stringify(request!.state)).toContain("The app ships its own model key for trial users.");
  });

  it("parts share the budget: many parts each get less, never under 800 characters", () => {
    expect(partExcerptLength(1)).toBe(12_000);
    expect(partExcerptLength(10)).toBe(2_400);
    expect(partExcerptLength(30)).toBe(800);
  });

  it("'nothing new' is ignored for a part the prompt had to cut (its unseen rest may be new) and kept for one shown whole", () => {
    const many: AssignInput = { ...input, parts: Array.from({ length: 30 }, (_, i) => ({ key: `Chat › Part ${i}`, text: i === 0 ? LONG : `Short part ${i}.` })) };
    const reply = { assignments: [{ part: "p1", topic: "t1", nothingNew: true }, { part: "p2", topic: "t1", nothingNew: true }] };
    const { nothingNew } = validateAssignment(reply, many, new Map());
    expect(nothingNew.has("Chat › Part 0")).toBe(false); // 1,900+ characters, shown as 800
    expect(nothingNew.has("Chat › Part 1")).toBe(true);
  });

  it("the typed path never calls a part longer than its request 'nothing new'", () => {
    const huge: AssignInput = { ...input, parts: [{ key: "Chat › Huge", text: `${"Plain repeated filler sentence here. ".repeat(400)}` }] };
    const answers: Record<string, DecisionAnswer> = {
      p1_topic: { type: "choice", choice: "t1", confidence: 0.95, probabilities: {} },
      p1_relation: { type: "choice", choice: "repeats", confidence: 0.95, probabilities: { repeats: 0.95 } },
      p1_nothing_new: { type: "boolean", probability: 0.95 },
    };
    expect(assignToTopicsDecision.interpret(answers, huge)).toEqual({ assignments: [{ part: "p1", topic: "t1" }] });
  });
});
