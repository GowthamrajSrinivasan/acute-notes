/**
 * The `AIProvider` adapter for GitHub Copilot (F35). The Copilot SDK only
 * runs in Node (verified against @github/copilot-sdk@1.0.14 — it spawns a
 * CLI process), so this adapter never touches it directly: it's a thin HTTP
 * client to the AI host route handlers under `src/app/api/ai/`, which are
 * the only other place allowed to know about `CopilotHostRuntime`.
 */
import { AIError, isAIErrorKind } from "@/ai/errors";
import type { HostByokProvider } from "@/ai/host/hostRuntime";
import type { AICapabilities, AIModel, AIProvider, AIRequest, AIResponse, AIStreamChunk, ConnectionTestResult } from "@/ai/types";

export interface CopilotProviderConfig {
  id?: string;
  name?: string;
  /** The signed-in user's own GitHub token — never the host's ambient/env token. */
  gitHubToken?: string;
  /** BYOK connection (openai/azure/anthropic, or an OpenAI-compatible local endpoint). Bypasses `gitHubToken`. */
  byok?: HostByokProvider;
  /** Local-dev-only: let the AI host fall back to its own logged-in Copilot CLI user when no token/BYOK is given. Rejected outright in server deployments regardless of this flag. */
  allowHostLoggedInUser?: boolean;
  /** This connection's chosen model (required for BYOK per the SDK). Overridden per request by `AIRequest.model` when a task sets one. */
  defaultModel?: string;
  /** AI host origin; same-origin ("") by default. */
  baseUrl?: string;
}

const CAPABILITIES: AICapabilities = {
  streaming: true,
  // Verified: the SDK has no native JSON-schema-constrained response output.
  // AIRuntime's validate-then-repair-retry (src/ai/runtime.ts) is what
  // actually enforces schema correctness for this provider.
  structuredOutput: "json_mode",
  toolCalling: false,
  vision: true,
  embeddings: false,
  modelSelection: true,
};

export function createCopilotProvider(config: CopilotProviderConfig = {}): AIProvider {
  const baseUrl = config.baseUrl ?? "";

  function authHeaders(): Record<string, string> {
    return config.gitHubToken ? { authorization: `Bearer ${config.gitHubToken}` } : {};
  }

  async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new AIError("cancelled", "The AI request was cancelled.");
      }
      throw new AIError("network", err instanceof Error ? err.message : "The AI host request failed.", { cause: err });
    }
    if (!res.ok) throw await toAIError(res);
    return res.json() as Promise<T>;
  }

  function toWireRequest(request: AIRequest) {
    return {
      request: {
        task: request.task,
        prompt: request.prompt,
        systemPrompt: request.systemPrompt,
        model: request.model ?? config.defaultModel,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        timeoutMs: request.timeoutMs,
      },
      provider: config.byok,
    };
  }

  return {
    id: config.id ?? "copilot",
    name: config.name ?? "GitHub Copilot",
    authTypes: ["subscription", "api_key", "local"],
    transport: "ai_host_local",
    capabilities: CAPABILITIES,

    async isConfigured() {
      return Boolean(config.gitHubToken || config.byok || config.allowHostLoggedInUser);
    },

    async testConnection(): Promise<ConnectionTestResult> {
      try {
        // Model listing is Copilot-account-scoped (it never sees a BYOK
        // provider), so for a BYOK connection it would test the wrong
        // credentials entirely. Make one minimal real request instead.
        if (config.byok) {
          await postJson<AIResponse>("/api/ai/run", toWireRequest({ task: "chat", prompt: "Reply with OK." }), AbortSignal.timeout(20_000));
        } else {
          await this.getModels?.();
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : "Connection test failed." };
      }
    },

    async generate(request: AIRequest): Promise<AIResponse> {
      return postJson<AIResponse>("/api/ai/run", toWireRequest(request), request.signal);
    },

    async *stream(request: AIRequest): AsyncIterable<AIStreamChunk> {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/ai/stream`, {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(toWireRequest(request)),
          signal: request.signal,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          throw new AIError("cancelled", "The AI request was cancelled.");
        }
        throw new AIError("network", err instanceof Error ? err.message : "The AI host stream failed.", { cause: err });
      }
      if (!res.ok) throw await toAIError(res);
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex = buffer.indexOf("\n");
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            if (line.trim()) yield parseStreamLine(line);
            newlineIndex = buffer.indexOf("\n");
          }
        }
      } finally {
        reader.releaseLock();
      }
    },

    async getModels(): Promise<AIModel[]> {
      const res = await fetch(`${baseUrl}/api/ai/models`, { headers: authHeaders() });
      if (!res.ok) throw await toAIError(res);
      return res.json() as Promise<AIModel[]>;
    },

    async getUsage() {
      // No cumulative-usage query exists (verified against @github/copilot-sdk@1.0.14) —
      // per-call usage instead comes back on AIResponse.usage.
      return null;
    },
  };
}

/** The stream route (`src/app/api/ai/stream/route.ts`) embeds a failure as one extra `kind`/`message`-bearing line, since HTTP headers are already sent by the time a mid-stream error can occur. */
function parseStreamLine(line: string): AIStreamChunk {
  const parsed = JSON.parse(line) as AIStreamChunk & { kind?: string; message?: string };
  if (parsed.kind) {
    throw new AIError(isAIErrorKind(parsed.kind) ? parsed.kind : "network", parsed.message ?? "AI stream failed.");
  }
  return { delta: parsed.delta, done: parsed.done };
}

async function toAIError(res: Response): Promise<AIError> {
  const body = (await res.json().catch(() => ({}))) as { kind?: string; message?: string };
  const kind = isAIErrorKind(body.kind) ? body.kind : res.status === 401 ? "auth" : "network";
  return new AIError(kind, body.message ?? `AI host request failed (${res.status}).`);
}
