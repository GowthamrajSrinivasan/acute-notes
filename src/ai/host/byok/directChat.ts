/**
 * BYOK calls sent directly, with the caller's output cap and temperature (intelligent-update-engine-plan #7, 2026-11-23;
 * Anthropic and the responses API added the same day, §19.1).
 *
 * Measured on the wire (§12.30): through the Copilot SDK a BYOK request carries **no output cap** and **`temperature: 1`**,
 * whatever the task asked for — plus the SDK's own ~6.9 kB system prompt and up to 5 retries on 429/5xx (#8). Only the
 * single-attempt consistency check was guarded. This wraps the host runtime (whose Copilot code is frozen for the guard-smoke
 * recording, so it is not edited) and sends the call itself, in the connection's own wire format:
 * - **chat completions** (`openai`, the default wire): `POST <baseUrl>/chat/completions` — `max_tokens`, `temperature`,
 *   `reasoning_effort`, a system and a user message;
 * - **responses API** (`openai` with `wireApi: "responses"`): `POST <baseUrl>/responses` — `max_output_tokens`,
 *   `temperature`, `reasoning.effort`, `instructions` and `input`, `store: false`;
 * - **Anthropic Messages** (`anthropic`): `POST <baseUrl>/v1/messages` (or `/messages` when the base URL already ends in
 *   `/v1`) with `x-api-key` and `anthropic-version` — `max_tokens` (Anthropic requires one: the request's, else
 *   `UNMEASURED_MAX_TOKENS`), `temperature`, `system`; a reasoning effort has no equivalent there and is not sent.
 *
 * The same rules for all three:
 * - only what the caller set is sent (a cap, a temperature), with the request's own system prompt and prompt, nothing added;
 * - **at most two requests**: one retry, after a short wait, only for 429 / 5xx (Anthropic's 529 included) / a network
 *   failure before any answer — never for 4xx, a timeout or a cancel. Redirects are refused (a 307/308 would re-send the key);
 * - a vendor's error text is never forwarded (it could echo request content): fixed messages per kind;
 * - **a model that refuses a parameter** gets one adjusted request — read from the 400, never forwarded — and the adjustment
 *   is remembered for that endpoint and model: `max_tokens` → `max_completion_tokens` (OpenAI reasoning models), no
 *   temperature but the default, and a cap above the model's own output limit lowered to it (Anthropic's
 *   "max_tokens: N > M"). The cap is kept otherwise; only its name or size changes.
 *
 * Everything else goes to the wrapped runtime unchanged: GitHub Copilot connections, Azure (its route depends on how the
 * endpoint and API version were set, which the SDK resolves), a request with no model, and `singleAttempt` requests (their
 * guard path is the recorded one). Off switch: `ACUTE_BYOK_DIRECT=off` (server, read per call).
 */
import { AIError, type AIErrorKind } from "@/ai/errors";
import { endpointOf } from "@/ai/host/judge/directJudge";
import type { HostByokProvider, HostGenerateInput, HostRuntime } from "@/ai/host/hostRuntime";
import { UNMEASURED_MAX_TOKENS } from "@/ai/taskLimits";
import type { AIResponse, AIStreamChunk, AIUsage } from "@/ai/types";

/** A request with no timeout of its own never waits longer than this. */
export const DIRECT_CHAT_DEFAULT_TIMEOUT_MS = 180_000;
/** The wait before the one retry (a 429's `Retry-After` is honoured up to `MAX_RETRY_WAIT_MS`). */
const RETRY_WAIT_MS = 1_000;
const MAX_RETRY_WAIT_MS = 5_000;
/** The Messages API version sent to Anthropic. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** The wire format a direct call uses. */
export type DirectWire = "chat" | "responses" | "anthropic";

/** Is the direct path on? Default on; `ACUTE_BYOK_DIRECT=off` sends every BYOK call through the Copilot runtime as before. */
export function isByokDirectEnabled(): boolean {
  return process.env.ACUTE_BYOK_DIRECT !== "off";
}

/** The connection's wire format, or null for one that stays on the Copilot runtime (Azure). */
export function wireOf(p: HostByokProvider): DirectWire | null {
  if (p.type === "anthropic") return "anthropic";
  if (p.type === "openai") return (p.wireApi ?? "completions") === "completions" ? "chat" : "responses";
  return null;
}

/** The URL a direct call is sent to, or null for a base URL that isn't plain http(s) without credentials. */
export function directUrl(p: HostByokProvider): string | null {
  const wire = wireOf(p);
  const chat = endpointOf(p.baseUrl); // validates the base URL the same way for every wire
  if (!wire || !chat) return null;
  const base = chat.slice(0, -"/chat/completions".length);
  if (wire === "chat") return chat;
  if (wire === "responses") return `${base}/responses`;
  return /\/v1$/.test(base) ? `${base}/messages` : `${base}/v1/messages`;
}

/** Does this call go direct: a BYOK connection in a wire format above, a named model, not a single-attempt call. */
export function goesDirect(input: HostGenerateInput): boolean {
  const p = input.provider;
  if (!isByokDirectEnabled() || !p || !input.request.model || input.request.singleAttempt) return false;
  return directUrl(p) !== null;
}

const capOf = (n: number | undefined) => (Number.isInteger(n) && (n ?? 0) > 0 ? n : undefined);
const temperatureOf = (t: number | undefined) => (typeof t === "number" && Number.isFinite(t) ? t : undefined);

/** The request body: exactly what the caller asked for, in the connection's wire format (see module doc). Exported for tests. */
export function directBody(input: HostGenerateInput, stream: boolean): Record<string, unknown> {
  const r = input.request;
  const wire = (input.provider && wireOf(input.provider)) ?? "chat";
  const cap = capOf(r.maxTokens);
  const temperature = temperatureOf(r.temperature);
  if (wire === "responses") {
    return {
      model: r.model,
      ...(cap ? { max_output_tokens: cap } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(r.reasoningEffort ? { reasoning: { effort: r.reasoningEffort } } : {}),
      ...(r.systemPrompt ? { instructions: r.systemPrompt } : {}),
      input: r.prompt,
      store: false,
      ...(stream ? { stream: true } : {}),
    };
  }
  if (wire === "anthropic") {
    return {
      model: r.model,
      max_tokens: cap ?? UNMEASURED_MAX_TOKENS,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(r.systemPrompt ? { system: r.systemPrompt } : {}),
      messages: [{ role: "user", content: r.prompt }],
      ...(stream ? { stream: true } : {}),
    };
  }
  return {
    model: r.model,
    ...(cap ? { max_tokens: cap } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(r.reasoningEffort ? { reasoning_effort: r.reasoningEffort } : {}),
    messages: [...(r.systemPrompt ? [{ role: "system", content: r.systemPrompt }] : []), { role: "user", content: r.prompt }],
    ...(stream ? { stream: true } : {}),
  };
}

function headersOf(p: HostByokProvider, wire: DirectWire, stream: boolean): Record<string, string> {
  const auth: Record<string, string> =
    wire === "anthropic" ? { ...(p.apiKey ? { "x-api-key": p.apiKey } : {}), "anthropic-version": ANTHROPIC_VERSION } : p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {};
  return { ...auth, "content-type": "application/json", ...(stream ? { accept: "text/event-stream" } : {}) };
}

const MESSAGES: Partial<Record<AIErrorKind, string>> = {
  auth: "The AI connection rejected the API key.",
  quota_exhausted: "The AI connection has no credit or quota left.",
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

interface Refused {
  capAsCompletionTokens?: boolean;
  noTemperature?: boolean;
  /** The model's own output limit, learnt from a "max_tokens: N > M" refusal. */
  capLimit?: number;
}
/** Per endpoint and model: parameters it refused once (see module doc). */
const refused = new Map<string, Refused>();
/** For tests: forget what models refused. */
export function resetDirectChatAdjustments(): void {
  refused.clear();
}

/** The body as this endpoint and model accept it. */
function adjusted(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const r = refused.get(key);
  if (!r) return body;
  const out = { ...body };
  if (r.capLimit !== undefined) {
    for (const name of ["max_tokens", "max_output_tokens"] as const) {
      if (typeof out[name] === "number" && (out[name] as number) > r.capLimit) out[name] = r.capLimit;
    }
  }
  if (r.capAsCompletionTokens && out.max_tokens !== undefined) {
    out.max_completion_tokens = out.max_tokens;
    delete out.max_tokens;
  }
  if (r.noTemperature) delete out.temperature;
  return out;
}

/** What a 400 says the model refused (read here only; never forwarded). Returns whether anything new was learned. */
function learnRefusal(text: string, body: Record<string, unknown>, key: string, wire: DirectWire): boolean {
  const now: Refused = { ...(refused.get(key) ?? {}) };
  const unsupported = /unsupported|not supported|does not support|only the default|isn't supported|is not available/i;
  let learned = false;
  const capName = wire === "responses" ? "max_output_tokens" : "max_tokens";
  const limit = new RegExp(`${capName}"?:?\\s*(\\d+)\\s*>\\s*(\\d+)`).exec(text);
  const cap = body[capName];
  if (limit && typeof cap === "number") {
    const max = Number(limit[2]);
    if (Number.isInteger(max) && max > 0 && max < cap) {
      now.capLimit = max;
      learned = true;
    }
  }
  if (wire === "chat" && body.max_tokens !== undefined && !now.capAsCompletionTokens && /max_tokens/.test(text) && (unsupported.test(text) || /max_completion_tokens/.test(text))) {
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
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function usageOf(model: string, promptTokens: unknown, completionTokens: unknown, reasoningTokens?: unknown): AIUsage {
  const p = num(promptTokens);
  const c = num(completionTokens);
  const r = num(reasoningTokens);
  // The host is still "copilot" to everything downstream (spend summary, call log): only the transport changed.
  return { provider: "copilot", model, ...(p !== undefined ? { promptTokens: p } : {}), ...(c !== undefined ? { completionTokens: c } : {}), ...(r !== undefined ? { reasoningTokens: r } : {}) };
}

/** One whole reply, read in the connection's wire format; null when it holds no answer. */
function readReply(wire: DirectWire, parsed: unknown, fallbackModel: string): Omit<AIResponse, "providerRequests"> | null {
  if (!isRecord(parsed)) return null;
  const model = typeof parsed.model === "string" ? parsed.model : fallbackModel;
  const u = isRecord(parsed.usage) ? parsed.usage : {};
  if (wire === "anthropic") {
    if (!Array.isArray(parsed.content)) return null;
    const text = parsed.content.filter((b): b is { type: string; text: string } => isRecord(b) && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
    return { text, model, finishReason: parsed.stop_reason === "max_tokens" ? "length" : "stop", usage: usageOf(model, u.input_tokens, u.output_tokens) };
  }
  if (wire === "responses") {
    if (!Array.isArray(parsed.output)) return null;
    const text = parsed.output
      .filter((o): o is { type: string; content: unknown[] } => isRecord(o) && o.type === "message" && Array.isArray(o.content))
      .flatMap((o) => o.content)
      .filter((c): c is { type: string; text: string } => isRecord(c) && c.type === "output_text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("");
    const incomplete = parsed.status === "incomplete" && isRecord(parsed.incomplete_details) && parsed.incomplete_details.reason === "max_output_tokens";
    const details = isRecord(u.output_tokens_details) ? u.output_tokens_details : {};
    return { text, model, finishReason: incomplete ? "length" : "stop", usage: usageOf(model, u.input_tokens, u.output_tokens, details.reasoning_tokens) };
  }
  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
  if (!isRecord(choice)) return null;
  const message = isRecord(choice.message) ? choice.message : {};
  const details = isRecord(u.completion_tokens_details) ? u.completion_tokens_details : {};
  const finishReason = choice.finish_reason === "length" ? "length" : choice.finish_reason === "content_filter" ? "error" : "stop";
  return { text: typeof message.content === "string" ? message.content : "", model, finishReason, usage: usageOf(model, u.prompt_tokens, u.completion_tokens, details.reasoning_tokens) };
}

/** One server-sent event's data, read in the connection's wire format: a text piece, the end, a failure, or nothing. */
function readEvent(wire: DirectWire, data: string): { delta?: string; done?: true; failed?: true } {
  if (wire === "chat" && data === "[DONE]") return { done: true };
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    return {}; // a keep-alive or a vendor extension: not content
  }
  if (!isRecord(event)) return {};
  if (wire === "anthropic") {
    if (event.type === "content_block_delta" && isRecord(event.delta) && event.delta.type === "text_delta" && typeof event.delta.text === "string") return { delta: event.delta.text };
    if (event.type === "message_stop") return { done: true };
    return event.type === "error" ? { failed: true } : {};
  }
  if (wire === "responses") {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") return { delta: event.delta };
    if (event.type === "response.completed" || event.type === "response.incomplete") return { done: true };
    return event.type === "response.failed" || event.type === "error" ? { failed: true } : {};
  }
  const choice = Array.isArray(event.choices) ? event.choices[0] : undefined;
  const delta = isRecord(choice) && isRecord(choice.delta) ? choice.delta.content : undefined;
  return typeof delta === "string" && delta ? { delta } : {};
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/** Sends the request: at most two attempts (see module doc). Returns the OK response and how many requests left. */
async function send(input: HostGenerateInput, stream: boolean, fetchImpl: typeof fetch): Promise<{ res: Response; requests: number; timeout: AbortSignal; wire: DirectWire }> {
  const provider = input.provider as HostByokProvider;
  const wire = wireOf(provider)!;
  const url = directUrl(provider)!;
  const timeout = AbortSignal.timeout(input.request.timeoutMs && input.request.timeoutMs > 0 ? input.request.timeoutMs : DIRECT_CHAT_DEFAULT_TIMEOUT_MS);
  const signal = input.request.signal ? AbortSignal.any([input.request.signal, timeout]) : timeout;
  const base = directBody(input, stream);
  const key = `${url}|${input.request.model}`;
  let requests = 0;
  for (;;) {
    let res: Response;
    try {
      requests++;
      res = await fetchImpl(url, { method: "POST", redirect: "error", headers: headersOf(provider, wire, stream), body: JSON.stringify(adjusted(base, key)), signal });
    } catch (err) {
      if (input.request.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
      if (timeout.aborted) throw fail("timeout", err);
      if (requests < 2) {
        await wait(RETRY_WAIT_MS, signal);
        continue;
      }
      throw fail("network", err);
    }
    if (res.ok) return { res, requests, timeout, wire };
    if (requests < 2 && res.status === 400) {
      const text = await res.text().catch(() => "");
      if (learnRefusal(text, adjusted(base, key), key, wire)) continue;
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
  const { res, requests, timeout, wire } = await send(input, false, fetchImpl);
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    if (input.request.signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
    throw fail(timeout.aborted ? "timeout" : "network", err);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw fail("invalid_output", err);
  }
  const reply = readReply(wire, parsed, input.request.model!);
  if (!reply) throw fail("invalid_output");
  return { ...reply, providerRequests: requests };
}

/** One streaming call: server-sent events, one `delta` per content piece, then `done`. */
export async function* directStream(input: HostGenerateInput, fetchImpl: typeof fetch = fetch): AsyncGenerator<AIStreamChunk> {
  const { res, timeout, wire } = await send(input, true, fetchImpl);
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
        if (!line.startsWith("data:")) continue; // `event:` names, comments and blank lines: the data says what it is
        const event = readEvent(wire, line.slice(5).trim());
        if (event.failed) throw fail("network");
        if (event.delta) yield { delta: event.delta, done: false };
        if (event.done) {
          yield { delta: "", done: true };
          return;
        }
      }
    }
    yield { delta: "", done: true };
  } finally {
    reader.releaseLock();
  }
}

/** The host runtime with BYOK calls in a direct wire format sent directly (see module doc); everything else as `inner` does it. */
export function withDirectByok(inner: HostRuntime, fetchImpl: typeof fetch = (...a) => fetch(...a)): HostRuntime {
  return {
    id: inner.id,
    generate: (input) => (goesDirect(input) ? directGenerate(input, fetchImpl) : inner.generate(input)),
    stream: (input) => (goesDirect(input) ? directStream(input, fetchImpl) : inner.stream(input)),
    listModels: (auth) => inner.listModels(auth),
  };
}
