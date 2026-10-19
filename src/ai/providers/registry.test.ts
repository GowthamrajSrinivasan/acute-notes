import { describe, expect, it } from "vitest";
import { AI_PROVIDER_DESCRIPTORS } from "./registry";

/**
 * No component-rendering test here (this project has no React Testing
 * Library / jsdom setup — every existing test is logic-level, and the UI
 * itself is verified by running the dev server). This guards the data the
 * settings UI renders from: every descriptor id is unique, `createProvider`
 * actually produces a provider with the matching id, and the field list
 * matches each connection's real shape (no API-key field for a local
 * connection, an endpoint required for every BYOK connection).
 */
describe("AI_PROVIDER_DESCRIPTORS", () => {
  it("has a unique id per descriptor", () => {
    const ids = AI_PROVIDER_DESCRIPTORS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("createProvider produces an AIProvider whose id matches the descriptor", () => {
    for (const descriptor of AI_PROVIDER_DESCRIPTORS) {
      const provider = descriptor.createProvider({ model: "m", endpoint: "https://example.test", secret: "s" });
      expect(provider.id).toBe(descriptor.id);
    }
  });

  it("only api_key connections declare a secret field", () => {
    for (const descriptor of AI_PROVIDER_DESCRIPTORS) {
      const hasSecretField = descriptor.fields.some((f) => f.secret);
      expect(hasSecretField).toBe(descriptor.accessType === "api_key");
    }
  });

  it("every BYOK connection (api_key or local) requires an endpoint", () => {
    for (const descriptor of AI_PROVIDER_DESCRIPTORS) {
      if (descriptor.accessType === "subscription") continue;
      const endpoint = descriptor.fields.find((f) => f.key === "endpoint");
      expect(endpoint?.required).toBe(true);
    }
  });

  it("the subscription connection (Copilot) has no required field at all", () => {
    const copilot = AI_PROVIDER_DESCRIPTORS.find((d) => d.accessType === "subscription");
    expect(copilot?.fields.every((f) => !f.required)).toBe(true);
  });

  it("hides only connections the F36 validation matrix records as failing (never merely untested)", () => {
    // Keep in sync with .ai/docs/ai-connection-validation-matrix.md — currently nothing has failed.
    const hidden = AI_PROVIDER_DESCRIPTORS.filter((d) => d.hidden).map((d) => d.id);
    expect(hidden).toEqual([]);
  });
});
