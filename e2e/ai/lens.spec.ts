/**
 * Acute Lens Phase 5 (plan §6) against a real AI connection: ✨ Explain, Ask Lens's AI path and ✨ Generate the next
 * level, on a small hand-made architecture. A real model's wording varies, so the checks are about behaviour: what is
 * sent (bounded, a secret redacted), that the answers land where they should, and that nothing is written before
 * Accept. Run only through `npm run test:e2e:ai` (asks before running).
 */
import { expect, test, type Page } from "@playwright/test";
import { aiTaskOf, canvasHome, elements, openApp, promptOf, recordAIRequests, select } from "../helpers";
import { connectAI } from "../aiProvider";
import { AI_TIMEOUT } from "../aiReview";

test.describe.configure({ mode: "serial" });

const SECRET = "sk-live-AbCdEfGhIjKlMnOpQrStUv12";
const LABELS = ["Web app", "Orders API", "Payments service", "Postgres"];

let page: Page;
let requests: ReturnType<typeof recordAIRequests>;
let origin = "";

const lens = () => page.getByRole("complementary", { name: /^Lens:/ });
const node = (label: string) => lens().locator(`g.acute-lens-node[aria-label="${label}"]`);
const lensRequests = (task: string) => requests.filter((r) => aiTaskOf(r) === task);

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
  requests = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
  origin = canvasHome(page).canvasId;
  // A shop's architecture, drawn as an interactive frame (no AI: a fixture plan through the review bar).
  await page.evaluate(
    ([secret]) =>
      (window as unknown as { __acuteDev: { renderPlan(plan: unknown, p: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
        {
          version: 1,
          template: "sectioned",
          nodes: [
            { id: "g", type: "group", content: { label: "Shop", arrangement: "tree" } },
            { id: "web", type: "shape", parent: "g", content: { shape: "rectangle", label: "Web app", kind: "frontend" } },
            { id: "orders", type: "shape", parent: "g", content: { shape: "rectangle", label: "Orders API", kind: "backend", details: ["Creates orders", `api_key=${secret}`] } },
            { id: "pay", type: "shape", parent: "g", content: { shape: "rectangle", label: "Payments service", kind: "backend", details: ["Charges cards through a payment gateway", "Refunds"] } },
            { id: "db", type: "shape", parent: "g", content: { shape: "rectangle", label: "Postgres", kind: "database" } },
          ],
          relationships: [
            { from: "web", to: "orders", type: "flows_to", label: "checkout" },
            { from: "orders", to: "pay", type: "flows_to", label: "charge" },
            { from: "orders", to: "db", type: "flows_to", label: "SQL" },
          ],
        },
        { operationId: "op_lens_ai_real", title: "Lens fixture", metadata: { createdBy: "import" } },
      ),
    [SECRET] as const,
  );
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect(review).toBeHidden();
  const frame = (await elements(page)).find((e) => e.type === "frame")!;
  await select(page, frame.id);
  await page.getByLabel("Interactive diagram").check();
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  await expect(node("Orders API")).toBeVisible();
});

test.afterAll(async () => {
  await page?.context().close();
});

test("✨ Explain: an explanation of the node in its context, the secret never sent, nothing written", async () => {
  const before = (await elements(page)).length;
  await node("Orders API").click();
  await lens().getByRole("button", { name: "✨ Explain" }).click();
  const explanation = lens().getByRole("region", { name: "Explanation" });
  await expect(explanation.locator(".acute-lens-ai__text")).not.toBeEmpty({ timeout: AI_TIMEOUT });
  const text = (await explanation.locator(".acute-lens-ai__text").textContent()) ?? "";
  expect(text.length).toBeGreaterThan(40);
  // It talks about this node's neighbours (the facts it was given), not something else.
  expect(LABELS.filter((l) => l !== "Orders API").some((l) => text.toLowerCase().includes(l.toLowerCase().split(" ")[0]!))).toBe(true);
  const sent = promptOf(lensRequests("lens_explain").at(-1)!);
  expect(sent).toContain("Orders API");
  expect(sent).toContain("Payments service");
  expect(sent).not.toContain(SECRET);
  await expect(explanation.getByRole("button", { name: "Open in Ask AI" })).toBeVisible();
  expect((await elements(page)).length).toBe(before); // explaining writes nothing
  await explanation.getByRole("button", { name: "Close" }).click();
});

test("Ask Lens in your own words: no name matches, so AI maps it onto a node Lens has", async () => {
  const ask = lens().getByLabel("Question for Lens");
  const sentBefore = lensRequests("lens_navigate").length;
  await ask.fill("which part keeps the data?");
  await ask.press("Enter");
  const status = lens().getByRole("search", { name: "Ask Lens" }).getByRole("status");
  await expect(status).toContainText(/found with AI|No node in this view fits/, { timeout: AI_TIMEOUT });
  expect(lensRequests("lens_navigate").length).toBe(sentBefore + 1);
  const said = (await status.textContent()) ?? "";
  if (said.includes("found with AI")) expect(LABELS.some((l) => said.includes(l))).toBe(true);
  // Only keys and labels were sent: not the details.
  expect(promptOf(lensRequests("lens_navigate").at(-1)!)).not.toContain("payment gateway");
});

test("✨ Generate L2: a proposal on the Detail Canvas, reviewed there; Accept links the node and opens its level", async () => {
  await node("Payments service").click();
  await lens().getByRole("button", { name: "✨ Generate L2 for Payments service" }).click();
  await expect.poll(() => canvasHome(page).canvasId, { timeout: AI_TIMEOUT }).not.toBe(origin);
  const review = page.getByRole("region", { name: "AI changes to review" });
  await expect(review).toContainText("Lens: Payments service — L2 Component (AI proposal)");
  // Nothing on the detail canvas yet: it is only proposed.
  expect((await elements(page)).filter((e) => e.type === "frame")).toHaveLength(0);
  await review.getByRole("button", { name: /^Accept all/ }).click();
  await expect(review).toBeHidden();

  await expect(lens().locator(".acute-lens-panel__crumb-current")).toHaveText("Payments service · L2", { timeout: 20_000 });
  const parts = lens().locator("g.acute-lens-node");
  await expect.poll(() => parts.count()).toBeGreaterThan(0);
  await parts.first().click();
  await expect(lens().locator(".acute-lens-panel__inspector")).toContainText("AI-generated, not verified");
  // Back up on the user's own canvas, the node now drills into its new level.
  await lens().locator(".acute-lens-panel__crumbs").getByRole("button", { name: "Shop" }).click();
  await expect(node("Payments service")).toHaveAttribute("data-has-child", "");
  expect(promptOf(lensRequests("lens_expand").at(-1)!)).not.toContain(SECRET);
});
