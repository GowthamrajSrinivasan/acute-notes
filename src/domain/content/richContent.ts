/**
 * Renderer-independent helpers over `RichContent` (BlockNote-shaped JSON).
 * Used by previews, titles, search and (later) AI context and Markdown export.
 */
import type { ContentBlock, InlineContent, RichBlockType, RichContent, TableCell, TableContent } from "../types";

export function isTableContent(content: ContentBlock["content"]): content is TableContent {
  return typeof content === "object" && content !== null && !Array.isArray(content) && content.type === "tableContent";
}

/** Normalises string / array content into inline nodes. */
export function inlineOf(content: ContentBlock["content"] | TableCell | undefined): InlineContent[] {
  if (content === undefined || content === null) return [];
  if (typeof content === "string") return content ? [{ type: "text", text: content, styles: {} }] : [];
  if (Array.isArray(content)) return content;
  if ("type" in content && content.type === "tableCell") return content.content ?? [];
  return [];
}

export function inlineText(content: ContentBlock["content"] | TableCell | undefined): string {
  return inlineOf(content)
    .map((n) => (n.type === "link" ? n.content.map((c) => c.text).join("") : n.text))
    .join("");
}

/** Plain text of a whole document, one line per block (tables tab-separated). */
export function toPlainText(blocks: RichContent, depth = 0): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (isTableContent(b.content)) {
      for (const row of b.content.rows) lines.push(row.cells.map((c) => inlineText(c)).join("\t"));
    } else if (b.type === "image") {
      // An image's caption is its text (search, AI context, titles).
      const caption = typeof b.props?.caption === "string" ? b.props.caption.trim() : "";
      if (caption) lines.push("  ".repeat(depth) + caption);
    } else {
      const text = inlineText(b.content);
      if (text) lines.push("  ".repeat(depth) + text);
    }
    if (b.children?.length) lines.push(toPlainText(b.children, depth + 1));
  }
  return lines.filter(Boolean).join("\n");
}

/** Title = first heading text, else first non-empty line. */
export function deriveTitle(blocks: RichContent, fallback = "Untitled"): string {
  const heading = blocks.find((b) => b.type === "heading" && inlineText(b.content).trim());
  const text = heading ? inlineText(heading.content) : toPlainText(blocks).split("\n")[0];
  const title = text?.trim();
  return title ? title.slice(0, 120) : fallback;
}

export function isEmptyContent(blocks: RichContent): boolean {
  return blocks.every(
    (b) =>
      !isTableContent(b.content) &&
      b.type !== "codeBlock" &&
      b.type !== "divider" &&
      b.type !== "image" &&
      !inlineText(b.content).trim() &&
      !b.children?.length,
  );
}

/**
 * Removes an inline style (e.g. `fontFamily`) from every text node — or, for
 * `textAlignment`, resets every block's alignment to the default — so an
 * item-level setting applies to all of the content. Returns a new tree.
 */
export function stripInlineStyle(blocks: RichContent, key: string): RichContent {
  const stripNodes = (nodes: InlineContent[]): InlineContent[] =>
    nodes.map((n) => {
      if (n.type === "link") return { ...n, content: n.content.map((c) => ({ ...c, styles: without(c.styles, key) })) };
      return { ...n, styles: without(n.styles, key) };
    });
  const stripContent = (content: ContentBlock["content"]): ContentBlock["content"] => {
    if (!content || typeof content === "string") return content;
    if (Array.isArray(content)) return stripNodes(content);
    return {
      ...content,
      rows: content.rows.map((row) => ({
        cells: row.cells.map((cell) =>
          typeof cell === "string"
            ? cell
            : Array.isArray(cell)
              ? stripNodes(cell)
              : {
                  ...cell,
                  content: stripNodes(cell.content ?? []),
                  // Table cells carry their own alignment.
                  ...(key === "textAlignment" && cell.props && "textAlignment" in cell.props ? { props: { ...cell.props, textAlignment: "left" } } : {}),
                },
        ),
      })),
    };
  };
  return blocks.map((b) => {
    const props =
      key === "textAlignment" && b.props && "textAlignment" in b.props ? { ...b.props, textAlignment: "left" } : b.props;
    return {
      ...b,
      ...(props ? { props } : {}),
      ...(b.content !== undefined ? { content: stripContent(b.content) } : {}),
      ...(b.children ? { children: stripInlineStyle(b.children, key) } : {}),
    };
  });
}

function without<T extends object>(styles: T | undefined, key: string): T {
  if (!styles || !(key in styles)) return (styles ?? {}) as T;
  const copy = { ...styles } as Record<string, unknown>;
  delete copy[key];
  return copy as T;
}

// ---------------------------------------------------------------------------
// Block templates
// ---------------------------------------------------------------------------

const emptyRow = (n: number) => ({ cells: Array.from({ length: n }, () => "") as TableCell[] });

export function templateFor(blockType: RichBlockType): RichContent {
  switch (blockType) {
    case "text":
      return [{ type: "heading", props: { level: 2 }, content: "" }, { type: "paragraph", content: "" }];
    case "todo":
      return [{ type: "checkListItem", props: { checked: false }, content: "" }];
    case "table":
      return [
        {
          type: "table",
          content: {
            type: "tableContent",
            headerRows: 1,
            rows: [{ cells: ["Column 1", "Column 2", "Column 3"] }, emptyRow(3), emptyRow(3)],
          },
        },
      ];
    case "code":
      return [{ type: "codeBlock", props: { language: "typescript" }, content: "" }];
  }
}

/** Default canvas size (scene units) for a new block of each type. */
export const BLOCK_SIZE: Record<RichBlockType, { width: number; height: number }> = {
  text: { width: 380, height: 220 },
  todo: { width: 340, height: 200 },
  table: { width: 520, height: 200 },
  code: { width: 520, height: 240 },
};

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Shown wherever a page has no title yet. */
export const UNTITLED_PAGE = "Untitled";

/** Default canvas size of a page preview: compact card vs. content preview. */
export const PAGE_PREVIEW_SIZE = {
  card: { width: 300, height: 136 },
  content: { width: 440, height: 520 },
} as const;

/** A short plain-text excerpt of a page for cards and lists. */
export function pageExcerpt(blocks: RichContent, maxLength = 160): string {
  const text = toPlainText(blocks).replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}
