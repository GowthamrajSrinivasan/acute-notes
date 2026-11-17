/**
 * The AI consistency check on the live canvas (intelligent-update-engine-plan Stage 4f, Phase 1 close-out). **Off by
 * default** (`isConsistencyAICheckUiEnabled` + the server's `CONSISTENCY_AI_CHECK`), **opt-in** per device, **started by
 * hand**, **review-only**:
 *
 *   commit → (opted in) `discoverForAI`: each new claim × the relevant cards' sentences, screened (`screenPair`); the
 *   pairs the screen forwards are queued (`AICheckQueue`) — free, local, no model call
 *   → the user presses "Check with AI" → `runAICheck`: the queue, ranked, → `runJudgeCheck` (one call of ≤ 10 pairs,
 *   the 2,800-token call ceiling and the 90,000-token day, exactly one direct request) → each answer combined with the
 *   screen's judgement (`combine`) → `ConsistencyStore.recordAI` (evidence on the record; a status never changes).
 *
 * Why the screen and not the live rules-only `detect`: on unseen5 the rules alone surface 3 of 40 contradictions; the
 * screened route reaches 36 of 40 with the recorded answers (plan §14 close-out, `liveDiscovery.probe.test.ts`).
 *
 * Nothing here writes to a card, confirms or dismisses a record, or sends anything without the user's press.
 */
import type { MetaRepository } from "@/persistence/repositories/types";
import { DAILY_CALL_CAP, DAILY_TOKEN_CAP, JudgeBudget, PENDING_TEXT, type BudgetState, type Candidate, type PendingReason } from "./candidates";
import { combine, JUDGE_CALL_CEILING } from "./judge";
import { runJudgeCheck, webLockSection, type BudgetStore, type CriticalSection, type JudgeCheckResult, type JudgeTransport } from "./judgeCall";
import { JudgeLedger, pairContext } from "./judgeLedger";
import { judgementForCombine, screenPair } from "./screen";
import { pairId, sentenceHash, type ConsistencyConflict, type ConsistencyStore, type Detection } from "./store";

type Meta = Pick<MetaRepository, "get" | "set">;

/** One queued pair: both statements and where they are. */
export interface QueuedPair {
  key: string;
  a: { elementId: string; sentence: string; cardName: string };
  b: { elementId: string; sentence: string; cardName: string };
  /** The committed revision that found it. */
  revision: string;
  at: number;
}

export const MAX_QUEUED = 200;
export const queueKey = (canvasId: string) => `consistency.aiQueue.${canvasId}`;
export const droppedKey = (canvasId: string) => `consistency.aiQueue.${canvasId}.dropped`;
export const OPT_IN_KEY = "consistency.aiCheck.optIn";
export const BUDGET_KEY = "consistency.judge.budget";

/** The device's opt-in (default off). */
export async function isOptedIn(meta: Meta): Promise<boolean> {
  try {
    return (await meta.get<boolean>(OPT_IN_KEY)) === true;
  } catch {
    return false;
  }
}
export const setOptIn = (meta: Meta, on: boolean) => meta.set(OPT_IN_KEY, on);

/** The day's budget, shared by every tab of the device (read fail-closed by `JudgeBudget`). */
export function budgetStore(meta: Meta): BudgetStore {
  return { load: () => meta.get<Partial<BudgetState>>(BUDGET_KEY), save: (s) => meta.set(BUDGET_KEY, s) };
}

/**
 * The pairs the screen forwards for the AI, for one commit's claims (see module doc). Rule conflicts are left to the
 * rules (already shown); excluded pairs are not sent. One pair per (claim, sentence); never a card against itself.
 */
export function discoverForAI(
  claims: readonly { elementId: string; sentence: string }[],
  cardOf: (id: string) => { elementId: string; name: string; sentences: readonly string[] } | null,
  candidatesOf: (claim: { elementId: string; sentence: string }) => readonly string[],
  revision: string,
  now: number,
): QueuedPair[] {
  const out = new Map<string, QueuedPair>();
  for (const claim of claims) {
    const own = cardOf(claim.elementId);
    if (!own) continue;
    for (const id of candidatesOf(claim)) {
      if (id === claim.elementId) continue;
      const other = cardOf(id);
      if (!other) continue;
      for (const sentence of other.sentences) {
        // The same statement on two cards (a title on a frame and its block, a copied line) can't disagree: never sent.
        if (sentenceHash(claim.sentence) === sentenceHash(sentence)) continue;
        if (screenPair(claim.sentence, sentence).decision !== "forward") continue;
        const a = { elementId: own.elementId, sentence: claim.sentence, cardName: own.name };
        const b = { elementId: other.elementId, sentence, cardName: other.name };
        const key = pairId(a, b);
        if (!out.has(key)) out.set(key, { key, a, b, revision, at: now });
      }
    }
  }
  return [...out.values()];
}

/** The queued pairs per canvas, in the device's meta store, bounded (oldest dropped first). */
export class AICheckQueue {
  private readonly byCanvas = new Map<string, Map<string, QueuedPair>>();
  constructor(private readonly meta?: Meta) {}

  async load(canvasId: string): Promise<QueuedPair[]> {
    try {
      const stored = await this.meta?.get<QueuedPair[]>(queueKey(canvasId));
      const m = new Map<string, QueuedPair>();
      for (const q of Array.isArray(stored) ? stored : []) if (isQueued(q)) m.set(q.key, q);
      this.byCanvas.set(canvasId, m);
    } catch (err) {
      console.error("[acute-notes] Failed to read the AI check queue", err);
      if (!this.byCanvas.has(canvasId)) this.byCanvas.set(canvasId, new Map());
    }
    return this.list(canvasId);
  }

  list(canvasId: string): QueuedPair[] {
    return [...(this.byCanvas.get(canvasId)?.values() ?? [])];
  }

  /** Adds new pairs (a pair already queued keeps its place) and drops the ones `keep` rejects. */
  async update(canvasId: string, add: readonly QueuedPair[], keep: (q: QueuedPair) => boolean = () => true): Promise<void> {
    const m = this.byCanvas.get(canvasId) ?? new Map<string, QueuedPair>();
    for (const q of add) if (!m.has(q.key)) m.set(q.key, q);
    for (const [k, q] of m) if (!keep(q)) m.delete(k);
    const sorted = [...m.values()].sort((x, y) => x.at - y.at);
    const kept = sorted.slice(-MAX_QUEUED);
    this.byCanvas.set(canvasId, new Map(kept.map((q) => [q.key, q])));
    await this.meta?.set(queueKey(canvasId), kept);
    // A full queue drops its oldest pairs — counted, never silent (pilot review D4).
    const over = sorted.length - kept.length;
    if (over > 0) await this.meta?.set(droppedKey(canvasId), (await this.dropped(canvasId)) + over);
  }

  /** Pairs dropped because the queue was full (oldest first), since the device opted in on this canvas. */
  async dropped(canvasId: string): Promise<number> {
    try {
      const n = await this.meta?.get<number>(droppedKey(canvasId));
      return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }
}

function isQueued(q: unknown): q is QueuedPair {
  const x = q as QueuedPair | null;
  const sideOk = (s: unknown) => !!s && typeof (s as QueuedPair["a"]).elementId === "string" && typeof (s as QueuedPair["a"]).sentence === "string" && typeof (s as QueuedPair["a"]).cardName === "string";
  return !!x && typeof x.key === "string" && sideOk(x.a) && sideOk(x.b) && typeof x.revision === "string" && Number.isFinite(x.at);
}

/** The reason on a record the AI check raised: who found it — the rules alone saw no clear disagreement. */
export const AI_FOUND_REASON = "Found by the AI check: the rules alone don't show a disagreement here.";

/** `combine`'s note without the screen's reason in front ("no disagreement found; AI reads…" → "AI reads…"). */
export function noteForUser(note: string, screenReason: string): string {
  const prefix = `${screenReason}; `;
  const rest = note.startsWith(prefix) ? note.slice(prefix.length) : note;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** A queued pair as the check's candidate: ranked by the screen, the card names as context. */
export function candidateOf(q: QueuedPair): Candidate | null {
  const s = screenPair(q.a.sentence, q.b.sentence);
  if (s.decision !== "forward") return null;
  return { key: q.key, fingerprint: q.key, a: { sentence: q.a.sentence, card: q.a.cardName }, b: { sentence: q.b.sentence, card: q.b.cardName }, judgement: judgementForCombine(s), priority: s.priority };
}

/** What a queued pair's statements look like on the canvas now: still said by both cards? */
export type StillSaid = (q: QueuedPair) => boolean;

export interface AICheckDeps {
  canvasId: string;
  meta: Meta;
  queue: AICheckQueue;
  ledger: JudgeLedger;
  store: ConsistencyStore;
  transport: JudgeTransport | null;
  /** Is the pair still said on the canvas (both cards, both sentences)? Gone pairs are dropped before planning. */
  stillSaid: StillSaid;
  section?: CriticalSection;
  now?: () => number;
  signal?: AbortSignal;
  /**
   * Is the server's switch on? Asked before anything is reserved: with it off, nothing is sent, no budget is kept and
   * no attempt is counted (pilot review D7). Omitted: assumed on.
   */
  serverReady?: () => Promise<boolean>;
}

export interface AICheckRun {
  status: JudgeCheckResult["status"] | "no_connection" | "nothing_queued" | "server_off";
  sent: number;
  classified: number;
  failed: number;
  /** Records the readings added or annotated. */
  recorded: number;
  error?: string;
  usedTokens?: number;
  providerRequests?: number;
}

/** One manual check: at most one call of ≤ 10 pairs (see module doc). */
export async function runAICheck(d: AICheckDeps): Promise<AICheckRun> {
  const now = d.now ?? Date.now;
  await d.queue.load(d.canvasId);
  await d.ledger.load(d.canvasId);
  // Drop pairs a card no longer says, and pairs the user dismissed.
  await d.queue.update(d.canvasId, [], (q) => d.stillSaid(q) && d.store.get(d.canvasId, q.key)?.status !== "dismissed");
  const queued = d.queue.list(d.canvasId);
  const candidates = queued.map(candidateOf).filter((c): c is Candidate => !!c);
  if (!d.transport) return { status: "no_connection", sent: 0, classified: 0, failed: 0, recorded: 0 };
  const fresh = candidates.filter((c) => !d.ledger.blocksResend(d.canvasId, c.key, pairContext(c)));
  if (!fresh.length) return { status: "nothing_queued", sent: 0, classified: 0, failed: 0, recorded: 0 };
  if (d.serverReady && !(await d.serverReady().catch(() => false))) return { status: "server_off", sent: 0, classified: 0, failed: 0, recorded: 0 };
  const result = await runJudgeCheck({
    canvasId: d.canvasId,
    revision: `ai-check:${now()}`,
    candidates,
    budget: new JudgeBudget({ now }),
    ledger: d.ledger,
    transport: d.transport,
    aiEnabled: true,
    retry: true,
    section: d.section ?? webLockSection(),
    budgetStore: budgetStore(d.meta),
    ...(d.signal ? { signal: d.signal } : {}),
  });
  const keys = result.plan.call?.keys ?? [];
  const byKey = new Map(queued.map((q) => [q.key, q] as const));
  const readings: Parameters<ConsistencyStore["recordAI"]>[2][number][] = [];
  let classified = 0;
  for (const key of keys) {
    const p = d.ledger.get(d.canvasId, key);
    const q = byKey.get(key);
    const c = candidates.find((x) => x.key === key);
    if (!p || p.state !== "classified" || !p.answer || !q || !c) continue;
    classified++;
    const ai = { answer: p.answer, ...(p.why ? { why: p.why } : {}) };
    const combined = combine(c.judgement, ai);
    // The screen's own reason ("no disagreement found") describes the rules, not the finding: an AI-raised record says
    // who found it, and the note leads with the AI's reading (pilot review D2).
    const detection: Detection = { a: q.a, b: q.b, kind: c.judgement.kind ?? "differs", strength: "possible", reason: AI_FOUND_REASON };
    readings.push({ detection, ai, shown: combined.shown, note: noteForUser(combined.note, c.judgement.reason) });
  }
  const recorded = readings.length ? d.store.recordAI(d.canvasId, `ai-check:${now()}`, readings).length : 0;
  return {
    status: result.status,
    sent: keys.length,
    classified,
    failed: keys.length - classified,
    recorded,
    ...(result.call?.error ? { error: result.call.error } : result.note ? { error: result.note } : {}),
    ...(result.call?.usedTokens !== undefined ? { usedTokens: result.call.usedTokens } : {}),
    ...(result.call?.providerRequests !== undefined ? { providerRequests: result.call.providerRequests } : {}),
  };
}

/** What the panel shows about the AI check: every queued pair in exactly one state, and the day's budget. */
export interface AICheckStatus {
  /** Queued, never answered (no ledger entry yet, or waiting with a reason). */
  notChecked: number;
  waiting: { reason: PendingReason; text: string; count: number }[];
  inFlight: number;
  /** Answered: shown to the user (likely / possible). */
  checkedShown: number;
  /** Answered: the model reads the pair as compatible — kept as evidence, not a conflict. */
  checkedCompatible: number;
  /** The call or its answer failed (retryable), or gave up after `MAX_ATTEMPTS`. */
  failed: number;
  gaveUp: number;
  budget: { callsLeft: number; tokensLeft: number; dailyCalls: number; dailyTokens: number };
  /** The backlog, each figure separately (Phase 1 close-out decision): never one merged number. */
  backlog: Backlog;
  /** Pairs dropped unchecked because the queue was full (`MAX_QUEUED`, oldest first) — shown, never silent. */
  droppedPairs: number;
  /**
   * The pilot's precision signal (pilot review condition 5): records the AI check showed (likely or possible), by the
   * user's decision. A dismissed "likely" is the AI's false positive. Local; shared only if the user reports it.
   */
  pilot: { likely: { open: number; confirmed: number; dismissed: number }; possible: { open: number; confirmed: number; dismissed: number } };
}

/** The pilot feedback counts over a canvas's records (see `AICheckStatus.pilot`). */
export function pilotFeedback(records: readonly Pick<ConsistencyConflict, "status" | "ai">[]): AICheckStatus["pilot"] {
  const zero = () => ({ open: 0, confirmed: 0, dismissed: 0 });
  const out = { likely: zero(), possible: zero() };
  for (const r of records) {
    const shown = r.ai?.shown;
    if (shown !== "likely" && shown !== "possible") continue;
    const bucket = out[shown];
    if (r.status === "confirmed") bucket.confirmed++;
    else if (r.status === "dismissed") bucket.dismissed++;
    else bucket.open++;
  }
  return out;
}

/**
 * Per-call figures for backlog planning, measured on the unseen5 recording (2026-11-15, 8 full 10-pair calls over the
 * direct path): reservations 2,365–2,441 tokens, actual use 1,739–2,152, mean 1,920. A full call reserves at most
 * `JUDGE_CALL_CEILING` (2,800).
 */
export const PLANNING = { pairsPerCall: 10, typicalSettledTokens: 1_920, typicalReservation: 2_450, worstCaseTokens: JUDGE_CALL_CEILING } as const;

export interface Backlog {
  /** Pairs still to check: not checked yet, plus failed ones that can be retried (gave-up pairs are not counted). */
  pendingPairs: number;
  /** Manual checks (calls) needed for them at 10 pairs a call. */
  requiredCalls: number;
  /**
   * Calendar days (today included) the day's limits need for those calls: `typical` when each call settles at the
   * measured mean, `worstCase` when every call keeps its whole 2,800-token reservation (failures, no usage reported).
   */
  budgetDays: { typical: number; worstCase: number };
  /** When the oldest pending pair was queued (null: nothing pending). */
  oldestPendingAt: number | null;
}

/** Calls the day's limits admit, one after another: each must reserve within the token cap, then settles at `settled`. */
export function callsAdmitted(callsLeft: number, tokensLeft: number, settled: number, reservation: number, want = Infinity): number {
  let n = 0;
  for (let tok = tokensLeft, c = callsLeft; n < want && c > 0 && tok >= reservation; n++, c--) tok -= settled;
  return n;
}

/** Days (today included) to send `calls` calls, today's remaining budget first, then full days. */
export function daysFor(calls: number, today: { callsLeft: number; tokensLeft: number }, settled: number, reservation: number): number {
  if (calls <= 0) return 0;
  const perDay = callsAdmitted(DAILY_CALL_CAP, DAILY_TOKEN_CAP, settled, reservation);
  const remaining = calls - callsAdmitted(today.callsLeft, today.tokensLeft, settled, reservation, calls);
  return 1 + (remaining > 0 ? Math.ceil(remaining / perDay) : 0);
}

export function backlogOf(pendingPairs: number, oldestPendingAt: number | null, today: { callsLeft: number; tokensLeft: number }): Backlog {
  const requiredCalls = Math.ceil(pendingPairs / PLANNING.pairsPerCall);
  return {
    pendingPairs,
    requiredCalls,
    budgetDays: {
      typical: daysFor(requiredCalls, today, PLANNING.typicalSettledTokens, PLANNING.typicalReservation),
      worstCase: daysFor(requiredCalls, today, PLANNING.worstCaseTokens, PLANNING.worstCaseTokens),
    },
    oldestPendingAt,
  };
}

export async function aiCheckStatus(d: Pick<AICheckDeps, "canvasId" | "meta" | "queue" | "ledger" | "now"> & { store?: ConsistencyStore }): Promise<AICheckStatus> {
  const queued = await d.queue.load(d.canvasId);
  await d.ledger.load(d.canvasId);
  const s: AICheckStatus = {
    notChecked: 0,
    waiting: [],
    inFlight: 0,
    checkedShown: 0,
    checkedCompatible: 0,
    failed: 0,
    gaveUp: 0,
    budget: { callsLeft: 0, tokensLeft: 0, dailyCalls: DAILY_CALL_CAP, dailyTokens: DAILY_TOKEN_CAP },
    backlog: backlogOf(0, null, { callsLeft: 0, tokensLeft: 0 }),
    droppedPairs: await d.queue.dropped(d.canvasId),
    pilot: pilotFeedback(d.store?.list(d.canvasId) ?? []),
  };
  const waiting = new Map<PendingReason, number>();
  let oldest: number | null = null;
  const pendingSince = (q: QueuedPair) => (oldest = oldest === null ? q.at : Math.min(oldest, q.at));
  for (const q of queued) {
    const c = candidateOf(q);
    if (!c) continue;
    const p = d.ledger.get(d.canvasId, q.key);
    const sameContext = !p?.context || p.context === pairContext(c);
    if (!p || !sameContext) {
      s.notChecked++;
      pendingSince(q);
    } else if (p.state === "pending") {
      s.notChecked++;
      pendingSince(q);
      const r = p.reason as PendingReason;
      if (r in PENDING_TEXT) waiting.set(r, (waiting.get(r) ?? 0) + 1);
    } else if (p.state === "in_flight") s.inFlight++;
    else if (p.state === "classified") {
      if (combine(c.judgement, { answer: p.answer! }).shown === "hidden") s.checkedCompatible++;
      else s.checkedShown++;
    } else if (p.state === "gave_up") s.gaveUp++;
    else {
      s.failed++;
      pendingSince(q);
    }
  }
  s.waiting = [...waiting].map(([reason, count]) => ({ reason, text: PENDING_TEXT[reason], count }));
  const budget = new JudgeBudget({ ...(d.now ? { now: d.now } : {}) });
  // Unreadable counts read as the day's cap (fail closed), never as a fresh budget.
  budget.adopt(await budgetStore(d.meta).load().catch(() => ({ used: -1, tokens: -1 })));
  s.budget.callsLeft = budget.remaining();
  s.budget.tokensLeft = budget.remainingTokens();
  s.backlog = backlogOf(s.notChecked + s.failed, oldest, s.budget);
  return s;
}
