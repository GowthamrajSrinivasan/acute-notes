import { describe, expect, it } from "vitest";
import { applyBranchSkip } from "./branchSkip";
import { ChatShareError, extractChatGpt } from "./chatgpt";
import { withoutReferences } from "./octane";
import { detectProvider } from "./providers";

/** A share page in the newer ("octane") shape, as read from a live page on 2026-11-23 (`octane.ts`). */
interface Msg {
  id: string;
  role: string;
  text: string;
  refs?: Array<{ type: string; startIndex: number; endIndex: number }>;
}
const page = (title: string, messages: Msg[], extraHead = "") =>
  `<!doctype html><html><head><title>Check out this chat</title>${extraHead}</head><body>` +
  `<script id="octane-conversation-transcript" type="application/json">{"rows":[]}</script>` +
  `<script id="__WEB_MOBILE_DATA__" type="application/json">${JSON.stringify({
    conversationSourceProtocol: "2",
    conversation: {
      title,
      sharedContent: { title, originalCreatedAt: 1_791_140_936_054.493 },
      messages: messages.map((m) =>
        m.role === "assistant" ? { id: m.id, role: m.role, content: m.text, source: { messageId: m.id, markdown: m.text, references: m.refs ?? [] } } : { id: m.id, role: m.role, content: m.text },
      ),
    },
  })}</script></body></html>`;

const link = (id: string) => detectProvider(`https://chatgpt.com/share/${id}`)!;
const ID_A = "6ac75678-1111-4111-8111-111111111111";
const ID_B = "6ac75691-2222-4222-8222-222222222222";

/** A reference over `part` inside `text` (UTF-16 offsets, as the page gives them). */
const ref = (type: string, text: string, part: string) => {
  const startIndex = text.indexOf(part);
  if (startIndex < 0) throw new Error(`not in text: ${part}`);
  return { type, startIndex, endIndex: startIndex + part.length };
};

const REPLY =
  "Firestore fits v1 🚀: realtime sync and simple rules. ([Firebase](https://firebase.google.com/docs?utm_source=chatgpt.com))\n\n" +
  "![Image](https://images.example/a.png)\n\n![Image](https://images.example/b.png)\n\n" +
  "Host the apps on a CDN.\n\nSharpen the plan\n\n- Pick the database\n- Map the hosting";
const REPLY_REFS = [
  ref("grouped_webpages", REPLY, "([Firebase](https://firebase.google.com/docs?utm_source=chatgpt.com))"),
  ref("image_group", REPLY, "![Image](https://images.example/a.png)\n\n![Image](https://images.example/b.png)"),
  { type: "sources_footnote", startIndex: REPLY.indexOf("\n\nHost"), endIndex: REPLY.indexOf("\n\nHost") },
  ref("followup_a", REPLY, "Pick the database"),
  ref("followup_a", REPLY, "Map the hosting"),
];

describe("octane share pages (ChatGPT, since 2026-11)", () => {
  it("reads the title, the share time and the visible turns in order; no conversation id or branch metadata", () => {
    const t = extractChatGpt(page("AI App Builder", [{ id: "u1", role: "user", text: "Which database for v1?" }, { id: "a1", role: "assistant", text: REPLY, refs: REPLY_REFS }]), link(ID_A));
    expect(t).toMatchObject({ provider: "chatgpt", shareId: ID_A, title: "AI App Builder", sharedAt: 1_791_140_936_054 });
    expect(t.conversationId).toBeUndefined();
    expect(t.branchedFrom).toBeUndefined();
    expect(t.turns.map((x) => [x.index, x.id, x.role])).toEqual([
      [0, "u1", "user"],
      [1, "a1", "assistant"],
    ]);
    expect(t.turns[1]!.hash).toMatch(/\S/);
  });

  it("removes citations, image galleries and the follow-up suggestions with their label; the prose stays (offsets are UTF-16)", () => {
    expect(withoutReferences(REPLY, REPLY_REFS).trim()).toBe("Firestore fits v1 🚀: realtime sync and simple rules.\n\nHost the apps on a CDN.");
  });

  it("keeps a list that is followed by more prose, unknown reference types, and text under offsets that don't fit", () => {
    const text = "Steps:\n\n- Pick the database\n\nThen deploy.";
    expect(withoutReferences(text, [ref("followup_a", text, "Pick the database")])).toBe(text);
    const other = "Use **Postgres** here.";
    expect(withoutReferences(other, [ref("entity", other, "**Postgres**"), { type: "grouped_webpages", startIndex: 5, endIndex: 999 }])).toBe(other);
  });

  it("a label ending like a sentence is prose, not the follow-ups' label", () => {
    const text = "Host the apps on a CDN.\n\nThat is the plan.\n\n- Pick the database";
    expect(withoutReferences(text, [ref("followup_a", text, "Pick the database")]).trim()).toBe("Host the apps on a CDN.\n\nThat is the plan.");
  });

  it("skips system/tool messages and empty replies; a page with no readable turn is 'empty'", () => {
    const t = extractChatGpt(page("x", [{ id: "s", role: "system", text: "hidden" }, { id: "u1", role: "user", text: "Hi" }, { id: "a1", role: "assistant", text: "  " }]), link(ID_A));
    expect(t.turns.map((x) => x.id)).toEqual(["u1"]);
    expect(() => extractChatGpt(page("x", [{ id: "a1", role: "assistant", text: "" }]), link(ID_A))).toThrow(expect.objectContaining({ code: "empty" }));
  });

  it("the preview-only page ChatGPT serves to link-preview fetchers says so, instead of 'no conversation'", () => {
    const preview = `<!doctype html><html><head><title>Check out this chat</title><meta property="og:title" content="Check out this chat"></head><body></body></html>`;
    let err: unknown;
    try {
      extractChatGpt(preview, link(ID_A));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ChatShareError);
    expect((err as ChatShareError).message).toMatch(/only a link preview/);
  });

  it("branch-skip still drops the turns a second share repeats (by content, since the new page has no branch metadata)", () => {
    const shared: Msg[] = [
      { id: "u1", role: "user", text: "Which database for v1?" },
      { id: "a1", role: "assistant", text: "Firestore fits v1: realtime sync and simple rules for each document in the app." },
    ];
    const a = extractChatGpt(page("AI App Builder", shared), link(ID_A));
    const b = extractChatGpt(page("Branch · AI App Builder", [...shared, { id: "u2", role: "user", text: "Compare Supabase instead." }, { id: "a2", role: "assistant", text: "Supabase gives relational queries and row level security." }]), link(ID_B));
    const result = applyBranchSkip([a, b], { enabled: true });
    const branch = result.chats.find((c) => c.transcript.shareId === ID_B)!;
    expect(branch.kept.map((t) => t.id)).toEqual(["u2", "a2"]);
    expect(branch.skipped.map((s) => [s.turn.id, s.keptIn.shareId])).toEqual([
      ["u1", ID_A],
      ["a1", ID_A],
    ]);
  });
});
