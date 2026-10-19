/**
 * Deterministic `AIProvider` used by every downstream test and available as
 * a safe local default until a real provider is configured (PRD §13.15.7).
 * Responses are scripted by the caller — this adapter does no inference.
 */
import { AIError } from "@/ai/errors";
import type { AIAuthType, AICapabilities, AIProvider, AIRequest, AIResponse, AIStreamChunk, ConnectionTestResult } from "@/ai/types";

export interface MockProviderOptions {
  id?: string;
  name?: string;
  authTypes?: readonly AIAuthType[];
  capabilities?: Partial<AICapabilities>;
  /** Called for every `generate`; throw to simulate a provider failure. */
  respond: (request: AIRequest) => AIResponse | Promise<AIResponse>;
  /** Simulated latency before responding, so tests can exercise cancellation mid-flight. */
  delayMs?: number;
  /** Scripted stream chunks; when given, the provider exposes `stream` (and reports streaming support). */
  streamChunks?: (request: AIRequest) => string[];
}

const DEFAULT_CAPABILITIES: AICapabilities = {
  streaming: false,
  structuredOutput: "json_mode",
  toolCalling: false,
  vision: false,
  embeddings: false,
  modelSelection: false,
};

export function createMockProvider(options: MockProviderOptions): AIProvider {
  const capabilities: AICapabilities = {
    ...DEFAULT_CAPABILITIES,
    ...(options.streamChunks ? { streaming: true } : {}),
    ...options.capabilities,
  };
  const streamChunks = options.streamChunks;

  return {
    id: options.id ?? "mock",
    name: options.name ?? "Mock",
    authTypes: options.authTypes ?? ["local"],
    transport: "browser_direct",
    capabilities,

    async isConfigured() {
      return true;
    },

    async testConnection(): Promise<ConnectionTestResult> {
      return { ok: true };
    },

    async generate(request: AIRequest): Promise<AIResponse> {
      if (options.delayMs) await delay(options.delayMs, request.signal);
      if (request.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
      return options.respond(request);
    },

    ...(streamChunks
      ? {
          async *stream(request: AIRequest): AsyncIterable<AIStreamChunk> {
            for (const delta of streamChunks(request)) {
              if (options.delayMs) await delay(options.delayMs, request.signal);
              if (request.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
              yield { delta, done: false };
            }
            yield { delta: "", done: true };
          },
        }
      : {}),
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
