import type { ImportedChat } from "./branchSkip";

/**
 * Lowers every ATX heading (`#`…) by `by` levels, at most to level 6, leaving code fences alone. A heading cannot go below
 * level 6, so deeper ones stay at 6; nothing is dropped.
 */
export function demoteHeadings(markdown: string, by: number): string {
  let fence: string | null = null;
  return markdown
    .split("\n")
    .map((line) => {
      const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker[0]!;
        else if (marker[0] === fence) fence = null;
        return line;
      }
      if (fence) return line;
      const m = /^(#{1,6})(\s+.*)$/.exec(line);
      return m ? `${"#".repeat(Math.min(6, m[1]!.length + by))}${m[2]}` : line;
    })
    .join("\n");
}

/** The user's words as a Markdown block quote, so a question stays visible and is never read as a heading. */
const quote = (markdown: string): string =>
  markdown
    .split("\n")
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");

/**
 * The Markdown a set of imported chats is visualized from (the "layout D" of the import-layout experiment, see
 * `.ai/docs/decision-spike/chat-import-live-2026-10-09.md`):
 *
 * - one `#` section per chat, titled with its name and date, so each chat's analysis units stay apart;
 * - the user's turns as block quotes — visible, in order, and never headings (a bold "You:" label was recovered as a heading and
 *   became a catch-all topic);
 * - the assistant's turns as they are, with their own headings **one level down**, so they sit under the chat's title and each
 *   major section of an answer is one unit with its fragments inside it ("Free", "Pro", "Phase 4" are not parts of their own).
 *
 * Turn order, every kept turn's text and its headings are preserved; only the heading level changes. Chats with nothing left
 * after the branch skip are left out.
 */
export function composeChatMarkdown(chats: readonly ImportedChat[]): string {
  return chats
    .filter((c) => c.kept.length)
    .map((c) => {
      const date = c.transcript.sharedAt ? ` (${new Date(c.transcript.sharedAt).toISOString().slice(0, 10)})` : "";
      const turns = c.kept.map((t) => (t.role === "user" ? quote(t.markdown) : demoteHeadings(t.markdown, 1)));
      return [`# ${c.transcript.title}${date}`, `Source: ${c.transcript.url}`, ...turns].join("\n\n");
    })
    .join("\n\n---\n\n");
}
