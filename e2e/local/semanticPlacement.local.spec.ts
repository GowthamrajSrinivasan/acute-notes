/**
 * Stage 5 in the real app (plan §18), no AI call: "Where should this go?" ranked by meaning with the local MiniLM-L6 model, and content
 * placed INSIDE an existing card (a list item, a table row, a changed table value) as a reviewed patch — no new card.
 *
 * Needs a dev server with both switches on and the model's weights in the local cache, at ACUTE_SEMANTIC_URL, e.g.
 *   ACUTE_EMBEDDINGS=local-model:minilm-l6 NEXT_PUBLIC_SEMANTIC_PLACEMENT=on npx next dev -p 3107
 *   ACUTE_SEMANTIC_URL=http://localhost:3107 npx playwright test e2e/local/semanticPlacement.local.spec.ts
 * Skipped otherwise.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../helpers";

const URL = process.env.ACUTE_SEMANTIC_URL;
test.skip(!URL, "needs a dev server with semantic placement switched on (ACUTE_SEMANTIC_URL)");
if (URL) test.use({ baseURL: URL });

const NOTES = [
  "# Platform",
  "",
  "## Security",
  "",
  "API keys are rotated every thirty days by the platform team.",
  "",
  "## Release checklist",
  "",
  "- Back up the production database",
  "- Rotate the application logs",
  "",
  "## Timeouts",
  "",
  "| Service | Timeout |",
  "| --- | --- |",
  "| Gateway | 10 s |",
  "| Worker | 30 s |",
  "",
].join("\n");

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const placeDialog = (p: Page) => p.getByRole("dialog", { name: "Where should this go?" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const places = (p: Page) => placeDialog(p).getByRole("list", { name: "Places it could go" });

type Dev = { api: { getSceneElements(): { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[] }; store: { get(id: string): { snapshot: unknown } | null } };
/** Every live block's stored text, joined. */
const canvasText = (p: Page) =>
  p.evaluate(() => {
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return dev.api.getSceneElements().map((el) => JSON.stringify(dev.store.get(el.customData?.acute?.documentId ?? "")?.snapshot ?? "")).join("\n");
  });
/** How many live blocks (cards) the canvas holds. */
const cardCount = (p: Page) =>
  p.evaluate(() => (window as unknown as { __acuteDev: Dev }).__acuteDev.api.getSceneElements().filter((el) => !el.isDeleted && el.customData?.acute?.documentId).length);

async function visualize(p: Page, notes: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(p).getByRole("textbox").first().fill(notes);
  await visualizeDialog(p).getByRole("button", { name: "Visualize", exact: true }).click();
  const local = p.getByRole("button", { name: "Use local structure instead" });
  await expect(reviewBar(p).or(local)).toBeVisible();
  if (await local.isVisible()) await local.click();
  await reviewBar(p).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(p)).toBeHidden();
}

async function place(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Place text in notes…" }).click();
  await placeDialog(p).getByRole("textbox", { name: "Content to place" }).fill(text);
  await placeDialog(p).getByRole("button", { name: "Find a place" }).click();
  await expect(placeDialog(p).getByRole("status")).toBeVisible({ timeout: 60_000 });
}

/** Proposes the first (preselected or picked) place, accepts the review, and returns the review's description. */
async function proposeFirst(p: Page): Promise<string> {
  const top = places(p).getByRole("listitem").first();
  const box = top.getByRole("checkbox").first();
  if (!(await box.isChecked())) await box.check();
  await placeDialog(p).getByRole("button", { name: "Propose" }).click();
  await expect(reviewBar(p)).toBeVisible();
  await reviewBar(p).getByRole("button", { name: "Review", exact: true }).click();
  const described = (await reviewBar(p).textContent()) ?? "";
  await reviewBar(p).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(p)).toBeHidden();
  return described;
}

test.describe.configure({ mode: "serial" });
let page: Page;
let cards = 0;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
  await visualize(page, NOTES);
  cards = await cardCount(page);
});
test.afterAll(async () => {
  await page?.context().close();
});

test("the local model is served: the route answers with MiniLM-L6", async () => {
  const r = await page.request.get("/api/ai/embed");
  expect(r.status()).toBe(200);
  expect(await r.json()).toMatchObject({ embedder: "local-minilm-l6-q8-v1", dims: 384 });
});

test("a paraphrase with almost no shared words finds its card by meaning", async ({}, info) => {
  await place(page, "Credentials get replaced once a month.");
  console.log("[paraphrase]", await placeDialog(page).textContent());
  await page.screenshot({ path: info.outputPath("semantic-paraphrase.png") });
  await expect(places(page).getByRole("listitem").first()).toContainText("rotated every thirty days");
  await placeDialog(page).getByRole("button", { name: "Cancel" }).click();
});

test("a new checklist step goes INTO the list card — no new card", async ({}, info) => {
  await place(page, "Back up the staging database before each release");
  console.log("[list]", await placeDialog(page).textContent());
  await page.screenshot({ path: info.outputPath("semantic-list.png") });
  await expect(places(page).getByRole("listitem").first()).toContainText("Back up the production database");
  // A sibling step, not a rewrite of the production one: it goes after it, in the same list.
  await expect(places(page).getByRole("listitem").first()).not.toContainText("Update the card");
  const described = await proposeFirst(page);
  console.log("[list review]", described);
  await expect.poll(() => canvasText(page)).toContain("Back up the staging database before each release");
  expect(await canvasText(page)).toContain("Back up the production database");
  expect(await cardCount(page)).toBe(cards);
});

test("a new service's timeout becomes a row of the existing table — no new card", async ({}, info) => {
  await place(page, "Scheduler | 45 s");
  console.log("[row]", await placeDialog(page).textContent());
  await page.screenshot({ path: info.outputPath("semantic-row.png") });
  await expect(places(page).getByRole("listitem").first()).toContainText("Add a row to the table: “Scheduler · 45 s”");
  const described = await proposeFirst(page);
  console.log("[row review]", described);
  await expect.poll(() => canvasText(page)).toContain("Scheduler");
  expect(await cardCount(page)).toBe(cards);
});

test("a changed value updates that table cell only — no new card", async ({}, info) => {
  await place(page, "The Worker timeout is now 60 s.");
  console.log("[cell]", await placeDialog(page).textContent());
  await page.screenshot({ path: info.outputPath("semantic-cell.png") });
  await expect(places(page).getByRole("listitem").first()).toContainText("Worker");
  const described = await proposeFirst(page);
  console.log("[cell review]", described);
  await expect.poll(() => canvasText(page)).toContain("60 s");
  const text = await canvasText(page);
  expect(text).not.toContain("30 s");
  expect(text).toContain("10 s");
  expect(await cardCount(page)).toBe(cards);
});

test("content nothing on the canvas is about: a new card is the suggestion, listed first, nothing picked", async ({}, info) => {
  await place(page, "The office plants are watered on Fridays.");
  console.log("[nowhere]", await placeDialog(page).textContent());
  await page.screenshot({ path: info.outputPath("semantic-nowhere.png") });
  await expect(places(page).getByRole("listitem").first()).toContainText("A new card on its own (suggested)");
  for (const box of await places(page).getByRole("checkbox").all()) await expect(box).not.toBeChecked();
  await placeDialog(page).getByRole("button", { name: "Cancel" }).click();
});
