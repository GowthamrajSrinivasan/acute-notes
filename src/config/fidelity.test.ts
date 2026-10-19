import { describe, expect, it } from "vitest";
import { FIDELITY_CONFIG } from "./fidelity";

describe("FIDELITY_CONFIG.modelGuidance (Wave F2)", () => {
  const { litePattern } = FIDELITY_CONFIG.modelGuidance;

  it("matches lite/flash-lite/mini/nano model ids", () => {
    for (const model of ["gemini-3.1-flash-lite", "gpt-4o-mini", "claude-haiku-4-5-20251001".replace("haiku", "nano"), "some-lite-model"]) {
      expect(litePattern.test(model)).toBe(true);
    }
  });

  it("doesn't match full-size model ids", () => {
    for (const model of ["gemini-3.1-pro", "gpt-4o", "claude-opus-5-5", "claude-sonnet-5-5"]) {
      expect(litePattern.test(model)).toBe(false);
    }
  });

  it("is enabled by default, with a non-empty message", () => {
    expect(FIDELITY_CONFIG.modelGuidance.enabled).toBe(true);
    expect(FIDELITY_CONFIG.modelGuidance.message.length).toBeGreaterThan(0);
  });
});
