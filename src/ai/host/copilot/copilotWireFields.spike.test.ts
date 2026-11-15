/**
 * Opt-in spike (COPILOT_RETRY_SPIKE=1, §12.30): which fields does the Copilot SDK runtime put on the wire for a BYOK
 * chat-completions request? Local mock upstream only; prints field names and non-message values, never the prompt.
 *
 * Measured 2026-11-15 (SDK 1.0.14): without the guard's overrides the request carries `model`, `messages`,
 * `reasoning_effort` and `temperature: 1` — NO output cap (ProviderConfig.maxOutputTokens never reaches the request) and
 * not the caller's temperature. With `singleAttempt`, the guard writes `max_tokens` and `temperature` itself.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createCopilotHostRuntime } from "./CopilotHostRuntime";

async function oneRequest(request: { singleAttempt?: boolean }) {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      bodies.push(JSON.parse(body || "{}") as Record<string, unknown>);
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    await createCopilotHostRuntime().generate({ auth: { kind: "logged_in_user" }, provider: { type: "openai", baseUrl, apiKey: "local" }, request: { task: "chat", prompt: "x", model: "mock-model", maxTokens: 512, temperature: 0, reasoningEffort: "low", timeoutMs: 60_000, ...request } });
  } finally {
    const b = bodies[0] ?? {};
    console.log(JSON.stringify({ singleAttempt: !!request.singleAttempt, requests: bodies.length, fields: Object.keys(b).sort(), values: Object.fromEntries(Object.entries(b).filter(([k]) => k !== "messages")) }));
    await new Promise((r) => server.close(r));
  }
  return bodies;
}

describe.skipIf(process.env.COPILOT_RETRY_SPIKE !== "1")("Copilot SDK request fields on the wire (BYOK, local mock)", () => {
  it("without the guard: no output cap and temperature 1 reach the request", async () => {
    const bodies = await oneRequest({});
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty("max_tokens");
  }, 120_000);
  it("with singleAttempt: the guard writes max_tokens and the caller's temperature into the one request", async () => {
    const bodies = await oneRequest({ singleAttempt: true });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ max_tokens: 512, temperature: 0, reasoning_effort: "low" });
  }, 120_000);
});
