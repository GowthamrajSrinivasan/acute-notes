/**
 * Which rule results may go to the AI tier, in what order, and within what budget (intelligent-update-engine-plan
 * §12.15, the 2026-11-13 near-miss refinement). Offline only: nothing in the app calls this yet, and Stage 4f stays off.
 *
 * Routes:
 * - `rule_conflict` — the rules are sure; shown as a conflict, never sent;
 * - `possible` — the rules' uncertainty route; sent;
 * - `near_miss` — the rules say compatible but saw the same subject with clashing values, frequencies or polarity; sent;
 * - `excluded` — a definite compatible (different subjects, a value inside the other's range, nothing found); never sent.
 *
 * Priority: likely contradictions before merely uncertain wording, so the 10-pair cap is never spent on harmless
 * ambiguity while a likely contradiction waits. Every candidate ends in exactly one place — the call, `pending` (with a
 * reason; a later Retry or allowance can take it) or `skipped` (with a reason) — never silently dropped.
 */
import { buildJudgePrompt, estimateTokens, JUDGE_CALL_CEILING, JUDGE_SYSTEM_PROMPT, outputBudget, planCalls, type JudgeInput, type JudgeItem } from "./judge";
import type { PairJudgement } from "./rules";

export type Route = "rule_conflict" | "possible" | "near_miss" | "excluded";

export function routeOf(j: PairJudgement): Route {
  if (j.verdict === "conflict") return "rule_conflict";
  if (j.verdict === "possible") return "possible";
  return j.nearMiss ? "near_miss" : "excluded";
}

/**
 * Higher first, from the rules' deterministic evidence (§12.19) — never from the route alone, never from any label:
 * - **incompatibility** — strong (clashing values or dates for the same subject, different frequencies, conflicting
 *   modality, a negation of the same claim, a swapped value where a statement says only one holds) 3; medium (a swapped
 *   value that may coexist, two different limits) 2; weak (too little context, changes without a baseline) 1;
 * - **the same claim** (the subject and the rest of the claim match) +1;
 * score = 2 × incompatibility + same claim, so 2–7. Anything whose context differs (staging / production, a past date…)
 * is 1: most likely two true facts. Excluded pairs and rule conflicts are not candidates (0).
 */
export function priorityOf(j: PairJudgement): number {
  const route = routeOf(j);
  if (route === "rule_conflict" || route === "excluded") return 0;
  if (j.contextDiffers) return 1;
  const e = j.evidence;
  const incompatibility = e?.incompatibility === "strong" ? 3 : e?.incompatibility === "medium" ? 2 : 1;
  return 2 * incompatibility + (e?.sameClaim ? 1 : 0);
}

export interface Candidate extends JudgeItem {
  judgement: PairJudgement;
  /**
   * The sentence pair's fingerprint (the conflict store's `pairId`: both cards and both sentence hashes). A pair the AI
   * already answered is skipped; a materially changed sentence is a new fingerprint, so it is eligible again.
   */
  fingerprint?: string;
  /** A priority computed by the caller (the §12.21 pipeline's `Screened.priority`); otherwise `priorityOf(judgement)`. */
  priority?: number;
}

/** The candidates in priority order (stable within a priority), excluded ones and rule conflicts left out. */
export function rankCandidates<T extends Candidate>(items: readonly T[]): T[] {
  return items
    .map((c, i) => ({ c, i, p: c.priority ?? priorityOf(c.judgement) }))
    .filter((x) => x.p > 0)
    .sort((x, y) => y.p - x.p || x.i - y.i)
    .map((x) => x.c);
}

export const DAILY_CALL_CAP = 50;
/**
 * Daily tokens (input + reserved output), independent of the call count (§12.6). Unchanged at 90,000 by the §12.23
 * budget fix: a typical full call reserves ≈ 2,300 tokens (measured on the unseen3 calls with the §12.24 prompt) and never more than `JUDGE_CALL_CEILING` (2,800), so about 39 typical full calls (32 at the ceiling) fit
 * in a day and this cap binds before the call cap. The spend ceiling is the same; raising it is a separate decision.
 */
export const DAILY_TOKEN_CAP = 90_000;

export interface BudgetState {
  /** The UTC day (YYYY-MM-DD) the counts are for. */
  day: string;
  /** Calls reserved today. */
  used: number;
  /** Tokens reserved today: each call's estimated input plus its whole output allowance (the most it can cost). */
  tokens: number;
  /** Committed revisions (`rev:…` ids — a content change is a new revision) that already had their one call today. */
  changes: string[];
  /** Reservations not settled yet (id → tokens reserved). */
  open?: Record<string, number>;
}

const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * The AI check budget (§12.6), three limits enforced independently:
 * - per call: ≤ 10 pairs, an input ≤ 1,500 tokens, and a completion budget of the answer plus a reasoning reserve
 *   (`planCalls` / `outputBudget`, §12.23), before anything is reserved;
 * - per day: at most `dailyCap` **calls** and, separately, at most `dailyTokens` **tokens** — 50 calls can't hide 500
 *   pairs' worth of spend, and money is budgeted in tokens (the price is the connection's);
 * - per revision: one automatic call per committed revision. An explicit Retry is allowed again (it still counts
 *   against both daily limits).
 * A reservation is taken synchronously before a call is sent, so a burst can't overrun it.
 *
 * Accounting: a reservation holds the call's **worst case** (estimated input + whole output allowance). `settle` with the
 * provider's reported usage releases the unused part; a failed call, or one without usage, settles with `null` and keeps
 * the whole reservation (it may have been billed). A reservation settles once; it never releases more than it reserved;
 * one from an earlier day is ignored (that day's counts are gone). The call count is never released.
 * Since §12.23–12.24 a typical full call reserves ≈ 2,300 tokens (ceiling 2,800), so at the defaults the token cap binds first (≈ 39
 * full calls a day); smaller calls reserve less. The two are kept independent on purpose.
 */
export class JudgeBudget {
  private s: BudgetState;
  constructor(
    private readonly opts: { dailyCap?: number; dailyTokens?: number; now?: () => number; state?: BudgetState } = {},
  ) {
    this.s = opts.state ? this.clean(opts.state) : { day: dayOf(this.now()), used: 0, tokens: 0, changes: [], open: {} };
  }
  /**
   * Persisted state is read **fail-closed** (§12.24 review): a call or token count that isn't a finite non-negative
   * number counts as the day's cap (an unreadable count must never reopen the budget); `tokens` absent (state saved
   * before the token cap existed) is 0; `changes` keeps strings only; `open` keeps reservations in (0, ceiling].
   */
  private clean(x: Partial<BudgetState>): BudgetState {
    const count = (v: unknown, cap: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : cap);
    const day = typeof x.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.day) ? x.day : dayOf(this.now());
    const open = Object.fromEntries(Object.entries(x.open && typeof x.open === "object" ? x.open : {}).filter(([, v]) => typeof v === "number" && v > 0 && v <= JUDGE_CALL_CEILING));
    return {
      day,
      used: count(x.used, this.opts.dailyCap ?? DAILY_CALL_CAP),
      tokens: x.tokens === undefined ? 0 : count(x.tokens, this.opts.dailyTokens ?? DAILY_TOKEN_CAP),
      changes: Array.isArray(x.changes) ? x.changes.filter((c): c is string => typeof c === "string") : [],
      open,
    };
  }
  private now() {
    return (this.opts.now ?? Date.now)();
  }
  /**
   * Replaces the counts with a persisted state (read fail-closed, like the constructor). `runJudgeCheck` calls it inside
   * the budget's critical section, after another tab may have reserved (§12.25: reservation is atomic across tabs).
   * `undefined` (nothing stored yet) keeps the current counts.
   */
  adopt(state: Partial<BudgetState> | undefined): void {
    if (state) this.s = this.clean(state);
  }
  /** A new UTC day starts fresh counts. Forward only: a clock moved back never resets them (§12.24 review). */
  private roll() {
    const today = dayOf(this.now());
    if (today > this.s.day) this.s = { day: today, used: 0, tokens: 0, changes: [], open: {} };
  }
  reserve(revisionId: string, tokens: number, options: { retry?: boolean } = {}): { ok: true; reservation: string } | { ok: false; reason: "over_call_limit" | "daily_cap" | "daily_tokens" | "change_already_checked" } {
    // The per-call ceiling (§12.24) is checked first, so no caller — a retry included — can reserve an oversized call; a
    // reservation must be a positive whole number of tokens (a negative one would free budget).
    if (!Number.isInteger(tokens) || tokens <= 0 || tokens > JUDGE_CALL_CEILING) return { ok: false, reason: "over_call_limit" };
    this.roll();
    if (!options.retry && this.s.changes.includes(revisionId)) return { ok: false, reason: "change_already_checked" };
    if (this.s.used >= (this.opts.dailyCap ?? DAILY_CALL_CAP)) return { ok: false, reason: "daily_cap" };
    if (this.s.tokens + tokens > (this.opts.dailyTokens ?? DAILY_TOKEN_CAP)) return { ok: false, reason: "daily_tokens" };
    this.s.used++;
    this.s.tokens += tokens;
    if (!this.s.changes.includes(revisionId)) this.s.changes.push(revisionId);
    const open = (this.s.open ??= {});
    let reservation = `${this.s.day}#${this.s.used}`;
    for (let k = 1; reservation in open; k++) reservation = `${this.s.day}#${this.s.used}.${k}`;
    open[reservation] = tokens;
    return { ok: true, reservation };
  }
  /**
   * After the call: the provider's reported usage replaces the reservation (`actualTokens`), or the whole reservation is
   * kept (`null`). Once only. Usage above the reservation is **charged** (§12.24 review): the input is an estimate, so the
   * day's count follows what was actually spent, never less.
   */
  settle(reservation: string, actualTokens: number | null, reservedHint?: number): void {
    this.roll();
    const reserved = this.s.open?.[reservation];
    if (reserved === undefined) {
      // A reservation from an earlier day (the call crossed UTC midnight): that day's counts are gone, but usage above
      // what was reserved is still charged — to today (§12.28 review). Nothing is released.
      const earlier = reservation.slice(0, 10) < this.s.day;
      if (earlier && reservedHint !== undefined && actualTokens !== null && Number.isFinite(actualTokens)) this.s.tokens += Math.max(0, Math.round(actualTokens) - reservedHint);
      return;
    }
    delete this.s.open![reservation];
    if (actualTokens === null || !Number.isFinite(actualTokens)) return;
    this.s.tokens = Math.max(0, this.s.tokens - reserved + Math.max(0, Math.round(actualTokens)));
  }
  /** Calls left today. */
  remaining(): number {
    this.roll();
    return Math.max(0, (this.opts.dailyCap ?? DAILY_CALL_CAP) - this.s.used);
  }
  /** Tokens left today. */
  remainingTokens(): number {
    this.roll();
    return Math.max(0, (this.opts.dailyTokens ?? DAILY_TOKEN_CAP) - this.s.tokens);
  }
  state(): BudgetState {
    this.roll();
    return { ...this.s, changes: [...this.s.changes], open: { ...(this.s.open ?? {}) } };
  }
}

export type PendingReason = "over_call_limit" | "daily_cap" | "daily_tokens" | "change_already_checked" | "output_cap_unavailable";
export type SkipReason = "ai_check_off" | "already_judged";

export interface RoutingPlan {
  call?: { input: JudgeInput; keys: string[]; tokens: number; reservation: string };
  pending: { key: string; reason: PendingReason }[];
  skipped: { key: string; reason: SkipReason }[];
}

export const PENDING_TEXT: Record<PendingReason, string> = {
  over_call_limit: "over this change's one call (10 pairs / token limit): waits for Retry",
  daily_cap: "today's AI check calls are used: waits for tomorrow or Retry",
  daily_tokens: "today's AI check tokens are used: waits for tomorrow or Retry",
  change_already_checked: "this revision already had its AI check: waits for Retry",
  output_cap_unavailable: "this AI connection can't limit the answer's length, so the check isn't sent (use a connection with its own API key)",
};

/** The most a call can cost in tokens: its estimated input plus its whole output allowance. */
export const callTokens = (input: JudgeInput) => estimateTokens(JUDGE_SYSTEM_PROMPT + buildJudgePrompt(input)) + outputBudget(input);

/**
 * One committed revision's candidates → at most one call; the rest pending or skipped, each with its reason.
 * `revisionId` is the committed revision (`rev:…`), so a later content change is a new revision; `judged` says which pair
 * fingerprints already have an AI answer (skipped — a materially changed pair has a new fingerprint and is eligible).
 */
export function planForChange(
  revisionId: string,
  candidates: readonly Candidate[],
  budget: JudgeBudget,
  options: { aiEnabled: boolean; retry?: boolean; judged?: (fingerprint: string) => boolean },
): RoutingPlan {
  const ranked = rankCandidates(candidates);
  if (!ranked.length) return { pending: [], skipped: [] };
  if (!options.aiEnabled) return { pending: [], skipped: ranked.map((c) => ({ key: c.key, reason: "ai_check_off" })) };
  const skipped: RoutingPlan["skipped"] = [];
  const fresh = ranked.filter((c) => {
    // The ledger records a pair under the key it was sent with (`c.key`); a caller may also key by fingerprint. Either
    // one already judged skips it (§12.24 review: a pair without a fingerprint was re-sent on every revision).
    if (options.judged?.(c.key) || (c.fingerprint && c.fingerprint !== c.key && options.judged?.(c.fingerprint))) {
      skipped.push({ key: c.key, reason: "already_judged" });
      return false;
    }
    return true;
  });
  const { calls, skipped: over } = planCalls(fresh, 1);
  const pending: RoutingPlan["pending"] = over.map((key) => ({ key, reason: "over_call_limit" }));
  const planned = calls[0];
  if (!planned) return { pending, skipped };
  const tokens = callTokens(planned.input);
  const r = budget.reserve(revisionId, tokens, { retry: !!options.retry });
  if (!r.ok) return { pending: [...planned.keys.map((key) => ({ key, reason: r.reason })), ...pending], skipped };
  return { call: { ...planned, tokens, reservation: r.reservation }, pending, skipped };
}
