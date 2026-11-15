/**
 * Plan §12.23: the one contradiction the screen excluded in the unseen3 recording (w31), pinned as regression evidence
 * (`evaluation/update-engine/consistency/regressions-unseen3.json`) with the counter-cases that must not move.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JudgeBudget } from "./candidates";
import { buildJudgePrompt, combine, JUDGE_BUDGET, JUDGE_CALL_CEILING, JUDGE_LIMITS, type JudgeAnswer } from "./judge";
import { judgePair } from "./rules";
import { judgementForCombine, screenPair, valuesCompared } from "./screen";

const FILE = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency/regressions-unseen3.json");
const pairs = (JSON.parse(readFileSync(FILE, "utf8")) as { pairs: { id: string; a: string; b: string; truth: string; expectedDecision: string; expectedScoped: boolean; recordedAI?: JudgeAnswer }[] }).pairs;

describe("§12.23 — regressions from the third unseen set", () => {
  it("w31: a vacuous 'the values agree' (nothing of the same kind compared) no longer excludes a contradiction", () => {
    const w31 = pairs.find((p) => p.id === "w31")!;
    expect(judgePair(w31.a, w31.b).reason).toBe("the values agree"); // the rules are unchanged…
    expect(valuesCompared(w31.a, w31.b)).toBe(false); // …but they compared nothing
    expect(screenPair(w31.a, w31.b).decision).toBe(w31.expectedDecision);
  });

  it("every pinned pair reaches its intended decision", () => {
    for (const p of pairs) expect(screenPair(p.a, p.b).decision, p.id).toBe(p.expectedDecision);
  });

  it("counter-case: values of the same kind that really agree are still excluded", () => {
    const a = "The nightly backup keeps 30 days of snapshots.";
    const b = "Snapshots from the nightly backup are kept for 30 days.";
    expect(valuesCompared(a, b)).toBe(true);
    const s = screenPair(a, b);
    if (judgePair(a, b).reason === "the values agree") expect(s).toMatchObject({ decision: "excluded", exclusion: "values_agree" });
    else expect(s.decision).not.toBe("rule_conflict");
  });

  it("counter-case: a value inside a stated maximum is still excluded as agreeing", () => {
    const a = "Each workspace can hold at most 500 boards.";
    const b = "Our workspace holds 120 boards.";
    expect(valuesCompared(a, b)).toBe(true);
    expect(screenPair(a, b)).toMatchObject({ decision: "excluded", exclusion: "values_agree" });
  });
});

describe("§12.24 — the context guard needs positive evidence of a different context", () => {
  const p = (id: string) => pairs.find((x) => x.id === id)!;

  it("every pinned pair has its intended scope", () => {
    for (const x of pairs) expect(screenPair(x.a, x.b).scoped, x.id).toBe(x.expectedScoped);
  });

  it("w32 / w40 / w44: the recorded 'contradicts' is no longer held back; w38 (a real time scope) still is", () => {
    for (const id of ["w32", "w40", "w44"]) expect(combine(judgementForCombine(screenPair(p(id).a, p(id).b)), { answer: "contradicts" }).shown, id).toBe("likely");
    expect(combine(judgementForCombine(screenPair(p("w38").a, p("w38").b)), { answer: "contradicts" }).shown).toBe("possible");
  });

  it("replaying the recorded answers on the pinned pairs promotes no compatible pair", () => {
    for (const x of pairs.filter((q) => q.truth !== "contradiction" && q.recordedAI)) expect(combine(judgementForCombine(screenPair(x.a, x.b)), { answer: x.recordedAI! }).shown, x.id).not.toBe("likely");
  });

  it("genuine context differences stay scoped (counter-cases from dev and the earlier sets)", () => {
    const scoped: [string, string][] = [
      ["In 2023 the API allowed 100 requests per minute.", "The API allows 500 requests per minute."],
      ["Before the migration, deploys took 40 minutes.", "Deploys take 10 minutes."],
      ["Until March, retries happened five times.", "Retries happen three times."],
      ["Version 1 used a 30 second timeout.", "The timeout is 10 seconds."],
      ["Last quarter the team had four engineers.", "The team has six engineers."],
      ["In the test environment, the loyalty points job runs every hour.", "The loyalty points job runs nightly."],
      ["In staging, retries happen five times.", "Retries happen three times."],
      ["On local, the cache holds 100 entries.", "The cache holds 500 entries."],
      ["Retries happen five times in the local environment.", "Retries happen three times."],
      ["The dental practice's new-patient fee was raised to £60 in January.", "New patients at the dental practice pay £45."],
    ];
    for (const [a, b] of scoped) expect(screenPair(a, b).scoped, a).toBe(true);
  });

  it("not a context: a shared time, a precondition, an everyday word that names an environment", () => {
    expect(screenPair("Since 2024, the club's juniors train on Tuesdays.", "Since 2024, the club's juniors have trained on Thursdays.").scoped).toBe(false);
    expect(screenPair("Staff must complete training before they start a shift.", "Completing the training is optional; staff can start a shift without it.").scoped).toBe(false);
    expect(screenPair("The bakery sells only to local cafes.", "The bakery also supplies a supermarket chain.").scoped).toBe(false);
    expect(screenPair("The main stage closes at 11 p.m.", "The main stage stays open past midnight.").scoped).toBe(false);
  });

  it("the non-exclusive swap protection is unchanged: a swapped value with nothing saying only one holds stays possible", () => {
    const pairs: [string, string][] = [
      ["The team uses PostgreSQL.", "The team uses MongoDB."],
      ["Alerts go to the ops channel.", "Alerts go to the oncall channel."],
    ];
    for (const [a, b] of pairs) {
      const s = screenPair(a, b);
      // The preconditions are asserted, so this can't pass vacuously (review finding).
      expect([s.decision, s.exclusive, s.scoped], a).toEqual(["forward", false, false]);
      expect(combine(judgementForCombine(s), { answer: "contradicts" }).shown, a).toBe("possible");
    }
    expect(combine({ verdict: "possible", kind: "value", reason: "x" }, { answer: "contradicts" }).shown).toBe("possible");
  });
});

describe("§12.24 review — time scopes need positive evidence, and are never grounds to exclude", () => {
  it("two different dates or periods for the same claim are forwarded to the AI and held for the user, never excluded", () => {
    const pairs: [string, string][] = [
      ["The contract was signed in 2023.", "The contract was signed in 2024."],
      ["The audit happens in March.", "The audit happens in June."],
      ["Launch is planned for Q3.", "Launch is planned for Q4."],
      ["The release was delayed to Q3.", "The release shipped on time in Q2."],
      ["The 2024 budget was approved by the board.", "The 2024 budget was rejected by the board in March."],
    ];
    for (const [a, b] of pairs) {
      const s = screenPair(a, b);
      expect(s.decision, a).not.toBe("excluded");
      if (s.decision === "forward") expect(combine(judgementForCombine(s), { answer: "contradicts" }).shown, a).not.toBe("hidden");
    }
  });

  it("a scope stated on both sides of another kind is still excluded (staging / production, UK / Ireland)", () => {
    expect(screenPair("In staging, retries happen five times.", "In production, retries happen three times.")).toMatchObject({ decision: "excluded", exclusion: "different_scope" });
    expect(screenPair("The smart-home thermostat is sold in the UK for £149.", "In Ireland the smart-home thermostat costs €179.")).toMatchObject({ decision: "excluded", exclusion: "different_scope" });
  });

  it("scoped: one-sided environments, countries and leading periods", () => {
    const scoped: [string, string][] = [
      ["During testing, uploads are capped at 5 MB.", "Uploads are capped at 50 MB."],
      ["Locally, uploads are capped at 5 MB.", "Uploads are capped at 50 MB."],
      ["In Germany the delivery fee is €8.", "The delivery fee is £5."],
      ["During the pilot, onboarding took two weeks.", "Onboarding takes three days."],
    ];
    for (const [a, b] of scoped) expect(screenPair(a, b).scoped, a).toBe(true);
  });

  it("not scoped: the past tense alone, a present anchor, a period or a schedule inside the claim, a closing time", () => {
    const not: [string, string][] = [
      ["The limit was set to 10 uploads per day.", "The limit is 20 uploads per day."],
      ["Since the 2024 change, juniors train on Tuesdays.", "Juniors train on Thursdays."],
      ["As of 2024, juniors train on Tuesdays.", "Juniors train on Thursdays."],
      ["Employees can carry over at most 5 unused leave days into the next year.", "Employees may carry up to 10 unused leave days into the following year."],
      ["The library audits its shelves once a year, in August.", "The library's shelf audits happen every January and July."],
      ["The desk is staffed until 7 p.m.", "The desk closes at 5 p.m."],
    ];
    for (const [a, b] of not) expect(screenPair(a, b).scoped, a).toBe(false);
  });
});

describe("§12.24 — the judge prompt's context rule (w73, w80)", () => {
  const prompt = buildJudgePrompt({ pairs: [{ ref: "p1", a: { sentence: "A." }, b: { sentence: "B." } }] });

  it("drops the old preference for 'compatible_context' when only one side names a context", () => {
    expect(prompt).not.toMatch(/if one statement names a context the other doesn't, prefer/);
  });

  it("asks for positive evidence, reads present-time words as one time, keeps universals, and says 'unclear' when unsure", () => {
    expect(prompt).toMatch(/only when the statements themselves give positive evidence of a material difference in scope, time, subject or environment/);
    expect(prompt).toMatch(/"Currently", "now", "today", "as of this month" and "since <a past change>" all describe the present/);
    expect(prompt).toMatch(/makes an exception for some of those cases contradicts it, unless the universal statement itself allows that exception/);
    expect(prompt).toMatch(/Required vs optional for the same action under the same policy cannot both hold/);
    expect(prompt).toMatch(/If you are not sure whether the contexts differ, answer "unclear", never "contradicts"/);
    // The non-exclusive swap rule is kept word for word.
    expect(prompt).toMatch(/Do not infer exclusivity solely from different named values/);
  });
});

describe("§12.24 — the per-call token ceiling is stated and enforced", () => {
  it("is 2,800: the input cap + a full answer + the reasoning reserve", () => {
    expect(JUDGE_CALL_CEILING).toBe(JUDGE_LIMITS.inputTokens + JUDGE_LIMITS.pairs * JUDGE_BUDGET.answerTokensPerPair + JUDGE_BUDGET.reasoningTokens);
    expect(JUDGE_CALL_CEILING).toBe(2_800);
  });

  it("refuses a reservation above it, retries included, without spending a call or tokens", () => {
    const budget = new JudgeBudget({ now: () => 0 });
    expect(budget.reserve("rev:1", JUDGE_CALL_CEILING + 1)).toEqual({ ok: false, reason: "over_call_limit" });
    expect(budget.reserve("rev:1", JUDGE_CALL_CEILING + 1, { retry: true })).toEqual({ ok: false, reason: "over_call_limit" });
    expect(budget.reserve("rev:1", Number.NaN)).toEqual({ ok: false, reason: "over_call_limit" });
    expect(budget.reserve("rev:1", JUDGE_CALL_CEILING)).toMatchObject({ ok: true });
    expect(budget.state().used).toBe(1);
    expect(budget.state().tokens).toBe(JUDGE_CALL_CEILING);
  });

  it("the daily token cap stays 90,000: 32 calls at the ceiling, never a 33rd", () => {
    const budget = new JudgeBudget({ now: () => 0 });
    let ok = 0;
    for (let i = 0; i < 40; i++) if (budget.reserve(`rev:${i}`, JUDGE_CALL_CEILING).ok) ok++;
    expect(ok).toBe(32);
  });
});
