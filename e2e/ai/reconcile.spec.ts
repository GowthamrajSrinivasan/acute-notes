/**
 * F38/F39 against real GitHub Copilot: "Update from new content" on an
 * AI-tier Visualize result re-analyses only the changed section — unchanged
 * sections send nothing — and identical content makes no AI request at all.
 * Run only through `npm run test:e2e:ai` (asks before running).
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { action, aiTaskOf, elements, openApp, openAskAI, promptOf, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";

test.describe.configure({ mode: "serial" });

const AI_TIMEOUT = 150_000;
let page: Page;
let aiRequests: Request[];
let objectId: string;

const section = (title: string, body: string) => `## ${title}\n\n${body}\n`;
const V1 = [
  "# Checkout reliability\n",
  section("Payments", "The Checkout API charges cards through a payment gateway; gateway timeouts trigger retries."),
  section("Orders", "Orders are written to the Orders database before the charge, with status pending."),
  section("Idempotency", "Retries reuse an idempotency key derived from the order id, so a card is never charged twice."),
].join("\n");
const V2 = V1.replace("with status pending", "with status pending, then confirmed by a webhook");

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const posts = () => aiRequests.filter((r) => r.method() === "POST");

async function updateFrom(p: Page, text: string) {
  const surface = await openAskAI(p, objectId);
  await (await action(surface, "Update from new content")).click();
  await updateDialog(p).getByRole("textbox").fill(text);
  await updateDialog(p).getByRole("button", { name: "Update", exact: true }).click();
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  aiRequests = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test("an AI-tier Visualize result can be accepted and linked to its source", async () => {
  const before = new Set((await elements(page)).map((e) => e.id));
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(V1);
  await visualizeDialog(page).getByRole("radiogroup", { name: "Template" }).locator(`input[value="concept_map"]`).check();
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  const added = (await elements(page)).filter((e) => !before.has(e.id) && e.type !== "arrow" && !(e.type === "text" && e.containerId));
  expect(added.length).toBeGreaterThan(1);
  objectId = added[0]!.id;
});

test("identical content makes no AI request and changes nothing", async () => {
  aiRequests.length = 0;
  await updateFrom(page, V1);
  await expect(page.getByText("Nothing changed — the canvas already matches this content.")).toBeVisible({ timeout: AI_TIMEOUT });
  expect(posts()).toHaveLength(0);
});

test("one changed section: exactly one generate call, carrying only that section", async () => {
  aiRequests.length = 0;
  const nothingChanged = page.getByText("Nothing changed — the canvas already matches this content.");
  // The previous test's "Nothing changed" toast (shown for 4 s) must be gone first, or it would pass for this
  // test's outcome before this update has even reached the AI.
  await expect(nothingChanged).toBeHidden({ timeout: 10_000 });
  const generated = page.waitForResponse((r) => new URL(r.url()).pathname === "/api/ai/run" && aiTaskOf(r.request()) === "generate_visual_plan", { timeout: AI_TIMEOUT });
  await updateFrom(page, V2);
  // This update's own AI result, then what it produced: the review bar, or a fresh "Nothing changed".
  await generated;
  await expect(reviewBar(page).or(nothingChanged)).toBeVisible({ timeout: AI_TIMEOUT });
  const generate = posts().filter((r) => aiTaskOf(r) === "generate_visual_plan");
  expect(generate).toHaveLength(1);
  const prompt = promptOf(generate[0]!);
  expect(prompt).toContain("confirmed by a webhook");
  expect(prompt).not.toContain("idempotency key derived");
  expect(prompt).not.toContain("gateway timeouts");
  if (await reviewBar(page).isVisible()) await reviewBar(page).getByRole("button", { name: "Reject" }).click();
});
