/**
 * Whether a citing card represents its unit (`representation.ts`; the live runs of 2026-10-19): citation sanity and
 * critical content kept. Both are deterministic Needs review reasons, and the unit isn't counted Represented by that card.
 */
import { describe, expect, it } from "vitest";
import { accountUnits } from "./accounting";
import type { Idea, SourceUnit } from "./contracts";
import { cardKeepsClause, cardViews, criticalClausesOf, relatedToUnit, representationFlags } from "./representation";

const unit = (id: string, text: string): SourceUnit => ({ id, kind: "sentence", text, hash: id, topic: "t", span: { start: 0, end: text.length } });
const idea = (id: string, title: string, body: string, cites: string[], extra: Partial<Idea> = {}): Idea => ({ id, title, body, cites, ...extra });

describe("citation sanity (citation_unrelated)", () => {
  it("a card is related to a unit when it shares a significant word, a key term or a quantity", () => {
    expect(relatedToUnit("Purges are eventually consistent", "Purging is eventually consistent, not instant.")).toBe(true);
    expect(relatedToUnit("Config lives in `services/api.yaml`", "The file is services/api.yaml in the repo root.")).toBe(true);
    // The same quantity in other units: 0.25 s = 250 ms.
    expect(relatedToUnit("A quarter-second budget: 0.25 s", "Each call has 250 ms.")).toBe(true);
    expect(relatedToUnit("Message Queue", "The worker then publishes a PhotoReady event.")).toBe(false);
  });

  it("a unit too short to judge (a transcript's speaker label aside) is never called unrelated", () => {
    expect(relatedToUnit("Support may post status updates directly", "Kenji: I'd like that, yes.")).toBe(true);
    expect(relatedToUnit("Support may post status updates directly", "Leila: No objection from me.")).toBe(true);
  });

  it("flags the card, and the unit isn't Represented by it: Needs review when no other card represents it", () => {
    const units = [unit("u1", "The worker then publishes a PhotoReady event to the queue."), unit("u2", "Thumbnails are generated in three sizes for every upload.")];
    const ideas = [idea("n1", "Thumbnails come in three sizes", "Three sizes per upload.", ["u1", "u2"])];
    const { flags } = representationFlags(ideas, units);
    expect(flags).toEqual([expect.objectContaining({ code: "citation_unrelated", card: "n1", unit: "u1" })]);
    const r = accountUnits({ units, ideas, omitted: [], flags });
    expect(r.outcome).toEqual({ u1: "needs_review", u2: "represented" });
    // The flag explains it: no second "unaccounted" flag for the same unit.
    expect(r.flags.map((f) => f.code)).toEqual(["citation_unrelated"]);
    // Another card that does carry u1 represents it.
    const both = [...ideas, idea("n2", "PhotoReady is published", "The worker publishes PhotoReady.", ["u1"])];
    const again = representationFlags(both, units);
    expect(accountUnits({ units, ideas: both, omitted: [], flags: again.flags }).outcome.u1).toBe("represented");
  });

  it("analysis cards (may infer) and blocks placed by reference (verbatim) are not checked", () => {
    const units = [unit("u1", "The worker then publishes a PhotoReady event to the queue.")];
    const ideas = [idea("a1", "So what", "Uploads stay fast.", ["u1"], { origin: "analysis" }), idea("r1", "", "Other text", ["u1"], { byReference: true })];
    expect(representationFlags(ideas, units).flags).toEqual([]);
  });
});

describe("critical content kept (critical_dropped)", () => {
  it("finds a unit's condition, caveat and requirement clauses", () => {
    expect(criticalClausesOf("Retries can improve reliability when the cache holds a valid result.")).toEqual([{ kind: "condition", marker: "when", clause: "the cache holds a valid result" }]);
    expect(criticalClausesOf("Purges are fast, but they reach the edges over about 20 seconds.")).toEqual([{ kind: "caveat", marker: "but", clause: "they reach the edges over about 20 seconds" }]);
    expect(criticalClausesOf("Although the reranker is accurate, it adds 120 ms.")).toEqual([{ kind: "caveat", marker: "Although", clause: "the reranker is accurate" }]);
    expect(criticalClausesOf("However, the export skips archived boards.")).toEqual([{ kind: "caveat", marker: "However", clause: "the export skips archived boards" }]);
    expect(criticalClausesOf("Tokens must be rotated every 90 days.")).toEqual([{ kind: "requirement", marker: "must", clause: "be rotated every 90 days" }]);
  });

  it("finds none in a sign-off or meta line (\"let me know if…\", \"hope this helps\")", () => {
    expect(criticalClausesOf("Hope this helps — let me know if you want a sample consumer!")).toEqual([]);
    expect(criticalClausesOf("Feel free to reach out if you have any questions.")).toEqual([]);
    // What is left after the meta phrase still counts.
    expect(criticalClausesOf("As discussed, the limit must be 500 per tenant.")).toEqual([{ kind: "requirement", marker: "must", clause: "be 500 per tenant" }]);
  });

  it("a card keeps a clause with at least half of its significant words, quantities normalised", () => {
    const [c] = criticalClausesOf("An expired copy is served only when the origin is slower than 0.25 seconds.");
    expect(cardKeepsClause("Stale copies are served when the origin takes over 250 ms", c!)).toBe(true);
    expect(cardKeepsClause("Stale copies are served to keep pages fast", c!)).toBe(false);
    // "logged and skipped" = "logs … skips" (a doubled consonant isn't a different word).
    const [d] = criticalClausesOf("A delivery the adapter cannot parse is logged and skipped.");
    expect(cardKeepsClause("If the adapter can't parse a delivery, it logs the error and skips it.", d!)).toBe(true);
  });

  it("no citing card keeps the condition: each is flagged, naming what it drops, and the unit is Needs review", () => {
    const units = [unit("u1", "Retries can improve reliability when the cache holds a valid result.")];
    const ideas = [idea("n1", "Retries improve reliability", "Retrying makes calls more reliable.", ["u1"])];
    const { flags } = representationFlags(ideas, units);
    expect(flags).toEqual([
      { code: "critical_dropped", card: "n1", unit: "u1", detail: 'the card drops the condition "when the cache holds a valid result"', evidence: { source: "when the cache holds a valid result" } },
    ]);
    expect(accountUnits({ units, ideas, omitted: [], flags }).outcome.u1).toBe("needs_review");
  });

  it("one citing card keeping it is enough: the unit is Represented and no card is flagged", () => {
    const units = [unit("u1", "Retries can improve reliability when the cache holds a valid result.")];
    const ideas = [idea("n1", "Retries help", "Retrying makes calls more reliable.", ["u1"]), idea("n2", "Only with a valid cached result", "Retries help when the cache holds a valid result.", ["u1"])];
    const { flags } = representationFlags(ideas, units);
    expect(flags).toEqual([]);
    expect(accountUnits({ units, ideas, omitted: [], flags }).outcome.u1).toBe("represented");
  });

  it("a card the model check answered \"supported\" keeps the unit; the rule's words stay a hint (OD5b)", () => {
    const units = [unit("u1", "Retries can improve reliability when the cache holds a valid result.")];
    const ideas = [idea("n1", "Retries pay off with a good cached answer", "With a usable cached response, retrying makes calls more reliable.", ["u1"])];
    const { flags, hints } = representationFlags(ideas, units, { aiSupported: new Set(["n1"]) });
    expect(flags).toEqual([]);
    expect(hints.map((h) => h.code)).toEqual(["critical_dropped"]);
    expect(accountUnits({ units, ideas, omitted: [], flags }).outcome.u1).toBe("represented");
  });

  it("a unit a block placed by reference cites is kept word for word", () => {
    const units = [unit("u1", "Retries can improve reliability when the cache holds a valid result.")];
    const ideas = [idea("r1", "", "Retries can improve reliability when the cache holds a valid result.", ["u1"], { byReference: true }), idea("n1", "Retries help", "More reliable calls.", ["u1"])];
    expect(representationFlags(ideas, units).flags).toEqual([]);
  });
});

describe("a card read with its explanations (explained_by, live 2026-10-20)", () => {
  const units = [
    unit("u1", "The retriever fetches the top 50 candidates from the vector index when the query has no filters."),
    unit("u2", "Thumbnails are generated in three sizes for every upload."),
  ];
  // The diagram shape shows only its label; the text node linked from it carries the claim.
  const shape = idea("s1", "", "Retrieve Candidates", ["u1"]);
  const text = idea("t1", "", "Fetches the top 50 candidates from the vector index when the query has no filters.", ["u1"]);
  const links = new Map([["t1", "s1"]]);

  it("cardViews folds an explanation into the card it explains, with its text and citations; chains go to the first card", () => {
    const views = cardViews([shape, idea("t1", "Detail", "More.", ["u2"]), idea("p1", "", "Even more.", [])], new Map([["t1", "s1"], ["p1", "t1"]]));
    expect(views).toEqual([{ ...shape, body: "Retrieve Candidates\nDetail\nMore.\nEven more.", cites: ["u1", "u2"], members: ["s1", "t1", "p1"] }]);
    // No links: one view per idea, unchanged; analysis nodes are never folded, and nothing folds into one.
    expect(cardViews([shape, text]).map((v) => v.members)).toEqual([["s1"], ["t1"]]);
    const a = idea("a1", "So what", "x", [], { origin: "analysis" });
    expect(cardViews([a, text], new Map([["t1", "a1"]])).map((v) => v.members)).toEqual([["a1"], ["t1"]]);
    expect(cardViews([shape, a], new Map([["a1", "s1"]])).map((v) => v.members)).toEqual([["s1"], ["a1"]]);
    // A cycle stops.
    expect(cardViews([shape, text], new Map([["t1", "s1"], ["s1", "t1"]])).map((v) => v.members.length).reduce((x, y) => x + y)).toBe(2);
  });

  it("a label-only shape whose condition sits in its linked text is not flagged", () => {
    // Read alone, the shape drops u1's condition ("when the query has no filters").
    const ideas = [shape, text];
    expect(representationFlags([shape], units).flags.map((f) => f.code)).toEqual(["critical_dropped"]);
    expect(representationFlags(ideas, units, { explainedBy: links })).toEqual({ flags: [], hints: [] });
    // The shape cites u1 alone; its label shares no word with the passage, but its explanation does.
    const bare = [idea("s1", "", "Stage A", ["u1"]), text];
    expect(representationFlags(bare, units).flags.map((f) => [f.code, f.card])).toEqual([["citation_unrelated", "s1"]]);
    expect(representationFlags(bare, units, { explainedBy: links }).flags).toEqual([]);
  });

  it("a shape with no explanation and an unrelated citation is still flagged", () => {
    const ideas = [idea("s1", "", "Message Queue", ["u2"]), text];
    const { flags } = representationFlags(ideas, units, { explainedBy: links });
    expect(flags).toEqual([expect.objectContaining({ code: "citation_unrelated", card: "s1", unit: "u2" })]);
    expect(accountUnits({ units, ideas, omitted: [], flags }).outcome).toEqual({ u1: "represented", u2: "needs_review" });
  });

  it("a flag on the card goes on each of its nodes citing the unit, so accounting agrees", () => {
    const thin = idea("t1", "", "Fetches candidates from the vector index.", ["u1"]);
    const ideas = [shape, thin];
    const { flags } = representationFlags(ideas, units, { explainedBy: links });
    expect(flags.map((f) => [f.code, f.card, f.unit])).toEqual([
      ["critical_dropped", "s1", "u1"],
      ["critical_dropped", "t1", "u1"],
    ]);
    expect(accountUnits({ units, ideas, omitted: [], flags }).outcome.u1).toBe("needs_review");
    // "Supported" on the card (its id) keeps the unit, the rule's words a hint.
    const ok = representationFlags(ideas, units, { explainedBy: links, aiSupported: new Set(["s1"]) });
    expect(ok.flags).toEqual([]);
    expect(ok.hints).toHaveLength(2);
  });
});
