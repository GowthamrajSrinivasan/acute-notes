import { describe, expect, it, vi } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { ConversationStore } from "./conversationStore";

const provenance = { task: "summarize", providerId: "copilot", role: "primary" as const, model: "m", operationId: "op_1" };
const userTurn = (text = "Summarize") => ({ action: "summarize", text, scope: "selection" as const, sourceIds: ["b1"] });
const replyTurn = (text = "The gist.") => ({ kind: "note" as const, title: "Summary", text, provenance });
const start = { workspaceId: "ws", canvasId: "cv", anchorIds: ["b1"], anchorLabel: "Checkout API", scope: "selection" as const };

function setup() {
  const services = createMemoryServices();
  const append = vi.spyOn(services.aiConversations, "append");
  const store = new ConversationStore(
    () => services.aiConversations,
    () => services.meta,
  );
  return { services, store, append };
}

describe("ConversationStore", () => {
  it("writes nothing until the first exchange completes, then one write per exchange", async () => {
    const { store, append, services } = setup();
    const c = store.start(start);
    expect(append).not.toHaveBeenCalled();
    expect(store.list("ws")).toEqual([]); // unanswered conversations aren't listed

    await store.recordExchange(c.id, userTurn(), replyTurn());
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]![1].map((t) => t.seq)).toEqual([0, 1]);

    await store.recordExchange(c.id, { text: "Why?", scope: "selection", sourceIds: [] }, replyTurn("Because."));
    expect(append).toHaveBeenCalledTimes(2);
    expect(append.mock.calls[1]![1].map((t) => t.seq)).toEqual([2, 3]); // append-only: only the new turns

    const stored = await services.aiConversations.get(c.id);
    expect(stored?.conversation).toMatchObject({ title: "Summarize — Checkout API", turnCount: 4 });
    expect(stored?.turns.map((t) => t.text)).toEqual(["Summarize", "The gist.", "Why?", "Because."]);
  });

  it("with saving off, conversations work for the session but are never written", async () => {
    const { store, append, services } = setup();
    await store.setSaving(false);
    const c = store.start(start);
    await store.recordExchange(c.id, userTurn(), replyTurn());
    expect(append).not.toHaveBeenCalled();
    expect(store.list("ws").map((x) => x.id)).toEqual([c.id]);
    expect(await store.getTurns(c.id)).toHaveLength(2);
    expect(store.isSaved(c.id)).toBe(false);
    expect(await services.meta.get("ai.saveConversations")).toBe(false);
  });

  it("turning saving back on writes the earlier unsaved turns with the next exchange", async () => {
    const { store, append } = setup();
    await store.setSaving(false);
    const c = store.start(start);
    await store.recordExchange(c.id, userTurn(), replyTurn());
    await store.setSaving(true);
    await store.recordExchange(c.id, { text: "More?", scope: "selection", sourceIds: [] }, replyTurn("Yes."));
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]![1].map((t) => t.seq)).toEqual([0, 1, 2, 3]);
    expect(store.isSaved(c.id)).toBe(true);
  });

  it("loads saved headers for a workspace; turns load on demand", async () => {
    const { store, services } = setup();
    const c = store.start(start);
    await store.recordExchange(c.id, userTurn(), replyTurn());

    const fresh = new ConversationStore(
      () => services.aiConversations,
      () => services.meta,
    );
    await fresh.load("ws");
    expect(fresh.list("ws", "cv").map((x) => x.id)).toEqual([c.id]);
    expect(fresh.list("ws", "other")).toEqual([]);
    expect((await fresh.getTurns(c.id)).map((t) => t.seq)).toEqual([0, 1]);
  });

  it("finds a selection's conversations and orphans after deletion", async () => {
    const { store } = setup();
    const a = store.start(start);
    await store.recordExchange(a.id, userTurn(), replyTurn());
    const b = store.start({ ...start, anchorIds: ["b1", "b2"] });
    await store.recordExchange(b.id, userTurn(), replyTurn());

    expect(store.listFor("ws", "cv", ["b2"]).map((x) => x.id)).toEqual([b.id]);
    expect(store.anchoredIds("ws", "cv")).toEqual(new Set(["b1", "b2"]));
    expect(store.orphanedBy("ws", "cv", new Set(["b1"])).map((x) => x.id)).toEqual([a.id]);
  });

  it("deletes one, a workspace's, or every conversation", async () => {
    const { store, services } = setup();
    const a = store.start(start);
    await store.recordExchange(a.id, userTurn(), replyTurn());
    const b = store.start(start);
    await store.recordExchange(b.id, userTurn(), replyTurn());
    const other = store.start({ ...start, workspaceId: "ws2" });
    await store.recordExchange(other.id, userTurn(), replyTurn());

    await store.delete([a.id]);
    expect(await services.aiConversations.get(a.id)).toBeNull();
    await store.deleteAll("ws");
    expect(store.list("ws")).toEqual([]);
    expect(store.list("ws2")).toHaveLength(1);
    await store.deleteAllEverywhere();
    expect(await services.aiConversations.listByWorkspace("ws2")).toEqual([]);
  });

  it("restores the saving setting", async () => {
    const { store, services } = setup();
    await services.meta.set("ai.saveConversations", false);
    await store.loadSetting();
    expect(store.isSaving()).toBe(false);
  });
});
