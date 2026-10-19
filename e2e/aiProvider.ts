/**
 * Which real AI connection the `e2e/ai` suite runs against.
 *
 * Resolution order:
 *   1. `--provider=<id>` / `ACUTE_AI_PROVIDER=<id>` — explicit, always wins.
 *   2. Auto-detect: the first BYOK connection with real credentials in
 *      `.env.local` — the same `ACUTE_TEST_*` variables F36's contract suite
 *      reads (`src/ai/contractTests/testEnv.ts`) — checked in this order:
 *      openai, anthropic, azure, gemini, openrouter, aicredits, neevcloud.
 *   3. `copilot` — the subscription signed in to the Copilot CLI, used only
 *      when nothing else is configured.
 *
 * Whichever it is, the key is typed into the app's own Connect dialog,
 * exactly as a user would, and never logged.
 */
import { expect, type Page } from "@playwright/test";
import { getByokCredentials, type ByokConnectionId, type ByokTestCredentials } from "../src/ai/contractTests/testEnv";

export type E2EProvider = "copilot" | ByokConnectionId;

const BYOK_PRIORITY: readonly ByokConnectionId[] = ["openai", "anthropic", "azure", "gemini", "openrouter", "aicredits", "neevcloud"];

function autoDetect(): E2EProvider {
  for (const id of BYOK_PRIORITY) if (getByokCredentials(id)) return id;
  return "copilot";
}

function resolveExplicit(): E2EProvider | null {
  const requested = process.env.ACUTE_AI_PROVIDER;
  if (!requested) return null;
  if (requested === "copilot" || (BYOK_PRIORITY as readonly string[]).includes(requested)) return requested as E2EProvider;
  throw new Error(`Unknown ACUTE_AI_PROVIDER "${requested}" (use copilot, openai, anthropic, azure, gemini, openrouter, aicredits or neevcloud).`);
}

export const AI_PROVIDER: E2EProvider = resolveExplicit() ?? autoDetect();

/** How the app names the connection (connection row, "Model: …" chip, destination line). */
export const AI_PROVIDER_NAME: Record<E2EProvider, string> = {
  copilot: "GitHub Copilot",
  openai: "OpenAI",
  anthropic: "Anthropic",
  azure: "Azure OpenAI / Foundry",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  aicredits: "AICredits",
  neevcloud: "NeevCloud",
};
export const AI_ACCESS_LABEL: Record<E2EProvider, string> = {
  copilot: "your subscription",
  openai: "your API key",
  anthropic: "your API key",
  azure: "your API key",
  gemini: "your API key",
  openrouter: "your API key",
  aicredits: "your API key",
  neevcloud: "your API key",
};

/** The real test credentials for a BYOK provider; throws if `.env.local` doesn't actually have them (only reachable via an explicit `--provider=`, since auto-detect never picks an unconfigured one). */
export function byokCredentials(id: ByokConnectionId): ByokTestCredentials {
  const creds = getByokCredentials(id);
  if (!creds) throw new Error(`ACUTE_AI_PROVIDER=${id} needs its ACUTE_TEST_${id.toUpperCase()}_* variables in .env.local.`);
  return creds;
}

/** Connects the chosen provider in AI Settings; being the first connection, it becomes primary. */
export async function connectAI(page: Page): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "AI settings" }).click();
  const settings = page.getByRole("dialog", { name: "AI Providers" });
  const name = AI_PROVIDER_NAME[AI_PROVIDER];
  const row = settings.locator(".acute-ai-row", { hasText: name });
  // Subscription rows say "Connect"; API-key rows say "Connect key".
  await row.getByRole("button", { name: /^Connect( key)?$/ }).click();
  const connect = page.getByRole("dialog", { name: `Connect ${name}` });
  if (AI_PROVIDER !== "copilot") {
    const creds = byokCredentials(AI_PROVIDER);
    await connect.locator("#acute-connect-key").fill(creds.apiKey);
    await connect.locator("#acute-connect-model").fill(creds.model);
    if (creds.endpoint) await connect.locator("#acute-connect-endpoint").fill(creds.endpoint);
  }
  await connect.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connect).toBeHidden({ timeout: 60_000 });
  await expect(row.getByRole("button", { name: "★ Primary" })).toBeVisible();
  // Optional: a decision model (any model of this connection) for the outline — `ACUTE_AI_DECISION_MODEL=<model>`, applied when
  // this run's connection is `ACUTE_AI_DECISION_CONNECTION` (default: whichever connection the run uses).
  const decisionModel = process.env.ACUTE_AI_DECISION_MODEL?.trim();
  if (decisionModel && process.env.ACUTE_AI_DECISION_KIND !== "typed" && (process.env.ACUTE_AI_DECISION_CONNECTION?.trim() || AI_PROVIDER) === AI_PROVIDER) {
    await settings.getByLabel("Decision model connection").selectOption({ label: name });
    const input = settings.getByLabel("Decision model name");
    await input.fill(decisionModel);
    await input.press("Enter");
    await expect(settings.getByLabel("Decision model connection")).toHaveValue(AI_PROVIDER);
  }
  // Optional: the typed decision model (Jev on OpenRouter, OpenAI Decisions) — `ACUTE_AI_DECISION_KIND=typed`, on this run's connection
  // when it is `ACUTE_AI_DECISION_CONNECTION`; its model is `ACUTE_AI_DECISION_MODEL` (empty: the connection's default).
  if (process.env.ACUTE_AI_DECISION_KIND === "typed" && process.env.ACUTE_AI_DECISION_CONNECTION?.trim() === AI_PROVIDER) {
    await settings.getByLabel("Typed decision model connection").selectOption({ index: 1 });
    const model = process.env.ACUTE_AI_DECISION_MODEL?.trim();
    if (model) {
      const input = settings.getByLabel("Typed decision model name");
      await input.fill(model);
      await input.press("Enter");
    }
  }
  await settings.getByRole("button", { name: "Close" }).click();
}
