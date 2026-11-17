/**
 * The AI consistency check's direct path on the AI host (intelligent-update-engine-plan Stage 4f, §12.33 decision:
 * direct HTTP only — never the Copilot SDK, which retries on its own and adds a 6.9 kB system prompt). Server-side only
 * (`src/app/api/ai/judge`), like the other AI host routes, so the user's key is used from the local host process.
 *
 * **Exactly one request per call:** one `fetch` POST to `<baseUrl>/chat/completions` — no retry on 429/5xx, no fallback
 * model, redirects refused (a 307/308 would re-send the body). The output cap is real (`max_tokens`, reasoning and answer
 * together on these endpoints), the temperature is 0 and the reasoning effort the one the budget was sized for. The
 * request is byte-for-byte the shape the evaluation recorder measured (`contractTests/judgeHttpTransport.ts`).
 *
 * Only a chat-completions BYOK connection (`type: "openai"`, completions wire API) qualifies; anything else is refused
 * before a request is made. A failure becomes an `AIError` with fixed, safe text — a vendor's own message is never
 * forwarded, since it could echo request content.
 */
import { z } from "zod";
import { AIError, type AIErrorKind } from "@/ai/errors";
import type { HostByokProvider } from "@/ai/host/hostRuntime";

/** The largest completion budget the check ever asks for: 10 pairs × 60 + 700 reasoning (`judge.ts` `outputBudget`). */
export const DIRECT_JUDGE_MAX_TOKENS = 1_300;
/** The check's request timeout (`JUDGE_CALL_TIMEOUT_MS`): the host never waits longer. */
export const DIRECT_JUDGE_TIMEOUT_MS = 90_000;
/** Generous bounds on what a judge call can contain (its input is capped at 1,500 tokens ≈ 6,000 characters). */
const MAX_SYSTEM_CHARS = 2_000;
const MAX_PROMPT_CHARS = 8_000;

/** Is this connection one plain chat-completions endpoint (the only kind the direct path speaks)? */
export function isDirectJudgeProvider(provider: HostByokProvider | null | undefined): boolean {
  if (!provider || provider.type !== "openai" || (provider.wireApi ?? "completions") !== "completions") return false;
  return endpointOf(provider.baseUrl) !== null;
}

/** `<baseUrl>/chat/completions`, or null when the base isn't a plain http(s) URL without credentials. */
export function endpointOf(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

/** The route's body: what one judge call needs, nothing else. */
export const directJudgeBodySchema = z.object({
  provider: z.object({ type: z.string(), baseUrl: z.string().min(1).max(500), apiKey: z.string().max(500).optional(), wireApi: z.enum(["completions", "responses"]).optional() }),
  model: z.string().min(1).max(200),
  systemPrompt: z.string().max(MAX_SYSTEM_CHARS),
  prompt: z.string().min(1).max(MAX_PROMPT_CHARS),
  maxTokens: z.number().int().min(1).max(DIRECT_JUDGE_MAX_TOKENS),
  reasoningEffort: z.literal("low"),
  timeoutMs: z.number().int().min(1).max(DIRECT_JUDGE_TIMEOUT_MS),
});
export type DirectJudgeInput = z.infer<typeof directJudgeBodySchema> & { signal?: AbortSignal };

export interface DirectJudgeReply {
  text: string;
  finishReason: string | null;
  usage: { promptTokens?: number; completionTokens?: number };
  /** Physical model requests made for this call: always 1 when a request left (the route's own count). */
  providerRequests: 1;
}

const MESSAGES: Partial<Record<AIErrorKind, string>> = {
  auth: "The AI connection rejected the API key.",
  quota_exhausted: "The AI connection's account is out of credit or quota.",
  rate_limited: "The AI connection is rate limited.",
  model_unavailable: "The AI connection refused the request (the model name, or a setting it doesn't accept).",
  timeout: "The AI connection took too long to answer.",
  network: "The AI connection couldn't be reached.",
  invalid_output: "The AI connection's reply couldn't be read.",
};

function kindForStatus(status: number): AIErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 404 || status === 422) return "model_unavailable";
  return "network";
}

const fail = (kind: AIErrorKind, cause?: unknown) => new AIError(kind, MESSAGES[kind] ?? "The AI check request failed.", cause ? { cause } : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** One judge call: one request (see module doc). `onRequest` is called once, just before the request leaves. */
export async function hostDirectJudge(input: DirectJudgeInput, fetchImpl: typeof fetch = fetch, onRequest?: () => void): Promise<DirectJudgeReply> {
  const provider = input.provider as HostByokProvider;
  if (!isDirectJudgeProvider(provider)) throw new AIError("model_unavailable", "This AI connection can't run the consistency check (it needs a chat-completions connection with its own key).");
  const endpoint = endpointOf(provider.baseUrl)!;
  const timeout = AbortSignal.timeout(Math.min(input.timeoutMs, DIRECT_JUDGE_TIMEOUT_MS));
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let res: Response;
  let body: string;
  try {
    onRequest?.();
    res = await fetchImpl(endpoint, {
      method: "POST",
      redirect: "error",
      headers: { ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}), "content-type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        max_tokens: input.maxTokens,
        reasoning_effort: input.reasoningEffort,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.prompt },
        ],
      }),
      signal,
    });
    body = await res.text();
  } catch (err) {
    if (input.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
    if (timeout.aborted) throw fail("timeout", err);
    throw fail("network", err);
  }
  if (!res.ok) throw fail(kindForStatus(res.status));
  let parsed: { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw fail("invalid_output", err);
  }
  const choice = parsed?.choices?.[0];
  const promptTokens = num(parsed?.usage?.prompt_tokens);
  const completionTokens = num(parsed?.usage?.completion_tokens);
  return {
    text: typeof choice?.message?.content === "string" ? choice.message.content : "",
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    usage: { ...(promptTokens !== undefined ? { promptTokens } : {}), ...(completionTokens !== undefined ? { completionTokens } : {}) },
    providerRequests: 1,
  };
}
