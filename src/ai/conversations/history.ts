/**
 * Pure helpers for AI conversations (F40): which conversations belong to a
 * selection, the bounded history sent with a follow-up, titles, and export.
 */
import type { AIConversation, AITurn } from "./types";

export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

export const DEFAULT_HISTORY_BUDGET = { maxTurns: 12, maxChars: 12_000 };

/**
 * The most recent turns that fit the budget, oldest first. Older turns are
 * dropped whole (never cut mid-message) except when a single latest turn is
 * itself over budget, which is truncated from the start.
 */
export function boundedHistory(turns: readonly AITurn[], budget = DEFAULT_HISTORY_BUDGET): { messages: HistoryMessage[]; dropped: number } {
  const messages: HistoryMessage[] = [];
  let chars = 0;
  for (let i = turns.length - 1; i >= 0 && messages.length < budget.maxTurns; i--) {
    const t = turns[i]!;
    const text = t.text;
    if (chars + text.length > budget.maxChars) {
      if (!messages.length) messages.unshift({ role: t.role, text: "…" + text.slice(text.length - budget.maxChars + 1) });
      break;
    }
    chars += text.length;
    messages.unshift({ role: t.role, text });
  }
  return { messages, dropped: turns.length - messages.length };
}

/** Conversations whose anchors include any of the given elements, newest first. */
export function conversationsFor(conversations: readonly AIConversation[], elementIds: readonly string[]): AIConversation[] {
  const ids = new Set(elementIds);
  return conversations.filter((c) => c.anchorIds.some((id) => ids.has(id))).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Conversations whose anchors are all in `deletedIds` (their objects are gone). */
export function orphanedBy(conversations: readonly AIConversation[], deletedIds: ReadonlySet<string>): AIConversation[] {
  return conversations.filter((c) => c.anchorIds.length > 0 && c.anchorIds.every((id) => deletedIds.has(id)));
}

const TITLE_MAX = 80;

/** "Summarize — Checkout API" for actions; the question itself (shortened) for typed ones. */
export function conversationTitle(first: { action?: string; text: string }, anchorLabel: string): string {
  const base = first.action ? `${first.text} — ${anchorLabel}` : first.text.replace(/\s+/g, " ").trim();
  return base.length > TITLE_MAX ? `${base.slice(0, TITLE_MAX - 1)}…` : base;
}

export function tasksToMarkdown(tasks: readonly string[]): string {
  return tasks.map((t) => `- [ ] ${t}`).join("\n");
}

/** One conversation as a readable Markdown file. */
export function conversationToMarkdown(conversation: AIConversation, turns: readonly AITurn[]): string {
  const lines = [
    `# ${conversation.title}`,
    "",
    `- About: ${conversation.anchorLabel}`,
    `- Started: ${new Date(conversation.createdAt).toISOString()}`,
    `- Updated: ${new Date(conversation.updatedAt).toISOString()}`,
  ];
  for (const t of turns) {
    lines.push("");
    if (t.role === "user") {
      lines.push("## You", "", t.action ? `*${t.text}* (${t.scope})` : t.text);
    } else {
      lines.push(`## AI — ${t.title}`, "", t.text, "", `<sub>${t.provenance.providerId}${t.provenance.model ? ` · ${t.provenance.model}` : ""}</sub>`);
    }
  }
  return lines.join("\n") + "\n";
}

export interface ConversationsExport {
  format: "acute-ai-conversations";
  version: 1;
  exportedAt: string;
  conversations: { conversation: AIConversation; turns: AITurn[] }[];
}

export function conversationsToJson(items: { conversation: AIConversation; turns: AITurn[] }[], now = Date.now()): ConversationsExport {
  return { format: "acute-ai-conversations", version: 1, exportedAt: new Date(now).toISOString(), conversations: items };
}

/** Compact age for history lists: "now", "2m", "1h", "16h", then "Sep 3". */
export function formatAgo(at: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
