import { describe, expect, it } from "vitest";
import { AIError, isAvailabilityError } from "./errors";

describe("AIError", () => {
  it("carries a kind and message, with the standard Error name convention", () => {
    const err = new AIError("network", "boom");
    expect(err.name).toBe("AIError");
    expect(err.kind).toBe("network");
    expect(err.message).toBe("boom");
    expect(err).toBeInstanceOf(Error);
  });

  it("passes through the ES2022 cause option", () => {
    const cause = new Error("root cause");
    const err = new AIError("network", "boom", { cause });
    expect(err.cause).toBe(cause);
  });
});

describe("isAvailabilityError", () => {
  const availabilityKinds = ["auth", "quota_exhausted", "rate_limited", "model_unavailable", "network", "timeout"] as const;
  it.each(availabilityKinds)("treats %s as an availability error", (kind) => {
    expect(isAvailabilityError(new AIError(kind, "x"))).toBe(true);
  });

  const nonAvailabilityKinds = ["cancelled", "invalid_output"] as const;
  it.each(nonAvailabilityKinds)("does not treat %s as an availability error", (kind) => {
    expect(isAvailabilityError(new AIError(kind, "x"))).toBe(false);
  });

  it("returns false for a non-AIError", () => {
    expect(isAvailabilityError(new Error("plain"))).toBe(false);
  });
});
