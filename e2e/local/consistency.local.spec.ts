/**
 * Stage 4e in the real app, local tier only (no AI connection; the AI tier, 4f, isn't built): after each accepted change
 * the rule check finds where the new statements disagree with cards elsewhere, and the user — never the system — decides.
 *
 * The panel is off by default (plan §17.5). Needs a dev server with `NEXT_PUBLIC_CONSISTENCY_PANEL=on` at ACUTE_CONSISTENCY_URL, e.g.
 *   NEXT_PUBLIC_CONSISTENCY_PANEL=on npx next dev -p 3107
 *   ACUTE_CONSISTENCY_URL=http://localhost:3107 npx playwright test e2e/local/consistency.local.spec.ts
 * Skipped otherwise.
 */
import { expect, test, type Page } from "@playwright/test";
import { action, openApp, openAskAI, undo } from "../helpers";

const CONSISTENCY_URL = process.env.ACUTE_CONSISTENCY_URL;
test.skip(!CONSISTENCY_URL, "needs a dev server with the consistency panel switched on (ACUTE_CONSISTENCY_URL)");
if (CONSISTENCY_URL) test.use({ baseURL: CONSISTENCY_URL });

const GATEWAY = ["# Gateway", "", "## Limits", "", "Retries happen five times. Timeouts last ten seconds.", "", "## Owners", "", "The payments team owns the gateway.", ""].join("\n");

type Conflict = { status: string; strength: string; note?: string; a: { sentence: string }; b: { sentence: string } };
type Dev = {
  api: { getSceneElements(): { id: string; customData?: { acute?: { documentId?: string } } }[] };
  store: { get(id: string): { snapshot: unknown } | null; update(id: string, patch: unknown): void };
  conflicts(): Conflict[];
  commits(): { check: { status: string } }[];
};
const devOf = (p: Page) => p.evaluate(() => (window as unknown as { __acuteDev: Dev }).__acuteDev.conflicts());
const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const chip = (p: Page) => p.locator(".acute-consistency-chip");
const panel = (p: Page) => p.getByRole("region", { name: "Consistency" });

async function blockWith(p: Page, needle: string): Promise<string> {
  const id = await p.evaluate((n) => {
    const d = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return d.api.getSceneElements().find((el) => JSON.stringify(d.store.get(el.customData?.acute?.documentId ?? "")?.snapshot ?? "").includes(n))?.id ?? null;
  }, needle);
  expect(id, `a block mentioning “${needle}”`).not.toBeNull();
  return id!;
}
const editBlock = (p: Page, id: string, from: string, to: string) =>
  p.evaluate(
    ({ id, from, to }) => {
      const d = (window as unknown as { __acuteDev: Dev }).__acuteDev;
      const docId = d.api.getSceneElements().find((e) => e.id === id)!.customData!.acute!.documentId!;
      d.store.update(docId, { snapshot: JSON.parse(JSON.stringify(d.store.get(docId)!.snapshot).split(from).join(to)) });
    },
    { id, from, to },
  );

async function visualize(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(p).getByRole("textbox").first().fill(text);
  const asNew = visualizeDialog(p).getByRole("radio", { name: "Add as new notes" });
  if (await asNew.isVisible()) await asNew.check();
  await visualizeDialog(p).getByRole("button", { name: "Visualize", exact: true }).click();
  const local = p.getByRole("button", { name: "Use local structure instead" });
  await expect(reviewBar(p).or(local)).toBeVisible();
  if (await local.isVisible()) await local.click();
  await reviewBar(p).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(p)).toBeHidden();
}
const open = (p: Page, status: string) => devOf(p).then((all) => all.filter((c) => c.status === status));
/** Opens the panel, decides on the first item, closes the panel (it stays open on its empty state otherwise). */
async function decideFirst(p: Page, button: string) {
  await chip(p).click();
  await panel(p).getByRole("listitem").first().getByRole("button", { name: button }).click();
  await panel(p).getByRole("button", { name: "Close" }).click();
}

test.describe.configure({ mode: "serial" });
let page: Page;
test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
});
test.afterAll(async () => {
  await page?.context().close();
});

test("1. a value disagreement between two sources: possible, with evidence; confirmed by the user; fixed only through review", async ({}, info) => {
  await visualize(page, GATEWAY);
  await expect(chip(page)).toBeHidden();
  await visualize(page, "# Worker\n\nOur worker retries three times.\n");
  await expect(chip(page)).toHaveText("⚠ 1 possible conflict");
  await expect(page.locator(".acute-consistency-marker")).toHaveCount(2);
  await chip(page).click();
  const item = panel(page).getByRole("listitem").first();
  await expect(item).toContainText("Rule: can't both be true");
  await expect(item.getByLabel("Statement 1")).toHaveText("Our worker retries three times.");
  await expect(item.getByLabel("Statement 2")).toHaveText("Retries happen five times.");
  await expect(item).toContainText("“three times” here, “five times” there");
  await page.screenshot({ path: info.outputPath("possible.png") });

  await item.getByRole("button", { name: "It's a conflict" }).click();
  const confirmed = panel(page).getByRole("list", { name: "Confirmed" }).getByRole("listitem");
  await expect(confirmed).toContainText("Confirmed conflict");
  await expect(chip(page)).toHaveText("1 confirmed");
  // Nothing was changed by confirming.
  await blockWith(page, "Retries happen five times.");
  await page.screenshot({ path: info.outputPath("confirmed.png") });

  await confirmed.getByRole("button", { name: /^Propose: make “Retries happen five times/ }).click();
  await expect(reviewBar(page)).toBeVisible();
  await reviewBar(page).getByRole("button", { name: "Review", exact: true }).click();
  await expect(reviewBar(page)).toContainText("“five times” → “three times”");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  await blockWith(page, "Retries happen three times.");
  await expect.poll(async () => (await open(page, "confirmed")).length).toBe(0);
  expect((await devOf(page)).map((c) => c.status)).toEqual(["closed"]); // closed because a statement changed, still on record
  await expect(panel(page)).toContainText("No possible conflicts on this canvas.");
  await panel(page).getByRole("button", { name: "Close" }).click();
  await expect(chip(page)).toBeHidden();
});

test("2. Not a conflict sticks for that exact pair; a manual edit doesn't raise new conflicts (v1)", async () => {
  await visualize(page, "# Calls\n\nTimeouts last thirty seconds.\n");
  await expect(chip(page)).toHaveText("⚠ 1 possible conflict");
  await decideFirst(page, "Not a conflict");
  await expect(chip(page)).toBeHidden();
  expect((await open(page, "dismissed")).length).toBe(1);
  const calls = await blockWith(page, "Timeouts last thirty seconds.");
  await editBlock(page, calls, "thirty seconds", "twenty seconds");
  await page.waitForTimeout(1500);
  await expect(chip(page)).toBeHidden();
});

test("3. Later hides it until either card changes", async () => {
  await visualize(page, "# Nodes\n\nEach node has 32 GB of memory.\n");
  await visualize(page, "# Sizing\n\nEach node has 16 GB of memory.\n");
  await expect(chip(page)).toHaveText("⚠ 1 possible conflict");
  await decideFirst(page, "Later");
  await expect(chip(page)).toBeHidden();
  const nodes = await blockWith(page, "Each node has 32 GB of memory.");
  await editBlock(page, nodes, "of memory.", "of memory. It runs Linux.");
  await expect(chip(page)).toHaveText("⚠ 1 possible conflict");
});

test("4. undoing the commit that raised a conflict closes it (a statement changed), never silently deletes it", async () => {
  await visualize(page, "# Deploys\n\nDeploys take at most 15 minutes.\n");
  await visualize(page, "# Pipeline\n\nDeploys take 25 minutes.\n");
  await expect.poll(async () => (await open(page, "possible")).some((c) => c.a.sentence === "Deploys take 25 minutes.")).toBe(true);
  await undo(page);
  await expect.poll(async () => (await devOf(page)).find((c) => c.a.sentence === "Deploys take 25 minutes.")?.status).toBe("closed");
  expect((await devOf(page)).find((c) => c.a.sentence === "Deploys take 25 minutes.")?.note).toBe("statement changed");
});

test("5. Stage 3 'Leave as is' answers that exact pair — no repeat prompt; a later material change makes it eligible again", async ({ browser }) => {
  const p = await browser.newPage();
  await openApp(p);
  await visualize(p, GATEWAY);
  await visualize(p, "# Worker\n\nThe worker retries five times.\n");
  await expect(chip(p)).toBeHidden(); // they agree
  const update = async (text: string) => {
    const surface = await openAskAI(p, await blockWith(p, "Timeouts last ten seconds"));
    await (await action(surface, "Update from new content")).click();
    await updateDialog(p).getByRole("textbox").fill(text);
    await updateDialog(p).getByRole("button", { name: "Update", exact: true }).click();
    await expect(reviewBar(p)).toBeVisible();
  };
  await update(GATEWAY.replace("five times", "three times"));
  const offer = reviewBar(p).getByRole("listitem", { name: /^Elsewhere: / });
  await offer.getByRole("button", { name: "Leave as is" }).click();
  await reviewBar(p).getByRole("button", { name: "Accept all clean changes" }).click();
  await expect(reviewBar(p)).toBeHidden();
  await expect.poll(async () => (await devOf(p)).filter((c) => c.status === "dismissed" && c.note === "Left as is in the update review").length).toBe(1);
  await p.waitForTimeout(500);
  await expect(chip(p)).toBeHidden();

  await update(GATEWAY.replace("five times", "four times"));
  await reviewBar(p).getByRole("button", { name: /^Accept all/ }).click();
  await expect(reviewBar(p)).toBeHidden();
  await expect(chip(p)).toHaveText("⚠ 1 possible conflict");
  await p.context().close();
});
