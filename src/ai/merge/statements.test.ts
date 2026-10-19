import { describe, expect, it } from "vitest";
import { statementsOf } from "./statements";

describe("statementsOf", () => {
  it("cuts prose into sentences with stable ids, joining wrapped lines", () => {
    const text = "## Pricing\n\nThe Free plan includes 10 AI actions per month. The Pro plan costs 12 dollars\nper month and includes 200 AI actions. Annual billing gives two months free.";
    expect(statementsOf(text, "t1")).toEqual([
      { id: "t1.s0", text: "The Free plan includes 10 AI actions per month." },
      { id: "t1.s1", text: "The Pro plan costs 12 dollars per month and includes 200 AI actions." },
      { id: "t1.s2", text: "Annual billing gives two months free." },
    ]);
  });

  it("makes a list item, a checklist item and a table row one statement each, and skips headings, rules, callouts and code", () => {
    const text = [
      "# Title",
      "- Free plan: 10 actions",
      "* [x] Pro plan: 12 dollars. Billed monthly.",
      "1. Annual billing",
      "",
      "| Plan | Price |",
      "| --- | --- |",
      "| Pro | 12 |",
      "",
      "> [!choice] Which is current?",
      "> - option",
      "",
      "```ts",
      "const price = 12.",
      "",
      "const x = 1",
      "```",
      "Last sentence.",
    ].join("\n");
    expect(statementsOf(text, "p1").map((s) => s.text)).toEqual([
      "Free plan: 10 actions",
      "Pro plan: 12 dollars. Billed monthly.",
      "Annual billing",
      "| Plan | Price |",
      "| Pro | 12 |",
      "Last sentence.",
    ]);
  });

  it("does not split on a number or an abbreviation's dot inside a sentence, and gives the same ids every time", () => {
    const text = "Version 2.1 ships in March, e.g. for the team. It costs 12.50 dollars.";
    const a = statementsOf(text, "t2");
    expect(a.map((s) => s.text)).toEqual(["Version 2.1 ships in March, e.g. for the team.", "It costs 12.50 dollars."]);
    expect(statementsOf(text, "t2")).toEqual(a);
  });

  it("gives nothing for text with no statements", () => {
    expect(statementsOf("## Heading only\n\n", "t1")).toEqual([]);
  });
});
