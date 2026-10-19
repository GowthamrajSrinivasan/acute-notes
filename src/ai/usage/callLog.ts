/**
 * In-memory, per-call AI log for cost diagnostics (dev only: nothing is persisted and no content is kept). One record per
 * provider call — the stage it served, who answered, tokens as reported, how it ended — so a run can be priced by stage
 * (outline / plan / analysis patch / assignment …) without the e2e network capture. Complements `usageRepository`, which
 * keeps per-day totals per connection and no stage.
 *
 * Costs are ESTIMATES at list prices (the same constants as `scripts/priceCalls.mjs`), never a bill: they ignore the
 * billed-to-list ratio. `completionTokens` is taken to include reasoning tokens (the usual convention); `reasoningTokens`
 * is reported separately only where the provider says so.
 */
export type CallSource = "chat" | "decision";
export type CallRole = "decision" | "primary" | "fallback";
/** How a call ended: `invalid` = reply failed its schema (a repair call follows), `unsure` = the decision model was not sure and the chat task was asked instead. */
export type CallOutcome = "ok" | "invalid" | "error" | "unsure";

export interface CallRecord {
  /** The registered task (for a decision: the chat task it replaces). */
  task: string;
  source: CallSource;
  role: CallRole;
  provider: string;
  model: string;
  /** 1 = first call, 2 = the schema repair retry (chat) / the contradiction follow-up round (decision). */
  attempt: 1 | 2;
  outcome: CallOutcome;
  /** An AIError kind when `outcome` is "error". */
  error?: string;
  /** What kind of call within its task (see `noteOf`): a plan's request kind, the gaps an analysis patch fills. */
  note?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  ms: number;
  at: number;
}

/** List prices per million tokens, as in `scripts/priceCalls.mjs`. */
export const LIST_PRICES = { chatIn: 0.3, chatOut: 2.5, decisionIn: 0.042 } as const;

export function estimateCost(r: Pick<CallRecord, "source" | "promptTokens" | "completionTokens">): number {
  const input = r.promptTokens ?? 0;
  if (r.source === "decision") return (input * LIST_PRICES.decisionIn) / 1e6;
  return (input * LIST_PRICES.chatIn + (r.completionTokens ?? 0) * LIST_PRICES.chatOut) / 1e6;
}

const STAGES: Record<string, string> = {
  outline_document: "outline",
  generate_visual_plan: "plan",
  generate_section_analysis: "analysis_patch",
  find_revisions: "revisions",
  assign_to_topics: "assignment",
};

/** The pipeline stage a call served, with its note (`plan:piece`); a decision-model call is named for the chat task it replaces, with a `(decision)` suffix. */
export function stageOf(r: Pick<CallRecord, "task" | "source" | "note">): string {
  const stage = `${STAGES[r.task] ?? r.task}${r.note ? `:${r.note}` : ""}`;
  return r.source === "decision" ? `${stage} (decision)` : stage;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Splits a task's calls by what the request was, from its input alone (no content is read or kept):
 * - `generate_visual_plan`: `appended` (only appended paragraphs), `update` (a changed section with its current drawing), `piece` (one piece of a
 *   large section), `analysis_retry` (the whole section asked again after the analysis check), `regenerate` (the user's regenerate),
 *   `dense` (visualize better), else `new`.
 * - `generate_section_analysis` (the analysis-check patch): the gaps it fills, joined with "+": `takeaway`, `analysis` (no analysis nodes),
 *   `items` (an item-by-item analysis skipping items), `structure`.
 */
export function noteOf(task: string, input: unknown): string | undefined {
  if (!isObject(input)) return undefined;
  if (task === "generate_visual_plan") {
    if (input.analysisRetry) return "analysis_retry";
    if (input.appended) return "appended";
    if (input.current) return "update";
    if (input.part) return "piece";
    if (input.retry) return "regenerate";
    if (input.dense) return "dense";
    return "new";
  }
  if (task === "generate_section_analysis" && Array.isArray(input.missing)) {
    const gaps = new Set<string>();
    for (const m of input.missing) {
      if (typeof m !== "string") continue;
      gaps.add(m === "a takeaway" ? "takeaway" : m === "its own analysis" ? "analysis" : m.startsWith("an analysis line") ? "items" : m.startsWith("a visual structure") ? "structure" : "other");
    }
    return [...gaps].join("+") || undefined;
  }
  return undefined;
}

export interface StageSummary {
  stage: string;
  calls: number;
  ok: number;
  invalid: number;
  error: number;
  unsure: number;
  /** Calls that were a repair retry or follow-up round (attempt 2). */
  retries: number;
  /** Calls answered by a fallback provider (chat only). */
  fallbackCalls: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** Calls that reported no token usage — their cost is not in `estimatedUsd`. */
  unreported: number;
  estimatedUsd: number;
  ms: number;
}

export function summarizeCalls(records: readonly CallRecord[]): { stages: StageSummary[]; total: StageSummary } {
  const blank = (stage: string): StageSummary => ({ stage, calls: 0, ok: 0, invalid: 0, error: 0, unsure: 0, retries: 0, fallbackCalls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, unreported: 0, estimatedUsd: 0, ms: 0 });
  const add = (s: StageSummary, r: CallRecord) => {
    s.calls++;
    s[r.outcome]++;
    if (r.attempt === 2) s.retries++;
    if (r.role === "fallback") s.fallbackCalls++;
    s.promptTokens += r.promptTokens ?? 0;
    s.completionTokens += r.completionTokens ?? 0;
    s.reasoningTokens += r.reasoningTokens ?? 0;
    if (r.promptTokens === undefined && r.completionTokens === undefined && r.outcome !== "unsure" && r.outcome !== "error") s.unreported++;
    s.estimatedUsd += estimateCost(r);
    s.ms += r.ms;
  };
  const byStage = new Map<string, StageSummary>();
  const total = blank("total");
  for (const r of records) {
    const key = stageOf(r);
    const s = byStage.get(key) ?? byStage.set(key, blank(key)).get(key)!;
    add(s, r);
    add(total, r);
  }
  return { stages: [...byStage.values()].sort((a, b) => b.estimatedUsd - a.estimatedUsd), total };
}

export interface CallLog {
  record(call: Omit<CallRecord, "at">): void;
  records(): readonly CallRecord[];
  clear(): void;
}

export function createCallLog(limit = 5000): CallLog {
  let calls: CallRecord[] = [];
  return {
    record(call) {
      calls.push({ ...call, at: Date.now() });
      if (calls.length > limit) calls = calls.slice(calls.length - limit);
    },
    records: () => calls,
    clear() {
      calls = [];
    },
  };
}

let shared: CallLog | null = null;
/** The app-wide log the default runtime writes to; read it from `__acuteDev.callStats()`. */
export const getCallLog = (): CallLog => (shared ??= createCallLog());
