/**
 * A long document (an AI chat pasted whole) outlines into sections that together create more than one review
 * holds (500 changes). The real outlined Visualize output must split by section, validate, stay complete, and be
 * reviewable — below, at and above the boundary.
 */
import { describe, expect, it } from "vitest";
import { MAX_CHANGES, parseChangeSet } from "@/ai/changes/changeSet";
import { PendingChanges } from "@/ai/changes/pendingChanges";
import { partSlices } from "@/ai/changes/parts";
import { splitIntoSectionParts } from "@/ai/changes/sectionParts";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import { registerVisualizeTasks } from "./tasks";
import { visualizeContent } from "./visualize";

const response = (text: string) => ({ text, model: "m", finishReason: "stop" as const, usage: { provider: "mock", model: "m" } });
const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };

async function outlined(sections: number, nodesPerSection: number) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const doc = "# Chat\n\n" + Array.from({ length: sections }, (_, i) => `## Part ${i}\n\n${"word ".repeat(300)}\n\n- a${i}\n- b${i}\n`).join("\n");
  manager.registerProvider(
    createMockProvider({
      id: "mock",
      respond: (req) => {
        if (req.task === "outline_document") {
          return response(JSON.stringify({ summary: "S", sections: Array.from({ length: sections }, (_, i) => ({ id: `s${i + 1}`, label: `Part ${i}`, kind: "notes", parts: [`u${i + 1}`] })) }));
        }
        const label = /This is one section, "([^"]+)"/.exec(req.prompt)?.[1] ?? "?";
        const nodes = Array.from({ length: nodesPerSection }, (_, i) => ({ id: `n${i}`, type: "shape", content: { shape: "rectangle", label: `${label} point ${i}` } }));
        return response(JSON.stringify({ version: 1, template: "sectioned", nodes, relationships: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id, type: "relates_to" })) }));
      },
    }),
  );
  manager.setPrimary("mock");
  const runtime = createAIRuntime({ manager, registry });
  return (await visualizeContent({ text: doc, operationId: "op", title: "V", context }, runtime, { parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }] })).changeSet;
}

describe("outlined Visualize past the change-set limit", () => {
  it("a result under the limit is proposed as before, with no parts", async () => {
    const set = await outlined(3, 20);
    expect(set.changes.length).toBeLessThan(MAX_CHANGES);
    const out = splitIntoSectionParts(set);
    expect(out).toBe(set);
    expect(new PendingChanges().propose("c", out).parts).toBeUndefined();
  });

  it("a result over the limit is refused by a plain proposal, but splits by section and is reviewable", async () => {
    const set = await outlined(12, 25);
    expect(set.changes.length).toBeGreaterThan(MAX_CHANGES);
    expect(() => new PendingChanges().propose("c", set)).toThrow(/<=500/);
    const split = splitIntoSectionParts(set);
    expect(split.parts!.length).toBeGreaterThanOrEqual(3);
    expect(split.parts!.every((p) => p.changes <= MAX_CHANGES && p.contentSource?.sourceId === set.contentSource!.sourceId)).toBe(true);
    expect(split.changes).toHaveLength(set.changes.length);
    expect(split.contentSource).toBeUndefined();
    const pending = new PendingChanges();
    const staged = pending.propose("c", split);
    // Every section's blocks sit in that section's part.
    const slices = partSlices(parseChangeSet(staged));
    for (const label of ["Part 0", "Part 1", "Part 11"]) {
      const mine = slices.find((s) => s.part.title === label);
      expect(mine, label).toBeDefined();
      expect(JSON.stringify(mine!.changes)).toContain(`${label} point 24`);
      expect(JSON.stringify(slices.filter((s) => s !== mine).map((s) => s.changes))).not.toContain(`${label} point 24`);
    }
  });

});
