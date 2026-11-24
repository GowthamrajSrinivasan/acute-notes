/**
 * U4 prep (intelligent-update-engine-plan §19.3, 2026-11-24): turns ChatGPT share pages that **the user saved from their own
 * browser** (Ctrl+S) into the transcripts `e2e/ai/chatShare.spec.ts` imports, since chatgpt.com now sends the importer only
 * a link preview (decision (b), chat-share-import-plan §4). The app's own reader (`extractChatGpt`) and the import route's
 * redaction (`redactSecrets`) are used, so the transcripts are what the route would have returned.
 *
 * Opt-in, no network, no AI:
 *
 *   CHAT_PAGES_DIR=<folder with the saved .html pages> CHAT_SHARE_TRANSCRIPTS=<output .json, outside the repo> \
 *     npx vitest run src/ai/import/chatShare/saveTranscripts.tool.test.ts
 *
 * The output holds the chats' full text: keep it outside the repository (it is the user's content).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/ai/context/redact";
import { extractChatGpt } from "./chatgpt";
import { detectProvider } from "./providers";
import type { ChatTranscript } from "./types";

const PAGES = process.env.CHAT_PAGES_DIR;
const OUT = process.env.CHAT_SHARE_TRANSCRIPTS;

/** The share link a saved page is a copy of: its canonical link, else its og:url, else the browser's "saved from url" note. */
export function shareLinkOf(html: string): string | null {
  const m =
    /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(html) ??
    /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/.exec(html) ??
    /<!-- saved from url=\(\d+\)(\S+) -->/.exec(html);
  return m ? m[1]! : null;
}

/** A page saved while signed in to ChatGPT: the app's own page, rendered, with the conversation fetched later and not in the file. */
export function isSignedInRender(html: string): boolean {
  return /<script[^>]+id="client-bootstrap"/.test(html) && !/__WEB_MOBILE_DATA__/.test(html);
}

describe.skipIf(!PAGES || !OUT)("save share pages as transcripts (U4 prep, opt-in)", () => {
  it("reads every saved page with the app's own reader and writes the transcripts", () => {
    const files = readdirSync(PAGES!).filter((f) => /\.html?$/i.test(f));
    expect(files.length, "saved .html pages in CHAT_PAGES_DIR").toBeGreaterThan(0);
    const transcripts: ChatTranscript[] = files.map((f) => {
      const html = readFileSync(join(PAGES!, f), "utf8");
      const url = shareLinkOf(html);
      const link = url ? detectProvider(url) : null;
      if (!link) throw new Error(`${f}: no ChatGPT share link in the page (canonical / og:url / saved-from note)`);
      if (isSignedInRender(html)) throw new Error(`${f}: saved while signed in to ChatGPT — that page holds only rendered HTML, not the conversation. Save it from a private (signed-out) window instead.`);
      const t = extractChatGpt(html, link);
      return { ...t, turns: t.turns.map((turn) => ({ ...turn, markdown: redactSecrets(turn.markdown) })) };
    });
    // Oldest chat first: a branch holds its parent's turns, so fewer turns first.
    transcripts.sort((a, b) => a.turns.length - b.turns.length);
    writeFileSync(OUT!, JSON.stringify(transcripts, null, 1));
    const summary = transcripts.map((t) => `${t.shareId}: "${t.title}", ${t.turns.length} turns, ${t.turns.reduce((n, x) => n + x.markdown.length, 0).toLocaleString("en-US")} characters`);
    console.log(`[transcripts] wrote ${OUT}\n  ${summary.join("\n  ")}`);
  });
});

describe("shareLinkOf", () => {
  it("the canonical link, else og:url, else nothing", () => {
    expect(shareLinkOf('<link rel="canonical" href="https://chatgpt.com/share/abc">')).toBe("https://chatgpt.com/share/abc");
    expect(shareLinkOf('<meta property="og:url" content="https://chatgpt.com/share/def">')).toBe("https://chatgpt.com/share/def");
    expect(shareLinkOf("<!DOCTYPE html>\n<!-- saved from url=(0062)https://chatgpt.com/share/6ac75678-829c-83ee-aaf4-badd93c19df4 -->\n<html>")).toBe("https://chatgpt.com/share/6ac75678-829c-83ee-aaf4-badd93c19df4");
    expect(shareLinkOf("<html></html>")).toBeNull();
    expect(isSignedInRender('<script id="client-bootstrap" type="application/json">{}</script>')).toBe(true);
    expect(isSignedInRender('<script id="__WEB_MOBILE_DATA__" type="application/json">{}</script>')).toBe(false);
  });
});
