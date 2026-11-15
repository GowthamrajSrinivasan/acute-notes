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
  /**
   * Does `AIRequest.maxTokens` reach the model, so it stops at the cap? `"passed"`: handed to the model API (not
   * independently verified against every endpoint); `"ignored"`: dropped. Absent = unknown, treated as ignored by
   * callers that need a cap (the AI consistency check, §12.25).
   */
  outputCap?: "passed" | "ignored";
  /**
   * Can a request ask for exactly ONE physical model request (`AIRequest.singleAttempt`), with no hidden retry, model
   * switch or fallback behind it (§12.29)? `"single"`: enforced at the provider-request boundary and the count reported in
   * `AIResponse.providerRequests`. Absent = the provider may retry internally; callers that need one request (the AI
   * consistency check) send nothing.
   */
  providerAttempts?: "single";
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
  /**
   * Reasoning effort for models that support it (§12.25: the AI consistency check asks for "low", the setting its
   * reasoning reserve was sized for). Only sent when set; no other task sets it.
   */
  reasoningEffort?: "low" | "medium" | "high";
  /**
   * At most one physical model request for this call: a failed request is not retried by any layer below (§12.29; the
   * Copilot runtime otherwise retries 429/5xx up to 5 times). Only honoured by providers declaring
   * `capabilities.providerAttempts: "single"`; only the AI consistency check sets it.
   */
  singleAttempt?: boolean;
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
  /** Physical model requests that left for the provider for this call, when the provider counts them (`singleAttempt`). */
  providerRequests?: number;
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
