import { afterEach, describe, expect, it, vi } from "vitest";
import { AIError } from "@/ai/errors";
import type { HostGenerateInput, HostRuntime } from "@/ai/host/hostRuntime";
import { ANTHROPIC_VERSION, directBody, directGenerate, directStream, directUrl, goesDirect, resetDirectChatAdjustments, withDirectByok } from "./directChat";

const PROVIDER = { type: "openai" as const, baseUrl: "https://api.example.test/v1", apiKey: "sk-test-not-real" };
const input = (over: Partial<HostGenerateInput["request"]> = {}, provider: HostGenerateInput["provider"] = PROVIDER): HostGenerateInput => ({
  request: { task: "generate_visual_plan", systemPrompt: "You plan notes.", prompt: "Content to visualize:\n\nA.", model: "openai/gpt-oss-120b", maxTokens: 2_000, temperature: 0.2, ...over },
  auth: { kind: "logged_in_user" },
  ...(provider ? { provider } : {}),
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const reply = (text: string, finish = "stop") => ok({ model: "openai/gpt-oss-120b", choices: [{ message: { content: text }, finish_reason: finish }], usage: { prompt_tokens: 120, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 10 } } });

function fakeFetch(...responses: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetch: fn as unknown as typeof fetch, calls, body: (i = 0) => JSON.parse(String(calls[i]!.init.body)) as Record<string, unknown> };
}

const inner = (): HostRuntime & { generate: ReturnType<typeof vi.fn>; stream: ReturnType<typeof vi.fn> } => ({
  id: "copilot",
  generate: vi.fn(async () => ({ text: "via copilot", model: "m", finishReason: "stop" as const, usage: { provider: "copilot", model: "m" } })),
  stream: vi.fn(async function* () {
    yield { delta: "via copilot", done: true };
  }),
  listModels: vi.fn(async () => []),
});

afterEach(() => {
  delete process.env.ACUTE_BYOK_DIRECT;
  resetDirectChatAdjustments();
  vi.useRealTimers();
});

describe("#7: which calls go direct", () => {
  it("a plain chat-completions BYOK call with a model does", () => {
    expect(goesDirect(input())).toBe(true);
    expect(goesDirect(input({}, { ...PROVIDER, wireApi: "completions" }))).toBe(true);
    expect(goesDirect(input({}, { type: "openai", baseUrl: "http://localhost:11434/v1" }))).toBe(true); // a local endpoint, no key
    expect(goesDirect(input({}, { ...PROVIDER, type: "anthropic" }))).toBe(true); // §19.1
    expect(goesDirect(input({}, { ...PROVIDER, wireApi: "responses" }))).toBe(true); // §19.1
  });
  it("everything else stays on the Copilot runtime", () => {
    expect(goesDirect(input({}, null as never))).toBe(false); // a GitHub Copilot connection: no BYOK provider
    expect(goesDirect(input({}, { ...PROVIDER, type: "azure" }))).toBe(false); // its route is the SDK's to resolve
    expect(goesDirect(input({ model: undefined }))).toBe(false);
    expect(goesDirect(input({ singleAttempt: true }))).toBe(false); // the recorded guard path
    expect(goesDirect(input({}, { ...PROVIDER, baseUrl: "https://user:pw@api.example.test/v1" }))).toBe(false);
    expect(goesDirect(input({}, { ...PROVIDER, baseUrl: "file:///etc/passwd" }))).toBe(false);
  });
  it("ACUTE_BYOK_DIRECT=off sends every call through the Copilot runtime as before", () => {
    process.env.ACUTE_BYOK_DIRECT = "off";
    expect(goesDirect(input())).toBe(false);
  });
});

describe("#7: the request carries the caller's cap and temperature, nothing added", () => {
  it("max_tokens, temperature, reasoning effort and the two messages — no other system prompt", () => {
    expect(directBody(input({ reasoningEffort: "low" }), false)).toEqual({
      model: "openai/gpt-oss-120b",
      max_tokens: 2_000,
      temperature: 0.2,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: "You plan notes." },
        { role: "user", content: "Content to visualize:\n\nA." },
      ],
    });
  });
  it("leaves out what the caller didn't set (no invented cap or temperature)", () => {
    const body = directBody(input({ maxTokens: undefined, temperature: undefined, systemPrompt: undefined }), true);
    expect(body).toEqual({ model: "openai/gpt-oss-120b", messages: [{ role: "user", content: "Content to visualize:\n\nA." }], stream: true });
    expect(directBody(input({ maxTokens: 0 }), false)).not.toHaveProperty("max_tokens");
  });
  it("one POST to <baseUrl>/chat/completions with the key, redirects refused", async () => {
    const f = fakeFetch(reply("{}"));
    const r = await directGenerate(input(), f.fetch);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe("https://api.example.test/v1/chat/completions");
    expect(f.calls[0]!.init).toMatchObject({ method: "POST", redirect: "error" });
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test-not-real");
    expect(f.body()).toMatchObject({ max_tokens: 2_000, temperature: 0.2 });
    expect(r).toEqual({ text: "{}", model: "openai/gpt-oss-120b", finishReason: "stop", usage: { provider: "copilot", model: "openai/gpt-oss-120b", promptTokens: 120, completionTokens: 30, reasoningTokens: 10 }, providerRequests: 1 });
  });
  it("a reply cut at the cap says so (finishReason length)", async () => {
    const f = fakeFetch(reply("{\"nodes\":[", "length"));
    expect((await directGenerate(input(), f.fetch)).finishReason).toBe("length");
  });
});

describe("#7/#8: at most two requests", () => {
  it("one retry on 429 / 5xx, then the answer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const f = fakeFetch(new Response("busy", { status: 503 }), reply("ok"));
    const p = directGenerate(input(), f.fetch);
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ text: "ok", providerRequests: 2 });
    expect(f.calls).toHaveLength(2);
  });
  it("never a third: a second 429 is a rate-limit error with fixed text", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const f = fakeFetch(new Response("slow down", { status: 429, headers: { "retry-after": "2" } }), new Response("prompt was: secret notes", { status: 429 }));
    const p = directGenerate(input(), f.fetch).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const err = (await p) as AIError;
    expect(err).toBeInstanceOf(AIError);
    expect(err.kind).toBe("rate_limited");
    expect(err.message).not.toContain("secret");
    expect(f.calls).toHaveLength(2);
  });
  it("no retry on a 4xx: the key or the request is wrong", async () => {
    for (const [status, kind] of [[401, "auth"], [402, "quota_exhausted"], [400, "model_unavailable"]] as const) {
      const f = fakeFetch(new Response("{\"error\":\"echo of the prompt\"}", { status }));
      await expect(directGenerate(input(), f.fetch)).rejects.toMatchObject({ kind });
      expect(f.calls).toHaveLength(1);
    }
  });
  it("a cancel is a cancel, not retried", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = fakeFetch(new DOMException("aborted", "AbortError"));
    await expect(directGenerate(input({ signal: controller.signal }), f.fetch)).rejects.toMatchObject({ kind: "cancelled" });
    expect(f.calls).toHaveLength(1);
  });
  it("an unreadable reply is invalid output", async () => {
    await expect(directGenerate(input(), fakeFetch(new Response("not json", { status: 200 })).fetch)).rejects.toMatchObject({ kind: "invalid_output" });
    await expect(directGenerate(input(), fakeFetch(ok({ choices: [] })).fetch)).rejects.toMatchObject({ kind: "invalid_output" });
  });
});

describe("#7: streaming", () => {
  const sse = (lines: string[]) => new Response(new ReadableStream({ start(c) { const e = new TextEncoder(); for (const l of lines) c.enqueue(e.encode(l)); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });
  it("yields each content delta, then done; keep-alives and split lines are handled", async () => {
    const f = fakeFetch(sse([": keep-alive\n\n", 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n', '\ndata: {"choices":[{"delta":{"con', 'tent":"lo"}}]}\r\n\r\n', "data: [DONE]\n\n"]));
    const chunks = [];
    for await (const c of directStream(input(), f.fetch)) chunks.push(c);
    expect(chunks).toEqual([{ delta: "Hel", done: false }, { delta: "lo", done: false }, { delta: "", done: true }]);
    expect(f.body()).toMatchObject({ stream: true, max_tokens: 2_000, temperature: 0.2 });
  });
});

describe("withDirectByok: wraps the (frozen) Copilot runtime", () => {
  it("direct for a plain BYOK call; the Copilot runtime for anything else; models from the runtime", async () => {
    const copilot = inner();
    const f = fakeFetch(reply("direct"));
    const host = withDirectByok(copilot, f.fetch);
    expect(host.id).toBe("copilot");
    expect((await host.generate(input())).text).toBe("direct");
    expect((await host.generate(input({}, { ...PROVIDER, type: "azure" }))).text).toBe("via copilot");
    expect((await host.generate(input({ singleAttempt: true }))).text).toBe("via copilot");
    expect(copilot.generate).toHaveBeenCalledTimes(2);
    const streamed = [];
    for await (const c of host.stream(input({}, { ...PROVIDER, type: "azure" }))) streamed.push(c);
    expect(streamed).toEqual([{ delta: "via copilot", done: true }]);
    await host.listModels({ kind: "logged_in_user" });
    expect(copilot.listModels).toHaveBeenCalled();
  });
});

describe("#7: a model that refuses a parameter", () => {
  const refusal = (msg: string) => new Response(JSON.stringify({ error: { message: msg } }), { status: 400 });
  it("max_tokens → max_completion_tokens once, the cap kept, and remembered for that endpoint and model", async () => {
    const f = fakeFetch(refusal("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."), reply("ok"), reply("again"));
    expect((await directGenerate(input(), f.fetch)).text).toBe("ok");
    expect(f.body(0)).toHaveProperty("max_tokens", 2_000);
    expect(f.body(1)).not.toHaveProperty("max_tokens");
    expect(f.body(1)).toHaveProperty("max_completion_tokens", 2_000);
    expect((await directGenerate(input(), f.fetch)).text).toBe("again");
    expect(f.calls).toHaveLength(3); // the next call is sent right the first time
    expect(f.body(2)).toHaveProperty("max_completion_tokens", 2_000);
  });
  it("a temperature only the default is accepted for: sent without it", async () => {
    const f = fakeFetch(refusal("Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported."), reply("ok"));
    expect((await directGenerate(input(), f.fetch)).text).toBe("ok");
    expect(f.body(1)).not.toHaveProperty("temperature");
    expect(f.body(1)).toHaveProperty("max_tokens", 2_000);
  });
  it("any other 400 is a refusal with fixed text, not retried", async () => {
    const f = fakeFetch(refusal("The model 'nope' does not exist. Your prompt was: secret"));
    await expect(directGenerate(input(), f.fetch)).rejects.toMatchObject({ kind: "model_unavailable", message: expect.not.stringContaining("secret") });
    expect(f.calls).toHaveLength(1);
  });
});

const sse = (lines: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        const e = new TextEncoder();
        for (const l of lines) c.enqueue(e.encode(l));
        c.close();
      },
    }),
    { status: 200 },
  );

describe("§19.1: Anthropic Messages, sent direct", () => {
  const ANTHROPIC = { type: "anthropic" as const, baseUrl: "https://api.anthropic.com", apiKey: "sk-ant-test-not-real" };
  const message = (text: string, stop = "end_turn") => ok({ model: "claude-x", content: [{ type: "text", text }], stop_reason: stop, usage: { input_tokens: 90, output_tokens: 12 } });

  it("POST <base>/v1/messages (or /messages under a /v1 base) with x-api-key and the API version", async () => {
    expect(directUrl(ANTHROPIC)).toBe("https://api.anthropic.com/v1/messages");
    expect(directUrl({ ...ANTHROPIC, baseUrl: "https://proxy.example.test/anthropic/v1/" })).toBe("https://proxy.example.test/anthropic/v1/messages");
    const f = fakeFetch(message("{}"));
    const r = await directGenerate(input({ model: "claude-x" }, ANTHROPIC), f.fetch);
    const headers = f.calls[0]!.init.headers as Record<string, string>;
    expect(f.calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(headers).toMatchObject({ "x-api-key": "sk-ant-test-not-real", "anthropic-version": ANTHROPIC_VERSION });
    expect(headers).not.toHaveProperty("authorization");
    expect(r).toEqual({ text: "{}", model: "claude-x", finishReason: "stop", usage: { provider: "copilot", model: "claude-x", promptTokens: 90, completionTokens: 12 }, providerRequests: 1 });
  });

  it("the body: max_tokens (always: Anthropic requires it), temperature, system, one user message; no reasoning effort", () => {
    expect(directBody(input({ reasoningEffort: "high" }, ANTHROPIC), false)).toEqual({
      model: "openai/gpt-oss-120b",
      max_tokens: 2_000,
      temperature: 0.2,
      system: "You plan notes.",
      messages: [{ role: "user", content: "Content to visualize:\n\nA." }],
    });
    expect(directBody(input({ maxTokens: undefined, temperature: undefined }, ANTHROPIC), true)).toEqual({
      model: "openai/gpt-oss-120b",
      max_tokens: 16_384,
      system: "You plan notes.",
      messages: [{ role: "user", content: "Content to visualize:\n\nA." }],
      stream: true,
    });
  });

  it("a reply cut at the cap says so", async () => {
    expect((await directGenerate(input({}, ANTHROPIC), fakeFetch(message('{"a":', "max_tokens")).fetch)).finishReason).toBe("length");
  });

  it("a cap above the model's own output limit is lowered to it once, and remembered", async () => {
    const tooBig = new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: 16384 > 8192, which is the maximum allowed number of output tokens for claude-x" } }), { status: 400 });
    const f = fakeFetch(tooBig, message("ok"), message("again"));
    expect((await directGenerate(input({ model: "claude-x", maxTokens: 16_384 }, ANTHROPIC), f.fetch)).text).toBe("ok");
    expect(f.body(1)).toHaveProperty("max_tokens", 8_192);
    expect((await directGenerate(input({ model: "claude-x", maxTokens: 16_384 }, ANTHROPIC), f.fetch)).text).toBe("again");
    expect(f.calls).toHaveLength(3);
    expect(f.body(2)).toHaveProperty("max_tokens", 8_192);
  });

  it("one retry on an overloaded 529, never a third", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const f = fakeFetch(new Response("overloaded", { status: 529 }), new Response("overloaded", { status: 529 }));
    const p = directGenerate(input({}, ANTHROPIC), f.fetch).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    expect(await p).toMatchObject({ kind: "network" });
    expect(f.calls).toHaveLength(2);
  });

  it("streams text deltas until message_stop; an error event fails with fixed text", async () => {
    const f = fakeFetch(
      sse([
        'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
        'event: ping\ndata: {"type":"ping"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
      sse(['event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"echo: secret"}}\n\n']),
    );
    const chunks = [];
    for await (const c of directStream(input({}, ANTHROPIC), f.fetch)) chunks.push(c);
    expect(chunks).toEqual([
      { delta: "Hel", done: false },
      { delta: "lo", done: false },
      { delta: "", done: true },
    ]);
    expect(f.body()).toMatchObject({ stream: true, max_tokens: 2_000 });
    const failed = (async () => {
      for await (const c of directStream(input({}, ANTHROPIC), f.fetch)) void c;
    })();
    await expect(failed).rejects.toMatchObject({ kind: "network", message: expect.not.stringContaining("secret") });
  });
});

describe("§19.1: the OpenAI responses API, sent direct", () => {
  const RESPONSES = { ...PROVIDER, wireApi: "responses" as const };
  const response = (text: string, over: Record<string, unknown> = {}) =>
    ok({
      model: "gpt-x",
      status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", content: [{ type: "output_text", text }] },
      ],
      usage: { input_tokens: 50, output_tokens: 20, output_tokens_details: { reasoning_tokens: 8 } },
      ...over,
    });

  it("POST <base>/responses: max_output_tokens, temperature, reasoning effort, instructions and input, not stored", async () => {
    expect(directBody(input({ reasoningEffort: "low" }, RESPONSES), false)).toEqual({
      model: "openai/gpt-oss-120b",
      max_output_tokens: 2_000,
      temperature: 0.2,
      reasoning: { effort: "low" },
      instructions: "You plan notes.",
      input: "Content to visualize:\n\nA.",
      store: false,
    });
    const f = fakeFetch(response("{}"));
    const r = await directGenerate(input({}, RESPONSES), f.fetch);
    expect(f.calls[0]!.url).toBe("https://api.example.test/v1/responses");
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test-not-real");
    expect(r).toEqual({ text: "{}", model: "gpt-x", finishReason: "stop", usage: { provider: "copilot", model: "gpt-x", promptTokens: 50, completionTokens: 20, reasoningTokens: 8 }, providerRequests: 1 });
  });

  it("an incomplete reply at the cap says so; a reply without output is invalid", async () => {
    const cut = response('{"a":', { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
    expect((await directGenerate(input({}, RESPONSES), fakeFetch(cut).fetch)).finishReason).toBe("length");
    await expect(directGenerate(input({}, RESPONSES), fakeFetch(ok({ model: "gpt-x" })).fetch)).rejects.toMatchObject({ kind: "invalid_output" });
  });

  it("a reasoning model that refuses temperature: sent once more without it, the cap kept", async () => {
    const f = fakeFetch(new Response(JSON.stringify({ error: { message: "Unsupported parameter: 'temperature' is not supported with this model." } }), { status: 400 }), response("ok"));
    expect((await directGenerate(input({}, RESPONSES), f.fetch)).text).toBe("ok");
    expect(f.body(1)).not.toHaveProperty("temperature");
    expect(f.body(1)).toHaveProperty("max_output_tokens", 2_000);
  });

  it("streams output_text deltas until the response completes", async () => {
    const f = fakeFetch(
      sse([
        'event: response.created\ndata: {"type":"response.created"}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
        'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n',
        'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n',
      ]),
    );
    const chunks = [];
    for await (const c of directStream(input({}, RESPONSES), f.fetch)) chunks.push(c);
    expect(chunks).toEqual([
      { delta: "Hel", done: false },
      { delta: "lo", done: false },
      { delta: "", done: true },
    ]);
    expect(f.body()).toMatchObject({ stream: true, max_output_tokens: 2_000 });
  });
});
