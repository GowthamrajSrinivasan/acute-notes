/**
 * The AI consistency check (Stage 4f, Phase 1 pilot) in the real app — no model call: the connection test and the judge
 * route are answered by the browser (`page.route`), so nothing leaves the machine.
 *
 * Needs a dev server with the panel and BOTH AI-check switches on (the default build has them off), at ACUTE_AI_CHECK_URL, e.g.
 *   NEXT_PUBLIC_CONSISTENCY_PANEL=on NEXT_PUBLIC_CONSISTENCY_AI_CHECK=on CONSISTENCY_AI_CHECK=on npx next dev -p 3107
 *   ACUTE_AI_CHECK_URL=http://localhost:3107 npx playwright test e2e/local/aiCheck.local.spec.ts
 * Skipped otherwise.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../helpers";

const URL = process.env.ACUTE_AI_CHECK_URL;
test.skip(!URL, "needs a dev server with the AI check switched on (ACUTE_AI_CHECK_URL)");
if (URL) test.use({ baseURL: URL });

const chip = (p: Page) => p.locator(".acute-consistency-chip");
const panel = (p: Page) => p.getByRole("region", { name: "Consistency" });
const section = (p: Page) => panel(p).getByLabel("AI check");
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

async function visualizeLocal(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = p.getByRole("dialog", { name: "Visualize" });
  await dialog.getByRole("textbox").first().fill(text);
  const asNew = dialog.getByRole("radio", { name: "Add as new notes" });
  if (await asNew.isVisible()) await asNew.check();
  await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
  const local = p.getByRole("button", { name: "Use local structure instead" });
  await expect(reviewBar(p).or(local)).toBeVisible();
  if (await local.isVisible()) await local.click();
  await reviewBar(p).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(p)).toBeHidden();
}

test.describe.configure({ mode: "serial" });

test("opt in → queue a near-miss → checked automatically, no press → the reading is evidence, the user decides; opt out", async ({ page }) => {
  const judgeBodies: Record<string, unknown>[] = [];
  const runCalls: string[] = [];
  await page.route("**/api/ai/run", async (route) => {
    runCalls.push(route.request().postData() ?? "");
    await route.fulfill({ json: { text: "OK", finishReason: "stop", usage: {} } });
  });
  await page.route("**/api/ai/judge", async (route) => {
    // The readiness check (GET, no body) goes to the real server: its switch is on, so it answers 204.
    if (route.request().method() === "GET") return route.continue();
    const body = route.request().postDataJSON() as Record<string, unknown> & { prompt: string };
    judgeBodies.push(body);
    const refs = [...body.prompt.matchAll(/^p(\d+)$/gm)].map((m) => `p${m[1]}`);
    await route.fulfill({ json: { text: JSON.stringify({ results: refs.map((ref) => ({ ref, answer: "contradicts", why: "nightly vs weekly for the same backups" })) }), finishReason: "stop", usage: { promptTokens: 700, completionTokens: 300 }, providerRequests: 1 } });
  });

  await openApp(page);
  // The build offers it: the chip is there even with nothing to show. Off for this device until it opts in.
  await chip(page).click();
  await expect(section(page)).toBeVisible();
  const optIn = section(page).getByRole("checkbox");
  await expect(optIn).not.toBeChecked();
  await expect(section(page).getByRole("button", { name: /Check/ })).toHaveCount(0);
  await optIn.check();
  await expect(panel(page).getByText(/AI check on for this device/)).toBeVisible();
  await expect(section(page).getByRole("status")).toContainText("0 not checked yet");
  await panel(page).getByRole("button", { name: "Close" }).click();

  // Two sources whose schedules clash — a near-miss the rules alone don't show.
  await visualizeLocal(page, "# Ops\n\nBackups run every night at 2 a.m.\n");
  await visualizeLocal(page, "# Runbook\n\nBackups run once a week on Sunday.\n");
  await expect(chip(page)).toContainText("1 to check with AI");
  expect(judgeBodies).toHaveLength(0);
  await chip(page).click();
  await expect(section(page).getByRole("status")).toContainText("1 not checked yet · 0 checked, shown · 0 checked, read as compatible · 0 failed");
  await expect(section(page).getByText(/Waiting: 1 pair · 1 check of up to 10/)).toBeVisible();
  // No connection yet: the button can't send.
  // No manual button at all (plan §17.5): the pair waits for a connection.
  await expect(section(page).getByRole("button", { name: /Check/ })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Close" }).click();

  // Connect an API-key chat-completions connection (fake key; the connection test is answered by the browser).
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "AI settings" }).click();
  const settings = page.getByRole("dialog", { name: "AI Providers" });
  await settings.locator(".acute-ai-row", { hasText: "AICredits" }).getByRole("button", { name: /^Connect( key)?$/ }).click();
  const connect = page.getByRole("dialog", { name: "Connect AICredits" });
  await connect.locator("#acute-connect-key").fill("sk-fake-e2e-0000000000000000");
  await connect.locator("#acute-connect-model").fill("openai/gpt-oss-120b");
  await connect.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connect).toBeHidden({ timeout: 60_000 });
  await settings.getByRole("button", { name: "Close" }).click();

  // No press: opening the panel with a pair waiting (it was queued before there was a connection) runs the check on its own.
  await chip(page).click();
  await expect(panel(page).getByText("AI check: 1 of 1 pairs answered. Its readings are shown on the records; nothing was changed.")).toBeVisible();
  // Exactly one request, with the check's cap, effort and the primary connection's model.
  expect(judgeBodies).toHaveLength(1);
  expect(judgeBodies[0]).toMatchObject({ model: "openai/gpt-oss-120b", maxTokens: 760, reasoningEffort: "low", timeoutMs: 90_000, provider: { type: "openai", baseUrl: "https://api.aicredits.in/v1" } });
  await expect(section(page).getByRole("status")).toContainText("0 not checked yet · 1 checked, shown");
  // The reading is evidence on a possible record; the user's buttons decide.
  const item = panel(page).getByRole("listitem").filter({ hasText: "once a week" });
  await expect(item).toContainText("AI: likely conflict (your call)");
  await expect(item).toContainText("nightly vs weekly");
  await expect(item.getByRole("button", { name: "It's a conflict" })).toBeVisible();
  await expect(chip(page)).toContainText("1 possible conflict");
  // Nothing more to send, and no button to press: a second check cannot spend.
  await expect(section(page).getByRole("button", { name: /Check/ })).toHaveCount(0);

  // Easy off switch.
  await section(page).getByRole("checkbox").uncheck();
  await expect(panel(page).getByText("AI check off. Nothing is queued or sent.")).toBeVisible();
  await expect(section(page).getByRole("button", { name: /Check/ })).toHaveCount(0);
  expect(judgeBodies).toHaveLength(1);
});
