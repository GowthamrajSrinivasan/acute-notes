import { describe, expect, it } from "vitest";
import { parseContent } from "@/ai/content/parser";
import { analysisUnits, headingOnlyReply, MAX_UNIT_CHARS, normalizeUnitText } from "./units";

async function units(input: string) {
  return analysisUnits(await parseContent(input), input);
}

const TEN = `# Checkout\n\nIntro paragraph.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nBody of part ${i}.`).join("\n\n")}`;

describe("headingOnlyReply", () => {
  const unit = (text: string) => ({ key: "k", text, span: { start: 0, end: text.length } });

  it("answers a unit of only headings locally, as one heading node each", () => {
    expect(headingOnlyReply(unit("# Database migration plan"), "action_plan")).toEqual({
      version: 1,
      template: "action_plan",
      nodes: [{ id: "h1", type: "heading", stableKey: "heading#0", content: { text: "Database migration plan" } }],
      relationships: [],
    });
  });

  it("is null for any unit with body text", () => {
    expect(headingOnlyReply(unit("# Title\n\nIntro paragraph."), "flow")).toBeNull();
    expect(headingOnlyReply(unit("Just prose."), "flow")).toBeNull();
  });
});

describe("analysisUnits", () => {
  it("a titled document of ten sections gives the title's own content plus one unit per section", async () => {
    const u = await units(TEN);
    expect(u.map((x) => x.key)).toEqual(["Checkout", ...Array.from({ length: 10 }, (_, i) => `Checkout › Part ${i}`)]);
    expect(u[0]!.text).toBe("# Checkout\n\nIntro paragraph.");
    expect(u[3]!.text).toBe("## Part 2\n\nBody of part 2.");
  });

  it("splits only one level down: a subsection keeps its own sub-headings inside its unit", async () => {
    const u = await units("## A\n\nText\n\n### A1\n\nDeep\n\n#### A1a\n\nDeeper\n\n## B\n\nMore");
    expect(u.map((x) => x.key)).toEqual(["A", "A › A1", "B"]);
    expect(u[1]!.text).toContain("#### A1a");
  });

  it("names content before the first heading \"(lead)\", and numbers repeated headings", async () => {
    const u = await units("Lead in.\n\n## Notes\n\nOne\n\n## Notes\n\nTwo");
    expect(u.map((x) => x.key)).toEqual(["(lead)", "Notes", "Notes #2"]);
  });

  it("keys don't depend on body wording, only on heading paths", async () => {
    const a = await units(TEN);
    const b = await units(TEN.replace("Body of part 4.", "Completely different words here."));
    expect(b.map((x) => x.key)).toEqual(a.map((x) => x.key));
  });

  it("splits an oversized unit into numbered parts at blank lines", async () => {
    const para = "word ".repeat(1_000).trim(); // ~5k chars
    const u = await units(`## Big\n\n${[para, para, para, para].join("\n\n")}`);
    expect(u.length).toBeGreaterThan(1);
    expect(u.every((x) => x.text.length <= MAX_UNIT_CHARS)).toBe(true);
    expect(u[0]!.key).toBe("Big ·1");
  });

  it("plain unheaded text is one unit", async () => {
    expect((await units("Just some prose.\n\nAnd more.")).map((x) => x.key)).toEqual(["(lead)"]);
  });
});

describe("normalizeUnitText", () => {
  it("ignores trailing spaces and blank-line runs, nothing else", () => {
    expect(normalizeUnitText("a  \n\n\n\nb\n")).toBe(normalizeUnitText("a\n\nb"));
    expect(normalizeUnitText("a b")).not.toBe(normalizeUnitText("a  b"));
  });
});
