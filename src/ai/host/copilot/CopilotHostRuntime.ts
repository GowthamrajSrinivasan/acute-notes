/**
 * The `HostRuntime` for GitHub Copilot (F35). Every call builds a fresh,
 * unconditionally hardened `CopilotClient`/session (`hardening.ts`), sends
 * one message, captures usage/errors from session events (the SDK exposes
 * neither a `getUsage()` query nor typed error classes — verified against
 * @github/copilot-sdk@1.0.14, see `errorMapping.ts`), and always disconnects
 * — success, failure, or cancellation.
 */
import { AIError } from "@/ai/errors";
import type { AIModel, AIResponse, AIStreamChunk, AIUsage } from "@/ai/types";
import type { CopilotClientOptions, SessionConfig } from "@github/copilot-sdk";
import { createRealCopilotClient, type CopilotClientLike, type CopilotSessionEventLike, type CopilotSessionLike } from "./copilotClient";
import { mapSessionErrorEvent, mapTransportError, type CopilotErrorEventData } from "./errorMapping";
import { buildHardening } from "./hardening";
import type { HostAuth, HostByokProvider, HostGenerateInput, HostRuntime } from "../hostRuntime";

export interface CopilotHostRuntimeDeps {
  createClient: (options: CopilotClientOptions) => CopilotClientLike;
}

const DEFAULT_DEPS: CopilotHostRuntimeDeps = { createClient: createRealCopilotClient };

export function createCopilotHostRuntime(deps: CopilotHostRuntimeDeps = DEFAULT_DEPS): HostRuntime {
  /**
   * A BYOK `provider` bypasses Copilot API authentication entirely (SDK
   * docs), so `auth` is ignored whenever one is set — never fall back to the
   * host's own GitHub login just because a BYOK request happened to omit it.
   */
  function buildClientOptions(auth: HostAuth, provider: HostByokProvider | undefined): CopilotClientOptions {
    const { clientOptions } = buildHardening();
    if (provider) return { ...clientOptions, useLoggedInUser: false };
    return {
      ...clientOptions,
      ...(auth.kind === "token" ? { gitHubToken: auth.gitHubToken, useLoggedInUser: false } : { useLoggedInUser: true }),
    };
  }

  function buildSessionConfig(
    model: string | undefined,
    provider: HostByokProvider | undefined,
    systemPrompt: string | undefined,
    streaming: boolean,
  ): SessionConfig {
    const { sessionConfig } = buildHardening();
    return {
      ...sessionConfig,
      model,
      // The SDK only emits `assistant.message_delta` when asked to (default false).
      ...(streaming ? { streaming: true } : {}),
      provider: provider && { type: provider.type, baseUrl: provider.baseUrl, apiKey: provider.apiKey, wireApi: provider.wireApi },
      systemMessage: systemPrompt ? { mode: "append", content: systemPrompt } : undefined,
    };
  }

  async function withSession<T>(
    input: HostGenerateInput,
    run: (session: CopilotSessionLike) => Promise<T>,
    streaming = false,
  ): Promise<T> {
    const client = deps.createClient(buildClientOptions(input.auth, input.provider));
    await client.start();
    try {
      const session = await client.createSession(buildSessionConfig(input.request.model, input.provider, input.request.systemPrompt, streaming));
      try {
        return await run(session);
      } finally {
        await session.disconnect().catch(() => undefined);
      }
    } finally {
      await client.stop().catch(() => undefined);
    }
  }

  return {
    id: "copilot",

    async generate(input: HostGenerateInput): Promise<AIResponse> {
      return withSession(input, async (session) => {
        let usage: AIUsage = { provider: "copilot", model: input.request.model ?? "unknown" };
        let capturedError: CopilotErrorEventData | undefined;
        const unsubUsage = session.on("assistant.usage", (event) => {
          usage = toAIUsage(event);
        });
        const unsubError = session.on("session.error", (event) => {
          capturedError = event.data as CopilotErrorEventData;
        });

        try {
          const assistantEvent = await raceWithSignal(
            session.sendAndWait({ prompt: input.request.prompt }, input.request.timeoutMs),
            session,
            input.request.signal,
          );

          // A successful final message always wins over an earlier, possibly
          // transient/recovered-from error event (e.g. an auto-mode-switch
          // after a rate limit). Only consult the captured error to explain
          // why no message came back.
          if (!assistantEvent) {
            if (capturedError) mapSessionErrorEvent(capturedError);
            throw new AIError("model_unavailable", "The Copilot session produced no response.");
          }

          return {
            text: assistantEvent.data.content,
            model: assistantEvent.data.model ?? usage.model,
            finishReason: mapFinishReason(assistantEvent.data.content),
            usage,
          };
        } catch (err) {
          if (err instanceof AIError) throw err;
          mapTransportError(err);
        } finally {
          unsubUsage();
          unsubError();
        }
      });
    },

    async *stream(input: HostGenerateInput): AsyncIterable<AIStreamChunk> {
      const queue = createEventQueue<AIStreamChunk>();
      let capturedError: CopilotErrorEventData | undefined;
      let streamedAny = false;

      void withSession(
        input,
        async (session) => {
          const unsubDelta = session.on("assistant.message_delta", (event) => {
            const data = event.data as { deltaContent?: string };
            if (data.deltaContent) {
              streamedAny = true;
              queue.push({ delta: data.deltaContent, done: false });
            }
          });
          const unsubError = session.on("session.error", (event) => {
            capturedError = event.data as CopilotErrorEventData;
          });
  
          try {
            const assistantEvent = await raceWithSignal(
              session.sendAndWait({ prompt: input.request.prompt }, input.request.timeoutMs),
              session,
              input.request.signal,
            );
            if (!assistantEvent) {
              if (capturedError) mapSessionErrorEvent(capturedError);
              throw new AIError("model_unavailable", "The Copilot session produced no response.");
            }
            // No deltas (e.g. a model/transport that doesn't stream): the final message is the whole reply.
            if (!streamedAny && assistantEvent.data.content) queue.push({ delta: assistantEvent.data.content, done: false });
            queue.push({ delta: "", done: true });
            queue.end();
          } catch (err) {
            queue.fail(err instanceof AIError ? err : safeMapTransportError(err));
          } finally {
            unsubDelta();
            unsubError();
          }
        },
        true,
      ).catch((err) => queue.fail(err));

      yield* queue;
    },

    async listModels(auth: HostAuth): Promise<AIModel[]> {
      const client = deps.createClient(buildClientOptions(auth, undefined));
      await client.start();
      try {
        const models = await client.listModels();
        return models.map((model) => ({ id: model.id, name: model.name }));
      } finally {
        await client.stop().catch(() => undefined);
      }
    },
  };
}

function toAIUsage(event: CopilotSessionEventLike): AIUsage {
  const data = event.data as {
    model: string;
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    copilotUsage?: { totalNanoAiu: number };
  };
  return {
    provider: "copilot",
    model: data.model,
    promptTokens: data.inputTokens,
    completionTokens: data.outputTokens,
    ...(data.reasoningTokens !== undefined ? { reasoningTokens: data.reasoningTokens } : {}),
    subscriptionUsage: data.copilotUsage ? { unit: "nanoAiu", amount: data.copilotUsage.totalNanoAiu } : undefined,
  };
}

/** Blocked/refused output is reported as an error, not a silent "stop". Everything else maps to "stop" — tool calls never happen (availableTools: []) and truncation shows up via the model's own content, not a distinguishable signal here. */
function mapFinishReason(content: string): AIResponse["finishReason"] {
  return content.length > 0 ? "stop" : "error";
}

function safeMapTransportError(err: unknown): AIError {
  try {
    mapTransportError(err);
  } catch (mapped) {
    if (mapped instanceof AIError) return mapped;
  }
  return err instanceof AIError ? err : new AIError("network", err instanceof Error ? err.message : String(err), { cause: err });
}

async function raceWithSignal<T>(promise: Promise<T>, session: CopilotSessionLike, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    await session.abort().catch(() => undefined);
    throw new AIError("cancelled", "The AI request was cancelled.");
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      session
        .abort()
        .catch(() => undefined)
        .finally(() => reject(new AIError("cancelled", "The AI request was cancelled.")));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

interface EventQueue<T> extends AsyncIterable<T> {
  push(value: T): void;
  end(): void;
  fail(err: unknown): void;
}

function createEventQueue<T>(): EventQueue<T> {
  const buffer: T[] = [];
  const waiters: ((result: IteratorResult<T>) => void)[] = [];
  const failers: ((err: unknown) => void)[] = [];
  let done = false;
  let failure: unknown;

  return {
    push(value) {
      const waiter = waiters.shift();
      failers.shift();
      if (waiter) waiter({ value, done: false });
      else buffer.push(value);
    },
    end() {
      done = true;
      while (waiters.length) {
        waiters.shift()?.({ value: undefined as never, done: true });
        failers.shift();
      }
    },
    fail(err) {
      failure = err;
      done = true;
      while (failers.length) {
        const fail = failers.shift();
        waiters.shift();
        fail?.(err);
      }
    },
    [Symbol.asyncIterator]() {
      return {
        next(): Promise<IteratorResult<T>> {
          if (buffer.length) return Promise.resolve({ value: buffer.shift() as T, done: false });
          if (done) return failure ? Promise.reject(failure) : Promise.resolve({ value: undefined as never, done: true });
          return new Promise((resolve, reject) => {
            waiters.push(resolve);
            failers.push(reject);
          });
        },
      };
    },
  };
}
