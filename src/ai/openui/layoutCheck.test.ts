/**
 * The layout check (note-taking-modes plan Step 4): deterministic, no model call. Errors refuse a layout; notes go to the
 * review. D3: the check is structural, and its wording never claims a layout is faithful.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RichContent } from "@/domain/types";
import { cardLangOf } from "./cardLang";
import { cardRenderPlan, layoutFor } from "./cardLayout";
import { checkLayout, checkLayoutStructure, LAYOUT_LIMITS, layoutReviewLines } from "./layoutCheck";

const p = (text: string) => ({ type: "paragraph" as const, content: text });
const CARD = { title: "Retry policy", snapshot: [p("Retry policy"), p("Retries happen 5 times, then the job gives up after 30 seconds.")] as RichContent };
const PASSAGES = new Map([
  ["u1", "The worker retries a failed job 5 times."],
  ["u2", "After 30 seconds without progress the job is abandoned and logged at level 2."],
]);
const GOOD = [`root = IdeaCard("Retry policy", "Retries happen 5 times, then the job gives up.", "high", [c1, c2])`, `c1 = CitationChip("u1")`, `c2 = CitationChip("u2", "Source 2")`].join("\n");
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe("layout check: accepted layouts", () => {
  it("a card in the card's own words, citing passages it may cite: ok, no notes", () => {
    const r = checkLayout({ lang: GOOD, card: CARD, passages: PASSAGES });
    expect(r).toMatchObject({ ok: true, errors: [], notes: [], cites: ["u1", "u2"] });
    expect(r.stats).toMatchObject({ statements: 3, components: 3 });
  });

  it("every library layout is accepted when static: timeline, flow, decision, comparison", () => {
    const card = { title: "Release", snapshot: [p("Build then deploy. Monday build, Tuesday deploy. Postgres or MySQL; we chose Postgres. Cost 10 vs 12.")] as RichContent };
    for (const lang of [
      `root = Timeline("Release", [e1, e2])\ne1 = TimelineEvent("Monday", "Build")\ne2 = TimelineEvent("Tuesday", "Deploy")`,
      `root = FlowDiagram("Release", ["Build", "Deploy"])`,
      `root = DecisionCard("Postgres or MySQL", [o1, o2], "Postgres")\no1 = DecisionOption("Postgres")\no2 = DecisionOption("MySQL")`,
      `root = ComparisonTable(["", "Postgres", "MySQL"], [["Cost", "10", "12"]])`,
    ]) {
      expect(checkLayout({ lang, card }), lang).toMatchObject({ ok: true });
    }
  });

  it("the derived card of any text passes the structure check, and so does a real distilled fixture", () => {
    expect(checkLayoutStructure(cardLangOf(CARD, { cites: ["u1"] })!).ok).toBe(true);
    const fixture = readFileSync(join(__dirname, "__fixtures__", "kn-02-edge-cache-invalidation.openui.txt"), "utf8");
    // A fixture holds several cards; each `root = …` block is one card's Lang.
    const cards = fixture.split(/\n(?=root = )/).filter((c) => c.startsWith("root = "));
    expect(cards.length).toBeGreaterThan(0);
    for (const lang of cards) expect(checkLayoutStructure(lang).errors, lang.slice(0, 60)).toEqual([]);
  });

  it("chip captions aren't claims: a number in a CitationChip label isn't compared with the text", () => {
    const r = checkLayout({ lang: GOOD.replace(`"Source 2"`, `"Source 7"`), card: CARD, passages: PASSAGES });
    expect(r.ok).toBe(true);
  });
});

describe("layout check: refused layouts", () => {
  it("empty, or over the size limits", () => {
    expect(codes(checkLayout({ lang: "  " }))).toEqual(["empty"]);
    expect(codes(checkLayout({ lang: "x".repeat(LAYOUT_LIMITS.chars + 1) }))).toEqual(["too-large"]);
    const many = [`root = IdeaCard("Retry policy", "Retries.", null, [${Array.from({ length: 130 }, (_, i) => `c${i}`).join(", ")}])`, ...Array.from({ length: 130 }, (_, i) => `c${i} = CitationChip("u1")`)].join("\n");
    expect(codes(checkLayoutStructure(many))).toContain("too-large");
  });

  it("anything that isn't a card component: queries, mutations, actions, builtins, state", () => {
    for (const lang of [
      `root = IdeaCard("Retry policy", "x")\nq = Query("list_users", {})`,
      `root = IdeaCard("Retry policy", "x")\nm = Mutation("delete_all", {})`,
      `root = IdeaCard("Retry policy", Action([OpenUrl("https://example.com")]))`,
      `root = IdeaCard("Retry policy", "x")\n$open = true`,
      `root = Script("alert(1)")`,
      `root = IdeaCard("Retry policy", Each([1, 2], "x"))`,
    ]) {
      const r = checkLayoutStructure(lang);
      expect(r.ok, lang).toBe(false);
      expect(codes(r), lang).toContain("not-static");
    }
  });

  it("words that look like calls inside a quoted string are fine", () => {
    const r = checkLayout({ lang: `root = IdeaCard("Retry policy", "Retries (5 times) Query(x) Run(y) $z")`, card: { title: "Retry policy", snapshot: [p("Retries (5 times) Query(x) Run(y) $z")] }, passages: PASSAGES });
    expect(r.errors).toEqual([]);
  });

  it("parse problems: unknown component, a missing required prop, an undefined reference", () => {
    expect(codes(checkLayoutStructure(`root = IdeaCard("Only a title")`))).toContain("parse");
    expect(codes(checkLayoutStructure(`root = IdeaCard("Retry policy", "x", null, [c9])`))).toContain("parse");
    expect(checkLayoutStructure(`root = IdeaCard("Retry policy", "x", null, [c9])`).errors.some((e) => e.subject === "c9")).toBe(true);
  });

  it("a citation the card may not cite: an unknown passage, or any passage when the card has no source", () => {
    const invented = GOOD.replace(`CitationChip("u2"`, `CitationChip("u99"`);
    expect(checkLayout({ lang: invented, card: CARD, passages: PASSAGES }).errors).toEqual([expect.objectContaining({ code: "unknown-citation", subject: "u99" })]);
    expect(codes(checkLayout({ lang: GOOD, card: CARD }))).toEqual(["citation-without-source", "citation-without-source"]);
    // Citations in other components count too.
    expect(codes(checkLayout({ lang: `root = DecisionCard("Retry policy", [o1], null, null, ["u42"])\no1 = DecisionOption("Retry")`, card: CARD, passages: PASSAGES }))).toContain("unknown-citation");
  });

  it("a number neither the card's text nor a cited passage has", () => {
    const r = checkLayout({ lang: GOOD.replace("5 times", "7 times"), card: CARD, passages: PASSAGES });
    expect(r.errors).toEqual([expect.objectContaining({ code: "number-not-in-text", subject: "7" })]);
    // "2" is only in passage u2: fine while u2 is cited, refused once it isn't.
    const level = `root = IdeaCard("Retry policy", "Abandoned jobs are logged at level 2.", null, [c1])\nc1 = CitationChip("u2")`;
    expect(checkLayout({ lang: level, card: CARD, passages: PASSAGES }).ok).toBe(true);
    expect(codes(checkLayout({ lang: level.replace(`"u2"`, `"u1"`), card: CARD, passages: PASSAGES }))).toEqual(["number-not-in-text"]);
  });

  it("a NoteLink to an object that isn't on the canvas (when the caller says which are)", () => {
    const lang = `root = IdeaCard("Retry policy", "Retries happen 5 times.", null, null, null, [l1])\nl1 = NoteLink("el_missing")`;
    expect(codes(checkLayout({ lang, card: CARD, objects: new Set(["el_1"]) }))).toEqual(["unknown-note-link"]);
    expect(checkLayout({ lang, card: CARD }).ok).toBe(true);
  });
});

describe("layout check: notes (shown in review, never refusing)", () => {
  it("a phrase mostly in words the card doesn't use", () => {
    const r = checkLayout({ lang: `root = IdeaCard("Retry policy", "Quantum entanglement accelerates blockchain synergy.")`, card: CARD });
    expect(r.ok).toBe(true);
    expect(r.notes).toEqual([expect.objectContaining({ code: "words-not-in-text" })]);
  });

  it("statements nothing draws", () => {
    const r = checkLayoutStructure(`root = IdeaCard("Retry policy", "x")\nstray = Callout("info", "unused")`);
    expect(r.ok).toBe(true);
    expect(r.notes.map((n) => n.code)).toEqual(["unused-statements"]);
  });
});

describe("D3 wording", () => {
  const BANNED = /\b(verified|verify|faithful|faithfully|accurate|accurately|correct|correctly|confirmed|confirms|guarantee)\b/i;
  it("the review lines never claim a layout is right, whatever the outcome", () => {
    const results = [
      checkLayout({ lang: GOOD, card: CARD, passages: PASSAGES }),
      checkLayout({ lang: GOOD, card: CARD }),
      checkLayout({ lang: `root = IdeaCard("Retry policy", "Quantum entanglement accelerates blockchain synergy.")`, card: CARD }),
      checkLayoutStructure(`root = Script("x")`),
      checkLayout({ lang: "" }),
    ];
    for (const r of results) for (const line of layoutReviewLines(r)) expect(line).not.toMatch(BANNED);
    expect(layoutReviewLines(results[0]!)[0]).toMatch(/doesn't compare meaning/);
  });
});

describe("drawing a stored layout", () => {
  it("a stored layout that fails the structure check is never drawn: the derived card is", () => {
    const bad = `root = IdeaCard("Retry policy", "x")\nq = Query("list_users", {})`;
    const plan = cardRenderPlan({ ...CARD, layout: layoutFor(CARD, bad) }, { noteMode: "manual", drawable: (l) => checkLayoutStructure(l).ok })!;
    expect(plan.langs).not.toContain(bad);
    expect(plan.langs[0]).toMatch(/^root = IdeaCard\("Retry policy"/);
  });

  it("a small number written as a word in the text may be shown as a digit; others still refused; each reported once (live run 2026-11-24)", () => {
    const onboarding = { title: "Onboarding", snapshot: [p("Onboarding"), p("On day one they get a laptop. By the end of month one they own a feature; the third week is for pairing.")] as RichContent };
    const timeline = `root = Timeline("Onboarding", [e1, e2, e3])
e1 = TimelineEvent("Day 1", "Laptop")
e2 = TimelineEvent("Month 1", "Own a feature")
e3 = TimelineEvent("Week 3", "Pairing")`;
    expect(checkLayout({ lang: timeline, card: onboarding }).errors).toEqual([]);
    const wrong = timeline.replace(`"Week 3"`, `"Week 7"`).replace(`"Month 1"`, `"Month 7"`);
    expect(checkLayout({ lang: wrong, card: onboarding }).errors).toEqual([expect.objectContaining({ code: "number-not-in-text", subject: "7" })]);
  });
});
