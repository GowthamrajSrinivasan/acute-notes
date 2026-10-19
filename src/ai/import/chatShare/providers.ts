import type { ChatProvider } from "./types";

export interface ShareLink {
  provider: ChatProvider;
  shareId: string;
  /** Canonical form, used to drop duplicates and to fetch. */
  url: string;
}

/** Only these hosts are ever fetched server-side (blocks request forgery through the import route). */
const CHATGPT_HOSTS = new Set(["chatgpt.com", "www.chatgpt.com", "chat.openai.com"]);
const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The share link behind `input`, or null when it isn't a supported provider's share URL. ChatGPT only for now (D4). */
export function detectProvider(input: string): ShareLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (CHATGPT_HOSTS.has(url.hostname.toLowerCase())) {
    const match = /^\/share\/(?:e\/)?([^/]+)\/?$/.exec(url.pathname);
    const id = match?.[1]?.toLowerCase();
    if (!id || !SHARE_ID.test(id)) return null;
    return { provider: "chatgpt", shareId: id, url: `https://chatgpt.com/share/${id}` };
  }
  return null;
}

/** Links pulled from a pasted block: one per line or whitespace-separated token; unsupported ones are returned apart. */
export function parseLinks(input: string): { links: ShareLink[]; unsupported: string[]; duplicates: number } {
  const links: ShareLink[] = [];
  const unsupported: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const token of input.split(/[\s,]+/).filter(Boolean)) {
    const link = detectProvider(token);
    if (!link) {
      unsupported.push(token);
      continue;
    }
    if (seen.has(link.shareId)) {
      duplicates++;
      continue;
    }
    seen.add(link.shareId);
    links.push(link);
  }
  return { links, unsupported, duplicates };
}
