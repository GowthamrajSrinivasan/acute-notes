/**
 * Selection-scoped formatting for Acute text, shared by the Text panel and
 * keyboard shortcuts so both follow one rule (plan A1):
 * - editing with part of the text selected → only the selection
 * - otherwise → the whole item (item style + that property's inline overrides cleared)
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getActiveEditor, runWithEditor, type ActiveEditorHandle, type ValueStyleKey } from "@/components/blocks/activeEditors";
import { activateEmbeddable, updateBlockStyle } from "@/components/canvas/richBlocks";
import { FONT_SIZES, type BlockStyle, type BlockTextAlign } from "@/domain/content/blockStyle";
import { clearInlineStyleStored } from "@/state/inlineStyles";
import type { SelectedBlock } from "./selectedBlockStore";

const SIZE_STEPS = Object.values(FONT_SIZES).sort((a, b) => a - b);

/** Next/previous S/M/L/XL step from `current` (clamped). */
export function stepFontSize(current: number, direction: 1 | -1): number {
  if (direction > 0) return SIZE_STEPS.find((s) => s > current) ?? SIZE_STEPS.at(-1)!;
  return [...SIZE_STEPS].reverse().find((s) => s < current) ?? SIZE_STEPS[0]!;
}

export function createTextFormatter(api: ExcalidrawImperativeAPI, selected: SelectedBlock) {
  const editor: ActiveEditorHandle | undefined = selected.active ? getActiveEditor(selected.documentId) : undefined;
  const partial = () => !!editor && editor.selectionScope() === "partial";
  const setItem = (patch: Partial<BlockStyle>) => updateBlockStyle(api, selected.elementId, patch);

  const clearInline = (key: ValueStyleKey | "textAlignment") => {
    if (editor) editor.clearStyleEverywhere(key);
    else clearInlineStyleStored(selected.documentId, key);
  };

  return {
    editor,
    /** Font family / size / colour. */
    applyValue(key: ValueStyleKey, value: string | null, itemPatch: Partial<BlockStyle>) {
      if (editor && partial()) {
        editor.applyStyle(key, value);
        return;
      }
      setItem(itemPatch);
      clearInline(key);
    },
    align(value: BlockTextAlign) {
      if (editor && partial()) {
        editor.setAlignment(value);
        return;
      }
      setItem({ textAlign: value });
      clearInline("textAlignment");
    },
    /** Editor-only operations (marks, line type, link); `lineLevel` ops act on the cursor's lines. */
    withText(op: (e: ActiveEditorHandle) => void, lineLevel = false) {
      if (editor) {
        if (!lineLevel && !partial()) editor.selectAll();
        op(editor);
        return;
      }
      activateEmbeddable(api, selected.elementId);
      runWithEditor(selected.documentId, (e) => {
        e.selectAll();
        op(e);
      });
    },
    /** Ctrl+Shift+> / < : one S/M/L/XL step, same scope rule. */
    stepSize(direction: 1 | -1) {
      const current = editor && partial() && editor.getFormat().fontSize ? Number(editor.getFormat().fontSize) : selected.style.fontSize;
      const next = stepFontSize(current, direction);
      this.applyValue("fontSize", String(next), { fontSize: next });
    },
  };
}
