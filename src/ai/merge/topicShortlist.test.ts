/**
 * The topic shortlist for typed assignment (`.ai/docs/topic-shortlist-plan.md` phases 1-2). Retrieval narrows what a request shows; it never
 * decides. A low score is never a reason to call a part new, and anything the shortlist can't support is asked again with the full list.
 * Mock decision model, no network.
 */
import { describe, expect, it } from "vitest";
import type { DecisionAnswer, DecisionProvider, DecisionRequest } from "@/ai/decisions/types";
import { AIProviderManager } from "@/ai/providerManager";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import { assignToTopicsDecision, registerMergeTasks, type AssignInput } from "./assign";
import { bm25Scores, SHORTLIST_K, shortlistFor } from "./topicIndex";

const NAMES = ["billing", "security", "roadmap", "pricing", "hiring", "logistics", "support", "analytics", "mobile", "legal", "design", "infra"];
const topics = NAMES.map((n) => ({ key: `Notes › ${n}`, label: n, text: `${n} ${n}s: details about ${n} work, the ${n} owners and the ${n} plans for next quarter.` }));
const topicIndex = (label: string) => topics.findIndex((t) => t.label === label);
const id = (label: string) => `t${topicIndex(label) + 1}`;
const part = (key: string, text: string, context?: string) => ({ key, text, ...(context ? { context } : {}) });
const input = (parts: AssignInput["parts"], shortlist = true): AssignInput => ({ topics, parts, shortlist });
const requests = (i: AssignInput) => assignToTopicsDecision.buildRequest(i) as readonly DecisionRequest[];
const shownIds = (r: DecisionRequest) => (r.state as { topics: { id: string }[] }).topics.map((t) => t.id);
const choiceValues = (r: DecisionRequest, q: string) => {
  const c = r.questions[q];
  return c?.type === "choice" ? c.choices.map((x) => x.value) : [];
};
const choice = (value: string, confidence = 0.95): DecisionAnswer => ({ type: "choice", choice: value, confidence, probabilities: {} });

describe("retrieval: the topic a part is about is on the shortlist", () => {
  it("ranks the topic sharing the part's subject words first, and keeps the plan's k", () => {
    const query = "The pricing plans changed: the pricing page now lists a pricing tier";
    const scores = bm25Scores(topics, query);
    expect(scores.indexOf(Math.max(...scores))).toBe(topicIndex("pricing"));
    expect(SHORTLIST_K).toBe(8);
  });

  it("every topic a part names is shortlisted, and the others mostly are not", () => {
    const parts = [part("Chat › A", "Security audit of the mobile app: mobile and security tickets.")];
    const list = shortlistFor(topics, parts, 0)!;
    expect(list.indices).toEqual(expect.arrayContaining([topicIndex("security"), topicIndex("mobile")]));
    expect(list.indices.length).toBeLessThan(topics.length);
  });

  it("is deterministic: the same input gives the same shortlist", () => {
    const parts = [part("Chat › A", "Security audit of the mobile app.")];
    expect(shortlistFor(topics, parts, 0)).toEqual(shortlistFor(topics, parts, 0));
  });
});

describe("parent and sibling context is always included", () => {
  const sibling = [
    part("Notes › Chat › Misc thoughts", "A zebra crossing near the security desk."),
    part("Notes › Chat › Mobile", "unrelated words only here"),
  ];
  const withTopics = [...topics, { key: "Notes › Chat", label: "Chat", text: "The chat's own opening answer, about nothing in particular." }, { key: "Notes › Chat › Misc thoughts", label: "Misc thoughts", text: "A catch-all topic of loose ends." }];

  it("the topic with the part's own heading, the topic its parent heading names, and the topics of its siblings' headings", () => {
    const list = shortlistFor(withTopics, sibling, 0)!;
    const labels = list.indices.map((i) => withTopics[i]!.label);
        expect(labels).toEqual(expect.arrayContaining(["security", "Misc thoughts", "Chat", "mobile"]));
    // retrieval found "security" (the text) and "Misc thoughts" (the heading); the parent and the sibling's topic come from context alone
    expect(list.retrieved).toBe(2);
    expect(list.contextOnly).toBe(2);
    expect(list.indices.length).toBeLessThan(withTopics.length);
  });
});

describe("weak, flat or ambiguous retrieval widens: the full list is shown", () => {
  it("no overlap with any topic at all: no evidence to shortlist by, so every topic stays a candidate", () => {
    expect(shortlistFor(topics, [part("Chat › A", "zebra quokka narwhal")], 0)).toBeNull();
  });

  it("notes with no more topics than k are always shown whole", () => {
    expect(shortlistFor(topics.slice(0, SHORTLIST_K), [part("Chat › A", "security")], 0)).toBeNull();
  });

  it("a shortlist that would cover every topic is the full list", () => {
    const same = NAMES.map((n) => ({ key: `Notes › ${n}`, label: n, text: "shared words about the roadmap" }));
    expect(shortlistFor(same, [part("Chat › A", "roadmap")], 0)).toBeNull();
  });

  it("a flat cut keeps every topic tied with the k-th: a tie is not evidence for dropping any of them", () => {
    const tied = [...NAMES.slice(0, 4).map((n) => ({ key: `Notes › ${n}`, label: n, text: `${n} alone` })), ...Array.from({ length: 12 }, (_, i) => ({ key: `Notes › same${i}`, label: `same${i}`, text: "launch plan" }))];
    const list = shortlistFor(tied, [part("Chat › A", "launch plan")], 0)!;
    // 12 identical topics tie: all are kept, none is cut at k = 8
    expect(tied.map((t, i) => (t.label.startsWith("same") ? i : -1)).filter((i) => i >= 0).every((i) => list.indices.includes(i))).toBe(true);
  });

  it("the request for a part with no overlap shows every topic and a choice over all of them plus new: a low score never forces 'new'", () => {
    const r = requests(input([part("Chat › A", "zebra quokka narwhal")]))[0]!;
    expect(shownIds(r)).toEqual(topics.map((_, i) => `t${i + 1}`));
    expect(choiceValues(r, "p1_topic")).toEqual([...topics.map((_, i) => `t${i + 1}`), "new"]);
  });
});

describe("the typed request", () => {
  const parts = [part("Chat › A", "The pricing page and the security review.")];

  it("shows the shortlist with the topics' own ids and a choice over exactly those plus new; each topic is shown as a full request shows it", () => {
    const short = requests(input(parts))[0]!;
    const full = requests(input(parts, false))[0]!;
    expect(shownIds(short).length).toBeLessThan(shownIds(full).length);
    expect(shownIds(short)).toEqual(expect.arrayContaining([id("pricing"), id("security")]));
    expect(choiceValues(short, "p1_topic")).toEqual([...shownIds(short), "new"]);
    const fullById = new Map((full.state as { topics: { id: string; text: string }[] }).topics.map((t) => [t.id, t.text]));
    for (const t of (short.state as { topics: { id: string; text: string }[] }).topics) expect(t.text).toBe(fullById.get(t.id));
  });

  it("is the same request as before when off (the default)", () => {
    const off = requests({ topics, parts })[0]!;
    expect(requests(input(parts, false))[0]).toEqual(off);
    expect(shownIds(off)).toHaveLength(topics.length);
  });
});

describe("uncertain or new answers from a shortlist are asked again with the full list", () => {
  const parts = [
    part("Chat › Known", "The pricing page and the security review."),
    part("Chat › Lost", "The pricing page and the security review."),
    part("Chat › Fresh", "The pricing page and the security review."),
    part("Chat › Whole", "zebra quokka narwhal"),
  ];
  const i = input(parts);

  it("a confident existing topic is kept; 'new', a low confidence or no answer is re-asked, each with every topic", () => {
    const round = assignToTopicsDecision.followUp!(
      { p1_topic: choice(id("pricing")), p2_topic: choice("new"), p3_topic: choice(id("security"), 0.3), p4_topic: choice("new") },
      i,
    ) as DecisionRequest[];
    // p2 (new) and p3 (unsure) came from a shortlist, so they are asked again; p4 was already asked with the full list, so it is not
    expect(round.map((r) => Object.keys(r.questions)[0])).toEqual(["p2_topic", "p3_topic"]);
    for (const r of round) expect(shownIds(r)).toHaveLength(topics.length);
    // and not with a part left unanswered either
    const missing = assignToTopicsDecision.followUp!({ p1_topic: choice(id("pricing")), p3_topic: choice(id("security")), p4_topic: choice("new") }, i) as DecisionRequest[];
    expect(missing.map((r) => Object.keys(r.questions)[0])).toEqual(["p2_topic"]);
  });

  it("nothing is re-asked when every shortlisted part is confidently filed, or when the shortlist is off", () => {
    const done = { p1_topic: choice(id("pricing")), p2_topic: choice(id("security")), p3_topic: choice(id("pricing")), p4_topic: choice("new") };
    expect(assignToTopicsDecision.followUp!(done, i)).toBeNull();
    expect(assignToTopicsDecision.followUp!({ ...done, p2_topic: choice("new") }, input(parts, false))).toBeNull();
  });

  it("a part confidently filed from the shortlist that likely contradicts its topic still gets the contradiction round, not a re-ask", () => {
    const relation: DecisionAnswer = { type: "choice", choice: "contradicts", confidence: 0.95, probabilities: { contradicts: 0.95, adds: 0.05 } };
    const round = assignToTopicsDecision.followUp!({ p1_topic: choice(id("pricing")), p1_relation: relation, p2_topic: choice(id("security")), p3_topic: choice(id("pricing")), p4_topic: choice("new") }, i) as DecisionRequest[];
    expect(round).toHaveLength(1);
    expect(Object.keys(round[0]!.questions)[0]).toMatch(/^p1_s\d+_contradicts$/);
  });
});

describe("through the runtime: shortlist first, the full list only where needed", () => {
  const parts = [
    part("Chat › Known", "The pricing page and the security review."),
    part("Chat › Lost", "The pricing page and the security review."),
    part("Chat › Fresh", "The pricing page and the security review."),
  ];

  function run(script: (partRef: string, shown: number) => DecisionAnswer | null) {
    const asked: { part: string; shown: number }[] = [];
    const typed: DecisionProvider = {
      id: "openrouter",
      name: "Jev",
      model: "jev",
      decide: async (request) => {
        const q = Object.keys(request.questions)[0]!;
        const partRef = q.split("_")[0]!;
        const shown = (request.state as { topics: unknown[] }).topics.length;
        asked.push({ part: partRef, shown });
        const answer = script(partRef, shown);
        return { answers: answer ? { [`${partRef}_topic`]: answer } : {}, usage: { provider: "openrouter", model: "jev", promptTokens: 100 * shown } };
      },
    };
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerMergeTasks(registry);
    manager.setTypedDecisionProvider(typed);
    return { runtime: createAIRuntime({ manager, registry }), asked };
  }

  it("a part Jev can't place from the shortlist gets its answer from the full list, so the outcome is the one a full-list request gives", async () => {
    // p2 is "new" from the shortlist but a confident topic once all topics are shown; p3 is genuinely new either way
    const { runtime, asked } = run((p, shown) => (p === "p1" ? choice(id("pricing")) : p === "p2" ? (shown < topics.length ? choice("new") : choice(id("security"))) : choice("new")));
    const r = await runtime.decide(assignToTopicsDecision, input(parts));
    expect(r.data).toEqual({ assignments: [{ part: "p1", topic: id("pricing") }, { part: "p2", topic: id("security") }, { part: "p3", topic: "new" }] });
    // round one: three shortlist requests; round two: p2 and p3 again with every topic
    expect(asked.filter((a) => a.shown < topics.length).map((a) => a.part).sort()).toEqual(["p1", "p2", "p3"]);
    expect(asked.filter((a) => a.shown === topics.length).map((a) => a.part).sort()).toEqual(["p2", "p3"]);
  });

  it("an uncertain assignment stays unsure (never new): low confidence from the full list too is the existing 'unsure' outcome", async () => {
    const { runtime } = run((p, shown) => (p === "p2" ? choice(id("security"), 0.3) : shown < topics.length ? choice(id("pricing")) : choice(id("pricing"))));
    const r = await runtime.decide(assignToTopicsDecision, input(parts));
    expect((r.data as { assignments: { part: string; topic: string }[] }).assignments.find((a) => a.part === "p2")).toEqual({ part: "p2", topic: "unsure" });
  });

  it("with the shortlist off, one request per part and no second round", async () => {
    const { runtime, asked } = run(() => choice(id("pricing")));
    await runtime.decide(assignToTopicsDecision, input(parts, false));
    expect(asked).toHaveLength(3);
    expect(asked.every((a) => a.shown === topics.length)).toBe(true);
  });
});
