/**
 * Update-intent classification (Stage 1a). Gate 5 — semantic integrity: EXTENDS and SUPERSEDES are told apart, and a
 * contradiction is never mistaken for either.
 */
import { describe, expect, it } from "vitest";
import { classifyClaimChange } from "./intent";

const intent = (before: string | null, after: string | null) => classifyClaimChange(before, after).intent;

describe("classifyClaimChange — gate 5: EXTENDS vs SUPERSEDES", () => {
  it.each([
    ["Retries happen five times.", "Retries happen five times with exponential backoff."],
    ["The gateway may time out.", "The gateway may time out under heavy load."],
    ["Deploys run on weekdays.", "Deploys run on weekdays, after the 10:00 freeze check."],
  ])("EXTENDS: %s → %s", (before, after) => expect(intent(before, after)).toBe("EXTENDS"));

  it.each([
    ["Retries happen five times.", "Retries happen three times."],
    ["The timeout is 30 seconds.", "The timeout is 45 seconds."],
    ["Retries happen five times.", "Retries happen three times with exponential backoff."],
    ["Payments team owns the gateway service.", "Platform team owns the gateway service."],
  ])("SUPERSEDES: %s → %s", (before, after) => expect(intent(before, after)).toBe("SUPERSEDES"));

  it("names the value that changed", () => {
    expect(classifyClaimChange("The timeout is 30 seconds.", "The timeout is 45 seconds.").detail).toBe("“30 seconds” is now “45 seconds”");
  });
});

describe("classifyClaimChange — the other intents", () => {
  it.each([
    ["The cache is shared across regions.", "The cache is not shared across regions."],
    ["The cache is not shared across regions.", "The cache is shared across regions."],
    ["Batching increases throughput.", "Batching reduces throughput."],
  ])("CONTRADICTS: %s → %s", (before, after) => expect(intent(before, after)).toBe("CONTRADICTS"));

  it("DUPLICATE: the same claim, only spacing or quotes differ", () => {
    expect(intent("The gateway may  time out.", "The gateway may time out.")).toBe("DUPLICATE");
  });

  it("NEW: nothing was said before", () => {
    expect(intent(null, "Deploys run on weekdays.")).toBe("NEW");
  });

  it("UNCLEAR: rewritten past recognition, or gone", () => {
    expect(intent("Retries happen five times.", "Ownership moved to the platform group last quarter.")).toBe("UNCLEAR");
    expect(intent("Retries happen five times.", "")).toBe("UNCLEAR");
  });
});
