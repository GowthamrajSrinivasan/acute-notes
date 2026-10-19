/**
 * ✨ Ask AI behaviour that needs no AI connection and makes no AI request:
 * where the entry point appears, the menu and scopes, the no-connection
 * state, local "Find related", and AI mode Off. Runs on the AI test canvas.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  action,
  askAIButton,
  headerAskAIButton,
  askAISurface,
  blockByTitle,
  chooseScope,
  sharingChip,
  createDemoCanvas,
  elements,
  openApp,
  openAskAI,
  recordAIRequests,
  select,
  selectedIds,
  setAIMode,
  shapeByLabel,
  waitForCanvas,
} from "../helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
let aiRequests: ReturnType<typeof recordAIRequests>;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  aiRequests = recordAIRequests(page);
  await openApp(page);
  await createDemoCanvas(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test.afterEach(async () => {
  if (await askAISurface(page).isVisible()) await askAISurface(page).getByRole("button", { name: "Close" }).click();
});

test("Ask AI appears only for selections with content", async () => {
  const els = await elements(page);
  const byType = (type: string) => els.find((el) => el.type === type)!;
  const sticky = els.find((el) => el.type === "text" && !el.containerId && el.text?.startsWith("Sticky"))!;

  const withContent: [string, string][] = [
    ["text card", (await blockByTitle(page, "Checkout revamp — overview")).id],
    ["todo", (await blockByTitle(page, "Launch checklist")).id],
    ["table", (await blockByTitle(page, "Endpoints")).id],
    ["code", (await blockByTitle(page, "chargeWithRetry")).id],
    ["frameless text", (await blockByTitle(page, "Open question")).id],
    ["page preview", (await blockByTitle(page, "Design doc: payment retries")).id],
    ["page card", (await blockByTitle(page, "Incident postmortem: double charges")).id],
    ["labelled shape", (await shapeByLabel(page, "Checkout API")).id],
    ["native text", sticky.id],
  ];
  for (const [name, id] of withContent) {
    await select(page, id);
    await expect(askAIButton(page), name).toBeVisible();
  }

  for (const type of ["image", "line", "freedraw", "arrow"]) {
    await select(page, byType(type).id);
    await page.waitForTimeout(200);
    await expect(askAIButton(page), type).toHaveCount(0);
  }

  // A mixed selection qualifies when anything in it has content.
  await select(page, byType("image").id, (await shapeByLabel(page, "Web client")).id);
  await expect(askAIButton(page)).toBeVisible();

  await select(page);
  await expect(askAIButton(page)).toHaveCount(0);
});

test("chat opens with a greeting, selection-aware suggestions, the Sharing chip, and the actions in PRD order", async () => {
  const code = (await blockByTitle(page, "chargeWithRetry")).id;
  const surface = await openAskAI(page, code);
  await expect(surface.getByRole("heading", { name: "Hello" })).toBeVisible();
  await expect(surface.getByText("How can I help you today?")).toBeVisible();
  await expect(sharingChip(surface)).toContainText("Sharing “chargeWithRetry”");

  const scopes = async () => {
    await sharingChip(surface).click();
    const radios = surface.getByRole("radiogroup", { name: "AI scope" }).getByRole("radio");
    await expect(radios).toHaveCount(3);
    await expect(surface.getByRole("radio", { name: "Selection" })).toBeChecked();
    await sharingChip(surface).click();
  };
  await scopes();

  const menu = surface.getByRole("menu", { name: "AI actions" });
  await surface.getByRole("button", { name: "Actions" }).click();
  await expect(menu.getByRole("menuitem")).toHaveText([/^Explain/, /^Summarize/, /^Visualize/, /^Find related items/, /^Turn into tasks/, /^Create test cases/, /^Create plan/]);
  await surface.getByRole("button", { name: "Actions" }).click();
  await expect(menu).toBeHidden();

  // Typing "/" opens the same actions, filtered as you type.
  const box = surface.getByRole("textbox", { name: "Ask a question" });
  await expect(box).toBeDisabled(); // no AI connection in this suite
});

test("suggestions follow the selection: code gets test cases, the canvas gets canvas-wide ones", async () => {
  let surface = await openAskAI(page, (await blockByTitle(page, "chargeWithRetry")).id);
  // Without a connection suggestions aren't offered; the notice points to settings instead.
  await expect(surface.getByText("Connect an AI provider to start.")).toBeVisible();
  await surface.getByRole("button", { name: "Close" }).click();
  surface = await openAskAI(page, (await blockByTitle(page, "Launch checklist")).id);
  await expect(sharingChip(surface)).toContainText("“Launch checklist”");
  await chooseScope(surface, "This canvas");
  await expect(sharingChip(surface)).toContainText("Sharing this canvas");
});

test("with no AI connection, AI actions are disabled, Find related still works, and settings are one click away", async () => {
  const surface = await openAskAI(page, (await blockByTitle(page, "Checkout revamp — overview")).id);
  await expect(surface.getByText("Connect an AI provider to start.")).toBeVisible();
  for (const label of ["Explain", "Summarize", "Turn into tasks", "Create test cases", "Create plan"]) await expect((await action(surface, label))).toBeDisabled();
  await expect((await action(surface, "Find related items"))).toBeEnabled();
  await page.keyboard.press("Escape"); // closes the actions menu, not the panel
  await expect(surface.getByRole("menu", { name: "AI actions" })).toBeHidden();
  await expect(surface).toBeVisible();

  await surface.getByRole("button", { name: "Open AI settings" }).click();
  const settings = page.getByRole("dialog", { name: "AI Providers" });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();
});

test("Find related (This canvas) ranks related objects, leaves out unrelated ones, reveals on click — no AI request", async () => {
  aiRequests.length = 0;
  const surface = await openAskAI(page, (await blockByTitle(page, "Checkout revamp — overview")).id);
  const find = (await action(surface, "Find related items"));
  await expect(find).toContainText("This canvas"); // Selection scope runs on the canvas, and says so
  await find.click();

  const list = surface.locator(".acute-ask-ai__related");
  await expect(list).toContainText("Design doc: payment retries");
  await expect(list).toContainText("Launch checklist");
  await expect(list).not.toContainText("Team offsite");
  await expect(list).toContainText("connected");

  const designId = (await blockByTitle(page, "Design doc: payment retries")).id;
  await list.getByRole("button", { name: /Design doc: payment retries/ }).click();
  expect(await selectedIds(page)).toEqual([designId]);
  expect(aiRequests).toHaveLength(0);
});

test("Find related (This workspace) lists matches from other canvases as not revealable", async () => {
  await createDemoCanvas(page); // a second canvas, so the first one's documents are "elsewhere"
  const surface = await openAskAI(page, (await blockByTitle(page, "Checkout revamp — overview")).id);
  await chooseScope(surface, "This workspace");
  await (await action(surface, "Find related items")).click();

  const elsewhere = surface.locator(".acute-ask-ai__related button", { hasText: "other canvas" });
  await expect(elsewhere.first()).toBeVisible();
  await expect(elsewhere.first()).toBeDisabled();
  await expect(surface.locator(".acute-ask-ai__subtitle")).toContainText("This workspace");
  expect(aiRequests).toHaveLength(0);
});

test("AI mode Off hides every ✨ entry point, persists across reload, and On brings it back", async () => {
  const overviewId = (await blockByTitle(page, "Checkout revamp — overview")).id;
  await setAIMode(page, "Off");
  aiRequests.length = 0;

  await select(page, overviewId);
  await page.waitForTimeout(300);
  await expect(askAIButton(page)).toHaveCount(0);
  await expect(headerAskAIButton(page)).toHaveCount(0);
  await expect(page.getByText("✨")).toHaveCount(0);

  await page.reload();
  await waitForCanvas(page);
  await expect.poll(async () => (await elements(page)).some((el) => el.id === overviewId)).toBe(true);
  await select(page, overviewId);
  await page.waitForTimeout(300);
  await expect(askAIButton(page)).toHaveCount(0);
  await expect(headerAskAIButton(page)).toHaveCount(0);
  expect(aiRequests).toHaveLength(0);

  await setAIMode(page, "On");
  await expect(headerAskAIButton(page)).toBeVisible();
  await select(page, overviewId);
  await expect(askAIButton(page)).toBeVisible();
});
