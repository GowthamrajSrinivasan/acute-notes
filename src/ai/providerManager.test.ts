import { describe, expect, it } from "vitest";
import { AIProviderManager } from "./providerManager";
import { createMockProvider } from "./providers/mock/mockProvider";
import type { AIResponse } from "./types";

function provider(id: string) {
  return createMockProvider({
    id,
    respond: async (): Promise<AIResponse> => ({
      text: "",
      model: id,
      finishReason: "stop",
      usage: { provider: id, model: id },
    }),
  });
}

describe("AIProviderManager", () => {
  it("has no active provider until one is set as primary", () => {
    const manager = new AIProviderManager();
    expect(manager.getActiveProvider()).toBeNull();
  });

  it("selects the registered primary", () => {
    const manager = new AIProviderManager();
    const primary = provider("primary");
    manager.registerProvider(primary);
    manager.setPrimary("primary");
    expect(manager.getActiveProvider()).toBe(primary);
  });

  it("rejects selecting an unregistered provider id", () => {
    const manager = new AIProviderManager();
    expect(() => manager.setPrimary("nope")).toThrow(/not registered/);
  });

  it("fallback is off by default even once a fallback provider is registered", () => {
    const manager = new AIProviderManager();
    manager.registerProvider(provider("fallback"));
    manager.setFallback("fallback", false);
    expect(manager.isFallbackEnabled()).toBe(false);
    expect(manager.getFallbackProvider()).toBeNull();
  });

  it("exposes the fallback provider only once explicitly enabled", () => {
    const manager = new AIProviderManager();
    const fallback = provider("fallback");
    manager.registerProvider(fallback);
    manager.setFallback("fallback");
    expect(manager.isFallbackEnabled()).toBe(true);
    expect(manager.getFallbackProvider()).toBe(fallback);
  });

  it("clearing the fallback turns it back off", () => {
    const manager = new AIProviderManager();
    manager.registerProvider(provider("fallback"));
    manager.setFallback("fallback");
    manager.setFallback(null);
    expect(manager.isFallbackEnabled()).toBe(false);
    expect(manager.getFallbackProvider()).toBeNull();
  });

  it("exposes the decision-model provider independently of primary/fallback", () => {
    const manager = new AIProviderManager();
    const decision = provider("decision");
    manager.registerProvider(decision);
    manager.setDecisionModel("decision");
    expect(manager.getDecisionProvider()).toBe(decision);
  });

  it("a decision provider instance doesn't replace the registered connection it was made from", () => {
    const manager = new AIProviderManager();
    const primary = provider("shared");
    const fast = provider("shared");
    manager.registerProvider(primary);
    manager.setPrimary("shared");
    manager.setDecisionProvider(fast);
    expect(manager.getDecisionProvider()).toBe(fast);
    expect(manager.getActiveProvider()).toBe(primary);
    manager.setDecisionProvider(null);
    expect(manager.getDecisionProvider()).toBeNull();
  });

  it("setPrimary(null) explicitly clears the primary", () => {
    const manager = new AIProviderManager();
    manager.registerProvider(provider("primary"));
    manager.setPrimary("primary");
    manager.setPrimary(null);
    expect(manager.getActiveProvider()).toBeNull();
  });

  it("unregisterProvider removes it as primary, fallback, and decision model wherever it was selected", () => {
    const manager = new AIProviderManager();
    manager.registerProvider(provider("shared"));
    manager.setPrimary("shared");

    manager.unregisterProvider("shared");

    expect(manager.getActiveProvider()).toBeNull();
    // A disconnected id is no longer registered at all — re-selecting it must fail again.
    expect(() => manager.setPrimary("shared")).toThrow(/not registered/);
  });

  it("unregisterProvider turns off a fallback that pointed at it", () => {
    const manager = new AIProviderManager();
    manager.registerProvider(provider("primary"));
    manager.setPrimary("primary");
    manager.registerProvider(provider("fallback"));
    manager.setFallback("fallback");

    manager.unregisterProvider("fallback");

    expect(manager.isFallbackEnabled()).toBe(false);
    expect(manager.getFallbackProvider()).toBeNull();
  });

  it("unregisterProvider leaves an unrelated primary/fallback untouched", () => {
    const manager = new AIProviderManager();
    const primary = provider("primary");
    manager.registerProvider(primary);
    manager.setPrimary("primary");
    manager.registerProvider(provider("other"));

    manager.unregisterProvider("other");

    expect(manager.getActiveProvider()).toBe(primary);
  });
});
