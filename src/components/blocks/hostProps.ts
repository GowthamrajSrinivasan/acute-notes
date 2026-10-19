/**
 * Props for `RichBlockHost` derived from a canvas element — shared by the live
 * canvas (`renderEmbeddable`) and image export, so both render identically.
 */
import type { AcuteEmbedRef } from "@/domain/canvas/adapter";
import { blockTextColor, darkModeColor } from "./blockColor";

type RichRef = Extract<AcuteEmbedRef, { kind: "rich-block" }>;

export interface HostElement {
  id: string;
  backgroundColor: string;
  strokeColor: string;
  fillStyle: string;
}

export function hostPropsFor(element: HostElement, ref: RichRef, theme: "light" | "dark", active: boolean) {
  const { style } = ref;
  // Text colour comes from the Text panel (style); cards fall back to their stroke.
  const textColor = style.textColor
    ? theme === "dark"
      ? darkModeColor(style.textColor)
      : style.textColor
    : style.frame === "none"
      ? undefined
      : blockTextColor(element.strokeColor, theme);
  return {
    elementId: element.id,
    documentId: ref.documentId,
    blockType: ref.blockType,
    active,
    theme,
    // Only a solid fill is painted in the DOM layer (it keeps overlapping blocks
    // opaque). Hachure / cross-hatch / zigzag are drawn by Excalidraw on the canvas
    // underneath, so the DOM layer stays transparent to let the pattern show.
    background: element.fillStyle === "solid" ? element.backgroundColor : "transparent",
    textColor: textColor || undefined,
    frame: style.frame,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    textAlign: style.textAlign,
    autoWidth: style.autoWidth,
    autoHeight: style.frame === "card" && !!style.autoHeight,
    href: ref.href,
  };
}
