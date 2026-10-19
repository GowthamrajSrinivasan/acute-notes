import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPersistence } from "@/persistence";
import { getAIProviderManager } from "@/ai/providerManager";
import * as connections from "./connections";

const ALL_IDS = ["copilot", "openai", "azure", "anthropic", "ollama"];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(ALL_IDS.map((id) => connections.disconnect(id)));
});

describe("connect", () => {
  it("persists only non-secret config — the API key never appears in stored config", async () => {
    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1", secret: "sk-super-secret" });

    const stored = await getPersistence().aiConnections.get("openai");
    expect(stored).toEqual({
      providerId: "openai",
      authType: "api_key",
      model: "gpt-4",
      metadata: { endpoint: "https://api.openai.com/v1" },
    });
    expect(JSON.stringify(stored)).not.toContain("sk-super-secret");
  });

  it("registers a provider usable as primary", async () => {
    await connections.connect("anthropic", { model: "claude-sonnet-4.5", endpoint: "https://api.anthropic.com", secret: "sk-ant-x" });
    await connections.setPrimary("anthropic");
    expect(getAIProviderManager().getActiveProvider()?.id).toBe("anthropic");
  });

  it("connects GitHub Copilot with no secret at all (local logged-in-user mode)", async () => {
    await connections.connect("copilot", {});
    const stored = await getPersistence().aiConnections.get("copilot");
    expect(stored).toEqual({ providerId: "copilot", authType: "subscription", model: undefined, metadata: undefined });
  });

  it("rejects an unknown connection id", async () => {
    await expect(connections.connect("not-a-real-connection", {})).rejects.toThrow(/Unknown AI connection/);
  });
});

describe("decision model", () => {
  it("is any connection with its own model: saved, built apart from the connection, and restored on load", async () => {
    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1", secret: "sk-x" });
    await connections.setPrimary("openai");
    await connections.setDecisionModel({ connectionId: "openai", model: " gpt-4o-mini " });

    const manager = getAIProviderManager();
    expect(await connections.getDecisionSelection()).toEqual({ connectionId: "openai", model: "gpt-4o-mini" });
    expect(manager.getDecisionProvider()).not.toBeNull();
    expect(manager.getDecisionProvider()).not.toBe(manager.getActiveProvider());

    manager.setDecisionProvider(null);
    await connections.loadConnections();
    expect(manager.getDecisionProvider()).not.toBeNull();

    await connections.setDecisionModel(null);
    expect(manager.getDecisionProvider()).toBeNull();
    expect(await connections.getDecisionSelection()).toBeNull();
  });

  it("needs a connected connection, and disconnecting it clears the decision model", async () => {
    await expect(connections.setDecisionModel({ connectionId: "anthropic", model: "x" })).rejects.toThrow(/not connected/);
    await connections.connect("anthropic", { model: "claude-sonnet-4.5", endpoint: "https://api.anthropic.com", secret: "sk-ant-x" });
    await connections.setDecisionModel({ connectionId: "anthropic", model: "claude-haiku-4.5" });
    await connections.disconnect("anthropic");
    expect(getAIProviderManager().getDecisionProvider()).toBeNull();
    expect(await connections.getDecisionSelection()).toBeNull();
  });
});

describe("disconnect", () => {
  it("removes the stored config, the secret, and the registered provider", async () => {
    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1", secret: "sk-x" });
    await connections.setPrimary("openai");

    await connections.disconnect("openai");

    expect(await getPersistence().aiConnections.get("openai")).toBeNull();
    expect(getAIProviderManager().getActiveProvider()).toBeNull();
    expect(connections.getPrimaryId()).toBeNull();
  });

  it("clearing the current primary also clears the persisted primary selection", async () => {
    await connections.connect("ollama", { model: "llama3", endpoint: "http://localhost:11434/v1" });
    await connections.setPrimary("ollama");
    await connections.disconnect("ollama");

    expect(connections.getPrimaryId()).toBeNull();
    expect(await getPersistence().meta.get("ai.primaryConnection")).toBeUndefined();
  });

  it("with no primary chosen, any connected option is used automatically (not saved)", async () => {
    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1", secret: "sk-x" });
    expect(connections.getPrimaryId()).toBe("openai");
    expect(connections.isPrimaryAutomatic()).toBe(true);
    expect(await getPersistence().meta.get("ai.primaryConnection")).toBeUndefined();
  });

  it("the automatic choice prefers subscription, then local, then API-key connections", async () => {
    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1", secret: "sk-x" });
    await connections.connect("ollama", { model: "llama3", endpoint: "http://localhost:11434/v1" });
    expect(connections.getPrimaryId()).toBe("ollama");
    await connections.connect("copilot", {});
    expect(connections.getPrimaryId()).toBe("copilot");
    await connections.disconnect("copilot");
    expect(connections.getPrimaryId()).toBe("ollama");
  });

  it("an explicit primary is saved and wins over the automatic choice", async () => {
    await connections.connect("copilot", {});
    await connections.connect("ollama", { model: "llama3", endpoint: "http://localhost:11434/v1" });
    await connections.setPrimary("ollama");
    expect(connections.getPrimaryId()).toBe("ollama");
    expect(connections.isPrimaryAutomatic()).toBe(false);
    expect(await getPersistence().meta.get("ai.primaryConnection")).toBe("ollama");
    // Disconnecting it returns to the automatic choice.
    await connections.disconnect("ollama");
    expect(connections.getPrimaryId()).toBe("copilot");
    expect(connections.isPrimaryAutomatic()).toBe(true);
  });

  it("the automatic choice skips the fallback connection", async () => {
    await connections.connect("copilot", {});
    await connections.connect("ollama", { model: "llama3", endpoint: "http://localhost:11434/v1" });
    await connections.setFallback("copilot");
    await connections.disconnect("openai"); // any change re-resolves
    expect(connections.getPrimaryId()).toBe("ollama");
  });
});

describe("primary and fallback selection", () => {
  it("fallback stays off by default", async () => {
    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1", secret: "sk-x" });
    expect(connections.getFallbackId()).toBeNull();
  });

  it("requires an already-connected id for fallback", async () => {
    await expect(connections.setFallback("openai")).rejects.toThrow(/not registered/);
  });

  it("sets and clears an explicit fallback", async () => {
    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1", secret: "sk-x" });
    await connections.setFallback("openai");
    expect(connections.getFallbackId()).toBe("openai");
    await connections.setFallback(null);
    expect(connections.getFallbackId()).toBeNull();
  });
});

describe("loadConnections", () => {
  it("restores providers and primary/fallback from previously stored state", async () => {
    await getPersistence().aiConnections.put({ providerId: "openai", authType: "api_key", model: "gpt-4", metadata: { endpoint: "https://api.openai.com/v1" } });
    await getPersistence().aiConnections.put({ providerId: "anthropic", authType: "api_key", model: "claude-sonnet-4.5", metadata: { endpoint: "https://api.anthropic.com" } });
    await getPersistence().meta.set("ai.primaryConnection", "openai");
    await getPersistence().meta.set("ai.fallbackConnection", "anthropic");

    await connections.loadConnections();

    expect(connections.getPrimaryId()).toBe("openai");
    expect(connections.getFallbackId()).toBe("anthropic");
  });

  it("uses stored connections without a saved primary automatically", async () => {
    await getPersistence().aiConnections.put({ providerId: "ollama", authType: "local" });
    await getPersistence().aiConnections.put({ providerId: "copilot", authType: "subscription" });
    await connections.loadConnections();
    expect(connections.getPrimaryId()).toBe("copilot");
    expect(connections.isPrimaryAutomatic()).toBe(true);
    expect(connections.hasConnections()).toBe(true);
  });

  it("ignores a stale primary/fallback pointing at a connection no longer stored", async () => {
    await getPersistence().meta.set("ai.primaryConnection", "openai");
    await connections.loadConnections();
    expect(connections.getPrimaryId()).toBeNull();
  });
});

describe("testConnection", () => {
  it("reports ok:true when the underlying provider's test succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ id: "gpt-4", name: "GPT-4" }])));
    await connections.connect("openai", { model: "gpt-4", endpoint: "https://api.openai.com/v1", secret: "sk-x" });

    const result = await connections.testConnection("openai");
    expect(result.ok).toBe(true);
  });

  it("reports 'not connected' for a connection with no stored config", async () => {
    const result = await connections.testConnection("azure");
    expect(result).toEqual({ ok: false, message: "Not connected." });
  });
});
