import { describe, expect, it } from "vitest";
import type { RichContent, TableCell } from "@/domain/types";
import { assessDensity, DENSE_CELL_CHARS, DENSE_TABLE_CHARS, DENSE_TEXT_CHARS } from "./density";

const table = (rows: TableCell[][]): RichContent => [{ type: "table", content: { type: "tableContent", rows: rows.map((cells) => ({ cells })) } }];
const text = (...paragraphs: string[]): RichContent => paragraphs.map((p) => ({ type: "paragraph" as const, content: p }));
/** Exactly `n` characters of prose (ending in a full stop, so trimming keeps them all). */
const words = (n: number) => `${"word ".repeat(Math.ceil(n / 5)).slice(0, n - 1)}.`;

describe("assessDensity", () => {
  it("a table of short values reads well", () => {
    expect(assessDensity("table", table([["Order", "Item", "Size"], ["1", "Levels for Repo Map", "M"]]))).toBeNull();
  });

  it("a table cell that is a paragraph is dense, named by its length", () => {
    const cell = words(1_840);
    expect(assessDensity("table", table([["Order", "Item"], ["1", cell]]))).toEqual({
      cause: "long_cell",
      chars: 1_840,
      limit: DENSE_CELL_CHARS,
      reason: "A table cell holds 1,840 characters",
    });
    // Cells in BlockNote's own shapes count the same.
    expect(assessDensity("table", table([["1", { type: "tableCell", content: [{ type: "text", text: cell, styles: {} }] }]]))?.cause).toBe("long_cell");
  });

  it("a table of many medium cells is dense by its total", () => {
    const rows = Array.from({ length: 12 }, (_, i) => [`${i}`, words(200)]);
    const finding = assessDensity("table", table(rows));
    expect(finding).toMatchObject({ cause: "long_table", limit: DENSE_TABLE_CHARS });
    expect(finding!.chars).toBeGreaterThan(DENSE_TABLE_CHARS);
  });

  it("a checklist item that is a paragraph is dense; a long list of short items is not", () => {
    const todo = (items: string[]): RichContent => items.map((t) => ({ type: "checkListItem" as const, props: { checked: false }, content: t }));
    expect(assessDensity("todo", todo([words(420)]))?.reason).toBe("A checklist item holds 420 characters");
    expect(assessDensity("todo", todo(Array.from({ length: 60 }, () => words(40))))).toBeNull();
  });

  it("a text block is dense past the text limit; its title heading and nested content count", () => {
    expect(assessDensity("text", text(words(DENSE_TEXT_CHARS - 100)))).toBeNull();
    const finding = assessDensity("text", [{ type: "heading", props: { level: 3 }, content: "Notes" }, ...text(words(800)), { type: "bulletListItem", content: "x", children: text(words(600)) }]);
    expect(finding?.cause).toBe("long_text");
  });

  it("a table inside a text block is judged as a table; the prose around it only as prose", () => {
    const content = [...text("Intro."), ...table([["a", words(500)]])];
    expect(assessDensity("text", content)?.cause).toBe("long_cell");
    expect(assessDensity("text", [...text("Intro."), ...table([["a", words(250)], ["b", words(250)]])])).toBeNull();
  });

  it("code is never dense", () => {
    expect(assessDensity("code", text(words(10_000)))).toBeNull();
  });
});
