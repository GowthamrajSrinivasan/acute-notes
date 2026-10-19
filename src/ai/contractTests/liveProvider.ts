/**
 * Shared by the live contract tests: turns any registered connection id (copilot, ollama or a BYOK id with real
 * credentials in `.env.local`) into an `AIProvider` over `CopilotHostRuntime`, so a test can run against whichever
 * provider the user picks.
 */
import { createCopilotHostRuntime } from "@/ai/host/copilot/CopilotHostRuntime";
import type { HostAuth, HostByokProvider } from "@/ai/host/hostRuntime";
import type { AIProvider, AIRequest } from "@/ai/types";
import { getByokCredentials, type ByokConnectionId } from "./testEnv";

export const BYOK_TYPE: Record<ByokConnectionId, HostByokProvider["type"]> = {
  openai: "openai",
  anthropic: "anthropic",
  azure: "azure",
  gemini: "openai", // Gemini is not documented by the Copilot SDK itself — routed as a plain OpenAI-compatible endpoint (verified against ai.google.dev, F36).
  openrouter: "openai", // A model router, not a vendor SDK — also a plain OpenAI-compatible endpoint, like Gemini/Ollama.
  aicredits: "openai", // Same shape: a model router over OpenAI-compatible chat/completions (verified against aicredits.in/docs).
  neevcloud: "openai", // OpenAI-compatible inference over the user's own deployed models (verified against docs.ai.neevcloud.com).
};

/** Mirrors registry.ts's own descriptor defaults — Azure has none (always the user's own resource). */
export const DEFAULT_ENDPOINT: Record<ByokConnectionId, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  azure: "",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  openrouter: "https://openrouter.ai/api/v1",
  aicredits: "https://api.aicredits.in/v1",
  neevcloud: "https://inference.ai.neevcloud.com/v1",
};

export interface TestConnection {
  auth: HostAuth;
  provider?: HostByokProvider;
  /** Sent on every request, exactly like `copilotProvider.ts`'s `defaultModel` — BYOK requires one (the SDK otherwise falls back to its own default model name, which a BYOK endpoint won't recognize). */
  model?: string;
}

export function resolveConnection(id: string): TestConnection | null {
  if (id === "copilot") return { auth: { kind: "logged_in_user" } };
  if (id === "ollama") return { auth: { kind: "logged_in_user" }, provider: { type: "openai", baseUrl: "http://localhost:11434/v1" }, model: "llama3.2" };
  const creds = getByokCredentials(id as ByokConnectionId);
  if (!creds) return null;
  return {
    auth: { kind: "logged_in_user" },
    provider: { type: BYOK_TYPE[id as ByokConnectionId], baseUrl: creds.endpoint ?? DEFAULT_ENDPOINT[id as ByokConnectionId], apiKey: creds.apiKey },
    model: creds.model,
  };
}

/** Wraps `CopilotHostRuntime` as an `AIProvider` — the same shape `copilotProvider.ts` presents, minus the browser-only HTTP hop. */
export function directProvider(id: string, connection: TestConnection): AIProvider {
  const hostRuntime = createCopilotHostRuntime();
  return {
    id,
    name: id,
    authTypes: ["subscription", "api_key", "local"],
    transport: "ai_host_local",
    capabilities: { streaming: true, structuredOutput: "json_mode", toolCalling: false, vision: true, embeddings: false, modelSelection: true },
    async isConfigured() {
      return true;
    },
    async testConnection() {
      try {
        await hostRuntime.listModels(connection.auth);
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    },
    generate: (request: AIRequest) =>
      hostRuntime.generate({ request: { ...request, model: request.model ?? connection.model }, auth: connection.auth, provider: connection.provider }),
    stream: (request: AIRequest) =>
      hostRuntime.stream({ request: { ...request, model: request.model ?? connection.model }, auth: connection.auth, provider: connection.provider }),
    async getModels() {
      return hostRuntime.listModels(connection.auth);
    },
    async getUsage() {
      return null;
    },
  };
}

