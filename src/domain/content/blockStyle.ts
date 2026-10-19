/**
 * Visual style of an Acute text item / rich block, stored on the canvas element
 * (`customData.acute.style`). Renderer-agnostic: values are ids and numbers.
 */

/** `none` = frameless text that looks like plain canvas text; `card` = bordered block. */
export type BlockFrame = "none" | "card";

export const BLOCK_FONT_IDS = [
  "excalifont",
  "inter",
  "nunito",
  "comic",
  "lilita",
  "liberation",
  "cascadia",
  "virgil",
] as const;
export type BlockFontId = (typeof BLOCK_FONT_IDS)[number];

export type BlockTextAlign = "left" | "center" | "right";

export interface BlockStyle {
  frame: BlockFrame;
  fontFamily: BlockFontId;
  /** Base font size in scene px (headings scale from it). */
  fontSize: number;
  textAlign: BlockTextAlign;
  /** Frameless text colour in canvas colour space; undefined = theme default. Cards use the element stroke. */
  textColor?: string;
  /** Frameless text grows with its longest line until the user resizes it. */
  autoWidth: boolean;
  /** Cards only: height follows the content (grows and shrinks) until the user resizes it. Set on AI-created cards (F42). */
  autoHeight?: boolean;
}

/** Excalidraw's text size steps. */
export const FONT_SIZES = { S: 16, M: 20, L: 28, XL: 36 } as const;

/** Style of a new text item (T tool / double-click): matches Excalidraw's default text. */
export const TEXT_ITEM_STYLE: BlockStyle = {
  frame: "none",
  fontFamily: "excalifont",
  fontSize: FONT_SIZES.M,
  textAlign: "left",
  autoWidth: true,
};

/** Style of blocks created before styles existed, and of new card blocks. */
export const CARD_STYLE: BlockStyle = {
  frame: "card",
  fontFamily: "inter",
  fontSize: 14,
  textAlign: "left",
  autoWidth: false,
};

const ALIGNS: readonly BlockTextAlign[] = ["left", "center", "right"];

/** Validates a stored style, filling gaps from `fallback` (never throws). */
export function normalizeBlockStyle(raw: unknown, fallback: BlockStyle = CARD_STYLE): BlockStyle {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Partial<Record<keyof BlockStyle, unknown>>;
  const frame = r.frame === "none" || r.frame === "card" ? r.frame : fallback.frame;
  const fontFamily = BLOCK_FONT_IDS.includes(r.fontFamily as BlockFontId) ? (r.fontFamily as BlockFontId) : fallback.fontFamily;
  const fontSize =
    typeof r.fontSize === "number" && Number.isFinite(r.fontSize) && r.fontSize >= 8 && r.fontSize <= 200
      ? r.fontSize
      : fallback.fontSize;
  const textAlign = ALIGNS.includes(r.textAlign as BlockTextAlign) ? (r.textAlign as BlockTextAlign) : fallback.textAlign;
  const textColor = typeof r.textColor === "string" && r.textColor ? r.textColor : undefined;
  const autoWidth = typeof r.autoWidth === "boolean" ? r.autoWidth : fallback.autoWidth;
  const autoHeight = typeof r.autoHeight === "boolean" ? r.autoHeight : fallback.autoHeight;
  return { frame, fontFamily, fontSize, textAlign, autoWidth, ...(textColor ? { textColor } : {}), ...(autoHeight ? { autoHeight } : {}) };
}
