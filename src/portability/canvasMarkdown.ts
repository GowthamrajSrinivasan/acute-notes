/**
 * A canvas as Markdown, converted from its `.acute.json` export (the bundle
 * is the source of truth; this is a readable view of it, not a round trip).
 *
 *   # Canvas title
 *
 *   …every object, in reading order (top to bottom; left to right within a row):
 *     rich block    → its content as Markdown
 *     page preview  → "## Page title" + the page's content
 *     frame         → "## Frame name" (the objects inside follow it)
 *     labelled shape, free text → the text as a paragraph
 *     image         → a placeholder (the binary stays in the JSON)
 *
 *   ## Connections
 *   - Source → Target (Relation) — "arrow label"
 *
 * Arrows become the Connections list; labels go with their container;
 * freehand strokes, lines and unlabelled shapes have no text and are left out.
 * `MarkdownOptions` leave out details (all on by default). Pure: no renderer,
 * no storage.
 */
import { getArrowRelation, getEmbedRef, type SceneElement } from "@/domain/canvas/adapter";
import { contentToMarkdown } from "@/domain/content/markdown";
import type { RichContent } from "@/domain/types";
import type { AcuteBundle, BundleCanvas } from "./bundle";

/** Objects whose tops are this close count as one row (read left to right). */
const ROW_TOLERANCE = 24;
const NAME_LENGTH = 60;
const SHAPES = new Set(["rectangle", "diamond", "ellipse"]);

type El = SceneElement & { name?: string | null };

/** How much a Markdown export carries. Every option is on by default; the canvas's text is always kept. */
export interface MarkdownOptions {
  /** Each page preview's content under its "## Page title" (off: the title only). */
  pageContent: boolean;
  /** A "## Frame name" heading for each frame. */
  frameHeadings: boolean;
  /** An "*(image)*" line where each image is. */
  imagePlaceholders: boolean;
  /** The "## Connections" list. */
  connections: boolean;
  /** Each connection's type, e.g. "(Depends on)". */
  connectionTypes: boolean;
}

export const MARKDOWN_OPTION_KEYS = ["pageContent", "frameHeadings", "imagePlaceholders", "connections", "connectionTypes"] as const satisfies readonly (keyof MarkdownOptions)[];

export const DEFAULT_MARKDOWN_OPTIONS: MarkdownOptions = { pageContent: true, frameHeadings: true, imagePlaceholders: true, connections: true, connectionTypes: true };

interface Item {
  el: El;
  /** The Markdown for the body. */
  markdown: string;
  /** How a connection names it. */
  name: string;
}

/** The bundle's first canvas (or `canvasId`) as Markdown. */
export function canvasToMarkdown(bundle: AcuteBundle, canvasId?: string, options: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): string {
  const canvas = canvasId ? bundle.canvases.find((c) => c.id === canvasId) : bundle.canvases[0];
  if (!canvas) throw new Error(canvasId ? `Canvas ${canvasId} is not in this file` : "This file has no canvas");
  const docs = new Map(bundle.documents.map((d) => [d.id, d] as const));
  const elements = (canvas.elements as unknown as El[]).filter((el) => !el.isDeleted);

  const labels = new Map<string, string>();
  for (const el of elements) if (el.type === "text" && el.containerId && el.text?.trim()) labels.set(el.containerId, el.text.trim());

  const items = new Map<string, Item>();
  for (const el of elements) {
    const item = itemOf(el, labels, docs, options);
    if (item) items.set(el.id, item);
  }

  const sections = [`# ${title(canvas)}`, ...readingOrder([...items.values()]).flatMap((i) => (i.markdown ? [i.markdown] : []))];
  const connections = elements.flatMap((el) => {
    if (!options.connections || el.type !== "arrow") return [];
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    if (!from || !to) return [];
    const relation = options.connectionTypes ? getArrowRelation(el) : undefined;
    const label = labels.get(el.id);
    return [`- ${nameOf(items, from)} → ${nameOf(items, to)}${relation ? ` (${relationLabel(relation)})` : ""}${label ? ` — "${oneLine(label)}"` : ""}`];
  });
  if (connections.length) sections.push(`## Connections\n\n${connections.join("\n")}`);
  return `${sections.join("\n\n")}\n`;
}

/** An item with empty `markdown` still names its connection ends; it just adds no text. */
function itemOf(el: El, labels: ReadonlyMap<string, string>, docs: ReadonlyMap<string, AcuteBundle["documents"][number]>, options: MarkdownOptions): Item | null {
  if (el.type === "embeddable") {
    const ref = getEmbedRef(el);
    if (ref?.kind === "rich-block") {
      const doc = docs.get(ref.documentId);
      const markdown = doc ? contentToMarkdown(doc.snapshot as unknown as RichContent).trim() : "";
      return markdown ? { el, markdown, name: firstLine(markdown) || "Block" } : null;
    }
    if (ref?.kind === "page-preview") {
      const page = docs.get(ref.pageId);
      const pageTitle = page?.title.trim() || "Untitled page";
      const body = page && options.pageContent ? contentToMarkdown(page.snapshot as unknown as RichContent).trim() : "";
      return { el, markdown: body ? `## ${pageTitle}\n\n${body}` : `## ${pageTitle}`, name: pageTitle };
    }
    return null;
  }
  if (el.type === "frame" || el.type === "magicframe") {
    const name = el.name?.trim() || "Frame";
    return { el, markdown: options.frameHeadings ? `## ${name}` : "", name };
  }
  if (el.type === "text" && !el.containerId && el.text?.trim()) {
    const text = el.text.trim();
    return { el, markdown: text, name: firstLine(text) };
  }
  if (SHAPES.has(el.type) && labels.has(el.id)) {
    const label = labels.get(el.id)!;
    return { el, markdown: label, name: firstLine(label) };
  }
  if (el.type === "image") return { el, markdown: options.imagePlaceholders ? "*(image)*" : "", name: "Image" };
  return null;
}

/** Top to bottom; objects starting within `ROW_TOLERANCE` of a row's first object share its row, left to right. */
function readingOrder(items: Item[]): Item[] {
  const byTop = [...items].sort((a, b) => a.el.y - b.el.y || a.el.x - b.el.x);
  const rows: Item[][] = [];
  for (const item of byTop) {
    const row = rows.at(-1);
    if (row && item.el.y - row[0]!.el.y <= ROW_TOLERANCE) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.el.x - b.el.x));
}

function nameOf(items: ReadonlyMap<string, Item>, id: string): string {
  return items.get(id)?.name ?? "(object)";
}

/** "explained_by" → "Explained by". */
function relationLabel(relation: string): string {
  const words = relation.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function title(canvas: BundleCanvas): string {
  return canvas.title.trim() || "Untitled canvas";
}

/** The first line of some Markdown, without its block markers, shortened. */
function firstLine(markdown: string): string {
  const line = markdown.split("\n").find((l) => l.trim()) ?? "";
  return oneLine(line.replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+\.\s+|>\s*)/, "").replace(/[*_~`]/g, ""));
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > NAME_LENGTH ? `${flat.slice(0, NAME_LENGTH - 1)}…` : flat;
}
