"use client";

/**
 * "From shared chats" in the Visualize dialog (chat-share plan C1): a list of share links, each fetched through
 * `/api/import/chat-share`, with the branch-skip toggle and a per-chat preview. "Use these chats" hands the kept
 * turns to Visualize as Markdown; the paste box above stays the fallback for anything that can't be fetched.
 */
import { useMemo, useState } from "react";
import { applyBranchSkip } from "@/ai/import/chatShare/branchSkip";
import { composeChatMarkdown } from "@/ai/import/chatShare/compose";
import { parseLinks } from "@/ai/import/chatShare/providers";
import type { ChatTranscript } from "@/ai/import/chatShare/types";
import { fetchTranscript } from "@/ai/ingest/sharedChats";

interface Entry {
  shareId: string;
  url: string;
  state: "loading" | "ok" | "error";
  transcript?: ChatTranscript;
  error?: string;
}

export function SharedChatsPanel({ onUse, defaultOpen = false }: { onUse: (markdown: string) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [input, setInput] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [skip, setSkip] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const patch = (shareId: string, change: Partial<Entry>) => setEntries((all) => all.map((e) => (e.shareId === shareId ? { ...e, ...change } : e)));

  const add = () => {
    const { links, unsupported, duplicates } = parseLinks(input);
    const known = new Set(entries.map((e) => e.shareId));
    const fresh = links.filter((l) => !known.has(l.shareId));
    const dropped = duplicates + (links.length - fresh.length);
    setNotice(
      [
        unsupported.length ? `Not a supported share link: ${unsupported.join(", ")}` : "",
        dropped ? `${dropped} duplicate link${dropped === 1 ? "" : "s"} ignored` : "",
      ]
        .filter(Boolean)
        .join(" · ") || null,
    );
    if (!fresh.length) return;
    setInput("");
    setEntries((all) => [...all, ...fresh.map((l) => ({ shareId: l.shareId, url: l.url, state: "loading" as const }))]);
    for (const link of fresh) {
      void fetchTranscript(link.url).then((r) => patch(link.shareId, "transcript" in r ? { state: "ok", transcript: r.transcript } : { state: "error", error: r.error }));
    }
  };

  const move = (index: number, by: -1 | 1) =>
    setEntries((all) => {
      const next = [...all];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });

  const result = useMemo(
    () => applyBranchSkip(entries.flatMap((e) => (e.transcript ? [e.transcript] : [])), { enabled: skip }),
    [entries, skip],
  );
  const usable = result.chats.filter((c) => c.kept.length);

  return (
    <details className="acute-shared-chats" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>From shared chats</summary>
      <p className="acute-visualize-dialog__destination">Paste ChatGPT share links, one per line. Gemini and Claude links aren&apos;t supported yet.</p>
      <div className="acute-shared-chats__add">
        <textarea
          className="acute-visualize-dialog__text"
          rows={2}
          aria-label="Share links"
          placeholder="https://chatgpt.com/share/…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="button" disabled={!input.trim()} onClick={add}>
          Add
        </button>
      </div>
      {notice && <p className="acute-visualize-dialog__destination">{notice}</p>}
      {!!entries.length && (
        <>
          <ul className="acute-shared-chats__list">
            {entries.map((entry, i) => {
              const chat = result.chats.find((c) => c.transcript.shareId === entry.shareId);
              const duplicate = entry.transcript && !chat;
              return (
                <li key={entry.shareId} className="acute-shared-chats__item">
                  <div className="acute-shared-chats__head">
                    <span className="acute-shared-chats__title">
                      {entry.state === "loading" ? "Loading…" : entry.state === "error" ? entry.url : entry.transcript!.title}
                    </span>
                    <span className="acute-shared-chats__buttons">
                      <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                        ↑
                      </button>
                      <button type="button" aria-label="Move down" disabled={i === entries.length - 1} onClick={() => move(i, 1)}>
                        ↓
                      </button>
                      <button type="button" aria-label="Remove" onClick={() => setEntries((all) => all.filter((e) => e.shareId !== entry.shareId))}>
                        ✕
                      </button>
                    </span>
                  </div>
                  {entry.state === "error" && <p className="acute-shared-chats__note" role="alert">{entry.error}</p>}
                  {chat && (
                    <p className="acute-shared-chats__note">
                      {chat.kept.length} of {chat.transcript.turns.length} turns will be analysed
                      {chat.notes.map((n) => ` · ${n}`).join("")}
                    </p>
                  )}
                  {duplicate && <p className="acute-shared-chats__note">Same conversation as another link — imported once.</p>}
                </li>
              );
            })}
          </ul>
          <label className="acute-visualize-dialog__choice">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
            Skip content shared between branched chats
          </label>
          <button type="button" disabled={!usable.length} onClick={() => onUse(composeChatMarkdown(result.chats))}>
            Use {usable.length === 1 ? "this chat" : `these ${usable.length} chats`}
          </button>
        </>
      )}
    </details>
  );
}
