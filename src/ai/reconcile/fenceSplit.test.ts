/**
 * Economy cards keep a block whole (audit finding 3, 2026-10-11): appended text was split on every blank line, so a fenced code block with a blank
 * line became two cards (its fences broken, a "---" rule of a folded page between them), the `# comment` lines inside it were dropped as if they
 * were headings, and a loose list became one card per item. Paragraphs are now split on blank lines outside fenced code only, and a loose list is
 * one card. Pure and mock only; no model, no network.
 */
import { describe, expect, it } from "vitest";
import type { AIRequest } from "@/ai/types";
import { foldOverflow } from "@/ai/visual-plan/repair";
import { templateFor } from "@/ai/visual-plan/templates";
import type { VisualNode } from "@/ai/visual-plan/types";
import { accepted, context, firstRun, parse, response, runtimeWith } from "@/testUtils/reconcileHarness";
import { mergeIntoSource, type MergeInput } from "@/ai/merge/merge";
import { appendedParagraphs, fenceMask, paragraphsOf } from "./paragraphs";
import { economyBlocks, economyCards } from "./plainCards";

const CODE = "```sh\n# install deps\nnpm ci\n\n# run the checks\nnpm test\n```";
const CODE_TWO = "~~~json\n{\n\n  \"a\": 1\n}\n~~~";
const TABLE = "| Plan | Limit |\n|---|---|\n| Free | 100 |\n| Team | 10000 |";
const LOOSE = ["- first item", "- second item", "- third item"];
const TIGHT = "- tight one\n- tight two";

describe("paragraphsOf: a fenced code block is never split", () => {
  it("keeps blank lines inside a fence, the fences themselves and a `#` comment line, in one paragraph", () => {
    expect(paragraphsOf(`Before.\n\n${CODE}\n\nAfter.`)).toEqual(["Before.", CODE, "After."]);
  });

  it("several code blocks: each stays whole, prose between them stays its own paragraph", () => {
    expect(paragraphsOf(`${CODE}\n\nBetween.\n\n${CODE_TWO}\n\n\n\nEnd.`)).toEqual([CODE, "Between.", CODE_TWO, "End."]);
  });

  it("a fence is closed only by the same kind of fence at least as long: a shorter or other kind inside is content; one that never closes runs to the end", () => {
    const nested = "````md\n```sh\nnpm ci\n\nnpm test\n```\n\n~~~\nstill inside\n````";
    expect(paragraphsOf(`Intro.\n\n${nested}\n\nOutro.`)).toEqual(["Intro.", nested, "Outro."]);
    expect(paragraphsOf("Intro.\n\n```sh\na\n\nb\n\nc")).toEqual(["Intro.", "```sh\na\n\nb\n\nc"]);
  });

  it("an indented fence (inside a list item) is a fence too", () => {
    const text = "- step one\n\n  ```sh\n  a\n\n  b\n  ```\n\n- step two";
    expect(paragraphsOf(text)).toEqual(["- step one", "```sh\n  a\n\n  b\n  ```", "- step two"]);
  });

  it("text without a fence splits exactly as before: on blank lines, blank lines with spaces included", () => {
    const old = (md: string) => md.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    for (const md of ["a\n\nb", "a\n  \nb\n\n\n\nc", "  lead\n\nmiddle line one\nmiddle line two\n\ntrail  \n", "", "\n\n", TABLE, `${LOOSE.join("\n\n")}\n\n${TIGHT}`, "# H\n\nx\n\n## H2\n\ny"]) expect(paragraphsOf(md), JSON.stringify(md)).toEqual(old(md));
  });

  it("fenceMask marks the fence lines and what is inside them", () => {
    expect(fenceMask(["a", "```", "b", "", "```", "c"])).toEqual([false, true, true, true, true, false]);
  });
});

describe("appendedParagraphs: code is not read as headings", () => {
  const before = "## A\n\nIntro sentence of the section.";

  it("a `# comment` line inside a fence is kept; a real heading outside one is still ignored", () => {
    const after = `${before}\n\n${CODE}\n\n### A real heading\n\nThen some closing prose.`;
    expect(appendedParagraphs(before, after)).toEqual([CODE, "Then some closing prose."]);
  });

  it("an earlier code block in the section is still recognised as the same paragraph", () => {
    const withCode = `${before}\n\n${CODE}`;
    expect(appendedParagraphs(withCode, `${withCode}\n\nAnd one more paragraph.`)).toEqual(["And one more paragraph."]);
  });
});

describe("economy cards: one card per block", () => {
  const blocks = (ps: string[]) => economyCards(ps).nodes.map((n) => n.content.markdown);

  it("ordinary paragraphs: one card each, in order, verbatim", () => {
    expect(blocks(["First paragraph.", "Second paragraph.", "Third."])).toEqual(["First paragraph.", "Second paragraph.", "Third."]);
  });

  it("a fenced code block with blank lines is one card, byte for byte, with both fences", () => {
    expect(blocks(paragraphsOf(`Run this:\n\n${CODE}\n\nThen:\n\n${CODE_TWO}`))).toEqual(["Run this:", CODE, "Then:", CODE_TWO]);
  });

  it("a table is one card", () => {
    expect(blocks(paragraphsOf(`Limits:\n\n${TABLE}`))).toEqual(["Limits:", TABLE]);
  });

  it("a loose list (blank lines between items) is one card, items separated as they were; a tight list was already one", () => {
    expect(blocks(paragraphsOf(`Intro.\n\n${LOOSE.join("\n\n")}\n\nOutro.\n\n${TIGHT}`))).toEqual(["Intro.", LOOSE.join("\n\n"), "Outro.", TIGHT]);
  });

  it("a bullet list and an ordered list next to each other stay two cards; a list never swallows the paragraph after it", () => {
    expect(economyBlocks(["- a", "- b", "1. one", "2. two", "A paragraph."])).toEqual(["- a\n\n- b", "1. one\n\n2. two", "A paragraph."]);
    expect(economyBlocks(["- [ ] todo", "- [x] done"])).toEqual(["- [ ] todo\n\n- [x] done"]);
  });

  it("no word is lost: the cards hold exactly the appended text, and keys are unique", () => {
    const text = `Intro.\n\n${CODE}\n\n${LOOSE.join("\n\n")}\n\n${TABLE}\n\n${CODE_TWO}\n\nYes.\n\nYes.`;
    const cards = economyCards(paragraphsOf(text));
    const squash = (s: string) => s.replace(/\s+/g, "");
    expect(squash(cards.nodes.map((n) => n.content.markdown).join(""))).toBe(squash(text));
    // Two identical paragraphs share a content key (later made unique with a suffix by `ensureStableKeys`); every other key is distinct.
    expect(new Set(cards.nodes.map((n) => n.stableKey)).size).toBe(cards.nodes.length - 1);
  });
});

describe("folded pages never put a separator inside a code fence", () => {
  const caps = { plan: 0, section: 0, sectionedPlan: 0 };
  const insideFence = (page: string) => {
    const lines = page.split("\n");
    const mask = fenceMask(lines);
    return lines.flatMap((l, i) => (l === "---" && mask[i] ? [i] : []));
  };
  const cardsAsNodes = (paragraphs: string[]): VisualNode[] => economyCards(paragraphs).nodes.map((n) => ({ ...n, stableKey: `Section A § ${n.stableKey}` }) as VisualNode);

  it("cards past the limit fold into a page: the rules sit between cards, every fence is balanced, and the code is intact", () => {
    const text = `Intro.\n\n${CODE}\n\n${LOOSE.join("\n\n")}\n\n${CODE_TWO}\n\n${TABLE}\n\nClosing.`;
    const folded = foldOverflow(cardsAsNodes(paragraphsOf(text)), templateFor("sectioned"), caps);
    const page = folded.nodes.filter((n) => n.type === "page").map((n) => (n as { content: { markdown: string } }).content.markdown).join("\n");
    expect(folded.details).toEqual([expect.objectContaining({ section: "Section A", pages: 1, why: "section limit" })]);
    expect(page).toContain(CODE);
    expect(page).toContain(CODE_TWO);
    expect(insideFence(page)).toEqual([]);
    // Fences are balanced: every fence that opens closes, so nothing after it is swallowed.
    const lines = page.split("\n");
    const mask = fenceMask(lines);
    expect(mask.filter((m, i) => m && /^\s*(```|~~~)/.test(lines[i]!)).length % 2).toBe(0);
  });

  it("the old split is what broke it: the same code cut at its blank line puts a rule inside the fence", () => {
    const broken = [CODE.slice(0, CODE.indexOf("\n\n")), CODE.slice(CODE.indexOf("\n\n") + 2)];
    const folded = foldOverflow(cardsAsNodes(broken), templateFor("sectioned"), caps);
    const page = (folded.nodes.find((n) => n.type === "page") as { content: { markdown: string } }).content.markdown;
    expect(insideFence(page)).not.toEqual([]);
  });
});

describe("an economy merge keeps a code block, a table and a loose list whole", () => {
  const PROSE = `Intro prose about the whole system and how it fits together in practice.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nThis part explains how the system handles case ${i}. It starts from the request, checks the permissions, and then decides what to do next based on the policy. Afterwards it records the outcome so that later steps can rely on it, and it reports any problems to the operator.`).join("\n\n")}`;
  const INCOMING = `## Extra notes\n\nQuotas are counted per workspace and reset at midnight UTC.\n\n${CODE}\n\n${TABLE}\n\n${LOOSE.join("\n\n")}\n`;

  it("the stored plan's cards are the blocks, and the diagnostics count cards, not paragraphs", async () => {
    const { runtime } = runtimeWith((req: AIRequest) => {
      if (req.task === "assign_to_topics") return response(JSON.stringify({ assignments: [{ part: "p1", topic: "t2" }] }));
      if (req.task === "outline_document") return response(JSON.stringify({ summary: "S", sections: Array.from({ length: 11 }, (_, i) => ({ id: `s${i + 1}`, label: i === 0 ? "Intro" : `Part ${i - 1}`, kind: "notes", parts: [`u${i + 1}`] })) }));
      if (req.task === "generate_section_analysis") return response(JSON.stringify({ takeaway: "T", nodes: [{ id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }] }));
      const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
      return response(JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: body.slice(0, 200) } }, { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: "A." } }], relationships: [], metadata: { takeaway: "T" } }));
    });
    const a = accepted(await firstRun(PROSE, runtime));
    const merged = await mergeIntoSource({ ...a, text: INCOMING, operationId: "op_m", title: "Merge", context, economy: true } as MergeInput, runtime, { parseMarkdown: parse });
    const plan = merged.changeSet!.contentSource!.plan as { nodes: { stableKey?: string; content: { markdown?: string } }[] };
    const cards = plan.nodes.filter((n) => (n.stableKey ?? "").includes("added#")).map((n) => n.content.markdown);
    expect(cards).toEqual(["Quotas are counted per workspace and reset at midnight UTC.", CODE, TABLE, LOOSE.join("\n\n")]);
    expect(merged.diagnostics.economy).toEqual([{ section: "Part 0", cards: 4 }]);
    expect(merged.diagnostics.removals).toEqual([]);
  });
});
