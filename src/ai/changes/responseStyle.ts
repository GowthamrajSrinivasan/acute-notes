/**
 * How AI-generated objects look (AI settings → Response styling): title
 * background, text colour and font, card background and connector style.
 *
 * Applied to every change set when it is proposed (`PendingChanges`), so
 * Visualize, Ask AI and MCP clients all follow it, and the review preview
 * shows what Accept will write. Only what the producer left unset is styled:
 * an explicit colour or connector style in a change set is kept.
 *
 * "Titles" are the title a card starts with (an h3, the renderer's and Ask
 * AI's convention) and frameless headings (document, section and node titles:
 * frameless text with a font size of its own).
 */
import type { ContentBlock, InlineContent, InlineStyles, RichContent } from "@/domain/types";
import type { ChangeSet, ProposedChange } from "./changeSet";

/** Connector drawing: right-angle routes around objects, or Excalidraw's straight arrow. */
export type ConnectorStyle = "elbow" | "straight";

export interface ResponseStyle {
  /** BlockNote palette name ("orange") or "default" (none). */
  titleBackground: string;
  /** BlockNote palette name or "default" (the theme's text colour). */
  titleColor: string;
  /** A `BlockFontId` ("inter") or "default" (the item's own font). */
  titleFont: string;
  /** Card fill, a canvas colour (hex). */
  cardBackground: string;
  connectors: ConnectorStyle;
}

export const DEFAULT_RESPONSE_STYLE: ResponseStyle = {
  titleBackground: "orange",
  titleColor: "default",
  titleFont: "default",
  cardBackground: "#ffffff",
  connectors: "elbow",
};

let source: () => ResponseStyle = () => DEFAULT_RESPONSE_STYLE;

/** The styling in effect (AI settings register theirs, see `state/uiPrefs.ts`). */
export function currentResponseStyle(): ResponseStyle {
  return source();
}

export function setResponseStyleSource(next: () => ResponseStyle): void {
  source = next;
}

const unset = (v: unknown) => v === undefined || v === "" || v === "default";

/** Gives the title's text the font (an inline style), except text the producer gave a font of its own. */
function withFont(content: ContentBlock["content"], font: string): ContentBlock["content"] {
  if (typeof content === "string") return content ? [{ type: "text", text: content, styles: { fontFamily: font } }] : content;
  if (!Array.isArray(content)) return content;
  type Text = { type: "text"; text: string; styles: InlineStyles };
  const styled = (n: Text): Text => (n.styles?.fontFamily ? n : { ...n, styles: { ...n.styles, fontFamily: font } });
  return content.map((n) => (n.type === "link" ? { ...n, content: n.content.map((c) => styled(c)) } : styled(n))) as InlineContent[];
}

function styleTitle(block: ContentBlock, style: ResponseStyle, accent = true): ContentBlock {
  const props = { ...block.props };
  if (accent && unset(props.backgroundColor) && style.titleBackground !== "default") props.backgroundColor = style.titleBackground;
  if (unset(props.textColor) && style.titleColor !== "default") props.textColor = style.titleColor;
  const content = style.titleFont !== "default" ? withFont(block.content, style.titleFont) : block.content;
  return { ...block, props, ...(content !== undefined ? { content } : {}) };
}

function styleContent(change: Extract<ProposedChange, { kind: "create_block" }>, style: ResponseStyle): RichContent {
  // A frameless heading: the whole item is the title.
  if (change.frame === "none") return change.fontSize !== undefined ? change.content.map((b) => styleTitle(b, style)) : change.content;
  const [first, ...rest] = change.content;
  return first?.type === "heading" ? [styleTitle(first, style, !change.plainTitle), ...rest] : change.content;
}

export function withResponseStyle(set: ChangeSet, style: ResponseStyle): ChangeSet {
  const changes = set.changes.map((c): ProposedChange => {
    if (c.kind === "create_block") {
      const card = c.frame !== "none";
      return {
        ...c,
        content: styleContent(c, style),
        ...(card && c.backgroundColor === undefined && style.cardBackground !== DEFAULT_RESPONSE_STYLE.cardBackground
          ? { backgroundColor: style.cardBackground }
          : {}),
      };
    }
    if (c.kind === "connect" && c.routing === undefined) return { ...c, routing: style.connectors };
    return c;
  });
  return { ...set, changes };
}
