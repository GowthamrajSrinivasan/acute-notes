import { describe, expect, it } from "vitest";
import type { Lineage, LineageEntry, SourceUnit, UnitSet } from "@/ai/fidelity/contracts";
import { CARD_RESEND_RULE, CITATION_UPDATE_CONFIG, cardResendInput, planCitationUpdate, readCardResendReply, reviewAfterUpdate, type CitationUpdateInput, type CitedCard } from "./citations";

const u = (id: string, text: string, topic = "A"): SourceUnit => ({ id, kind: "sentence", text, hash: `h-${text}`, topic, span: { start: 0, end: text.length } });
const set = (...units: SourceUnit[]): UnitSet => ({ units, nextId: 99 });
const lineage = (...entries: LineageEntry[]): Lineage => ({ fromVersion: 1, toVersion: 2, entries });
const card = (objectId: string, cites: string[], extra: Partial<CitedCard> = {}): CitedCard => ({ objectId, stableNodeKey: `A#${objectId}`, cites, edited: false, ...extra });

const PREV = set(u("u1", "Alpha holds."), u("u2", "Beta holds."), u("u3", "Gamma holds.", "B"));
const NEXT = set(u("u1", "Alpha holds."), u("u2", "Beta holds firmly."), u("u3", "Gamma holds.", "C"), u("u4", "Delta is new."));
const LINEAGE = lineage({ state: "unchanged", from: "u1", to: "u1" }, { state: "changed", from: "u2", to: "u2" }, { state: "unchanged", from: "u3", to: "u3", moved: true }, { state: "added", to: "u4" });

const input = (cards: CitedCard[], over: Partial<CitationUpdateInput> = {}): CitationUpdateInput => ({ previous: PREV, next: NEXT, lineage: LINEAGE, previousVersion: 1, nextVersion: 2, cards, enabled: true, ...over });
function cardsPlan(i: CitationUpdateInput) {
  const plan = planCitationUpdate(i);
  if (plan.mode !== "cards") throw new Error(plan.reason);
  return plan;
}

describe("planCitationUpdate: the switch and the section fallback (§6.3)", () => {
  it("is off by default until R2: the section path runs", () => {
    expect(CITATION_UPDATE_CONFIG.enabled).toBe(false);
    expect(planCitationUpdate({ ...input([card("k", ["u1"])]), enabled: undefined })).toEqual({ mode: "sections", reason: "disabled" });
  });

  it("an old canvas (previous version without units) takes the section path; the next update has ids", () => {
    expect(planCitationUpdate(input([card("k", ["u1"])], { previous: set() }))).toEqual({ mode: "sections", reason: "no_units" });
    expect(planCitationUpdate(input([card("k", ["u1"])])).mode).toBe("cards");
  });

  it("no lineage, or a lineage between other versions, takes the section path", () => {
    expect(planCitationUpdate(input([], { lineage: lineage() }))).toEqual({ mode: "sections", reason: "no_lineage" });
    expect(planCitationUpdate(input([], { previousVersion: 2, nextVersion: 3 }))).toEqual({ mode: "sections", reason: "lineage_mismatch" });
  });

  it("a card citing ids the previous version doesn't have keeps the section path", () => {
    expect(cardsPlan(input([card("k", ["u1", "u77"])])).cards[0]!.action).toBe("section");
  });
});

describe("planCitationUpdate: per card (§6.1)", () => {
  it("unchanged units: kept, no resend; an edited card whose units are unchanged is kept too", () => {
    const plan = cardsPlan(input([card("a", ["u1"]), card("b", ["u1"], { edited: true })]));
    expect(plan.cards.map((c) => c.action)).toEqual(["keep", "keep"]);
    expect(plan.resend).toEqual([]);
  });

  it("a changed unit resends only its cards, with old → new text; the section's other cards are kept", () => {
    const plan = cardsPlan(input([card("a", ["u1"]), card("b", ["u1", "u2"])]));
    expect(plan.cards[0]!.action).toBe("keep");
    expect(plan.cards[1]).toMatchObject({ action: "resend", cites: ["u1", "u2"], changes: [{ unit: "u2", before: "Beta holds.", after: "Beta holds firmly." }] });
    expect(plan.resend).toEqual([{ topic: "A", cards: ["b"] }]);
  });

  it("the user's edit wins: a changed unit under an edited card is a conflict, never resent", () => {
    const plan = cardsPlan(input([card("b", ["u2"], { edited: true })]));
    expect(plan.cards[0]!.action).toBe("conflict");
    expect(plan.resend).toEqual([]);
  });

  it("a card whose units all moved to one topic is moved; one whose units sit in two topics is not", () => {
    const plan = cardsPlan(input([card("g", ["u3"]), card("mixed", ["u1", "u3"])]));
    expect(plan.cards[0]).toMatchObject({ action: "keep", moveTo: "C" });
    expect(plan.cards[1]!.moveTo).toBeUndefined();
  });

  it("moved and edited: resent, and moved, grouped under the new topic", () => {
    const next = set(u("u1", "Alpha holds."), u("u2", "Beta holds firmly.", "C"));
    const l = lineage({ state: "unchanged", from: "u1", to: "u1" }, { state: "changed", from: "u2", to: "u2", moved: true }, { state: "removed", from: "u3" });
    const plan = cardsPlan(input([card("b", ["u2"])], { next, lineage: l }));
    expect(plan.cards[0]).toMatchObject({ action: "resend", moveTo: "C" });
    expect(plan.resend).toEqual([{ topic: "C", cards: ["b"] }]);
  });

  it("removed: all cited → removal proposed (also for an edited card); some → re-checked and flagged", () => {
    const l = lineage({ state: "unchanged", from: "u1", to: "u1" }, { state: "removed", from: "u2" }, { state: "removed", from: "u3" });
    const next = set(u("u1", "Alpha holds."));
    const plan = cardsPlan(input([card("gone", ["u2", "u3"], { edited: true }), card("part", ["u1", "u2"])], { next, lineage: l }));
    expect(plan.cards[0]).toMatchObject({ action: "remove", removed: ["u2", "u3"], cites: [] });
    expect(plan.cards[0]!.moveTo).toBeUndefined();
    expect(plan.cards[1]).toMatchObject({ action: "recheck", cites: ["u1"], removed: ["u2"] });
    expect(plan.cards[1]!.flags).toEqual([{ code: "source_changed", unit: "u2", card: "part", detail: "a passage this card cites was removed from the source", evidence: { source: "Beta holds." } }]);
  });

  it("a cited unit the lineage doesn't mention is treated as removed, never as unchanged", () => {
    const plan = cardsPlan(input([card("a", ["u1", "u2"])], { lineage: lineage({ state: "unchanged", from: "u1", to: "u1" }) }));
    expect(plan.cards[0]).toMatchObject({ action: "recheck", removed: ["u2"] });
  });

  it("ambiguous: Needs review, never rewritten, even when another cited unit changed", () => {
    const next = set(u("u1", "Alpha holds."), u("u2", "Beta holds firmly."), u("u9", "Gamma holds."));
    const l = lineage({ state: "unchanged", from: "u1", to: "u1" }, { state: "changed", from: "u2", to: "u2" }, { state: "ambiguous", to: "u9", candidates: ["u3", "u1"] });
    const plan = cardsPlan(input([card("x", ["u2", "u3"])], { next, lineage: l }));
    expect(plan.cards[0]).toMatchObject({ action: "review", ambiguous: [{ unit: "u3", now: "u9", candidates: ["u3", "u1"] }], cites: ["u2", "u3"] });
    expect(plan.cards[0]!.flags.map((f) => f.code)).toEqual(["source_ambiguous"]);
    expect(plan.resend).toEqual([]);
    expect(plan.ambiguousUnits).toEqual(["u9"]);
  });

  it("an opted-out card is skipped whatever its units did", () => {
    expect(cardsPlan(input([card("x", ["u2"], { excluded: true })])).cards[0]!.action).toBe("skip");
  });

  it("new content: added units, and changed units no card cites, per topic in document order", () => {
    expect(cardsPlan(input([card("a", ["u1"])])).newContent).toEqual([{ topic: "A", units: ["u2", "u4"] }]);
    expect(cardsPlan(input([card("b", ["u2"])])).newContent).toEqual([{ topic: "A", units: ["u4"] }]);
  });
});

describe("reviewAfterUpdate (WP3.3)", () => {
  const resolved = { reasons: ["qualifier dropped"], resolved: "kept" as const };
  const flag = { code: "qualifier_dropped" as const, detail: "qualifier dropped" };

  it("a resolved flag stays resolved while the cited units are unchanged, even when the checker raises it again", () => {
    expect(reviewAfterUpdate(resolved, { action: "keep", flags: [] }, [flag])).toBe(resolved);
  });

  it("an open flag on a kept card collects the checker's new reasons once", () => {
    expect(reviewAfterUpdate({ reasons: ["qualifier dropped"] }, { action: "keep", flags: [] }, [flag, { code: "absolute_added", detail: "absolute added" }])).toEqual({ reasons: ["qualifier dropped", "absolute added"] });
    expect(reviewAfterUpdate(undefined, { action: "keep", flags: [] })).toBeUndefined();
  });

  it("a changed unit reopens: the resolution goes, the new reasons stand", () => {
    expect(reviewAfterUpdate(resolved, { action: "resend", flags: [] }, [flag])).toEqual({ reasons: ["qualifier dropped"] });
    expect(reviewAfterUpdate(resolved, { action: "resend", flags: [] })).toBeUndefined();
    const changed = { code: "source_changed" as const, detail: "a passage this card cites was removed from the source" };
    expect(reviewAfterUpdate(resolved, { action: "recheck", flags: [changed] })).toEqual({ reasons: [changed.detail] });
  });

  it("skipped and section-path cards keep their review as it was", () => {
    expect(reviewAfterUpdate(resolved, { action: "skip", flags: [] }, [flag])).toBe(resolved);
    expect(reviewAfterUpdate(resolved, { action: "section", flags: [] })).toBe(resolved);
  });
});

describe("the card-level resend (WP3.1)", () => {
  const plan = cardsPlan(input([card("a", ["u1"]), card("b", ["u1", "u2"]), card("c", ["u2"])]));
  const texts: Record<string, { title: string; body: string }> = { b: { title: "Beta holds", body: "Alpha and beta hold." } };

  it("sends each resent card with its text, its unchanged passages and its changes, under local ids, never unit ids", () => {
    const req = cardResendInput("A", plan.cards, NEXT, (id) => texts[id] ?? null);
    expect(req).toEqual({
      rule: CARD_RESEND_RULE,
      topic: "A",
      cards: [{ id: "c1", title: "Beta holds", body: "Alpha and beta hold.", unchanged: ["Alpha holds."], changes: [{ before: "Beta holds.", after: "Beta holds firmly." }] }],
      objectOf: { c1: "b" },
    });
    const { objectOf: _, ...sent } = req;
    expect(JSON.stringify(sent)).not.toMatch(/\bu\d+\b/);
  });

  it("reads the reply leniently: unchanged, rewritten, or missing (never rewritten blind)", () => {
    const objectOf = { c1: "a", c2: "b", c3: "c", c4: "d" };
    const reply = { cards: [{ id: "c1", unchanged: true }, { id: "c2", title: " New title ", body: "New body." }, { id: "c3", title: "" }, "junk", { id: "c1", title: "dup", body: "ignored" }] };
    expect(readCardResendReply(reply, { objectOf })).toEqual({
      a: { kind: "unchanged" },
      b: { kind: "rewritten", title: "New title", body: "New body." },
      c: { kind: "missing", problem: "card c3 is neither unchanged nor a title and body" },
      d: { kind: "missing", problem: "no answer for card c4" },
    });
    expect(readCardResendReply("not json", { objectOf: { c1: "a" } })).toEqual({ a: { kind: "missing", problem: "no answer for card c1" } });
  });
});
