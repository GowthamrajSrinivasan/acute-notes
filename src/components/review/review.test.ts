import { describe, expect, it } from "vitest";
import { REVIEW_CODE_LABEL, cardReviewOf, isOpenReview, outcomeCountsText, reasonText } from "./wording";
import { outcomeTotals, sectionOutcomeChips } from "./sectionChips";
import { sourceChipView } from "./chipView";
import { buildReviewQueue, decisionFor, markParts, nextIndex, resolveReview, stepIndex } from "./queue";
import { canInclude, cardFromPassage, includeUnit, pinQuote, shortTitle } from "./passageActions";
import { stubReview } from "./stubData";
import type { SourceUnit } from "@/ai/fidelity/contracts";

describe("wording", () => {
  it("leads each reason with its label, once", () => {
    expect(reasonText({ code: "condition_changed", detail: 'source says "when the cache contains a valid result"' })).toBe(
      'condition changed: source says "when the cache contains a valid result"',
    );
    expect(reasonText({ code: "condition_changed", detail: "Condition changed: source limits it" })).toBe("Condition changed: source limits it");
    expect(reasonText({ code: "pending", detail: "" })).toBe("not processed");
    expect(reasonText({ code: "ai_check", detail: "checked by AI: not supported" })).toBe("checked by AI: not supported");
    expect(Object.values(REVIEW_CODE_LABEL).filter((l) => l[0] !== l[0]!.toLowerCase())).toEqual([]);
  });

  it("builds a card review from flags and knows when it is open", () => {
    expect(cardReviewOf([])).toBeUndefined();
    const review = cardReviewOf([
      { code: "qualifier_dropped", detail: "drops usually" },
      { code: "qualifier_dropped", detail: "drops usually" },
    ]);
    expect(review).toEqual({ reasons: ["qualifier dropped: drops usually"] });
    expect(isOpenReview(review)).toBe(true);
    expect(isOpenReview(resolveReview(review, "kept"))).toBe(false);
    expect(isOpenReview({ reasons: [] })).toBe(false);
  });

  it("counts in the three outcome words", () => {
    expect(outcomeCountsText({ represented: 38, omitted: 3, needsReview: 1 })).toBe("38 represented · 3 omitted · 1 needs review");
    expect(outcomeCountsText({ represented: 5, omitted: 0, needsReview: 2 })).toBe("5 represented · 2 need review");
    expect(outcomeCountsText({ represented: 0, omitted: 0, needsReview: 0 })).toBe("0 represented");
  });
});

describe("section chips and totals (WP2.5)", () => {
  const { sections, labels } = stubReview();

  it("says each section in outcome words, amber when something needs review", () => {
    const chips = sectionOutcomeChips(sections, labels);
    expect(chips.map((c) => [c.label, c.text, c.tone])).toEqual([
      ["Caching", "2 represented · 1 omitted · 1 needs review", "warning"],
      ["Invalidation", "2 represented", "ok"],
      ["Limits", "0 represented · 2 need review", "warning"],
      ["Open questions", "0 represented · 1 needs review", "warning"],
    ]);
    expect(chips.some((c) => /AI placed|from source/.test(c.text))).toBe(false);
  });

  it("notes a high omitted share as a secondary signal, and skips empty sections", () => {
    const chips = sectionOutcomeChips([
      { topic: "a", represented: 2, omitted: 3, needsReview: 0, highOmittedShare: true },
      { topic: "b", represented: 0, omitted: 0, needsReview: 0, highOmittedShare: false },
    ]);
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ tone: "note", text: "2 represented · 3 omitted" });
    expect(chips[0]!.detail.join(" ")).toMatch(/left out/);
  });

  it("sums the bar totals and adds the model-tier warning on request", () => {
    expect(outcomeTotals(sections)).toEqual({ represented: 4, omitted: 1, needsReview: 4, text: "4 represented · 1 omitted · 4 need review" });
    expect(outcomeTotals(sections, { weakModel: true }).warning).toBe("This model may drop conditions; check the items that need review.");
  });
});

describe("source chip (WP2.4)", () => {
  it("counts distinct cited passages; no chip without citations", () => {
    expect(sourceChipView({ cites: [] })).toBeNull();
    expect(sourceChipView({ cites: ["u1"] })).toMatchObject({ text: "1 source", tone: "ok", units: ["u1"] });
    expect(sourceChipView({ cites: ["u3", "u1", "u3"] })).toMatchObject({ text: "2 sources", units: ["u3", "u1"] });
  });

  it("is amber while the card needs review, plain once resolved, grey when the source is missing", () => {
    const review = { reasons: ["condition changed: source says x", "qualifier dropped: y"] };
    const flagged = sourceChipView({ cites: ["u1"], review })!;
    expect(flagged.tone).toBe("review");
    expect(flagged.label).toContain("condition changed");
    expect(flagged.label).toContain("+1 more");
    expect(sourceChipView({ cites: ["u1"], review: { ...review, resolved: "kept" } })!.tone).toBe("ok");
    expect(sourceChipView({ cites: ["u1"], review, available: false })).toMatchObject({ tone: "unavailable", label: "1 source: source not on this device" });
  });
});

describe("review queue (WP2.6)", () => {
  const stub = stubReview();

  it("lists one item per object in document order, with the right actions", () => {
    const items = buildReviewQueue(stub);
    expect(items.map((i) => i.key)).toEqual(["card:c1", "unit:u7", "unit:u8", "unit:u9"]);
    const [card, critical, duplicate, pending] = items;
    expect(card!.units.map((u) => u.id)).toEqual(["u2"]);
    expect(card!.reasons).toEqual(['condition changed: source says "only when the cache contains a valid result"']);
    expect(card!.actions).toEqual(["keep", "edit", "use_source_wording"]);
    expect(critical!.actions).toEqual(["include", "dismiss"]);
    expect(duplicate!.reasons[0]).toMatch(/^left out as a repeat: /);
    // Not processed: never confirmable as complete, so no Dismiss.
    expect(pending!.actions).toEqual(["include"]);
  });

  it("puts a unit-wide flag on a cited unit under its citing card, and ignores section-level flags", () => {
    const items = buildReviewQueue({
      units: stub.units,
      cards: stub.cards,
      flags: [
        { code: "exact_missing", unit: "u6", detail: '"2 seconds" is missing' },
        { code: "unaccounted", detail: "the section's reply had no omitted list" },
      ],
    });
    expect(items.map((i) => i.key)).toEqual(["card:c3"]);
    expect(items[0]!.units.map((u) => u.id)).toEqual(["u6"]);
  });

  it("offers Keep and Edit only for a card that cites no passage", () => {
    const cards = [...stub.cards, { id: "c4", title: "Warm caches on deploy", body: "Prime the cache before traffic.", cites: [] }];
    const [item] = buildReviewQueue({ units: stub.units, cards, flags: [{ code: "uncited_card", card: "c4", detail: "the card cites no passage of the source" }] });
    expect(item).toMatchObject({ key: "card:c4", units: [], actions: ["keep", "edit"], reasons: ["no passage cited: the card cites no passage of the source"] });
  });

  it("keeps a flagged card after a reload from its stored review, until resolved (U3, U8)", () => {
    const cards = stub.cards.map((c) => (c.id === "c2" ? { ...c, review: { reasons: ["qualifier dropped: drops usually"] } } : c));
    const reloaded = buildReviewQueue({ units: stub.units, cards });
    expect(reloaded.map((i) => i.key)).toEqual(["card:c2"]);
    expect(reloaded[0]!.units.map((u) => u.id)).toEqual(["u4"]);
    const resolved = cards.map((c) => (c.id === "c2" ? { ...c, review: resolveReview(c.review, "kept") } : c));
    expect(buildReviewQueue({ units: stub.units, cards: resolved })).toEqual([]);
    expect(buildReviewQueue({ ...stub, resolvedUnits: { u7: "included", u8: "dismissed" } }).map((i) => i.key)).toEqual(["card:c1", "unit:u9"]);
  });

  it("maps each action to its resolution; Edit resolves on save", () => {
    const [card, critical] = buildReviewQueue(stub);
    expect(decisionFor(card!, "keep")).toEqual({ key: "card:c1", action: "keep", resolution: "kept", card: "c1", units: ["u2"] });
    expect(decisionFor(card!, "edit").resolution).toBeUndefined();
    expect(decisionFor(card!, "use_source_wording").resolution).toBe("edited");
    expect(decisionFor(critical!, "include")).toEqual({ key: "unit:u7", action: "include", resolution: "included", units: ["u7"] });
    expect(decisionFor(critical!, "dismiss").resolution).toBe("dismissed");
    expect(() => decisionFor(card!, "dismiss")).toThrow();
  });

  it("keeps its place when items change, and wraps when stepping", () => {
    const items = buildReviewQueue(stub);
    expect(nextIndex(items, { key: "unit:u8", index: 0 })).toBe(2);
    // The item on show was resolved and dropped: the one that took its place.
    expect(nextIndex(items.filter((i) => i.key !== "unit:u7"), { key: "unit:u7", index: 1 })).toBe(1);
    expect(nextIndex(items.slice(0, 2), { key: "gone", index: 5 })).toBe(1);
    expect(nextIndex([], { key: null, index: 0 })).toBe(-1);
    expect(stepIndex(3, 4, 1)).toBe(0);
    expect(stepIndex(0, 4, -1)).toBe(3);
  });

  it("marks the fragment a rule compared", () => {
    expect(markParts("Served only when valid.", "only when")).toEqual([
      { text: "Served ", mark: false },
      { text: "only when", mark: true },
      { text: " valid.", mark: false },
    ]);
    expect(markParts("abc", "zzz")).toEqual([{ text: "abc", mark: false }]);
    expect(markParts("abc", undefined)).toEqual([{ text: "abc", mark: false }]);
  });
});

describe("passage actions (WP2.7)", () => {
  const unit = (text: string, kind: SourceUnit["kind"] = "sentence"): SourceUnit => ({ id: "u5", kind, text, hash: "h", topic: "t1", span: { start: 0, end: text.length } });

  it("makes a card citing the passage, with no AI call", () => {
    expect(cardFromPassage(unit("A write clears the cache."))).toEqual({ title: "A write clears the cache", body: "", cites: ["u5"] });
    const long = "Clearing is asynchronous and can lag by up to two seconds when the index is under heavy write load from many tenants.";
    const card = cardFromPassage(unit(long));
    expect(card.title.length).toBeLessThanOrEqual(72);
    expect(card.title.endsWith("…")).toBe(true);
    expect(card.body).toBe(long);
    expect(cardFromPassage(unit("Region | Latency | Notes", "table_row"))).toMatchObject({ title: "Region", body: "Region · Latency · Notes" });
    expect(cardFromPassage(unit("```ts\nconst ttl = 600;\n```", "code"))).toMatchObject({ title: "Code: const ttl = 600;", byReference: true });
  });

  it("cuts titles at a word boundary", () => {
    expect(shortTitle("one two three", 9)).toBe("one two…");
    expect(shortTitle("short.")).toBe("short");
  });

  it("pins a passage word for word, once", () => {
    const u = unit("Results are served from the cache only when it holds a valid result.");
    const first = pinQuote({ body: "Results come from the cache.", cites: ["u1"] }, u);
    expect(first).toEqual({ body: "Results come from the cache.\n\n> Results are served from the cache only when it holds a valid result.", cites: ["u1", "u5"], changed: true });
    expect(pinQuote({ body: first.body, cites: first.cites }, u)).toEqual({ body: first.body, cites: first.cites, changed: false });
    expect(pinQuote({ body: "", cites: [] }, u).body).toBe("> Results are served from the cache only when it holds a valid result.");
  });

  it("includes an omitted passage: Represented, on the canvas, reasons cleared", () => {
    const data = { outcome: { u1: "represented" as const, u3: "omitted" as const, u7: "needs_review" as const }, reasons: { u3: ["filler"], u7: ["critical"] }, onCanvas: ["u1", "u7"] };
    expect(canInclude(data, "u3")).toBe(true);
    expect(canInclude(data, "u1")).toBe(false);
    expect(canInclude(data, "u7")).toBe(false); // needs review, but already on a card
    expect(canInclude({ ...data, onCanvas: undefined }, "u7")).toBe(true);
    const next = includeUnit(data, "u3");
    expect(next.outcome.u3).toBe("represented");
    expect(next.reasons).toEqual({ u7: ["critical"] });
    expect(next.onCanvas).toEqual(["u1", "u7", "u3"]);
    expect(data.outcome.u3).toBe("omitted");
  });
});
