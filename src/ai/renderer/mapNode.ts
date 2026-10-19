/**
 * `VisualNode` → `ProposedChange` (F30, PRD §13.15.3's node-mapping table).
 * Every case reuses an existing F19 change kind — `create_block`,
 * `create_shape` or `create_page` — the same vocabulary a manual creation or
 * an Ask AI Insert produces; nothing here talks to Excalidraw or BlockNote
 * directly. Content is never HTML: `text`/`page` Markdown goes through the
 * app's own Markdown → rich-content parser (`parseMarkdown`, injected —
 * see `render.ts`), the same one Ask AI Insert already uses.
 */
import { normalizeCodeLanguage } from "@/components/blocks/editor/codeLanguages";
import type { ContentBlock, InlineContent, RichContent, TableCell } from "@/domain/types";
import type { ProposedChange } from "@/ai/changes/changeSet";
import { getNodeSemantics, type NodeSemantics } from "@/domain/canvas/diagram";
import type { PlanShape, VisualNode } from "@/ai/visual-plan/types";
import { headingFontSize, tableColumnWidths } from "./measure";
import type { Box } from "./types";

export type ParseMarkdown = (markdown: string) => RichContent;

/** `code`, **bold**, *emphasis* and [links](url) — the inline Markdown a model writes in a table cell. */
const CELL_INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\*([^*\s][^*]*)\*/g;

/**
 * A table cell's inline Markdown as styled text, so `OILRATRC` shows as code rather than with its backticks. A cell
 * without any stays a plain string.
 */
export function markdownCell(text: string): TableCell {
  const out: InlineContent[] = [];
  let at = 0;
  for (const m of text.matchAll(CELL_INLINE)) {
    if (m.index! > at) out.push({ type: "text", text: text.slice(at, m.index), styles: {} });
    if (m[1] !== undefined) out.push({ type: "text", text: m[1], styles: { code: true } });
    else if (m[2] !== undefined) out.push({ type: "text", text: m[2], styles: { bold: true } });
    else if (m[3] !== undefined) out.push({ type: "link", href: m[4]!, content: [{ type: "text", text: m[3], styles: {} }] });
    else out.push({ type: "text", text: m[5]!, styles: { italic: true } });
    at = m.index! + m[0].length;
  }
  if (!out.length) return text;
  if (at < text.length) out.push({ type: "text", text: text.slice(at), styles: {} });
  return out;
}

/** A create_block change kind that isn't F19's original 4 — `frame`/`fontSize` are new, optional, F30-only fields (see F19 change notes). */
export type BlockNodeChange = {
  kind: "create_block";
  key: string;
  blockType: "text" | "todo" | "table" | "code";
  content: RichContent;
  box: Box;
  frame?: "card" | "none";
  fontSize?: number;
  textAlign?: "left" | "center" | "right";
  stableNodeKey?: string;
  /** A card's architecture kind (Lens Phase 2). */
  semantics?: NodeSemantics;
};

export type MappedChange =
  | BlockNodeChange
  | { kind: "create_shape"; key: string; shape: PlanShape; label?: string; box: Box; stableNodeKey?: string; semantics?: NodeSemantics }
  | { kind: "create_page"; key: string; title: string; content: RichContent; box: Box; stableNodeKey?: string }
  | Extract<ProposedChange, { kind: "create_frame" }>;

/** An h3 title block, when the node has one — the same convention Ask AI Insert already uses (`ai/selection/actions.ts`'s `tasksToContent`). */
function titleBlock(node: VisualNode): ContentBlock[] {
  return node.title ? [{ type: "heading", props: { level: 3 }, content: node.title }] : [];
}

/**
 * Whether a card's title carries the accent (Wave C: emphasis means something): the model's analysis and
 * high-importance cards do; an ordinary card's title is a plain label.
 */
const accented = (node: VisualNode) => node.origin === "analysis" || node.importance === "high";

/**
 * The model's own analysis (`origin: "analysis"`, D-R2.1) is tagged in its title, so it is never read as a fact the
 * content states. Shapes hold only a label, so they carry no tag (the prompt keeps analysis in text nodes). Applied
 * wherever a node becomes content — a first run, an update, and the fingerprint reconciliation compares — so all three
 * see the same title.
 */
export function withAnalysisTag(n: VisualNode): VisualNode {
  if (n.origin !== "analysis" || n.type === "shape" || n.type === "heading" || n.type === "group") return n;
  return { ...n, title: n.title ? `Analysis · ${n.title}` : "Analysis" };
}

export function mapNode(node: VisualNode, box: Box, parseMarkdown: ParseMarkdown): MappedChange {
  const content = mapContent(node, box, parseMarkdown);
  // A card's kind (Lens Phase 2) rides on its block, as a shape's rides on the shape.
  const mapped = content.kind === "create_block" && node.kind ? { ...content, semantics: { kind: node.kind } } : content;
  const change = mapped.kind === "create_block" && mapped.frame !== "none" && node.title && !accented(node) ? { ...mapped, plainTitle: true as const } : mapped;
  // A frame is never linked to the content source: its title object carries the section's key instead (see `ungroup`).
  return node.stableKey && change.kind !== "create_frame" ? { ...change, stableNodeKey: node.stableKey } : change;
}

function mapContent(node: VisualNode, box: Box, parseMarkdown: ParseMarkdown): MappedChange {
  switch (node.type) {
    case "heading": {
      // "Simple canvas text" (PRD §13.15.3): a frameless block, sized like a title, never a bordered card.
      // The document title and a section's title (F42) are larger, and centred across their box.
      const centred = node.role === "title" || node.role === "section" || node.role === "subtitle";
      return {
        kind: "create_block",
        key: node.id,
        blockType: "text",
        frame: "none",
        fontSize: headingFontSize(node.role),
        ...(centred ? { textAlign: "center" as const } : {}),
        content: [{ type: "paragraph", content: node.content.text }],
        box,
      };
    }
    case "text":
      return { kind: "create_block", key: node.id, blockType: "text", content: [...titleBlock(node), ...parseMarkdown(node.content.markdown)], box };
    case "todo":
      return {
        kind: "create_block",
        key: node.id,
        blockType: "todo",
        content: [...titleBlock(node), ...node.content.items.map((i) => ({ type: "checkListItem" as const, props: { checked: i.checked }, content: i.text }))],
        box,
      };
    case "table":
      return {
        kind: "create_block",
        key: node.id,
        blockType: "table",
        content: [
          ...titleBlock(node),
          {
            type: "table",
            content: {
              type: "tableContent",
              headerRows: 1,
              // The widths the table was measured with (Wave D), so a long-text column reads as a column, not a sliver.
              columnWidths: tableColumnWidths(node.content.columns, node.content.rows),
              rows: [node.content.columns, ...node.content.rows].map((cells) => ({ cells: cells.map(markdownCell) })),
            },
          },
        ],
        box,
      };
    case "code":
      return {
        kind: "create_block",
        key: node.id,
        blockType: "code",
        content: [...titleBlock(node), { type: "codeBlock", props: { language: normalizeCodeLanguage(node.content.language) }, content: node.content.source }],
        box,
      };
    case "page":
      return { kind: "create_page", key: node.id, title: node.content.title, content: parseMarkdown(node.content.markdown), box };
    case "shape": {
      // An architecture component's kind, sublabel, tag and details, normalised (empty fields dropped).
      const { shape, label, ...fields } = node.content;
      const semantics = getNodeSemantics({ customData: { acuteNode: fields } });
      return { kind: "create_shape", key: node.id, shape, label, box, ...(semantics ? { semantics } : {}) };
    }
    case "group":
      // A section: its frame (members are attached by `render.ts`, which knows them); the title is a heading of its own.
      return { kind: "create_frame", key: node.id, title: node.content.label, box, children: [] };
    case "image":
      // Unreachable: no template in the F29 registry allows an "image" node, so a validated plan never contains one.
      // Rendering one for real needs a `create_image` change kind (F19) referencing an existing asset — deferred until a producer needs it.
      throw new Error(`renderVisualPlan: node "${node.id}" has type "image", which no template allows; this indicates a bug upstream of validateVisualPlan`);
  }
}
