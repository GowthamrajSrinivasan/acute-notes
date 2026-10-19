/**
 * Shared-chat import as a service (chat-share plan C1): share links in, the Markdown the pipeline takes out, with the branch skip applied
 * (turns a branch shares with its parent are kept once). The Visualize dialog's "From shared chats" panel and the MCP import tool both use
 * it, so a conversation imported either way is read, deduplicated and filed by the same code. Only the public functions of
 * `import/chatShare` are used.
 */
import { applyBranchSkip } from "@/ai/import/chatShare/branchSkip";
import { composeChatMarkdown } from "@/ai/import/chatShare/compose";
import { parseLinks } from "@/ai/import/chatShare/providers";
import type { ChatTranscript } from "@/ai/import/chatShare/types";

export type FetchLike = (input: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/** One share link read through `/api/import/chat-share` (the app's own import route); an error is a message, never a throw. */
export async function fetchTranscript(url: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<{ transcript: ChatTranscript } | { error: string }> {
  try {
    const res = await fetchImpl("/api/import/chat-share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const body = (await res.json()) as { transcript?: ChatTranscript; error?: string };
    if (res.ok && body.transcript) return { transcript: body.transcript };
    return { error: body.error ?? "Could not import that chat." };
  } catch {
    return { error: "Could not reach the import service." };
  }
}

export interface SharedChatsImport {
  /** What the pipeline takes: the kept turns of every chat as Markdown; empty when nothing could be read. */
  markdown: string;
  /** Per chat, in order: how many of its turns are kept and why the rest are not. */
  chats: { title: string; turns: number; kept: number; notes: string[] }[];
  /** Links that could not be read, with why. */
  failed: { url: string; error: string }[];
  /** Tokens that are not a supported share link. */
  unsupported: string[];
  /** Links given more than once, or whose conversation was already in the list. */
  duplicates: number;
}

/** Reads every link, applies the branch skip, and composes the Markdown. Links are fetched together; the order given is the order kept. */
export async function importSharedChats(input: string, options: { skip?: boolean; fetch?: FetchLike } = {}): Promise<SharedChatsImport> {
  const { links, unsupported, duplicates } = parseLinks(input);
  const fetched = await Promise.all(links.map(async (l) => ({ link: l, result: await fetchTranscript(l.url, options.fetch) })));
  const transcripts = fetched.flatMap((f) => ("transcript" in f.result ? [f.result.transcript] : []));
  const failed = fetched.flatMap((f) => ("error" in f.result ? [{ url: f.link.url, error: f.result.error }] : []));
  const skipped = applyBranchSkip(transcripts, { enabled: options.skip ?? true });
  const usable = skipped.chats.filter((c) => c.kept.length);
  return {
    markdown: usable.length ? composeChatMarkdown(skipped.chats) : "",
    chats: skipped.chats.map((c) => ({ title: c.transcript.title, turns: c.transcript.turns.length, kept: c.kept.length, notes: [...c.notes] })),
    failed,
    unsupported,
    duplicates: duplicates + skipped.duplicates.length,
  };
}
