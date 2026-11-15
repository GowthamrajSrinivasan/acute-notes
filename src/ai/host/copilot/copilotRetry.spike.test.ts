/**
 * Opt-in spike (COPILOT_RETRY_SPIKE=1): does the Copilot SDK runtime retry a model request internally?
 * (intelligent-update-engine-plan §12.29, P1.) No model and no paid provider: a BYOK connection points at a LOCAL mock
 * OpenAI-compatible server that counts every HTTP request that physically arrives. Run:
 *   COPILOT_RETRY_SPIKE=1 npx vitest run src/ai/host/copilot/copilotRetry.spike.test.ts
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCopilotHostRuntime } from "./CopilotHostRuntime";

const ON = process.env.COPILOT_RETRY_SPIKE === "1";

type Mode = "429" | "500" | "ok";
interface Hit { at: number; method: string; url: string; stream?: boolean }

let mode: Mode = "ok";
let hits: Hit[] = [];
let baseUrl = "";
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let parsed: { stream?: boolean } = {};
    try { parsed = JSON.parse(body || "{}"); } catch { /* not JSON */ }
    hits.push({ at: Date.now(), method: req.method ?? "", url: req.url ?? "", stream: parsed.stream });
    if (req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "mock-model", object: "model" }] })); return; }
    if (mode === "429") { res.writeHead(429, { "content-type": "application/json", "retry-after": "1" }); res.end(JSON.stringify({ error: { message: "rate limited", type: "rate_limit" } })); return; }
    if (mode === "500") { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "boom", type: "server_error" } })); return; }
    if (parsed.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      chunk({ id: "c1", object: "chat.completion.chunk", created: 1, model: "mock-model", choices: [{ index: 0, delta: { role: "assistant", content: "hello" }, finish_reason: null }] });
      chunk({ id: "c1", object: "chat.completion.chunk", created: 1, model: "mock-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } });
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "mock-model", choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } }));
  });
});

beforeAll(async () => {
  if (!ON) return;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(async () => { if (ON) await new Promise((r) => server.close(r)); });

async function once(m: Mode, singleAttempt = false) {
  mode = m;
  hits = [];
  const runtime = createCopilotHostRuntime();
  const started = Date.now();
  let outcome = "ok";
  let providerRequests: number | undefined;
  try {
    const r = await runtime.generate({ auth: { kind: "logged_in_user" }, provider: { type: "openai", baseUrl, apiKey: "local-mock" }, request: { task: "chat", prompt: "say hello", model: "mock-model", timeoutMs: 120_000, ...(singleAttempt ? { singleAttempt: true } : {}) } });
    outcome = `ok: ${r.text}`;
    providerRequests = r.providerRequests;
  } catch (e) {
    outcome = `error: ${(e as Error).message}`;
  }
  const posts = hits.filter((h) => h.method === "POST");
  console.log(JSON.stringify({ mode: m, singleAttempt, outcome, ms: Date.now() - started, posts: posts.length, providerRequests, all: hits.map((h) => `${h.method} ${h.url} +${h.at - started}ms`) }, null, 1));
  return { outcome, posts: posts.length, providerRequests };
}

describe.skipIf(!ON)("Copilot SDK internal retries (local mock provider, no model)", () => {
  // Measured 2026-11-15 (SDK 1.0.14): success 1 POST; 429 → 6 POSTs ("retried 5 times"); 500 → 6 POSTs.
  it("unguarded success: one physical POST", async () => { const r = await once("ok"); expect(r.posts).toBe(1); }, 180_000);
  it("unguarded 429: the runtime retries (more than one physical POST)", async () => { const r = await once("429"); expect(r.posts).toBeGreaterThan(1); }, 300_000);
  it("unguarded 500: the runtime retries (more than one physical POST)", async () => { const r = await once("500"); expect(r.posts).toBeGreaterThan(1); }, 300_000);
});

describe.skipIf(!ON)("singleAttempt guard (§12.29): exactly one physical POST per call, through the real SDK runtime", () => {
  it("success: one POST, providerRequests 1", async () => { const r = await once("ok", true); expect(r.posts).toBe(1); expect(r.providerRequests).toBe(1); expect(r.outcome).toBe("ok: hello"); }, 180_000);
  it("429: one POST reaches the provider; the call fails", async () => { const r = await once("429", true); expect(r.posts).toBe(1); expect(r.outcome).toMatch(/^error/); }, 300_000);
  it("500: one POST reaches the provider; the call fails", async () => { const r = await once("500", true); expect(r.posts).toBe(1); expect(r.outcome).toMatch(/^error/); }, 300_000);
});
