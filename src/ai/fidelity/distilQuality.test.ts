/**
 * Distil quality fixes of 2026-10-20 (2) (`.ai/docs/knowledge-notes-live-2026-10-20.md`, "Offline fixes 2026-10-20 (2)"),
 * unit level, no AI:
 *
 * 1. G1 counts cards, not nodes (plan §9 G1): a shape with the text that explains it is one card (`cardGroups`,
 *    `knowledgeScore`, report v2).
 * 2. A label-only shape with no explanation is checked with the full card covering its units, else alone; links between
 *    step shapes never group cards, and none is added.
 * 3. A dropped condition or caveat is named verbatim with its card in the one retry; still dropped after it, it goes on
 *    that card as a "Limit:" line from the source, and the unit is `restored`. Cards longer than their source get a hint.
 * 4. In a transcript, an unanswered question and assent to a proposal are never left out as filler (kn-05's source).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { knowledgeScore } from "../../../e2e/fidelityScore";
import { accountUnits, dialogueReasonsOf } from "./accounting";
import type { SourceUnit } from "./contracts";
import { cardNeedsReview } from "./contracts";
import { cardReviews, CITES, checkItems, droppedClauses, inspectSection, restoreLimits, retryReasons } from "./knowledgeCheck";
import { cardGroupsOf } from "./knowledgeRun";
import { buildKnowledgeReport } from "./report";
import { lengthHints } from "./representation";
import { splitUnits } from "./sourceUnits";

const unit = (id: string, text: string): SourceUnit => ({ id, kind: "sentence", text, hash: id, topic: "t", span: { start: 0, end: 1 } });
const text = (id: string, title: string, markdown: string, cites: string[]) => ({ id, type: "text", title, content: { markdown }, [CITES]: cites });
const shape = (id: string, label: string, cites: string[], extra: Record<string, unknown> = {}) => ({ id, type: "shape", content: { shape: "rectangle", label, ...extra }, [CITES]: cites });
const reply = (nodes: unknown[], relationships: unknown[] = []) => ({ version: 1, template: "sectioned", nodes, relationships });
type Raw = { nodes: Record<string, unknown>[]; relationships: unknown[] };

describe("1. G1 per card, not per node (plan §9 G1)", () => {
  const reviews = {
    s1: { reasons: ["checked by AI: not supported: drops the filter"], checked: { by: "ai" as const, verdict: "not_supported" as const } },
    t1: { reasons: ["checked by AI: not supported: drops the filter"], checked: { by: "ai" as const, verdict: "not_supported" as const } },
    n2: { reasons: [], checked: { by: "ai" as const, verdict: "supported" as const } },
  };
  const cites = { s1: ["u1"], t1: ["u1"], n2: ["u2"], n3: ["u3"] };

  it("knowledgeScore counts a shape and its explanation as one card: one in review of three, not two of four", () => {
    const perNode = knowledgeScore({ noteModel: "distil", cites, reviews });
    expect(perNode).toMatchObject({ cards: 4, cardsNeedsReview: 2, cardsNeedsReviewPct: 50 });
    const perCard = knowledgeScore({ noteModel: "distil", cites, reviews, cardGroups: [["s1", "t1"]] });
    expect(perCard).toMatchObject({ cards: 3, cardsNeedsReview: 1, cardsNeedsReviewPct: 33.3, checkedByAI: 1, aiNotSupported: 1, aiChecked: 2 });
  });

  it("a card is in review when any of its nodes is (a reason on the text alone puts the card in review once)", () => {
    const score = knowledgeScore({ noteModel: "distil", cites, reviews: { t1: { reasons: ["the card cites no passage of the source"] } }, cardGroups: [["s1", "t1"]] });
    expect(score).toMatchObject({ cards: 3, cardsNeedsReview: 1 });
  });

  it("cardGroupsOf reads the plan: explained_by groups and label shapes folded into the card covering their units; flows_to never groups", () => {
    const plan = {
      nodes: [
        { id: "s1", type: "shape", content: { label: "Retrieve Candidates" } },
        { id: "t1", type: "text", content: { markdown: "Fetches the top 50 candidates when the query has no filters." } },
        { id: "s2", type: "shape", content: { label: "Cache" } },
        { id: "t2", type: "text", title: "The cache is a copy", content: { markdown: "It is only a copy kept for speed; the database stays the source of truth." } },
        { id: "s3", type: "shape", content: { label: "Rerank" } },
      ],
      relationships: [
        { from: "s1", to: "t1", type: "explained_by" },
        { from: "s1", to: "s3", type: "flows_to" },
      ],
    };
    expect(cardGroupsOf(plan, { s1: ["u1"], t1: ["u1"], s2: ["u2"], t2: ["u2"], s3: ["u3"] })).toEqual([
      ["s1", "t1"],
      ["t2", "s2"],
    ]);
  });

  it("report v2 counts cards: a card of two nodes in review is one card in review", () => {
    const ideas = [
      { id: "s1", title: "", body: "Retrieve Candidates", cites: ["u1"] },
      { id: "t1", title: "", body: "Fetches the top 50 candidates.", cites: ["u1"] },
      { id: "n2", title: "B", body: "b", cites: ["u2"] },
    ];
    const section = { key: "k", label: "S", units: ["u1", "u2"], ideas, omitted: [], problems: [], flags: [], hints: [], restored: { items: [], units: [] }, needsReview: 1, exactMissing: [] };
    const accounting = { state: {}, outcome: {}, critical: {}, flags: [], sections: [] };
    const both = { s1: { reasons: ["x"] }, t1: { reasons: ["x"] } };
    expect(buildKnowledgeReport({ sections: [{ ...section, reviews: both }], accounting }).cards).toMatchObject({ total: 3, needsReview: 2 });
    expect(buildKnowledgeReport({ sections: [{ ...section, reviews: both, cards: [["s1", "t1"]] }], accounting }).cards).toMatchObject({ total: 2, needsReview: 1 });
  });

  it("inspectSection counts a flagged card once, whatever number of its nodes carry the flag", () => {
    const units = [unit("u1", "The retriever fetches the top 50 candidates from the vector index when the query has no filters.")];
    const raw = reply([shape("s1", "Retrieve Candidates", ["u1"]), text("t1", "", "Fetches the top 50 candidates from the vector index.", ["u1"])], [{ from: "s1", to: "t1", type: "explained_by" }]);
    const i = inspectSection(raw, units, [], { extra: [{ code: "ai_check", card: "s1", detail: "checked by AI: not supported" }] });
    // u1 is in review (both nodes flagged) and the card is one item: 2, not 3.
    expect(i.needsReview).toBe(2);
  });
});

describe("2. label-only shapes with no explanation", () => {
  const units = [
    unit("u1", "It is only a copy kept for speed, and it is never the source of truth."),
    unit("u2", "Writes go to the database first, then the cache entry is dropped."),
    unit("u3", "Thumbnails are generated by a background worker for every upload."),
  ];
  const full = text("t1", "The cache is a fast copy", "Only a copy kept for speed; the database stays the source of truth, and writes drop the cache entry.", ["u1", "u2"]);

  it("whose units a full card cites: checked together with that card (one model-check item, no unrelated-citation flag)", () => {
    // Before the fix "Cache" was its own card: "Cache" shares no word with u1, so it was flagged `citation_unrelated`.
    const raw = reply([shape("s1", "Cache", ["u1"]), full]);
    const i = inspectSection(raw, units, [{ unit: "u3", reason: "meta" }]);
    expect(i.flags).toEqual([]);
    expect(i.views.map((v) => v.members)).toEqual([["t1", "s1"]]);
    const { items, cardOf } = checkItems(i, units, "all");
    expect(items).toHaveLength(1);
    expect(items[0]!.card).toBe("The cache is a fast copy\nOnly a copy kept for speed; the database stays the source of truth, and writes drop the cache entry.\nCache");
    expect([...cardOf.values()]).toEqual(["t1"]);
    // The card's verdict is the label's too.
    const reviews = cardReviews(i, new Map([["t1", { verdict: "partly" as const, reason: "r" }]]));
    expect(reviews.s1!.checked).toEqual({ by: "ai", verdict: "partly", reason: "r" });
  });

  it("whose units no single full card covers: checked alone, as before", () => {
    const raw = reply([shape("s2", "Thumbnails", ["u3"]), shape("s3", "Copy", ["u1", "u3"]), full]);
    const i = inspectSection(raw, units, []);
    expect(i.views.map((v) => v.members)).toEqual([["s2"], ["s3"], ["t1"]]);
    expect(checkItems(i, units, "all").items.map((x) => x.card)).toEqual(["Thumbnails", "Copy", expect.stringMatching(/^The cache is a fast copy/)]);
  });

  it("step shapes linked only by flows_to are not grouped through it, and no link is invented", () => {
    const steps = reply(
      [shape("s1", "Call Supplier API", ["u2"]), shape("s2", "Record Stock", ["u3"]), full],
      [{ from: "s1", to: "s2", type: "flows_to" }],
    );
    const before = JSON.stringify(steps.relationships);
    const i = inspectSection(steps, units, []);
    // s1's unit u2 is covered by the full card t1, so the label joins it; s2's u3 by no full card: alone. Never s1 + s2.
    expect(i.views.map((v) => v.members)).toEqual([["s2"], ["t1", "s1"]]);
    expect(JSON.stringify(steps.relationships)).toBe(before);
    expect(restoreLimits(steps, i, units).raw).toBe(steps);
  });
});

describe("3. dropped conditions and caveats: named in the retry, else put back as a \"Limit:\" line", () => {
  const units = [unit("u1", "Hybrid search improves recall when the query mixes keywords and concepts, but it adds latency to every query."), unit("u2", "Thanks for reading.")];
  const dropped = () =>
    reply([
      text("n1", "Hybrid search lifts recall", "Combining keyword and vector retrieval improves recall.", ["u1"]),
      text("n2", "Search", "Hybrid search is a retrieval method.", ["u1"]),
    ]);
  const omit = [{ unit: "u2", reason: "filler" as const }];
  const label = (u: string) => ({ u1: "P1.1", u2: "P1.2" })[u];

  it("the retry names each dropped clause verbatim, once, on the card it belongs on", () => {
    const i = inspectSection(dropped(), units, omit);
    expect(i.accounting.outcome.u1).toBe("needs_review");
    // Both cards drop both clauses: one flag per clause per card…
    expect(i.flags.filter((f) => f.code === "critical_dropped")).toHaveLength(4);
    // …but the retry asks once per clause, on the card closest to the unit ("Hybrid search lifts recall").
    expect(retryReasons(i, label, [], { units })).toEqual([
      `Put "when the query mixes keywords and concepts" (P1.1) on card "Hybrid search lifts recall": it is the condition of that card's claim, and the card leaves it out. Keep it on that card, in words a reader can't miss.`,
      `Put "but it adds latency to every query" (P1.1) on card "Hybrid search lifts recall": it is the caveat of that card's claim, and the card leaves it out. Keep it on that card, in words a reader can't miss.`,
    ]);
  });

  it("still dropped after the retry: a \"Limit:\" line from the source on that card, the unit restored, nothing left in review", () => {
    const i = inspectSection(dropped(), units, omit);
    const r = restoreLimits(dropped(), i, units);
    expect(r.units).toEqual(["u1"]);
    expect(r.lines.map((l) => [l.card, l.text])).toEqual([
      ["n1", "When the query mixes keywords and concepts"],
      ["n1", "But it adds latency to every query"],
    ]);
    const n1 = (r.raw as Raw).nodes[0]!;
    expect((n1.content as { markdown: string }).markdown).toBe(
      "Combining keyword and vector retrieval improves recall.\n\n**Limit:** When the query mixes keywords and concepts\n\n**Limit:** But it adds latency to every query",
    );
    const after = inspectSection(r.raw, units, omit, { restoredLimits: r.units });
    expect(after.flags).toEqual([]);
    expect(after.accounting.state.u1).toBe("restored");
    expect(after.accounting.outcome.u1).toBe("represented");
    expect(after.needsReview).toBe(0);
    expect(Object.values(cardReviews(after)).some(cardNeedsReview)).toBe(false);
  });

  it("a shape with no text gets the line as a detail; a card the reader can't extend gets a small linked \"Limit\" node", () => {
    const onShape = reply([shape("s1", "Hybrid search improves recall", ["u1"])]);
    const r = restoreLimits(onShape, inspectSection(onShape, units, omit), units);
    expect(((r.raw as Raw).nodes[0]!.content as { details: string[] }).details).toEqual(["Limit: When the query mixes keywords and concepts", "Limit: But it adds latency to every query"]);
    const table = reply([{ id: "tb", type: "table", title: "Hybrid search recall", content: { columns: ["Mode", "Recall"], rows: [["hybrid", "higher"]] }, [CITES]: ["u1"] }]);
    const t = restoreLimits(table, inspectSection(table, units, omit), units);
    expect((t.raw as Raw).nodes.slice(1)).toEqual([
      { id: "lim1", type: "text", title: "Limit", content: { markdown: "When the query mixes keywords and concepts" }, [CITES]: ["u1"] },
      { id: "lim2", type: "text", title: "Limit", content: { markdown: "But it adds latency to every query" }, [CITES]: ["u1"] },
    ]);
    expect((t.raw as Raw).relationships).toEqual([
      { from: "tb", to: "lim1", type: "explained_by" },
      { from: "tb", to: "lim2", type: "explained_by" },
    ]);
    expect(inspectSection(t.raw, units, omit, { restoredLimits: t.units }).accounting.state.u1).toBe("restored");
  });

  it("nothing dropped, nothing put back; a card that keeps its clause is left as it is", () => {
    const kept = reply([text("n1", "Hybrid search lifts recall", "Improves recall when the query mixes keywords and concepts, but adds latency to every query.", ["u1"])]);
    const i = inspectSection(kept, units, omit);
    expect(droppedClauses(i, units)).toEqual([]);
    expect(restoreLimits(kept, i, units)).toEqual({ raw: kept, units: [], lines: [] });
  });

  it("a card longer than the passages it cites gets a `longer_than_source` hint, never Needs review; protected detail doesn't count", () => {
    const short = [unit("u1", "Retries stop after 3 attempts.")];
    const long = reply([text("n1", "Retries are bounded", "Retries stop after 3 attempts, and a long outage then ends with a clear error for the caller rather than a slow loop.", ["u1"])]);
    const i = inspectSection(long, short, []);
    // The protected "3" is set aside from the card's words.
    expect(i.hints).toEqual([{ code: "longer_than_source", card: "n1", detail: "the card has 25 words, more than the 5 of the passages it cites" }]);
    expect(i.needsReview).toBe(0);
    expect(cardReviews(i)).toEqual({});
    // Not a reason to ask the model check about the card (OD5's "flagged" cards).
    expect(checkItems(i, short, "flagged").items).toEqual([]);
    // Within the source's length once a protected value (kept exact) is set aside: no hint.
    const units = [unit("u1", "Set the timeout to 30 s.")];
    const exact = (body: string) => lengthHints([{ id: "n1", title: "", body, cites: ["u1"], members: ["n1"] }], units, [{ tier: "exact", kind: "number", value: "30 s", unit: "u1" }]);
    expect(exact("Timeout: set it to 30 s.")).toEqual([]);
    expect(exact("Timeout: always set it to exactly 30 s here.")).toHaveLength(1);
    // Lines the app put back from the source don't count either.
    expect(lengthHints([{ id: "n1", title: "", body: "Timeout 30 s.\n\n**Limit:** When the queue is full and the worker is slow", cites: ["u1"], members: ["n1"] }], units)).toEqual([]);
  });
});

describe("4. dialogue turns (kn-05's source): unanswered questions and assent to a proposal are never filler", async () => {
  const SOURCE = readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/knowledge-notes/cases/kn-05-incident-review-meeting/source.md"), "utf8");
  const { units } = await splitUnits(SOURCE);
  const reasons = dialogueReasonsOf(units);
  const find = (start: string) => {
    const u = units.find((x) => x.text.startsWith(start));
    if (!u) throw new Error(`no unit starts with ${start}`);
    return u;
  };
  const of = (start: string) => reasons.get(find(start).id) ?? [];

  it("assent right after a proposal, and the proposal, are decisions", () => {
    for (const line of ["Dana: Should support be allowed to post it directly?", "Kenji: I'd like that, yes.", "Leila: No objection from me.", "Dana: So the proposal is that payments config", "Leila: Yes.", "Tomás: I'm fine with that.", "Marcus: Same."])
      expect(of(line), line).toEqual(["decision"]);
  });

  it("a question the next speaker can't answer is an open question", () => {
    expect(of("Do we know whether any of the 2,300 failed checkouts")).toEqual(["open_question"]);
  });

  it("answered questions, requests, turn-taking and small talk are not critical by turn", () => {
    for (const line of [
      "Dana: Okay, I think everyone's here.",
      "Did people manage to grab coffee?",
      "Right, let's start.",
      "Marcus, can you walk us through the timeline?",
      "Marcus: Sure.",
      "Dana: Why did the alert take 22 minutes?",
      "Dana: Who posts the status page today?",
      "Tomás: Can I raise something else?",
      "Kenji: Can I go back to customers?",
      "Leila: Possibly.",
      "Marcus: Yes.",
      "Attendees: Dana (facilitator)",
    ])
      expect(of(line), line).toEqual([]);
  });

  it("accounting: such a unit omitted as filler is Needs review (critical_omitted); an answered question may still be omitted", () => {
    const omitted = ["Marcus: Same.", "Kenji: I'd like that, yes.", "Dana: Should support be allowed to post it directly?", "Do we know whether any of the 2,300", "Dana: Why did the alert take 22 minutes?", "Did people manage to grab coffee?"].map(
      (s) => ({ unit: find(s).id, reason: "filler" as const }),
    );
    const cited = units.filter((u) => !omitted.some((o) => o.unit === u.id)).map((u) => ({ id: `n_${u.id}`, title: "", body: u.text, cites: [u.id] }));
    const a = accountUnits({ units, ideas: cited, omitted });
    expect(a.outcome[find("Marcus: Same.").id]).toBe("needs_review");
    expect(a.outcome[find("Kenji: I'd like that, yes.").id]).toBe("needs_review");
    expect(a.outcome[find("Dana: Should support be allowed").id]).toBe("needs_review");
    expect(a.outcome[find("Do we know whether any of the 2,300").id]).toBe("needs_review");
    expect(a.outcome[find("Dana: Why did the alert take 22 minutes?").id]).toBe("omitted");
    expect(a.outcome[find("Did people manage to grab coffee?").id]).toBe("omitted");
    expect(a.flags.find((f) => f.unit === find("Do we know whether any of the 2,300").id)!.detail).toMatch(/^omitted as filler, but it carries an open question nobody answered/);
  });

  it("the retry asks for them back in words that fit", async () => {
    // kn-05: "Marcus: Same." omitted as filler, every other unit on a card of its own.
    const sameId = find("Marcus: Same.").id;
    const cards = reply(units.filter((u) => u.id !== sameId).map((u) => text(`n_${u.id}`, "", u.text, [u.id])));
    const i = inspectSection(cards, units, [{ unit: sameId, reason: "filler" }]);
    expect(retryReasons(i, (u) => (u === sameId ? "P9.1" : undefined), []).filter((r) => r.startsWith("P9.1"))).toEqual([
      "P9.1 was omitted, but it records a decision (agreement to a proposal): keep it, on the card of the decision.",
    ]);
    // An open question with no protected detail in it (kn-05's carries "2,300", so it is put back as exact detail first).
    const chat = await splitUnits(["Ana: The export runs nightly.", "Bo: Does it cover archived projects?", "Ana: Not sure, nobody has checked.", "Bo: Fine."].join("\n\n"));
    const q = chat.units.find((u) => u.text.startsWith("Bo: Does it cover"))!;
    const j = inspectSection(reply(chat.units.filter((u) => u.id !== q.id).map((u) => text(`n_${u.id}`, "", u.text, [u.id]))), chat.units, [{ unit: q.id, reason: "filler" }]);
    expect(j.accounting.critical[q.id]).toEqual(["open_question"]);
    expect(retryReasons(j, (u) => (u === q.id ? "P2.1" : undefined), []).filter((r) => r.startsWith("P2.1"))).toEqual(["P2.1 was omitted, but it is a question nobody answered: keep it, as an open question."]);
  });

  it("not a transcript (one speaker, or labels like \"Note:\"): no turn-level reasons", async () => {
    const memo = await splitUnits("Note: should we cache? Agreed: yes.\n\nAction: Same.\n\nNote: Who owns it?");
    expect(dialogueReasonsOf(memo.units).size).toBe(0);
    const monologue = await splitUnits("Dana: Should we cache?\n\nDana: Yes.\n\nDana: Who owns it?");
    expect(dialogueReasonsOf(monologue.units).size).toBe(0);
  });
});
