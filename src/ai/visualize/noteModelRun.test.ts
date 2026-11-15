/**
 * WP2.8: a Visualize run's note model is the one its input carries ("Keep full detail" in the dialog, shown from R1),
 * else `FIDELITY_CONFIG.noteModel` exactly as before. The global config is never changed by a run.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { distiller } from "@/ai/fidelity/__fixtures__/knowledge/mockDistiller";
import { ingestContent, type IngestPorts } from "@/ai/ingest/ingest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest } from "@/ai/types";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import type { ContentSourceRepository } from "@/persistence/repositories/types";
import { registerVisualizeTasks } from "./tasks";
import { visualizeContent } from "./visualize";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];

const DOC = `# Caching notes

## Retries

Retries can improve reliability when the cache holds a valid result. They must stop after 3 attempts, however short the outage.

## Limits

The cache keeps at most 500 entries per tenant. Entries expire after 30 minutes. Thanks for reading.
`;

function runtimeWith() {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn(distiller({}));
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  const prompts = () => spy.mock.calls.map((c) => c[0] as AIRequest).filter((r) => r.task === "generate_visual_plan").map((r) => r.prompt);
  return { runtime: createAIRuntime({ manager, registry }), prompts };
}

const run = (noteModel?: "preserve" | "distil") => {
  const { runtime, prompts } = runtimeWith();
  const result = visualizeContent({ text: DOC, operationId: "op_nm", title: "Visualize", context, forceAI: true, ...(noteModel ? { noteModel } : {}) }, runtime, { parseMarkdown: parse });
  return result.then((r) => ({ ...r, prompts: prompts() }));
};

describe("Visualize: the run's note model (WP2.8)", () => {
  const initial = FIDELITY_CONFIG.noteModel;
  afterEach(() => {
    FIDELITY_CONFIG.noteModel = initial;
  });

  it("no note model on the input: the configured one, as before (preserve by default)", async () => {
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
    const { changeSet } = await run();
    expect(changeSet.metadata).not.toHaveProperty("noteModel");
    expect(changeSet.knowledge).toBeUndefined();
  });

  it("distil on the input while the config says preserve: the run distils; the config is unchanged", async () => {
    const { changeSet, prompts } = await run("distil");
    expect(changeSet.metadata.noteModel).toBe("distil");
    expect(changeSet.knowledge).toBeDefined();
    expect(changeSet.contentSource!.units).toBeDefined();
    expect(prompts.length).toBeGreaterThan(0);
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
  });

  it("preserve on the input (Keep full detail) while the config says distil: the run preserves, with today's prompts", async () => {
    FIDELITY_CONFIG.noteModel = "distil";
    const kept = await run("preserve");
    expect(kept.changeSet.metadata).not.toHaveProperty("noteModel");
    expect(kept.changeSet.knowledge).toBeUndefined();
    expect(kept.changeSet.contentSource!.units).toBeUndefined();
    expect(FIDELITY_CONFIG.noteModel).toBe("distil");
    // The same prompts a preserve-configured run sends.
    FIDELITY_CONFIG.noteModel = "preserve";
    const today = await run();
    expect(kept.prompts).toEqual(today.prompts);
  });

  it("the ingest service (the dialog's path) passes the run's note model through", async () => {
    const { runtime } = runtimeWith();
    const ports: IngestPorts = {
      runtime,
      contentSources: {} as ContentSourceRepository,
      renderContext: () => context,
      sourceObjects: () => ({ existing: [], connections: [] }),
    };
    const distilled = await ingestContent({ mode: "new", text: DOC, noteModel: "distil" }, ports, { parseMarkdown: parse });
    expect(distilled.changeSet!.metadata.noteModel).toBe("distil");
    const plain = await ingestContent({ mode: "new", text: DOC }, ports, { parseMarkdown: parse });
    expect(plain.changeSet!.metadata).not.toHaveProperty("noteModel");
  });
});
