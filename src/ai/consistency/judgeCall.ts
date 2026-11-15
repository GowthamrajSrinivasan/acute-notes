/**
 * The dedicated execution path for the AI consistency check (intelligent-update-engine-plan §12.25). **The only way a
 * `judge_consistency` call is ever sent** — the app and the evaluation recorder both go through `sendJudgeCall`, so a
 * recording measures what the app would ship. Stage 4f stays OFF: nothing in the app calls this.
 *
 *   request → [critical section: refresh budget + ledger → validate → reserve → mark in flight] → ONE provider call
 *   (explicit output cap, no repair, no fallback) → read per pair → [critical section: settle usage] → ledger
 *   → the user's review (the model's answer is evidence, never a decision).
 *
 * Why not the general AI runtime (`runtime.ts`, review finding #2): it sends no output cap, makes an automatic repair
 * call when the strict schema fails, tries the fallback provider after an availability error, and returns only parsed
 * data. Here:
 * - **budget**: the 90,000-token daily cap and the 2,800-token per-call ceiling (`JudgeBudget`), reserved **atomically**:
 *   inside a critical section that serialises every reservation — across tabs with the Web Locks API, in one process
 *   with a mutex — after re-reading the persisted counts. Two concurrent checks can't both spend the same budget;
 * - **output cap**: `outputBudget(input)` (answer + reasoning reserve) goes as `maxTokens`, with reasoning effort "low"
 *   (what the reserve was sized for). A transport that can't pass a cap to the model **sends nothing**: the pairs wait
 *   as `output_cap_unavailable` and no budget is reserved;
 * - **one attempt**: no repair call, no failover, no automatic retry. A failed call fails its pairs; only the user's
 *   Retry (or the next revision) resends, and it passes the budget again;
 * - **idempotency**: a pair in flight, or classified / given up for its context, is never planned again — the ledger is
 *   refreshed inside the critical section, so another tab's call counts. A reading is recorded once per call;
 * - **failure handling**: a truncated, unreadable or invalid reply fails its pairs (`readJudgeReply`); nothing is ever
 *   read as compatible by default;
 * - **context identity**: each pair is sent with its context (`pairContext`: both card titles and sections). An answer
 *   given under another context is stale — the pair is checked again and the old answer is kept in its history.
 */
import type { AIProvider } from "@/ai/types";
import { JudgeBudget, planForChange, type BudgetState, type Candidate, type RoutingPlan } from "./candidates";
import { JUDGE_CALL_TIMEOUT_MS, judgeConsistencyTask, outputBudget, type JudgeInput } from "./judge";
import { pairContext, type JudgeLedger } from "./judgeLedger";
import { readJudgeReply, type ReplyReading } from "./judgeReply";

/** The reasoning effort the check asks for: `JUDGE_BUDGET.reasoningTokens` was sized at this setting (§12.23). */
export const JUDGE_REASONING_EFFORT = "low" as const;

export interface JudgeTransportRequest {
  systemPrompt: string;
  prompt: string;
  /** The completion budget (answer + reasoning reserve, `outputBudget`). The transport must hand it to the model. */
  maxTokens: number;
  reasoningEffort: typeof JUDGE_REASONING_EFFORT;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface JudgeTransportReply {
  text: string;
  /** The provider's own finish reason when it has one ("length" = cut off at the cap). */
  finishReason?: string | null;
  usage?: { promptTokens?: number; completionTokens?: number };
}

/** One way to reach a model, for exactly one request. */
export interface JudgeTransport {
  id: string;
  /** Does `maxTokens` reach the model, so it stops at the cap? Without it, nothing is sent. */
  capsOutput: boolean;
  send(request: JudgeTransportRequest): Promise<JudgeTransportReply>;
}

/** Serialises the budget's read-modify-write. */
export interface CriticalSection {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

/** Where the day's budget counts live between checks (the app: device-local meta, shared by every tab). */
export interface BudgetStore {
  load(): Promise<Partial<BudgetState> | undefined>;
  save(state: BudgetState): Promise<void>;
}

/** A mutex for one process: each `run` starts after the previous one settles. */
export function inProcessSection(): CriticalSection {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const next = tail.then(fn, fn);
      tail = next.catch(() => undefined);
      return next;
    },
  };
}

interface LockManagerLike {
  request<T>(name: string, options: { mode: "exclusive" }, fn: () => Promise<T>): Promise<T>;
}

/**
 * A lock shared by every tab (and window) of the origin — the Web Locks API, available in modern browsers and Electron.
 * Falls back to `fallback` (an in-process mutex) where it doesn't exist (tests, Node).
 */
export function webLockSection(name = "acute-consistency-judge-budget", fallback: CriticalSection = inProcessSection()): CriticalSection {
  const locks = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks;
  if (!locks?.request) return fallback;
  return { run: (fn) => locks.request(name, { mode: "exclusive" }, fn) };
}

/** The default section for checks in this process when the caller doesn't pass one. */
const processSection = inProcessSection();

export type JudgeCallStatus =
  /** The reply was read: see `reading` (it may still have failed pairs). */
  | "answered"
  /** The call failed before a reply (network, timeout, provider error, cancelled): every pair failed as `call_error`. */
  | "call_error"
  /** Not sent: the transport can't cap output. Nothing reserved, nothing spent. */
  | "no_output_cap";

/**
 * Why a call got no reply (§12.27), kept apart from the model's judgment in every report:
 * - `timeout`: no reply within `JUDGE_CALL_TIMEOUT_MS` (the transport's own limit, or this path's backstop);
 * - `cancelled`: the caller aborted (the user left, the revision was superseded);
 * - `transport`: the provider or network failed (HTTP error, unreadable response, provider error).
 */
export type JudgeCallFailure = "timeout" | "cancelled" | "transport";

/** How far past the request timeout the path's own deadline fires, if a transport ignores its timeout (§12.27). */
export const JUDGE_DEADLINE_GRACE_MS = 5_000;

export interface JudgeCallResult {
  status: JudgeCallStatus;
  reading?: ReplyReading;
  error?: string;
  /** For `call_error`: timeout, cancelled or transport. */
  failure?: JudgeCallFailure;
  /** Tokens the provider reported (prompt + completion), when it reported them. */
  usedTokens?: number;
  /** The provider reported more than was reserved (the input is an estimate): charged to the day's budget. */
  overReservation?: boolean;
  ms: number;
}

const errorText = (err: unknown) => (err instanceof Error ? `${err.name === "Error" ? "" : `${err.name}: `}${err.message}` : String(err)).slice(0, 200);

/**
 * Sends one planned call, exactly once, and records the outcome. The caller has **reserved** `reserved` tokens under
 * `reservation` and marked the pairs in flight (`ledger.markSent`) — `runJudgeCheck` does both inside the critical
 * section; the recorder does them against its approved ceilings. `settle` receives the reported usage, or `null` (keep
 * the whole reservation: a failed call may have been billed).
 *
 * `commit` wraps every ledger write and the settlement (§12.28 review): `runJudgeCheck` passes the shared critical
 * section, so recording a reply is atomic across tabs, like reserving. Without one, writes happen directly.
 *
 * A reply is recorded only if it arrived **in time and uncancelled**: after the race, the wall clock is checked too, so a
 * throttled background tab whose deadline timer fired late can't record a reply older than the deadline (§12.28 review).
 */
export async function sendJudgeCall(args: {
  canvasId: string;
  revision: string;
  keys: readonly string[];
  input: JudgeInput;
  reservation: string;
  reserved: number;
  transport: JudgeTransport;
  ledger: JudgeLedger;
  settle: (actualTokens: number | null) => void | Promise<void>;
  signal?: AbortSignal;
  commit?: (apply: () => Promise<void>) => Promise<void>;
}): Promise<JudgeCallResult> {
  const { canvasId, revision, keys, input, reservation, transport, ledger } = args;
  const commit = args.commit ?? ((apply: () => Promise<void>) => apply());
  const started = Date.now();
  const fail = async (failure: JudgeCallFailure | null, error: string, actual: number | null): Promise<void> =>
    commit(async () => {
      ledger.recordCallError(canvasId, revision, keys, error, reservation);
      await args.settle(actual);
      await ledger.flushed();
    });
  if (!transport.capsOutput) {
    // Defensive: `runJudgeCheck` checks before reserving. A direct caller gets nothing sent and the reservation released.
    await fail(null, "not sent: this connection can't limit the answer's length", 0);
    return { status: "no_output_cap", ms: 0 };
  }
  // Cancelled before anything was sent: nothing can have been billed, so the reservation is released.
  if (args.signal?.aborted) {
    await fail("cancelled", "cancelled before sending", 0);
    return { status: "call_error", failure: "cancelled", error: "cancelled before sending", ms: 0 };
  }
  const { systemPrompt, prompt } = judgeConsistencyTask.buildPrompt({ input });
  const timeoutMs = JUDGE_CALL_TIMEOUT_MS;
  const deadlineAt = started + timeoutMs + JUDGE_DEADLINE_GRACE_MS;
  // One controller for the request: the caller's cancellation and this path's own deadline both abort it.
  const controller = new AbortController();
  let rejectCancelled!: (err: unknown) => void;
  // The caller's cancellation is a racer of its own: a transport that ignores its signal can't land a reply after it.
  const cancelled = new Promise<never>((_, reject) => (rejectCancelled = reject));
  const onCancel = () => {
    const err = new DOMException("cancelled", "AbortError");
    controller.abort(err);
    rejectCancelled(err);
  };
  args.signal?.addEventListener("abort", onCancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new DOMException(`no reply within ${Math.round(timeoutMs / 1000)} s`, "TimeoutError");
      controller.abort(err);
      reject(err);
    }, timeoutMs + JUDGE_DEADLINE_GRACE_MS);
  });
  // Unobserved rejections of the losing racers are expected.
  cancelled.catch(() => undefined);
  deadline.catch(() => undefined);
  let reply: JudgeTransportReply;
  try {
    // A reply that arrives after the deadline or the cancellation loses the race and is never recorded.
    reply = await Promise.race([
      transport.send({ systemPrompt: systemPrompt ?? "", prompt, maxTokens: outputBudget(input), reasoningEffort: JUDGE_REASONING_EFFORT, timeoutMs, signal: controller.signal }),
      deadline,
      cancelled,
    ]);
    // The wall clock, not only the timer: a frozen tab's timer can fire late (§12.28 review).
    if (Date.now() > deadlineAt) throw new DOMException(`no reply within ${Math.round(timeoutMs / 1000)} s`, "TimeoutError");
    if (args.signal?.aborted) throw new DOMException("cancelled", "AbortError");
  } catch (err) {
    // No repair, no failover, no retry here. The call may have been billed: the whole reservation is kept.
    const failure: JudgeCallFailure = args.signal?.aborted ? "cancelled" : (err as { name?: string })?.name === "TimeoutError" ? "timeout" : "transport";
    const error = failure === "timeout" ? `timeout: no reply within ${Math.round(timeoutMs / 1000)} s` : failure === "cancelled" ? "cancelled" : errorText(err);
    await fail(failure, error, null);
    return { status: "call_error", failure, error, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", onCancel);
  }
  const reading = readJudgeReply(typeof reply?.text === "string" ? reply.text : "", keys, { finishReason: reply?.finishReason ?? null });
  const p = reply?.usage?.promptTokens;
  const c = reply?.usage?.completionTokens;
  const usedTokens = Number.isFinite(p) || Number.isFinite(c) ? Math.max(0, Number.isFinite(p) ? Number(p) : 0) + Math.max(0, Number.isFinite(c) ? Number(c) : 0) : undefined;
  await commit(async () => {
    ledger.recordReading(canvasId, revision, reading, reservation);
    await args.settle(usedTokens ?? null);
    await ledger.flushed();
  });
  return { status: "answered", reading, ...(usedTokens !== undefined ? { usedTokens, overReservation: usedTokens > args.reserved } : {}), ms: Date.now() - started };
}

export interface JudgeCheckResult {
  /** `ai_off`: the AI switch is off, nothing planned or sent. `nothing_to_send`: no call planned (all skipped or pending). */
  status: JudgeCallStatus | "ai_off" | "nothing_to_send";
  plan: RoutingPlan;
  call?: JudgeCallResult;
  /** Why nothing was sent although a call was planned (e.g. the ledger couldn't be saved). */
  note?: string;
}

/**
 * One committed revision's AI check, end to end (see module doc). `section` and `budgetStore` make the reservation
 * atomic across tabs; without them it is atomic within this process. **Every ledger write runs inside the section**
 * (reserve, record, settle), and every ledger save is read-merge-write, so tabs never overwrite each other's marks.
 */
export async function runJudgeCheck(args: {
  canvasId: string;
  revision: string;
  candidates: readonly Candidate[];
  budget: JudgeBudget;
  ledger: JudgeLedger;
  transport: JudgeTransport;
  aiEnabled: boolean;
  retry?: boolean;
  signal?: AbortSignal;
  section?: CriticalSection;
  budgetStore?: BudgetStore;
}): Promise<JudgeCheckResult> {
  const { canvasId, revision, budget, ledger, transport, budgetStore } = args;
  const section = args.section ?? processSection;
  if (!args.aiEnabled) return { status: "ai_off", plan: planForChange(revision, args.candidates, budget, { aiEnabled: false }) };
  const contexts = new Map(args.candidates.map((c) => [c.key, pairContext(c)] as const));
  const blocked = (key: string) => ledger.blocksResend(canvasId, key, contexts.get(key));

  // 1. Validate and reserve — one critical section: fresh counts and ledger in, reservation and in-flight marks out.
  const reserved = await section.run(async () => {
    if (budgetStore) budget.adopt(await budgetStore.load());
    await ledger.refresh(canvasId);
    ledger.expireStale(canvasId);
    // No cap, no call — decided before anything is reserved, so the budget is untouched.
    if (!transport.capsOutput) {
      const waiting = args.candidates.filter((c) => !blocked(c.key)).map((c) => ({ key: c.key, reason: "output_cap_unavailable" as const, context: contexts.get(c.key)! }));
      ledger.markPending(canvasId, revision, waiting);
      await ledger.flushed();
      return { status: "no_output_cap" as const, plan: { pending: waiting.map(({ key, reason }) => ({ key, reason })), skipped: [] } as RoutingPlan };
    }
    const plan = planForChange(revision, args.candidates, budget, { aiEnabled: true, ...(args.retry ? { retry: true } : {}), judged: blocked });
    // The budget is saved BEFORE any pair is marked in flight: if the save fails, nothing is marked or sent (§12.28).
    if (budgetStore && plan.call) await budgetStore.save(budget.state());
    if (plan.pending.length) ledger.markPending(canvasId, revision, plan.pending.map((p) => ({ ...p, context: contexts.get(p.key)! })));
    if (plan.call) ledger.markSent(canvasId, revision, plan.call.keys, plan.call.reservation, contexts);
    await ledger.flushed();
    if (plan.call && ledger.saveFailed(canvasId)) {
      // Other tabs can't see these in-flight marks: don't send. Undo the reservation and the marks (no attempt counted).
      budget.settle(plan.call.reservation, 0);
      if (budgetStore) await budgetStore.save(budget.state());
      ledger.unmarkSent(canvasId, plan.call.keys, plan.call.reservation);
      return { status: "nothing_to_send" as const, plan: { pending: plan.call.keys.map((key) => ({ key, reason: "over_call_limit" as const })), skipped: plan.skipped }, note: "the AI check ledger couldn't be saved: nothing sent" };
    }
    if (!plan.call && budgetStore && plan.pending.length) await budgetStore.save(budget.state());
    return { status: plan.call ? ("send" as const) : ("nothing_to_send" as const), plan };
  });
  if (reserved.status !== "send") return { status: reserved.status, plan: reserved.plan, ...("note" in reserved && reserved.note ? { note: reserved.note } : {}) };

  // 2. One provider call, outside the section (other checks may reserve meanwhile).
  const { input, keys, tokens, reservation } = reserved.plan.call!;
  const call = await sendJudgeCall({
    canvasId,
    revision,
    keys,
    input,
    reservation,
    reserved: tokens,
    transport,
    ledger,
    ...(args.signal ? { signal: args.signal } : {}),
    // 3. Record and settle — again in the section, on fresh counts and a fresh ledger (another tab may have written).
    commit: (apply) =>
      section.run(async () => {
        if (budgetStore) budget.adopt(await budgetStore.load());
        await ledger.refresh(canvasId);
        await apply();
        if (budgetStore) await budgetStore.save(budget.state());
      }),
    settle: (actual) => budget.settle(reservation, actual, tokens),
  });
  return { status: call.status, plan: reserved.plan, call };
}

/**
 * The app's transport over a configured provider: **one** `generate` call on that provider only (the caller passes the
 * active primary — never the fallback), temperature 0, the cap as `maxTokens`, reasoning effort "low". `capsOutput`
 * comes from the provider's declared `outputCap` (§12.25): only `"passed"` counts.
 */
export function providerJudgeTransport(provider: AIProvider): JudgeTransport {
  return {
    id: provider.id,
    capsOutput: provider.capabilities.outputCap === "passed",
    async send(request) {
      const r = await provider.generate({
        task: judgeConsistencyTask.task,
        systemPrompt: request.systemPrompt,
        prompt: request.prompt,
        temperature: 0,
        maxTokens: request.maxTokens,
        reasoningEffort: request.reasoningEffort,
        timeoutMs: request.timeoutMs,
        ...(request.signal ? { signal: request.signal } : {}),
      });
      return {
        text: r.text,
        finishReason: r.finishReason,
        usage: { ...(r.usage.promptTokens !== undefined ? { promptTokens: r.usage.promptTokens } : {}), ...(r.usage.completionTokens !== undefined ? { completionTokens: r.usage.completionTokens } : {}) },
      };
    },
  };
}
