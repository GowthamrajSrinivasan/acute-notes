import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { stripInlineStyle } from "@/domain/content/richContent";
import type { RichContent } from "@/domain/types";
import { stripYStyle } from "./inlineStyles";

describe("stripInlineStyle (snapshot)", () => {
  const doc: RichContent = [
    {
      type: "paragraph",
      props: { textAlignment: "center" },
      content: [
        { type: "text", text: "a", styles: { fontFamily: "nunito", bold: true } },
        { type: "link", href: "x", content: [{ type: "text", text: "b", styles: { fontFamily: "inter" } }] },
      ],
      children: [{ type: "paragraph", content: [{ type: "text", text: "c", styles: { fontFamily: "virgil" } }] }],
    },
    {
      type: "table",
      content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "d", styles: { fontFamily: "lilita" } }], "e"] }] },
    },
  ];

  it("removes the style everywhere and keeps other marks", () => {
    const out = JSON.stringify(stripInlineStyle(doc, "fontFamily"));
    expect(out).not.toContain("fontFamily");
    expect(out).toContain('"bold":true');
    expect(out).toContain('"textAlignment":"center"');
  });

  it("resets block alignment for textAlignment", () => {
    const out = stripInlineStyle(doc, "textAlignment");
    expect(out[0]?.props?.textAlignment).toBe("left");
    expect(JSON.stringify(out)).toContain("fontFamily");
  });
});

describe("stripYStyle (Yjs document)", () => {
  function makeDoc() {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("blocknote");
    const para = new Y.XmlElement("paragraph");
    para.setAttribute("textAlignment", "right");
    const text = new Y.XmlText();
    text.insert(0, "hello ", { fontFamily: { stringValue: "nunito" }, bold: {} });
    text.insert(6, "world", { bold: {} });
    para.insert(0, [text]);
    frag.insert(0, [para]);
    return { doc, frag, text, para };
  }

  it("removes a mark but keeps others", () => {
    const { frag, text } = makeDoc();
    expect(stripYStyle(frag, "fontFamily")).toBe(true);
    const delta = text.toDelta() as { attributes?: Record<string, unknown> }[];
    expect(delta.some((op) => op.attributes && "fontFamily" in op.attributes)).toBe(false);
    expect(delta.every((op) => op.attributes && "bold" in op.attributes)).toBe(true);
    expect(stripYStyle(frag, "fontFamily")).toBe(false);
  });

  it("resets alignment attributes", () => {
    const { frag, para } = makeDoc();
    expect(stripYStyle(frag, "textAlignment")).toBe(true);
    expect(para.getAttribute("textAlignment")).toBe("left");
  });
});

describe("scaleYFontSize", () => {
  it("scales inline font sizes and leaves other text alone", async () => {
    const { scaleYFontSize } = await import("./inlineStyles");
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("blocknote");
    const para = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, "big", { fontSize: { stringValue: "20" } });
    text.insert(3, " plain", { fontSize: null });
    para.insert(0, [text]);
    frag.insert(0, [para]);
    expect(scaleYFontSize(frag, 1.5)).toBe(true);
    const delta = text.toDelta() as { insert: string; attributes?: { fontSize?: { stringValue: string } } }[];
    expect(delta[0]).toMatchObject({ insert: "big", attributes: { fontSize: { stringValue: "30" } } });
    expect(delta[1]?.attributes).toBeUndefined();
  });
});
