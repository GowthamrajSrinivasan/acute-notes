/**
 * A local counting forward proxy for the live retry-guard smoke test (plan §12.30). Used as the BYOK `baseUrl`, so EVERY
 * model request bound for the provider passes through it — from this process or from the SDK's own runtime process —
 * which makes its count the true outbound count below the SDK boundary.
 *
 * - `inject(arrival)` may answer a model request locally (e.g. a 429 or 500) instead of forwarding it: that tests the
 *   retry path without paying for retries.
 * - `maxForwarded` is a HARD cap on requests forwarded to the provider, independent of the code under test: anything
 *   beyond it is answered locally with 503 and never leaves.
 * - Only POSTs count as model requests; other methods are forwarded uncounted (none are expected).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";

export interface ProxyArrival {
  n: number;
  at: number;
  method: string;
  path: string;
  bytes: number;
  outcome: "forwarded" | "injected" | "refused_cap" | "refused_admit" | "uncounted";
  /** Why `admit` refused it (a ceiling), when it did. */
  refusal?: string;
  status?: number;
  /** For model requests: the output cap and temperature the request carried (what the provider would see). */
  carried?: { maxTokens?: number; temperature?: number; fields: string[] };
  /** For forwarded requests: the reply body as the provider sent it (SSE or JSON), for usage accounting. */
  reply?: string;
}

export interface CountingProxy {
  url: string;
  arrivals: ProxyArrival[];
  forwarded(): number;
  setInject(inject: ((arrival: number) => { status: number; body: string } | null) | null): void;
  /** Starts a new case: arrival numbers restart at 1 (the cap does not reset). */
  resetCase(): void;
  close(): Promise<void>;
}

const HOP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "accept-encoding"]);
const readBody = (req: IncomingMessage) => new Promise<Buffer>((resolve, reject) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});

/** Conservative worst-case tokens of a model request: its bytes / 3 (input) plus its output cap. */
export function worstCaseTokens(body: Buffer): number {
  let cap = 0;
  try {
    const j = JSON.parse(body.toString("utf8")) as { max_tokens?: unknown; max_completion_tokens?: unknown; max_output_tokens?: unknown };
    for (const v of [j.max_tokens, j.max_completion_tokens, j.max_output_tokens]) if (typeof v === "number" && v > cap) cap = v;
  } catch {
    // not JSON
  }
  // No output cap in the request = unbounded: reported as such so a ceiling refuses it.
  return cap > 0 ? Math.ceil(body.length / 3) + cap : Number.POSITIVE_INFINITY;
}

export async function startCountingProxy(options: {
  upstream: string;
  maxForwarded: number;
  fetchImpl?: typeof fetch;
  /** Checked before forwarding (never for injected answers): a reason string refuses it locally with 503. */
  admit?: (body: Buffer) => string | null;
}): Promise<CountingProxy> {
  const doFetch = options.fetchImpl ?? fetch;
  const arrivals: ProxyArrival[] = [];
  let caseArrivals = 0;
  let forwarded = 0;
  let inject: ((arrival: number) => { status: number; body: string } | null) | null = null;
  const upstream = new URL(options.upstream);
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    const method = (req.method ?? "GET").toUpperCase();
    // The SDK addresses `${baseUrl}/chat/completions`; strip the proxy's own base path and add the upstream's.
    const path = (req.url ?? "/").replace(/^\/v1/, "");
    const record: ProxyArrival = { n: 0, at: Date.now(), method, path, bytes: body.length, outcome: "uncounted" };
    arrivals.push(record);
    if (method === "POST") {
      record.n = ++caseArrivals;
      try {
        const j = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
        record.carried = { ...(typeof j.max_tokens === "number" ? { maxTokens: j.max_tokens } : {}), ...(typeof j.temperature === "number" ? { temperature: j.temperature } : {}), fields: Object.keys(j).sort() };
      } catch {
        record.carried = { fields: [] };
      }
      const injected = inject?.(record.n);
      if (injected) {
        record.outcome = "injected";
        record.status = injected.status;
        res.writeHead(injected.status, { "content-type": "application/json" }).end(injected.body);
        return;
      }
      const refusal = options.admit?.(body) ?? null;
      if (refusal) {
        record.outcome = "refused_admit";
        record.refusal = refusal;
        record.status = 503;
        res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `smoke-test proxy: ${refusal}, not sent` } }));
        return;
      }
      if (forwarded >= options.maxForwarded) {
        record.outcome = "refused_cap";
        record.status = 503;
        res.writeHead(503, { "content-type": "application/json" }).end('{"error":{"message":"smoke-test proxy: forward cap reached, not sent"}}');
        return;
      }
      forwarded++;
      record.outcome = "forwarded";
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && typeof v === "string") headers[k] = v;
    try {
      const target = `${upstream.origin}${upstream.pathname.replace(/\/$/, "")}${path}`;
      const up = await doFetch(target, { method, headers, ...(method === "GET" || method === "HEAD" ? {} : { body: new Uint8Array(body) }), redirect: "error" });
      record.status = up.status;
      const out: Record<string, string> = {};
      up.headers.forEach((v, k) => {
        if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) out[k] = v;
      });
      res.writeHead(up.status, out);
      if (!up.body) return void res.end();
      let captured = "";
      const stream = Readable.fromWeb(up.body as never);
      stream.on("data", (c: Buffer) => {
        if (captured.length < 200_000) captured += c.toString("utf8");
      });
      stream.on("end", () => void (record.reply = captured));
      stream.pipe(res);
    } catch (err) {
      record.status = 502;
      res.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `smoke-test proxy: upstream failed: ${(err as Error).message}` } }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    arrivals,
    forwarded: () => forwarded,
    setInject: (fn) => void (inject = fn),
    resetCase: () => void (caseArrivals = 0),
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** Prompt/completion tokens from a forwarded reply (JSON, or the last SSE chunk carrying `usage`). */
export function usageFromReply(reply: string | undefined): { promptTokens?: number; completionTokens?: number } {
  if (!reply) return {};
  const candidates = reply.trim().startsWith("{") ? [reply] : reply.split(/\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).filter((l) => l && l !== "[DONE]");
  for (const c of candidates.reverse()) {
    try {
      const u = (JSON.parse(c) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
      if (u && (typeof u.prompt_tokens === "number" || typeof u.completion_tokens === "number")) return { ...(typeof u.prompt_tokens === "number" ? { promptTokens: u.prompt_tokens } : {}), ...(typeof u.completion_tokens === "number" ? { completionTokens: u.completion_tokens } : {}) };
    } catch {
      // not JSON
    }
  }
  return {};
}
