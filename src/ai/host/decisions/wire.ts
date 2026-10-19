/**
 * The vendors' decision wire formats, as pure functions: our `DecisionRequest` → a vendor's request body, and a vendor's
 * response → our `DecisionAnswer`s. Each vendor's shapes were taken from its own reference (2026-10-08):
 * - Jev on OpenRouter — `POST https://openrouter.ai/api/alpha/decisions`, `typesafe/jev-1.13`
 *   (https://openrouter.ai/docs/guides/community/jev-tutorial); answers are keyed by question name.
 * - OpenAI — `POST https://api.openai.com/v1/decisions`, `gpt-6-luna`
 *   (https://developers.openai.com/api/reference/resources/decisions/methods/create); answers are an array of named answers.
 * A reply that isn't the shape the vendor documents is an `invalid_output` error, never a guess.
 */
import { AIError } from "@/ai/errors";
import type { AIUsage } from "@/ai/types";
import type { DecisionAnswer, DecisionQuestion, DecisionRequest, DecisionResult, DecisionVendor } from "@/ai/decisions/types";

export const DECISION_ENDPOINTS: Readonly<Record<string, string>> = {
  jev: "https://openrouter.ai/api/alpha/decisions",
  openai: "https://api.openai.com/v1/decisions",
};

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bad = (vendor: DecisionVendor, why: string) => new AIError("invalid_output", `The ${vendor} decision reply wasn't in the documented shape (${why}).`);

// ---- requests ---------------------------------------------------------------------------------------------------

function jevQuestion(q: DecisionQuestion): Json {
  if (q.type === "boolean") return { type: "noul", instructions: q.instructions, criteria: { true: q.whenTrue ?? "The statement is true.", false: q.whenFalse ?? "The statement is not true." } };
  if (q.type === "choice") return { type: "choice", instructions: q.instructions, criteria: Object.fromEntries(q.choices.map((c) => [c.value, c.description ?? c.value])) };
  return { type: "score", instructions: q.instructions, criteria: q.levels.map((l) => l.description ?? l.label) };
}

export function jevRequestBody(model: string, request: DecisionRequest): Json {
  const state = typeof request.state === "string" ? { text: request.state } : request.state;
  return { model, state, questions: Object.fromEntries(Object.entries(request.questions).map(([name, q]) => [name, jevQuestion(q)])) };
}

function openaiQuestion(name: string, q: DecisionQuestion): Json {
  if (q.type === "boolean") return { type: "predicate", name, instructions: q.instructions };
  if (q.type === "choice") return { type: "choice", name, instructions: q.instructions, choices: q.choices.map((c) => ({ value: c.value, ...(c.description ? { description: c.description } : {}) })) };
  return { type: "score", name, instructions: q.instructions, levels: q.levels.map((l) => ({ label: l.label, ...(l.description ? { description: l.description } : {}) })) };
}

export function openaiRequestBody(model: string, request: DecisionRequest): Json {
  const input = typeof request.state === "string" ? request.state : JSON.stringify(request.state);
  return { model, input, questions: Object.entries(request.questions).map(([name, q]) => openaiQuestion(name, q)) };
}

export function requestBody(vendor: DecisionVendor, model: string, request: DecisionRequest): Json {
  return vendor === "jev" ? jevRequestBody(model, request) : openaiRequestBody(model, request);
}

// ---- responses --------------------------------------------------------------------------------------------------

function jevAnswer(a: unknown): DecisionAnswer | null {
  if (!isObject(a)) return null;
  if (a.type === "noul") {
    const p = num(a.noul);
    return p === null ? null : { type: "boolean", probability: p };
  }
  if (a.type === "choice" && typeof a.choice === "string" && isObject(a.probabilities)) {
    const probabilities = Object.fromEntries(Object.entries(a.probabilities).flatMap(([k, v]) => (num(v) === null ? [] : [[k, v as number]])));
    return { type: "choice", choice: a.choice, confidence: num(a.confidence) ?? 0, probabilities };
  }
  if (a.type === "score" && num(a.score) !== null && isObject(a.probabilities)) {
    const probabilities = Object.entries(a.probabilities)
      .sort(([x], [y]) => Number(x) - Number(y))
      .map(([, v]) => num(v) ?? 0);
    return { type: "score", score: a.score as number, confidence: num(a.confidence) ?? 0, probabilities };
  }
  return null;
}

function openaiAnswer(a: unknown): { name: string; answer: DecisionAnswer } | null {
  if (!isObject(a) || typeof a.name !== "string") return null;
  if (a.type === "refusal") return { name: a.name, answer: { type: "refusal" } };
  if (a.type === "predicate" && num(a.probability) !== null) return { name: a.name, answer: { type: "boolean", probability: a.probability as number } };
  if (a.type === "choice" && typeof a.choice === "string" && Array.isArray(a.probabilities)) {
    const probabilities = Object.fromEntries(a.probabilities.flatMap((p) => (isObject(p) && typeof p.value === "string" && num(p.probability) !== null ? [[p.value, p.probability as number]] : [])));
    return { name: a.name, answer: { type: "choice", choice: a.choice, confidence: num(a.confidence) ?? 0, probabilities } };
  }
  if (a.type === "score" && num(a.score) !== null && Array.isArray(a.probabilities)) {
    const probabilities = [...a.probabilities]
      .flatMap((p) => (isObject(p) && num(p.value) !== null && num(p.probability) !== null ? [{ i: p.value as number, p: p.probability as number }] : []))
      .sort((x, y) => x.i - y.i)
      .map((x) => x.p);
    return { name: a.name, answer: { type: "score", score: a.score as number, confidence: num(a.confidence) ?? 0, probabilities } };
  }
  return null;
}

function usageOf(vendor: DecisionVendor, model: string, usage: unknown): AIUsage {
  const u = isObject(usage) ? usage : {};
  const reasoning = isObject(u.output_tokens_details) ? num(u.output_tokens_details.reasoning_tokens) : null;
  return { provider: vendor === "jev" ? "openrouter" : "openai", model, ...(num(u.input_tokens) !== null ? { promptTokens: u.input_tokens as number } : {}), ...(num(u.output_tokens) !== null ? { completionTokens: u.output_tokens as number } : {}), ...(reasoning !== null ? { reasoningTokens: reasoning } : {}) };
}

/** The answers in a vendor's reply (a question the vendor didn't answer, or answered in an unknown shape, is simply absent). */
export function parseDecisionResponse(vendor: DecisionVendor, model: string, body: unknown): DecisionResult {
  if (!isObject(body)) throw bad(vendor, "not an object");
  const answers: Record<string, DecisionAnswer> = {};
  if (vendor === "jev") {
    if (!isObject(body.answers)) throw bad(vendor, "no answers");
    for (const [name, raw] of Object.entries(body.answers)) {
      const a = jevAnswer(raw);
      if (a) answers[name] = a;
    }
  } else {
    if (!Array.isArray(body.answers)) throw bad(vendor, "no answers");
    for (const raw of body.answers) {
      const a = openaiAnswer(raw);
      if (a) answers[a.name] = a.answer;
    }
  }
  return { answers, usage: usageOf(vendor, typeof body.model === "string" ? body.model : model, body.usage) };
}
