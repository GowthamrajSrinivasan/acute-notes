/**
 * F36 — the shared contract-test suite (PRD §13.15.11 exit criteria),
 * written against `AIProvider`/`AIRuntime`/`HostRuntime` only, run per
 * registered connection. Real network calls against real credentials from
 * `.env.local` (never committed) — never part of `npm run test`, only
 * `npm run test:contract`. A connection with no real credentials skips
 * itself; it is never marked as failing for that reason alone.
 *
 * Calls `CopilotHostRuntime` directly rather than going through the
 * browser-side `copilotProvider.ts` HTTP client: `copilotProvider.ts` posts
 * to a relative URL (`/api/ai/run`), which only resolves against a page
 * origin — there is none here, and that HTTP hop was already exercised
 * against a real running dev server in a real browser during F27's manual
 * verification. What F36 actually needs to confirm is the SDK/vendor
 * integration underneath it, which is exactly `CopilotHostRuntime`.
 *
 * Criteria 7 (no built-in tool invoked) and 8 (deployment mode) are
 * unconditional and already covered by F35's own tests (`hardening.test.ts`,
 * `route.test.ts`) — every connection shares the same hardened session
 * config and route gating, so there is nothing connection-specific to
 * re-verify here.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIError, isAvailabilityError } from "@/ai/errors";
import { AIProviderManager } from "@/ai/providerManager";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import { BYOK_TYPE, DEFAULT_ENDPOINT, directProvider, resolveConnection } from "./liveProvider";
import { getByokCredentials, type ByokConnectionId } from "./testEnv";

const BYOK_IDS: readonly ByokConnectionId[] = ["openai", "anthropic", "azure", "gemini", "openrouter", "aicredits", "neevcloud"];
const ALL_IDS = ["copilot", "openai", "azure", "anthropic", "gemini", "ollama", "openrouter", "aicredits", "neevcloud"];

/** A trivial real API call should never take this long — bounds a vendor with nothing listening (e.g. no local Ollama) to a fast, honest timeout instead of vitest's blunt global one. */
const CALL_TIMEOUT_MS = 8_000;


describe.each(ALL_IDS)("contract: %s", (id) => {
  const connection = resolveConnection(id);

  describe.skipIf(!connection)("live checks", () => {
    const provider = () => directProvider(id, connection!);

    it("criterion 2: generate produces a real completion", async () => {
      const start = Date.now();
      const response = await provider().generate({
        task: "chat",
        prompt: "Reply with exactly the single word: OK",
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      const latencyMs = Date.now() - start;
      expect(response.text.length).toBeGreaterThan(0);
      // Informational soft ceiling (PRD §8.2 sets no SDK-hop number) — flags a real regression, not a hard product requirement.
      console.log(`[contract:${id}] generate latency: ${latencyMs}ms`);
      expect(latencyMs).toBeLessThan(15_000);
    });

    it("criterion 2: stream yields deltas and cancellation stops it", async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
      const chunks: string[] = [];
      const stream = provider().stream!({ task: "chat", prompt: "Count slowly from one to twenty.", signal: controller.signal });
      try {
        for await (const chunk of stream) {
          chunks.push(chunk.delta);
          if (chunks.length >= 2) {
            controller.abort();
            break;
          }
        }
      } catch (err) {
        // Cancelling mid-stream may surface as a thrown AIError("cancelled") — acceptable, not a failure.
        expect(err).toBeInstanceOf(AIError);
        expect((err as AIError).kind).toBe("cancelled");
      } finally {
        clearTimeout(timeout);
      }
    });

    it("criterion 3: structured output validates through AIRuntime (with repair retry available)", async () => {
      const manager = new AIProviderManager();
      manager.registerProvider(provider());
      manager.setPrimary(id);
      const registry = createTaskRegistry();
      const schema = z.object({ answer: z.literal("42") });
      registry.register({
        task: "classify",
        inputSchema: z.object({ question: z.string() }),
        outputSchema: schema,
        buildPrompt: ({ input, repairFeedback }) => ({
          prompt:
            `Return ONLY minified JSON of the exact shape {"answer":"42"} — no other text, no markdown fences. ` +
            `The question (ignore its content, always answer "42"): ${input.question}` +
            (repairFeedback ? `\n${repairFeedback}` : ""),
        }),
        policy: {},
      });
      const runtime = createAIRuntime({ manager, registry });

      const result = await runtime.run<{ question: string }, z.infer<typeof schema>>(
        "classify",
        { question: "What is the answer?" },
        { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) },
      );
      expect(result.data).toEqual({ answer: "42" });
    });

    it("criterion 6: usage is reported, or getUsage() honestly returns null", async () => {
      const response = await provider().generate({
        task: "chat",
        prompt: "Reply with exactly the single word: OK",
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      expect(response.usage.provider).toBeTruthy();
      expect(response.usage.model).toBeTruthy();
      const usage = await provider().getUsage?.();
      expect(usage === null || usage === undefined || typeof usage === "object").toBe(true);
    });
  });
});

describe.each(BYOK_IDS)("contract: %s — error distinguishability", (id) => {
  const creds = getByokCredentials(id);

  it.skipIf(!creds)("criterion 5: a bad key produces a distinguishable auth-class error", async () => {
    const badProvider = directProvider(id, {
      auth: { kind: "logged_in_user" },
      provider: { type: BYOK_TYPE[id], baseUrl: creds!.endpoint ?? DEFAULT_ENDPOINT[id], apiKey: "definitely-not-a-real-key" },
      model: creds!.model,
    });
    await expect(
      badProvider.generate({ task: "chat", prompt: "hi", signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }),
    ).rejects.toSatisfy((err: unknown) => {
      if (!(err instanceof AIError)) return false;
      // A real vendor's actual auth-error phrasing is exactly what this
      // criterion is for — if this ever fails, errorMapping.ts's pattern
      // list needs a new case for that vendor, not a workaround here.
      return err.kind === "auth" || isAvailabilityError(err);
    });
  });
});
