/** The smoke-test proxy (§12.30), offline: local mock upstream, no SDK, no provider. */
import { afterEach, describe, expect, it } from "vitest";
import { startCountingProxy, usageFromReply, worstCaseTokens, type CountingProxy } from "./countingProxy";
import { startMockUpstream } from "./mockUpstream";

const open: { close(): Promise<void> }[] = [];
afterEach(async () => void (await Promise.all(open.splice(0).map((x) => x.close()))));
const post = (p: CountingProxy, stream = false) => fetch(`${p.url}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer k" }, body: JSON.stringify({ model: "m", stream, messages: [] }) });

describe("counting proxy (§12.30)", () => {
  it("forwards a model request once, streams the reply through, and captures usage", async () => {
    const up = await startMockUpstream();
    const p = await startCountingProxy({ upstream: up.url, maxForwarded: 1 });
    open.push(up, p);
    const res = await post(p, true);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("[DONE]");
    expect(up.hits.map((h) => h.path)).toEqual(["/v1/chat/completions"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(usageFromReply(p.arrivals[0]!.reply)).toEqual({ promptTokens: 42, completionTokens: 1 });
  });

  it("injected failures are answered locally and never reach the upstream", async () => {
    const up = await startMockUpstream();
    const p = await startCountingProxy({ upstream: up.url, maxForwarded: 1 });
    open.push(up, p);
    p.setInject(() => ({ status: 429, body: "{}" }));
    expect((await post(p)).status).toBe(429);
    expect(up.hits).toHaveLength(0);
    expect(p.arrivals[0]!.outcome).toBe("injected");
  });

  it("the forward cap is hard: beyond it, nothing leaves (503 locally)", async () => {
    const up = await startMockUpstream();
    const p = await startCountingProxy({ upstream: up.url, maxForwarded: 1 });
    open.push(up, p);
    expect((await post(p)).status).toBe(200);
    expect((await post(p)).status).toBe(503);
    expect(up.hits).toHaveLength(1);
    expect(p.arrivals.map((a) => a.outcome)).toEqual(["forwarded", "refused_cap"]);
  });

  it("reads usage from a JSON reply or the last SSE chunk carrying it", () => {
    expect(usageFromReply('{"usage":{"prompt_tokens":3,"completion_tokens":4}}')).toEqual({ promptTokens: 3, completionTokens: 4 });
    expect(usageFromReply('data: {"choices":[]}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":6}}\n\ndata: [DONE]\n')).toEqual({ promptTokens: 5, completionTokens: 6 });
    expect(usageFromReply(undefined)).toEqual({});
  });
});

describe("counting proxy ceilings (§12.30)", () => {
  it("worst-case tokens = bytes/3 + the request's output cap; no cap = unbounded", () => {
    const body = JSON.stringify({ max_tokens: 100, x: "a".repeat(290) });
    expect(worstCaseTokens(Buffer.from(body))).toBe(Math.ceil(body.length / 3) + 100);
    expect(worstCaseTokens(Buffer.from("{}"))).toBe(Number.POSITIVE_INFINITY);
  });
  it("admit refuses a request over a ceiling before anything is forwarded", async () => {
    const up = await startMockUpstream();
    const p = await startCountingProxy({ upstream: up.url, maxForwarded: 1, admit: () => "over the token ceiling" });
    open.push(up, p);
    expect((await post(p)).status).toBe(503);
    expect(up.hits).toHaveLength(0);
    expect(p.arrivals[0]).toMatchObject({ outcome: "refused_admit", refusal: "over the token ceiling" });
  });
});
