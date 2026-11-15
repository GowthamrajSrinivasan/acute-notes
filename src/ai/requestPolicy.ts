/**
 * One-request tasks: a task registered here is sent as exactly ONE model request per run, with an output cap, by the
 * connection adapter (`providers/copilot/copilotProvider.ts`) — for paid calls a user approves one click at a time
 * (`generate_openui_notes`). The runtime (`runtime.ts`) is code-frozen for an evaluation, so the limits live at the
 * adapter boundary, the last place a request passes before it leaves the browser:
 * - every request of the task goes to the AI host's one-shot route with `singleAttempt` (the host's request guard sends
 *   one model request and refuses any SDK retry, model switch or fallback, §12.29) and `maxTokens` (written into the
 *   request on a BYOK connection, §12.30; a Copilot subscription session ignores it);
 * - a run is identified by its AbortSignal: a second request with the same signal (the runtime's fallback connection or
 *   schema repair) is never sent — the first request's own error is thrown again instead.
 * Streaming is not used for these tasks (the host's stream route has no request guard); the whole reply arrives at once.
 */
import { AIError } from "./errors";
import type { AIRequest, AIResponse, AIUsage } from "./types";

export interface OneRequestPolicy {
  /** The output cap sent with the request. */
  maxTokens: number;
}

const policies = new Map<string, OneRequestPolicy>();

export function setOneRequestPolicy(task: string, policy: OneRequestPolicy): void {
  policies.set(task, policy);
}

export function oneRequestPolicyOf(task: string): OneRequestPolicy | undefined {
  return policies.get(task);
}

interface RunRecord {
  error?: unknown;
  usage?: AIUsage;
  providerRequests?: number;
}

const runs = new WeakMap<AbortSignal, RunRecord>();

/**
 * Sends a one-request task's request through `send`, unless its run already sent one. Throws without sending when the
 * request has no signal (no way to tell runs apart) or when the run's request was already sent.
 */
export async function sendOneRequest(request: AIRequest, connection: { id: string; capped: boolean }, send: (request: AIRequest) => Promise<AIResponse>): Promise<AIResponse> {
  const policy = oneRequestPolicyOf(request.task);
  if (!policy) return send(request);
  const signal = request.signal;
  if (!signal) throw new AIError("invalid_output", `"${request.task}" runs only with a signal that identifies its run; nothing was sent.`);
  const previous = runs.get(signal);
  if (previous) {
    console.warn(`[acute-notes] AI: "${request.task}" already sent its one request in this run; a second request (fallback connection or repair) was not sent.`);
    throw previous.error ?? new AIError("invalid_output", `"${request.task}" already sent its one request in this run.`);
  }
  const record: RunRecord = {};
  runs.set(signal, record);
  if (!connection.capped) console.warn(`[acute-notes] AI: "${request.task}" on ${connection.id}: this connection does not enforce the ${policy.maxTokens}-token output cap (a Copilot subscription bills per request instead).`);
  const startedAt = Date.now();
  try {
    const response = await send({ ...request, maxTokens: policy.maxTokens, singleAttempt: true });
    record.usage = response.usage;
    record.providerRequests = response.providerRequests;
    const u = response.usage;
    console.info(
      `[acute-notes] AI usage: "${request.task}" via ${connection.id}, model ${u.model || response.model || "unknown"}: ${u.promptTokens ?? "?"} input / ${u.completionTokens ?? "?"} output tokens` +
        `${u.reasoningTokens !== undefined ? ` (${u.reasoningTokens} reasoning)` : ""}${u.subscriptionUsage ? `, ${u.subscriptionUsage.amount} ${u.subscriptionUsage.unit}` : ""}; ` +
        `model requests sent: ${response.providerRequests ?? "not counted"}; output cap ${policy.maxTokens}${connection.capped ? "" : " (not enforced)"}; ${Date.now() - startedAt} ms`,
    );
    return response;
  } catch (err) {
    record.error = err;
    console.warn(`[acute-notes] AI: "${request.task}" via ${connection.id} failed (${err instanceof AIError ? err.kind : "error"}); not retried.`);
    throw err;
  }
}

/** What the run's one request reported (usage, model requests the host counted), once it has answered. */
export function oneRequestUsageOf(signal: AbortSignal): { usage: AIUsage; providerRequests?: number } | undefined {
  const r = runs.get(signal);
  return r?.usage ? { usage: r.usage, ...(r.providerRequests !== undefined ? { providerRequests: r.providerRequests } : {}) } : undefined;
}
