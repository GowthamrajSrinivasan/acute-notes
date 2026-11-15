/**
 * "Update from new content" on a distil canvas, one passage of an existing section edited (Study Mode's report,
 * 2026-11-15). Setup as `notesStudy.local.spec.ts`: the scripted distiller answers locally, one card planted uncited. No
 * AI, no network. Unit-level root cause and the expected behaviour: `src/ai/reconcile/updateOwnPassage.test.ts`.
 *
 * Was (pre-existing, not a regression): an edited existing section was regenerated with an unlabelled, preserve-style
 * prompt (`update.ts` `updateOutlined` → `settle` → `changedInput`), so the distiller answered with its analysis card only;
 * positional keys paired it with the "500" card (`§ text#0`), which the claim planner escalated as UNCLEAR, and the other
 * two cards were removed. Fix (a): `settle` distils an edited section with labelled units, as a new section is.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AIRequest } from "../../src/ai/types";
import { distiller } from "../../src/ai/fidelity/__fixtures__/knowledge/mockDistiller";
import { action, openAISettings, openApp, openAskAI, waitForCanvas } from "../helpers";

const DOC = `# Caching notes

## Retries

Retries can improve reliability when the cache holds a valid result. They must stop after 3 attempts, however short the outage.

## Limits

The cache keeps at most 500 entries per tenant. Entries expire after 30 minutes. Thanks for reading.
`;
const respond = distiller({ uncitedIn: /expire after/, persistent: true });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });

async function answerLocally(page: Page): Promise<void> {
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: AIRequest };
    const req = { ...(body.request ?? {}), task: body.request?.task ?? "", prompt: body.request?.prompt ?? "" } as AIRequest;
    return route.fulfill({ status: 200, json: { text: respond(req).text, model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
  });
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

/** Ask AI → Update from new content on the "500" card with `text`; returns the review bar's text (left open). */
async function proposeUpdate(page: Page, text: string): Promise<string> {
  await page.evaluate(() => (window as unknown as { __acuteDev: { store: { flush(): Promise<void> } } }).__acuteDev.store.flush());
  await page.reload();
  await waitForCanvas(page);
  // The note model is a per-page developer setting (`FIDELITY_CONFIG.noteModel`), lost on reload; an update reads it, not the canvas's.
  expect(await page.evaluate(() => (window as unknown as { __acuteDev: { setNoteModel(m: string): Promise<string> } }).__acuteDev.setNoteModel("distil"))).toBe("distil");
  // The "500" card: the object whose reconciliation link names the Limits section's first text node.
  const card = await page.evaluate(async () => {
    const dev = (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string; isDeleted?: boolean }[] }; reconciliation(id: string): Promise<{ link: { stableNodeKey: string } | null } | null> } }).__acuteDev;
    for (const el of dev.api.getSceneElements()) {
      if (el.isDeleted) continue;
      const r = await dev.reconciliation(el.id);
      if (r?.link?.stableNodeKey === "Caching notes › Limits § text#0") return el.id;
    }
    return null;
  });
  expect(card, "the “500” card is on the canvas").not.toBeNull();
  const surface = await openAskAI(page, card!);
  await (await action(surface, "Update from new content")).click();
  const dialog = page.getByRole("dialog", { name: "Update from new content" });
  await dialog.getByRole("textbox").fill(text);
  await dialog.getByRole("button", { name: "Update", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
  return (await reviewBar(page).textContent()) ?? "";
}

test.describe("Update from new content: one passage of a distil section (no AI)", () => {
  test.describe.configure({ mode: "serial" });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await openApp(page);
    await answerLocally(page);
    await connectFakeKey(page);
    expect(await page.evaluate(() => (window as unknown as { __acuteDev: { setNoteModel(m: string): Promise<string> } }).__acuteDev.setNoteModel("distil"))).toBe("distil");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(DOC);
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("only the edited passage's card changes; the “500” card is left alone", async () => {
    const summary = await proposeUpdate(page, DOC.replace("30 minutes", "45 minutes"));
    expect(summary).not.toMatch(/removed/);
    expect(summary).not.toMatch(/needs your input/);
    await expect(reviewBar(page)).not.toContainText("Analysis · What it means");
    await reviewBar(page).getByRole("button", { name: "Reject" }).click();
    await expect(reviewBar(page)).toBeHidden();
  });
});
