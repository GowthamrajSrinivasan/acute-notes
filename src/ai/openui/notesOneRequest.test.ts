/**
 * `generate_openui_notes` sends exactly one model request per run, capped (ai/requestPolicy.ts): the real runtime and the
 * real connection adapter, with `fetch` (the AI host) faked. No network, no model.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIProviderManager } from "@/ai/providerManager";
import { createCopilotProvider } from "@/ai/providers/copilot/copilotProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIUsage } from "@/ai/types";
import { generateOpenUiNotes, notesInputOf, registerOpenUiNotesTask, NOTES_MAX_OUTPUT_TOKENS } from "./notesTask";

const REPLY = 'root = IdeaCard("Keys expire", "After 24 hours a retry is a new payment.", "medium", [c1])\nc1 = CitationChip("u1")';
const USAGE: AIUsage = { provider: "copilot", model: "google/gemini-2.5-flash", promptTokens: 7_000, completionTokens: 1_900 };
const units = [{ id: "u1", text: "Keys expire after 24 hours." }];

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Answer = () => Response;

/** Primary and an enabled fallback connection, both BYOK; `answers` are the AI host's replies in order. */
function setup(answers: Answer[], onUsage = vi.fn(), onCall = vi.fn()) {
  const calls: { url: string; body: { request: Record<string, unknown>; provider?: unknown } }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      const answer = answers.shift();
      if (!answer) throw new Error("unexpected extra request");
      return answer();
    }),
  );
  const manager = new AIProviderManager();
  manager.registerProvider(createCopilotProvider({ id: "openrouter", byok: { type: "openai", baseUrl: "https://x.test/v1", apiKey: "k" }, defaultModel: "google/gemini-2.5-flash" }));
  manager.registerProvider(createCopilotProvider({ id: "aicredits", byok: { type: "openai", baseUrl: "https://y.test/v1", apiKey: "k2" }, defaultModel: "m2" }));
  manager.setPrimary("openrouter");
  manager.setFallback("aicredits");
  const registry = createTaskRegistry();
  registerOpenUiNotesTask(registry);
  return { runtime: createAIRuntime({ manager, registry, onUsage, onCall, rateLimitBackoffMs: [1, 1] }), calls, onUsage, onCall };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("generate_openui_notes: one request per run", () => {
  it("a failing first attempt is not retried: no repair, no fallback connection, one request with the cap and singleAttempt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { runtime, calls } = setup([() => json({ kind: "rate_limited", message: "slow down" }, 429), () => json({ text: REPLY, model: "m2", finishReason: "stop", usage: USAGE })]);

    await expect(generateOpenUiNotes(runtime, notesInputOf(units))).rejects.toMatchObject({ kind: "rate_limited", message: "slow down" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/ai/run");
    expect(calls[0]!.body.request).toMatchObject({ task: "generate_openui_notes", singleAttempt: true, maxTokens: NOTES_MAX_OUTPUT_TOKENS, timeoutMs: 120_000 });
    expect(calls[0]!.body.provider).toMatchObject({ baseUrl: "https://x.test/v1" });
  });

  it("a streaming run (the Notes view) uses the guarded one-shot route, never the stream route, and keeps the reported usage", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { runtime, calls } = setup([() => json({ text: REPLY, model: "google/gemini-2.5-flash", finishReason: "stop", usage: USAGE, providerRequests: 1 })]);
    const updates: boolean[] = [];

    const result = await generateOpenUiNotes(runtime, notesInputOf(units), { onUpdate: (u) => updates.push(u.done) });

    expect(calls.map((c) => c.url)).toEqual(["/api/ai/run"]);
    expect(calls[0]!.body.request).toMatchObject({ singleAttempt: true, maxTokens: NOTES_MAX_OUTPUT_TOKENS });
    expect(result.cards.map((c) => c.title)).toEqual(["Keys expire"]);
    expect(result.usage).toEqual(USAGE);
    expect(result.providerRequests).toBe(1);
    expect(updates.at(-1)).toBe(true);
    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.includes("AI usage"));
    expect(line).toContain("7000 input / 1900 output tokens");
    expect(line).toContain("model requests sent: 1");
    expect(line).toContain(`output cap ${NOTES_MAX_OUTPUT_TOKENS}`);
  });

  it("an empty reply is an error, not a repair request", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { runtime, calls, onCall } = setup([() => json({ text: "", model: "m", finishReason: "error", usage: USAGE })]);

    await expect(generateOpenUiNotes(runtime, notesInputOf(units))).rejects.toMatchObject({ kind: "invalid_output" });

    expect(calls).toHaveLength(1);
    expect(onCall).toHaveBeenCalledOnce();
    expect(onCall.mock.calls[0]![0]).toMatchObject({ task: "generate_openui_notes", attempt: 1, provider: "openrouter", promptTokens: 7_000, completionTokens: 1_900 });
  });

  it("a non-streaming run records its usage through the runtime (usage ledger and call log)", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { runtime, onUsage, onCall } = setup([() => json({ text: REPLY, model: "m", finishReason: "stop", usage: USAGE, providerRequests: 1 })]);

    await generateOpenUiNotes(runtime, notesInputOf(units));

    expect(onUsage).toHaveBeenCalledWith(USAGE);
    expect(onCall).toHaveBeenCalledWith(expect.objectContaining({ outcome: "ok", promptTokens: 7_000, completionTokens: 1_900 }));
  });

  it("each click is its own run, even when the caller reuses a signal", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const ok = () => json({ text: REPLY, model: "m", finishReason: "stop", usage: USAGE });
    const { runtime, calls } = setup([ok, ok]);
    const signal = new AbortController().signal;

    await generateOpenUiNotes(runtime, notesInputOf(units), { signal });
    await generateOpenUiNotes(runtime, notesInputOf(units), { signal });

    expect(calls).toHaveLength(2);
  });

  it("a cancelled run sends nothing", async () => {
    const { runtime, calls } = setup([]);
    const controller = new AbortController();
    controller.abort();

    await expect(generateOpenUiNotes(runtime, notesInputOf(units), { signal: controller.signal })).rejects.toMatchObject({ kind: "cancelled" });
    expect(calls).toHaveLength(0);
  });
});
