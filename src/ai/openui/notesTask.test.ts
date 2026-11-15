/** `generate_openui_notes` against the mock provider only — no network, no real model. */
import { describe, expect, it, vi } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { cardOf, generateOpenUiNotes, notesInputOf, registerOpenUiNotesTask, splitCards, NOTES_MAX_UNITS } from "./notesTask";

const OUTPUT = [
  'root = IdeaCard("Keys stop double charges", "A retried payment with the same key returns the first result.", "high", [c1, c2], "The server stores the key with the result.")',
  'c1 = CitationChip("u1")',
  'c2 = CitationChip("u9")',
  "---",
  'root = IdeaCard("Keys expire", "After the window, a retry is a new payment.", "medium", [c1])',
  'c1 = CitationChip("u2")',
  "---",
  'root = Callout("info", "not a card")',
].join("\n");

const response = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });

function setup(text: string, streamChunks?: () => string[]) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerOpenUiNotesTask(registry);
  const spy = vi.fn((_req: AIRequest) => response(text));
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy, streamChunks }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), spy };
}

const units = [
  { id: "u1", text: "Clients send an Idempotency-Key header." },
  { id: "u2", text: "Keys expire after 24 hours." },
];

describe("generate_openui_notes", () => {
  it("sends the units and the library's format, and returns the IdeaCards only", async () => {
    const { runtime, spy } = setup(OUTPUT);
    const result = await generateOpenUiNotes(runtime, notesInputOf(units, "Payments"));
    const req = spy.mock.calls[0]![0];
    expect(req.task).toBe("generate_openui_notes");
    expect(req.prompt).toContain("[u1] Clients send an Idempotency-Key header.");
    expect(req.systemPrompt).toContain("IdeaCard");
    expect(req.systemPrompt).toContain("---");
    expect(result.cards.map((c) => [c.key, c.title, c.cites, c.unknownUnits])).toEqual([
      ["g1", "Keys stop double charges", ["u1"], ["u9"]],
      ["g2", "Keys expire", ["u2"], []],
    ]);
    expect(result.cards[0]!.detail).toBe("The server stores the key with the result.");
    expect(result.dropped).toBe(1);
  });

  it("reports the blocks while streaming, then once more when done", async () => {
    const chunks = OUTPUT.match(/[\s\S]{1,40}/g)!;
    const { runtime } = setup(OUTPUT, () => chunks);
    const updates: { blocks: number; done: boolean }[] = [];
    await generateOpenUiNotes(runtime, notesInputOf(units), { onUpdate: (u) => updates.push({ blocks: u.blocks.length, done: u.done }) });
    expect(updates.length).toBeGreaterThan(2);
    expect(updates[0]!.blocks).toBe(1);
    expect(updates.at(-1)).toEqual({ blocks: 3, done: true });
    expect(updates.filter((u) => u.done)).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("splits on separator lines and unwraps a fenced reply", () => {
    expect(splitCards("```\nroot = A()\n---\nroot = B()\n```")).toEqual(["root = A()", "root = B()"]);
    expect(splitCards("root = A()\n  ---  \n\n---\n")).toEqual(["root = A()"]);
  });

  it("bounds the units one call sends, and says so", () => {
    const many = Array.from({ length: NOTES_MAX_UNITS + 5 }, (_, i) => ({ id: `u${i}`, text: "x" }));
    const input = notesInputOf(many);
    expect(input.units).toHaveLength(NOTES_MAX_UNITS);
    expect(input.truncated).toBe(true);
    expect(notesInputOf(units).truncated).toBeUndefined();
  });

  it("keeps a card whose citation was never defined, citing nothing; rejects an untitled one or a non-card", () => {
    expect(cardOf('root = IdeaCard("T", "B", "high", [c1])', 0, new Set(["u1"]))).toMatchObject({ title: "T", cites: [], unknownUnits: [] });
    expect(cardOf('root = IdeaCard("", "B")', 0, new Set())).toBeNull();
    expect(cardOf('root = Callout("info", "x")', 0, new Set())).toBeNull();
  });
});
