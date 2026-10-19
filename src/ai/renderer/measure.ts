/**
 * Cheap content-based sizing (F30): a starting box per node, from
 * character/line/row counts only — never a real DOM/BlockNote mount. Boxes
 * follow the content (F42: no fixed minimum card size), and AI-created blocks
 * then fit their real content height once mounted (`RichBlockHost`'s
 * auto-height, until the user resizes one), so this only needs to be close:
 * layout uses it to place blocks without overlap, so it errs slightly large.
 *
 * `importance` (PRD §13.15: "may map to size/emphasis — never to arbitrary
 * colors") scales the box uniformly; nothing here ever sets a color.
 */
import { COMPOSITE_SHAPES, compositeLabelRoom, isCompositeShape, type CompositeShapeKind } from "@/domain/canvas/compositeShapes";
import { parseChart } from "@/domain/content/chartData";
import { PAGE_PREVIEW_SIZE } from "@/domain/content/richContent";
import type { PlanShape, VisualNode } from "@/ai/visual-plan/types";
import type { Box } from "./types";

const IMPORTANCE_SCALE = { low: 0.85, medium: 1, high: 1.2 } as const;

/** Matches `components/canvas/richBlocks.ts`'s own `lineHeightOf` (not imported: that module pulls in Excalidraw). */
const lineHeightOf = (fontSize: number) => Math.round(fontSize * 1.5);

/** A rough proportional-font width per character, at a given font size. Good enough to size an initial box, not to lay out text. */
const charWidth = (text: string, fontSize: number) => text.length * fontSize * 0.55;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Font size for a heading node, rendered as large frameless canvas text (PRD: "simple canvas text"). */
export const HEADING_FONT_SIZE = 28;
/** A section's title inside its frame (F42): Excalidraw's XL text size. */
export const SECTION_TITLE_FONT_SIZE = 36;
/** The document's own title above its sections (a heading with role "title" in a sectioned plan). */
export const DOCUMENT_TITLE_FONT_SIZE = 48;
/** The outline's one-line summary under the document title (F42 Phase 2). */
export const SUBTITLE_FONT_SIZE = 22;

/** The height of a section's takeaway line (SUBTITLE_FONT_SIZE) wrapped to `width`. */
export function takeawayHeight(text: string, width: number): number {
  return Math.max(1, Math.ceil(charWidth(text, SUBTITLE_FONT_SIZE) / Math.max(1, width))) * lineHeightOf(SUBTITLE_FONT_SIZE);
}

/** A heading's font size by role: the document title and section titles (F42) are larger than an ordinary heading; the subtitle smaller. */
export function headingFontSize(role: string | undefined): number {
  if (role === "title") return DOCUMENT_TITLE_FONT_SIZE;
  if (role === "section") return SECTION_TITLE_FONT_SIZE;
  if (role === "subtitle") return SUBTITLE_FONT_SIZE;
  return HEADING_FONT_SIZE;
}
const HEADING_MIN_WIDTH = 160;
const HEADING_MAX_WIDTH = 640;

const SHAPE_FONT_SIZE = 20;
const SHAPE_MIN_WIDTH = 170;
const SHAPE_BASE_HEIGHT = 110;
const SHAPE_LABEL_PADDING = 56;
/** Excalidraw's bound-text line height (1.25) and padding (`BOUND_TEXT_PADDING`) around a label. */
const SHAPE_LINE = Math.round(SHAPE_FONT_SIZE * 1.25);
const SHAPE_TEXT_PAD = 10;
/**
 * Per-character width of a shape label in Excalifont (the hand-drawn font Excalidraw draws labels in),
 * which averages ~0.51 em: this errs ~10% large, so a label wraps between words rather than mid-word
 * and never spills over its shape's outline.
 */
const SHAPE_CHAR = 0.56;
/** The widest a label's text runs before it wraps, by shape: a diamond's and an ellipse's text area is only part of their box. */
const SHAPE_TEXT_MAX_WIDTH: Record<PlanShape, number> = {
  rectangle: 264,
  ellipse: 240,
  diamond: 200,
  ...(Object.fromEntries(COMPOSITE_SHAPES.map((s) => [s, 240])) as Record<CompositeShapeKind, number>),
};

/** Card blocks: BlockNote's gutters (`.acute-block .bn-editor`: 12/14/16/30 px) and 14 px body text. */
const BODY_FONT = 14;
const PAD_X = 44;
const PAD_Y = 28;
const LINE = 24;
const TITLE_HEIGHT = 34;
const TEXT_MIN_WIDTH = 200;
const TEXT_MAX_WIDTH = 460;
const TEXT_MAX_HEIGHT = 560;
const TODO_ROW = 28;
const TODO_CHECKBOX = 26;
const TODO_MAX_WIDTH = 380;
const TABLE_ROW = 36;
const TABLE_CELL_PAD = 24;
const TABLE_MIN_COLUMN = 80;
// Long-text columns get room to read (Wave D: a table of paragraphs was a tall, thin column of 220 px cells).
const TABLE_MAX_COLUMN = 360;
const TABLE_MAX_WIDTH = 1200;
const TABLE_MAX_ROWS_SIZED = 16;
const CODE_CHAR = 7.8;
const CODE_LINE = 20;
const CODE_MAX_LINES_SIZED = 24;

/** A chart (Wave E) is a fixed plot area (matches `ChartPreview.tsx`'s own `WIDTH`/`HEIGHT`), plus a legend row for 2+ series. */
const CHART_WIDTH = 480;
const CHART_HEIGHT = 240;
const CHART_LEGEND_ROW = 28;
const PAGE_MAX_LINES_SIZED = 8;
const TEXT_CHARS_PER_LINE = 46;

/**
 * A table's column widths in px, as it is drawn (`columnWidths`, Wave D): each column as wide as its longest cell
 * wants, between 80 and 360 px, scaled down together when the table would pass 1,200 px. Measured and rendered
 * from the same numbers, so the box fits the table.
 */
export function tableColumnWidths(columns: readonly string[], rows: readonly (readonly string[])[]): number[] {
  const all = [columns, ...rows];
  const wanted = columns.map((_, c) => clamp(Math.max(...all.map((r) => charWidth(r[c] ?? "", BODY_FONT))) + TABLE_CELL_PAD, TABLE_MIN_COLUMN, TABLE_MAX_COLUMN));
  const scale = Math.min(1, (TABLE_MAX_WIDTH - PAD_X) / Math.max(1, wanted.reduce((a, b) => a + b, 0)));
  return wanted.map((w) => Math.max(TABLE_MIN_COLUMN, Math.ceil(w * scale)));
}

/** Wrapped line count of `text` at `width` px of 14 px body text. */
function wrappedLines(text: string, width: number): number {
  const perLine = Math.max(8, Math.floor(width / (BODY_FONT * 0.55)));
  return text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
}

/** The width a set of lines wants: its longest line, within bounds. */
function widthFor(lines: readonly string[], extra: number, min: number, max: number): number {
  return clamp(Math.max(0, ...lines.map((l) => charWidth(l, BODY_FONT))) + extra, min, max);
}

/**
 * A shape big enough for its whole label: the label wraps between words at its shape's text width
 * (widened to its longest word, so no word is ever split), and the box then fits that text area —
 * all of a rectangle, the inscribed half of a diamond, the inscribed square of an ellipse (Excalidraw's
 * `getBoundTextMaxWidth`). Excalidraw grows a shape whose label still doesn't fit, but only downwards,
 * after layout has placed its neighbours — so this errs large rather than relying on that.
 */
/** `min` scales the shape's minimum size (0: the label's own fit only). */
function shapeSize(shape: PlanShape, label: string, min = 1): Omit<Box, "x" | "y"> {
  const minWidth = SHAPE_MIN_WIDTH * min;
  const minHeight = SHAPE_BASE_HEIGHT * min;
  const px = (s: string) => s.length * SHAPE_FONT_SIZE * SHAPE_CHAR;
  const words = label.split(/\s+/).filter(Boolean);
  const longest = Math.max(0, ...words.map(px));
  const textWidth = Math.ceil(Math.max(longest, Math.min(px(label), SHAPE_TEXT_MAX_WIDTH[shape])));
  // Greedy word wrap, as Excalidraw's `wrapText` does.
  let lines = 1;
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && px(next) > textWidth) {
      lines++;
      line = word;
    } else line = next;
  }
  const textHeight = lines * SHAPE_LINE;
  if (shape === "diamond") {
    return { width: Math.max(minWidth, 2 * (textWidth + 2 * SHAPE_TEXT_PAD)), height: Math.max(minHeight, 2 * (textHeight + 2 * SHAPE_TEXT_PAD)) };
  }
  if (shape === "ellipse") {
    const fit = (d: number) => Math.round((d + 2 * SHAPE_TEXT_PAD) * Math.SQRT2) + SHAPE_TEXT_PAD * 2;
    return { width: Math.max(minWidth, fit(textWidth)), height: Math.max(minHeight, fit(textHeight)) };
  }
  if (isCompositeShape(shape)) {
    // The label is centred in the whole box, so it needs the outline's room (a rim, a slant, a wave) clear of it.
    const width = Math.max(minWidth, textWidth + SHAPE_LABEL_PADDING);
    const height = Math.max(minHeight, textHeight + SHAPE_LABEL_PADDING);
    const room = compositeLabelRoom(shape, width, height);
    return { width: width + room.width, height: height + room.height };
  }
  return { width: Math.max(minWidth, textWidth + SHAPE_LABEL_PADDING), height: Math.max(minHeight, textHeight + SHAPE_LABEL_PADDING) };
}

/** A node's starting box size (position is layout's job), scaled by its `importance`. */
export function measureNode(node: VisualNode): Omit<Box, "x" | "y"> {
  const scale = IMPORTANCE_SCALE[node.importance ?? "medium"];
  const size = scaleSize(sizeOf(node), scale);
  if (node.type !== "shape") return size;
  // Less emphasis shrinks a shape, but never below what its label needs.
  const fit = shapeSize(node.content.shape, node.content.label, 0);
  return { width: Math.max(size.width, fit.width), height: Math.max(size.height, fit.height) };
}

function scaleSize(size: Omit<Box, "x" | "y">, scale: number): Omit<Box, "x" | "y"> {
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

function sizeOf(node: VisualNode): Omit<Box, "x" | "y"> {
  const title = node.title ? TITLE_HEIGHT : 0;
  const titleWidth = node.title ? charWidth(node.title, 18) + PAD_X : 0;
  switch (node.type) {
    case "heading": {
      const fontSize = headingFontSize(node.role);
      const wide = fontSize > HEADING_FONT_SIZE || node.role === "subtitle";
      return { width: clamp(charWidth(node.content.text, fontSize), HEADING_MIN_WIDTH, wide ? 1200 : HEADING_MAX_WIDTH), height: lineHeightOf(fontSize) };
    }
    case "shape":
      return shapeSize(node.content.shape, node.content.label);
    case "text": {
      const lines = node.content.markdown.split("\n").map((l) => l.replace(/^\s*([-*+]|\d+\.|#+)\s+/, "   "));
      const width = Math.max(widthFor(lines, PAD_X, TEXT_MIN_WIDTH, TEXT_MAX_WIDTH), Math.min(titleWidth, TEXT_MAX_WIDTH));
      return { width, height: clamp(PAD_Y + title + wrappedLines(lines.join("\n"), width - PAD_X) * LINE, 60, TEXT_MAX_HEIGHT) };
    }
    case "todo": {
      const items = node.content.items.map((i) => i.text);
      const width = Math.max(widthFor(items, PAD_X + TODO_CHECKBOX, TEXT_MIN_WIDTH, TODO_MAX_WIDTH), Math.min(titleWidth, TODO_MAX_WIDTH));
      const rows = items.reduce((n, t) => n + wrappedLines(t, width - PAD_X - TODO_CHECKBOX), 0);
      return { width, height: PAD_Y + title + Math.max(1, rows) * TODO_ROW };
    }
    case "table": {
      const { columns, rows } = node.content;
      const all = [columns, ...rows];
      const widths = tableColumnWidths(columns, rows);
      const width = clamp(widths.reduce((a, b) => a + b, 0) + PAD_X, TEXT_MIN_WIDTH, TABLE_MAX_WIDTH);
      const rowLines = all.slice(0, TABLE_MAX_ROWS_SIZED + 1).map((r) => Math.max(1, ...r.map((cell, c) => wrappedLines(cell, (widths[c] ?? TABLE_MIN_COLUMN) - TABLE_CELL_PAD))));
      return { width: Math.max(width, Math.min(titleWidth, TABLE_MAX_WIDTH)), height: PAD_Y + title + rowLines.reduce((n, l) => n + TABLE_ROW + (l - 1) * 20, 0) };
    }
    case "code": {
      // A chart's JSON source doesn't read as code: size it from its category/series counts instead (Wave E),
      // falling back to the normal code sizing when the JSON doesn't parse.
      if (node.content.language === "acute-chart") {
        const chart = parseChart(node.content.source);
        if (chart) return { width: CHART_WIDTH, height: PAD_Y + title + CHART_HEIGHT + (chart.series.length > 1 ? CHART_LEGEND_ROW : 0) };
      }
      const lines = node.content.source.split("\n");
      const width = clamp(Math.max(...lines.map((l) => l.length)) * CODE_CHAR + 60, 260, 640);
      return { width, height: PAD_Y + title + 16 + Math.min(lines.length, CODE_MAX_LINES_SIZED) * CODE_LINE };
    }
    case "page": {
      const lines = Math.min(Math.ceil(node.content.markdown.length / TEXT_CHARS_PER_LINE), PAGE_MAX_LINES_SIZED);
      return { width: PAGE_PREVIEW_SIZE.card.width, height: Math.max(PAGE_PREVIEW_SIZE.card.height, 60 + lines * lineHeightOf(14)) };
    }
    case "group":
      // A group's box is its laid-out members' bounds (layout.ts), never measured from its own content.
      return { width: 0, height: 0 };
    case "image":
      // No template allows an "image" node today (F29's registry), so a validated plan never reaches this — see render.ts.
      return { width: 320, height: 240 };
  }
}
