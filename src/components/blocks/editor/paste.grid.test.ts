import { describe, expect, it } from "vitest";
import { stripInlineStyle } from "@/domain/content/richContent";
import { gridToHtml, parseGrid } from "./paste";

describe("tab-separated paste", () => {
  it("reads rows and columns", () => {
    expect(parseGrid("a\tb\r\n1\t2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseGrid("a\tb\tc")).toEqual([["a", "b", "c"]]);
  });

  it("leaves text without tabs, and Markdown tables, alone", () => {
    expect(parseGrid("one\ntwo")).toBeNull();
    expect(parseGrid("| a\t| b |\n| 1\t| 2 |")).toBeNull();
  });

  it("becomes an escaped HTML table", () => {
    expect(gridToHtml([["<b>", "x & y"]])).toBe("<table><tbody><tr><td>&lt;b&gt;</td><td>x &amp; y</td></tr></tbody></table>");
  });
});

describe("item-level alignment", () => {
  it("resets table cells' own alignment", () => {
    const [table] = stripInlineStyle(
      [{ type: "table", content: { type: "tableContent", rows: [{ cells: [{ type: "tableCell", content: [], props: { textAlignment: "center" } }, "plain"] }] } }],
      "textAlignment",
    );
    expect(table!.content).toMatchObject({ rows: [{ cells: [{ props: { textAlignment: "left" } }, "plain"] }] });
  });
});
