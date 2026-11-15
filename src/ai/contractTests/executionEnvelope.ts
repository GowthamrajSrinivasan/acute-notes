/**
 * An external execution envelope for a paid recording (plan §12.33): it wraps `fetch` around frozen evaluation code that
 * may not be edited, and enforces the approved ceilings on what is ACTUALLY sent and spent.
 *
 * Before each model request (a POST whose path ends in `/chat/completions`) it requires:
 * - at most `maxRequests` model requests in total (one per planned call: no retry, fallback or repair can pass);
 * - a numeric `max_tokens` in the request (the provider-enforced output limit);
 * - tokens spent so far (provider-reported prompt + completion; a reply without usage is charged its whole worst case)
 *   + this request's worst case ≤ `maxTokens`, where worst case = ⌈message characters ÷ 4⌉ + `templateMargin` +
 *   `max_tokens`;
 * - the same in dollars, at the larger per-token price, ≤ `maxUsd`.
 * A request that fails any check is NOT sent: it is refused locally (the caller sees a failed call, recorded as such).
 *
 * Because past usage is known exactly and only the next request is estimated, the total can't pass the ceiling unless
 * the template margin is exceeded — the margin is set above the largest excess ever measured.
 */

export interface EnvelopeLimits {
  maxRequests: number;
  maxTokens: number;
  maxUsd: number;
  /** Per-token prices (USD); the larger is applied to every token. */
  price: { input: number; output: number };
  /** Input tokens the chat template adds beyond characters ÷ 4 (measured ≤ 39 on this prompt). */
  templateMargin: number;
}

export interface EnvelopeEntry {
  n: number;
  at: string;
  decision: "sent" | "refused";
  reason?: string;
  maxTokens?: number;
  estimatedInput?: number;
  worstCase?: number;
  spentBefore: number;
  usage?: { promptTokens?: number; completionTokens?: number };
  charged?: number;
  status?: number;
}

export interface Envelope {
  fetch: typeof fetch;
  log: EnvelopeEntry[];
  totals(): { sent: number; refused: number; spentTokens: number; spentUsdUpperBound: number };
}

const isModelRequest = (url: string, method: string) => method.toUpperCase() === "POST" && new URL(url).pathname.endsWith("/chat/completions");

export function createExecutionEnvelope(base: typeof fetch, limits: EnvelopeLimits, onEntry?: (entry: EnvelopeEntry) => void): Envelope {
  const log: EnvelopeEntry[] = [];
  const perToken = Math.max(limits.price.input, limits.price.output);
  let sent = 0;
  let refused = 0;
  let spent = 0;
  const record = (e: EnvelopeEntry) => {
    log.push(e);
    onEntry?.(e);
  };
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    if (!isModelRequest(url, method)) return base(input, init);
    const n = sent + refused + 1;
    const refuse = (reason: string, extra: Partial<EnvelopeEntry> = {}): never => {
      refused++;
      record({ n, at: new Date().toISOString(), decision: "refused", reason, spentBefore: spent, ...extra });
      throw new Error(`execution envelope: not sent — ${reason}`);
    };
    let body: { max_tokens?: unknown; messages?: { content?: unknown }[] };
    try {
      body = JSON.parse(typeof init?.body === "string" ? init.body : "") as typeof body;
    } catch {
      return refuse("request body is not JSON");
    }
    if (sent >= limits.maxRequests) return refuse(`request limit ${limits.maxRequests} reached`);
    if (typeof body.max_tokens !== "number" || !Number.isInteger(body.max_tokens) || body.max_tokens <= 0) return refuse("no numeric max_tokens (output limit)");
    const chars = (body.messages ?? []).reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
    const estimatedInput = Math.ceil(chars / 4) + limits.templateMargin;
    const worstCase = estimatedInput + body.max_tokens;
    const facts = { maxTokens: body.max_tokens, estimatedInput, worstCase };
    if (spent + worstCase > limits.maxTokens) return refuse(`token ceiling: ${spent} spent + ${worstCase} worst case > ${limits.maxTokens}`, facts);
    if ((spent + worstCase) * perToken > limits.maxUsd) return refuse(`dollar ceiling: $${((spent + worstCase) * perToken).toFixed(5)} > $${limits.maxUsd}`, facts);
    sent++;
    const entry: EnvelopeEntry = { n, at: new Date().toISOString(), decision: "sent", spentBefore: spent, ...facts };
    try {
      const res = await base(input, init);
      entry.status = res.status;
      let usage: EnvelopeEntry["usage"];
      try {
        const u = (JSON.parse(await res.clone().text()) as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
        if (u && typeof u.prompt_tokens === "number" && typeof u.completion_tokens === "number") usage = { promptTokens: u.prompt_tokens, completionTokens: u.completion_tokens };
      } catch {
        // no readable usage
      }
      // Charged: the reported usage, or — when none is reported — the whole worst case (never less than could be billed).
      const charged = usage ? usage.promptTokens! + usage.completionTokens! : worstCase;
      spent += charged;
      record({ ...entry, ...(usage ? { usage } : {}), charged });
      return res;
    } catch (err) {
      spent += worstCase;
      record({ ...entry, charged: worstCase, reason: `transport error: ${(err as Error).message.slice(0, 120)}` });
      throw err;
    }
  }) as typeof fetch;
  return {
    fetch: wrapped,
    log,
    totals: () => ({ sent, refused, spentTokens: spent, spentUsdUpperBound: spent * perToken }),
  };
}
