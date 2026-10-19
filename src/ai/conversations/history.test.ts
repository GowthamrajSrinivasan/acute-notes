import { describe, expect, it } from "vitest";
import { boundedHistory, conversationsFor, conversationTitle, conversationToMarkdown, formatAgo, orphanedBy } from "./history";
import type { AIConversation, AITurn } from "./types";

const conv = (id: string, anchorIds: string[], updatedAt = 1, extra: Partial<AIConversation> = {}): AIConversation => ({
  id,
  schemaVersion: 1,
  workspaceId: "ws",
  canvasId: "cv",
  anchorIds,
  anchorLabel: "Checkout API",
  title: `Conversation ${id}`,
  scope: "selection",
  turnCount: 2,
  createdAt: 0,
  updatedAt,
  ...extra,
});

const provenance = { task: "summarize", providerId: "copilot", role: "primary" as const, model: "gpt-x", operationId: "op_1" };
const user = (seq: number, text: string): AITurn => ({ conversationId: "c", seq, role: "user", createdAt: 0, text, scope: "selection", sourceIds: [] });
const reply = (seq: number, text: string): AITurn => ({ conversationId: "c", seq, role: "assistant", createdAt: 0, kind: "note", title: "Summary", text, provenance });

describe("boundedHistory", () => {
  it("keeps the most recent turns in order within the budget, dropping whole older turns", () => {
    const turns = [user(0, "a".repeat(40)), reply(1, "b".repeat(40)), user(2, "c".repeat(40)), reply(3, "d".repeat(40))];
    const { messages, dropped } = boundedHistory(turns, { maxTurns: 10, maxChars: 100 });
    expect(messages.map((m) => m.text[0])).toEqual(["c", "d"]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(dropped).toBe(2);
  });

  it("caps the number of turns", () => {
    const turns = Array.from({ length: 20 }, (_, i) => (i % 2 ? reply(i, `r${i}`) : user(i, `u${i}`)));
    expect(boundedHistory(turns, { maxTurns: 4, maxChars: 10_000 }).messages.map((m) => m.text)).toEqual(["u16", "r17", "u18", "r19"]);
  });

  it("truncates a single over-budget latest turn from its start instead of sending nothing", () => {
    const { messages } = boundedHistory([reply(0, "x".repeat(50) + "END")], { maxTurns: 4, maxChars: 10 });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text.endsWith("END")).toBe(true);
    expect(messages[0]!.text.length).toBe(10);
  });
});

describe("conversation lookups", () => {
  const list = [conv("a", ["b1"], 1), conv("b", ["b2", "b3"], 3), conv("c", ["b1", "b3"], 2)];

  it("finds a selection's conversations by any shared anchor, newest first", () => {
    expect(conversationsFor(list, ["b3"]).map((c) => c.id)).toEqual(["b", "c"]);
    expect(conversationsFor(list, ["zzz"])).toEqual([]);
  });

  it("orphans only conversations whose anchors are all deleted", () => {
    expect(orphanedBy(list, new Set(["b1"])).map((c) => c.id)).toEqual(["a"]);
    expect(orphanedBy(list, new Set(["b1", "b3"])).map((c) => c.id)).toEqual(["a", "c"]);
    expect(orphanedBy([conv("x", [])], new Set(["b1"]))).toEqual([]);
  });
});

describe("titles, export, ages", () => {
  it("titles actions with their subject and questions with the question", () => {
    expect(conversationTitle({ action: "summarize", text: "Summarize" }, "Checkout API")).toBe("Summarize — Checkout API");
    expect(conversationTitle({ text: "  Why   retries?\n" }, "x")).toBe("Why retries?");
    expect(conversationTitle({ text: "q".repeat(200) }, "x")).toHaveLength(80);
  });

  it("exports a readable Markdown transcript", () => {
    const md = conversationToMarkdown(conv("a", ["b1"]), [user(0, "What does this do?"), reply(1, "It retries **charges**.")]);
    expect(md).toContain("# Conversation a");
    expect(md).toContain("- About: Checkout API");
    expect(md).toContain("## You\n\nWhat does this do?");
    expect(md).toContain("## AI — Summary\n\nIt retries **charges**.");
    expect(md).toContain("copilot · gpt-x");
  });

  it("formats compact ages", () => {
    const now = new Date(2026, 8, 26, 12).getTime();
    expect(formatAgo(now - 10_000, now)).toBe("now");
    expect(formatAgo(now - 2 * 60_000, now)).toBe("2m");
    expect(formatAgo(now - 16 * 3_600_000, now)).toBe("16h");
    expect(formatAgo(now - 3 * 86_400_000, now)).not.toMatch(/h$/);
  });
});
