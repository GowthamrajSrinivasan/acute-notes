// @vitest-environment happy-dom
/**
 * Flow cards' text ↔ FlowDiagram Lang (note-taking-modes plan Step 6): the card's Markdown, through the app's real Markdown
 * parser, reads back as the same steps and details; the Lang passes the structure check; text that isn't a flow is refused.
 */
import { describe, expect, it } from "vitest";
import { markdownToContent } from "@/components/blocks/editor/markdown";
import { flowLang, flowMarkdown, flowOfContent, isFlowLang } from "./flowLayout";
import { checkLayout, checkLayoutStructure } from "./layoutCheck";
import { cardContentHash, cardRenderPlan, layoutFor } from "./cardLayout";

const p = (text: string) => ({ type: "paragraph" as const, content: text });
const card = (markdown: string) => ({ title: "Untitled", snapshot: [{ type: "heading" as const, props: { level: 3 }, content: "Release" }, ...markdownToContent(markdown)] });

const STEPS = [
  { label: "Build", markdown: "CI builds and tests.\n\n- runs lint\n- runs 1,200 unit tests" },
  { label: "QA sign-off", markdown: "A QA engineer signs off within 2 days." },
  { label: "Deploy" },
];

describe("flow card text and Lang", () => {
  it("the Markdown reads back as the same steps, in order, with every detail (bullets included)", () => {
    const flow = flowOfContent(card(flowMarkdown(STEPS)));
    expect(flow).toEqual({
      title: "Release",
      steps: [
        { label: "Build", detail: "CI builds and tests. runs lint runs 1,200 unit tests" },
        { label: "QA sign-off", detail: "A QA engineer signs off within 2 days." },
        { label: "Deploy", detail: "" },
      ],
    });
  });

  it("the Lang is a FlowDiagram that passes the structure check and the text check (numbers in the text)", () => {
    const rec = card(flowMarkdown(STEPS));
    const lang = flowLang(flowOfContent(rec)!, ["u3"]);
    expect(isFlowLang(lang)).toBe(true);
    expect(lang).toBe(
      `root = FlowDiagram("Release", ["Build", "QA sign-off", "Deploy"], ["CI builds and tests. runs lint runs 1,200 unit tests", "A QA engineer signs off within 2 days.", ""], ["u3"])`,
    );
    expect(checkLayoutStructure(lang).ok).toBe(true);
    const check = checkLayout({ lang, card: rec, passages: new Map([["u3", "Release steps"]]) });
    expect(check.errors).toEqual([]);
  });

  it("no details and no citations: just the steps", () => {
    expect(flowLang({ title: "T", steps: [{ label: "A", detail: "" }, { label: "B", detail: "" }] })).toBe(`root = FlowDiagram("T", ["A", "B"])`);
  });

  it("text that isn't a flow is refused: no steps, one step, text before the steps, a table, no title", () => {
    expect(flowOfContent({ title: "T", snapshot: [p("Just prose.")] })).toBeNull();
    expect(flowOfContent(card("1. **Only one**"))).toBeNull();
    expect(flowOfContent(card("Intro first.\n\n1. A\n2. B"))).toBeNull();
    expect(flowOfContent({ title: "Untitled", snapshot: markdownToContent("1. A\n2. B") })).toBeNull();
    const table = { type: "table" as const, content: { type: "tableContent" as const, rows: [{ cells: ["a"] }] } };
    expect(flowOfContent({ title: "T", snapshot: [...markdownToContent("1. A\n2. B"), table as never] })).toBeNull();
  });

  it("a stale flow layout is redrawn from the card's text now, with no 'out of date' chip", () => {
    const before = card(flowMarkdown(STEPS));
    const layout = layoutFor(before, flowLang(flowOfContent(before)!));
    const after = card(flowMarkdown([...STEPS.slice(0, 2), { label: "Deploy to production" }]));
    expect(cardContentHash(after)).not.toBe(layout.contentHash);
    const plan = cardRenderPlan({ ...after, layout }, { noteMode: "manual", cites: ["u1"], drawable: (l) => checkLayoutStructure(l).ok })!;
    expect(plan.stale).toBe(false);
    expect(plan.langs[0]).toContain(`"Deploy to production"`);
    expect(plan.langs[0]).toContain(`["u1"]`);
  });

  it("a stale non-flow layout keeps the Step 3 behaviour (derived card + chip)", () => {
    const rec = { title: "Untitled", snapshot: [p("Retry policy"), p("Jobs retry 3 times.")] };
    const layout = layoutFor({ title: "Untitled", snapshot: [p("Retry policy"), p("Jobs retry 5 times.")] }, `root = IdeaCard("Retry policy", "Jobs retry 5 times.")`);
    const plan = cardRenderPlan({ ...rec, layout }, { noteMode: "manual", drawable: () => true })!;
    expect(plan.stale).toBe(true);
    expect(plan.langs[0]).toMatch(/^root = IdeaCard/);
  });

  it("a stale flow layout whose text is no longer a flow falls back to the derived card + chip", () => {
    const before = card(flowMarkdown(STEPS));
    const layout = layoutFor(before, flowLang(flowOfContent(before)!));
    const plan = cardRenderPlan({ title: "Untitled", snapshot: [p("Release"), p("Now just a paragraph.")], layout }, { noteMode: "manual", drawable: () => true })!;
    expect(plan.stale).toBe(true);
    expect(plan.langs[0]).toMatch(/^root = IdeaCard/);
  });
});
