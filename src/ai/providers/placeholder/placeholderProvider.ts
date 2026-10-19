/**
 * Test-only adapter proving PRD §13.15.12 / §23: a new connection needs only
 * its own folder plus one entry in `registry.ts`. Deliberately not in the
 * registry — `placeholder.test.ts` adds that one entry. It does no inference.
 */
import type { AIProvider } from "@/ai/types";

export function createPlaceholderProvider(options: { model?: string; secret?: string }): AIProvider {
  return {
    id: "placeholder",
    name: "Placeholder",
    authTypes: ["api_key"],
    transport: "browser_direct",
    capabilities: { streaming: false, structuredOutput: "json_mode", toolCalling: false, vision: false, embeddings: false, modelSelection: true },
    async isConfigured() {
      return Boolean(options.secret);
    },
    async testConnection() {
      return options.secret ? { ok: true } : { ok: false, message: "No API key." };
    },
    async generate(request) {
      const model = request.model ?? options.model ?? "placeholder-1";
      return { text: JSON.stringify({ label: "placeholder" }), model, finishReason: "stop", usage: { provider: "placeholder", model, promptTokens: 1, completionTokens: 1 } };
    },
    async getModels() {
      return [{ id: "placeholder-1", name: "Placeholder 1" }];
    },
  };
}
