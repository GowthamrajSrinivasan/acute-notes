/**
 * F18 → CAP-01: after an Ask AI reply, the panel says what the AI saw — all
 * of the scope, or which objects were shortened or left out at the context
 * limit. No AI request is made: the browser's calls to the AI host are
 * answered here with a canned reply, and a fake key is typed into Connect.
 */
import { expect, test, type Page } from "@playwright/test";
import { askAISurface, chooseScope, createDemoCanvas, headerAskAIButton, openAISettings, openApp, pasteText } from "../helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const REPLY = "Canned reply for the coverage test.";

async function answerLocally(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.route("**/api/ai/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    seen.push(path);
    if (path.endsWith("/stream")) {
      const lines = [{ delta: REPLY, done: false }, { delta: "", done: true }].map((l) => JSON.stringify(l)).join("\n") + "\n";
      return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: lines });
    }
    if (path.endsWith("/run")) {
      return route.fulfill({ status: 200, json: { text: REPLY, model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
    }
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

async function askAboutCanvas(page: Page, question: string) {
  await page.keyboard.press("Escape");
  await headerAskAIButton(page).click();
  const surface = askAISurface(page);
  const newChat = surface.getByRole("button", { name: "New conversation" });
  if (await newChat.isVisible()) await newChat.click();
  await chooseScope(surface, "This canvas");
  await surface.getByRole("textbox", { name: "Ask a question" }).fill(question);
  await surface.getByRole("button", { name: "Send" }).click();
  await expect(surface).toContainText(REPLY);
  return surface;
}

test("after a reply, the panel says what the AI saw, and what was shortened or left out at the limit", async ({ page }) => {
  const seen = await answerLocally(page);
  await openApp(page);
  await createDemoCanvas(page);
  await connectFakeKey(page);

  let surface = await askAboutCanvas(page, "What is on this canvas?");
  await expect(surface.locator(".acute-ai-coverage")).toBeVisible();
  await expect(surface.locator(".acute-ai-coverage")).toContainText(/of 16,000 characters/);

  // Far more text than the budget: it's shortened, and the rest of the canvas no longer fits.
  await surface.getByRole("button", { name: "Close" }).first().click().catch(() => undefined);
  const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}: ${"lorem ipsum dolor sit amet ".repeat(30)}`).join("\n\n");
  await pasteText(page, paragraphs, { x: 1100, y: 700 });
  surface = await askAboutCanvas(page, "Summarise everything here");
  const coverage = surface.locator(".acute-ai-coverage");
  await expect(coverage).toContainText("Context limit reached");
  await coverage.locator("summary").click();
  await expect(coverage).toContainText(/Shortened to fit|Left out/);
  expect(await coverage.getByRole("listitem").count()).toBeGreaterThan(0);
  if (process.env.ACUTE_SHOT) await surface.screenshot({ path: process.env.ACUTE_SHOT });

  // Nothing reached the real AI host.
  expect(seen.length).toBeGreaterThan(0);
});
