/**
 * `ParsedContent` (F28): pasted, imported or AI-produced content as a typed,
 * provider-independent tree. Every node carries the source span it came from:
 * UTF-16 offsets into the original input, `input.slice(start, end)`.
 *
 * Renderer-agnostic: no React, Excalidraw or BlockNote types.
 */

export interface SourceSpan {
  start: number;
  end: number;
}

export type InlineMark = "strong" | "emphasis" | "code" | "strike";

export type ParsedInline =
  | { type: "text"; text: string; marks?: InlineMark[]; span: SourceSpan }
  | { type: "link"; href: string; children: Extract<ParsedInline, { type: "text" }>[]; span: SourceSpan }
  /** An image reference (never fetched or embedded here). */
  | { type: "image"; src: string; alt: string; span: SourceSpan };

export interface ParsedListItem {
  /** true/false for checklist items (`- [x]`), null for plain items. */
  checked: boolean | null;
  /** Plain text of the item's first paragraph. */
  text: string;
  inline: ParsedInline[];
  /** Nested lists and further paragraphs. */
  children: ParsedBlock[];
  span: SourceSpan;
}

export type TableAlign = "left" | "center" | "right" | null;

export type ParsedBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string; inline: ParsedInline[]; span: SourceSpan }
  | { type: "paragraph"; text: string; inline: ParsedInline[]; span: SourceSpan }
  | { type: "list"; ordered: boolean; start?: number; items: ParsedListItem[]; span: SourceSpan }
  | { type: "table"; columns: string[]; rows: string[][]; align: TableAlign[]; span: SourceSpan }
  | { type: "code"; language?: string; source: string; span: SourceSpan }
  | { type: "quote"; children: ParsedBlock[]; span: SourceSpan }
  /** An image on its own line. */
  | { type: "image"; src: string; alt: string; span: SourceSpan }
  | { type: "divider"; span: SourceSpan };

export type ParsedBlockType = ParsedBlock["type"];

/**
 * A heading and everything up to the next heading of the same or a higher
 * level. The content before the first heading is a section without one.
 */
export interface ParsedSection {
  /** Index of the heading in `blocks`, absent for the lead-in before the first heading. */
  headingIndex?: number;
  heading?: { text: string; level: number };
  /** Heading texts from the top level down to this section's own. */
  path: string[];
  /** Indexes into `blocks` of this section's own content (not its subsections'). */
  blockIndexes: number[];
  subsections: ParsedSection[];
  /** From the heading to the end of the last subsection. */
  span: SourceSpan;
}

export type ContentFormat = "markdown" | "plain";

export interface ParsedContent {
  version: 1;
  format: ContentFormat;
  /** Length of the input the spans refer to. */
  length: number;
  /** Top-level blocks in document order. */
  blocks: ParsedBlock[];
  /** Heading outline over `blocks`: the lead-in (if any), then top-level sections. */
  sections: ParsedSection[];
}
