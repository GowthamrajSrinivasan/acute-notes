/**
 * Clipboard paste policy shared by page and canvas-block editors.
 *
 * BlockNote prefers `text/plain` over `text/html` whenever the plain text
 * "looks like Markdown", but its detector is loose: two underscores in a line
 * (`get_timeseries … submit_answer`) read as italics. Copying a rendered page
 * (a Markdown preview, a web page, a doc) then loses its tables, headings and
 * code spans. When the HTML carries real structure, paste the HTML (as Notion
 * does); otherwise keep the default, so raw Markdown copied from a code view or
 * chat (`<pre>`, `<div>`/`<span>` lines) is still parsed as Markdown.
 *
 * Inside a table, tab-separated rows (a spreadsheet or text copy without an
 * HTML table) paste as cells: from the cursor's cell rightwards and down,
 * adding the rows and columns they need, as an HTML table paste already does.
 */
import type { BlockNoteEditor, BlockNoteEditorOptions } from "@blocknote/core";

/** Elements that only a rendered (not raw-source) document has. */
const STRUCTURE = /<(?:table|h[1-6]|ul|ol|li|blockquote|hr|strong|b|em|i|code|a\s[^>]*\bhref)\b/i;

/** `<pre>` sections are source listings: their `<code>`/spans say nothing about the document. */
const PRE = /<pre\b[\s\S]*?<\/pre>/gi;

export function isStructuredHtml(html: string): boolean {
  return STRUCTURE.test(html.replace(PRE, ""));
}

/**
 * Tab-separated rows as a grid, or null when `text` isn't one: it needs a tab
 * (a single column of lines stays text), and Markdown tables (`| a | b |`)
 * are left to the Markdown parser.
 */
export function parseGrid(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  if (!text.includes("\t") || lines.every((l) => /^\s*\|/.test(l))) return null;
  return lines.map((l) => l.split("\t"));
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function gridToHtml(grid: readonly (readonly string[])[]): string {
  const rows = grid.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell.trim())}</td>`).join("")}</tr>`);
  return `<table><tbody>${rows.join("")}</tbody></table>`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shared by every schema
type AnyEditor = BlockNoteEditor<any, any, any>;

/** The cursor (or a cell selection) is inside a table. */
function inTable(editor: AnyEditor): boolean {
  return editor.transact((tr) => {
    const { $from } = tr.selection;
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === "table") return true;
    return "$anchorCell" in tr.selection;
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- shared by every schema
export const pasteHandler: NonNullable<BlockNoteEditorOptions<any, any, any>["pasteHandler"]> = ({
  event,
  editor,
  defaultPasteHandler,
}) => {
  const html = event.clipboardData?.getData("text/html") ?? "";
  if (!/<table/i.test(html) && inTable(editor)) {
    const grid = parseGrid(event.clipboardData?.getData("text/plain") ?? "");
    if (grid) {
      editor.pasteHTML(gridToHtml(grid));
      return true;
    }
  }
  return defaultPasteHandler({ prioritizeMarkdownOverHTML: !isStructuredHtml(html) });
};
