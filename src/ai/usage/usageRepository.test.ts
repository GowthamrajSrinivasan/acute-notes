import { describe, expect, it } from "vitest";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { createAIUsageRepository, describeUsage, thisMonth, type AIUsageTotals } from "./usageRepository";

function setup(start: Date) {
  let now = start.getTime();
  const meta = createMemoryServices().meta;
  const repo = createAIUsageRepository(meta, () => now);
  return { repo, meta, setNow: (d: Date) => (now = d.getTime()) };
}

describe("AIUsageRepository", () => {
  it("sums what each connection reported, per connection", async () => {
    const { repo } = setup(new Date(2026, 8, 27, 10));
    await repo.record({ provider: "copilot", model: "gpt-5", promptTokens: 100, completionTokens: 20, subscriptionUsage: { unit: "nanoAiu", amount: 5e8 } });
    await repo.record({ provider: "copilot", model: "gpt-5", promptTokens: 50, completionTokens: 10, subscriptionUsage: { unit: "nanoAiu", amount: 5e8 } });
    await repo.record({ provider: "gemini", model: "gemini-2.5-flash", promptTokens: 7 });

    const summary = await repo.summarize(thisMonth(new Date(2026, 8, 27, 12).getTime()));
    expect(summary.byProvider).toEqual({
      copilot: { requests: 2, reportedRequests: 2, promptTokens: 150, completionTokens: 30, subscription: { nanoAiu: 1e9 } },
      gemini: { requests: 1, reportedRequests: 1, promptTokens: 7, completionTokens: 0, subscription: {} },
    });
  });

  it("counts a request that reported nothing as a request only, never an estimate", async () => {
    const { repo } = setup(new Date(2026, 8, 27));
    await repo.record({ provider: "openai", model: "" });
    const summary = await repo.summarize(thisMonth(new Date(2026, 8, 28).getTime()));
    expect(summary.byProvider.openai).toEqual({ requests: 1, reportedRequests: 0, promptTokens: 0, completionTokens: 0, subscription: {} });
  });

  it("summarizes only days inside the range, across month records", async () => {
    const { repo, setNow } = setup(new Date(2026, 7, 31, 23));
    await repo.record({ provider: "copilot", model: "m", promptTokens: 1 });
    setNow(new Date(2026, 8, 1, 1));
    await repo.record({ provider: "copilot", model: "m", promptTokens: 2 });
    setNow(new Date(2026, 8, 15));
    await repo.record({ provider: "copilot", model: "m", promptTokens: 4 });

    const september = await repo.summarize(thisMonth(new Date(2026, 8, 20).getTime()));
    expect(september.byProvider.copilot?.promptTokens).toBe(6);
    const both = await repo.summarize({ from: new Date(2026, 7, 31).getTime(), to: new Date(2026, 8, 1, 12).getTime() });
    expect(both.byProvider.copilot?.promptTokens).toBe(3);
  });

  it("loses no record when several finish together", async () => {
    const { repo } = setup(new Date(2026, 8, 27));
    await Promise.all(Array.from({ length: 20 }, () => repo.record({ provider: "copilot", model: "m", promptTokens: 1 })));
    const summary = await repo.summarize(thisMonth(new Date(2026, 8, 27, 1).getTime()));
    expect(summary.byProvider.copilot?.requests).toBe(20);
  });

  it("clear forgets the log", async () => {
    const { repo } = setup(new Date(2026, 8, 27));
    await repo.record({ provider: "copilot", model: "m" });
    await repo.clear();
    expect((await repo.summarize(thisMonth(new Date(2026, 8, 28).getTime()))).byProvider).toEqual({});
  });
});

describe("describeUsage", () => {
  const totals = (t: Partial<AIUsageTotals>): AIUsageTotals => ({
    requests: 0,
    reportedRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    subscription: {},
    ...t,
  });

  it("shows requests, tokens and plan units", () => {
    expect(describeUsage(totals({ requests: 3, reportedRequests: 3, promptTokens: 3000, completionTokens: 400, subscription: { nanoAiu: 1.5e9 } }))).toBe(
      "3 requests · 3.4k tokens · 1.5 AI units",
    );
  });

  it("says so when a provider reported nothing", () => {
    expect(describeUsage(totals({ requests: 1 }))).toBe("1 request · usage not reported by this provider");
  });

  it("flags partly-reported usage", () => {
    expect(describeUsage(totals({ requests: 4, reportedRequests: 3, promptTokens: 10 }))).toBe("4 requests · 10 tokens · 1 not reported");
  });
});
