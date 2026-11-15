import { afterEach, describe, expect, it, vi } from "vitest";
import { AIError } from "./errors";
import { oneRequestUsageOf, sendOneRequest, setOneRequestPolicy } from "./requestPolicy";
import type { AIRequest, AIResponse } from "./types";

setOneRequestPolicy("test_one_request", { maxTokens: 321 });

const ok: AIResponse = { text: "x", model: "m", finishReason: "stop", usage: { provider: "p", model: "m", promptTokens: 10, completionTokens: 5 }, providerRequests: 1 };
const conn = { id: "c", capped: true };

afterEach(() => vi.restoreAllMocks());

describe("sendOneRequest", () => {
  it("leaves other tasks' requests unchanged", async () => {
    const send = vi.fn(async (_r: AIRequest) => ok);
    await sendOneRequest({ task: "chat", prompt: "p" }, conn, send);
    await sendOneRequest({ task: "chat", prompt: "p" }, conn, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0]).toEqual({ task: "chat", prompt: "p" });
  });

  it("sends a policy task's request once per run, with the cap and singleAttempt, and keeps its usage", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const send = vi.fn(async (_r: AIRequest) => ok);
    const signal = new AbortController().signal;
    await sendOneRequest({ task: "test_one_request", prompt: "p", signal }, conn, send);
    expect(send.mock.calls[0]![0]).toMatchObject({ maxTokens: 321, singleAttempt: true });
    expect(oneRequestUsageOf(signal)).toEqual({ usage: ok.usage, providerRequests: 1 });

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(sendOneRequest({ task: "test_one_request", prompt: "p", signal }, conn, send)).rejects.toBeInstanceOf(AIError);
    expect(send).toHaveBeenCalledOnce();
  });

  it("a second request of a failed run rethrows the first error without sending", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = new AIError("network", "down");
    const send = vi.fn(async (): Promise<AIResponse> => {
      throw first;
    });
    const signal = new AbortController().signal;
    await expect(sendOneRequest({ task: "test_one_request", prompt: "p", signal }, conn, send)).rejects.toBe(first);
    await expect(sendOneRequest({ task: "test_one_request", prompt: "p", signal }, { id: "fallback", capped: true }, send)).rejects.toBe(first);
    expect(send).toHaveBeenCalledOnce();
  });

  it("refuses a policy task's request without a signal, sending nothing", async () => {
    const send = vi.fn(async () => ok);
    await expect(sendOneRequest({ task: "test_one_request", prompt: "p" }, conn, send)).rejects.toMatchObject({ kind: "invalid_output" });
    expect(send).not.toHaveBeenCalled();
  });

  it("warns before sending on a connection that can't enforce the cap", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await sendOneRequest({ task: "test_one_request", prompt: "p", signal: new AbortController().signal }, { id: "copilot", capped: false }, vi.fn(async () => ok));
    expect(warn.mock.calls[0]![0]).toContain("does not enforce the 321-token output cap");
  });
});
