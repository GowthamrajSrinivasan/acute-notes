import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import { createPlaceholderProvider } from "./placeholderProvider";

/**
 * PRD §23 "First AI release — done when": adding a connection is a new
 * adapter folder plus one registry line. The mock below is that one line;
 * nothing else changes, and the connection works end to end through the
 * same `connections.ts` API the settings UI uses.
 */
vi.mock("@/ai/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ai/providers/registry")>();
  return {
    ...actual,
    AI_PROVIDER_DESCRIPTORS: [
      ...actual.AI_PROVIDER_DESCRIPTORS,
      // ↓ the one registry line
      { id: "placeholder", name: "Placeholder", accessType: "api_key", billingWording: "Test only.", authFlow: "api_key", transport: "browser_direct", listsModels: true, fields: [{ key: "apiKey", label: "API key", required: true, secret: true }], createProvider: (r: { model?: string; secret?: string }) => createPlaceholderProvider(r) },
    ],
  };
});

const connections = await import("@/ai/connections");
const { getAIProviderManager } = await import("@/ai/providerManager");

afterEach(async () => {
  await connections.disconnect("placeholder");
});

describe("a new connection is one folder + one registry line", () => {
  it("connects, tests, lists models and becomes primary through connections.ts", async () => {
    expect(connections.getDescriptor("placeholder")?.name).toBe("Placeholder");
    await connections.connect("placeholder", { secret: "k" });

    expect(await connections.testConnection("placeholder")).toEqual({ ok: true });
    expect(await connections.listModels("placeholder")).toEqual([{ id: "placeholder-1", name: "Placeholder 1" }]);
    await connections.setPrimary("placeholder");
    expect(connections.getPrimaryId()).toBe("placeholder");
  });

  it("serves a task through AIRuntime with no feature-code change", async () => {
    await connections.connect("placeholder", { secret: "k" });
    await connections.setPrimary("placeholder");
    const registry = createTaskRegistry();
    registry.register({
      task: "classify",
      inputSchema: z.object({}),
      outputSchema: z.object({ label: z.string() }),
      buildPrompt: () => ({ prompt: "x" }),
      policy: {},
    });

    const result = await createAIRuntime({ manager: getAIProviderManager(), registry }).run("classify", {});
    expect(result).toMatchObject({ data: { label: "placeholder" }, providerId: "placeholder" });
  });
});
