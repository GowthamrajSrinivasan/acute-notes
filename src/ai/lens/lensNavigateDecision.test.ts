import { describe, expect, it } from "vitest";
import type { DecisionRequest } from "@/ai/decisions/types";
import { lensNavigateDecision, type LensNavigateInput } from "./lensTasks";

const nodes = [
  { key: "k.orders", label: "Orders", level: 1 },
  { key: "k.payments", label: "Payments", level: 1 },
  { key: "k.ledger", label: "Ledger", level: 2 },
];
const input: LensNavigateInput = { question: "where is money taken", nodes };
const choice = (value: string, confidence: number) => ({ type: "choice" as const, choice: value, confidence, probabilities: {} });

describe("lens_navigate as a typed decision", () => {
  it("asks which node the question starts from and which it ends at, over the keys Lens has plus a none option", () => {
    const request = lensNavigateDecision.buildRequest(input) as DecisionRequest;
    expect(request.state).toEqual({ question: "where is money taken" });
    expect(Object.keys(request.questions)).toEqual(["from", "to"]);
    const from = request.questions.from!;
    expect(from.type === "choice" && from.choices.map((c) => c.value)).toEqual(["k.orders", "k.payments", "k.ledger", "__none__"]);
    expect(lensNavigateDecision.fallbackTask).toBe("lens_navigate");
  });

  it("can't be asked with fewer than two or more than 254 nodes: the chat task answers", () => {
    expect(lensNavigateDecision.buildRequest({ question: "q", nodes: nodes.slice(0, 1) })).toBeNull();
    const many = Array.from({ length: 255 }, (_, i) => ({ key: `k${i}`, label: `Node ${i}`, level: 1 }));
    expect(lensNavigateDecision.buildRequest({ question: "q", nodes: many })).toBeNull();
  });

  it("reads the answers: a confident from (and to), none as 'no node fits', and nothing when unsure or off the list", () => {
    expect(lensNavigateDecision.interpret({ from: choice("k.payments", 0.9), to: choice("k.ledger", 0.8) }, input)).toEqual({ from: "k.payments", to: "k.ledger" });
    expect(lensNavigateDecision.interpret({ from: choice("k.payments", 0.9), to: choice("__none__", 0.9) }, input)).toEqual({ from: "k.payments", to: null });
    expect(lensNavigateDecision.interpret({ from: choice("k.payments", 0.9), to: choice("k.payments", 0.9) }, input)).toEqual({ from: "k.payments", to: null });
    expect(lensNavigateDecision.interpret({ from: choice("k.payments", 0.9), to: choice("k.ledger", 0.3) }, input)).toEqual({ from: "k.payments", to: null });
    expect(lensNavigateDecision.interpret({ from: choice("__none__", 0.9) }, input)).toEqual({ from: null, to: null });
    expect(lensNavigateDecision.interpret({ from: choice("k.payments", 0.3) }, input)).toBeNull();
    expect(lensNavigateDecision.interpret({ from: choice("invented", 0.99) }, input)).toBeNull();
    expect(lensNavigateDecision.interpret({}, input)).toBeNull();
  });
});
