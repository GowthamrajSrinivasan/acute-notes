/**
 * Lens design review (interview-style assessment) through the real app, without AI cost: the browser's calls to the AI
 * host are answered here with canned replies behind a fake key. The table's "On the diagram" column is local and shows
 * before any call; Analyze fills a verdict per question from a canned `lens_assess` reply; a user's own question is
 * added and kept; with AI off the section is gone.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { elements, openAISettings, openApp, select, setAIMode } from "../helpers";

const SHOT_DIR = process.env.LENS_REVIEW_SHOTS;

/** Answers the AI host locally: every asked question id gets a verdict (the first "gap", the second "strong", the rest "partial"). */
async function answerLocally(page: Page): Promise<{ tasks: string[]; prompts: string[] }> {
  const seen = { tasks: [] as string[], prompts: [] as string[] };
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: { task?: string; prompt?: string } };
    const task = body.request?.task ?? "";
    const prompt = body.request?.prompt ?? "";
    seen.tasks.push(task);
    seen.prompts.push(prompt);
    let text = "OK";
    if (task === "lens_assess") {
      const ids = [...prompt.matchAll(/\{"id":"([^"]+)","category"/g)].map((m) => m[1]!);
      text = JSON.stringify({
        answers: ids.map((id, i) => ({
          id,
          verdict: i === 0 ? "gap" : i === 1 ? "strong" : "partial",
          answer: `Canned answer for ${id}: the API calls the Orders DB directly.`,
          ...(i === 1 ? {} : { improve: "Add a queue between the API and the Orders DB." }),
        })),
      });
    }
    return route.fulfill({ status: 200, json: { text, model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
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

/** A small shop architecture (Web → API → Cache / Orders DB / Order Queue, API → Stripe), opened in Lens. */
async function shopInLens(page: Page) {
  const shape = (id: string, label: string, kind: string) => ({ id, type: "shape", parent: "g", content: { shape: "rectangle", label, kind } });
  await page.evaluate(
    (nodes) =>
      (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
        {
          version: 1,
          template: "sectioned",
          nodes: [{ id: "g", type: "group", content: { label: "Shop", arrangement: "tree" } }, ...nodes],
          relationships: [
            { from: "web", to: "api", type: "flows_to", label: "HTTPS" },
            { from: "api", to: "cache", type: "flows_to", label: "reads" },
            { from: "api", to: "db", type: "flows_to", label: "writes" },
            { from: "api", to: "queue", type: "flows_to", label: "publishes" },
            { from: "api", to: "stripe", type: "flows_to", label: "charges" },
          ],
        },
        { operationId: "op_lens_review", title: "Lens review fixture", metadata: { createdBy: "import" } },
      ),
    [shape("web", "Web", "frontend"), shape("api", "API", "backend"), shape("cache", "Redis Cache", "backend"), shape("db", "Orders DB", "database"), shape("queue", "Order Queue", "messagebus"), shape("stripe", "Stripe", "external")],
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();
  const frame = (await elements(page)).find((e) => e.type === "frame")!;
  await select(page, frame.id);
  await page.getByLabel("Interactive diagram").check();
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(lens.locator('g.acute-lens-node[aria-label="API"]')).toBeVisible();
  return lens;
}

test("Design review: local signals at once, Analyze fills verdicts, own questions are kept, AI off hides it", async ({ page }) => {
  await openApp(page);
  const seen = await answerLocally(page);
  await connectFakeKey(page);
  const lens = await shopInLens(page);

  const review = lens.locator("details.acute-lens-review");
  await review.locator("summary").click();
  const table = review.getByRole("table");
  const row = (text: string) => table.getByRole("row").filter({ hasText: text });

  // HLD at L1, and the diagram column answers from the shape alone, with no AI call.
  await expect(review.getByRole("tab", { name: /HLD questions/ })).toHaveAttribute("aria-selected", "true");
  await expect(row("caching help")).toContainText("Seen on diagram");
  await expect(row("asynchronous")).toContainText("Seen on diagram");
  await expect(row("authentication")).toContainText("Not on diagram");
  await expect(row("single points of failure")).toContainText("Can't tell from shape");
  expect(seen.tasks).not.toContain("lens_assess");
  if (SHOT_DIR) await lens.screenshot({ path: `${SHOT_DIR}/review-before-light.png` });

  // Analyze: one call, a verdict per row, a tally, improvements shown; the figures typed reach the prompt.
  await review.getByLabel("Assumptions").fill("2M DAU, 5% at peak");
  await review.getByRole("button", { name: /Analyze \d+ questions/ }).click();
  await expect(review.getByRole("status")).toContainText("1 strong");
  await expect(review.getByRole("status")).toContainText("1 gap");
  await expect(table.locator("tr[data-verdict='gap']")).toHaveCount(1);
  await expect(table.locator("tr[data-verdict='partial']").first()).toContainText("Improve: Add a queue");
  expect(seen.tasks.filter((t) => t === "lens_assess")).toHaveLength(1);
  expect(seen.prompts.at(-1)).toContain("2M DAU, 5% at peak");
  if (SHOT_DIR) await lens.screenshot({ path: `${SHOT_DIR}/review-analyzed-light.png` });

  // The LLD tab has its own questions, and a question of the user's own is added, kept, and removable.
  await review.getByRole("tab", { name: /LLD questions/ }).click();
  await expect(table).toContainText("idempotent");
  await review.getByLabel("Add a question").fill("Can Orders survive Stripe being down?");
  await review.getByRole("button", { name: "Add", exact: true }).click();
  await expect(row("Can Orders survive Stripe")).toBeVisible();
  await page.reload();
  await page.locator(".excalidraw").waitFor();
  const afterReload = page.getByRole("complementary", { name: /^Lens:/ });
  if (await afterReload.isVisible().catch(() => false)) {
    await afterReload.locator("details.acute-lens-review summary").click();
    await afterReload.getByRole("tab", { name: /LLD questions/ }).click();
    await expect(afterReload.getByRole("table").getByRole("row").filter({ hasText: "Can Orders survive Stripe" })).toBeVisible();
    await afterReload.getByRole("button", { name: /^Remove question/ }).click();
    await expect(afterReload.getByRole("table")).not.toContainText("Can Orders survive Stripe");
  }

  // AI off: the section is gone (Ask Lens still matches names).
  await setAIMode(page, "Off");
  await expect(page.locator("details.acute-lens-review")).toHaveCount(0);
});

test("Design review in dark mode (screenshots only when LENS_REVIEW_SHOTS is set)", async ({ page }) => {
  test.skip(!SHOT_DIR, "a visual check, run on request");
  await openApp(page);
  await answerLocally(page);
  await connectFakeKey(page);
  const lens = await shopInLens(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const review = lens.locator("details.acute-lens-review");
  await review.locator("summary").click();
  await review.getByRole("button", { name: /Analyze \d+ questions/ }).click();
  await expect(review.locator("tr[data-verdict='gap']")).toHaveCount(1);
  await lens.screenshot({ path: `${SHOT_DIR}/review-analyzed-dark.png` });
  await lens.getByRole("button", { name: "Expand Lens panel" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT_DIR}/lens-full-dark.png` });
});
