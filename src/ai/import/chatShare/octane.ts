/**
 * ChatGPT share pages as served since about 2026-11 (the "octane" page): the conversation is a JSON island,
 * `<script id="__WEB_MOBILE_DATA__" type="application/json">`, whose `conversation` holds the title and the visible
 * messages in order (no tree, no branch metadata, no per-message times). Shape read from a live share page on 2026-11-23.
 *
 * An assistant message's `source.markdown` is the reply plus things that aren't its prose, each marked by a `references`
 * entry with UTF-16 `startIndex`/`endIndex` (JavaScript string offsets): web citations (`grouped_webpages`, written as
 * ` ([Site](url))`), image galleries (`image_group`), and the suggested follow-ups (`followup_a`) listed at the end under
 * a one-line label. Those are removed, as the private-use citation markers were for the older page.
 */
import type { ChatTurn } from "./types";

export interface OctaneConversation {
  title?: string;
  sharedAt?: number;
  turns: Array<Pick<ChatTurn, "id" | "role" | "markdown">>;
}

interface Reference {
  type?: unknown;
  startIndex?: unknown;
  endIndex?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const ISLAND = /<script\b[^>]*\bid="__WEB_MOBILE_DATA__"[^>]*>([\s\S]*?)<\/script>/;
/** Reference types that are not the reply's prose. Unknown types are left in the text. */
const REMOVED = new Set(["grouped_webpages", "image_group", "sources_footnote", "webpage", "image_v2", "navlist"]);

/** The conversation in an octane share page, or null when the page has none (an older page, or a preview-only page). */
export function readOctane(html: string): OctaneConversation | null {
  const island = ISLAND.exec(html);
  if (!island) return null;
  let data: unknown;
  try {
    data = JSON.parse(island[1]!);
  } catch {
    return null;
  }
  const conversation = isRecord(data) ? data.conversation : null;
  if (!isRecord(conversation) || !Array.isArray(conversation.messages)) return null;

  const turns: OctaneConversation["turns"] = [];
  for (const m of conversation.messages) {
    if (!isRecord(m) || (m.role !== "user" && m.role !== "assistant") || typeof m.id !== "string") continue;
    const source = isRecord(m.source) ? m.source : null;
    const raw = typeof source?.markdown === "string" ? source.markdown : typeof m.content === "string" ? m.content : "";
    const markdown = (m.role === "assistant" && source && Array.isArray(source.references) ? withoutReferences(raw, source.references) : raw).trim();
    if (markdown) turns.push({ id: m.id, role: m.role, markdown });
  }
  const shared = isRecord(conversation.sharedContent) ? conversation.sharedContent : null;
  const title = typeof conversation.title === "string" ? conversation.title : typeof shared?.title === "string" ? shared.title : undefined;
  const created = shared?.originalCreatedAt;
  return {
    ...(title?.trim() ? { title: title.trim() } : {}),
    ...(typeof created === "number" && Number.isFinite(created) ? { sharedAt: Math.round(created) } : {}),
    turns,
  };
}

const span = (r: Reference, length: number): [number, number] | null => {
  const s = r.startIndex;
  const e = r.endIndex;
  if (typeof s !== "number" || typeof e !== "number" || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < s || e > length) return null;
  return [s, e];
};

/** The reply without its non-prose spans (see module doc). Offsets that don't fit the text are ignored. */
export function withoutReferences(markdown: string, references: readonly unknown[]): string {
  const refs = references.filter(isRecord) as Reference[];
  let text = markdown;

  // The follow-ups: a trailing "<label>\n\n- a\n- b" block — cut from the label when the list is all that follows it.
  const followups = refs.filter((r) => r.type === "followup_a").map((r) => span(r, markdown.length)).filter((s): s is [number, number] => !!s);
  let end = markdown.length;
  if (followups.length) {
    const first = Math.min(...followups.map(([s]) => s));
    const listStart = markdown.lastIndexOf("\n", first - 1) + 1;
    const rest = markdown.slice(listStart);
    if (rest.split("\n").every((line) => !line.trim() || /^\s*[-*]\s+/.test(line))) {
      end = listStart;
      const before = markdown.slice(0, listStart).replace(/\s+$/, "");
      const labelStart = before.lastIndexOf("\n\n") + 2;
      const label = before.slice(labelStart);
      if (labelStart > 1 && label && !label.includes("\n") && label.length <= 120 && !/[.!?:]$/.test(label)) end = labelStart;
    }
  }
  text = markdown.slice(0, end);

  // The other non-prose spans, from the end so earlier offsets stay right.
  const cuts = refs
    .filter((r) => typeof r.type === "string" && REMOVED.has(r.type))
    .map((r) => span(r, markdown.length))
    .filter((s): s is [number, number] => !!s && s[1] > s[0] && s[1] <= end)
    .sort((a, b) => b[0] - a[0]);
  let last = Infinity;
  for (const [s, e] of cuts) {
    if (e > last) continue; // overlapping: the later one already went
    const from = s > 0 && text[s - 1] === " " ? s - 1 : s;
    text = text.slice(0, from) + text.slice(e);
    last = from;
  }
  return text.replace(/\n{3,}/g, "\n\n");
}
