import { describe, expect, it, vi } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { visualizeContent } from "@/ai/visualize/visualize";
import { analyzeInThread } from "./analyze";

const FLOW = "flowchart LR\n  A[Paste] --> B{Valid?}\n  B -->|yes| C[Diagram]\n  B -->|no| A";

async function local(input: string) {
  return (await analyzeInThread(input)).local;
}

describe("local tier: a single Mermaid diagram (F33)", () => {
  it("a ```mermaid fence converts to shapes and flows_to arrows, spans pointing into the whole input", async () => {
    const input = `\`\`\`mermaid\n${FLOW}\n\`\`\`\n`;
    const r = await local(input);
    expect(r.sufficient).toBe(true);
    expect(r.aiRecommended).toBeUndefined();
    expect(r.reasons[0]).toContain("Mermaid flowchart");
    expect(r.plan!.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(r.plan!.relationships.map((x) => x.type)).toEqual(["flows_to", "flows_to", "flows_to"]);
    const a = r.plan!.nodes.find((n) => n.id === "A")!;
    expect(input.slice(a.sourceSpan!.start, a.sourceSpan!.end)).toBe("A[Paste]");
  });

  it("a heading above the fence titles the plan", async () => {
    const r = await local(`# Paste flow\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n`);
    expect(r.plan!.metadata?.title).toBe("Paste flow");
  });

  it("bare Mermaid source converts too, and an unlabelled fence is recognised by its header", async () => {
    expect((await local(`${FLOW}\n`)).plan!.relationships).toHaveLength(3);
    expect((await local(`\`\`\`\n${FLOW}\n\`\`\`\n`)).plan!.nodes).toHaveLength(3);
  });

  it("leaves everything else to the normal local plan", async () => {
    // A Mermaid block inside a larger document stays a code block.
    const mixed = await local(`# Plan\n\nSome intro text.\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\n- [ ] Ship it\n`);
    expect(mixed.plan!.nodes.some((n) => n.type === "code")).toBe(true);
    // Sequence, pie and gantt diagrams convert too (each its own parser/builder, not the generic flowchart-style one).
    const sequence = await local("```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n");
    expect(sequence.plan!.nodes.map((n) => n.type)).toEqual(["shape"]);
    const pie = await local('```mermaid\npie\n  "Dogs" : 3\n```\n');
    expect(pie.plan!.nodes.map((n) => n.type)).toEqual(["table"]);
    const gantt = await local("```mermaid\ngantt\n  Task : 1d\n```\n");
    expect(gantt.plan!.nodes.map((n) => n.type)).toEqual(["shape"]);
    // Unsupported kinds and broken source are not converted.
    const mindmap = await local("```mermaid\nmindmap\n  root\n```\n");
    expect(mindmap.plan!.nodes.map((n) => n.type)).toEqual(["code"]);
    const broken = await local("```mermaid\nflowchart LR\n  A --> (\n```\n");
    expect(broken.plan!.nodes.map((n) => n.type)).toEqual(["code"]);
    // Other code is untouched.
    expect((await local("```ts\nconst a = 1;\n```\n")).plan!.nodes.map((n) => n.type)).toEqual(["code"]);
  });

  it("Visualize renders it with no AI call: one shape per node, one typed arrow per link", async () => {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerVisualizeTasks(registry);
    const spy = vi.fn(() => ({ text: "never", model: "m", finishReason: "stop" as const, usage: { provider: "mock", model: "m" } }));
    manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
    manager.setPrimary("mock");
    const runtime = createAIRuntime({ manager, registry });

    const result = await visualizeContent(
      { text: `\`\`\`mermaid\n${FLOW}\n\`\`\`\n`, operationId: "op_m", title: "Visualize", context: { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } } },
      runtime,
      { parseMarkdown: (md: string) => [{ type: "paragraph" as const, content: md }] },
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result.usedLocalTier).toBe(true);
    const set = parseChangeSet(result.changeSet);
    const connects = set.changes.filter((c) => c.kind === "connect");
    expect(connects).toHaveLength(3);
    expect(connects.every((c) => c.kind === "connect" && c.relation === "flows_to")).toBe(true);
  });
});
