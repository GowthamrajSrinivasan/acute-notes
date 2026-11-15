/**
 * Stage 4f (§12.3, §12.6, refinement C): the `judge_consistency` task's limits, and how its answer becomes what the user
 * is shown — evidence, never a decision; a context difference never becomes a definite conflict on the model's word.
 */
import { describe, expect, it } from "vitest";
import { getTaskRegistry } from "@/ai/tasks";
import { buildJudgePrompt, combine, estimateTokens, JUDGE_BUDGET, JUDGE_LIMITS, JUDGE_SYSTEM_PROMPT, judgeConsistencyTask, outputBudget, planCalls, type JudgeItem } from "./judge";
import { judgePair } from "./rules";

const item = (i: number, extra = ""): JudgeItem => ({ key: `elem_${i}_secret`, a: { sentence: `Retries happen ${i} times${extra}.`, card: "Limits" }, b: { sentence: `The worker retries ${i + 1} times${extra}.` } });

describe("Stage 4f — the judge_consistency task", () => {
  it("is registered, with a schema that accepts the four answers and refuses anything else", () => {
    expect(getTaskRegistry().has("judge_consistency")).toBe(true);
    const ok = judgeConsistencyTask.outputSchema.safeParse({ results: [{ ref: "p1", answer: "compatible_context", why: "staging vs production" }] });
    expect(ok.success).toBe(true);
    expect(judgeConsistencyTask.outputSchema.safeParse({ results: [{ ref: "p1", answer: "resolve_to_a" }] }).success).toBe(false);
  });

  it("a call: at most 10 pairs, inside the input budget, pairs by local reference only (no element ids)", () => {
    const { calls, skipped } = planCalls(Array.from({ length: 23 }, (_, i) => item(i)), 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input.pairs).toHaveLength(JUDGE_LIMITS.pairs);
    expect(skipped).toHaveLength(13); // left "possible, not checked by AI" (one call per accepted change)
    const prompt = buildJudgePrompt(calls[0]!.input);
    expect(prompt).not.toContain("elem_");
    expect(calls[0]!.input.pairs.map((p) => p.ref)).toEqual(Array.from({ length: 10 }, (_, i) => `p${i + 1}`));
    expect(estimateTokens(JUDGE_SYSTEM_PROMPT + prompt)).toBeLessThanOrEqual(JUDGE_LIMITS.inputTokens);
    // §12.23 fix B: the completion budget is the answer the pairs need plus a separate reasoning reserve.
    expect(outputBudget(calls[0]!.input)).toBe(10 * JUDGE_BUDGET.answerTokensPerPair + JUDGE_BUDGET.reasoningTokens);
  });

  it("§12.23 fix B: the budget no longer lets reasoning eat the answer — sized from the unseen3 recording", () => {
    // Recorded: a full 10-pair answer is ≈ 470 visible tokens (1,865 characters); the truncated call used all 966 tokens
    // of the old shared budget and stopped at pair 7 (≈ 400 visible, ≈ 560 reasoning).
    const ten = planCalls(Array.from({ length: 10 }, (_, i) => item(i)), 1).calls[0]!.input;
    expect(outputBudget(ten)).toBeGreaterThan(966);
    expect(10 * JUDGE_BUDGET.answerTokensPerPair).toBeGreaterThanOrEqual(Math.ceil(1_865 / 4));
    expect(JUDGE_BUDGET.reasoningTokens).toBeGreaterThanOrEqual(600);
    // A smaller call reserves less: the answer part scales with the pairs.
    const two = planCalls([item(0), item(1)], 1).calls[0]!.input;
    expect(outputBudget(two)).toBe(2 * JUDGE_BUDGET.answerTokensPerPair + JUDGE_BUDGET.reasoningTokens);
  });

  it("long pairs: fewer per call so the input budget holds; more calls only when allowed", () => {
    const long = Array.from({ length: 12 }, (_, i) => item(i, ` ${"in the primary region during the nightly maintenance window ".repeat(12)}`));
    const one = planCalls(long, 1);
    expect(one.calls[0]!.input.pairs.length).toBeLessThan(10);
    for (const c of planCalls(long, 5).calls) expect(estimateTokens(JUDGE_SYSTEM_PROMPT + buildJudgePrompt(c.input))).toBeLessThanOrEqual(JUDGE_LIMITS.inputTokens);
    expect(planCalls(long, 5).skipped).toEqual([]);
  });
});

describe("Stage 4f — rules + AI (combine)", () => {
  const ruleConflict = judgePair("Retries happen three times.", "The worker retries five times.");
  const contextPossible = judgePair("In staging, retries happen five times.", "Retries happen three times.");
  const swapPossible = judgePair("The payments team owns the gateway.", "The platform team owns the gateway.");

  it("the fixtures are what they claim", () => {
    expect([ruleConflict.verdict, contextPossible.verdict, contextPossible.contextDiffers, swapPossible.verdict, swapPossible.contextDiffers]).toEqual(["conflict", "possible", true, "possible", undefined]);
  });

  it("a rule conflict or a rule compatible is never changed by the model", () => {
    expect(combine(ruleConflict, { answer: "compatible" }).shown).toBe("conflict");
    expect(combine(judgePair("Deploys take 10 minutes.", "Timeouts last ten seconds."), { answer: "contradicts" }).shown).toBe("hidden");
  });

  it("a swapped value: likely only when a statement says only one can hold; otherwise the AI's reading stays possible (§12.19)", () => {
    // "owns" doesn't say only one team owns it: shared ownership, two databases, two alert channels can coexist.
    expect(swapPossible.exclusive).toBeUndefined();
    expect(combine(swapPossible, { answer: "contradicts", why: "two owners" }).shown).toBe("possible");
    expect(combine(swapPossible, { answer: "contradicts", why: "two owners" }).note).toContain("nothing says only one can hold");
    const sole = judgePair("The payments team is the sole owner of the gateway.", "The platform team is the sole owner of the gateway.");
    expect([sole.verdict, sole.exclusive]).toEqual(["possible", true]);
    expect(combine(sole, { answer: "contradicts", why: "two sole owners" })).toEqual({ shown: "likely", note: "AI: likely conflict: two sole owners" });
  });

  it("possible: compatible → hidden, kept as evidence; unclear / none → possible", () => {
    expect(combine(swapPossible, { answer: "compatible_context", why: "x" }).shown).toBe("hidden");
    expect(combine(swapPossible, { answer: "unclear" }).shown).toBe("possible");
    expect(combine(swapPossible).note).toContain("not checked by AI");
  });

  it("a context difference is never made a definite conflict on the model's word: it stays possible, with the model's reading", () => {
    const c = combine(contextPossible, { answer: "contradicts", why: "both about retries" });
    expect(c.shown).toBe("possible");
    expect(c.note).toContain("contexts differ");
  });
});
