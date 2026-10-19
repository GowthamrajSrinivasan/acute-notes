/**
 * Native-text parity for Acute text (plan Part B):
 * - Ctrl/⌘+Shift+> / <  font size step (selection-aware, same rule as the panel)
 * - Ctrl/⌘+Alt+C / V    copy / paste text styles between Acute and native text
 * - paste plain text / markdown on the canvas → Acute text item (not native text)
 */
import { CaptureUpdateAction, newElementWith, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { DocumentHome } from "@/domain/types";
import { BLOCK_FONTS } from "@/components/blocks/blockFonts";
import { EDIT_LINK_EVENT, selectedBlockStore } from "@/components/properties/selectedBlockStore";
import { createTextFormatter } from "@/components/properties/textFormatting";
import { getEmbedRef } from "@/domain/canvas/adapter";
import { TEXT_ITEM_STYLE, type BlockStyle } from "@/domain/content/blockStyle";
import { insertRichBlock, replaceElement, updateBlockStyle } from "./richBlocks";
import { styleFromNative } from "./textTool";
import { modKey } from "./shortcuts";

/** Text style shared by both kinds of text (what copy/paste styles transfers). */
export type TextStyleClip = Pick<BlockStyle, "fontFamily" | "fontSize" | "textAlign" | "textColor">;

const DEFAULT_INK = "#1e1e1e";

export function clipFromStyle(style: BlockStyle): TextStyleClip {
  return {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    textAlign: style.textAlign,
    ...(style.textColor ? { textColor: style.textColor } : {}),
  };
}

/** Native text element fields for a clip (fonts without a native equivalent are kept). */
export function nativePatchFromClip(clip: TextStyleClip): Partial<ExcalidrawTextElement> {
  const nativeFont = BLOCK_FONTS.find((f) => f.id === clip.fontFamily)?.excalidraw;
  return {
    ...(nativeFont ? { fontFamily: nativeFont as ExcalidrawTextElement["fontFamily"] } : {}),
    fontSize: clip.fontSize,
    textAlign: clip.textAlign,
    strokeColor: clip.textColor ?? DEFAULT_INK,
  };
}

let clipboard: TextStyleClip | null = null;
/** The clip came from an Acute item (Excalidraw's own style clipboard was not updated). */
let clipFromAcute = false;

function selectedElements(api: ExcalidrawImperativeAPI): ExcalidrawElement[] {
  const ids = api.getAppState().selectedElementIds;
  return api.getSceneElements().filter((el) => ids[el.id]);
}

const isFreeText = (el: ExcalidrawElement): el is ExcalidrawTextElement => el.type === "text" && !el.containerId;
const isAcuteText = (el: ExcalidrawElement) => el.type === "embeddable" && getEmbedRef(el)?.kind === "rich-block";

/** Copy styles: returns true when handled (Acute involved). */
function copyStyles(api: ExcalidrawImperativeAPI): boolean {
  const [el, ...rest] = selectedElements(api);
  if (!el || rest.length) return false;
  const ref = getEmbedRef(el);
  if (ref?.kind === "rich-block") {
    clipboard = clipFromStyle(ref.style);
    clipFromAcute = true;
    api.setToast({ message: "Text style copied", duration: 1500 });
    return true; // Excalidraw's copy would capture the embeddable's frame props.
  }
  clipFromAcute = false;
  if (isFreeText(el)) clipboard = clipFromStyle(styleFromNative(el)); // Excalidraw copies too
  else clipboard = null;
  return false;
}

/** Paste styles onto the selection: returns true when handled (Acute involved). */
function pasteStyles(api: ExcalidrawImperativeAPI): boolean {
  const targets = selectedElements(api);
  // Own the paste when Acute text is a target, or when the style came from Acute
  // text (Excalidraw's clipboard would still hold an older style).
  if (!clipboard || !(clipFromAcute || targets.some(isAcuteText))) return false;
  const clip = clipboard;
  for (const el of targets) {
    if (isAcuteText(el)) {
      const { textColor, ...rest } = clip;
      updateBlockStyle(api, el.id, { ...rest, textColor });
    } else if (isFreeText(el)) {
      replaceElement(
        api,
        el.id,
        (e) => restoreElements([newElementWith(e as ExcalidrawTextElement, nativePatchFromClip(clip))], null, { refreshDimensions: true })[0]!,
        CaptureUpdateAction.IMMEDIATELY,
      );
    }
  }
  return true;
}

/** Keyboard parity shortcuts. Capture phase, so we can own shortcuts when Acute text is involved. */
export function installTextShortcuts(api: ExcalidrawImperativeAPI): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!modKey(e)) return;
    // The page panel's editor owns its own shortcuts (e.g. Ctrl/⌘+K for links).
    if (e.target instanceof Element && e.target.closest("[data-acute-page-panel]")) return;

    // Font size step: works while editing (selection) and on a selected item.
    if (e.shiftKey && !e.altKey && (e.key === ">" || e.key === "<" || e.code === "Period" || e.code === "Comma")) {
      const selected = selectedBlockStore.get();
      if (!selected) return;
      e.preventDefault();
      e.stopPropagation();
      const up = e.key === ">" || e.code === "Period";
      createTextFormatter(api, selected).stepSize(up ? 1 : -1);
      return;
    }

    // Ctrl/⌘+K on a selected (not edited) item: edit its element link in the panel.
    if (!e.shiftKey && !e.altKey && e.code === "KeyK") {
      const selected = selectedBlockStore.get();
      if (selected && !selected.active) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent(EDIT_LINK_EVENT));
      }
      return;
    }

    // Copy / paste styles (not while typing in an editor).
    if (e.altKey && !e.shiftKey && (e.code === "KeyC" || e.code === "KeyV")) {
      if (api.getAppState().activeEmbeddable?.state === "active") return;
      const handled = e.code === "KeyC" ? copyStyles(api) : pasteStyles(api);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  };
  document.addEventListener("keydown", onKeyDown, true);
  return () => document.removeEventListener("keydown", onKeyDown, true);
}

/**
 * Excalidraw `onPaste`: plain text / markdown pasted on the canvas becomes an
 * Acute text item at the pointer (structured via BlockNote's markdown parser).
 * Returns false to stop Excalidraw creating native text.
 */
/** PRD §6.4: a paste at or over this length counts as "large" for the Visualize hint, structure or not. */
const LARGE_PASTE_CHARS = 500;

export function handleCanvasPaste(
  api: ExcalidrawImperativeAPI,
  home: DocumentHome,
  data: { text?: string; elements?: unknown; files?: unknown; spreadsheet?: unknown },
  pointer: { x: number; y: number } | null,
): boolean {
  const text = data.text?.trim();
  if (!text || data.elements || (data.files && Object.keys(data.files as object).length) || data.spreadsheet) return true;
  void import("@/components/blocks/editor/markdown").then(({ markdownToContent }) => {
    const content = markdownToContent(text);
    const s = api.getAppState();
    const at = pointer ?? { x: s.width / 2 / s.zoom.value - s.scrollX, y: s.height / 2 / s.zoom.value - s.scrollY };
    const elementId = insertRichBlock(api, home, "text", { style: TEXT_ITEM_STYLE, at, content, activate: false });
    void maybeShowVisualizeHint(elementId, text);
  });
  return false;
}

/**
 * After the insert: off the paste's own critical path, and never surfacing an
 * error from it (a paste always succeeds even if this fails). Large or
 * already-structured content offers the hint; the hint is never shown for a
 * short, unstructured paste.
 */
async function maybeShowVisualizeHint(elementId: string, text: string): Promise<void> {
  try {
    const { getAIMode } = await import("@/ai/aiMode");
    if (getAIMode() !== "on") return;
    if (text.length < LARGE_PASTE_CHARS) {
      const { analyzeContent } = await import("@/ai/content/analyze");
      const { local } = await analyzeContent(text);
      if (!local.sufficient) return;
    }
    const { visualizeHint } = await import("@/components/ai/visualizeHintStore");
    visualizeHint.show(elementId, text);
  } catch (err) {
    console.error("[acute-notes] Visualize-hint check failed", err);
  }
}
