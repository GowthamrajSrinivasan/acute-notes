import { describe, expect, it } from "vitest";
import type { VisualNode } from "@/ai/visual-plan/types";
import { HEADING_FONT_SIZE } from "./measure";
import { mapNode, markdownCell } from "./mapNode";
import type { Box } from "./types";

const box: Box = { x: 10, y: 20, width: 300, height: 150 };
const md = (s: string) => [{ type: "paragraph" as const, content: `parsed:${s}` }];

describe("mapNode", () => {
  it("heading → a frameless text block sized as a title (PRD: 'simple canvas text')", () => {
    const change = mapNode({ id: "n1", type: "heading", content: { text: "Section" } }, box, md);
    expect(change).toEqual({
      kind: "create_block",
      key: "n1",
      blockType: "text",
      frame: "none",
      fontSize: HEADING_FONT_SIZE,
      content: [{ type: "paragraph", content: "Section" }],
      box,
    });
  });

  it("text → a bordered text block, its Markdown parsed and an optional title prepended", () => {
    const withoutTitle = mapNode({ id: "n2", type: "text", content: { markdown: "Body" } }, box, md);
    expect(withoutTitle).toEqual({ kind: "create_block", key: "n2", blockType: "text", content: [{ type: "paragraph", content: "parsed:Body" }], box });

    const withTitle = mapNode({ id: "n2", type: "text", title: "Notes", content: { markdown: "Body" } }, box, md);
    if (withTitle.kind !== "create_block") throw new Error("expected create_block");
    expect(withTitle.content[0]).toEqual({ type: "heading", props: { level: 3 }, content: "Notes" });
  });

  it("todo → checklist items in order, each keeping its own checked state", () => {
    const change = mapNode(
      { id: "n3", type: "todo", title: "Tasks", content: { items: [{ text: "a", checked: true }, { text: "b", checked: false }] } },
      box,
      md,
    );
    expect(change).toMatchObject({
      kind: "create_block",
      blockType: "todo",
      content: [
        { type: "heading", props: { level: 3 }, content: "Tasks" },
        { type: "checkListItem", props: { checked: true }, content: "a" },
        { type: "checkListItem", props: { checked: false }, content: "b" },
      ],
    });
  });

  it("table → columns as the header row, then each row, cells as plain strings", () => {
    const change = mapNode({ id: "n4", type: "table", content: { columns: ["A", "B"], rows: [["1", "2"], ["3", "4"]] } }, box, md);
    expect(change).toMatchObject({
      kind: "create_block",
      blockType: "table",
      content: [{ type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: ["A", "B"] }, { cells: ["1", "2"] }, { cells: ["3", "4"] }] } }],
    });
  });

  it("code → a code block with a language the editor actually supports, never whatever string the plan gave", () => {
    const known = mapNode({ id: "n5", type: "code", content: { language: "TypeScript", source: "x" } }, box, md);
    expect(known).toMatchObject({ content: [{ type: "codeBlock", props: { language: "typescript" }, content: "x" }] });
    const alias = mapNode({ id: "n5", type: "code", content: { language: "ts", source: "x" } }, box, md);
    expect(alias).toMatchObject({ content: [{ type: "codeBlock", props: { language: "typescript" } }] });
    const unknown = mapNode({ id: "n5", type: "code", content: { language: "cobol", source: "x" } }, box, md);
    expect(unknown).toMatchObject({ content: [{ type: "codeBlock", props: { language: "" } }] }); // never crashes the editor's language picker
    const none = mapNode({ id: "n5", type: "code", content: { source: "x" } }, box, md);
    expect(none).toMatchObject({ content: [{ type: "codeBlock", props: { language: "" } }] });
  });

  it("page → create_page, its Markdown parsed like a text node's", () => {
    const change = mapNode({ id: "n6", type: "page", content: { title: "Runbook", markdown: "Steps" } }, box, md);
    expect(change).toEqual({ kind: "create_page", key: "n6", title: "Runbook", content: [{ type: "paragraph", content: "parsed:Steps" }], box });
  });

  it("shape → create_shape, carrying its shape kind and label", () => {
    const change = mapNode({ id: "n7", type: "shape", content: { shape: "diamond", label: "Decision" } }, box, md);
    expect(change).toEqual({ kind: "create_shape", key: "n7", shape: "diamond", label: "Decision", box });
  });

  it("image → throws (no template allows one to reach here; see the note in mapNode.ts)", () => {
    expect(() => mapNode({ id: "n8", type: "image", content: { assetRef: "a1" } } as VisualNode, box, md)).toThrow(/image/);
  });

  it("every mapped change carries the node's own box unchanged", () => {
    const changes = [
      mapNode({ id: "n", type: "heading", content: { text: "x" } }, box, md),
      mapNode({ id: "n", type: "shape", content: { shape: "rectangle", label: "x" } }, box, md),
      mapNode({ id: "n", type: "page", content: { title: "x", markdown: "x" } }, box, md),
    ];
    for (const c of changes) expect(c.box).toBe(box);
  });
});

describe("markdownCell", () => {
  it("shows a cell's inline Markdown as styles, and leaves a plain cell a string", () => {
    expect(markdownCell("Rejected")).toBe("Rejected");
    expect(markdownCell("calling `OILRATRC` **at surface** [deck](https://x.y)")).toEqual([
      { type: "text", text: "calling ", styles: {} },
      { type: "text", text: "OILRATRC", styles: { code: true } },
      { type: "text", text: " ", styles: {} },
      { type: "text", text: "at surface", styles: { bold: true } },
      { type: "text", text: " ", styles: {} },
      { type: "link", href: "https://x.y", content: [{ type: "text", text: "deck", styles: {} }] },
    ]);
  });
});
