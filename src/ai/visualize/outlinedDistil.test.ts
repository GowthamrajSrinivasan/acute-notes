/**
 * Knowledge Notes WP1.5: `FIDELITY_CONFIG.noteModel` is the switch (a developer setting until R1). `preserve`, the
 * default, sends today's section prompts; `distil` sends the distil rule with the section's units labelled. Mock AI only.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import { visualizeOutlined } from "./outlined";
import { DISTIL_RULE, FIDELITY_RULE, registerVisualizeTasks } from "./tasks";

const response = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });
const TEXT = "## Retries\n\nRetries can improve reliability when the cache holds a valid result. They must stop after 3 attempts.\n\n- Use an idempotency key";

function scripted() {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn((req: AIRequest) => {
    if (req.task === "outline_document") return response(JSON.stringify({ sections: [{ id: "s1", label: "Retries", kind: "notes", parts: ["u1"] }] }));
    const nodes = [
      { id: "n1", type: "text", title: "Retries help only with a valid cached result", cites: ["P1.1", "P1.2"], content: { markdown: "At most 3 attempts." } },
      { id: "a1", type: "text", origin: "analysis", title: "Status", content: { markdown: "Retries are bounded." } },
    ];
    return response(JSON.stringify({ version: 1, template: "sectioned", nodes, relationships: [], metadata: { takeaway: "Retries are bounded", omitted: [] } }));
  });
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  const prompts = () => spy.mock.calls.flatMap((c) => (c[0]!.task === "generate_visual_plan" ? [c[0]!.prompt] : []));
  return { runtime: createAIRuntime({ manager, registry }), prompts };
}

describe("FIDELITY_CONFIG.noteModel switches the section prompts (WP1.5)", () => {
  const initial = FIDELITY_CONFIG.noteModel;
  afterEach(() => {
    FIDELITY_CONFIG.noteModel = initial;
  });

  it("defaults to preserve: today's prompt, numbered blocks", async () => {
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
    const { runtime, prompts } = scripted();
    await visualizeOutlined([{ key: "u1", text: TEXT, span: { start: 0, end: TEXT.length } }], runtime);
    const [p] = prompts();
    expect(p).toContain(FIDELITY_RULE);
    expect(p).not.toContain(DISTIL_RULE);
    expect(p).toContain("[P1] Retries can improve reliability");
  });

  it("distil: the distil rule, and the section's units labelled for citing", async () => {
    FIDELITY_CONFIG.noteModel = "distil";
    const { runtime, prompts } = scripted();
    const result = await visualizeOutlined([{ key: "u1", text: TEXT, span: { start: 0, end: TEXT.length } }], runtime);
    const [p] = prompts();
    expect(p).toContain(DISTIL_RULE);
    expect(p).not.toContain(FIDELITY_RULE);
    expect(p).toContain("[P1]\nP1.1 Retries can improve reliability when the cache holds a valid result.\nP1.2 They must stop after 3 attempts.\n\n[L1]\nL1.1 Use an idempotency key");
    // The reply still becomes a plan as before (its citations are read by the run wiring, WP1.10–1.11).
    expect(JSON.stringify(result)).toContain("Retries help only with a valid cached result");
  });
});
