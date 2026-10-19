/**
 * The shared-chat service: links in, deduplicated Markdown out. A fake fetch stands in for the import route (no network); the branch skip is the
 * real one, so a branch shares nothing it has in common with its parent.
 */
import { describe, expect, it } from "vitest";
import type { ChatTranscript, ChatTurn } from "@/ai/import/chatShare/types";
import { fetchTranscript, importSharedChats, type FetchLike } from "./sharedChats";

const PARENT = "https://chatgpt.com/share/6ac75678-829c-83ee-aaf4-badd93c19df4";
const BRANCH = "https://chatgpt.com/share/6ac75691-b3c8-83e8-a831-880f86f446c8";
const BROKEN = "https://chatgpt.com/share/6ac756a0-6a40-83ee-85f7-30bc59bbe977";

const turn = (id: string, index: number, role: ChatTurn["role"], markdown: string): ChatTurn => ({ id, index, role, markdown, hash: `${role}:${markdown}` });
const shared = [turn("t1", 0, "user", "What is the plan?"), turn("t2", 1, "assistant", "Ship in March.")];

const parent: ChatTranscript = { provider: "chatgpt", url: PARENT, shareId: "6ac75678-829c-83ee-aaf4-badd93c19df4", conversationId: "c1", title: "Plan", turns: [...shared, turn("t3", 2, "user", "Only in the parent.")] };
const branch: ChatTranscript = {
  provider: "chatgpt",
  url: BRANCH,
  shareId: "6ac75691-b3c8-83e8-a831-880f86f446c8",
  conversationId: "c2",
  title: "Branch · Plan",
  branchedFrom: { conversationId: "c1", title: "Plan", atTurnId: "t2" },
  turns: [...shared, turn("t4", 2, "user", "Only in the branch.")],
};

const route =
  (known: Record<string, ChatTranscript>): FetchLike =>
  async (_url, init) => {
    const { url } = JSON.parse(init.body) as { url: string };
    const transcript = known[url];
    return transcript ? { ok: true, json: async () => ({ transcript }) } : { ok: false, json: async () => ({ error: "That chat could not be found." }) };
  };

describe("importSharedChats", () => {
  it("a branch shares nothing with its parent: the common turns are kept once, in the parent", async () => {
    const out = await importSharedChats(`${PARENT}\n${BRANCH}`, { fetch: route({ [PARENT]: parent, [BRANCH]: branch }) });
    expect(out.chats.map((c) => [c.title, c.turns, c.kept])).toEqual([
      ["Plan", 3, 3],
      ["Branch · Plan", 3, 1],
    ]);
    expect(out.markdown.split("What is the plan?")).toHaveLength(2);
    expect(out.markdown).toContain("Only in the parent.");
    expect(out.markdown).toContain("Only in the branch.");
    expect(out.failed).toEqual([]);
  });

  it("without the skip every turn of every chat is kept", async () => {
    const out = await importSharedChats(`${PARENT} ${BRANCH}`, { skip: false, fetch: route({ [PARENT]: parent, [BRANCH]: branch }) });
    expect(out.chats.map((c) => c.kept)).toEqual([3, 3]);
    expect(out.markdown.split("What is the plan?").length).toBe(3);
  });

  it("a link given twice and one that is not a share link are reported, not fetched or lost silently", async () => {
    let fetched = 0;
    const counting: FetchLike = async (u, i) => (fetched++, route({ [PARENT]: parent })(u, i));
    const out = await importSharedChats(`${PARENT} ${PARENT} https://example.com/x`, { fetch: counting });
    expect(fetched).toBe(1);
    expect(out.duplicates).toBe(1);
    expect(out.unsupported).toEqual(["https://example.com/x"]);
    expect(out.chats).toHaveLength(1);
  });

  it("a link that fails is named with why, and the others are still imported", async () => {
    const out = await importSharedChats(`${PARENT} ${BROKEN}`, { fetch: route({ [PARENT]: parent }) });
    expect(out.failed).toEqual([{ url: BROKEN, error: "That chat could not be found." }]);
    expect(out.chats).toHaveLength(1);
    expect(out.markdown).toContain("Only in the parent.");
  });

  it("nothing readable gives no Markdown", async () => {
    const out = await importSharedChats(BROKEN, { fetch: route({}) });
    expect(out.markdown).toBe("");
    expect(out.chats).toEqual([]);
  });
});

describe("fetchTranscript", () => {
  it("a network failure is a message, never a throw", async () => {
    const down: FetchLike = async () => {
      throw new Error("offline");
    };
    expect(await fetchTranscript(PARENT, down)).toEqual({ error: "Could not reach the import service." });
  });
});
