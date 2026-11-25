/**
 * #14 in the real app (intelligent-update-engine-plan §19.6), no AI call: impact discovery reads meaning with the local MiniLM-L6
 * model. Another source's notes share the changed words in three ways — the same claim, a different claim ("Deploys happen five
 * times"), and the claim in other words ("Failed jobs get five retries"). Word overlap alone would offer the first two and miss the
 * third; by meaning, only the same claim is offered and the other-words card is listed, never edited.
 *
 * Needs a dev server with the semantic placement switches on and the model's weights in the local cache, at ACUTE_SEMANTIC_URL
 * (see `semanticPlacement.local.spec.ts`). Skipped otherwise; `impactReview.local.spec.ts` covers word overlap.
 */
import { expect, test, type Page } from "@playwright/test";
import { action, openApp, openAskAI } from "../helpers";

const URL = process.env.ACUTE_SEMANTIC_URL;
test.skip(!URL, "needs a dev server with semantic placement switched on (ACUTE_SEMANTIC_URL)");
if (URL) test.use({ baseURL: URL });

const GATEWAY = ["# Gateway", "", "## Limits", "", "Retries happen five times. Timeouts last ten seconds.", "", "## Owners", "", "The payments team owns the gateway.", ""].join("\n");
const WORKER = [
  "# Worker",
  "",
  "## Behaviour",
  "",
  "Our worker retries five times before giving up.",
  "",
  "## Releases",
  "",
  "Deploys happen five times a week.",
  "",
  "## Failures",
  "",
  "Failed jobs get five retries.",
  "",
].join("\n");

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

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
  const asNew = visualizeDialog(p).getByRole("radio", { name: "Add as new notes" });
  if (await asNew.isVisible()) await asNew.check();
  await visualizeDialog(p).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(p).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(p)).toBeHidden();
}

test("the local model is served and calibrated for same-claim checks", async ({ request }) => {
  const res = await request.get("/api/ai/embed");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ embedder: "local-minilm-l6-q8-v1", claim: { same: 0.6, other: 0.55 } });
});

test("by meaning: only the same claim is offered; a different claim sharing the words isn't; other words are listed", async ({ page }, info) => {
  await openApp(page);
  await visualize(page, GATEWAY);
  await visualize(page, WORKER);
  const worker = await block(page, "Our worker retries five times");

  const surface = await openAskAI(page, await block(page, "Timeouts last ten seconds"));
  await (await action(surface, "Update from new content")).click();
  await updateDialog(page).getByRole("textbox").fill(GATEWAY.replace("five times", "three times"));
  await updateDialog(page).getByRole("button", { name: "Update", exact: true }).click();
  const bar = reviewBar(page);
  await expect(bar).toBeVisible();

  await expect(bar).toContainText("↗ 1 elsewhere to check");
  const offers = bar.getByRole("list", { name: "Changes that need your input" });
  await expect(offers.getByRole("listitem", { name: /^Elsewhere: Our worker retries five times/ })).toBeVisible();
  await expect(offers).not.toContainText("Deploys happen");
  const related = bar.getByRole("list", { name: "Related cards, not changed" });
  await expect(related).toContainText("Failed jobs get five retries.");
  await expect(related).toContainText("in other words — not edited");
  await expect(related).not.toContainText("Deploys happen");
  await bar.getByRole("button", { name: "Review", exact: true }).click();
  await page.screenshot({ path: info.outputPath("impact-by-meaning.png") });
  console.log(`[ui-check] review: ${(await bar.innerText()).replace(/\s+/g, " ")}`);

  await offers.getByRole("listitem", { name: /^Elsewhere: Our worker retries five times/ }).getByRole("button", { name: "Update this too" }).click();
  await bar.getByRole("button", { name: "Accept all clean changes" }).click();
  await expect(bar).toBeHidden();
  expect(await block(page, "Our worker retries three times before giving up.")).toBe(worker);
  await block(page, "Deploys happen five times a week."); // never edited
  await block(page, "Failed jobs get five retries."); // listed, never edited
});
