/**
 * The AI host's decision call: sends one typed-decision request to the vendor with the caller's own key and returns the
 * normalised answers. Runs server-side only (`src/app/api/ai/decide`), like the chat host, so a vendor's key is used from the
 * local host process and not by browser code talking to the vendor. A failure becomes an `AIError` with fixed, safe text —
 * a vendor's own message is never forwarded, since it could echo request content.
 */
import { AIError, type AIErrorKind } from "@/ai/errors";
import { DECISION_ENDPOINTS, parseDecisionResponse, requestBody } from "./wire";
import type { DecisionRequest, DecisionResult, DecisionVendor } from "@/ai/decisions/types";

export const DEFAULT_DECISION_TIMEOUT_MS = 20_000;

export interface HostDecideInput {
  vendor: DecisionVendor;
  model: string;
  apiKey: string;
  request: DecisionRequest;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const MESSAGES: Partial<Record<AIErrorKind, string>> = {
  auth: "The decision model rejected the API key.",
  quota_exhausted: "The decision model's account is out of credit or quota.",
  rate_limited: "The decision model is rate limited.",
  model_unavailable: "The decision model isn't available for this key (the model name, or access to the decisions API).",
  timeout: "The decision model took too long to answer.",
  network: "The decision model couldn't be reached.",
};

function kindForStatus(status: number): AIErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 404 || status === 422) return "model_unavailable";
  return "network";
}

const fail = (kind: AIErrorKind, cause?: unknown) => new AIError(kind, MESSAGES[kind] ?? "The decision request failed.", cause ? { cause } : undefined);

export async function hostDecide(input: HostDecideInput, fetchImpl: typeof fetch = fetch): Promise<DecisionResult> {
  const endpoint = DECISION_ENDPOINTS[input.vendor];
  if (!endpoint) throw new AIError("model_unavailable", "This connection has no decision model.");
  const timeout = AbortSignal.timeout(input.timeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(requestBody(input.vendor, input.model, input.request)),
      signal,
    });
  } catch (err) {
    if (input.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
    if (timeout.aborted) throw fail("timeout", err);
    throw fail("network", err);
  }
  if (!res.ok) throw fail(kindForStatus(res.status));
  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new AIError("invalid_output", "The decision model's reply wasn't JSON.", { cause: err });
  }
  return parseDecisionResponse(input.vendor, input.model, body);
}
