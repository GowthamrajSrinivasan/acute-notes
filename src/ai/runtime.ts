/**
 * The only feature-facing AI entry point (PRD §13.15.7): `AIRuntime.run(task,
 * input)`. Builds the request from the task's registered definition and
 * tries providers in order — optional decision model, then primary, then
 * the explicit fallback if the user enabled one — validating the result
 * against the task's output schema with one repair retry before giving up.
 *
 * A decision-model attempt discards *any* failure (error, invalid output,
 * low confidence) and falls through to primary silently — both are
 * connections the user configured for this purpose (§13.15.9). A primary or
 * fallback attempt only advances to the next provider on an
 * availability-class error (§13.15.10); a schema-validation failure or
 * cancellation stops immediately and is never treated as a signal to try
 * another provider.
 *
 * With AI mode Off (`isEnabled` false) every run is refused before any
 * provider is resolved, so no AI network request can be made (PRD §6.6).
 * Text-output tasks may stream: `onText` receives the accumulated text for a
 * preview only — the returned result is still the validated final output.
 */
import { AIError, isAvailabilityError } from "./errors";
import type { AIProviderManager } from "./providerManager";
import type { AITask, TaskDefinition, TaskRegistry, TaskRoutingPolicy } from "./tasks";
import { getTaskRegistry } from "./tasks";
import { getAIProviderManager } from "./providerManager";
import { getAIMode } from "./aiMode";
import { getAIUsageRepository } from "./usage/usageRepository";
import { getCallLog, noteOf, type CallRecord } from "./usage/callLog";
import type { AIProvider, AIRequest, AIResponse, AIUsage } from "./types";
import type { DecisionAnswer, DecisionRequest, DecisionTask } from "./decisions/types";

export interface RunOptions {
  signal?: AbortSignal;
  /**
   * Streams a `text`-format task when the serving provider supports it,
   * called with the text so far. Preview only: never write it into domain
   * or canvas state (PRD §8) — use the resolved result.
   */
  onText?: (textSoFar: string) => void;
}

export type ProviderRole = "decision" | "primary" | "fallback";

/** Thrown (as `AIError("model_unavailable", ...)`) only when there is no primary and no fallback at all — never for an actual provider's own failure. */
export const NO_PROVIDER_CONFIGURED_MESSAGE = "No AI provider is configured.";

export interface AIRuntimeResult<TOut> {
  data: TOut;
  usage: AIUsage;
  /** Which provider actually served the request — the role drives "used fallback" UI copy (§13.15.10). */
  providerId: string;
  role: ProviderRole;
}

export interface AIRuntime {
  run<TIn, TOut>(task: AITask, input: TIn, opts?: RunOptions): Promise<AIRuntimeResult<TOut>>;
  /**
   * A decision-shaped task: answered by the user's typed decision model when they enabled one, otherwise — or when it fails,
   * is unsure or can't express the question — by the chat task it replaces (`run`), so nobody is left without an answer.
   */
  decide<TIn, TOut>(def: DecisionTask<TIn, TOut>, input: TIn, opts?: RunOptions): Promise<AIRuntimeResult<TOut>>;
}

interface AIRuntimeDeps {
  manager: AIProviderManager;
  registry: TaskRegistry;
  /** AI mode; defaults to always on (tests). */
  isEnabled?: () => boolean;
  /** Called with every provider response's usage, repair retries included. Must not throw. */
  onUsage?: (usage: AIUsage) => void;
  /** Called once per provider call with its stage, outcome and reported tokens (cost diagnostics). Must not throw. */
  onCall?: (call: Omit<CallRecord, "at">) => void;
  /** How many calls of tasks with `policy.limitConcurrency` run at once (default `DEFAULT_MAX_CONCURRENT`). */
  maxConcurrent?: number;
  /** Pauses before each retry of a rate-limited call of such a task, before the next provider is tried (default `DEFAULT_RATE_LIMIT_BACKOFF_MS`). */
  rateLimitBackoffMs?: readonly number[];
}

/** A document fans out into one call per section; this many at once keeps a provider's rate limits from failing the rest. */
export const DEFAULT_MAX_CONCURRENT = 6;
export const DEFAULT_RATE_LIMIT_BACKOFF_MS: readonly number[] = [2_000, 5_000];

/** A counting semaphore: `acquire` resolves with a `release` once fewer than `max` are held; a cancelled wait rejects. */
function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  return {
    acquire(signal?: AbortSignal): Promise<() => void> {
      throwIfAborted(signal);
      if (active < max) {
        active++;
        return Promise.resolve(release);
      }
      return new Promise((resolve, reject) => {
        const grant = () => {
          signal?.removeEventListener("abort", onAbort);
          resolve(release);
        };
        const onAbort = () => {
          const i = waiting.indexOf(grant);
          if (i >= 0) waiting.splice(i, 1);
          reject(new AIError("cancelled", "The AI request was cancelled."));
        };
        waiting.push(grant);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AIError("cancelled", "The AI request was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

interface Candidate {
  provider: AIProvider;
  role: ProviderRole;
}

export function createAIRuntime(deps: AIRuntimeDeps): AIRuntime {
  const limiter = createLimiter(Math.max(1, deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT));
  const backoff = deps.rateLimitBackoffMs ?? DEFAULT_RATE_LIMIT_BACKOFF_MS;

  /** One provider's attempt, holding a slot while it runs; a rate-limited one is retried after a pause (the slot is free meanwhile). */
  async function attemptLimited<TIn, TOut>(candidate: Candidate, def: TaskDefinition<TIn, TOut>, input: TIn, opts: RunOptions): Promise<AIRuntimeResult<TOut>> {
    for (let retry = 0; ; retry++) {
      const queuedAt = Date.now();
      const release = await limiter.acquire(opts.signal);
      const waited = Date.now() - queuedAt;
      if (waited > 250) console.info(`[acute-notes] AI: "${def.task}" waited ${waited}ms for a free slot (at most ${deps.maxConcurrent ?? DEFAULT_MAX_CONCURRENT} run at once)`);
      let pause = 0;
      try {
        return await attempt(candidate, def, input, opts, deps);
      } catch (err) {
        const delay = backoff[retry];
        if (!(err instanceof AIError && err.kind === "rate_limited") || delay === undefined) throw err;
        pause = delay;
        console.warn(`[acute-notes] AI: "${def.task}" was rate limited by ${candidate.provider.id}; retrying in ${delay}ms`);
      } finally {
        release();
      }
      await sleep(pause, opts.signal);
    }
  }

  const runtime: AIRuntime = {
    async run<TIn, TOut>(task: AITask, input: TIn, opts: RunOptions = {}): Promise<AIRuntimeResult<TOut>> {
      if (deps.isEnabled && !deps.isEnabled()) throw new AIError("disabled", "AI is turned off.");
      const def = deps.registry.get<TIn, TOut>(task);
      def.inputSchema.parse(input);
      throwIfAborted(opts.signal);

      const candidates = buildCandidates(deps.manager, def.policy);

      let lastError: unknown;
      for (const candidate of candidates) {
        throwIfAborted(opts.signal);
        try {
          return def.policy.limitConcurrency ? await attemptLimited(candidate, def, input, opts) : await attempt(candidate, def, input, opts, deps);
        } catch (err) {
          lastError = err;
          if (err instanceof AIError && err.kind === "cancelled") throw err;
          const decisionDiscardsAnyFailure = candidate.role === "decision";
          if (!decisionDiscardsAnyFailure && !isAvailabilityError(err)) throw err;
        }
      }
      throw lastError;
    },

    async decide<TIn, TOut>(def: DecisionTask<TIn, TOut>, input: TIn, opts: RunOptions = {}): Promise<AIRuntimeResult<TOut>> {
      if (deps.isEnabled && !deps.isEnabled()) throw new AIError("disabled", "AI is turned off.");
      const typed = deps.manager.getTypedDecisionProvider();
      if (typed) {
        try {
          const built = def.buildRequest(input);
          const requests = built === null ? [] : Array.isArray(built) ? built : [built as DecisionRequest];
          if (requests.length) {
            throwIfAborted(opts.signal);
            // One request, or several in parallel (their answers merged): a failure of any falls back to the chat task.
            const ask = async (request: DecisionRequest, attemptNo: 1 | 2) => {
              const startedAt = Date.now();
              const base = { task: def.fallbackTask, source: "decision" as const, role: "decision" as const, provider: typed.id, model: typed.model, attempt: attemptNo };
              try {
                const r = await typed.decide(request, { signal: opts.signal, timeoutMs: def.timeoutMs });
                emitCall(deps, { ...base, model: r.usage.model || typed.model, outcome: "ok", ...tokensOf(r.usage), ms: Date.now() - startedAt });
                return r;
              } catch (err) {
                emitCall(deps, { ...base, outcome: "error", error: err instanceof AIError ? err.kind : "error", ms: Date.now() - startedAt });
                throw err;
              }
            };
            const results = await Promise.all(requests.map((request) => ask(request, 1)));
            for (const r of results) deps.onUsage?.(r.usage);
            let answers = Object.assign({}, ...results.map((r) => r.answers)) as Record<string, DecisionAnswer>;
            // A second round, when the first answers call for one; its answers are merged in before the task reads them.
            const more = def.followUp?.(answers, input);
            const followUps = more ? (Array.isArray(more) ? more : [more as DecisionRequest]) : [];
            if (followUps.length) {
              throwIfAborted(opts.signal);
              const second = await Promise.all(followUps.map((request) => ask(request, 2)));
              for (const r of second) deps.onUsage?.(r.usage);
              results.push(...second);
              answers = Object.assign({}, answers, ...second.map((r) => r.answers)) as Record<string, DecisionAnswer>;
            }
            const promptTokens = results.reduce((n, r) => n + (r.usage.promptTokens ?? 0), 0);
            const usage = { ...results[0]!.usage, ...(promptTokens ? { promptTokens } : {}) };
            const data = def.interpret(answers, input);
            if (data !== null) return { data, usage, providerId: typed.id, role: "decision" };
            emitCall(deps, { task: def.fallbackTask, source: "decision", role: "decision", provider: typed.id, model: typed.model, attempt: 1, outcome: "unsure", ms: 0 });
            console.info(`[acute-notes] AI: the decision model (${typed.name}, ${typed.model}) wasn't sure about "${def.fallbackTask}"; asking the chat model instead`);
          }
        } catch (err) {
          if (err instanceof AIError && err.kind === "cancelled") throw err;
          if (err instanceof DOMException && err.name === "AbortError") throw err;
          console.warn(`[acute-notes] AI: the decision model (${typed.name}, ${typed.model}) failed for "${def.fallbackTask}" (${err instanceof AIError ? err.kind : "error"}); asking the chat model instead`);
        }
      }
      return runtime.run<TIn, TOut>(def.fallbackTask, input, opts);
    },
  };
  return runtime;
}

function buildCandidates(manager: AIProviderManager, policy: TaskRoutingPolicy): Candidate[] {
  const candidates: Candidate[] = [];
  if (policy.preferDecisionModel) {
    const decision = manager.getDecisionProvider();
    if (decision) candidates.push({ provider: decision, role: "decision" });
  }
  const primary = manager.getActiveProvider();
  if (primary) candidates.push({ provider: primary, role: "primary" });
  const fallback = manager.getFallbackProvider();
  if (fallback) candidates.push({ provider: fallback, role: "fallback" });

  if (candidates.length === 0) {
    throw new AIError("model_unavailable", NO_PROVIDER_CONFIGURED_MESSAGE);
  }
  return candidates;
}

async function attempt<TIn, TOut>(
  candidate: Candidate,
  def: TaskDefinition<TIn, TOut>,
  input: TIn,
  opts: RunOptions,
  deps: Pick<AIRuntimeDeps, "onUsage" | "onCall">,
): Promise<AIRuntimeResult<TOut>> {
  const call = async (promptInput: { input: TIn; repairFeedback?: string }, attemptNo: 1 | 2) => {
    const startedAt = Date.now();
    const note = noteOf(def.task, input);
    const base = { task: def.task, source: "chat" as const, role: candidate.role, provider: candidate.provider.id, attempt: attemptNo, ...(note ? { note } : {}) };
    let response: AIResponse;
    try {
      response = await callProvider(candidate.provider, def, promptInput, opts);
    } catch (err) {
      emitCall(deps, { ...base, model: "", outcome: "error", error: err instanceof AIError ? err.kind : "error", ms: Date.now() - startedAt });
      throw err;
    }
    deps.onUsage?.(response.usage);
    return { response, finish: (outcome: "ok" | "invalid") => emitCall(deps, { ...base, model: response.usage.model || response.model, outcome, ...tokensOf(response.usage), ms: Date.now() - startedAt }) };
  };
  const { response: first, finish: finishFirst } = await call({ input }, 1);
  const firstResult = def.outputSchema.safeParse(extractStructured(first, candidate.provider, def));
  finishFirst(firstResult.success ? "ok" : "invalid");
  if (firstResult.success) return toResult(candidate, first, firstResult.data);

  throwIfAborted(opts.signal);
  const { response: second, finish: finishSecond } = await call(
    {
      input,
      repairFeedback: `Your previous output was invalid: ${firstResult.error.message}. Return corrected JSON matching the schema exactly.`,
    },
    2,
  );
  const secondResult = def.outputSchema.safeParse(extractStructured(second, candidate.provider, def));
  finishSecond(secondResult.success ? "ok" : "invalid");
  if (secondResult.success) return toResult(candidate, second, secondResult.data);

  throw new AIError("invalid_output", `AI response for task "${def.task}" did not match its schema after one repair attempt.`);
}

async function callProvider<TIn, TOut>(
  provider: AIProvider,
  def: TaskDefinition<TIn, TOut>,
  promptInput: { input: TIn; repairFeedback?: string },
  opts: RunOptions,
): Promise<AIResponse> {
  const built = def.buildPrompt(promptInput);
  const text = def.outputFormat === "text";
  const request: AIRequest = {
    task: def.task,
    systemPrompt: built.systemPrompt,
    prompt: built.prompt,
    responseSchema: !text && provider.capabilities.structuredOutput !== "none" ? def.outputSchema : undefined,
    signal: opts.signal,
    ...(def.timeoutMs ? { timeoutMs: def.timeoutMs } : {}),
  };
  if (text && opts.onText && provider.stream && provider.capabilities.streaming) {
    return streamToResponse(provider, request, opts.onText);
  }
  return provider.generate(request);
}

/** Collects a stream into a response, reporting the text so far after each chunk. */
async function streamToResponse(
  provider: AIProvider,
  request: AIRequest,
  onText: (textSoFar: string) => void,
): Promise<AIResponse> {
  let text = "";
  for await (const chunk of provider.stream!(request)) {
    throwIfAborted(request.signal);
    if (chunk.delta) {
      text += chunk.delta;
      onText(text);
    }
  }
  throwIfAborted(request.signal);
  // Streams carry no usage report; the provider id is still recorded.
  const model = request.model ?? "";
  return { text, model, finishReason: "stop", usage: { provider: provider.id, model } };
}

function extractStructured(response: AIResponse, provider: AIProvider, def: Pick<TaskDefinition, "outputFormat">): unknown {
  if (def.outputFormat === "text") return response.text;
  if (response.structured !== undefined) return response.structured;
  if (provider.capabilities.structuredOutput === "none") return response.text;
  return parseJsonReply(response.text);
}

/**
 * The JSON object in a model's reply. JSON-mode models often wrap it despite instructions: in a ```json fence, or
 * after a sentence of prose ("I will visualize … as JSON:"), or before a closing remark. Tries, in order: the whole
 * text, each fenced block, and the outermost `{…}`; returns the text itself when none parses (the schema check then
 * reports it).
 */
export function parseJsonReply(text: string): unknown {
  const candidates = [text];
  for (const m of text.matchAll(/```(?:json|JSON)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/g)) candidates.push(m[1]!);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // next candidate
    }
  }
  return text;
}

function toResult<TOut>(candidate: Candidate, response: AIResponse, data: TOut): AIRuntimeResult<TOut> {
  return { data, usage: response.usage, providerId: candidate.provider.id, role: candidate.role };
}

const tokensOf = (u: AIUsage): Pick<CallRecord, "promptTokens" | "completionTokens" | "reasoningTokens"> => ({
  ...(u.promptTokens !== undefined ? { promptTokens: u.promptTokens } : {}),
  ...(u.completionTokens !== undefined ? { completionTokens: u.completionTokens } : {}),
  ...(u.reasoningTokens !== undefined ? { reasoningTokens: u.reasoningTokens } : {}),
});

/** A diagnostics hook never breaks a call. */
function emitCall(deps: Pick<AIRuntimeDeps, "onCall">, call: Omit<CallRecord, "at">): void {
  try {
    deps.onCall?.(call);
  } catch {
    // diagnostics only
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AIError("cancelled", "The AI request was cancelled.");
}

/** App-wide runtime, wired to the default provider manager and task registry. */
export const AIRuntime: AIRuntime = createAIRuntime({
  manager: getAIProviderManager(),
  registry: getTaskRegistry(),
  isEnabled: () => getAIMode() === "on",
  onUsage: (usage) => void getAIUsageRepository().record(usage).catch(() => undefined),
  onCall: (call) => getCallLog().record(call),
});
