import { describe, expect, it } from "vitest";
import { AIError } from "@/ai/errors";
import type { DecisionRequest } from "@/ai/decisions/types";
import { jevRequestBody, openaiRequestBody, parseDecisionResponse } from "./wire";

const request: DecisionRequest = {
  state: { ticket: "Checkout is blank after Pay" },
  questions: {
    is_bug: { type: "boolean", instructions: "Is it a defect?", whenTrue: "Broken behaviour", whenFalse: "A question" },
    team: { type: "choice", instructions: "Which team?", choices: [{ value: "payments", description: "Checkout and billing" }, { value: "frontend" }] },
    urgency: { type: "score", instructions: "How urgent?", levels: [{ label: "Later" }, { label: "Now", description: "Blocking revenue" }] },
  },
};

describe("requests", () => {
  it("Jev: a boolean is a noul with its criteria, a choice's criteria are keyed by value, a score's are the ordered levels", () => {
    expect(jevRequestBody("typesafe/jev-1.13", request)).toEqual({
      model: "typesafe/jev-1.13",
      state: { ticket: "Checkout is blank after Pay" },
      questions: {
        is_bug: { type: "noul", instructions: "Is it a defect?", criteria: { true: "Broken behaviour", false: "A question" } },
        team: { type: "choice", instructions: "Which team?", criteria: { payments: "Checkout and billing", frontend: "frontend" } },
        urgency: { type: "score", instructions: "How urgent?", criteria: ["Later", "Blocking revenue"] },
      },
    });
  });

  it("Jev: a text state is sent as an object", () => {
    expect(jevRequestBody("m", { state: "hello", questions: { q: request.questions.is_bug! } }).state).toEqual({ text: "hello" });
  });

  it("OpenAI: input is the state as text, questions are an array named by key, a boolean is a predicate", () => {
    expect(openaiRequestBody("gpt-6-luna", request)).toEqual({
      model: "gpt-6-luna",
      input: JSON.stringify({ ticket: "Checkout is blank after Pay" }),
      questions: [
        { type: "predicate", name: "is_bug", instructions: "Is it a defect?" },
        { type: "choice", name: "team", instructions: "Which team?", choices: [{ value: "payments", description: "Checkout and billing" }, { value: "frontend" }] },
        { type: "score", name: "urgency", instructions: "How urgent?", levels: [{ label: "Later" }, { label: "Now", description: "Blocking revenue" }] },
      ],
    });
  });
});

describe("responses", () => {
  it("Jev (the live reply of 2026-10-08): noul, choice and score answers, usage from input/output tokens", () => {
    const body = {
      model: "typesafe/jev-1.13-20260917",
      answers: {
        is_bug: { type: "noul", noul: 0.96 },
        team: { type: "choice", choice: "payments", probabilities: { account: 0, payments: 0.79, frontend: 0.21 }, confidence: 0.69 },
        urgency: { type: "score", score: 1.99, legend: {}, probabilities: { "0": 0, "1": 0.01, "2": 0.99 }, confidence: 0.98 },
      },
      usage: { input_tokens: 476, output_tokens: 70, cost: 0.000019992 },
    };
    expect(parseDecisionResponse("jev", "typesafe/jev-1.13", body)).toEqual({
      answers: {
        is_bug: { type: "boolean", probability: 0.96 },
        team: { type: "choice", choice: "payments", confidence: 0.69, probabilities: { account: 0, payments: 0.79, frontend: 0.21 } },
        urgency: { type: "score", score: 1.99, confidence: 0.98, probabilities: [0, 0.01, 0.99] },
      },
      usage: { provider: "openrouter", model: "typesafe/jev-1.13-20260917", promptTokens: 476, completionTokens: 70 },
    });
  });

  it("OpenAI: predicate, choice, score and a refusal, each by its name", () => {
    const body = {
      model: "gpt-6-luna",
      answers: [
        { type: "predicate", name: "is_bug", probability: 0.95 },
        { type: "choice", name: "team", choice: "payments", confidence: 0.7, probabilities: [{ value: "payments", probability: 0.8 }, { value: "frontend", probability: 0.2 }] },
        { type: "score", name: "urgency", score: 1.5, confidence: 0.9, probabilities: [{ label: "Now", value: 1, probability: 0.5 }, { label: "Later", value: 0, probability: 0.5 }] },
        { type: "refusal", name: "other" },
      ],
      usage: { input_tokens: 42, output_tokens: 0 },
    };
    const r = parseDecisionResponse("openai", "gpt-6-luna", body);
    expect(r.answers).toEqual({
      is_bug: { type: "boolean", probability: 0.95 },
      team: { type: "choice", choice: "payments", confidence: 0.7, probabilities: { payments: 0.8, frontend: 0.2 } },
      urgency: { type: "score", score: 1.5, confidence: 0.9, probabilities: [0.5, 0.5] },
      other: { type: "refusal" },
    });
    expect(r.usage).toEqual({ provider: "openai", model: "gpt-6-luna", promptTokens: 42, completionTokens: 0 });
  });

  it("an answer in an unknown shape is absent, and a reply that isn't the documented shape is an invalid_output error", () => {
    expect(parseDecisionResponse("jev", "m", { answers: { a: { type: "mystery" } } }).answers).toEqual({});
    for (const [vendor, body] of [["jev", "text"], ["jev", { answers: [] }], ["openai", { answers: {} }], ["openai", null]] as const) {
      expect(() => parseDecisionResponse(vendor, "m", body)).toThrow(AIError);
    }
  });
});
