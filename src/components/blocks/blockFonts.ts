/**
 * Fonts available to Acute text. Excalidraw registers its (self-hosted) fonts
 * as `FontFace`s on `document.fonts`, so DOM text can use them by family name —
 * offline, loaded lazily, identical to canvas text.
 */
import type { BlockFontId } from "@/domain/content/blockStyle";

export interface BlockFont {
  id: BlockFontId;
  label: string;
  /** CSS font-family stack (Xiaolai is Excalidraw's CJK hand-drawn fallback). */
  css: string;
  /** Excalidraw `FONT_FAMILY` value, to map Excalidraw's current font to ours. */
  excalidraw?: number;
}

export const BLOCK_FONTS: readonly BlockFont[] = [
  { id: "excalifont", label: "Excalifont", css: 'Excalifont, Xiaolai, "Segoe UI Emoji", sans-serif', excalidraw: 5 },
  { id: "inter", label: "Inter", css: 'Inter, "Assistant", system-ui, -apple-system, "Segoe UI", sans-serif' },
  { id: "nunito", label: "Nunito", css: 'Nunito, "Segoe UI Emoji", sans-serif', excalidraw: 6 },
  { id: "comic", label: "Comic Shanns", css: '"Comic Shanns", "Segoe UI Emoji", sans-serif', excalidraw: 8 },
  { id: "lilita", label: "Lilita One", css: '"Lilita One", "Segoe UI Emoji", sans-serif', excalidraw: 7 },
  { id: "liberation", label: "Liberation Sans", css: '"Liberation Sans", Arial, Helvetica, sans-serif', excalidraw: 9 },
  { id: "cascadia", label: "Cascadia (code)", css: 'Cascadia, ui-monospace, "SFMono-Regular", Consolas, monospace', excalidraw: 3 },
  { id: "virgil", label: "Virgil", css: 'Virgil, Excalifont, Xiaolai, sans-serif', excalidraw: 1 },
];

const BY_ID = new Map(BLOCK_FONTS.map((f) => [f.id, f]));

export function fontCss(id: BlockFontId): string {
  return BY_ID.get(id)?.css ?? BLOCK_FONTS[0]!.css;
}

/** Our font for an Excalidraw `FONT_FAMILY` value (e.g. the current text tool font). */
export function fontFromExcalidraw(value: number | undefined): BlockFontId | undefined {
  return BLOCK_FONTS.find((f) => f.excalidraw === value)?.id;
}
