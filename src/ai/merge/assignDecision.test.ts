import { describe, expect, it, vi } from "vitest";
import { AIError } from "@/ai/errors";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { DecisionAnswer, DecisionProvider, DecisionRequest } from "@/ai/decisions/types";
import { assignToTopicsDecision, assignToTopicsTask, registerMergeTasks, validateAssignment, type AssignInput } from "./assign";

const input: AssignInput = {
  topics: [
    { key: "Notes › Pricing", label: "Pricing", text: "Free plan has 10 AI actions a month. Pro is 12 dollars." },
    { key: "Notes › Security", label: "Security", text: "Keys are stored encrypted in the browser." },
  ],
  parts: [
    { key: "Chat › A", text: "The Pro tier costs twelve dollars monthly." },
    { key: "Chat › B", text: "Pro now also includes priority support." },
    { key: "Chat › C", text: "Team offsite is in March." },
  ],
};
const requests = () => assignToTopicsDecision.buildRequest(input) as readonly DecisionRequest[];
const choice = (value: string, confidence = 0.95): DecisionAnswer => ({ type: "choice", choice: value, confidence, probabilities: {} });
const bool = (probability: number): DecisionAnswer => ({ type: "boolean", probability });

describe("assign_to_topics as typed decisions", () => {
  it("is asked one request per part: the topics once as state, a choice over their refs plus new, and a yes/no 'adds nothing new'", () => {
    const rs = requests();
    expect(rs).toHaveLength(3);
    const first = rs[0]!;
    expect(first.state).toMatchObject({ new_content: "The Pro tier costs twelve dollars monthly.", topics: [{ id: "t1", label: "Pricing" }, { id: "t2", label: "Security" }] });
    expect(Object.keys(first.questions)).toEqual(["p1_topic", "p1_relation", "p1_nothing_new"]);
    const q = first.questions.p1_topic!;
    expect(q.type === "choice" && q.choices.map((c) => c.value)).toEqual(["t1", "t2", "new"]);
    expect(first.questions.p1_nothing_new!.type).toBe("boolean");
    // Question names differ across the requests, so their answers can be merged.
    expect(new Set(rs.flatMap((r) => Object.keys(r.questions))).size).toBe(9);
  });

  it("is not asked with more than 30 parts or 254 topics: the chat task answers", () => {
    const parts = Array.from({ length: 31 }, (_, i) => ({ key: `p${i}`, text: "x" }));
    expect(assignToTopicsDecision.buildRequest({ ...input, parts })).toBeNull();
    const topics = Array.from({ length: 255 }, (_, i) => ({ key: `t${i}`, label: `T${i}`, text: "x" }));
    expect(assignToTopicsDecision.buildRequest({ ...input, topics })).toBeNull();
  });

  it("reads the answers in the chat task's own reply shape: topic refs, 'new', and nothingNew only with a topic and at 0.5 or more", () => {
    const answers: Record<string, DecisionAnswer> = {
      p1_topic: choice("t1"),
      p1_nothing_new: bool(0.65),
      p2_topic: choice("t1"),
      p2_nothing_new: bool(0.45),
      p3_topic: choice("new"),
      p3_nothing_new: bool(0.99),
    };
    expect(assignToTopicsDecision.interpret(answers, input)).toEqual({
      assignments: [{ part: "p1", topic: "t1", nothingNew: true }, { part: "p2", topic: "t1" }, { part: "p3", topic: "new" }],
    });
  });

  it("steps aside when a part filed under a topic likely contradicts it: the chat task answers the merge, because it quotes both sentences", () => {
    const contradicting: Record<string, DecisionAnswer> = {
      p1_topic: choice("t1"),
      p2_topic: choice("t1"),
      p2_relation: { type: "choice", choice: "contradicts", confidence: 0.95, probabilities: { contradicts: 0.95, adds: 0.05 } },
      p3_topic: choice("new"),
    };
    expect(assignToTopicsDecision.interpret(contradicting, input)).toBeNull();
    // A new topic can't contradict one, and a repeat or an addition isn't a contradiction.
    const fine: Record<string, DecisionAnswer> = {
      p1_topic: choice("t1"),
      p1_relation: { type: "choice", choice: "adds", confidence: 0.9, probabilities: { adds: 0.9, contradicts: 0.05 } },
      p3_topic: choice("new"),
      p3_relation: { type: "choice", choice: "contradicts", confidence: 0.9, probabilities: { contradicts: 0.9 } },
    };
    expect(assignToTopicsDecision.interpret(fine, input)).toEqual({ assignments: [{ part: "p1", topic: "t1" }, { part: "p3", topic: "new" }] });
  });

  it("answers 'unsure' for a topic answer below 0.5 (never new), leaves out a missing one (it keeps the local answer), and answers nothing at all with null", () => {
    const answers: Record<string, DecisionAnswer> = { p1_topic: choice("t1", 0.4), p2_topic: choice("t2", 0.7), p3_topic: { type: "refusal" } };
    expect(assignToTopicsDecision.interpret(answers, input)).toEqual({ assignments: [{ part: "p1", topic: "unsure" }, { part: "p2", topic: "t2" }] });
    expect(assignToTopicsDecision.interpret({}, input)).toBeNull();
  });

  it("feeds validateAssignment like the chat reply does: answered parts take the model's topic, the rest keep their fallback", () => {
    const reply = assignToTopicsDecision.interpret({ p1_topic: choice("t1"), p1_nothing_new: bool(0.95), p3_topic: choice("new") }, input);
    const fallback = new Map<string, string | null>([["Chat › A", null], ["Chat › B", "Notes › Security"], ["Chat › C", "Notes › Pricing"]]);
    const { assignment, nothingNew } = validateAssignment(reply, input, fallback);
    expect(assignment.get("Chat › A")).toBe("Notes › Pricing");
    expect(assignment.get("Chat › B")).toBe("Notes › Security");
    expect(assignment.get("Chat › C")).toBeNull();
    expect([...nothingNew]).toEqual(["Chat › A"]);
  });

  it("is routing for the user's typed decision model only: the chat task has no decision-model preference (a small one dropped content)", () => {
    expect(assignToTopicsTask.policy).toEqual({});
    expect(assignToTopicsDecision.fallbackTask).toBe("assign_to_topics");
  });
});

describe("assign_to_topics through AIRuntime.decide", () => {
  function setup(typed: DecisionProvider | null) {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerMergeTasks(registry);
    const chat = vi.fn(async () => ({ text: JSON.stringify({ assignments: [{ part: "p1", topic: "t2" }] }), model: "m", finishReason: "stop" as const, usage: { provider: "primary", model: "m" } }));
    manager.registerProvider(createMockProvider({ id: "primary", respond: chat }));
    manager.setPrimary("primary");
    manager.setTypedDecisionProvider(typed);
    return { runtime: createAIRuntime({ manager, registry }), chat };
  }
  const typedProvider = (decide: DecisionProvider["decide"]): DecisionProvider => ({ id: "openrouter", name: "Jev", model: "typesafe/jev-1.13", decide });

  it("sends one request per part in parallel, merges their answers, and sums the tokens", async () => {
    const decide = vi.fn(async (r: DecisionRequest) => ({
      answers: Object.fromEntries(Object.keys(r.questions).map((k): [string, DecisionAnswer] => [k, k.endsWith("_topic") ? choice("t1") : bool(0.1)])),
      usage: { provider: "openrouter", model: "jev", promptTokens: 100 },
    }));
    const { runtime, chat } = setup(typedProvider(decide));
    const result = await runtime.decide(assignToTopicsDecision, input);
    expect(decide).toHaveBeenCalledTimes(3);
    expect((result.data as { assignments: unknown[] }).assignments).toHaveLength(3);
    expect(result).toMatchObject({ providerId: "openrouter", role: "decision", usage: { promptTokens: 300 } });
    expect(chat).not.toHaveBeenCalled();
  });

  it("falls back to the primary's chat task when any request fails, and when no typed decision model is enabled", async () => {
    const failing = vi.fn(async (r: DecisionRequest) => {
      if ("p2_topic" in r.questions) throw new AIError("rate_limited", "slow down");
      return { answers: { p1_topic: choice("t1") }, usage: { provider: "openrouter", model: "jev" } };
    });
    const withFailure = setup(typedProvider(failing));
    expect((await withFailure.runtime.decide(assignToTopicsDecision, input)).data).toEqual({ assignments: [{ part: "p1", topic: "t2" }] });
    expect(withFailure.chat).toHaveBeenCalledTimes(1);
    const none = setup(null);
    expect((await none.runtime.decide(assignToTopicsDecision, input)).providerId).toBe("primary");
  });
});
