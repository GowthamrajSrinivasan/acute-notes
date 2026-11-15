/** A local OpenAI-compatible upstream for offline tests (no model): answers chat completions, JSON or SSE. */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export async function startMockUpstream(): Promise<{ url: string; hits: { method: string; path: string; bytes: number; stream?: boolean }[]; close(): Promise<void> }> {
  const hits: { method: string; path: string; bytes: number; stream?: boolean }[] = [];
  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: { stream?: boolean } = {};
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        // not JSON
      }
      hits.push({ method: req.method ?? "", path: req.url ?? "", bytes: Buffer.byteLength(body), stream: parsed.stream });
      const usage = { prompt_tokens: 42, completion_tokens: 1, total_tokens: 43 };
      // A consistency-check prompt (pairs p1, p2, …) gets a judge-format answer; anything else gets "OK".
      const prompt = ((parsed as { messages?: { content?: unknown }[] }).messages ?? []).map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
      const refs = prompt.match(/^p\d+$/gm) ?? [];
      const content = refs.length ? JSON.stringify({ results: refs.map((ref) => ({ ref, answer: "contradicts", why: "mock" })) }) : "OK";
      if (parsed.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage })}\n\n`);
        return void res.end("data: [DONE]\n\n");
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: "c1", object: "chat.completion", created: 1, model: "mock", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, hits, close: () => new Promise((r) => server.close(() => r())) };
}
