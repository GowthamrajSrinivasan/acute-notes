/**
 * The `ActiveEditorHandle` implementation over a live BlockNote editor: the
 * side panel's only way to format text (the floating toolbars are disabled).
 */
import { mapTableCell, TableHandlesExtension, type BlockNoteEditor, type TableContent } from "@blocknote/core";
import type { BlockTextAlign } from "@/domain/content/blockStyle";
import type { ActiveEditorHandle, LineType, MarkKey, SelectionFormat, SelectionScope } from "../activeEditors";

// The handle is schema-agnostic at the type level; BlockNote validates values.
type AnyEditor = BlockNoteEditor<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type AnyBlock = ReturnType<AnyEditor["getTextCursorPosition"]>["block"];

const MARKS: readonly MarkKey[] = ["bold", "italic", "underline", "strike", "code"];
const LINE_TYPES: Record<LineType, { type: string; props?: Record<string, unknown> }> = {
  paragraph: { type: "paragraph" },
  heading1: { type: "heading", props: { level: 1 } },
  heading2: { type: "heading", props: { level: 2 } },
  heading3: { type: "heading", props: { level: 3 } },
  bulletListItem: { type: "bulletListItem" },
  numberedListItem: { type: "numberedListItem" },
  checkListItem: { type: "checkListItem" },
};

function lineTypeOf(block: AnyBlock): LineType | undefined {
  if (block.type === "heading") {
    const level = Number((block.props as { level?: number }).level ?? 1);
    return level === 2 ? "heading2" : level === 3 ? "heading3" : "heading1";
  }
  return block.type in LINE_TYPES ? (block.type as LineType) : undefined;
}

type Cells = { row: number; col: number }[] | "all";

/**
 * Tables align per cell (BlockNote keeps `textAlignment` on each cell, not on the table block):
 * rewrites the cells' props — the selected cells, or all of them.
 */
function updateCells(editor: AnyEditor, block: AnyBlock, cells: Cells, patch: (props: Record<string, unknown>) => Record<string, unknown>): void {
  const content = block.content as unknown as TableContent<any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const hit = cells === "all" ? null : new Set(cells.map((c) => `${c.row}:${c.col}`));
  const rows = content.rows.map((row, r) => ({
    ...row,
    cells: row.cells.map((raw, c) => {
      const cell = mapTableCell(raw);
      return !hit || hit.has(`${r}:${c}`) ? { ...cell, props: patch({ ...cell.props }) } : cell;
    }),
  }));
  editor.updateBlock(block, { type: "table", content: { ...content, type: "tableContent", rows } } as never);
}

export function createEditorHandle(editor: AnyEditor): ActiveEditorHandle {
  const tiptap = editor._tiptapEditor;
  /** The table cells the selection covers (a text selection inside one cell counts as that cell). */
  const selectedCells = (): Cells => editor.getExtension(TableHandlesExtension)?.getCellSelection()?.cells ?? "all";

  /** Blocks touched by the selection, or the cursor's block. */
  const selectedBlocks = (): AnyBlock[] => editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];

  const allBlocks = (): AnyBlock[] => {
    const out: AnyBlock[] = [];
    editor.forEachBlock((b) => {
      out.push(b);
      return true;
    });
    return out;
  };

  const withWholeDocument = (fn: () => void) => {
    const { from, to } = tiptap.state.selection;
    tiptap.commands.setTextSelection({ from: 0, to: tiptap.state.doc.content.size });
    fn();
    const size = tiptap.state.doc.content.size;
    tiptap.commands.setTextSelection({ from: Math.min(from, size), to: Math.min(to, size) });
  };

  return {
    selectionScope: (): SelectionScope => {
      const { state } = tiptap;
      const { from, to, empty } = state.selection;
      if (empty) return "none";
      const selected = state.doc.textBetween(from, to, "\n", "\n").trim();
      const all = state.doc.textBetween(0, state.doc.content.size, "\n", "\n").trim();
      if (!selected) return "none";
      return selected === all ? "all" : "partial";
    },

    selectedMarkdown: () => {
      const { from, to, empty } = tiptap.state.selection;
      if (empty) return null;
      const selected = tiptap.state.doc.textBetween(from, to, "\n", "\n").trim();
      const all = tiptap.state.doc.textBetween(0, tiptap.state.doc.content.size, "\n", "\n").trim();
      if (!selected || selected === all) return null;
      // Blocks cut to the selection (whole words), so a half-selected line keeps just its selected part.
      const markdown = editor.blocksToMarkdownLossy(editor.getSelectionCutBlocks(true).blocks as never).trim();
      return markdown || selected;
    },

    getFormat: (): SelectionFormat => {
      const styles = editor.getActiveStyles() as Record<string, unknown>;
      const block = editor.getTextCursorPosition().block;
      const cells = block.type === "table" ? selectedCells() : "all";
      const cell = block.type === "table" && cells !== "all" && cells[0] ? (block.content as unknown as TableContent<any, any>).rows[cells[0].row]?.cells[cells[0].col] : undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
      const align = cell ? mapTableCell(cell).props.textAlignment : (block.props as { textAlignment?: string }).textAlignment;
      const marks = Object.fromEntries(MARKS.map((m) => [m, styles[m] === true])) as Record<MarkKey, boolean>;
      return {
        marks,
        ...(typeof styles.fontFamily === "string" ? { fontFamily: styles.fontFamily } : {}),
        ...(typeof styles.fontSize === "string" ? { fontSize: styles.fontSize } : {}),
        ...(typeof styles.textColor === "string" && styles.textColor !== "default" ? { textColor: styles.textColor } : {}),
        ...(align === "center" || align === "right" ? { alignment: align } : {}),
        ...(lineTypeOf(block) ? { lineType: lineTypeOf(block) } : {}),
        ...(editor.getSelectedLinkUrl() ? { link: editor.getSelectedLinkUrl() } : {}),
      };
    },

    subscribe: (listener) => {
      const offSelection = editor.onSelectionChange(() => listener());
      const offChange = editor.onChange(() => listener());
      return () => {
        offSelection?.();
        offChange?.();
      };
    },

    applyStyle: (key, value) => {
      if (value) editor.addStyles({ [key]: value } as never);
      else editor.removeStyles({ [key]: "" } as never);
      editor.focus();
    },

    clearStyleEverywhere: (key) => {
      if (key === "textAlignment") {
        for (const b of allBlocks()) {
          if (b.type === "table") {
            const rows = (b.content as unknown as TableContent<any, any>).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
            if (rows.some((r) => r.cells.some((c) => mapTableCell(c).props.textAlignment !== "left"))) updateCells(editor, b, "all", (p) => ({ ...p, textAlignment: "left" }));
            continue;
          }
          const align = (b.props as { textAlignment?: string }).textAlignment;
          if (align && align !== "left") editor.updateBlock(b, { props: { textAlignment: "left" } } as never);
        }
        return;
      }
      withWholeDocument(() => tiptap.commands.unsetMark(key));
    },

    toggleMark: (key) => {
      editor.toggleStyles({ [key]: true } as never);
      editor.focus();
    },

    setAlignment: (align: BlockTextAlign) => {
      for (const b of selectedBlocks()) {
        if (b.type !== "table") {
          editor.updateBlock(b, { props: { textAlignment: align } } as never);
          continue;
        }
        updateCells(editor, b, selectedCells(), (p) => ({ ...p, textAlignment: align }));
        // `updateBlock` moves the selection out of the table.
        editor.setTextCursorPosition(b);
      }
      editor.focus();
    },

    setLineType: (type) => {
      const target = LINE_TYPES[type];
      for (const b of selectedBlocks()) editor.updateBlock(b, { type: target.type, props: target.props ?? {} } as never);
      editor.focus();
    },

    setLink: (url) => {
      if (url) editor.createLink(url);
      else tiptap.chain().focus().extendMarkRange("link").unsetMark("link").run();
      editor.focus();
    },

    clearFormatting: () => {
      editor.removeStyles({
        bold: true,
        italic: true,
        underline: true,
        strike: true,
        code: true,
        textColor: "",
        backgroundColor: "",
        fontFamily: "",
        fontSize: "",
      } as never);
      tiptap.commands.unsetMark("link");
      editor.focus();
    },

    selectAll: () => {
      tiptap.commands.setTextSelection({ from: 0, to: tiptap.state.doc.content.size });
    },

    applyTextColor: (color) => {
      editor.addStyles({ textColor: color } as never);
      editor.focus();
    },

    clearTextColor: () => {
      editor.removeStyles({ textColor: "" } as never);
    },
  };
}
