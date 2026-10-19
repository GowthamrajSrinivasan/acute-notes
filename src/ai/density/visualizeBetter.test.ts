/**
 * F42 Phase 4.2 over the pure pipeline: a dense block → one `generate_visual_plan` call with the dense rules →
 * a change set of one frame of pieces beside the block, the block's removal, and (with a link) the split record.
 * A real AIProviderManager + task registry + MockProvider.
 */
import { describe, expect, it, vi } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest } from "@/ai/types";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { NothingToSplitError, visualizeBetter, type VisualizeBetterInput } from "./visualizeBetter";

const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const CARDS = {
  version: 1,
  template: "sectioned",
  nodes: [
    { id: "h", type: "heading", content: { text: "Wave 1b" } },
    { id: "c1", type: "text", title: "Levels for Repo Map", stableKey: "card#1", content: { markdown: "**Size:** M · **Status:** ✅ Done\n\nOverview first, then levels." } },
    { id: "c2", type: "text", title: "Tidy map", stableKey: "card#2", content: { markdown: "**Size:** S\n\nMCP side only." } },
    { id: "p1", type: "page", content: { title: "Levels for Repo Map", markdown: "The long detail." } },
  ],
  relationships: [
    { from: "c1", to: "c2", type: "flows_to" },
    { from: "c1", to: "p1", type: "explained_by" },
  ],
};

function runtimeReplying(reply: unknown) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn((_req: AIRequest) => ({ text: JSON.stringify(reply), model: "m", finishReason: "stop" as const, usage: { provider: "mock", model: "m" } }));
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), spy };
}

const input = (extra: Partial<VisualizeBetterInput> = {}): VisualizeBetterInput => ({
  text: "| Order | Item | Size |\n|---|---|---|\n| 1 | Levels for Repo Map … | M |",
  label: "Wave 1b",
  reason: "A table cell holds 1,840 characters",
  target: "el_table",
  box: { x: 0, y: 0, width: 400, height: 2_000 },
  split: { record: { sourceId: "src_1", version: 3, of: "Plan › Wave 1b#table0", fingerprint: "t456" }, keyPrefix: "Plan › Wave 1b#table0 ⊃ " },
  operationId: "op_split",
  context: { existing: [{ x: 0, y: 0, width: 400, height: 2_000 }], viewport: { x: 0, y: 0, width: 1600, height: 900 } },
  frameCount: 5,
  ...extra,
});

describe("visualizeBetter", () => {
  it("sends only the block, with the dense rules, as a cards section named like the block", async () => {
    const { runtime, spy } = runtimeReplying(CARDS);
    await visualizeBetter(input(), runtime, { parseMarkdown: parse });
    expect(spy).toHaveBeenCalledTimes(1);
    const prompt = spy.mock.calls[0]![0]!.prompt;
    expect(prompt).toContain('This is one section, "Wave 1b"');
    expect(prompt).toContain("too much in it to read (A table cell holds 1,840 characters)");
    expect(prompt).toContain("one card per row");
    expect(prompt).toContain("| 1 | Levels for Repo Map … | M |");
  });

  it("proposes one frame of pieces beside the block and the block's removal, as a split of its node", async () => {
    const { runtime } = runtimeReplying(CARDS);
    const { changeSet } = await visualizeBetter(input(), runtime, { parseMarkdown: parse });
    const set = parseChangeSet(changeSet); // a valid change set
    expect(set.title).toBe("Visualize better: Wave 1b");
    expect(set.split).toEqual({ sourceId: "src_1", version: 3, of: "Plan › Wave 1b#table0", fingerprint: "t456" });
    expect(set.contentSource).toBeUndefined();
    const kinds = set.changes.map((c) => c.kind);
    expect(kinds.filter((k) => k === "create_frame")).toHaveLength(1);
    expect(kinds.at(-1)).toBe("remove");
    expect(set.changes.at(-1)).toEqual({ kind: "remove", target: "el_table" });
    // The heading repeating the block's title is dropped (the frame's title shows it); the cards, page and links stay.
    const frame = set.changes.find((c) => c.kind === "create_frame")!;
    expect(frame.children).toHaveLength(4); // its title + 2 cards + the page
    expect(frame.title).toBe("6 · Overview"); // numbered after the canvas's 5 frames
    expect(set.changes.filter((c) => c.kind === "connect").map((c) => c.relation)).toEqual(["flows_to", "explained_by"]);
    // Every piece is keyed under the block's own key; the pieces sit to the right of the block.
    const keyed = set.changes.flatMap((c) => ("stableNodeKey" in c && c.stableNodeKey ? [c.stableNodeKey] : []));
    expect(keyed).toEqual(expect.arrayContaining(["Plan › Wave 1b#table0 ⊃ card#1", "Plan › Wave 1b#table0 ⊃ card#2", "Plan › Wave 1b#table0 ⊃ section"]));
    expect(keyed.every((k) => k.startsWith("Plan › Wave 1b#table0 ⊃ "))).toBe(true);
    expect(frame.box.x).toBeGreaterThanOrEqual(400);
  });

  it("a block with no source link: plain new objects, no split record", async () => {
    const { runtime } = runtimeReplying(CARDS);
    const { changeSet } = await visualizeBetter(input({ split: null }), runtime, { parseMarkdown: parse });
    expect(changeSet.split).toBeUndefined();
    expect(changeSet.changes.find((c) => c.kind === "create_block" && c.stableNodeKey?.includes(" ⊃ "))).toBeUndefined();
  });

  it("a reply with nothing to split into changes nothing", async () => {
    const { runtime } = runtimeReplying({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: "All of it, again." } }], relationships: [] });
    await expect(visualizeBetter(input(), runtime, { parseMarkdown: parse })).rejects.toBeInstanceOf(NothingToSplitError);
  });
});
