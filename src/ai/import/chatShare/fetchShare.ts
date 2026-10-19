/**
 * Server-side fetch of one share page (chat-share plan §6.1, §8). Only the provider's own hosts are ever contacted,
 * redirects are followed by hand so each hop is checked, and time and size are capped. The text of what comes back is
 * untrusted: the route redacts it before it reaches a prompt.
 */
import { extractChatGpt } from "./chatgpt";
import { ChatShareError } from "./chatgpt";
import { detectProvider } from "./providers";
import type { ChatTranscript } from "./types";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_HOPS = 3;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      void reader.cancel();
      throw new ChatShareError("unreadable", "The shared page is too large to import.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The transcript behind a share URL. Throws `ChatShareError` for anything the user should be told about. */
export async function fetchChatShare(url: string, fetchImpl: FetchLike = fetch): Promise<ChatTranscript> {
  const link = detectProvider(url);
  if (!link) throw new ChatShareError("unreadable", "That isn't a supported share link.");

  let target = link.url;
  for (let hop = 0; ; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(target, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "Mozilla/5.0 (compatible; AcuteNotes chat import)", accept: "text/html" },
      });
    } catch {
      throw new ChatShareError("unreadable", "Could not reach the shared chat.");
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      void res.body?.cancel();
      const next = location ? detectProvider(new URL(location, target).toString()) : null;
      if (!next || hop >= MAX_HOPS) throw new ChatShareError("unreadable", "The share link redirects somewhere that can't be imported.");
      target = next.url;
      continue;
    }
    if (res.status === 404) {
      void res.body?.cancel();
      throw new ChatShareError("not_found", "That share link doesn't exist or is no longer shared.");
    }
    if (!res.ok) {
      void res.body?.cancel();
      throw new ChatShareError("unreadable", `The shared chat couldn't be loaded (${res.status}).`);
    }
    return extractChatGpt(await readCapped(res), link);
  }
}
