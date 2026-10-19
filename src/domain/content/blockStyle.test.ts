import { describe, expect, it } from "vitest";
import { fontCss, fontFromExcalidraw } from "@/components/blocks/blockFonts";
import { getEmbedRef } from "../canvas/adapter";
import { CARD_STYLE, normalizeBlockStyle, TEXT_ITEM_STYLE } from "./blockStyle";

describe("block style", () => {
  it("defaults legacy blocks (no stored style) to the card style", () => {
    const ref = getEmbedRef({ customData: { acute: { kind: "rich-block", blockType: "text", documentId: "d" } } });
    expect(ref).toMatchObject({ kind: "rich-block", style: CARD_STYLE });
  });

  it("keeps valid fields and repairs invalid ones from the fallback", () => {
    const style = normalizeBlockStyle(
      { frame: "none", fontFamily: "nope", fontSize: 9999, textAlign: "center", textColor: "#e03131", autoWidth: false },
      TEXT_ITEM_STYLE,
    );
    expect(style).toEqual({
      frame: "none",
      fontFamily: TEXT_ITEM_STYLE.fontFamily,
      fontSize: TEXT_ITEM_STYLE.fontSize,
      textAlign: "center",
      textColor: "#e03131",
      autoWidth: false,
    });
    expect(normalizeBlockStyle("garbage", TEXT_ITEM_STYLE)).toBe(TEXT_ITEM_STYLE);
  });

  it("maps Excalidraw font families to block fonts", () => {
    expect(fontFromExcalidraw(5)).toBe("excalifont");
    expect(fontFromExcalidraw(3)).toBe("cascadia");
    expect(fontFromExcalidraw(42)).toBeUndefined();
    expect(fontCss("nunito")).toContain("Nunito");
  });
});
