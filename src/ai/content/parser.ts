/**
 * Content parser (F28): Markdown (CommonMark + GFM tables, task lists and
 * strikethrough) or plain text → `ParsedContent` with source spans.
 *
 * - Pure and deterministic: the same input always gives the same tree.
 * - The Markdown parser (mdast-util-from-markdown + GFM) is loaded on first
 *   use, so it costs nothing until content is actually parsed.
 * - Raw HTML is kept as plain text, never interpreted.
 * - Input over `MAX_CONTENT_CHARS` is refused with `ContentTooLargeError`
 *   (a message the UI can show as is), before any parsing.
 */
import { recoverStructure } from "./structure";
import type * as Mdast from "mdast";
import type { ContentFormat, InlineMark, ParsedBlock, ParsedContent, ParsedInline, ParsedListItem, ParsedSection, SourceSpan, TableAlign } from "./types";

/** Largest input accepted (≈ 50 pages of text). */
export const MAX_CONTENT_CHARS = 200_000;

export class ContentTooLargeError extends Error {
  constructor(
    readonly length: number,
    readonly limit = MAX_CONTENT_CHARS,
  ) {
    super(
      `This content is ${length.toLocaleString("en-US")} characters; the limit is ${limit.toLocaleString("en-US")}. Split it into smaller parts and visualize them one at a time.`,
    );
    this.name = "ContentTooLargeError";
  }
}

export interface ParseOptions {
  /** "markdown" (default; also right for AI replies) or "plain" (no syntax is interpreted). */
  format?: ContentFormat;
}

type FromMarkdown = (input: string) => Mdast.Root;

let loading: Promise<FromMarkdown> | null = null;

/** Loads the Markdown parser once. */
export function loadMarkdownParser(): Promise<FromMarkdown> {
  loading ??= Promise.all([import("mdast-util-from-markdown"), import("micromark-extension-gfm"), import("mdast-util-gfm")]).then(
    ([{ fromMarkdown }, { gfm }, { gfmFromMarkdown }]) =>
      (input: string) => fromMarkdown(input, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }),
  );
  return loading;
}

/** Parses content, loading the Markdown parser on first use. */
export async function parseContent(input: string, options: ParseOptions = {}): Promise<ParsedContent> {
  if (input.length > MAX_CONTENT_CHARS) throw new ContentTooLargeError(input.length);
  if (options.format === "plain") return parsePlainText(input);
  return parseMarkdownWith(await loadMarkdownParser(), input);
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/** Paragraphs separated by blank lines; single line breaks stay inside a paragraph. */
export function parsePlainText(input: string): ParsedContent {
  if (input.length > MAX_CONTENT_CHARS) throw new ContentTooLargeError(input.length);
  const blocks: ParsedBlock[] = [];
  const re = /\S[\s\S]*?(?=\r?\n[ \t]*\r?\n|\s*$)/g;
  for (const m of input.matchAll(re)) {
    const text = m[0].replace(/\s+$/, "");
    const span = { start: m.index!, end: m.index! + text.length };
    blocks.push({ type: "paragraph", text, inline: [{ type: "text", text, span }], span });
  }
  const recovered = recoverStructure(blocks, input);
  return { version: 1, format: "plain", length: input.length, blocks: recovered, sections: buildSections(recovered, input.length) };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

/** Parses Markdown with an already loaded parser (see `loadMarkdownParser`). */
export function parseMarkdownWith(fromMarkdown: FromMarkdown, input: string): ParsedContent {
  if (input.length > MAX_CONTENT_CHARS) throw new ContentTooLargeError(input.length);
  const root = fromMarkdown(input);
  const definitions = new Map<string, { url: string }>();
  collectDefinitions(root, definitions);
  const ctx: Ctx = { input, definitions };
  // Structure a reader sees but Markdown doesn't mark (bold-line titles, tab-separated tables): see `structure.ts`.
  const blocks = recoverStructure(root.children.flatMap((n) => convertBlock(n, ctx)), input);
  return { version: 1, format: "markdown", length: input.length, blocks, sections: buildSections(blocks, input.length) };
}

interface Ctx {
  input: string;
  definitions: Map<string, { url: string }>;
}

function spanOf(node: Mdast.Node): SourceSpan {
  return { start: node.position?.start.offset ?? 0, end: node.position?.end.offset ?? 0 };
}

function collectDefinitions(node: Mdast.Nodes, out: Map<string, { url: string }>): void {
  if (node.type === "definition") out.set(node.identifier.toLowerCase(), { url: node.url });
  if ("children" in node) for (const child of node.children) collectDefinitions(child as Mdast.Nodes, out);
}

function convertBlock(node: Mdast.RootContent, ctx: Ctx): ParsedBlock[] {
  const span = spanOf(node);
  switch (node.type) {
    case "heading": {
      const inline = convertInline(node.children, ctx);
      return [{ type: "heading", level: node.depth, text: textOf(inline), inline, span }];
    }
    case "paragraph": {
      const inline = convertInline(node.children, ctx);
      const only = inline.filter((i) => !(i.type === "text" && !i.text.trim()));
      const image = only.length === 1 && only[0]!.type === "image" ? only[0] : null;
      if (image) return [{ type: "image", src: image.src, alt: image.alt, span }];
      return [{ type: "paragraph", text: textOf(inline), inline, span }];
    }
    case "list":
      return [
        {
          type: "list",
          ordered: !!node.ordered,
          ...(node.ordered && typeof node.start === "number" ? { start: node.start } : {}),
          items: node.children.map((item) => convertListItem(item, ctx)),
          span,
        },
      ];
    case "table": {
      const [head, ...body] = node.children;
      const cells = (row: Mdast.TableRow | undefined) => row?.children.map((c) => textOf(convertInline(c.children, ctx)).trim()) ?? [];
      const columns = cells(head);
      return [
        {
          type: "table",
          columns,
          rows: body.map((row) => {
            const r = cells(row);
            return columns.map((_, i) => r[i] ?? "");
          }),
          align: columns.map((_, i) => (node.align?.[i] ?? null) as TableAlign),
          span,
        },
      ];
    }
    case "code":
      return [{ type: "code", ...(node.lang ? { language: node.lang } : {}), source: node.value, span }];
    case "blockquote":
      return [{ type: "quote", children: node.children.flatMap((n) => convertBlock(n, ctx)), span }];
    case "thematicBreak":
      return [{ type: "divider", span }];
    case "html": {
      // Raw HTML is content to read, never markup to render.
      const text = node.value;
      return text.trim() ? [{ type: "paragraph", text, inline: [{ type: "text", text, span }], span }] : [];
    }
    case "footnoteDefinition":
      return node.children.flatMap((n) => convertBlock(n, ctx));
    default:
      // definitions (link targets), yaml, …: not content.
      return [];
  }
}

function convertListItem(item: Mdast.ListItem, ctx: Ctx): ParsedListItem {
  const [first, ...rest] = item.children;
  const lead = first?.type === "paragraph" ? convertInline(first.children, ctx) : [];
  const children = (first?.type === "paragraph" ? rest : item.children).flatMap((n) => convertBlock(n, ctx));
  return { checked: typeof item.checked === "boolean" ? item.checked : null, text: textOf(lead), inline: lead, children, span: spanOf(item) };
}

type TextRun = Extract<ParsedInline, { type: "text" }>;

function convertInline(nodes: readonly Mdast.PhrasingContent[], ctx: Ctx, marks: InlineMark[] = []): ParsedInline[] {
  const out: ParsedInline[] = [];
  const text = (t: string, span: SourceSpan, extra: InlineMark[] = []) => {
    const all = [...marks, ...extra];
    const run: TextRun = { type: "text", text: t, span };
    if (all.length) run.marks = all;
    out.push(run);
  };
  for (const node of nodes) {
    const span = spanOf(node);
    switch (node.type) {
      case "text":
        text(node.value, span);
        break;
      case "inlineCode":
        text(node.value, span, ["code"]);
        break;
      case "break":
        text("\n", span);
        break;
      case "html":
        text(node.value, span);
        break;
      case "strong":
      case "emphasis":
      case "delete":
        out.push(...convertInline(node.children, ctx, [...marks, node.type === "delete" ? "strike" : node.type]));
        break;
      case "link":
      case "linkReference": {
        const href = node.type === "link" ? node.url : (ctx.definitions.get(node.identifier.toLowerCase())?.url ?? "");
        const children = convertInline(node.children, ctx, marks).flatMap((c) => (c.type === "text" ? [c] : c.type === "link" ? c.children : []));
        if (href) out.push({ type: "link", href, children, span });
        else out.push(...children);
        break;
      }
      case "image":
        out.push({ type: "image", src: node.url, alt: node.alt ?? "", span });
        break;
      case "imageReference": {
        const src = ctx.definitions.get(node.identifier.toLowerCase())?.url;
        if (src) out.push({ type: "image", src, alt: node.alt ?? "", span });
        break;
      }
      default:
        // footnote references and other markers carry no readable text.
        break;
    }
  }
  return out;
}

/** Readable text of inline content (links by their text; images left out). */
export function textOf(inline: readonly ParsedInline[]): string {
  return inline.map((i) => (i.type === "text" ? i.text : i.type === "link" ? i.children.map((c) => c.text).join("") : "")).join("");
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** The heading outline over `blocks` (see `ParsedSection`). */
export function buildSections(blocks: readonly ParsedBlock[], length: number): ParsedSection[] {
  const top: ParsedSection[] = [];
  const stack: ParsedSection[] = [];
  let lead: ParsedSection | null = null;
  const close = (s: ParsedSection, end: number) => {
    s.span = { start: s.span.start, end };
  };
  blocks.forEach((b, i) => {
    if (b.type === "heading") {
      while (stack.length && stack.at(-1)!.heading!.level >= b.level) close(stack.pop()!, b.span.start);
      const section: ParsedSection = {
        headingIndex: i,
        heading: { text: b.text, level: b.level },
        path: [...stack.map((s) => s.heading!.text), b.text],
        blockIndexes: [],
        subsections: [],
        span: { start: b.span.start, end: b.span.end },
      };
      (stack.at(-1)?.subsections ?? top).push(section);
      stack.push(section);
      return;
    }
    const owner = stack.at(-1);
    if (owner) owner.blockIndexes.push(i);
    else {
      lead ??= { path: [], blockIndexes: [], subsections: [], span: { start: b.span.start, end: b.span.end } };
      lead.blockIndexes.push(i);
    }
  });
  const lastEnd = blocks.at(-1)?.span.end ?? length;
  for (const s of stack) close(s, lastEnd);
  if (lead) {
    const l: ParsedSection = lead;
    const lastOwn = blocks[l.blockIndexes.at(-1)!]!;
    close(l, lastOwn.span.end);
    top.unshift(l);
  }
  return top;
}
