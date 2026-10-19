import { describe, expect, it } from "vitest";
import type { RichContent } from "../types";
import { deriveTitle, inlineText, isEmptyContent, pageExcerpt, templateFor, toPlainText } from "./richContent";

const doc: RichContent = [
  { type: "heading", props: { level: 1 }, content: [{ type: "text", text: "Problem Summary", styles: {} }] },
  {
    type: "paragraph",
    content: [
      { type: "text", text: "The mean is compared with ", styles: {} },
      { type: "text", text: "summary.mean", styles: { code: true } },
    ],
  },
  {
    type: "numberedListItem",
    content: "First issue",
    children: [{ type: "bulletListItem", content: [{ type: "link", href: "https://x", content: [{ type: "text", text: "nested", styles: {} }] }] }],
  },
  {
    type: "table",
    content: {
      type: "tableContent",
      rows: [
        { cells: ["ID", [{ type: "text", text: "Status", styles: {} }]] },
        { cells: [{ type: "tableCell", content: [{ type: "text", text: "B1", styles: {} }] }, "Open"] },
      ],
    },
  },
];

describe("rich content helpers", () => {
  it("extracts plain text across inline, nested and table content", () => {
    expect(toPlainText(doc)).toBe(
      ["Problem Summary", "The mean is compared with summary.mean", "First issue", "  nested", "ID\tStatus", "B1\tOpen"].join("\n"),
    );
  });

  it("derives a title from the first heading or first line", () => {
    expect(deriveTitle(doc)).toBe("Problem Summary");
    expect(deriveTitle([{ type: "paragraph", content: "Just text" }])).toBe("Just text");
    expect(deriveTitle([], "Untitled block")).toBe("Untitled block");
  });

  it("treats templates as empty except structural blocks", () => {
    expect(isEmptyContent(templateFor("text"))).toBe(true);
    expect(isEmptyContent(templateFor("todo"))).toBe(true);
    expect(isEmptyContent(templateFor("table"))).toBe(false);
    expect(isEmptyContent(templateFor("code"))).toBe(false);
    expect(inlineText(undefined)).toBe("");
  });

  it("treats a divider as content and builds page excerpts", () => {
    expect(isEmptyContent([{ type: "divider" }])).toBe(false);
    expect(pageExcerpt(doc, 20)).toBe("Problem Summary The…");
    expect(pageExcerpt([{ type: "paragraph", content: "  short  text " }])).toBe("short text");
  });
});
