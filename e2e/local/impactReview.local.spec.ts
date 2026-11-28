/**
 * Stage 3 (impact discovery) in the real app, local tier only (no AI connection): two notes from two sources say the same
 * fact; an update to the first changes it. The review offers the same edit on the other source's card as its own decision
 * ("Update this too" / "Leave as is", never "Accept all"), lists a card that says it in other words as related, not
 * changed, and AI settings show the "Suggest updates elsewhere" switch. Screenshots attached for a look.
 */
import { expect, test, type Page } from "@playwright/test";
import { action, openAISettings, openApp, openAskAI } from "../helpers";

const GATEWAY = ["# Gateway", "", "## Limits", "", "Retries happen five times. Timeouts last ten seconds.", "", "## Owners", "", "The payments team owns the gateway.", ""].join("\n");
const WORKER = ["# Worker", "", "## Behaviour", "", "Our worker retries five times before giving up.", "", "## Runbook", "", "Retries happen up to 5 times per job.", ""].join("\n");

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

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

async function visualize(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(p).getByRole("textbox").first().fill(text);
  // With notes on the canvas the dialog offers to merge into them: this is a second, separate source.
  const asNew = visualizeDialog(p).getByRole("radio", { name: "Add as new notes" });
  if (await asNew.isVisible()) await asNew.check();
  await visualizeDialog(p).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(p).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(p)).toBeHidden();
}

async function updateGateway(p: Page, text: string) {
  const surface = await openAskAI(p, await block(p, "Timeouts last ten seconds"));
  await (await action(surface, "Update from new content")).click();
  await updateDialog(p).getByRole("textbox").fill(text);
  await updateDialog(p).getByRole("button", { name: "Update", exact: true }).click();
  await expect(reviewBar(p)).toBeVisible();
}

test("a fact changed at one source is offered, as a decision, where another source repeats it", async ({ page }, info) => {
  await openApp(page);
  await visualize(page, GATEWAY);
  await visualize(page, WORKER);
  const worker = await block(page, "Our worker retries five times");

  // 1. Update this too: the other source's card gets the same edit, with the source's own change.
  await updateGateway(page, GATEWAY.replace("five times", "three times"));
  const bar = reviewBar(page);
  await expect(bar).toContainText("↗ 1 elsewhere to check");
  await expect(bar.getByRole("button", { name: "Accept all clean changes" })).toBeVisible();
  const offers = bar.getByRole("list", { name: "Changes that need your input" });
  const offer = offers.getByRole("listitem", { name: /^Elsewhere: Our worker retries five times/ });
  await expect(offer).toContainText("Says the same as “Retries happen five times.");
  await expect(offer).toContainText("The same edit here: replaces “five” → “three”");
  await expect(offer.getByLabel("Proposed version")).toContainText("Our worker retries three times before giving up.");
  const related = bar.getByRole("list", { name: "Related cards, not changed" });
  await expect(related).toContainText("Retries happen up to 5 times per job.");
  await expect(related).toContainText("in other words — not edited");
  await bar.getByRole("button", { name: "Review", exact: true }).click();
  await page.screenshot({ path: info.outputPath("impact-review.png") });
  console.log(`[ui-check] review: ${(await bar.innerText()).replace(/\s+/g, " ")}`);

  await offer.getByRole("button", { name: "Update this too" }).click();
  await expect(offer).toHaveAttribute("data-decision", "apply");
  await bar.getByRole("button", { name: "Accept all clean changes" }).click();
  await expect(bar).toBeHidden();
  expect(await block(page, "Retries happen three times")).toBeTruthy();
  expect(await block(page, "Our worker retries three times before giving up.")).toBe(worker);
  await block(page, "Retries happen up to 5 times per job."); // related: never edited

  // 2. Accept all clean changes with no decision: the source's card only — the other card stays as it is.
  await updateGateway(page, GATEWAY.replace("five times", "four times"));
  await expect(bar).toContainText("↗ 1 elsewhere to check");
  await bar.getByRole("button", { name: "Accept all clean changes" }).click();
  await expect(bar).toBeHidden();
  await block(page, "Retries happen four times");
  expect(await block(page, "Our worker retries three times before giving up.")).toBe(worker);
});

test("a merge that revises a fact offers the same edit where another source repeats it (it updates in place, §17.6)", async ({ page }, info) => {
  await openApp(page);
  await visualize(page, GATEWAY);
  await visualize(page, WORKER);
  const worker = await block(page, "Our worker retries five times");

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = visualizeDialog(page);
  await dialog.getByRole("textbox").first().fill("# Gateway\n\n## Limits\n\nRetries happen three times.\n");
  await dialog.getByRole("radio", { name: /Merge into existing notes/ }).check();
  await dialog.getByRole("combobox", { name: "Notes to merge into" }).selectOption({ label: "Gateway" });
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();

  const bar = reviewBar(page);
  await expect(bar).toContainText("↗ 1 elsewhere to check");
  const offers = bar.getByRole("list", { name: "Changes that need your input" });
  const offer = offers.getByRole("listitem", { name: /^Elsewhere: Our worker retries five times/ });
  await expect(offer).toContainText("The same edit here: replaces “five” → “three”");
  await expect(bar.getByRole("list", { name: "Related cards, not changed" })).toContainText("Retries happen up to 5 times per job.");
  await bar.getByRole("button", { name: "Review", exact: true }).click();
  await page.screenshot({ path: info.outputPath("merge-impact-review.png") });
  console.log(`[ui-check] merge review: ${(await bar.innerText()).replace(/\s+/g, " ")}`);

  await offer.getByRole("button", { name: "Update this too" }).click();
  await bar.getByRole("button", { name: "Accept all clean changes" }).click();
  await expect(bar).toBeHidden();
  await block(page, "Retries happen three times");
  expect(await block(page, "Our worker retries three times before giving up.")).toBe(worker);
  await block(page, "Retries happen up to 5 times per job."); // related: never edited
});

test("AI settings show Suggest updates elsewhere, on by default", async ({ page }, info) => {
  await openApp(page);
  const settings = await openAISettings(page);
  const section = settings.locator('section[aria-labelledby="acute-update-settings-title"]');
  await section.scrollIntoViewIfNeeded();
  const elsewhere = section.getByRole("checkbox", { name: /Suggest updates elsewhere/ });
  await expect(elsewhere).toBeChecked();
  await page.screenshot({ path: info.outputPath("settings.png") });
});
