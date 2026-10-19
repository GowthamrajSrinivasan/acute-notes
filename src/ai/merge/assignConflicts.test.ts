/**
 * A part that contradicts its topic: the typed model picks, for each of the part's statements, the topic statement it contradicts, so
 * every conflict in a part is found and the quotes are exact (decision models plan §9.6). Anything uncertain goes to the chat task.
 */
import { describe, expect, it, vi } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { DecisionAnswer, DecisionProvider, DecisionRequest } from "@/ai/decisions/types";
import { assignToTopicsDecision, registerMergeTasks, validateAssignment, type AssignInput } from "./assign";

const PRICING = "The Free plan includes 10 AI actions per month. The Pro plan costs 12 dollars per month and includes 200 AI actions. Annual billing gives two months free.";
const input: AssignInput = {
  topics: [
    { key: "Notes › Pricing", label: "Pricing", text: `## Pricing\n\n${PRICING}` },
    { key: "Notes › Security", label: "Security", text: "## Security\n\nAPI keys are stored encrypted in the browser. Exports do not include keys." },
  ],
  parts: [
    // p1.s0 adds, p1.s1 contradicts t1.s1 (the price), p1.s2 adds.
    { key: "Chat › Price change", text: "## Price change\n\nThe new tier names are live. Pro is now 15 dollars per month, not 12. Support hours are unchanged." },
    { key: "Chat › Support", text: "Pro also includes priority email support." },
  ],
};
/** The same parts without the changed price, for what must not ask round two (the model's answer alone decides). */
const noChangedDetail: AssignInput = { ...input, parts: [{ key: "Chat › Price change", text: "## Price change\n\nThe new tier names are live. Support hours are unchanged." }, input.parts[1]!] };
const choice = (value: string, confidence = 0.95, probabilities: Record<string, number> = {}): DecisionAnswer => ({ type: "choice", choice: value, confidence, probabilities });
const relation = (value: "repeats" | "adds" | "contradicts", p = 0.95): DecisionAnswer => choice(value, p, { [value]: p });
const bool = (probability: number): DecisionAnswer => ({ type: "boolean", probability });

/** The first round's answers: p1 contradicts Pricing, p2 only adds to it. */
const firstRound: Record<string, DecisionAnswer> = {
  p1_topic: choice("t1"),
  p1_relation: relation("contradicts"),
  p1_nothing_new: bool(0.02),
  p2_topic: choice("t1"),
  p2_relation: relation("adds"),
  p2_nothing_new: bool(0.03),
};
/** Round two for p1: only its second statement contradicts, the price. */
const priceOnly: Record<string, DecisionAnswer> = { p1_s0_contradicts: choice("none"), p1_s1_contradicts: choice("t1.s1"), p1_s2_contradicts: choice("none") };
const conflicts = (reply: unknown) => (reply as { assignments: { conflicts?: { topicSays: string; partSays: string }[] }[] }).assignments[0]!.conflicts;

describe("assign_to_topics typed path: round two, a part that contradicts its topic", () => {
  it("asks about each of the part's statements: which topic statement it contradicts (the topic's statements, plus none)", () => {
    const requests = assignToTopicsDecision.followUp!(firstRound, input) as readonly DecisionRequest[];
    expect(requests).toHaveLength(1);
    const q = requests[0]!.questions;
    expect(Object.keys(q)).toEqual(["p1_s0_contradicts", "p1_s1_contradicts", "p1_s2_contradicts"]);
    const second = q.p1_s1_contradicts!;
    expect(second.type === "choice" && second.choices.map((c) => c.value)).toEqual(["t1.s0", "t1.s1", "t1.s2", "none"]);
    expect(second.type === "choice" && second.choices[1]!.description).toBe("The Pro plan costs 12 dollars per month and includes 200 AI actions.");
    expect(second.instructions).toContain("“Pro is now 15 dollars per month, not 12.”");
  });

  it("asks nothing in round two when no part contradicts", () => {
    expect(assignToTopicsDecision.followUp!({ ...firstRound, p1_relation: relation("adds") }, noChangedDetail)).toBeNull();
  });

  it("turns the pick into the chat reply's conflict, exact, named after the contradicted statement, and validateAssignment accepts it as is", () => {
    const reply = assignToTopicsDecision.interpret({ ...firstRound, ...priceOnly }, input);
    const expected = { about: "Pricing: The Pro plan costs 12 dollars per month and includes 200 AI actions.", topicSays: "The Pro plan costs 12 dollars per month and includes 200 AI actions.", partSays: "Pro is now 15 dollars per month, not 12." };
    expect(reply).toEqual({ assignments: [{ part: "p1", topic: "t1", conflicts: [expected] }, { part: "p2", topic: "t1" }] });
    const checked = validateAssignment(reply, input, new Map());
    expect(checked.conflicts.get("Chat › Price change")).toEqual([expected]);
    expect(checked.nothingNew.size).toBe(0);
  });

  it("a part that changes two things gives two conflicts — neither is hidden behind the other", () => {
    const both: AssignInput = { ...input, parts: [{ key: "Chat › Changes", text: "Pro is now 15 dollars per month, not 12. Annual billing no longer gives free months." }, input.parts[1]!] };
    const reply = assignToTopicsDecision.interpret({ ...firstRound, p1_s0_contradicts: choice("t1.s1"), p1_s1_contradicts: choice("t1.s2") }, both);
    expect(conflicts(reply)).toEqual([
      expect.objectContaining({ topicSays: "The Pro plan costs 12 dollars per month and includes 200 AI actions.", partSays: "Pro is now 15 dollars per month, not 12." }),
      expect.objectContaining({ topicSays: "Annual billing gives two months free.", partSays: "Annual billing no longer gives free months." }),
    ]);
    // Both reach the merge: two choices in the topic.
    expect(validateAssignment(reply, both, new Map()).conflicts.get("Chat › Changes")).toHaveLength(2);
  });

  it("never takes a partial set as the whole: anything uncertain or inconsistent gives the merge to the chat task (null)", () => {
    const with_ = (over: Record<string, DecisionAnswer | undefined>) => assignToTopicsDecision.interpret({ ...firstRound, ...priceOnly, ...over } as Record<string, DecisionAnswer>, input);
    expect(with_({ p1_s0_contradicts: undefined })).toBeNull(); // a statement left unanswered
    expect(with_({ p1_s1_contradicts: choice("t9.s0") })).toBeNull(); // an id outside the topic's list
    expect(with_({ p1_s1_contradicts: choice("none") })).toBeNull(); // round one said contradicts, round two found nothing
    expect(with_({ p1_s0_contradicts: choice("t1.s1") })).toBeNull(); // two statements contradicting the same one
  });

  it("can't ask about a part with more than 40 statements, or choose from a topic with more than 120: the chat task answers", () => {
    const long = { ...input, parts: [{ key: "Chat › Price change", text: Array.from({ length: 41 }, (_, i) => `Statement number ${i} is here.`).join(" ") }, input.parts[1]!] };
    expect(assignToTopicsDecision.followUp!(firstRound, long)).toBeNull();
    expect(assignToTopicsDecision.interpret({ ...firstRound, ...priceOnly }, long)).toBeNull();
    const big = { ...input, topics: [{ ...input.topics[0]!, text: Array.from({ length: 121 }, (_, i) => `Fact ${i} holds.`).join(" ") }, input.topics[1]!] };
    expect(assignToTopicsDecision.followUp!(firstRound, big)).toBeNull();
  });
});

describe("assign_to_topics typed path: a changed detail is asked about whatever the relation answer was", () => {
  // The relation question sees only an excerpt of each topic, so a price changed deep in a long topic is not in what it read.
  const adds = { ...firstRound, p1_relation: relation("adds") };
  const askedStatements = (answers: Record<string, DecisionAnswer>, i: AssignInput) =>
    ((assignToTopicsDecision.followUp!(answers, i) as readonly DecisionRequest[] | null) ?? []).flatMap((r) => Object.keys(r.questions));

  it("the price changed in the part: round two asks about each of the part's statements although 'adds' was answered", () => {
    expect(askedStatements(adds, input)).toEqual(["p1_s0_contradicts", "p1_s1_contradicts", "p1_s2_contradicts"]);
  });

  it("the model's pick becomes the conflict, exactly as when it had flagged the part", () => {
    const reply = assignToTopicsDecision.interpret({ ...adds, ...priceOnly }, input);
    expect(conflicts(reply)).toEqual([
      { about: "Pricing: The Pro plan costs 12 dollars per month and includes 200 AI actions.", topicSays: "The Pro plan costs 12 dollars per month and includes 200 AI actions.", partSays: "Pro is now 15 dollars per month, not 12." },
    ]);
  });

  it("when the model finds no contradiction in a part only a detail made suspect, it is an ordinary part: no conflict, and the chat task is not asked", () => {
    const none = { p1_s0_contradicts: choice("none"), p1_s1_contradicts: choice("none"), p1_s2_contradicts: choice("none") };
    const reply = assignToTopicsDecision.interpret({ ...adds, ...none }, input);
    expect(reply).not.toBeNull();
    expect(conflicts(reply)).toBeUndefined();
    expect((reply as { assignments: { topic: string }[] }).assignments.map((a) => a.topic)).toEqual(["t1", "t1"]);
  });

  it("a part the model itself called contradicting, with no pair found, still goes to the chat task (unchanged)", () => {
    const none = { p1_s0_contradicts: choice("none"), p1_s1_contradicts: choice("none"), p1_s2_contradicts: choice("none") };
    expect(assignToTopicsDecision.interpret({ ...firstRound, ...none }, input)).toBeNull();
  });

  it("no round two when the numbers are the same, or the number belongs to something else", () => {
    const same: AssignInput = { ...input, parts: [{ key: "Chat › Same", text: "## Same\n\nThe Pro plan costs 12 dollars per month and includes 200 AI actions." }, input.parts[1]!] };
    const other: AssignInput = { ...input, parts: [{ key: "Chat › Other", text: "## Other\n\nThe office has 15 desks near the window." }, input.parts[1]!] };
    expect(askedStatements(adds, same)).toEqual([]);
    expect(askedStatements(adds, other)).toEqual([]);
  });

  it("not for a part the model filed as new, or was unsure about", () => {
    expect(askedStatements({ ...adds, p1_topic: choice("new") }, input)).toEqual([]);
    expect(askedStatements({ ...adds, p1_topic: choice("t1", 0.4) }, input)).toEqual([]);
  });
});

describe("assign_to_topics typed path: the two thresholds, at their edges", () => {
  it("round one's 'contradicts' probability (0.5) only decides whether round two is asked", () => {
    expect(assignToTopicsDecision.followUp!({ ...firstRound, p1_relation: relation("contradicts", 0.49) }, noChangedDetail)).toBeNull();
    expect(assignToTopicsDecision.followUp!({ ...firstRound, p1_relation: relation("contradicts", 0.5) }, input)).not.toBeNull();
    // Below it, the part is an ordinary one: filed, no conflict, no chat call.
    const calm = assignToTopicsDecision.interpret({ ...firstRound, p1_relation: relation("contradicts", 0.49) }, noChangedDetail);
    expect(conflicts(calm)).toBeUndefined();
  });

  it("each round-two pick must be at least 0.6 sure (a 'none' too), or the chat task answers", () => {
    const at = (c: number) => assignToTopicsDecision.interpret({ ...firstRound, ...priceOnly, p1_s1_contradicts: choice("t1.s1", c) }, input);
    expect(conflicts(at(0.6))).toHaveLength(1);
    expect(at(0.59)).toBeNull();
    expect(assignToTopicsDecision.interpret({ ...firstRound, ...priceOnly, p1_s0_contradicts: choice("none", 0.59) }, input)).toBeNull();
  });
});

describe("AIRuntime.decide with a second round", () => {
  function setup(typed: DecisionProvider) {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerMergeTasks(registry);
    const chat = vi.fn(async () => ({ text: JSON.stringify({ assignments: [{ part: "p1", topic: "t2" }] }), model: "m", finishReason: "stop" as const, usage: { provider: "primary", model: "m" } }));
    manager.registerProvider(createMockProvider({ id: "primary", respond: chat }));
    manager.setPrimary("primary");
    manager.setTypedDecisionProvider(typed);
    return { runtime: createAIRuntime({ manager, registry }), chat };
  }
  const provider = (decide: DecisionProvider["decide"]): DecisionProvider => ({ id: "openrouter", name: "Jev", model: "typesafe/jev-1.13", decide });
  const usage = { provider: "openrouter", model: "jev", promptTokens: 10 };
  const roundOne = (r: DecisionRequest) => {
    const part = Object.keys(r.questions)[0]!.slice(0, 2);
    return { answers: { [`${part}_topic`]: firstRound[`${part}_topic`]!, [`${part}_relation`]: firstRound[`${part}_relation`]!, [`${part}_nothing_new`]: firstRound[`${part}_nothing_new`]! }, usage };
  };

  it("asks round two after round one, merges the answers, and returns the conflict without a chat call", async () => {
    const decide = vi.fn(async (r: DecisionRequest) => ("p1_s1_contradicts" in r.questions ? { answers: priceOnly, usage } : roundOne(r)));
    const { runtime, chat } = setup(provider(decide));
    const result = await runtime.decide(assignToTopicsDecision, input);
    expect(decide).toHaveBeenCalledTimes(3);
    expect(conflicts(result.data)).toHaveLength(1);
    expect(result).toMatchObject({ providerId: "openrouter", usage: { promptTokens: 30 } });
    expect(chat).not.toHaveBeenCalled();
  });

  it("falls back to the chat task when round two fails", async () => {
    const decide = vi.fn(async (r: DecisionRequest) => {
      if ("p1_s1_contradicts" in r.questions) throw new Error("boom");
      return roundOne(r);
    });
    const { runtime, chat } = setup(provider(decide));
    const result = await runtime.decide(assignToTopicsDecision, input);
    expect(result.providerId).toBe("primary");
    expect(chat).toHaveBeenCalledTimes(1);
  });
});
