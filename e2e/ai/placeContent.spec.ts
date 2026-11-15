/**
 * Stage 2d's optional model step against a real AI connection (intelligent-update-engine-plan §10): "Ask AI to decide" in
 * "Where should this go?". The note is visualized locally first (no AI), so the only AI calls are `route_content` — one per
 * placement, three in all. The router alone can't tell these placements apart (they share the same words with both cards;
 * checked on the local tier); the model should pick by meaning, only among the cards shown, or ask. Each call is checked to
 * have really answered (a failed call silently leaves the router's own result). Run only through `npm run test:e2e:ai`.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, openApp, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";

test.describe.configure({ mode: "serial" });

const AI_TIMEOUT = 120_000;
const NOTES = ["# Cache", "", "## Sessions", "", "The cache stores user sessions.", "", "## Tokens", "", "The cache stores access tokens.", ""].join("\n");
const SESSIONS = "The cache stores user sessions.";
const TOKENS = "The cache stores access tokens.";

let page: Page;
let aiRequests: Request[];

const placeDialog = (p: Page) => p.getByRole("dialog", { name: "Where should this go?" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const routeCalls = () => aiRequests.filter((r) => r.method() === "POST" && aiTaskOf(r) === "route_content");
const log = (label: string, value: unknown) => console.log(`[route-check] ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);

/** Opens the dialog on `text`; the router must leave it undecided. Returns the dialog. */
async function undecided(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Place text in notes…" }).click();
  const d = placeDialog(p);
  await d.getByRole("textbox", { name: "Content to place" }).fill(text);
  await d.getByRole("button", { name: "Find a place" }).click();
  await expect(d.getByRole("status")).toContainText("more than one place");
  return d;
}

/** Asks the model once; checks the call really went out and answered. Returns the banner and which cards are now ticked. */
async function askModel(p: Page, text: string) {
  const d = await undecided(p, text);
  const before = routeCalls().length;
  const response = p.waitForResponse((r) => new URL(r.url()).pathname.startsWith("/api/ai/") && aiTaskOf(r.request()) === "route_content", { timeout: AI_TIMEOUT });
  await d.getByRole("button", { name: "Ask AI to decide" }).click();
  const r = await response;
  expect(r.status(), "route_content answered").toBe(200);
  // The model's answer was used: the button goes (it is offered only while there is no model answer).
  await expect(d.getByRole("button", { name: /Ask AI to decide|Asking AI/ })).toBeHidden({ timeout: AI_TIMEOUT });
  expect(routeCalls().length - before).toBe(1);
  const banner = await d.getByRole("status").innerText();
  // Top-level items only: each has its own "Why" list of evidence bullets.
  const items = d.locator(".acute-place-dialog__item");
  const ticked: string[] = [];
  for (const item of await items.all()) {
    const box = item.getByRole("checkbox").first();
    if (await box.isChecked()) ticked.push((await item.innerText()).split("\n")[0]!.split(" · ")[0]!.trim());
  }
  log(text, { banner, ticked });
  return { d, banner, ticked };
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  aiRequests = recordAIRequests(page);
  await openApp(page);
  // Visualized before AI is connected: the local tier, no AI call.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const v = page.getByRole("dialog", { name: "Visualize" });
  await v.getByRole("textbox").first().fill(NOTES);
  await v.getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  expect(aiRequests.filter((r) => r.method() === "POST")).toHaveLength(0);
  await connectAI(page);
});

test.afterAll(async () => {
  log("route_content calls", routeCalls().length);
  await page?.context().close();
});

test("1. API keys: the model picks the Tokens card", async () => {
  test.setTimeout(AI_TIMEOUT * 2);
  const { d, banner, ticked } = await askModel(page, "The cache stores API keys for an hour.");
  expect.soft(banner).toMatch(/^Best fit: the model picked one card/);
  expect.soft(ticked, "API keys belong with tokens").toEqual([TOKENS]);
  for (const t of ticked) expect(["A new card on its own", SESSIONS, TOKENS, "Cache"]).toContain(t);
  await d.getByRole("button", { name: "Cancel" }).click();
});

test("2. data, genuinely ambiguous: any valid answer — shown cards only, a new card, or a question back", async () => {
  test.setTimeout(AI_TIMEOUT * 2);
  const { d, banner, ticked } = await askModel(page, "The cache stores data for an hour.");
  expect(banner).toMatch(/^(Best fit: the model picked|No card is close|It could go in more than one place)/);
  for (const t of ticked) expect(["A new card on its own", SESSIONS, TOKENS, "Cache"]).toContain(t);
  await d.getByRole("button", { name: "Cancel" }).click();
});

test("3. browser logins: the model picks the Sessions card, and the placement is reviewed and written (last: the card it writes changes later routing)", async ({}, info) => {
  test.setTimeout(AI_TIMEOUT * 2);
  const text = "The cache stores browser logins for an hour.";
  const { d, banner, ticked } = await askModel(page, text);
  await page.screenshot({ path: info.outputPath("logins.png") });
  // The model's pick is the finding: recorded, soft, so every case runs. The mechanics (one call, used, shown cards only) are hard checks.
  expect.soft(banner).toMatch(/^Best fit: the model picked one card/);
  expect.soft(ticked, "logins belong with sessions").toEqual([SESSIONS]);
  expect(ticked.length).toBeGreaterThan(0);
  await d.getByRole("button", { name: "Propose" }).click();
  await expect(reviewBar(page)).toBeVisible();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  const written = await page.evaluate((needle) => {
    type El = { customData?: { acute?: { documentId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return dev.api.getSceneElements().some((el) => JSON.stringify(dev.store.get(el.customData?.acute?.documentId ?? "")?.snapshot ?? "").includes(needle));
  }, "browser logins");
  expect(written).toBe(true);
});
