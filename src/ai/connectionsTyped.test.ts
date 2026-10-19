import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { getPersistence } from "@/persistence";
import { getAIProviderManager } from "@/ai/providerManager";
import * as connections from "./connections";

afterEach(async () => {
  await Promise.all(["openai", "openrouter", "anthropic"].map((id) => connections.disconnect(id)));
  await connections.setTypedDecision(null);
});

describe("typed decision model (connections)", () => {
  it("is optional: off by default, enabled on a connection whose key opens a decisions API, restored on load, cleared by disconnect", async () => {
    const manager = getAIProviderManager();
    expect(manager.getTypedDecisionProvider()).toBeNull();
    expect(connections.typedDecisionOptions().map((o) => [o.connectionId, o.defaultModel])).toEqual(
      expect.arrayContaining([
        ["openrouter", "typesafe/jev-1.13"],
        ["openai", "gpt-6-luna"],
      ]),
    );

    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1", secret: "sk-typed-secret" });
    await connections.setTypedDecision({ connectionId: "openai", model: " gpt-6-luna " });
    expect(await connections.getTypedDecisionSelection()).toEqual({ connectionId: "openai", model: "gpt-6-luna" });
    expect(manager.getTypedDecisionProvider()).toMatchObject({ id: "openai", model: "gpt-6-luna" });
    // The key is stored with the connection, never with the selection.
    expect(JSON.stringify(await getPersistence().meta.get("ai.typedDecisionModel"))).not.toContain("sk-typed-secret");

    manager.setTypedDecisionProvider(null);
    await connections.loadConnections();
    expect(manager.getTypedDecisionProvider()).toMatchObject({ id: "openai" });

    await connections.setTypedDecision(null);
    expect(manager.getTypedDecisionProvider()).toBeNull();

    await connections.setTypedDecision({ connectionId: "openai", model: "gpt-6-luna" });
    await connections.disconnect("openai");
    expect(manager.getTypedDecisionProvider()).toBeNull();
    expect(await connections.getTypedDecisionSelection()).toBeNull();
  });

  it("needs a connection that has one, that is connected, and its key", async () => {
    await expect(connections.setTypedDecision({ connectionId: "anthropic", model: "x" })).rejects.toThrow(/no typed decision model/);
    await expect(connections.setTypedDecision({ connectionId: "openai", model: "gpt-6-luna" })).rejects.toThrow(/not connected/);
    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1" });
    await expect(connections.setTypedDecision({ connectionId: "openai", model: "gpt-6-luna" })).rejects.toThrow(/needs an API key/);
  });
});
