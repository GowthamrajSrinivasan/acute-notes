/**
 * Esc cancels a running Ask AI request picked from the actions menu, and closes the panel (2026-11-23: the AI suite's
 * `askAI.demoCanvas` cancel test failed because the OpenUI dev widget swallowed Esc; `openApp` now turns it off). No AI
 * request is made: the browser's calls to the AI host are held open here, and a fake key is typed into Connect.
 */
import { expect, test, type Page } from "@playwright/test";
import { action, askAISurface, blockByTitle, blocks, createDemoCanvas, openAISettings, openApp, openAskAI } from "../helpers";

async function holdAIRequests(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.route("**/api/ai/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    seen.push(path);
    if (path.endsWith("/run") || path.endsWith("/stream")) return; // never answered: the request stays running
    return route.fulfill({ status: 200, json: [] });
  });
  return seen;
}

async function connectFakeKey(page: Page) {
  const settings = await openAISettings(page);
  const row = settings.locator(".acute-ai-row").filter({ has: page.locator(".acute-ai-row__title", { hasText: /^OpenAI$/ }) });
  await row.getByRole("button", { name: "Connect key" }).click();
  const connect = page.getByRole("dialog", { name: "Connect OpenAI" });
  await connect.locator("#acute-connect-key").fill("sk-test-not-a-real-key");
  await connect.locator("#acute-connect-model").fill("test-model");
  await connect.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connect).toBeHidden();
  await settings.getByRole("button", { name: "Close" }).click();
}

test("Esc cancels a running action picked from the menu and closes the panel; nothing lands on the canvas", async ({ page }) => {
  const seen = await holdAIRequests(page);
  await openApp(page);
  await createDemoCanvas(page);
  await connectFakeKey(page);
  const overview = (await blockByTitle(page, "Checkout revamp — overview")).id;
  const before = (await blocks(page)).length;

  const surface = await openAskAI(page, overview);
  await (await action(surface, "Explain")).click();
  await expect(surface.getByRole("status")).toBeVisible();
  expect(seen.some((p) => p.endsWith("/run") || p.endsWith("/stream"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(askAISurface(page)).toBeHidden();
  expect(await blocks(page)).toHaveLength(before);
  // The dev widget that swallowed Esc is not mounted.
  await expect(page.locator("[data-openui-devtools-auto-mount]")).toHaveCount(0);
});
