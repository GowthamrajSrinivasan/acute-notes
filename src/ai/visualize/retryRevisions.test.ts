/**
 * A section retry ("Retry 1 section" / "Regenerate", `regenerateSections`) re-renders a kept run with the same text: it keeps
 * the revisions (G3.3) the first run found instead of asking `find_revisions` again, also in its layout probes. A new run of
 * the same text still asks.
 */
import { describe, expect, it, vi } from "vitest";
import { regenerateSections } from "@/ai/fidelity/regenerate";
import { registerRevisionTasks } from "@/ai/history/revisions";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { registerVisualizeTasks } from "./tasks";
import { visualizeContent } from "./visualize";

// The layout score, stood in for by the number of arrows drawn (as `regenerate.test.ts`), so the probes run without a canvas.
vi.mock("@/ai/changes/proposalGeometry", () => ({
  checkProposal: (changes: readonly { kind: string }[]) => ({ score: changes.filter((c) => c.kind === "connect").length, issues: [], counts: {}, truncated: false }),
}));

const DOC = `# Notes

## Storage

We store every workspace in Firestore. Attachments stay as blobs. Actually, we switched to Postgres for workspaces.

## Access

Users bring their own AI. The app never ships a model key.
`;
const OUTLINE = {
  sections: [
    { id: "s1", label: "Storage", kind: "notes", prominence: "primary", parts: ["u1"] },
    { id: "s2", label: "Access", kind: "notes", prominence: "primary", parts: ["u2"] },
  ],
};
const PAIR = { section: "u1", earlier: "We store every workspace in Firestore.", later: "Actually, we switched to Postgres for workspaces." };
const ANALYSIS = { id: "an1", type: "text", origin: "analysis", content: { markdown: "The section at a glance." } };
const plan = (markdown: string) => JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown } }, ANALYSIS], relationships: [], metadata: { takeaway: "At a glance" } });
const response = (t: string): AIResponse => ({ text: t, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });
const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];

/** Storage: a reply that leaves most out first (so it is offered for Regenerate), then a full one. */
function setup() {
  let storage = 0;
  const spy = vi.fn((req: AIRequest) => {
    if (req.task === "find_revisions") return response(JSON.stringify({ revisions: [PAIR] }));
    if (req.task === "outline_document") return response(JSON.stringify(OUTLINE));
    if (req.prompt.includes('"Storage"')) return response(storage++ ? plan("We switched to Postgres for workspaces; attachments stay as blobs.") : plan("Attachments."));
    return response(plan("Users bring their own AI; the app never ships a model key."));
  });
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  registerRevisionTasks(registry);
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), spy };
}
const asked = (spy: ReturnType<typeof setup>["spy"]) => spy.mock.calls.filter((c) => c[0]!.task === "find_revisions").length;

describe("a section retry keeps the first run's revisions", () => {
  it("asks find_revisions once for the run, none for the retry or its layout probes, and still drops the earlier statement", async () => {
    const { runtime, spy } = setup();
    const first = await visualizeContent({ text: DOC, operationId: "rv_1", title: "Visualize", context, forceAI: true }, runtime, { parseMarkdown: parse });
    expect(asked(spy)).toBe(1);
    const storage = first.fidelity!.sections.find((s) => s.label === "Storage")!;
    const before = spy.mock.calls.length;

    const again = await regenerateSections("rv_1", [storage.key], runtime, { operationId: "rv_2", context, scene: [] }, { parseMarkdown: parse });
    expect(asked(spy)).toBe(1);
    // Only the retried section was analysed again.
    const retried = spy.mock.calls.slice(before).map((c) => c[0]!);
    expect(retried.map((r) => r.task)).toEqual(["generate_visual_plan"]);
    expect(retried[0]!.prompt).toContain('"Storage"');
    // The revision still applies: the earlier statement isn't sent, and the version keeps the pair.
    expect(retried[0]!.prompt).not.toContain("in Firestore");
    expect(again.changeSet.contentSource).toMatchObject({ revisions: [{ earlier: PAIR.earlier, later: PAIR.later }] });
  });

  it("a new run of the same text asks again", async () => {
    const { runtime, spy } = setup();
    await visualizeContent({ text: DOC, operationId: "rv_3", title: "Visualize", context, forceAI: true }, runtime, { parseMarkdown: parse });
    await visualizeContent({ text: DOC, operationId: "rv_4", title: "Visualize", context, forceAI: true }, runtime, { parseMarkdown: parse });
    expect(asked(spy)).toBe(2);
  });
});
