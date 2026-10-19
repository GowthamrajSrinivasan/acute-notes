/**
 * One text system: free-standing text is Acute rich text.
 *
 * Rather than re-implementing Excalidraw's hit-testing (is this double-click on
 * a shape, on an arrow's label area, or on empty canvas?), we let Excalidraw
 * decide and intercept only when it starts editing a *new, unbound* text
 * element — i.e. the Text tool was clicked, or empty canvas was double-clicked.
 * Labels bound to shapes/arrows (`containerId` set) and edits of existing
 * Excalidraw text pass through untouched.
 *
 * The native editor is discarded (Escape on an empty text deletes it, leaving no
 * history) and a frameless Acute text item is created at the same point,
 * inheriting Excalidraw's current font, size, alignment and colour.
 */
import type { ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { DocumentHome } from "@/domain/types";
import { fontFromExcalidraw } from "@/components/blocks/blockFonts";
import { TEXT_ITEM_STYLE, type BlockStyle, type BlockTextAlign } from "@/domain/content/blockStyle";
import { insertRichBlock } from "./richBlocks";

/** Excalidraw's default ink; treated as "theme default" so it adapts to dark mode. */
const DEFAULT_INK = new Set(["#1e1e1e", "#000000", "transparent"]);
const MAX_WAIT_FRAMES = 10;

export function styleFromNative(t: ExcalidrawTextElement): BlockStyle {
  const color = t.strokeColor.toLowerCase();
  const align: BlockTextAlign = t.textAlign === "center" || t.textAlign === "right" ? t.textAlign : "left";
  return {
    ...TEXT_ITEM_STYLE,
    fontFamily: fontFromExcalidraw(t.fontFamily) ?? TEXT_ITEM_STYLE.fontFamily,
    fontSize: t.fontSize || TEXT_ITEM_STYLE.fontSize,
    textAlign: align,
    ...(DEFAULT_INK.has(color) ? {} : { textColor: t.strokeColor }),
  };
}

export class NativeTextTakeover {
  private handlingId: string | null = null;

  constructor(private readonly home: DocumentHome) {}

  /** Call from Excalidraw `onChange`; O(1) unless a native text edit just started. */
  handleChange(api: ExcalidrawImperativeAPI, appState: AppState): void {
    const t = appState.editingTextElement;
    if (!t || t.type !== "text") return;
    const text = t as ExcalidrawTextElement;
    if (text.containerId || text.originalText || text.text || this.handlingId === text.id) return;

    this.handlingId = text.id;
    const style = styleFromNative(text);
    const at = { x: text.x, y: text.y };
    const keepTool = appState.activeTool.locked;

    // The wysiwyg textarea is mounted just after this state change.
    let frames = 0;
    const discardNative = () => {
      const editable = document.querySelector<HTMLTextAreaElement>(".excalidraw-wysiwyg");
      if (!editable && frames++ < MAX_WAIT_FRAMES) {
        requestAnimationFrame(discardNative);
        return;
      }
      editable?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      requestAnimationFrame(() => {
        this.handlingId = null;
        insertRichBlock(api, this.home, "text", { style, at });
        if (keepTool) api.setActiveTool({ type: "text", locked: true });
      });
    };
    requestAnimationFrame(discardNative);
  }
}
