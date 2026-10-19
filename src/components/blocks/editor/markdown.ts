/**
 * Markdown → rich content using BlockNote's own parser (core, not XL), so
 * pasted lists, todos, headings and code stay structured. Lazy-loaded.
 */
import { BlockNoteEditor } from "@blocknote/core";
import type { ContentBlock, InlineContent, RichContent } from "@/domain/types";
import { normalizeMathArrows } from "@/ai/content/mathArrows";
import { acuteSchema } from "./schema";

let parser: BlockNoteEditor | null = null;

/** `- [ ] task` / `[x] task` (GFM task lists), which BlockNote's parser keeps as text. */
const TASK = /^\s*(?:[-*+]\s+)?\[( |x|X)\]\s+/;

function toTodos(blocks: RichContent): RichContent {
  return blocks.map((b) => {
    const children = b.children?.length ? toTodos(b.children) : b.children;
    const content = Array.isArray(b.content) ? (b.content as InlineContent[]) : null;
    const first = content?.[0];
    if ((b.type === "paragraph" || b.type === "bulletListItem") && first?.type === "text") {
      const match = TASK.exec(first.text);
      if (match) {
        const rest: InlineContent[] = [{ ...first, text: first.text.slice(match[0].length) }, ...content!.slice(1)];
        const todo: ContentBlock = {
          ...b,
          type: "checkListItem",
          props: { ...b.props, checked: match[1] !== " " },
          content: rest,
          ...(children ? { children } : {}),
        };
        return todo;
      }
    }
    return children ? { ...b, children } : b;
  });
}

export function markdownToContent(raw: string): RichContent {
  parser ??= BlockNoteEditor.create({ schema: acuteSchema }) as unknown as BlockNoteEditor;
  // Windows clipboards give "\r\n"; BlockNote's parser then misreads a fenced code block as a paragraph plus an empty code block.
  // Undo LaTeX arrows first: a JSON-mangled `$\rightarrow$` contains a lone "\r" that the line below would turn into a break.
  const markdown = normalizeMathArrows(raw).replace(/\r\n?/g, "\n");
  try {
    const blocks = parser.tryParseMarkdownToBlocks(markdown) as unknown as RichContent;
    if (blocks.length) return toTodos(blocks);
  } catch (err) {
    console.error("[acute-notes] Markdown parse failed; pasting as plain text", err);
  }
  return markdown.split(/\r?\n/).map((line) => ({ type: "paragraph" as const, content: line }));
}
