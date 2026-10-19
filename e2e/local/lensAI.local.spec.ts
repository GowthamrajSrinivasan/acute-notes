/**
 * Acute Lens Phase 5 (plan §6): AI in Lens through the real app, without AI cost — the browser's calls to the AI host
 * are answered here with canned replies per task, behind a fake key. ✨ Explain shows and saves an explanation and
 * "Add as note" proposes a linked card; ✨ Generate proposes the next level on a new Detail Canvas, and accepting it
 * links the node to it (Lens opens there, the parts marked AI-generated with the model's confidence); Ask Lens finds
 * nodes by name locally and asks AI only when no name matches; with AI off, none of it shows.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { canvasHome, elements, openAISettings, openApp, select, setAIMode } from "../helpers";

const PLAN = {
  version: 1,
  template: "architecture",
  nodes: [
    { id: "n1", type: "shape", content: { shape: "rectangle", label: "Cart", kind: "frontend" } },
    { id: "n2", type: "shape", content: { shape: "rectangle", label: "Checkout form", kind: "frontend" } },
  ],
  relationships: [{ from: "n1", to: "n2", type: "flows_to", label: "items", confidence: 0.6 }],
  metadata: { title: "Frontend" },
};

/** Answers the AI host locally, per task; returns the tasks seen. */
async function answerLocally(page: Page): Promise<string[]> {
  const tasks: string[] = [];
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: { task?: string; prompt?: string } };
    const task = body.request?.task ?? "";
    tasks.push(task);
    const prompt = body.request?.prompt ?? "";
    let text = "OK";
    if (task === "lens_explain") text = "The **API** receives each request from the Frontend and answers it.";
    if (task === "lens_expand") text = JSON.stringify(PLAN);
    if (task === "lens_navigate") {
      const api = /\{"key":"([^"]+)","label":"API"/.exec(prompt)?.[1] ?? null;
      text = JSON.stringify({ from: api, to: null });
    }
    return route.fulfill({ status: 200, json: { text, model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
  });
  return tasks;
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

/** A "Payments" architecture frame (Frontend → API), opened in Lens. */
async function paymentsInLens(page: Page) {
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
      {
        version: 1,
        template: "sectioned",
        nodes: [
          { id: "g", type: "group", content: { label: "Payments", arrangement: "tree" } },
          { id: "ui", type: "shape", parent: "g", content: { shape: "rectangle", label: "Frontend", kind: "frontend" } },
          { id: "api", type: "shape", parent: "g", content: { shape: "rectangle", label: "API", kind: "backend" } },
        ],
        relationships: [{ from: "ui", to: "api", type: "flows_to", label: "request" }],
      },
      { operationId: "op_lens_ai", title: "Lens fixture", metadata: { createdBy: "import" } },
    ),
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

test("Explain, Add as note, Generate the next level on the Detail Canvas, Ask Lens — with canned AI replies", async ({ page }) => {
  await openApp(page);
  const tasks = await answerLocally(page);
  await connectFakeKey(page);
  const origin = canvasHome(page).canvasId;
  const lens = await paymentsInLens(page);
  const node = (label: string) => lens.locator(`g.acute-lens-node[aria-label="${label}"]`);
  const review = page.getByRole("region", { name: "AI changes to review" });

  // ✨ Explain: shown in the inspector, saved as a conversation; "Add as note" proposes a card linked explained_by.
  await node("API").click();
  await lens.getByRole("button", { name: "✨ Explain" }).click();
  const explanation = lens.getByRole("region", { name: "Explanation" });
  await expect(explanation).toContainText("receives each request from the Frontend");
  await expect(explanation.getByRole("button", { name: "Open in Ask AI" })).toBeVisible();
  await explanation.getByRole("button", { name: "Add as note" }).click();
  await expect(review).toContainText("Lens: explanation of API");
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();
  const linked = await page.evaluate(() => {
    const els = (window as unknown as { __acuteDev: { api: { getSceneElements(): { type: string; customData?: Record<string, unknown> }[] } } }).__acuteDev.api.getSceneElements();
    return els.some((e) => e.type === "arrow" && e.customData?.acuteRelation === "explained_by");
  });
  expect(linked).toBe(true);

  // Ask Lens: names in the question are found locally (no AI call); a trace between them.
  const ask = lens.getByLabel("Question for Lens");
  await ask.fill("how does the frontend reach the api?");
  await ask.press("Enter");
  await expect(lens.getByRole("search", { name: "Ask Lens" })).toContainText("Frontend → API");
  await expect(lens.getByRole("region", { name: "Trace" })).toContainText("Frontend");
  expect(tasks).not.toContain("lens_navigate");
  // …and only when no name matches, AI maps the question onto the keys Lens has.
  await ask.fill("where are requests handled?");
  await ask.press("Enter");
  await expect(lens.getByRole("search", { name: "Ask Lens" })).toContainText("API (found with AI)");
  expect(tasks).toContain("lens_navigate");
  await lens.getByRole("region", { name: "Trace" }).getByRole("button", { name: "Clear" }).click().catch(() => undefined);

  // ✨ Generate L2 for Frontend: proposed on a new Detail Canvas, reviewed there.
  await node("Frontend").click();
  await lens.getByRole("button", { name: "✨ Generate L2 for Frontend" }).click();
  await expect.poll(() => canvasHome(page).canvasId).not.toBe(origin);
  await expect(page.getByRole("navigation").getByText(/· detail$/).first()).toBeVisible();
  await expect(review).toContainText("Lens: Frontend — L2 Component (AI proposal)");
  await review.getByRole("button", { name: /^Accept all/ }).click();
  await expect(review).toBeHidden();

  // Accepting linked Frontend to the new level: Lens opens one level down, on the Detail Canvas.
  const lensNow = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(lensNow.locator(".acute-lens-panel__crumb-current")).toHaveText("Frontend · L2");
  await expect(lensNow).toContainText("L2 Component");
  const cart = lensNow.locator('g.acute-lens-node[aria-label="Cart"]');
  await expect(cart).toBeVisible();
  await cart.click();
  const inspector = lensNow.locator(".acute-lens-panel__inspector");
  await expect(inspector).toContainText("AI-generated, not verified");
  await expect(inspector).toContainText("AI · 60% sure");
  // Up a level: the user's own canvas, untouched except for the link.
  await lensNow.locator(".acute-lens-panel__crumbs").getByRole("button", { name: "Payments" }).click();
  await expect(lensNow.locator('g.acute-lens-node[aria-label="Frontend"]')).toHaveAttribute("data-has-child", "");
  expect(tasks.filter((t) => t.startsWith("lens_"))).toEqual(["lens_explain", "lens_navigate", "lens_expand"]);
});

test("with AI off, Lens shows no AI actions and Ask Lens still finds names", async ({ page }) => {
  await openApp(page);
  await setAIMode(page, "Off");
  const lens = await paymentsInLens(page);
  await lens.locator('g.acute-lens-node[aria-label="API"]').click();
  await expect(lens.getByRole("button", { name: "✨ Explain" })).toHaveCount(0);
  await expect(lens.getByRole("button", { name: /Generate L2/ })).toHaveCount(0);
  const ask = lens.getByLabel("Question for Lens");
  await ask.fill("what calls the api");
  await ask.press("Enter");
  await expect(lens.getByRole("search", { name: "Ask Lens" })).toContainText("API");
  await ask.fill("where are requests handled?");
  await ask.press("Enter");
  await expect(lens.getByRole("search", { name: "Ask Lens" })).toContainText("Turn on AI");
});
