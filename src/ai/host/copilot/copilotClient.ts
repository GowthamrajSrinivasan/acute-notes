/**
 * Thin wrapper around `@github/copilot-sdk`'s `CopilotClient`/`CopilotSession`,
 * narrowed to exactly what `CopilotHostRuntime` needs. `CopilotHostRuntime`
 * depends on `CopilotClientLike`, not the SDK directly, so tests can inject a
 * fake — this sandbox has no GitHub Copilot subscription and can't spawn the
 * real CLI runtime.
 */
import { CopilotClient } from "@github/copilot-sdk";
import type { AssistantMessageEvent, CopilotClientOptions, CopilotSession, ModelInfo, SessionConfig } from "@github/copilot-sdk";

export interface CopilotSessionEventLike {
  type: string;
  data?: unknown;
}

export interface CopilotSessionLike {
  sendAndWait(options: { prompt: string }, timeoutMs?: number): Promise<AssistantMessageEvent | undefined>;
  send(options: { prompt: string }): Promise<string>;
  on(eventType: string, handler: (event: CopilotSessionEventLike) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface CopilotClientLike {
  start(): Promise<void>;
  stop(): Promise<Error[]>;
  createSession(config: SessionConfig): Promise<CopilotSessionLike>;
  listModels(): Promise<ModelInfo[]>;
}

export function createRealCopilotClient(options: CopilotClientOptions): CopilotClientLike {
  const client = new CopilotClient(options);
  return {
    start: () => client.start(),
    stop: () => client.stop(),
    listModels: () => client.listModels(),
    async createSession(config) {
      const session = await client.createSession(config);
      return toSessionLike(session);
    },
  };
}

function toSessionLike(session: CopilotSession): CopilotSessionLike {
  return {
    sendAndWait: (options, timeoutMs) => session.sendAndWait(options, timeoutMs),
    send: (options) => session.send(options),
    // The SDK's `on` overloads are keyed by event-type literal; a plain string
    // parameter is the documented, supported call shape (README "Subscribe to
    // all session events" vs. the typed per-event overload) — narrowed here
    // once, at the one boundary allowed to know about it.
    on: (eventType, handler) => session.on(eventType as never, handler as never),
    abort: () => session.abort(),
    disconnect: () => session.disconnect(),
  };
}
