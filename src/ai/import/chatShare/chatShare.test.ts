import { describe, expect, it } from "vitest";
import { applyBranchSkip } from "./branchSkip";
import { ChatShareError, extractChatGpt } from "./chatgpt";
import { detectProvider, parseLinks } from "./providers";
import { decodeTurboChunk, streamChunks } from "./turboStream";
import { sharePage, type FixtureConversation, type FixtureMessage } from "./__fixtures__/sharePage";
import liveBranchChain from "./__fixtures__/liveBranchChain.json";
import type { ChatTranscript } from "./types";

const ID_A = "6ac75678-1111-4111-8111-111111111111";
const ID_B = "6ac75691-2222-4222-8222-222222222222";

const msg = (id: string, role: "user" | "assistant", text: string, at: number, extra: Partial<FixtureMessage> = {}): FixtureMessage => ({
  id,
  role,
  text,
  at,
  ...extra,
});

const SHARED: FixtureMessage[] = [
  msg("m1", "user", "Which database should the AI app builder use for version one?", 1_760_000_001),
  msg("m2", "assistant", "Firestore is a good fit for v1: it has realtime sync, generous free tier, and simple security rules for each document.", 1_760_000_002),
  msg("m3", "user", "What about hosting the generated apps for customers?", 1_760_000_003),
  msg("m4", "assistant", "Host generated apps on a static CDN with per-tenant subdomains and keep the build artifacts in object storage.", 1_760_000_004),
];

const parent: FixtureConversation = {
  title: "AI App Builder Ecosystem",
  conversationId: "conv-parent",
  messages: [{ id: "sys", role: "system", text: "You are helpful", hidden: true }, ...SHARED],
  extra: [msg("sib", "assistant", "an unused sibling branch that is not on the path", 1_760_000_099)],
};

const branch: FixtureConversation = {
  title: "Branch · AI App Builder Ecosystem",
  conversationId: "conv-branch",
  messages: [
    ...SHARED.slice(0, 3),
    msg("m4", "assistant", SHARED[3]!.text!, 1_760_000_004, { branchingFrom: { id: "conv-parent", title: "AI App Builder Ecosystem" } }),
    msg("b5", "user", "Actually compare Postgres on Supabase against Firestore for the same use.", 1_760_000_005),
    msg("b6", "assistant", "Supabase Postgres gives relational queries and row level security; Firestore stays simpler for realtime documents.", 1_760_000_006),
  ],
};

const transcript = (c: FixtureConversation, id: string): ChatTranscript => extractChatGpt(sharePage(c), detectProvider(`https://chatgpt.com/share/${id}`)!);

describe("detectProvider / parseLinks", () => {
  it("accepts ChatGPT share links and canonicalises them", () => {
    expect(detectProvider(`https://chat.openai.com/share/${ID_A.toUpperCase()}/`)).toEqual({
      provider: "chatgpt",
      shareId: ID_A,
      url: `https://chatgpt.com/share/${ID_A}`,
    });
  });
  it("rejects other hosts, plain http, and malformed ids (no server-side request forgery)", () => {
    expect(detectProvider(`http://chatgpt.com/share/${ID_A}`)).toBeNull();
    expect(detectProvider(`https://evil.example/share/${ID_A}`)).toBeNull();
    expect(detectProvider(`https://chatgpt.com.evil.example/share/${ID_A}`)).toBeNull();
    expect(detectProvider("https://chatgpt.com/share/not-an-id")).toBeNull();
    expect(detectProvider(`https://chatgpt.com/c/${ID_A}`)).toBeNull();
    expect(detectProvider("nonsense")).toBeNull();
  });
  it("drops duplicate links and reports unsupported ones", () => {
    const out = parseLinks(`https://chatgpt.com/share/${ID_A}\nhttps://chat.openai.com/share/${ID_A}\nhttps://x.example/y https://chatgpt.com/share/${ID_B}`);
    expect(out.links.map((l) => l.shareId)).toEqual([ID_A, ID_B]);
    expect(out.duplicates).toBe(1);
    expect(out.unsupported).toEqual(["https://x.example/y"]);
  });
});

describe("turbo-stream decoding", () => {
  it("decodes shared references, constants and dates", () => {
    const json = JSON.stringify([{ _1: 2, _3: -5, _4: 5, _6: 7 }, "a", "x", "b", "c", ["D", 5], "d", [2, 1]]);
    expect(decodeTurboChunk(json)).toEqual({ a: "x", b: null, c: new Date(5), d: ["x", "a"] });
  });
  it("finds the chunks of a page", () => {
    expect(streamChunks(sharePage(parent))).toHaveLength(2);
  });
});

describe("extractChatGpt", () => {
  it("keeps only the visible user/assistant turns on the current path", () => {
    const t = transcript(parent, ID_A);
    expect(t.title).toBe("AI App Builder Ecosystem");
    expect(t.conversationId).toBe("conv-parent");
    expect(t.turns.map((x) => x.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(t.turns.map((x) => x.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(t.turns[0]).toMatchObject({ index: 0, at: 1_760_000_001_000 });
    expect(t.branchedFrom).toBeUndefined();
  });
  it("reads where a branch forked from", () => {
    const t = transcript(branch, ID_B);
    expect(t.branchedFrom).toEqual({ conversationId: "conv-parent", title: "AI App Builder Ecosystem", atTurnId: "m4" });
    expect(t.turns).toHaveLength(6);
    expect(t.turns[0]!.hash).toBe(transcript(parent, ID_A).turns[0]!.hash);
  });
  it("drops tool calls, thoughts and empty messages, and citation markers", () => {
    const t = transcript(
      {
        title: "x",
        conversationId: "c",
        messages: [
          msg("u", "user", "question", 1),
          { id: "t1", role: "assistant", text: "searching", recipient: "web.run" },
          { id: "t2", role: "assistant", text: "thinking", contentType: "thoughts" },
          { id: "t3", role: "assistant", text: "   " },
          msg("a", "assistant", "Answer one.citeturn0search0 Then more.", 2),
        ],
      },
      ID_A,
    );
    expect(t.turns.map((x) => x.markdown)).toEqual(["question", "Answer one. Then more."]);
  });
  it("reports a missing share and a page with no conversation", () => {
    const link = detectProvider(`https://chatgpt.com/share/${ID_A}`)!;
    expect(() => extractChatGpt(sharePage(null), link)).toThrowError(expect.objectContaining({ code: "not_found" }));
    expect(() => extractChatGpt("<html></html>", link)).toThrow(ChatShareError);
  });
});

/** Three real ChatGPT shares (2026-10-09): a chat, a branch of it, and a branch of that branch. Text trimmed to 300 characters; ids and hashes are the real ones. */
describe("applyBranchSkip on a real branch chain", () => {
  const chain = liveBranchChain as unknown as ChatTranscript[];
  const kept = (out: ReturnType<typeof applyBranchSkip>) => out.chats.map((c) => c.kept.length);

  it("analyses each turn once, in any order", () => {
    for (const order of [[0, 1, 2], [2, 0, 1], [1, 2, 0]]) {
      const out = applyBranchSkip(order.map((i) => chain[i]!), { enabled: true });
      const byTitle = new Map(out.chats.map((c) => [c.transcript.shareId, c]));
      expect([0, 1, 2].map((i) => byTitle.get(chain[i]!.shareId)!.kept.length)).toEqual([4, 4, 10]);
      expect(byTitle.get(chain[2]!.shareId)!.lineage).toHaveLength(3);
    }
  });
  it("keeps everything with the toggle off", () => {
    expect(kept(applyBranchSkip(chain, { enabled: false }))).toEqual([4, 8, 18]);
  });
  it("says so when a branch's parent isn't in the import", () => {
    const out = applyBranchSkip([chain[2]!], { enabled: true });
    expect(out.chats[0]!.kept).toHaveLength(18);
    expect(out.chats[0]!.notes[0]).toContain("which isn't in this import");
  });
});

describe("applyBranchSkip", () => {
  const p = () => transcript(parent, ID_A);
  const b = () => transcript(branch, ID_B);

  it("skips what a branch shares with its parent, whatever the order", () => {
    for (const input of [[p(), b()], [b(), p()]]) {
      const out = applyBranchSkip(input, { enabled: true });
      const branchChat = out.chats.find((c) => c.transcript.shareId === ID_B)!;
      const parentChat = out.chats.find((c) => c.transcript.shareId === ID_A)!;
      expect(parentChat.kept).toHaveLength(4);
      expect(branchChat.kept.map((x) => x.id)).toEqual(["b5", "b6"]);
      expect(branchChat.skipped.every((s) => s.rule === "branch")).toBe(true);
      expect(branchChat.notes).toEqual(['4 of 6 turns already in "AI App Builder Ecosystem" — skipped']);
      expect(branchChat.lineage).toEqual(["AI App Builder Ecosystem", "Branch · AI App Builder Ecosystem"]);
      expect(out.alsoIn[`${ID_A}:m2`]).toEqual([ID_B]);
      expect(out.chats.map((c) => c.transcript.shareId)).toEqual(input.map((t) => t.shareId));
    }
  });

  it("analyses everything when the toggle is off, but still imports a conversation once", () => {
    const out = applyBranchSkip([p(), b(), { ...p(), shareId: "other-link" }], { enabled: false });
    expect(out.chats.map((c) => c.kept.length)).toEqual([4, 6]);
    expect(out.duplicates).toHaveLength(1);
  });

  it("says so when the parent isn't in the import, and still skips exact repeats across other chats", () => {
    const sibling = transcript({ ...branch, conversationId: "conv-sibling", title: "Sibling" }, "6ac75699-3333-4333-8333-333333333333");
    const out = applyBranchSkip([b(), sibling], { enabled: true });
    expect(out.chats[0]!.kept).toHaveLength(6);
    expect(out.chats[0]!.notes).toEqual(["branched from \"AI App Builder Ecosystem\", which isn't in this import"]);
    expect(out.chats[1]!.kept).toHaveLength(0);
  });

  it("never treats short generic turns as shared", () => {
    const short = (conversationId: string, id: string) =>
      transcript({ title: conversationId, conversationId, messages: [msg("u1", "user", "yes", 1), msg("a1", "assistant", "ok", 2)] }, id);
    const out = applyBranchSkip([short("c1", ID_A), short("c2", ID_B)], { enabled: true });
    expect(out.chats[1]!.kept).toHaveLength(2);
  });

  it("keeps a regenerated shared prefix once (no branch metadata)", () => {
    const regenerated: FixtureConversation = {
      title: "Same chat, regenerated",
      conversationId: "conv-regen",
      messages: [
        msg("r1", "user", SHARED[0]!.text!, 1_760_100_001),
        msg("r2", "assistant", SHARED[1]!.text! + " Also.", 1_760_100_002),
        msg("r3", "user", "A different follow up question about pricing tiers for the builder.", 1_760_100_003),
      ],
    };
    const out = applyBranchSkip([transcript(parent, ID_A), transcript(regenerated, ID_B)], { enabled: true });
    expect(out.chats[1]!.kept.map((x) => x.id)).toEqual(["r3"]);
    expect(out.chats[1]!.skipped.map((s) => s.rule)).toEqual(["exact", "near"]);
  });
});
