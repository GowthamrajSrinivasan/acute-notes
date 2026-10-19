/**
 * Device-local AI usage log (F27, PRD §9.1 `AIUsageRepository`, §13.15.14)
 * for the AI settings usage summary. Records what providers report per
 * request — never an estimate: a request whose provider reported nothing
 * counts as a request only, and the summary says usage wasn't reported.
 *
 * Stored in the meta store as one record per calendar month, bucketed by day
 * and connection, so the log stays bounded and needs no database schema of
 * its own. Like AI settings and conversations it holds no content and is
 * never part of workspace exports or sync.
 */
import { getPersistence } from "@/persistence";
import type { MetaRepository } from "@/persistence/repositories/types";
import type { AIUsage } from "@/ai/types";

export interface AIUsageTotals {
  requests: number;
  /** Requests that reported tokens or plan usage; the rest reported nothing. */
  reportedRequests: number;
  promptTokens: number;
  completionTokens: number;
  /** Plan-based usage by unit (e.g. Copilot's `nanoAiu`). */
  subscription: Record<string, number>;
}

export interface AIUsageSummary {
  from: number;
  to: number;
  /** Per connection id, only connections with at least one request in range. */
  byProvider: Record<string, AIUsageTotals>;
}

export interface AIUsageRepository {
  record(usage: AIUsage): Promise<void>;
  summarize(range: { from: number; to: number }): Promise<AIUsageSummary>;
  clear(): Promise<void>;
}

/** Month record: day of month → connection id → totals. */
interface UsageMonth {
  days: Record<string, Record<string, AIUsageTotals>>;
}

const KEY_PREFIX = "ai.usage.";
/** The months `clear()` forgets — older ones are left unread anyway. */
const RETAINED_MONTHS = 13;

function monthKey(date: Date): string {
  return `${KEY_PREFIX}${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function emptyTotals(): AIUsageTotals {
  return { requests: 0, reportedRequests: 0, promptTokens: 0, completionTokens: 0, subscription: {} };
}

function addInto(target: AIUsageTotals, source: AIUsageTotals): void {
  target.requests += source.requests;
  target.reportedRequests += source.reportedRequests;
  target.promptTokens += source.promptTokens;
  target.completionTokens += source.completionTokens;
  for (const [unit, amount] of Object.entries(source.subscription)) target.subscription[unit] = (target.subscription[unit] ?? 0) + amount;
}

function totalsOf(usage: AIUsage): AIUsageTotals {
  const reported = usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.subscriptionUsage !== undefined;
  return {
    requests: 1,
    reportedRequests: reported ? 1 : 0,
    promptTokens: usage.promptTokens ?? 0,
    completionTokens: usage.completionTokens ?? 0,
    subscription: usage.subscriptionUsage ? { [usage.subscriptionUsage.unit]: usage.subscriptionUsage.amount } : {},
  };
}

/** Month keys from `from`'s month through `to`'s, oldest first. */
function monthsBetween(from: number, to: number): Date[] {
  const months: Date[] = [];
  const end = new Date(to);
  for (let d = new Date(new Date(from).getFullYear(), new Date(from).getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    months.push(d);
  }
  return months;
}

export function createAIUsageRepository(meta: MetaRepository, now: () => number = Date.now): AIUsageRepository {
  // Writes are read-modify-write on one month record; chain them so two
  // requests finishing together in this tab never lose one.
  let writes: Promise<void> = Promise.resolve();

  return {
    record(usage) {
      const write = writes.then(async () => {
        const date = new Date(now());
        const key = monthKey(date);
        const month = (await meta.get<UsageMonth>(key)) ?? { days: {} };
        const day = (month.days[String(date.getDate())] ??= {});
        addInto((day[usage.provider] ??= emptyTotals()), totalsOf(usage));
        await meta.set(key, month);
      });
      writes = write.catch(() => undefined);
      return write;
    },

    async summarize({ from, to }) {
      await writes;
      const byProvider: Record<string, AIUsageTotals> = {};
      for (const monthStart of monthsBetween(from, to)) {
        const month = await meta.get<UsageMonth>(monthKey(monthStart));
        if (!month) continue;
        for (const [dayOfMonth, providers] of Object.entries(month.days)) {
          const dayStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), Number(dayOfMonth)).getTime();
          if (dayStart > to || dayStart + 86_400_000 <= from) continue;
          for (const [provider, totals] of Object.entries(providers)) addInto((byProvider[provider] ??= emptyTotals()), totals);
        }
      }
      return { from, to, byProvider };
    },

    async clear() {
      await writes;
      const current = new Date(now());
      for (let i = 0; i < RETAINED_MONTHS; i++) {
        await meta.delete(monthKey(new Date(current.getFullYear(), current.getMonth() - i, 1)));
      }
    },
  };
}

let appRepository: AIUsageRepository | null = null;

/** App-wide usage log over the local meta store (browser only). */
export function getAIUsageRepository(): AIUsageRepository {
  return (appRepository ??= createAIUsageRepository(getPersistence().meta));
}

/** This calendar month so far, in local time. */
export function thisMonth(now: number = Date.now()): { from: number; to: number } {
  const date = new Date(now);
  return { from: new Date(date.getFullYear(), date.getMonth(), 1).getTime(), to: now };
}

/** Display names for plan-usage units; `scale` converts the stored amount to the displayed one. */
const SUBSCRIPTION_UNITS: Record<string, { label: string; scale: number }> = {
  nanoAiu: { label: "AI units", scale: 1e-9 },
  premium_request: { label: "premium requests", scale: 1 },
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n * 100) / 100);
}

/** One connection's totals as a short phrase, e.g. "12 requests · 3.4k tokens · 0.52 AI units". */
export function describeUsage(totals: AIUsageTotals): string {
  const parts = [`${totals.requests} ${totals.requests === 1 ? "request" : "requests"}`];
  const tokens = totals.promptTokens + totals.completionTokens;
  if (tokens > 0) parts.push(`${compact(tokens)} tokens`);
  for (const [unit, amount] of Object.entries(totals.subscription)) {
    const known = SUBSCRIPTION_UNITS[unit];
    parts.push(known ? `${compact(amount * known.scale)} ${known.label}` : `${compact(amount)} ${unit}`);
  }
  if (totals.reportedRequests === 0) parts.push("usage not reported by this provider");
  else if (totals.reportedRequests < totals.requests) parts.push(`${totals.requests - totals.reportedRequests} not reported`);
  return parts.join(" · ");
}
