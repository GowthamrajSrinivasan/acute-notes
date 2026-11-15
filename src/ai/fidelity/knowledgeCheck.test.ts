/**
 * Distil mode's section checks (WP1.10): citations on the raw reply, the checks (the meaning rules as hints only), the
 * one retry's reasons and "better", protected content put back, and the model check's items, verdicts and reviews.
 */
import { describe, expect, it } from "vitest";
import type { DistilReply, SourceUnit } from "./contracts";
import { cardNeedsReview } from "./contracts";
import {
  annotateDistil,
  BY_REFERENCE,
  cardReviews,
  CITES,
  checkItems,
  explainedByOf,
  ideasOf,
  inspectSection,
  knowledgeIsWorse,
  prefixKnowledge,
  restoreProtected,
  retryIsBetter,
  retryReasons,
  verdictFlags,
  verdictsOf,
  type SectionKnowledge,
} from "./knowledgeCheck";

const unit = (id: string, text: string, kind: SourceUnit["kind"] = "sentence"): SourceUnit => ({ id, kind, text, hash: id, topic: "t", span: { start: 0, end: 1 } });
const UNITS = [
  unit("u1", "Retries can improve reliability when the cache holds a valid result."),
  unit("u2", "The cache keeps at most 500 entries per tenant."),
  unit("u3", "Thanks for reading."),
];
const card = (id: string, title: string, markdown: string, cites?: string[]) => ({ id, type: "text", title, content: { markdown }, ...(cites ? { [CITES]: cites } : {}) });
const plan = (...nodes: unknown[]) => ({ version: 1, template: "sectioned", nodes, relationships: [] });
const faithful = () =>
  plan(
    card("n1", "Retries help with a valid cached result", "Retries can improve reliability when the cache holds a valid result.", ["u1"]),
    card("n2", "A tenant's cache is bounded", "At most 500 entries per tenant.", ["u2"]),
  );
const omitFiller = [{ unit: "u3", reason: "filler" as const }];

describe("citations on the raw reply", () => {
  it("annotateDistil puts each node's unit ids on it, marks blocks by reference, and content nodes that gave no cites", () => {
    const reply: DistilReply = { cites: { n1: ["u1"], r1: ["u2"] }, omitted: [], problems: [], needsReview: false };
    const raw = annotateDistil(
      plan(
        { id: "n1", type: "text", cites: ["P1.1"], content: { markdown: "x" } },
        { id: "r1", type: "source", ref: "T1" },
        { id: "n2", type: "text", content: { markdown: "y" } },
        { id: "n3", type: "text", cites: [], content: { markdown: "z" } },
        { id: "a1", type: "text", origin: "analysis", content: { markdown: "w" } },
      ),
      reply,
    ) as { nodes: Record<string, unknown>[] };
    expect(raw.nodes[0]![CITES]).toEqual(["u1"]);
    expect(raw.nodes[1]).toMatchObject({ [CITES]: ["u2"], [BY_REFERENCE]: true });
    expect(raw.nodes[2]!.__uncited).toBe(true);
    // An explicit empty list is the model saying the node represents no unit (structure); analysis may infer.
    expect(raw.nodes[3]!.__uncited).toBeUndefined();
    expect(raw.nodes[4]!.__uncited).toBeUndefined();
  });

  it("ideasOf reads the cards (frames and headings hold no idea), their text per node type, and their citations", () => {
    const ideas = ideasOf(
      plan(
        { id: "g", type: "group", content: { label: "S" } },
        { id: "t", type: "table", title: "Limits", content: { columns: ["A", "B"], rows: [["1", "2"]] }, [CITES]: ["u2"] },
        { id: "s", type: "shape", content: { shape: "rectangle", label: "Cache", details: ["holds results"] } },
        { id: "a", type: "text", origin: "analysis", content: { markdown: "So what" } },
      ),
    );
    expect(ideas).toEqual([
      { id: "t", title: "Limits", body: "A | B\n1 | 2", cites: ["u2"] },
      { id: "s", title: "", body: "Cache\nholds results", cites: [] },
      { id: "a", title: "", body: "So what", cites: [], origin: "analysis" },
    ]);
  });
});

describe("inspectSection", () => {
  it("a faithful reply: everything accounted for, nothing in Needs review", () => {
    const i = inspectSection(faithful(), UNITS, omitFiller);
    expect(i.accounting.outcome).toEqual({ u1: "represented", u2: "represented", u3: "omitted" });
    expect(i.needsReview).toBe(0);
    expect(i.exactMissing).toEqual([]);
  });

  it("the meaning rules are hints only: an added absolute is a hint, never a Needs review item", () => {
    const raw = plan(card("n1", "Retries always help", "Retries always improve reliability when the cache holds a valid result.", ["u1"]), card("n2", "Bounded", "At most 500 entries per tenant.", ["u2"]));
    const i = inspectSection(raw, UNITS, omitFiller);
    expect(i.hints.map((h) => h.code)).toEqual(expect.arrayContaining(["absolute_added"]));
    expect(i.accounting.outcome.u1).toBe("represented");
    expect(i.needsReview).toBe(0);
    expect(cardReviews(i)).toEqual({});
  });

  it("a missing exact item, an unaccounted unit and an uncited card are Needs review, and named in the retry's reasons", () => {
    const raw = plan(card("n1", "Retries help", "Retries can improve reliability when the cache holds a valid result.", ["u1"]), { ...card("n2", "Bounded", "A few hundred entries."), __uncited: true });
    const i = inspectSection(raw, UNITS, []);
    expect(i.accounting.outcome).toMatchObject({ u2: "needs_review", u3: "needs_review" });
    expect(i.flags.map((f) => f.code)).toEqual(["uncited_card"]);
    const labels: Record<string, string> = { u1: "P1.1", u2: "P1.2", u3: "P1.3" };
    const reasons = retryReasons(i, (u) => labels[u], ["node \"n2\" cites no source unit"]);
    expect(reasons).toEqual([
      "P1.2 is neither cited nor omitted: cite it on the card it belongs to, or omit it for one of the listed reasons.",
      "P1.3 is neither cited nor omitted: cite it on the card it belongs to, or omit it for one of the listed reasons.",
      'Node "n2" cites no source unit: give it "cites".',
    ]);
    expect(cardReviews(i).n2).toEqual({ reasons: ["the card cites no passage of the source"] });
  });

  it("a card citing a critical unit but dropping its condition doesn't represent it: Needs review, with what is missing (2026-10-20)", () => {
    const raw = plan(card("n1", "Retries help", "Retrying improves reliability.", ["u1"]), card("n2", "Bounded", "At most 500 entries per tenant.", ["u2"]));
    const i = inspectSection(raw, UNITS, omitFiller);
    expect(i.accounting.outcome).toEqual({ u1: "needs_review", u2: "represented", u3: "omitted" });
    expect(cardReviews(i).n1!.reasons).toEqual(['the card drops the condition "when the cache holds a valid result"']);
    // An unrelated citation is a Needs review reason, not also a hint.
    const units = [UNITS[0]!, unit("u4", "Invoices are sent monthly in euros.")];
    const unrelated = inspectSection(plan(card("n1", "Retries help", "Retries can improve reliability when the cache holds a valid result.", ["u1", "u4"])), units, []);
    expect(unrelated.flags.map((f) => f.code)).toEqual(["citation_unrelated"]);
    expect(unrelated.hints.map((h) => h.code)).not.toContain("citation_unrelated");
    expect(unrelated.accounting.outcome).toEqual({ u1: "represented", u4: "needs_review" });
  });

  it("a section that failed: its units are pending, never shown as complete", () => {
    const i = inspectSection(null, UNITS, [], { pending: true });
    expect(Object.values(i.accounting.state)).toEqual(["pending", "pending", "pending"]);
    expect(i.needsReview).toBe(3);
  });
});

describe("the one retry", () => {
  const inspect = (raw: unknown, analysisMissing = 0) => ({ inspection: inspectSection(raw, UNITS, omitFiller), analysisMissing });
  const lost500 = plan(card("n1", "Retries help", "Retries can improve reliability when the cache holds a valid result.", ["u1"]), card("n2", "Bounded", "At most 507 entries.", ["u2"]));

  it("is kept when it has fewer problems and loses no protected item", () => {
    expect(retryIsBetter(inspect(lost500), inspect(faithful()))).toBe(true);
    expect(retryIsBetter(inspect(faithful()), inspect(faithful()))).toBe(false);
    // Fewer problems in all, but a protected item the first kept is lost: the first is kept.
    expect(retryIsBetter(inspect(faithful(), 2), inspect(lost500, 0))).toBe(false);
  });

  it("asks for a missing exact item by its label, and adds the hints only when it retries anyway", () => {
    const i = inspectSection(lost500, UNITS, omitFiller);
    const label = (u: string) => ({ u1: "P1.1", u2: "P1.2" })[u];
    expect(retryReasons(i, label, [])).toEqual([
      '"500" (P1.2) is missing: keep it exactly as the source has it, on a card citing P1.2.',
      // The card also drops the limit's own words (critical content kept, `representation.ts`): named verbatim, with its card.
      `Put "at most 500 entries per tenant" (P1.2) on card "Bounded": it is the requirement of that card's claim, and the card leaves it out. Keep it on that card, in words a reader can't miss.`,
    ]);
    expect(retryReasons(i, label, [], { withHints: true }).slice(2).join("\n")).toMatch(/^Check node "n2" against .* \(an automatic check suggests/);
  });
});

describe("restoreProtected (§3.3)", () => {
  it("puts a missing exact item back on its citing card as a \"From the source\" line, and an omitted protected unit on a card of its own", () => {
    const raw = plan(card("n1", "Retries help", "Retries can improve reliability when the cache holds a valid result.", ["u1"]), card("n2", "Bounded", "At most 507 entries.", ["u2"]));
    const units = [...UNITS, unit("u4", "Entries expire after 30 minutes.")];
    const i = inspectSection(raw, units, [...omitFiller, { unit: "u4", reason: "meta" }]);
    expect(i.accounting.state.u4).toBe("restored");
    const r = restoreProtected(raw, i, units);
    expect(r.items.map((x) => x.value)).toEqual(["500"]);
    expect(r.units).toEqual(["u4"]);
    const nodes = (r.raw as { nodes: { id: string; title?: string; content: { markdown: string } }[] }).nodes;
    expect(nodes[1]!.content.markdown).toBe("At most 507 entries.\n\n**From the source:** 500");
    expect(nodes.at(-1)).toMatchObject({ id: "fs1", title: "From the source", content: { markdown: "- Entries expire after 30 minutes." }, [CITES]: ["u4"] });
    const after = inspectSection(r.raw, units, [...omitFiller, { unit: "u4", reason: "meta" }]);
    expect(after.exactMissing).toEqual([]);
    expect(after.accounting.outcome).toMatchObject({ u2: "represented", u4: "represented" });
  });

  it("never puts back a protected unit omitted as superseded (a later statement revised it)", () => {
    const units = [...UNITS, unit("u4", "We once kept 100 entries.")];
    const i = inspectSection(faithful(), units, [...omitFiller, { unit: "u4", reason: "superseded" }]);
    expect(i.accounting.state.u4).toBe("omitted");
    expect(restoreProtected(faithful(), i, units).units).toEqual([]);
  });

  it("changes nothing when nothing is missing", () => {
    const raw = faithful();
    expect(restoreProtected(raw, inspectSection(raw, UNITS, omitFiller), UNITS)).toEqual({ raw, items: [], units: [] });
  });
});

describe("the model check's items, verdicts and reviews (§3.4, OD5)", () => {
  const raw = plan(
    card("n1", "Retries always help", "Retries always improve reliability.", ["u1"]),
    card("n2", "Bounded", "At most 500 entries per tenant.", ["u2"]),
    { id: "a1", type: "text", origin: "analysis", content: { markdown: "Retries matter." }, [CITES]: ["u1"] },
  );
  const i = inspectSection(raw, UNITS, omitFiller);

  it("\"flagged\" checks only the hinted cards, \"all\" every citing card; never analysis cards", () => {
    expect(checkItems(i, UNITS, "flagged").items.map((x) => x.card)).toEqual(["Retries always help\nRetries always improve reliability."]);
    const all = checkItems(i, UNITS, "all");
    expect([...all.cardOf.values()]).toEqual(["n1", "n2"]);
    expect(all.items[1]).toEqual({ ref: "c2", source: "The cache keeps at most 500 entries per tenant.", card: "Bounded\nAt most 500 entries per tenant." });
  });

  it("supported reads \"checked by AI\" and keeps the hints; not supported and no answer stay in Needs review", () => {
    const { cardOf } = checkItems(i, UNITS, "all");
    const verdicts = verdictsOf([{ ref: "c1", verdict: "not_supported", reason: "Adds an absolute." }], cardOf);
    expect(verdicts.get("n2")).toBe("unanswered");
    const flags = verdictFlags(verdicts);
    expect(flags.map((f) => f.detail)).toEqual(["checked by AI: not supported: Adds an absolute.", "checked by AI: no answer for this card"]);
    const checked = inspectSection(raw, UNITS, omitFiller, { extra: flags });
    const reviews = cardReviews(checked, verdicts);
    expect(cardNeedsReview(reviews.n1)).toBe(true);
    expect(reviews.n1!.checked).toEqual({ by: "ai", verdict: "not_supported", reason: "Adds an absolute." });
    expect(reviews.n1!.hints!.length).toBeGreaterThan(0);
    expect(cardNeedsReview(reviews.n2)).toBe(true);

    const supported = verdictsOf([{ ref: "c1", verdict: "supported", reason: "" }], new Map([["c1", "n1"]]));
    expect(verdictFlags(supported)).toEqual([]);
    // n1 drops u1's condition ("when the cache holds a valid result"): Needs review by the rule, unless the check
    // answered "supported" (OD5b), which keeps the rule's words as a hint.
    expect(cardNeedsReview(cardReviews(inspectSection(raw, UNITS, omitFiller), supported).n1)).toBe(true);
    const r = cardReviews(inspectSection(raw, UNITS, omitFiller, { aiSupported: new Set(["n1"]) }), supported).n1!;
    expect(cardNeedsReview(r)).toBe(false);
    expect(r).toMatchObject({ reasons: [], checked: { by: "ai", verdict: "supported" } });
    expect(JSON.stringify([reviews, r])).not.toMatch(/verified|correct\b/i);
  });

  it("a failed call answers nothing: every card it was asked about stays uncertain", () => {
    const { cardOf } = checkItems(i, UNITS, "all");
    expect([...verdictsOf(null, cardOf).values()]).toEqual(["unanswered", "unanswered"]);
  });
});

describe("section knowledge across runs", () => {
  const k = (over: Partial<SectionKnowledge> = {}): SectionKnowledge => ({
    units: ["u1"],
    ideas: [{ id: "n1", title: "T", body: "B", cites: ["u1"] }],
    omitted: [],
    problems: [],
    flags: [{ code: "uncited_card", card: "n1", detail: "d" }],
    hints: [],
    reviews: { n1: { reasons: ["d"] } },
    restored: { items: [], units: [] },
    needsReview: 1,
    exactMissing: [],
    ...over,
  });

  it("prefixKnowledge gives node ids as the merged plan has them", () => {
    const p = prefixKnowledge(k(), "u2_");
    expect(p.ideas[0]!.id).toBe("u2_n1");
    expect(p.flags[0]!.card).toBe("u2_n1");
    expect(Object.keys(p.reviews)).toEqual(["u2_n1"]);
  });

  it("a regeneration is worse with more Needs review items, a protected item lost, or a failure", () => {
    expect(knowledgeIsWorse(k({ needsReview: 2 }), k())).toBe(true);
    expect(knowledgeIsWorse(k({ needsReview: 0 }), k())).toBe(false);
    expect(knowledgeIsWorse(k({ needsReview: 0, exactMissing: ["x"] }), k())).toBe(true);
    expect(knowledgeIsWorse(k({ pending: true, needsReview: 0 }), k())).toBe(true);
  });
});

describe("the model check reads a shape with its explanations (explained_by, live 2026-10-20)", () => {
  const units = [
    unit("u1", "The retriever fetches the top 50 candidates from the vector index when the query has no filters."),
    unit("u2", "Thumbnails are generated by a background worker for every upload."),
  ];
  const shape = (id: string, label: string, cites: string[], extra: Record<string, unknown> = {}) => ({ id, type: "shape", content: { label, ...extra }, [CITES]: cites });
  const linked = (nodes: unknown[], relationships: unknown[]) => ({ version: 1, template: "flow", nodes, relationships });
  const raw = linked(
    [shape("s1", "Retrieve Candidates", ["u1"], { sublabel: "vector index" }), card("t1", "", "Fetches the top 50 candidates when the query has no filters.", ["u1"])],
    [{ from: "s1", to: "t1", type: "explained_by" }],
  );

  it("explainedByOf reads explanation → card from the reply's links (first link wins, self-links ignored)", () => {
    const links = [
      { from: "s1", to: "t1", type: "explained_by" },
      { from: "s2", to: "t1", type: "explained_by" },
      { from: "s3", to: "s3", type: "explained_by" },
      { from: "s1", to: "s2", type: "flows_to" },
    ];
    expect([...explainedByOf({ nodes: [], relationships: links })]).toEqual([["t1", "s1"]]);
    expect(explainedByOf(null).size).toBe(0);
  });

  it("a label-only shape and its linked text are one item, with both texts and every unit either cites", () => {
    const i = inspectSection(raw, units, [{ unit: "u2", reason: "filler" }]);
    expect(i.ideas.map((x) => x.id)).toEqual(["s1", "t1"]);
    const { items, cardOf } = checkItems(i, units, "all");
    expect(items).toEqual([{ ref: "c1", source: units[0]!.text, card: "Retrieve Candidates\nvector index\nFetches the top 50 candidates when the query has no filters." }]);
    expect([...cardOf]).toEqual([["c1", "s1"]]);
    // The deterministic rules read the same card: the condition is in the text, so nothing is flagged.
    expect(i.flags).toEqual([]);
    expect(i.needsReview).toBe(0);
  });

  it("the one verdict is the card's: every node of it gets it, and accounting agrees", () => {
    const i = inspectSection(raw, units, [{ unit: "u2", reason: "filler" }]);
    const { cardOf } = checkItems(i, units, "all");
    const bad = verdictsOf([{ ref: "c1", verdict: "not_supported", reason: "Drops the filter condition." }], cardOf);
    const checked = inspectSection(raw, units, [{ unit: "u2", reason: "filler" }], { extra: verdictFlags(bad) });
    expect(checked.flags.map((f) => [f.code, f.card])).toEqual([
      ["ai_check", "s1"],
      ["ai_check", "t1"],
    ]);
    expect(checked.accounting.outcome.u1).toBe("needs_review");
    const reviews = cardReviews(checked, bad);
    expect(reviews.t1!.checked).toEqual({ by: "ai", verdict: "not_supported", reason: "Drops the filter condition." });

    const good = verdictsOf([{ ref: "c1", verdict: "supported", reason: "" }], cardOf);
    const ok = inspectSection(raw, units, [{ unit: "u2", reason: "filler" }], { extra: verdictFlags(good), aiSupported: new Set(["s1"]) });
    expect(ok.accounting.outcome.u1).toBe("represented");
    const r = cardReviews(ok, good);
    expect(Object.keys(r)).toEqual(["s1", "t1"]);
    expect(Object.values(r).every((x) => !cardNeedsReview(x) && x.checked?.verdict === "supported")).toBe(true);
  });

  it("a shape with no explanation and an unrelated citation is still flagged, and checked on its own", () => {
    const lone = linked([shape("s2", "Message Queue", ["u2"]), ...raw.nodes], raw.relationships);
    const i = inspectSection(lone, units, []);
    expect(i.flags.map((f) => [f.code, f.card, f.unit])).toEqual([["citation_unrelated", "s2", "u2"]]);
    expect(i.accounting.outcome.u2).toBe("needs_review");
    expect(checkItems(i, units, "all").items.map((x) => x.card)).toEqual(["Message Queue", "Retrieve Candidates\nvector index\nFetches the top 50 candidates when the query has no filters."]);
  });
});
