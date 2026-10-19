/**
 * Runs before every AI spec: confirms the chosen AI connection (see
 * `e2e/aiProvider.ts`) actually works on this machine. If it doesn't, every
 * AI spec is skipped with one clear message instead of each failing on a
 * timeout.
 *
 * - Copilot: the AI host can reach GitHub Copilot with the account signed in
 *   to the Copilot CLI.
 * - Any BYOK connection (OpenAI, Anthropic, Azure, Gemini, OpenRouter, AICredits, NeevCloud): the key and model
 *   from `.env.local` answer a one-word request through the app's own AI
 *   host (`/api/ai/run`) — the same path a real BYOK connection uses, so
 *   each vendor's actual wire format is exercised, not a hand-rolled probe.
 */
import { expect, test as setup } from "@playwright/test";
import type { ByokConnectionId } from "../../src/ai/contractTests/testEnv";
import { AI_PROVIDER, AI_PROVIDER_NAME, byokCredentials } from "../aiProvider";

const BYOK_TYPE: Record<ByokConnectionId, "openai" | "anthropic" | "azure"> = {
  openai: "openai",
  anthropic: "anthropic",
  azure: "azure",
  gemini: "openai", // Gemini is used through its OpenAI-compatible endpoint (see registry.ts).
  openrouter: "openai", // Also a plain OpenAI-compatible endpoint — a model router, not a vendor SDK.
  aicredits: "openai", // Same shape: a model router over OpenAI-compatible chat/completions.
  neevcloud: "openai", // OpenAI-compatible inference over the user's own deployed models.
};

/** Mirrors registry.ts's own defaults — Azure has none (always the user's own resource). */
const DEFAULT_ENDPOINT: Partial<Record<ByokConnectionId, string>> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  openrouter: "https://openrouter.ai/api/v1",
  aicredits: "https://api.aicredits.in/v1",
  neevcloud: "https://inference.ai.neevcloud.com/v1",
};

if (AI_PROVIDER === "copilot") {
  setup("GitHub Copilot is signed in on this machine", async ({ request }) => {
    const res = await request.get("/api/ai/models", { timeout: 60_000 });
    const body = await res.text();
    expect(
      res.ok(),
      `The AI host couldn't reach GitHub Copilot (HTTP ${res.status()}): ${body.slice(0, 300)}\n` +
        "Sign in with `copilot login` in a terminal, then run `npm run test:e2e:ai` again.",
    ).toBe(true);
    const models = JSON.parse(body) as unknown[];
    expect(models.length, "Copilot returned no models for this account — check the subscription.").toBeGreaterThan(0);
  });
} else {
  const id = AI_PROVIDER;
  setup(`the ${AI_PROVIDER_NAME[id]} key and model in .env.local work`, async ({ request }) => {
    const creds = byokCredentials(id);
    const res = await request.post("/api/ai/run", {
      data: {
        request: { task: "chat", prompt: "Reply with exactly the single word: OK", model: creds.model },
        provider: { type: BYOK_TYPE[id], baseUrl: creds.endpoint ?? DEFAULT_ENDPOINT[id], apiKey: creds.apiKey },
      },
      timeout: 30_000,
    });
    const body = await res.text();
    expect(
      res.ok(),
      `${AI_PROVIDER_NAME[id]} rejected the request (HTTP ${res.status()}): ${body.slice(0, 300)}\n` +
        `Check ACUTE_TEST_${id.toUpperCase()}_API_KEY / ACUTE_TEST_${id.toUpperCase()}_MODEL in .env.local.`,
    ).toBe(true);
  });
}
