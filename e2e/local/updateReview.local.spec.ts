/**
 * The Stage 1 update review in the real app, local tier only (no AI connection): one update over a small note that
 * changes a card the user edited, adds a sentence to an untouched card, changes one table cell and changes a locked
 * card. Checks the wording the user reads — "Updates your edited card", the added sentence, the cell edit, the
 * "locked cards not updated" line — and the AI settings' Update behaviour section. Screenshots are attached for a look.
 */
import { expect, test, type Page } from "@playwright/test";
import { action, openAISettings, openApp, openAskAI, select } from "../helpers";

const V1 = [
  "# Gateway",
  "",
  "## Limits",
  "",
  "Retries happen five times. Timeouts last ten seconds.",
  "",
  "| Setting | Value |",
  "|---|---|",
  "| Retries | 5 |",
  "| Timeout | 10 seconds |",
  "",
  "## Owners",
  "",
  "Payments team owns the gateway.",
  "",
  "## Rollout",
  "",
  "One region goes first.",
  "",
].join("\n");
const V2 = V1.replace("Timeouts last ten seconds.", "Timeouts last ten seconds. Backoff doubles each time.")
  .replace("| Retries | 5 |", "| Retries | 3 |")
  .replace("Payments team owns", "Platform team owns")
  .replace("One region goes first.", "Two regions go first.");

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const origin = (p: Page) => p.getByRole("group", { name: "Origin" });

/** The one live block whose stored document mentions `needle`. */
async function block(p: Page, needle: string): Promise<string> {
  const ids = await p.evaluate((n) => {
    type El = { id: string; customData?: { acute?: { documentId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return dev.api.getSceneElements().flatMap((el) => {
      const id = el.customData?.acute?.documentId;
      return id && JSON.stringify(dev.store.get(id)?.snapshot ?? "").includes(n) ? [el.id] : [];
    });
  }, needle);
  expect(ids, `one block mentioning “${needle}”`).toHaveLength(1);
  return ids[0]!;
}

/** Replaces a text in a block's stored document, as a user edit would. */
function editBlock(p: Page, id: string, from: string, to: string): Promise<void> {
  return p.evaluate(
    ({ id, from, to }) => {
      type El = { id: string; customData?: { acute?: { documentId?: string } } };
      type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown }; update(id: string, patch: unknown): void } };
      const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
      const docId = dev.api.getSceneElements().find((e) => e.id === id)!.customData!.acute!.documentId!;
      dev.store.update(docId, { snapshot: JSON.parse(JSON.stringify(dev.store.get(docId).snapshot).split(from).join(to)) });
    },
    { id, from, to },
  );
}

test("the update review reads well: an edited card, an added sentence, a cell, a locked card", async ({ page }, info) => {
  await openApp(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(V1);
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  const owners = await block(page, "Payments team");
  await editBlock(page, owners, "Payments team owns", "Payments team (my note: confirm with finance) owns");
  const rollout = await block(page, "One region");
  await select(page, rollout);
  await origin(page).getByRole("button", { name: "🔒 Lock" }).click();
  await expect(page.locator(`.acute-lock-marker[data-element-id="${rollout}"]`)).toBeVisible();

  const surface = await openAskAI(page, owners);
  await (await action(surface, "Update from new content")).click();
  await updateDialog(page).getByRole("textbox").fill(V2);
  await updateDialog(page).getByRole("button", { name: "Update", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible();
  await reviewBar(page).getByRole("button", { name: "Review", exact: true }).click();

  const bar = reviewBar(page);
  await expect(bar).toContainText("🔒 1 locked card not updated");
  await expect(bar).toContainText("Updates your edited card “Payments team (my note");
  // Every card is named by its own text, never "a card" (found in the first live look).
  await expect(bar).not.toContainText("Edit a card");
  await expect(bar).toContainText("Edit “Retries happen five times.");
  await expect(bar).toContainText("replaces “Payments” → “Platform”");
  await expect(bar).toContainText("adds “Backoff doubles each time.”");
  await expect(bar).toContainText("row 2, column 2: replaces “5” → “3”");
  await expect(bar.getByRole("list", { name: "Changes that need your input" })).toHaveCount(0);
  await info.attach("review", { body: await page.screenshot(), contentType: "image/png" });
  await page.screenshot({ path: info.outputPath("review.png") });
  console.log(`[ui-check] review: ${(await bar.innerText()).replace(/\s+/g, " ")}`);

  await bar.getByRole("button", { name: "Accept all" }).click();
  await expect(bar).toBeHidden();
  const merged = await block(page, "Platform team");
  expect(merged).toBe(owners);
  expect(await page.evaluate(() => true)).toBe(true);
  await block(page, "my note: confirm with finance");
  await block(page, "Backoff doubles each time.");
  await block(page, "One region"); // the locked card, as it was
});

test("AI settings show the Update behaviour section with its two switches", async ({ page }, info) => {
  await openApp(page);
  const settings = await openAISettings(page);
  const section = settings.getByRole("region", { name: "Update behaviour" }).or(settings.locator('section[aria-labelledby="acute-update-settings-title"]'));
  await section.scrollIntoViewIfNeeded();
  await expect(section).toContainText("Update behaviour");
  const locked = section.getByRole("checkbox", { name: /Preserve locked sections/ });
  const edited = section.getByRole("checkbox", { name: /Preserve edited cards/ });
  await expect(locked).toBeChecked();
  await expect(edited).not.toBeChecked();
  await page.screenshot({ path: info.outputPath("settings.png") });
  await edited.check();
  await expect(section.getByRole("button", { name: "Reset to defaults" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("settings-changed.png") });
  await section.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(edited).not.toBeChecked();
});
