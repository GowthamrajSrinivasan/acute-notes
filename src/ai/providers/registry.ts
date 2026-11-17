/**
 * The one file that lists real AI connections (PRD §13.15.12 point 2, §6.6).
 * The AI Connections settings UI (F27) renders entirely from this list — no
 * connection name is hard-coded in a component. Adding a future connection
 * — a direct Anthropic/OpenAI SDK, OpenRouter, a second local runtime, etc.
 * — is one more descriptor here (a new adapter folder + one entry, if it
 * isn't already covered by an existing adapter the way Copilot's BYOK
 * support covers OpenAI/Azure/Anthropic/Ollama today).
 */
import { createCopilotProvider } from "./copilot/copilotProvider";
import type { AIProvider, AITransport } from "@/ai/types";
import type { DecisionVendor } from "@/ai/decisions/types";
import type { HostByokProvider } from "@/ai/host/hostRuntime";

export type AIConnectionAccessType = "subscription" | "api_key" | "local";

export interface ConnectionField {
  key: "apiKey" | "model" | "endpoint";
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
  /** Prefilled value (a real, working default) — absent where the placeholder is only an example, e.g. Azure resource URLs. */
  defaultValue?: string;
}

/** What's needed to actually construct the `AIProvider` for one connection. */
export interface ResolvedConnection {
  model?: string;
  endpoint?: string;
  /** The API key / GitHub token, already decrypted by `credentialStore` — never logged, never stored non-encrypted. */
  secret?: string;
}

export interface AIProviderDescriptor {
  id: string;
  name: string;
  accessType: AIConnectionAccessType;
  billingWording: string;
  authFlow: "sdk_signed_in_user" | "api_key" | "none";
  transport: AITransport;
  fields: readonly ConnectionField[];
  createProvider(resolved: ResolvedConnection): AIProvider;
  /** True only where `getModels()` reflects this connection's own models. Copilot-SDK model listing is Copilot-account-scoped (it never sees a BYOK provider), so BYOK connections use a typed model field instead (F36). */
  listsModels?: boolean;
  /**
   * Set where this connection's key also opens a dedicated typed decision model (`ai/decisions`): the vendor whose decisions
   * API it is, the model to start from and what to call it in settings. Optional, off until the user enables it.
   */
  decision?: { vendor: DecisionVendor; defaultModel: string; label: string };
  /**
   * A model worth trying as the decision model on this connection (fast and cheap, for the outline and other routing
   * steps); prefilled in AI settings, never applied on its own. Checked against the connection's own catalogue.
   */
  suggestedDecisionModel?: string;
  /** Set once F36's contract-test suite records a genuine failure — see `.ai/docs/ai-connection-validation-matrix.md`. Never set for "not yet tested"; only for "tested and failed." */
  hidden?: boolean;
  /**
   * Set on connections that are one plain chat-completions endpoint with the user's own key (an "openai"-type BYOK
   * connection): how to reach it directly. The AI consistency check uses only this path (intelligent-update-engine-plan
   * §12.33 decision: direct HTTP, never the SDK); `createProvider` builds its BYOK connection from the same function.
   */
  chatCompletions?: (resolved: ResolvedConnection) => HostByokProvider;
}

/** A chat-completions BYOK connection: the endpoint (or the default) and the key, if the connection has one. */
const chatCompletions =
  (defaultEndpoint: string) =>
  (resolved: ResolvedConnection): HostByokProvider => ({
    type: "openai",
    baseUrl: resolved.endpoint ?? defaultEndpoint,
    ...(resolved.secret !== undefined ? { apiKey: resolved.secret } : {}),
  });

const MODEL_FIELD = (
  required: boolean,
  placeholder?: string,
): ConnectionField => ({
  key: "model",
  label: "Model",
  required,
  secret: false,
  placeholder,
});
const API_KEY_FIELD: ConnectionField = {
  key: "apiKey",
  label: "API key",
  required: true,
  secret: true,
};
const endpointField = (
  placeholder: string,
  defaultValue?: string,
): ConnectionField => ({
  key: "endpoint",
  label: "Endpoint",
  required: true,
  secret: false,
  placeholder,
  defaultValue,
});

export const AI_PROVIDER_DESCRIPTORS: readonly AIProviderDescriptor[] = [
  {
    id: "copilot",
    name: "GitHub Copilot",
    accessType: "subscription",
    billingWording:
      "Uses your existing Copilot subscription. Acute-Notes does not pay for inference.",
    // No real GitHub OAuth flow exists yet (needs a registered OAuth App) — Connect
    // relies on the AI host's local logged-in Copilot CLI (PRD Mode A), not a stored token.
    authFlow: "sdk_signed_in_user",
    transport: "ai_host_local",
    listsModels: true,
    fields: [MODEL_FIELD(false, "default")],
    createProvider: (resolved) =>
      createCopilotProvider({
        id: "copilot",
        name: "GitHub Copilot",
        allowHostLoggedInUser: true,
        defaultModel: resolved.model,
      }),
  },
  {
    id: "openai",
    chatCompletions: chatCompletions("https://api.openai.com/v1"),
    name: "OpenAI",
    decision: { vendor: "openai", defaultModel: "gpt-6-luna", label: "OpenAI Decisions" },
    accessType: "api_key",
    billingWording:
      "Uses your own API key. You are billed directly by the AI provider.",
    authFlow: "api_key",
    transport: "ai_host_local",
    fields: [
      API_KEY_FIELD,
      MODEL_FIELD(true),
      endpointField("https://api.openai.com/v1", "https://api.openai.com/v1"),
    ],
    createProvider: (resolved) =>
      createCopilotProvider({
        id: "openai",
        name: "OpenAI",
        byok: chatCompletions("https://api.openai.com/v1")(resolved),
        defaultModel: resolved.model,
      }),
  },
  {
    id: "azure",
    name: "Azure OpenAI / Foundry",
    accessType: "api_key",
    billingWording:
      "Uses your own API key. You are billed directly by the AI provider.",
    authFlow: "api_key",
    transport: "ai_host_local",
    fields: [
      API_KEY_FIELD,
      MODEL_FIELD(true),
      endpointField("https://my-resource.openai.azure.com"),
    ],
    createProvider: (resolved) =>
      createCopilotProvider({
        id: "azure",
        name: "Azure OpenAI / Foundry",
        byok: {
          type: "azure",
          baseUrl: resolved.endpoint ?? "",
          apiKey: resolved.secret,
        },
        defaultModel: resolved.model,
      }),
  },
  {
    id: "anthropic",
    name: "Anthropic",
    accessType: "api_key",
    billingWording:
      "Uses your own API key. You are billed directly by the AI provider.",
    authFlow: "api_key",
    transport: "ai_host_local",
    fields: [
      API_KEY_FIELD,
      MODEL_FIELD(true),
      endpointField("https://api.anthropic.com", "https://api.anthropic.com"),
    ],
    createProvider: (resolved) =>
      createCopilotProvider({
        id: "anthropic",
        name: "Anthropic",
        byok: {
          type: "anthropic",
          baseUrl: resolved.endpoint ?? "https://api.anthropic.com",
          apiKey: resolved.secret,
        },
        defaultModel: resolved.model,
      }),
  },
  {
    id: "ollama",
    chatCompletions: chatCompletions("http://localhost:11434/v1"),
    name: "Ollama",
    accessType: "local",
    billingWording: "Runs locally. No cloud AI charges.",
    authFlow: "none",
    transport: "ai_host_local",
    fields: [
      MODEL_FIELD(true),
      endpointField("http://localhost:11434/v1", "http://localhost:11434/v1"),
    ],
    createProvider: (resolved) =>
      createCopilotProvider({
        id: "ollama",
        name: "Ollama",
        byok: chatCompletions("http://localhost:11434/v1")(resolved),
        defaultModel: resolved.model,
      }),
  },
  {
    id: "gemini",
    chatCompletions: chatCompletions("https://generativelanguage.googleapis.com/v1beta/openai/"),
    name: "Gemini",
    accessType: "api_key",
    billingWording:
      "Uses your own API key. You are billed directly by the AI provider.",
    // Not documented by the Copilot SDK itself (§13.15.11) — routed as a plain
    // OpenAI-compatible BYOK endpoint against Gemini's own OpenAI-compatibility
    // layer. Passes F36's live checks; one known limitation: Gemini answers an
    // invalid key with HTTP 400 (not 401) and the SDK drops the body, so a bad
    // key surfaces as a generic failure (see the validation matrix).
    authFlow: "api_key",
    transport: "ai_host_local",
    fields: [
      API_KEY_FIELD,
      MODEL_FIELD(true),
      endpointField(
        "https://generativelanguage.googleapis.com/v1beta/openai/",
        "https://generativelanguage.googleapis.com/v1beta/openai/",
      ),
    ],
    createProvider: (resolved) =>
      createCopilotProvider({
        id: "gemini",
        name: "Gemini",
        byok: chatCompletions("https://generativelanguage.googleapis.com/v1beta/openai/")(resolved),
        defaultModel: resolved.model,
      }),
  },
  {
    id: "openrouter",
    chatCompletions: chatCompletions("https://openrouter.ai/api/v1"),
    name: "OpenRouter",
    decision: { vendor: "jev", defaultModel: "typesafe/jev-1.13", label: "Jev" },
    // TypeSafe's Jev router (openrouter.ai/typesafe/jev-router): picks a model and reasoning effort per request.
    suggestedDecisionModel: "typesafe/jev-router",
    accessType: "api_key",
    billingWording:
      "Uses your own API key. You are billed directly by the AI provider.",
    // A model router, not a vendor: one OpenAI-compatible endpoint in front of many vendors' models. The model
    // field is the same free-text input every BYOK connection already has — "any model" needs no extra UI, just
    // the vendor-prefixed model id OpenRouter expects (e.g. "anthropic/claude-sonnet-4.5", "openai/gpt-5").
    authFlow: "api_key",
    transport: "ai_host_local",
    fields: [
      API_KEY_FIELD,
      MODEL_FIELD(true, "anthropic/claude-sonnet-4.5"),
      endpointField(
        "https://openrouter.ai/api/v1",
        "https://openrouter.ai/api/v1",
      ),
    ],
    createProvider: (resolved) =>
      createCopilotProvider({
        id: "openrouter",
        name: "OpenRouter",
        byok: chatCompletions("https://openrouter.ai/api/v1")(resolved),
        defaultModel: resolved.model,
      }),
  },
  {
    id: "aicredits",
    chatCompletions: chatCompletions("https://api.aicredits.in/v1"),
    name: "AICredits",
    suggestedDecisionModel: "google/gemini-2.5-flash-lite",
    accessType: "api_key",
    billingWording:
      "Uses your own API key. You are billed directly by the AI provider.",
    // A model router like OpenRouter (same vendor-prefixed model ids, e.g. "openai/gpt-4o"), verified against
    // aicredits.in/docs: OpenAI-compatible `/chat/completions`, `Authorization: Bearer sk-...`.
    authFlow: "api_key",
    transport: "ai_host_local",
    fields: [
      API_KEY_FIELD,
      MODEL_FIELD(true, "deepseek/deepseek-chat"),
      endpointField(
        "https://api.aicredits.in/v1",
        "https://api.aicredits.in/v1",
      ),
    ],
    createProvider: (resolved) =>
      createCopilotProvider({
        id: "aicredits",
        name: "AICredits",
        byok: chatCompletions("https://api.aicredits.in/v1")(resolved),
        defaultModel: resolved.model,
      }),
  },
  {
    id: "neevcloud",
    chatCompletions: chatCompletions("https://inference.ai.neevcloud.com/v1"),
    name: "NeevCloud",
    accessType: "api_key",
    billingWording:
      "Uses your own API key. You are billed directly by the AI provider.",
    // OpenAI-compatible inference over models deployed on the user's own NeevCloud account (docs.ai.neevcloud.com)
    // — unlike OpenRouter/AICredits, the "model" value is that account's own deployment id, not a fixed catalogue
    // name, so there's no universal example to prefill.
    authFlow: "api_key",
    transport: "ai_host_local",
    fields: [
      API_KEY_FIELD,
      MODEL_FIELD(true, "your deployment's model id"),
      endpointField(
        "https://inference.ai.neevcloud.com/v1",
        "https://inference.ai.neevcloud.com/v1",
      ),
    ],
    createProvider: (resolved) =>
      createCopilotProvider({
        id: "neevcloud",
        name: "NeevCloud",
        byok: chatCompletions("https://inference.ai.neevcloud.com/v1")(resolved),
        defaultModel: resolved.model,
      }),
  },
];
