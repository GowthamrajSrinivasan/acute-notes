/**
 * "Update source from this edit" (F39, PRD §13.15.20): the one, explicit way a
 * manual edit flows back into a content source. Directionality is one-way by
 * default — nothing here ever runs implicitly; the Origin section calls it
 * only when the user asks.
 *
 * Supported where the edit maps onto a known span of the source: a local-tier
 * text, todo, table or code node (the parser recorded its `sourceSpan`). The
 * object's current content, as Markdown, replaces that span; the node's
 * title heading (added above it at render time) is left out, since it isn't
 * part of the span.
 */
import { contentToMarkdown } from "@/domain/content/markdown";
import { inlineText } from "@/domain/content/richContent";
import type { RichContent } from "@/domain/types";
import type { VisualNode } from "@/ai/visual-plan/types";

const SPLICEABLE = new Set<VisualNode["type"]>(["text", "todo", "table", "code"]);

/** Whether an edit to this node's object can be written back into the source text. */
export function canUpdateSourceFrom(node: VisualNode | undefined, tier: "local" | "ai"): node is VisualNode & { sourceSpan: { start: number; end: number } } {
  return tier === "local" && !!node && SPLICEABLE.has(node.type) && !!node.sourceSpan && node.sourceSpan.end > node.sourceSpan.start;
}

/** The object's content as the Markdown to put back into the source (without the title heading the renderer added). */
export function editedMarkdown(node: VisualNode, content: RichContent): string {
  const [first, ...rest] = content;
  const titled = !!node.title && first?.type === "heading" && inlineText(first.content).trim() === node.title.trim();
  return contentToMarkdown(titled ? rest : content).trim();
}

/** The source text with the node's span replaced by `markdown`. */
export function spliceSource(text: string, span: { start: number; end: number }, markdown: string): string {
  return `${text.slice(0, span.start)}${markdown}${text.slice(span.end)}`;
}
