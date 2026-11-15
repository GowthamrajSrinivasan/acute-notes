/**
 * Free rehearsal of the live retry-guard smoke test (§12.30): the REAL Copilot SDK runtime, the counting proxy, and a
 * LOCAL mock upstream instead of the provider. Opt-in because it starts the SDK runtime:
 *   COPILOT_RETRY_SPIKE=1 npx vitest run src/ai/contractTests/guardSmoke.rehearsal.test.ts
 */
import { describe, expect, it } from "vitest";
import { runGuardSmoke } from "./guardSmoke";
import { startMockUpstream } from "./mockUpstream";

describe.skipIf(process.env.COPILOT_RETRY_SPIKE !== "1")("live guard smoke test — offline rehearsal (mock upstream)", () => {
  it("injected 429 and 500: one arrival, nothing forwarded; live: one forwarded, providerRequests 1", async () => {
    const up = await startMockUpstream();
    try {
      const r = await runGuardSmoke({ upstream: up.url, apiKey: "local-mock", model: "mock-model", maxForwarded: 1, maxTokens: 4_500 });
      console.log(JSON.stringify({ ...r, arrivals: r.arrivals.map((a) => `${a.method} ${a.path} ${a.outcome} ${a.status} ${a.bytes}B max_tokens=${a.carried?.maxTokens} temperature=${a.carried?.temperature}`) }, null, 1));
      expect(r.cases.map((c) => [c.name, c.pass, c.checks])).toEqual(r.cases.map((c) => [c.name, true, Object.fromEntries(Object.keys(c.checks).map((k) => [k, true]))]));
      expect(r.passed).toBe(true);
      expect(up.hits.filter((h) => h.method === "POST")).toHaveLength(1);
    } finally {
      await up.close();
    }
  }, 300_000);
});
