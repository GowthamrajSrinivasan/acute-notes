/**
 * A `JudgeTransport` for an OpenAI-compatible chat-completions endpoint (intelligent-update-engine-plan §12.25). It lives
 * under `contractTests/` because it speaks one vendor protocol (the vendor-name guard allows that only here) — it is what
 * the evaluation recorder uses (AICredits, gpt-oss-120b), so a recording goes through `sendJudgeCall` exactly as the app
 * would. **One HTTP request per call:** no retry on 429 or 5xx (a failed call fails its pairs; "paid retries: none").
 * `max_tokens` covers reasoning and answer together on these endpoints, so the cap is real (`capsOutput: true`).
 */
import type { JudgeTransport } from "@/ai/consistency/judgeCall";

export interface HttpJudgeExchange {
  status: number;
  /** The provider's raw reply body (or error text), kept for the record. */
  body: string;
  ms: number;
}

export function openAICompatibleJudgeTransport(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  /** Called once per request with the raw exchange (the recorder stores it). */
  onExchange?: (exchange: HttpJudgeExchange) => void;
}): JudgeTransport {
  const doFetch = options.fetchImpl ?? fetch;
  return {
    id: `openai-compatible:${options.model}`,
    capsOutput: true,
    async send(request) {
      const started = Date.now();
      const timeout = AbortSignal.timeout(request.timeoutMs);
      const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
      const res = await doFetch(`${options.endpoint}/chat/completions`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          max_tokens: request.maxTokens,
          reasoning_effort: request.reasoningEffort,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.prompt },
          ],
        }),
        signal,
      });
      const body = await res.text();
      options.onExchange?.({ status: res.status, body, ms: Date.now() - started });
      if (!res.ok) throw new Error(`http ${res.status}`);
      let parsed: { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error("the provider's response was not JSON");
      }
      const choice = parsed.choices?.[0];
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      const promptTokens = num(parsed.usage?.prompt_tokens);
      const completionTokens = num(parsed.usage?.completion_tokens);
      return {
        text: typeof choice?.message?.content === "string" ? choice.message.content : "",
        finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
        usage: { ...(promptTokens !== undefined ? { promptTokens } : {}), ...(completionTokens !== undefined ? { completionTokens } : {}) },
      };
    },
  };
}
