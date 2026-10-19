/**
 * F40: AI conversation history, without calling AI. Conversations are saved
 * through the app's store (dev hook) and every history surface is exercised
 * on the AI test canvas: the panel's History tab (clock next to Ask AI) with
 * its Selected / All toggle, continuing from History in the Chat tab,
 * persistence across reload, the "save on this device" setting, export, and
 * the delete-block prompt.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  askAIButton,
  askAISurface,
  blockByTitle,
  createDemoCanvas,
  historyPanel,
  openApp,
  openHistory,
  openAISettings,
  openAskAI,
  seedConversation,
  select,
  selectedIds,
  showConversations,
  undo,
  waitForCanvas,
} from "../helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
let overviewId = "";
let todoId = "";

async function openCanvasHistory(p: Page) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "AI conversations" }).click();
  await expect(historyPanel(p)).toBeVisible();
  return historyPanel(p);
}

async function deleteSelected(p: Page, id: string) {
  await select(p, id);
  await p.locator(".excalidraw").focus();
  await p.keyboard.press("Delete");
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  page.on("dialog", (d) => void d.accept());
  await openApp(page);
  await createDemoCanvas(page);
  overviewId = (await blockByTitle(page, "Checkout revamp — overview")).id;
  todoId = (await blockByTitle(page, "Launch checklist")).id;
  const overview = { anchorIds: [overviewId], anchorLabel: "Checkout revamp — overview" };
  await seedConversation(page, { ...overview, action: "summarize", question: "Summarize", reply: "Checkout drops **4%** of payments; retries fix it." });
  await seedConversation(page, { ...overview, question: "What is out of scope?", reply: "Changing payment providers." });
  await seedConversation(page, { anchorIds: [todoId], anchorLabel: "Launch checklist", question: "What is left?", reply: "Load testing and the runbook." });
});

test.afterAll(async () => {
  await page?.context().close();
});

test.afterEach(async () => {
  if (await askAISurface(page).isVisible()) await askAISurface(page).getByRole("button", { name: "Close" }).click();
});

test("the clock next to Ask AI opens History for the selected block, with a toggle for the whole canvas", async () => {
  await select(page, todoId);
  await expect(askAIButton(page)).toBeVisible();
  const panel = await openHistory(page, todoId);

  await expect(panel.getByRole("radio", { name: "Selected" })).toBeChecked();
  await expect(panel.locator(".acute-conv-row")).toHaveCount(1);
  await expect(panel).toContainText("What is left?");

  await showConversations(panel, "All on this canvas");
  await expect(panel.locator(".acute-conv-row")).toHaveCount(3);
  await expect(panel).toContainText("Summarize — Checkout revamp — overview");
  await expect(panel.locator(".acute-conv-row__age").first()).toHaveText(/now|\dm/);

  await panel.getByRole("searchbox").fill("left");
  await expect(panel.locator(".acute-conv-row")).toHaveCount(1);
});

test("opening a conversation from the panel continues it in Ask AI and selects its object", async () => {
  const panel = await openCanvasHistory(page);
  await panel.getByRole("button", { name: /What is out of scope\?/ }).click();

  const surface = askAISurface(page);
  await expect(surface).toBeVisible();
  await expect(surface.locator(".acute-ask-ai__you")).toContainText("What is out of scope?");
  await expect(surface.locator(".acute-ask-ai__result")).toContainText("Changing payment providers.");
  await expect(surface.getByRole("textbox", { name: "Ask a follow-up" })).toBeVisible();
  await expect(surface.getByText("Saved on this device")).toBeVisible();
  await expect.poll(() => selectedIds(page)).toEqual([overviewId]);
});

test("History follows the selection, and Chat links to the selection's earlier conversations", async () => {
  const panel = await openHistory(page, overviewId);
  await expect(panel.locator(".acute-conv-row")).toHaveCount(2);
  await expect(panel).not.toContainText("What is left?");

  // Selecting another block while History is open updates the list.
  await select(page, todoId);
  await expect(panel.locator(".acute-conv-row")).toHaveCount(1);
  await expect(panel).toContainText("What is left?");

  // Nothing selected: the Selected view says so.
  await select(page);
  await expect(panel).toContainText("Select an object to see its conversations.");

  const chat = await openAskAI(page, overviewId);
  await chat.getByRole("button", { name: "2 earlier conversations about this selection" }).click();
  await expect(chat.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true");
  await expect(chat.locator(".acute-conv-row")).toHaveCount(2);
});

test("conversations persist across a reload", async () => {
  await page.reload();
  await waitForCanvas(page);
  await expect.poll(async () => (await blockByTitle(page, "Launch checklist").catch(() => null))?.id).toBe(todoId);
  const panel = await openHistory(page, overviewId);
  await panel.getByRole("button", { name: /Summarize/ }).click();
  await expect(panel.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  await expect(panel.locator(".acute-ask-ai__result")).toContainText("retries fix it");
});

test("a conversation exports as a Markdown file", async () => {
  const panel = await openCanvasHistory(page);
  const row = panel.locator("li", { hasText: "What is left?" });
  await row.hover();
  const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: /Export/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  expect(text).toContain("# What is left?");
  expect(text).toContain("Load testing and the runbook.");
});

test("with saving off, new conversations are not kept after reload", async () => {
  const settings = await openAISettings(page);
  await settings.getByRole("radiogroup", { name: "Save AI conversations" }).getByText("Off").click();
  await settings.getByRole("button", { name: "Close" }).click();

  await seedConversation(page, { anchorIds: [todoId], anchorLabel: "Launch checklist", question: "Temporary question", reply: "Temporary answer" });
  await page.reload();
  await waitForCanvas(page);
  const panel = await openCanvasHistory(page);
  await expect(panel).toContainText("What is left?");
  await expect(panel).not.toContainText("Temporary question");
  await expect(panel).toContainText("Saving is off");
  await panel.getByRole("button", { name: "Close" }).click();

  const again = await openAISettings(page);
  await again.getByRole("radiogroup", { name: "Save AI conversations" }).getByText("On").click();
  await again.getByRole("button", { name: "Close" }).click();
});

test("deleting a block with conversations asks whether to delete them; undo dismisses the question", async () => {
  const prompt = page.getByRole("alert").filter({ hasText: "AI conversation" });

  // Delete, then Keep: the conversation stays, marked as about a deleted object.
  await deleteSelected(page, todoId);
  await expect(prompt).toContainText("Delete it too?");
  await prompt.getByRole("button", { name: "Keep" }).click();
  await expect(prompt).toBeHidden();
  let panel = await openCanvasHistory(page);
  await expect(panel.locator("li", { hasText: "What is left?" })).toContainText("deleted object");
  await panel.getByRole("button", { name: "Close" }).click();
  await undo(page);

  // Undo while asked: the question goes away.
  await deleteSelected(page, overviewId);
  await expect(prompt).toContainText("2 AI conversations");
  await undo(page);
  await expect(prompt).toBeHidden();

  // Delete, then Delete conversations: they're gone.
  await deleteSelected(page, overviewId);
  await prompt.getByRole("button", { name: "Delete conversations" }).click();
  panel = await openCanvasHistory(page);
  await expect(panel).not.toContainText("Summarize — Checkout revamp — overview");
  await expect(panel).not.toContainText("What is out of scope?");
});

test("Delete all empties the canvas history", async () => {
  const panel = await openCanvasHistory(page);
  await panel.getByRole("button", { name: "Delete all" }).click();
  await expect(panel).toContainText("No AI conversations on this canvas yet.");
});
