import { describe, expect, it } from "vitest";
import { AIError } from "@/ai/errors";
import { mapSessionErrorEvent, mapTransportError } from "./errorMapping";

describe("mapSessionErrorEvent", () => {
  it.each([
    ["authentication", "auth"],
    ["authorization", "auth"],
    ["quota", "quota_exhausted"],
    ["rate_limit", "rate_limited"],
    ["context_limit", "model_unavailable"],
  ] as const)("maps errorType %s to %s", (errorType, kind) => {
    expect(() => mapSessionErrorEvent({ errorType, message: "boom" })).toThrow(AIError);
    try {
      mapSessionErrorEvent({ errorType, message: "boom" });
    } catch (err) {
      expect(err).toBeInstanceOf(AIError);
      expect((err as AIError).kind).toBe(kind);
    }
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [408, "timeout"],
    [504, "timeout"],
    [500, "network"],
    [503, "network"],
  ] as const)("falls back to statusCode %s -> %s when errorType is unrecognized", (statusCode, kind) => {
    try {
      mapSessionErrorEvent({ errorType: "query", statusCode, message: "boom" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AIError);
      expect((err as AIError).kind).toBe(kind);
    }
  });

  it("propagates a plain Error (not AIError) for a wholly unrecognized error", () => {
    try {
      mapSessionErrorEvent({ errorType: "query", message: "malformed request" });
      expect.unreachable();
    } catch (err) {
      expect(err).not.toBeInstanceOf(AIError);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("malformed request");
    }
  });
});

describe("mapTransportError", () => {
  it.each([
    ["connect ECONNREFUSED 127.0.0.1:443", "network"],
    ["request to https://api.example.com timed out", "timeout"],
    ["401 Unauthorized", "auth"],
    ["429 rate limit exceeded", "rate_limited"],
  ] as const)("classifies %s as %s", (message, kind) => {
    try {
      mapTransportError(new Error(message));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AIError);
      expect((err as AIError).kind).toBe(kind);
    }
  });

  it("rethrows the original error unchanged when the message is unrecognized", () => {
    const original = new Error("the CLI process exited with code 17");
    try {
      mapTransportError(original);
      expect.unreachable();
    } catch (err) {
      expect(err).toBe(original);
    }
  });
});
