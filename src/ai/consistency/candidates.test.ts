/**
 * §12.15 near-miss routing (offline): which pairs reach the AI tier, in what order, within what budget. The probes here
 * were written together with the near-miss rules, so they show intent — not independent evidence (that needs a new,
 * unseen set).
 */
import { describe, expect, it } from "vitest";
import { JUDGE_BUDGET, JUDGE_LIMITS } from "./judge";
import { DAILY_CALL_CAP, DAILY_TOKEN_CAP, JudgeBudget, planForChange, priorityOf, rankCandidates, routeOf, type Candidate } from "./candidates";
import { judgePair } from "./rules";

const route = (a: string, b: string) => {
  const j = judgePair(a, b);
  return `${routeOf(j)}${j.contextDiffers ? "+ctx" : ""}`;
};

describe("§12.15 — near-misses reach the AI; definite compatibles don't", () => {
  it("the two known misses are near-misses", () => {
    expect(route("Releases ship every two weeks.", "Releases ship every week.")).toBe("near_miss");
    expect(route("Our worker retries three times before giving up.", "Retries happen five times.")).toBe("near_miss");
  });

  it.each([
    ["Backups run every day.", "Backups run every week."],
    ["Reports are generated twice a week.", "Reports are generated once a week."],
    ["The sync job runs hourly.", "The sync job runs daily."],
    ["Our importer retries three times when another process holds the file lock.", "Retries happen five times."],
    ["The API doesn't support pagination.", "Pagination is supported by the API."],
  ])("reaches the AI (near-miss, or already possible): %s / %s", (a, b) => expect(["near_miss", "possible"]).toContain(route(a, b)));

  it.each([
    ["Backups run every week.", "Backups run weekly."], // the same rate
    ["Weekly active users reached 3,000.", "Daily active users reached 900."], // different metrics
    ["Backups run every day.", "Reports are generated every week."], // different subjects
    ["The importer retries up to five times when a file is locked.", "The importer retries three times."], // inside the bound
    ["The importer retries three times when a file is locked.", "The exporter logs five times."], // different subjects
    ["Admins can't delete projects.", "Viewers can delete their own drafts."], // different subjects
    ["The worker retries three times before giving up.", "The worker retries three times."], // the values agree
    ["Search requests time out after 5 seconds when the index is cold.", "Upload requests time out after 60 seconds."],
  ])("excluded: %s / %s", (a, b) => expect(route(a, b)).toBe("excluded"));

  it("a context difference stays distinguishable: routed with its context flag, at the lowest priority", () => {
    const j = judgePair("In staging, backups run every day.", "Backups run every week.");
    expect([routeOf(j), j.contextDiffers, priorityOf(j)]).toEqual(["near_miss", true, 1]);
  });

  it("the near-miss flag never changes the rules' own verdict (live behaviour and rule metrics unchanged)", () => {
    expect(judgePair("Releases ship every two weeks.", "Releases ship every week.").verdict).toBe("compatible");
    // A frequency clash the value rules already catch stays a conflict — never weakened to a near-miss.
    expect(route("Reports are generated 3 times a week.", "Reports are generated 5 times a week.")).toBe("rule_conflict");
  });
});

const cand = (key: string, a: string, b: string): Candidate => ({ key, a: { sentence: a }, b: { sentence: b }, judgement: judgePair(a, b) });
/** Harmless context differences (priority 1) — plenty of them — and two likely contradictions at the end. */
const burst = (): Candidate[] => [
  ...Array.from({ length: 12 }, (_, i) => cand(`ctx${i}`, `In staging, job ${i} retries five times.`, `Job ${i} retries three times.`)),
  cand("swap", "The payments team owns the gateway.", "The platform team owns the gateway."),
  cand("near", "Releases ship every two weeks.", "Releases ship every week."),
  cand("compatible", "Deploys take 10 minutes.", "Timeouts last ten seconds."),
];

describe("§12.15 — priority and budget", () => {
  it("likely contradictions first: the 10-pair cap is never spent on harmless context differences while they wait", () => {
    const ranked = rankCandidates(burst());
    expect(ranked.slice(0, 2).map((c) => c.key)).toEqual(["near", "swap"]);
    expect(ranked.map((c) => c.key)).not.toContain("compatible"); // excluded: not a candidate at all
    const plan = planForChange("change-1", burst(), new JudgeBudget({ now: () => 0 }), { aiEnabled: true });
    expect(plan.call!.keys.slice(0, 2)).toEqual(["near", "swap"]);
    expect(plan.call!.input.pairs.length).toBeLessThanOrEqual(JUDGE_LIMITS.pairs);
  });

  it("overflow is pending with a reason; every candidate is in exactly one place", () => {
    const plan = planForChange("change-1", burst(), new JudgeBudget({ now: () => 0 }), { aiEnabled: true });
    expect(plan.pending.length).toBe(4);
    expect(new Set(plan.pending.map((p) => p.reason))).toEqual(new Set(["over_call_limit"]));
    const all = [...plan.call!.keys, ...plan.pending.map((p) => p.key), ...plan.skipped.map((s) => s.key)];
    expect(all.sort()).toEqual(rankCandidates(burst()).map((c) => c.key).sort());
    expect(new Set(all).size).toBe(all.length);
  });

  it("a burst of accepted changes can't exceed the daily limits; the rest wait, with the reason", () => {
    const budget = new JudgeBudget({ now: () => Date.UTC(2026, 10, 13, 9) });
    const plans = Array.from({ length: DAILY_CALL_CAP + 10 }, (_, i) => planForChange(`c${i}`, burst(), budget, { aiEnabled: true }));
    const sent = plans.filter((p) => p.call);
    // §12.23: with the reasoning reserve a full call costs more than 1,800 tokens, so at the unchanged 90,000-token cap
    // the token limit binds before the 50-call limit (the spend ceiling is unchanged; fewer calls fit in a day).
    const perCall = sent[0]!.call!.tokens;
    expect(sent.length).toBe(Math.min(DAILY_CALL_CAP, Math.floor(DAILY_TOKEN_CAP / perCall)));
    expect(sent.reduce((s, p) => s + p.call!.tokens, 0)).toBeLessThanOrEqual(DAILY_TOKEN_CAP);
    const late = plans.at(-1)!;
    expect(late.call).toBeUndefined();
    expect(late.pending.some((p) => p.reason === "daily_cap" || p.reason === "daily_tokens")).toBe(true);
  });

  it("one call per change: the same change again waits; the next day the budget is fresh", () => {
    let t = Date.UTC(2026, 10, 13, 9);
    const budget = new JudgeBudget({ now: () => t });
    expect(planForChange("c1", burst(), budget, { aiEnabled: true }).call).toBeDefined();
    expect(planForChange("c1", burst(), budget, { aiEnabled: true }).pending.some((p) => p.reason === "change_already_checked")).toBe(true);
    t += 24 * 3600 * 1000;
    expect(budget.remaining()).toBe(DAILY_CALL_CAP);
  });

  it("with the AI check off (the default) every candidate is skipped with the reason — none silently dropped", () => {
    const plan = planForChange("c1", burst(), new JudgeBudget(), { aiEnabled: false });
    expect(plan.call).toBeUndefined();
    expect(plan.skipped.length).toBe(rankCandidates(burst()).length);
    expect(new Set(plan.skipped.map((s) => s.reason))).toEqual(new Set(["ai_check_off"]));
  });

  it("the budget state survives a reload (persisted by the caller)", () => {
    const now = () => Date.UTC(2026, 10, 13, 9);
    const a = new JudgeBudget({ now, dailyCap: 2 });
    a.reserve("rev:1", 100);
    const b = new JudgeBudget({ now, dailyCap: 2, state: a.state() });
    expect(b.reserve("rev:1", 100)).toEqual({ ok: false, reason: "change_already_checked" });
    expect(b.reserve("rev:2", 100)).toMatchObject({ ok: true });
    expect(b.reserve("rev:3", 100)).toEqual({ ok: false, reason: "daily_cap" });
    expect(b.state().tokens).toBe(200);
  });

  it("calls, tokens and pairs are separate limits: a token cap stops calls the call cap would still allow", () => {
    const budget = new JudgeBudget({ now: () => 0, dailyCap: 50, dailyTokens: 3_000 });
    const plans = Array.from({ length: 5 }, (_, i) => planForChange(`rev:${i}`, burst(), budget, { aiEnabled: true }));
    const sent = plans.filter((p) => p.call);
    expect(sent.length).toBeLessThan(5);
    expect(sent.reduce((s, p) => s + p.call!.tokens, 0)).toBeLessThanOrEqual(3_000);
    expect(plans.at(-1)!.pending.some((p) => p.reason === "daily_tokens")).toBe(true);
    for (const p of sent) expect(p.call!.tokens).toBeLessThanOrEqual(JUDGE_LIMITS.inputTokens + JUDGE_LIMITS.pairs * JUDGE_BUDGET.answerTokensPerPair + JUDGE_BUDGET.reasoningTokens);
    expect(budget.remaining()).toBe(50 - sent.length); // the call cap alone would have allowed them
  });

  it("accounting with the defaults: 50 worst-case calls reserve exactly 90,000, so the call cap binds first; settling releases only what wasn't used", () => {
    const budget = new JudgeBudget({ now: () => 0 });
    const ids: string[] = [];
    for (let i = 0; i < DAILY_CALL_CAP; i++) {
      const r = budget.reserve(`rev:${i}`, JUDGE_LIMITS.totalTokens);
      expect(r.ok).toBe(true);
      if (r.ok) ids.push(r.reservation);
    }
    expect(budget.state().tokens).toBe(90_000);
    expect(budget.reserve("rev:x", 1)).toEqual({ ok: false, reason: "daily_cap" }); // calls, not tokens, at the defaults
    budget.settle(ids[0]!, 1_200); // used 1,200 of 1,800
    expect(budget.state().tokens).toBe(90_000 - 600);
    budget.settle(ids[0]!, 0); // a second settle is ignored
    expect(budget.state().tokens).toBe(90_000 - 600);
    budget.settle(ids[1]!, null); // failed / no usage: the whole reservation stays
    budget.settle(ids[2]!, 5_000); // reported more than reserved: the overage is charged (§12.24 review), never hidden
    expect(budget.state().tokens).toBe(90_000 - 600 + (5_000 - 1_800));
    expect(budget.remainingTokens()).toBe(0);
    expect(budget.remaining()).toBe(0); // a settled call still counts as a call
    expect(Object.keys(budget.state().open!).length).toBe(DAILY_CALL_CAP - 3);
  });

  it("a reservation from an earlier day is ignored when settled (that day's counts are gone)", () => {
    let t = Date.UTC(2026, 10, 13, 23);
    const budget = new JudgeBudget({ now: () => t });
    const r = budget.reserve("rev:1", 1_800);
    t += 3_600_000 * 2;
    budget.reserve("rev:2", 1_000);
    if (r.ok) budget.settle(r.reservation, 100);
    expect(budget.state().tokens).toBe(1_000);
  });

  it("an explicit Retry of the same revision is allowed (and still counted); the automatic path isn't", () => {
    const budget = new JudgeBudget({ now: () => 0 });
    expect(planForChange("rev:1", burst(), budget, { aiEnabled: true }).call).toBeDefined();
    expect(planForChange("rev:1", burst(), budget, { aiEnabled: true }).call).toBeUndefined();
    expect(planForChange("rev:1", burst(), budget, { aiEnabled: true, retry: true }).call).toBeDefined();
    expect(budget.remaining()).toBe(DAILY_CALL_CAP - 2);
  });

  it("'already judged' is per sentence-pair fingerprint: the same pair is skipped, a materially changed one is eligible again", () => {
    const judged = new Set(["A|B|h(every two weeks)|h(every week)"]);
    const near = { ...cand("near", "Releases ship every two weeks.", "Releases ship every week."), fingerprint: "A|B|h(every two weeks)|h(every week)" };
    const changed = { ...cand("near2", "Releases ship every three weeks.", "Releases ship every week."), fingerprint: "A|B|h(every three weeks)|h(every week)" };
    const plan = planForChange("rev:9", [near, changed], new JudgeBudget({ now: () => 0 }), { aiEnabled: true, judged: (f) => judged.has(f) });
    expect(plan.skipped).toEqual([{ key: "near", reason: "already_judged" }]);
    expect(plan.call!.keys).toEqual(["near2"]);
  });
});
