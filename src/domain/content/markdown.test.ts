import { describe, expect, it } from "vitest";
import type { RichContent } from "../types";
import { contentToMarkdown, pageToMarkdown } from "./markdown";

const t = (text: string, styles = {}) => ({ type: "text" as const, text, styles });

describe("contentToMarkdown", () => {
  it("serialises headings, paragraphs and inline styles", () => {
    const doc: RichContent = [
      { type: "heading", props: { level: 2 }, content: "Findings" },
      {
        type: "paragraph",
        content: [t("Use "), t("summary.mean", { code: true }), t(" and "), t("bold ", { bold: true }), t("text")],
      },
      { type: "paragraph", content: [{ type: "link", href: "https://example.com/a b", content: [t("a link")] }] },
    ];
    expect(contentToMarkdown(doc)).toBe(
      "## Findings\n\nUse `summary.mean` and **bold** text\n\n[a link](https://example.com/a%20b)\n",
    );
  });

  it("keeps list runs tight, numbers them and nests children", () => {
    const doc: RichContent = [
      { type: "numberedListItem", content: "One", children: [{ type: "bulletListItem", content: "Nested" }] },
      { type: "numberedListItem", content: "Two" },
      { type: "checkListItem", props: { checked: true }, content: "Done" },
      { type: "checkListItem", props: { checked: false }, content: "Todo" },
      { type: "paragraph", content: "After" },
    ];
    expect(contentToMarkdown(doc)).toBe("1. One\n   - Nested\n2. Two\n- [x] Done\n- [ ] Todo\n\nAfter\n");
  });

  it("fences code with its language and renders tables, quotes and dividers", () => {
    const doc: RichContent = [
      { type: "codeBlock", props: { language: "python" }, content: "x = 1\nprint(x)" },
      {
        type: "table",
        content: { type: "tableContent", headerRows: 1, rows: [{ cells: ["A", "B|C"] }, { cells: ["1", "2"] }] },
      },
      { type: "quote", content: "Quoted" },
      { type: "divider" },
    ];
    expect(contentToMarkdown(doc)).toBe(
      "```python\nx = 1\nprint(x)\n```\n\n| A | B\\|C |\n| --- | --- |\n| 1 | 2 |\n\n> Quoted\n\n---\n",
    );
  });

  it("escapes Markdown syntax in plain text", () => {
    expect(contentToMarkdown([{ type: "paragraph", content: "a *b* [c]" }])).toBe("a \\*b\\* \\[c\\]\n");
  });
});

describe("pageToMarkdown", () => {
  it("uses the title as the top heading", () => {
    expect(pageToMarkdown("Plan", [{ type: "paragraph", content: "Body" }])).toBe("# Plan\n\nBody\n");
    expect(pageToMarkdown("", [])).toBe("# Untitled\n");
  });
});
