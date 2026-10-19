/**
 * F31 against real GitHub Copilot: the AI tier of Visualize end to end —
 * outline_document then generate_visual_plan per section, validated (F29), rendered (F30)
 * and reviewed (F19) — plus forcing a template, Cancel mid-analysis with the
 * canvas still usable, and one undo removing an accepted result.
 * Run only through `npm run test:e2e:ai` (asks before running).
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, createDemoCanvas, elements, openApp, promptOf, recordAIRequests, undo } from "../helpers";
import { AI_ACCESS_LABEL, AI_PROVIDER, AI_PROVIDER_NAME, connectAI } from "../aiProvider";

test.describe.configure({ mode: "serial" });

const AI_TIMEOUT = 150_000;
let page: Page;
let aiRequests: Request[];

const PROSE =
  "Our checkout has a web client that calls a Checkout API over HTTPS. The API writes orders to an Orders database " +
  "and charges cards through a third-party payment gateway. When the gateway times out, the API retries, which has " +
  "caused double charges. We plan to add idempotency keys derived from the order id so a retry can never charge twice.";

/** Consecutive repeats collapsed: [a, a, b] → [a, b]. */
const steps = (tasks: readonly (string | undefined)[]) => tasks.filter((t, i) => t !== tasks[i - 1]);

const dialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const status = (p: Page) => p.getByRole("status", { name: "Visualize" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

async function openVisualize(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await expect(dialog(p)).toBeVisible();
  await dialog(p).getByRole("textbox").fill(text);
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  aiRequests = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
  await createDemoCanvas(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test("the dialog says where content is sent, before anything is sent", async () => {
  await openVisualize(page, PROSE);
  await expect(dialog(page)).toContainText(new RegExp(`Sends ~\\d+ words to: ${AI_PROVIDER_NAME[AI_PROVIDER]} · ${AI_ACCESS_LABEL[AI_PROVIDER]}`));
  expect(aiRequests).toHaveLength(0);
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
});

test("unstructured prose: outlined, then generated, and lands as one reviewable change set", async () => {
  const before = new Set((await elements(page)).map((e) => e.id));
  aiRequests.length = 0;
  await openVisualize(page, PROSE);
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(status(page)).toContainText(/Analyzing|Planning layout/);

  await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
  const tasks = aiRequests.filter((r) => r.method() === "POST").map(aiTaskOf);
  // The runtime may repeat a call once (its repair retry after an invalid reply): compare the distinct steps in order.
  // select_template is gone (content fidelity plan): every document without a forced template is outlined first.
  expect(steps(tasks)).toEqual(["outline_document", "generate_visual_plan"]);
  expect(promptOf(aiRequests.filter((r) => r.method() === "POST").at(-1)!)).toContain("idempotency keys");
  expect((await elements(page)).length).toBe(before.size); // still only a preview

  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added");
  const added = (await elements(page)).filter((e) => !before.has(e.id));
  expect(added.length).toBeGreaterThan(1);
  await undo(page);
  expect((await elements(page)).filter((e) => !before.has(e.id))).toEqual([]);
});

test("a forced template skips the outline: one generation call", async () => {
  aiRequests.length = 0;
  await openVisualize(page, PROSE);
  await dialog(page).getByRole("radiogroup", { name: "Template" }).locator(`input[value="architecture"]`).check();
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
  const tasks = aiRequests.filter((r) => r.method() === "POST").map(aiTaskOf);
  expect(steps(tasks)).toEqual(["generate_visual_plan"]);
  await reviewBar(page).getByRole("button", { name: "Reject" }).click();
});

test("Cancel stops analysis, the canvas stays usable meanwhile, and nothing is proposed", async () => {
  await openVisualize(page, PROSE);
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(status(page)).toBeVisible();

  // Mid-request: pan with real input — the dialog has closed and nothing blocks the canvas.
  const scrollY = () => page.evaluate(() => (window as unknown as { __acuteDev: { api: { getAppState(): { scrollY: number } } } }).__acuteDev.api.getAppState().scrollY);
  const before = await scrollY();
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 300);
  await expect.poll(scrollY).not.toBe(before);

  await status(page).getByRole("button", { name: "Cancel" }).click();
  await expect(dialog(page)).toBeVisible(); // back to the form, text kept
  await expect(dialog(page).getByRole("textbox")).toHaveValue(PROSE);
  await page.waitForTimeout(3_000);
  await expect(reviewBar(page)).toBeHidden();
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
});
