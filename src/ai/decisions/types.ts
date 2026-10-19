/**
 * Typed decisions: a dedicated decision model (a vendor's decisions API, e.g. TypeSafe's Jev on OpenRouter) is sent a state and
 * closed questions and answers each with a typed value and probabilities — no text, no JSON to parse or repair. These
 * are the vendor-neutral shapes; `wire.ts` maps them to each vendor's request and response. A decision model is
 * optional: a task that asks one always has the chat task it replaces to fall back on (`DecisionTask.fallbackTask`),
 * so a user without one is never blocked (see `AIRuntime.decide`).
 *
 * Plan and rationale: `.ai/docs/decision-models-plan.md`.
 */
import { z } from "zod";
import type { AITask } from "@/ai/tasks";
import type { AIUsage } from "@/ai/types";

/** Which vendor's decisions API a connection's key opens: an opaque id set in the registry and understood only by the AI host. */
export type DecisionVendor = string;

/** Closed questions only. (Vendors name a boolean differently, e.g. "noul" or "predicate"; the host maps it.) */
export type DecisionQuestion =
  | { type: "boolean"; instructions: string; whenTrue?: string; whenFalse?: string }
  | { type: "choice"; instructions: string; choices: readonly { value: string; description?: string }[] }
  | { type: "score"; instructions: string; levels: readonly { label: string; description?: string }[] };

export interface DecisionRequest {
  /** What the questions are about: text, or a JSON object. */
  state: string | Record<string, unknown>;
  /** Independent questions about the same state, answered in parallel, each by its own name. */
  questions: Record<string, DecisionQuestion>;
}

export type DecisionAnswer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  /** `score` is the probability-weighted position on the levels (0 = the first level); `probabilities` is per level. */
  | { type: "score"; score: number; confidence: number; probabilities: number[] }
  | { type: "refusal" };

export interface DecisionResult {
  answers: Record<string, DecisionAnswer>;
  usage: AIUsage;
}

export interface DecisionCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** A decision model ready to answer: one connection's key, one model. */
export interface DecisionProvider {
  /** The connection it belongs to ("openrouter", …). */
  id: string;
  name: string;
  model: string;
  decide(request: DecisionRequest, options?: DecisionCallOptions): Promise<DecisionResult>;
}

/**
 * A task a decision model can answer, with the chat task it replaces. `AIRuntime.decide` asks the decision model when the
 * user enabled one; when none is enabled, or it fails, is unsure, or can't express the question, the chat task answers.
 */
export interface DecisionTask<TIn, TOut> {
  /** The existing chat task with the same input and output: the fallback. */
  fallbackTask: AITask;
  /**
   * The questions for `input`; null when they can't be asked (too many choices, nothing to choose from): the fallback answers.
   * Several requests (one per item, say) are sent in parallel and their answers merged, so question names must be unique
   * across them.
   */
  buildRequest(input: TIn): DecisionRequest | readonly DecisionRequest[] | null;
  /**
   * A second round, asked after the first answers are in and only when they call for it (for example, which two sentences contradict,
   * once a part is known to contradict its topic): the requests to send, or null for none. Its answers are merged with the first
   * round's before `interpret`; question names must be unique across both rounds.
   */
  followUp?(answers: Record<string, DecisionAnswer>, input: TIn): DecisionRequest | readonly DecisionRequest[] | null;
  /** The task's output from the answers; null when they're unusable or not confident enough: the fallback answers. */
  interpret(answers: Record<string, DecisionAnswer>, input: TIn): TOut | null;
  /** How long the decision call may take before the fallback answers instead (default 20 s). */
  timeoutMs?: number;
}

const text = (max: number) => z.string().min(1).max(max);

export const decisionRequestSchema = z.object({
  state: z.union([z.string().max(200_000), z.record(z.string(), z.unknown())]),
  questions: z
    .record(
      z.string().min(1).max(64),
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("boolean"), instructions: text(4_000), whenTrue: text(1_000).optional(), whenFalse: text(1_000).optional() }),
        z.object({
          type: z.literal("choice"),
          instructions: text(4_000),
          choices: z.array(z.object({ value: text(200), description: text(1_000).optional() })).min(2).max(255),
        }),
        z.object({
          type: z.literal("score"),
          instructions: text(4_000),
          levels: z.array(z.object({ label: text(200), description: text(1_000).optional() })).min(2).max(20),
        }),
      ]),
    )
    .refine((q) => Object.keys(q).length >= 1 && Object.keys(q).length <= 8, "1 to 8 questions"),
});

/** The body the browser sends to the AI host's decide route (the key goes to the local host, as BYOK chat connections' does). */
export const decisionHostBodySchema = z.object({
  vendor: z.string().min(1).max(32),
  model: text(200),
  apiKey: z.string().min(1).max(500),
  request: decisionRequestSchema,
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
});
export type DecisionHostBody = z.infer<typeof decisionHostBodySchema>;
