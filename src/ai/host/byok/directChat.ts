/**
 * BYOK chat completions sent directly, with the caller's output cap and temperature (intelligent-update-engine-plan #7, 2026-11-23).
 *
 * Measured on the wire (§12.30): through the Copilot SDK a BYOK request carries **no `max_tokens`** and **`temperature: 1`**,
 * whatever the task asked for — plus the SDK's own ~6.9 kB system prompt and up to 5 retries on 429/5xx (#8). Only the
 * single-attempt consistency check was guarded. This wraps the host runtime (whose Copilot code is frozen for the guard-smoke
 * recording, so it is not edited) and sends a plain chat-completions BYOK call itself:
 * - `max_tokens` = the request's `maxTokens` (when set), `temperature` = the request's `temperature` (when set),
 *   `reasoning_effort` when set; the request's own system prompt and prompt, nothing added;
 * - **at most two requests**: one retry, after a short wait, only for 429 / 5xx / a network failure before any answer —
 *   never for 4xx, a timeout or a cancel. Redirects are refused (a 307/308 would re-send the key and body);
 * - a vendor's error text is never forwarded (it could echo request content): fixed messages per kind;
 * - **a model that refuses a parameter** (OpenAI reasoning models: `max_tokens` → `max_completion_tokens`, no temperature but
 *   the default) gets one adjusted request — read from the 400, never forwarded — and the adjustment is remembered for that
 *   endpoint and model, so later calls are sent right the first time. The cap is kept; only its name changes.
 *
 * Everything else goes to the wrapped runtime unchanged: GitHub Copilot connections, Anthropic, Azure, the responses API, a
 * request with no model, and `singleAttempt` requests (their guard path is the recorded one). Off switch:
 * `ACUTE_BYOK_DIRECT=off` (server, read per call).
 */
import { AIError, type AIErrorKind } from "@/ai/errors";
import { endpointOf } from "@/ai/host/judge/directJudge";
import type { HostByokProvider, HostGenerateInput, HostRuntime } from "@/ai/host/hostRuntime";
import type { AIResponse, AIStreamChunk, AIUsage } from "@/ai/types";

/** A request with no timeout of its own never waits longer than this. */
export const DIRECT_CHAT_DEFAULT_TIMEOUT_MS = 180_000;
/** The wait before the one retry (a 429's `Retry-After` is honoured up to `MAX_RETRY_WAIT_MS`). */
const RETRY_WAIT_MS = 1_000;
const MAX_RETRY_WAIT_MS = 5_000;

/** Is the direct path on? Default on; `ACUTE_BYOK_DIRECT=off` sends every BYOK call through the Copilot runtime as before. */
export function isByokDirectEnabled(): boolean {
  return process.env.ACUTE_BYOK_DIRECT !== "off";
}

/** Does this call go direct: a plain chat-completions BYOK connection, a named model, not a single-attempt call. */
export function goesDirect(input: HostGenerateInput): boolean {
  const p = input.provider;
  if (!isByokDirectEnabled() || !p || !input.request.model || input.request.singleAttempt) return false;
  return p.type === "openai" && (p.wireApi ?? "completions") === "completions" && endpointOf(p.baseUrl) !== null;
}

/** The request body: exactly what the caller asked for (see module doc). Exported for tests. */
export function directBody(input: HostGenerateInput, stream: boolean): Record<string, unknown> {
  const r = input.request;
  return {
    model: r.model,
    ...(Number.isInteger(r.maxTokens) && (r.maxTokens ?? 0) > 0 ? { max_tokens: r.maxTokens } : {}),
    ...(typeof r.temperature === "number" && Number.isFinite(r.temperature) ? { temperature: r.temperature } : {}),
    ...(r.reasoningEffort ? { reasoning_effort: r.reasoningEffort } : {}),
    messages: [...(r.systemPrompt ? [{ role: "system", content: r.systemPrompt }] : []), { role: "user", content: r.prompt }],
    ...(stream ? { stream: true } : {}),
  };
}

const MESSAGES: Partial<Record<AIErrorKind, string>> = {
  auth: "The AI connection rejected the API key.",
  quota_exhausted: "The AI connection's account is out of credit or quota.",
  rate_limited: "The AI connection is rate limited. Try again shortly.",
  model_unavailable: "The AI connection refused the request (the model name, or a setting it doesn't accept).",
  timeout: "The AI connection took too long to answer.",
  network: "The AI connection couldn't be reached.",
  invalid_output: "The AI connection's reply couldn't be read.",
};
const fail = (kind: AIErrorKind, cause?: unknown) => new AIError(kind, MESSAGES[kind] ?? "The AI request failed.", cause ? { cause } : undefined);

function kindForStatus(status: number): AIErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota_exhausted";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 || status === 404 || status === 422) return "model_unavailable";
  return "network";
}
const retryable = (status: number) => status === 429 || status >= 500;

/** Per endpoint and model: parameters it refused once (see module doc). */
const refused = new Map<string, { capAsCompletionTokens?: boolean; noTemperature?: boolean }>();
/** For tests: forget what models refused. */
export function resetDirectChatAdjustments(): void {
  refused.clear();
}

/** The body as this endpoint and model accept it. */
function adjusted(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const r = refused.get(key);
  if (!r) return body;
  const out = { ...body };
  if (r.capAsCompletionTokens && out.max_tokens !== undefined) {
    out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }
  if (r.noTemperature) delete out.temperature;
  return out;
}

/** What a 400 says the model refused (read here only; never forwarded). Returns whether anything new was learned. */
function learnRefusal(text: string, body: Record<string, unknown>, key: string): boolean {
  const now = { ...(refused.get(key) ?? {}) };
  const unsupported = /unsupported|not supported|does not support|only the default|isn't supported|is not available/i;
  let learned = false;
  if (body.max_tokens !== undefined && !now.capAsCompletionTokens && /max_tokens/.test(text) && (unsupported.test(text) || /max_completion_tokens/.test(text))) {
    now.capAsCompletionTokens = true;
    learned = true;
  }
  if (body.temperature !== undefined && !now.noTemperature && /temperature/i.test(text) && unsupported.test(text)) {
    now.noTemperature = true;
    learned = true;
  }
  if (learned) refused.set(key, now);
  return learned;
}
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function finishOf(reason: unknown): AIResponse["finishReason"] {
  if (reason === "length") return "length";
  if (reason === "content_filter") return "error";
  return "stop";
}

function usageOf(model: string, u: { prompt_tokens?: unknown; completion_tokens?: unknown; completion_tokens_details?: { reasoning_tokens?: unknown } } | undefined): AIUsage {
  const promptTokens = num(u?.prompt_tokens);
  const completionTokens = num(u?.completion_tokens);
  const reasoningTokens = num(u?.completion_tokens_details?.reasoning_tokens);
  // The host is still "copilot" to everything downstream (spend summary, call log): only the transport changed.
  return { provider: "copilot", model, ...(promptTokens !== undefined ? { promptTokens } : {}), ...(completionTokens !== undefined ? { completionTokens } : {}), ...(reasoningTokens !== undefined ? { reasoningTokens } : {}) };
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Sends the request: at most two attempts (see module doc). Returns the OK response and how many requests left. */
async function send(input: HostGenerateInput, stream: boolean, fetchImpl: typeof fetch): Promise<{ res: Response; requests: number; signal: AbortSignal; timeout: AbortSignal }> {
  const provider = input.provider as HostByokProvider;
  const endpoint = endpointOf(provider.baseUrl)!;
  const timeout = AbortSignal.timeout(input.request.timeoutMs && input.request.timeoutMs > 0 ? input.request.timeoutMs : DIRECT_CHAT_DEFAULT_TIMEOUT_MS);
  const signal = input.request.signal ? AbortSignal.any([input.request.signal, timeout]) : timeout;
  const base = directBody(input, stream);
  const key = `${endpoint}|${input.request.model}`;
  let requests = 0;
  for (;;) {
    let res: Response;
    try {
      requests++;
      res = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: { ...(provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {}), "content-type": "application/json", ...(stream ? { accept: "text/event-stream" } : {}) },
        body: JSON.stringify(adjusted(base, key)),
        signal,
      });
    } catch (err) {
      if (input.request.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
      if (timeout.aborted) throw fail("timeout", err);
      if (requests < 2) {
        await wait(RETRY_WAIT_MS, signal);
        continue;
      }
      throw fail("network", err);
    }
    if (res.ok) return { res, requests, signal, timeout };
    if (requests < 2 && res.status === 400) {
      const text = await res.text().catch(() => "");
      if (learnRefusal(text, adjusted(base, key), key)) continue;
      throw fail("model_unavailable");
    }
    if (requests < 2 && retryable(res.status)) {
      const after = Number(res.headers.get("retry-after"));
      await res.body?.cancel().catch(() => undefined);
      await wait(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, MAX_RETRY_WAIT_MS) : RETRY_WAIT_MS, signal);
      if (input.request.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
      continue;
    }
    await res.body?.cancel().catch(() => undefined);
    throw fail(kindForStatus(res.status));
  }
}

/** One non-streaming call. */
export async function directGenerate(input: HostGenerateInput, fetchImpl: typeof fetch = fetch): Promise<AIResponse> {
  const { res, requests, timeout } = await send(input, false, fetchImpl);
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    if (input.request.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
    throw fail(timeout.aborted ? "timeout" : "network", err);
  }
  let parsed: { model?: unknown; choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: Parameters<typeof usageOf>[1] };
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw fail("invalid_output", err);
  }
  const choice = parsed?.choices?.[0];
  if (!choice) throw fail("invalid_output");
  const model = typeof parsed.model === "string" ? parsed.model : input.request.model!;
  return { text: typeof choice.message?.content === "string" ? choice.message.content : "", model, finishReason: finishOf(choice.finish_reason), usage: usageOf(model, parsed.usage), providerRequests: requests };
}

/** One streaming call: server-sent events, one `delta` per content piece, then `done`. */
export async function* directStream(input: HostGenerateInput, fetchImpl: typeof fetch = fetch): AsyncGenerator<AIStreamChunk> {
  const { res, timeout } = await send(input, true, fetchImpl);
  if (!res.body) throw fail("invalid_output");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (input.request.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
        throw fail(timeout.aborted ? "timeout" : "network", err);
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          yield { delta: "", done: true };
          return;
        }
        let event: { choices?: { delta?: { content?: unknown } }[] };
        try {
          event = JSON.parse(data);
        } catch {
          continue; // a keep-alive or a vendor extension: not content
        }
        const delta = event?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) yield { delta, done: false };
      }
    }
    yield { delta: "", done: true };
  } finally {
    reader.releaseLock();
  }
}

/** The host runtime with plain chat-completions BYOK calls sent directly (see module doc); everything else as `inner` does it. */
export function withDirectByok(inner: HostRuntime, fetchImpl: typeof fetch = (...a) => fetch(...a)): HostRuntime {
  return {
    id: inner.id,
    generate: (input) => (goesDirect(input) ? directGenerate(input, fetchImpl) : inner.generate(input)),
    stream: (input) => (goesDirect(input) ? directStream(input, fetchImpl) : inner.stream(input)),
    listModels: (auth) => inner.listModels(auth),
  };
}
