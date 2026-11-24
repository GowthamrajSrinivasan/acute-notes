// @vitest-environment happy-dom
/**
 * "Ask AI to change / refresh" a layout card (note-taking-modes plan Step 7), with a mock model (no AI spend): ONE request
 * per click; the reply is checked against the card's text and citations; a reply that passes is proposed for review as
 * one update_block (text and layout together), never applied; one that fails is not proposed, with the problems said.
 */
import { describe, expect, it, vi } from "vitest";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { composeLayoutTask, readComposed, registerComposeLayoutTask } from "@/ai/openui/layoutTask";
import { markdownToContent } from "@/components/blocks/editor/markdown";
import { layoutFor } from "@/ai/openui/cardLayout";
import { askAIForLayout, REFRESH_INSTRUCTION, TEXT_LEFT_OUT_NOTE } from "./layoutAI";

const response = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });
const CARD = markdownToContent("### Retry policy\n\nJobs retry 5 times, then give up after 30 seconds.");
const OLD = `root = IdeaCard("Retry policy", "Jobs retry 5 times.")`;

function model(reply: string) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerComposeLayoutTask(registry);
  const spy = vi.fn((req: AIRequest) => response(req.task === "compose_card_layout" ? reply : "unexpected"));
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), spy };
}

let canvas = 0;
const ask = (reply: string, extra: Partial<Parameters<typeof askAIForLayout>[0]> = {}) => {
  const m = model(reply);
  const canvasId = `cv_${++canvas}`;
  const run = askAIForLayout(
    { canvasId, elementId: "el_card", card: { snapshot: CARD, layout: layoutFor({ title: "Untitled", snapshot: CARD }, OLD) }, instruction: "Show it as a callout", passages: new Map(), purpose: "change", ...extra },
    { runtime: m.runtime, parseMarkdown: markdownToContent },
  );
  return { run, spy: m.spy, pending: () => getPendingChanges().get(canvasId) };
};

const md = (markdown: string, lang: string) => `<markdown>\n${markdown}\n</markdown>\n<layout>\n${lang}\n</layout>`;
const SAME_TEXT = "### Retry policy\n\nJobs retry 5 times, then give up after 30 seconds.";

describe("compose_card_layout", () => {
  it("reads the reply's two parts (fences tolerated); a missing part is null", () => {
    expect(readComposed(md("Text", "root = Callout(\"info\", \"x\")"))).toEqual({ markdown: "Text", lang: `root = Callout("info", "x")` });
    expect(readComposed("<layout>\n```\nroot = X()\n```\n</layout>")).toEqual({ markdown: null, lang: "root = X()" });
    expect(readComposed("no tags")).toEqual({ markdown: null, lang: null });
  });

  it("the prompt carries the grammar, the instruction, the card, its layout and the citation rule", () => {
    const built = composeLayoutTask.buildPrompt({ input: { markdown: "M", currentLang: OLD, instruction: "Do X", cites: [] } });
    expect(built.systemPrompt).toContain("FlowDiagram");
    expect(built.systemPrompt).toContain("<markdown>");
    expect(built.prompt).toContain("Instruction: Do X");
    expect(built.prompt).toContain(OLD);
    expect(built.prompt).toContain("use no CitationChip");
  });
});

describe("askAIForLayout", () => {
  it("a passing reply is proposed for review (not applied): one update_block with the new layout; one request", async () => {
    const lang = `root = Callout("warning", "Jobs retry 5 times, then give up after 30 seconds.")`;
    const a = ask(md(SAME_TEXT, lang));
    expect(await a.run).toEqual({ outcome: "proposed", notes: [] });
    expect(a.spy).toHaveBeenCalledTimes(1);
    const set = a.pending()!;
    expect(set.title).toBe("Ask AI: change card layout");
    expect(set.metadata).toMatchObject({ createdBy: "ai", task: "compose_card_layout", provider: "mock" });
    expect(set.changes).toHaveLength(1);
    expect(set.changes[0]).toMatchObject({ kind: "update_block", target: "el_card", layout: { lang } });
    expect(JSON.stringify(set.changes[0])).toContain("give up after 30 seconds");
  });

  it("a reply that changes the text proposes text and layout together", async () => {
    const lang = `root = IdeaCard("Retry policy", "Jobs retry 3 times.")`;
    const a = ask(md("### Retry policy\n\nJobs retry 3 times.", lang), { instruction: "It's 3 retries now" });
    expect((await a.run).outcome).toBe("proposed");
    expect(a.pending()!.title).toBe("Ask AI: change card and layout");
    expect(JSON.stringify(a.pending()!.changes[0])).toContain("Jobs retry 3 times.");
  });

  it("a layout with a number the text doesn't have is refused, with the problem; nothing is proposed", async () => {
    const a = ask(md(SAME_TEXT, `root = IdeaCard("Retry policy", "Jobs retry 7 times.")`));
    const out = await a.run;
    expect(out.outcome).toBe("refused");
    expect(out.outcome === "refused" && out.problems.join(" ")).toMatch(/7/);
    expect(a.pending()).toBeNull();
  });

  it("a citation the card doesn't have is refused; one it has is accepted", async () => {
    const cited = `root = IdeaCard("Retry policy", "Jobs retry 5 times.", null, [c1])\nc1 = CitationChip("u3")`;
    expect((await ask(md(SAME_TEXT, cited)).run).outcome).toBe("refused");
    expect((await ask(md(SAME_TEXT, cited), { passages: new Map([["u3", "Jobs retry 5 times."]]) }).run).outcome).toBe("proposed");
  });

  it("no layout in the reply, or no provider: failed, nothing proposed", async () => {
    const a = ask("Sorry, I can't.");
    expect((await a.run).outcome).toBe("failed");
    expect(a.pending()).toBeNull();
    const registry = createTaskRegistry();
    registerComposeLayoutTask(registry);
    const out = await askAIForLayout(
      { canvasId: "cv_none", elementId: "el", card: { snapshot: CARD }, instruction: "x", passages: new Map(), purpose: "change" },
      { runtime: createAIRuntime({ manager: new AIProviderManager(), registry }), parseMarkdown: markdownToContent },
    );
    expect(out.outcome).toBe("failed");
  });

  it("refresh: sends the refresh instruction and the stale layout; the review title says refresh", async () => {
    const lang = `root = IdeaCard("Retry policy", "Jobs retry 5 times, then give up after 30 seconds.")`;
    const a = ask(md(SAME_TEXT, lang), { instruction: REFRESH_INSTRUCTION, purpose: "refresh" });
    expect((await a.run).outcome).toBe("proposed");
    const prompt = a.spy.mock.calls[0]![0]!.prompt;
    expect(prompt).toContain("Redo the layout");
    expect(prompt).toContain(OLD);
    expect(a.pending()!.title).toBe("Ask AI: refresh card layout");
  });

  it("layout only: the card's text is kept whatever the reply says; the review notes the text that was left out", async () => {
    const lang = `root = Callout("warning", "Jobs retry 5 times, then give up after 30 seconds.")`;
    const a = ask(md("### Retry policy\n\nMigrate before the deadline.\n\nJobs retry 5 times, then give up after 30 seconds.", lang), { layoutOnly: true });
    const out = await a.run;
    expect(out).toEqual({ outcome: "proposed", notes: [TEXT_LEFT_OUT_NOTE] });
    expect(a.spy.mock.calls[0]![0]!.prompt).toContain("Layout only: the card's text is fixed.");
    const change = a.pending()!.changes[0] as { content: unknown };
    expect(change.content).toEqual(CARD);
    expect(a.pending()!.title).toBe("Ask AI: change card layout");
  });

  it("layout only: a layout built on the reply's changed text (not the card's) is refused", async () => {
    const a = ask(md("### Retry policy\n\nJobs retry 3 times.", `root = IdeaCard("Retry policy", "Jobs retry 3 times.")`), { layoutOnly: true });
    expect((await a.run).outcome).toBe("refused");
    expect(a.pending()).toBeNull();
  });

  it("layout only and the same text back: no note", async () => {
    const a = ask(md(SAME_TEXT, `root = Callout("info", "Jobs retry 5 times, then give up after 30 seconds.")`), { layoutOnly: true });
    expect(await a.run).toEqual({ outcome: "proposed", notes: [] });
  });

  it("refresh is always layout only", async () => {
    const lang = `root = IdeaCard("Retry policy", "Jobs retry 5 times, then give up after 30 seconds.")`;
    const a = ask(md("### Retry policy\n\nSomething else entirely.", lang), { instruction: REFRESH_INSTRUCTION, purpose: "refresh" });
    expect(await a.run).toEqual({ outcome: "proposed", notes: [TEXT_LEFT_OUT_NOTE] });
    expect((a.pending()!.changes[0] as { content: unknown }).content).toEqual(CARD);
    expect(a.spy.mock.calls[0]![0]!.prompt).toContain("Layout only");
  });
});
