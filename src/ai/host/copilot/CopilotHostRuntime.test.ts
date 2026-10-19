import { describe, expect, it } from "vitest";
import type { AIRequest } from "@/ai/types";
import type { CopilotClientOptions, SessionConfig } from "@github/copilot-sdk";
import type { CopilotClientLike, CopilotSessionEventLike, CopilotSessionLike } from "./copilotClient";
import { createCopilotHostRuntime } from "./CopilotHostRuntime";

type ScriptedEvent = { type: string; data?: unknown };

interface SessionBehavior {
  events?: ScriptedEvent[];
  result?: { data: { content: string; model?: string } };
  error?: unknown;
  /** Delays sendAndWait's resolution until this resolves — lets tests abort mid-flight. */
  hang?: boolean;
}

function createFakeSession(behavior: SessionBehavior) {
  const listeners = new Map<string, ((event: CopilotSessionEventLike) => void)[]>();
  const calls = { abort: 0, disconnect: 0, sendAndWait: 0 };

  function emit(type: string, data?: unknown) {
    for (const handler of listeners.get(type) ?? []) handler({ type, data });
  }

  const session: CopilotSessionLike = {
    on(eventType, handler) {
      const arr = listeners.get(eventType) ?? [];
      arr.push(handler);
      listeners.set(eventType, arr);
      return () => {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      };
    },
    async sendAndWait() {
      calls.sendAndWait += 1;
      if (behavior.hang) await new Promise(() => undefined);
      for (const e of behavior.events ?? []) emit(e.type, e.data);
      if (behavior.error) throw behavior.error;
      return behavior.result as never;
    },
    async send() {
      return "msg-1";
    },
    async abort() {
      calls.abort += 1;
    },
    async disconnect() {
      calls.disconnect += 1;
    },
  };

  return { session, calls };
}

function createFakeClient(session: CopilotSessionLike, models: { id: string; name: string }[] = []) {
  const clientOptionsCalls: CopilotClientOptions[] = [];
  const sessionConfigCalls: SessionConfig[] = [];
  const clientCalls = { start: 0, stop: 0 };

  const createClient = (options: CopilotClientOptions): CopilotClientLike => {
    clientOptionsCalls.push(options);
    return {
      async start() {
        clientCalls.start += 1;
      },
      async stop() {
        clientCalls.stop += 1;
        return [];
      },
      async listModels() {
        return models as never;
      },
      async createSession(config) {
        sessionConfigCalls.push(config);
        return session;
      },
    };
  };

  return { createClient, clientOptionsCalls, sessionConfigCalls, clientCalls };
}

function baseRequest(overrides: Partial<AIRequest> = {}): AIRequest {
  return { task: "chat", prompt: "hello", ...overrides };
}

describe("CopilotHostRuntime.generate", () => {
  it("returns the assistant message with usage captured from the assistant.usage event", async () => {
    const { session } = createFakeSession({
      events: [{ type: "assistant.usage", data: { model: "gpt-5", inputTokens: 10, outputTokens: 20 } }],
      result: { data: { content: "hi there", model: "gpt-5" } },
    });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    const response = await runtime.generate({ request: baseRequest(), auth: { kind: "token", gitHubToken: "gho_secret" } });

    expect(response).toMatchObject({
      text: "hi there",
      model: "gpt-5",
      finishReason: "stop",
      usage: { provider: "copilot", model: "gpt-5", promptTokens: 10, completionTokens: 20 },
    });
  });

  it("captures Copilot subscription usage (copilotUsage) into AIUsage.subscriptionUsage", async () => {
    const { session } = createFakeSession({
      events: [{ type: "assistant.usage", data: { model: "gpt-5", copilotUsage: { totalNanoAiu: 42 } } }],
      result: { data: { content: "ok" } },
    });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    const response = await runtime.generate({ request: baseRequest(), auth: { kind: "logged_in_user" } });
    expect(response.usage.subscriptionUsage).toEqual({ unit: "nanoAiu", amount: 42 });
  });

  it("always creates the session with the hardened config — zero tools, deny-all permissions", async () => {
    const { session } = createFakeSession({ result: { data: { content: "ok" } } });
    const { createClient, sessionConfigCalls, clientOptionsCalls } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    await runtime.generate({ request: baseRequest(), auth: { kind: "token", gitHubToken: "gho_secret" } });

    expect(sessionConfigCalls[0]?.availableTools).toEqual([]);
    expect(sessionConfigCalls[0]?.onPermissionRequest).toBeTypeOf("function");
    expect(clientOptionsCalls[0]?.mode).toBe("empty");
  });

  it("passes the caller's own token, never useLoggedInUser, for a token auth", async () => {
    const { session } = createFakeSession({ result: { data: { content: "ok" } } });
    const { createClient, clientOptionsCalls } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    await runtime.generate({ request: baseRequest(), auth: { kind: "token", gitHubToken: "gho_secret" } });

    expect(clientOptionsCalls[0]).toMatchObject({ gitHubToken: "gho_secret", useLoggedInUser: false });
  });

  it("ignores auth entirely when a BYOK provider is set — never falls back to the host's own login", async () => {
    const { session } = createFakeSession({ result: { data: { content: "ok" } } });
    const { createClient, clientOptionsCalls } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    await runtime.generate({
      request: baseRequest({ model: "gpt-4" }),
      auth: { kind: "token", gitHubToken: "gho_secret" },
      provider: { type: "openai", baseUrl: "https://my-api.example.com/v1", apiKey: "byok-secret" },
    });

    expect(clientOptionsCalls[0]?.gitHubToken).toBeUndefined();
    expect(clientOptionsCalls[0]?.useLoggedInUser).toBe(false);
  });

  it("maps a session.error event to the matching AIError when no message is produced", async () => {
    const { session } = createFakeSession({
      events: [{ type: "session.error", data: { errorType: "rate_limit", message: "slow down" } }],
      result: undefined,
    });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    await expect(runtime.generate({ request: baseRequest(), auth: { kind: "logged_in_user" } })).rejects.toMatchObject({
      kind: "rate_limited",
    });
  });

  it("a successful final message wins over an earlier transient session.error event", async () => {
    const { session } = createFakeSession({
      events: [{ type: "session.error", data: { errorType: "rate_limit", message: "retrying" } }],
      result: { data: { content: "recovered", model: "gpt-5" } },
    });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    const response = await runtime.generate({ request: baseRequest(), auth: { kind: "logged_in_user" } });
    expect(response.text).toBe("recovered");
  });

  it("maps a transport-level rejection via mapTransportError", async () => {
    const { session } = createFakeSession({ error: new Error("connect ECONNREFUSED 127.0.0.1:443") });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    await expect(runtime.generate({ request: baseRequest(), auth: { kind: "logged_in_user" } })).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("rejects with cancelled and calls session.abort() when the signal is already aborted", async () => {
    const { session, calls } = createFakeSession({ result: { data: { content: "ok" } } });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    const controller = new AbortController();
    controller.abort();

    await expect(
      runtime.generate({ request: baseRequest({ signal: controller.signal }), auth: { kind: "logged_in_user" } }),
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(calls.abort).toBe(1);
  });

  it("rejects with cancelled and calls session.abort() when the signal fires mid-flight", async () => {
    const { session, calls } = createFakeSession({ hang: true, result: { data: { content: "ok" } } });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    const controller = new AbortController();
    const promise = runtime.generate({ request: baseRequest({ signal: controller.signal }), auth: { kind: "logged_in_user" } });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ kind: "cancelled" });
    expect(calls.abort).toBe(1);
  });

  it("always disconnects the session and stops the client, even on failure", async () => {
    const { session, calls: sessionCalls } = createFakeSession({ error: new Error("boom") });
    const { createClient, clientCalls } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    await expect(runtime.generate({ request: baseRequest(), auth: { kind: "logged_in_user" } })).rejects.toThrow();
    expect(sessionCalls.disconnect).toBe(1);
    expect(clientCalls.stop).toBe(1);
  });

  it("never lets a GitHub token leak into a thrown error's message", async () => {
    const { session } = createFakeSession({ error: new Error("some unrelated failure") });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    const secret = "gho_ExtremelySecretToken123";
    try {
      await runtime.generate({ request: baseRequest(), auth: { kind: "token", gitHubToken: secret } });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain(secret);
    }
  });
});

describe("CopilotHostRuntime.stream", () => {
  it("yields deltas as they arrive and a final done chunk", async () => {
    const { session } = createFakeSession({
      events: [
        { type: "assistant.message_delta", data: { deltaContent: "Hel" } },
        { type: "assistant.message_delta", data: { deltaContent: "lo" } },
      ],
      result: { data: { content: "Hello" } },
    });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    const chunks = [];
    for await (const chunk of runtime.stream({ request: baseRequest(), auth: { kind: "logged_in_user" } })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { delta: "Hel", done: false },
      { delta: "lo", done: false },
      { delta: "", done: true },
    ]);
  });

  it("propagates a mapped error through the async iterable", async () => {
    const { session } = createFakeSession({
      events: [{ type: "session.error", data: { errorType: "authentication", message: "nope" } }],
      result: undefined,
    });
    const { createClient } = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient });

    async function drain() {
      const chunks = [];
      for await (const chunk of runtime.stream({ request: baseRequest(), auth: { kind: "logged_in_user" } })) chunks.push(chunk);
      return chunks;
    }

    await expect(drain()).rejects.toMatchObject({ kind: "auth" });
  });
});

describe("CopilotHostRuntime.stream — session setup", () => {
  async function drain(runtime: ReturnType<typeof createCopilotHostRuntime>) {
    const chunks = [];
    for await (const chunk of runtime.stream({ request: baseRequest(), auth: { kind: "logged_in_user" } })) chunks.push(chunk);
    return chunks;
  }

  it("creates the session with streaming enabled (the SDK emits no deltas otherwise); generate does not", async () => {
    const { session } = createFakeSession({ result: { data: { content: "Hi" } } });
    const fake = createFakeClient(session);
    const runtime = createCopilotHostRuntime({ createClient: fake.createClient });

    await drain(runtime);
    await runtime.generate({ request: baseRequest(), auth: { kind: "logged_in_user" } });
    expect(fake.sessionConfigCalls.map((c) => c.streaming)).toEqual([true, undefined]);
  });

  it("yields the final message as one chunk when no deltas arrived", async () => {
    const { session } = createFakeSession({ result: { data: { content: "Whole reply" } } });
    const runtime = createCopilotHostRuntime({ createClient: createFakeClient(session).createClient });
    expect(await drain(runtime)).toEqual([
      { delta: "Whole reply", done: false },
      { delta: "", done: true },
    ]);
  });

  it("fails with model_unavailable when the session produced no response at all", async () => {
    const { session } = createFakeSession({ result: undefined });
    const runtime = createCopilotHostRuntime({ createClient: createFakeClient(session).createClient });
    await expect(drain(runtime)).rejects.toMatchObject({ kind: "model_unavailable" });
  });
});

describe("CopilotHostRuntime.listModels", () => {
  it("maps the client's model list to AIModel", async () => {
    const { session } = createFakeSession({ result: { data: { content: "" } } });
    const { createClient } = createFakeClient(session, [{ id: "gpt-5", name: "GPT-5" }]);
    const runtime = createCopilotHostRuntime({ createClient });

    const models = await runtime.listModels({ kind: "logged_in_user" });
    expect(models).toEqual([{ id: "gpt-5", name: "GPT-5" }]);
  });
});
