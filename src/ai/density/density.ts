/**
 * Dense blocks (F42 "dense content", Phase 1): a block holding more text than
 * it can show well — a table whose cells are paragraphs, a checklist whose
 * items are, or a text block that is a wall of prose. Such a block is pointed
 * out after it lands on the canvas, so the user can see it and (Phase 2) ask
 * for it to be split into a more visual form.
 *
 * Pure, over rich content, so it applies to a block whatever made it
 * (Visualize's AI or local tier, MCP). Pages are never dense: they are meant
 * to be long, and are opened on their own. Code is never dense either.
 */
import { inlineText, isTableContent, toPlainText } from "@/domain/content/richContent";
import type { ContentBlock, RichBlockType, RichContent } from "@/domain/types";

/** A table cell or checklist item longer than this is a paragraph, not a value. */
export const DENSE_CELL_CHARS = 300;
/** A table with more text than this in all is too much to read as a grid. */
export const DENSE_TABLE_CHARS = 2_000;
/** A text block longer than this is a wall of prose on a canvas. */
export const DENSE_TEXT_CHARS = 1_200;

export interface DensityFinding {
  /** What makes the block dense. */
  cause: "long_cell" | "long_table" | "long_item" | "long_text";
  /** The characters that count against the limit (the longest cell or item, or the whole text). */
  chars: number;
  limit: number;
  /** Shown to the user as is: "A table cell holds 1,840 characters". */
  reason: string;
}

const count = (n: number) => n.toLocaleString("en-US");

function walk(blocks: RichContent, visit: (b: ContentBlock) => void): void {
  for (const b of blocks) {
    visit(b);
    if (b.children?.length) walk(b.children, visit);
  }
}

/** Why a block of `blockType` with `content` is dense, or null when it reads well as it is. */
export function assessDensity(blockType: RichBlockType, content: RichContent): DensityFinding | null {
  if (blockType === "code") return null;
  let longestCell = 0;
  let tableChars = 0;
  let longestItem = 0;
  walk(content, (b) => {
    if (isTableContent(b.content)) {
      for (const row of b.content.rows) {
        for (const cell of row.cells) {
          const n = inlineText(cell).trim().length;
          longestCell = Math.max(longestCell, n);
          tableChars += n;
        }
      }
    } else if (b.type === "checkListItem") {
      longestItem = Math.max(longestItem, inlineText(b.content).trim().length);
    }
  });
  if (longestCell > DENSE_CELL_CHARS) {
    return { cause: "long_cell", chars: longestCell, limit: DENSE_CELL_CHARS, reason: `A table cell holds ${count(longestCell)} characters` };
  }
  if (tableChars > DENSE_TABLE_CHARS) {
    return { cause: "long_table", chars: tableChars, limit: DENSE_TABLE_CHARS, reason: `The table holds ${count(tableChars)} characters` };
  }
  if (longestItem > DENSE_CELL_CHARS) {
    return { cause: "long_item", chars: longestItem, limit: DENSE_CELL_CHARS, reason: `A checklist item holds ${count(longestItem)} characters` };
  }
  // A table's or checklist's size is judged above; only prose counts as text.
  if (blockType !== "text") return null;
  const prose: RichContent = [];
  walk(content, (b) => {
    if (!isTableContent(b.content) && b.type !== "checkListItem") prose.push({ ...b, children: [] });
  });
  const chars = toPlainText(prose).length;
  if (chars > DENSE_TEXT_CHARS) return { cause: "long_text", chars, limit: DENSE_TEXT_CHARS, reason: `The text holds ${count(chars)} characters` };
  return null;
}
