/**
 * Provider-neutral AI runtime types (F26, PRD §13.15.7-§13.15.8). Feature
 * code and `AIRuntime` see only these types — vendor SDK shapes are mapped
 * to them inside each adapter under `src/ai/providers/<id>/` (and, for
 * agent-style SDKs that must run in Node, `src/ai/host/<runtime>/`).
 */
export type AIAuthType = "subscription" | "api_key" | "oauth" | "local";

/** Where the adapter's SDK actually executes (PRD §13.15.13). */
export type AITransport = "browser_direct" | "ai_host_local" | "ai_host_server";

export interface AICapabilities {
  streaming: boolean;
  structuredOutput: "native" | "json_mode" | "none";
  toolCalling: boolean;
  vision: boolean;
  embeddings: boolean;
  modelSelection: boolean;
  maxContextTokens?: number;
}

export interface AIModel {
  id: string;
  name: string;
  capabilities?: Partial<AICapabilities>;
}

export interface ConnectionTestResult {
  ok: boolean;
  message?: string;
}

export interface AIUsage {
  provider: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Reasoning tokens, when the provider reports them separately (normally already counted in `completionTokens`). */
  reasoningTokens?: number;
  /** Plan-based usage (e.g. Copilot premium requests) — a generic unit so other plans fit without type changes. */
  subscriptionUsage?: { unit: string; amount: number };
}

export interface AIContext {
  /** Bounded, selection-first context (PRD §5.5) — never the whole workspace. */
  text: string;
  sourceIds?: string[];
}

export interface AIRequest {
  task: string;
  systemPrompt?: string;
  prompt: string;
  context?: AIContext;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Convenience for adapters with native structured output; the result is still validated by AIRuntime. */
  responseSchema?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AIStreamChunk {
  delta: string;
  done: boolean;
}

export interface AIResponse {
  text: string;
  /** UNVALIDATED — AIRuntime validates this against the task's output schema. */
  structured?: unknown;
  model: string;
  finishReason: "stop" | "length" | "cancelled" | "error";
  usage: AIUsage;
}

export interface AIProviderConfig {
  providerId: string;
  authType: AIAuthType;
  model?: string;
  /** Non-secret settings only (endpoint, BYOK type, ...). Secrets live in the credential store (F27). */
  metadata?: Record<string, unknown>;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  readonly authTypes: readonly AIAuthType[];
  readonly transport: AITransport;
  readonly capabilities: AICapabilities;

  isConfigured(): Promise<boolean>;
  testConnection(): Promise<ConnectionTestResult>;

  generate(request: AIRequest): Promise<AIResponse>;
  stream?(request: AIRequest): AsyncIterable<AIStreamChunk>;

  getModels?(): Promise<AIModel[]>;
  /** `null` when the provider does not expose usage. */
  getUsage?(): Promise<AIUsage | null>;
  disconnect?(): Promise<void>;
}
