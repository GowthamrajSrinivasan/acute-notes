/**
 * The browser side of a decision model: a thin HTTP client to the AI host's decide route (`src/app/api/ai/decide`), like
 * `createCopilotProvider` is for chat. The vendor call itself happens on the host.
 */
import { AIError, isAIErrorKind } from "@/ai/errors";
import type { DecisionCallOptions, DecisionHostBody, DecisionProvider, DecisionRequest, DecisionResult, DecisionVendor } from "./types";

export interface HttpDecisionProviderConfig {
  /** The connection it belongs to. */
  id: string;
  name: string;
  vendor: DecisionVendor;
  model: string;
  apiKey: string;
  /** AI host origin; same-origin ("") by default. */
  baseUrl?: string;
}

export function createHttpDecisionProvider(config: HttpDecisionProviderConfig): DecisionProvider {
  const baseUrl = config.baseUrl ?? "";
  return {
    id: config.id,
    name: config.name,
    model: config.model,
    async decide(request: DecisionRequest, options: DecisionCallOptions = {}): Promise<DecisionResult> {
      const body: DecisionHostBody = {
        vendor: config.vendor,
        model: config.model,
        apiKey: config.apiKey,
        request: request as DecisionHostBody["request"],
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      };
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/api/ai/decide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: options.signal });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw new AIError("cancelled", "The AI request was cancelled.");
        throw new AIError("network", err instanceof Error ? err.message : "The AI host request failed.", { cause: err });
      }
      if (!res.ok) {
        const failure = (await res.json().catch(() => ({}))) as { kind?: string; message?: string };
        throw new AIError(isAIErrorKind(failure.kind) ? failure.kind : res.status === 401 ? "auth" : "network", failure.message ?? `AI host request failed (${res.status}).`);
      }
      return (await res.json()) as DecisionResult;
    },
  };
}
