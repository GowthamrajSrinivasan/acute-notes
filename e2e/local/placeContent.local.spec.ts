/**
 * Stage 2d in the real app, no AI: "Where should this go?" (⋮ → Place text in notes…) over a Visualize result. The router
 * finds the card that holds a claim and proposes a claim-level edit; a related point becomes a new card in that card's
 * section; content nothing is close to becomes a new card. Each is an ordinary reviewed change. Screenshots attached.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../helpers";

const NOTES = ["# Gateway", "", "## Limits", "", "Retries happen five times with exponential backoff.", "", "## Owners", "", "The payments team owns the gateway service.", ""].join("\n");

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const placeDialog = (p: Page) => p.getByRole("dialog", { name: "Where should this go?" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

/** Every live block's stored text, joined. */
const canvasText = (p: Page) =>
  p.evaluate(() => {
    type El = { customData?: { acute?: { documentId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return dev.api.getSceneElements().map((el) => JSON.stringify(dev.store.get(el.customData?.acute?.documentId ?? "")?.snapshot ?? "")).join("\n");
  });

async function place(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Place text in notes…" }).click();
  await placeDialog(p).getByRole("textbox", { name: "Content to place" }).fill(text);
  await placeDialog(p).getByRole("button", { name: "Find a place" }).click();
  await expect(placeDialog(p).getByRole("status")).toBeVisible();
}

test.describe.configure({ mode: "serial" });
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(NOTES);
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
});
test.afterAll(async () => {
  await page?.context().close();
});

test("a changed claim: the card that holds it, preselected, updated in place after review", async ({}, info) => {
  await place(page, "Retries happen three times with exponential backoff.");
  const dialog = placeDialog(page);
  await expect(dialog.getByRole("status")).toContainText("Best fit");
  const top = dialog.getByRole("list", { name: "Places it could go" }).getByRole("listitem").first();
  await expect(top).toContainText("Retries happen five times");
  await expect(top).toContainText("Update the card (supersedes)");
  await expect(top).toContainText(/Where \d+%/);
  await expect(top).toContainText(/Edit \d+%/);
  await expect(top.getByRole("checkbox").first()).toBeChecked();
  await page.screenshot({ path: info.outputPath("place-update.png") });
  await dialog.getByRole("button", { name: "Propose" }).click();

  await reviewBar(page).getByRole("button", { name: "Review", exact: true }).click();
  await expect(reviewBar(page)).toContainText("replaces “five” → “three”");
  await page.screenshot({ path: info.outputPath("place-update-review.png") });
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  const text = await canvasText(page);
  expect(text).toContain("Retries happen three times with exponential backoff.");
  expect(text).not.toContain("five times");
});

test("a related point: a new card in that card's section", async ({}, info) => {
  await place(page, "Jitter spreads retries out so callers don't retry together.");
  const dialog = placeDialog(page);
  const top = dialog.getByRole("list", { name: "Places it could go" }).getByRole("listitem").first();
  await expect(top).toContainText("Add a new card beside it");
  // The card's older wording (kept for undo, off the canvas) is never offered: found in the first live look.
  await expect(dialog.getByRole("list", { name: "Places it could go" })).not.toContainText("five times");
  await expect(dialog.getByRole("status")).toContainText("Best fit");
  await page.screenshot({ path: info.outputPath("place-insert.png") });
  await top.getByRole("checkbox").first().check();
  await dialog.getByRole("button", { name: "Propose" }).click();
  await expect(reviewBar(page)).toContainText("1 block");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect.poll(() => canvasText(page)).toContain("Jitter spreads retries out");
});

test("nothing close: a new card on its own", async () => {
  await place(page, "The quarterly budget review is in March.");
  const dialog = placeDialog(page);
  await expect(dialog.getByRole("status")).toContainText("No card is close");
  await expect(dialog.getByRole("checkbox", { name: "A new card on its own" })).toBeChecked();
  await dialog.getByRole("button", { name: "Propose" }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect.poll(() => canvasText(page)).toContain("quarterly budget review");
});
