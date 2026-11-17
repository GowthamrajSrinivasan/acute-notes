/**
 * The app's `JudgeTransport` (intelligent-update-engine-plan Stage 4f, §12.33 decision: direct HTTP only): one POST to
 * the AI host's `/api/ai/judge` route, which makes exactly one direct request to the user's chat-completions connection.
 * Never the Copilot SDK path (`/api/ai/run`): that one may retry underneath and sends its own large system prompt.
 *
 * - `capsOutput`: the route writes `max_tokens` into the request, so the cap is real;
 * - `singleAttempt`: fetch never retries a POST, redirects are refused, and the route makes one request; the host's own
 *   count comes back as `providerRequests`.
 */
import type { HostByokProvider } from "@/ai/host/hostRuntime";
import type { JudgeTransport } from "./judgeCall";

export interface DirectJudgeConnection {
  /** The connection's id (for the record; never sent to the model). */
  connectionId: string;
  model: string;
  provider: HostByokProvider;
}

/**
 * Is the server's AI-check switch on? A GET to `/api/ai/judge` (no body, no key, never reaches a model): 204 when on,
 * 404 when off. Asked before a check reserves anything, so an off server costs no budget and no attempt (pilot review
 * D7). Any other answer or a network error reads as off.
 */
export async function judgeServerReady(options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): Promise<boolean> {
  const doFetch = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  try {
    const res = await doFetch(`${options.baseUrl ?? ""}/api/ai/judge`, { method: "GET", redirect: "error", cache: "no-store" });
    return res.status === 204;
  } catch {
    return false;
  }
}

export function directJudgeTransport(connection: DirectJudgeConnection, options: { baseUrl?: string; fetchImpl?: typeof fetch } = {}): JudgeTransport {
  const doFetch = options.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    id: `direct:${connection.connectionId}`,
    capsOutput: true,
    singleAttempt: true,
    async send(request) {
      request.onProviderRequest?.();
      const res = await doFetch(`${options.baseUrl ?? ""}/api/ai/judge`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: connection.provider,
          model: connection.model,
          systemPrompt: request.systemPrompt,
          prompt: request.prompt,
          maxTokens: request.maxTokens,
          reasoningEffort: request.reasoningEffort,
          timeoutMs: request.timeoutMs,
        }),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (!res.ok) {
        // Not D7's path any more in the app (it asks `judgeServerReady` first); kept for a switch turned off mid-check.
        const body = (await res.json().catch(() => ({}))) as { kind?: unknown; message?: unknown };
        throw new Error(res.status === 404 ? "the AI check is switched off on this server" : typeof body.message === "string" ? body.message.slice(0, 160) : `http ${res.status}`);
      }
      const r = (await res.json()) as { text?: unknown; finishReason?: unknown; usage?: { promptTokens?: unknown; completionTokens?: unknown }; providerRequests?: unknown };
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      const promptTokens = num(r.usage?.promptTokens);
      const completionTokens = num(r.usage?.completionTokens);
      const providerRequests = num(r.providerRequests);
      return {
        text: typeof r.text === "string" ? r.text : "",
        finishReason: typeof r.finishReason === "string" ? r.finishReason : null,
        usage: { ...(promptTokens !== undefined ? { promptTokens } : {}), ...(completionTokens !== undefined ? { completionTokens } : {}) },
        ...(providerRequests !== undefined ? { providerRequests } : {}),
      };
    },
  };
}
