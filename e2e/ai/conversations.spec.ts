/**
 * F40: AI conversations against real GitHub Copilot. A typed question starts
 * a conversation, a follow-up carries the history, the conversation survives
 * a reload, and continuing it sends the stored history.
 * Run only through `npm run test:e2e:ai` (asks before running).
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { acceptProposal, aiTaskOf, askAISurface, blockByTitle, createDemoCanvas, openApp, openAskAI, openHistory, promptOf, recordAIRequests, waitForCanvas } from "../helpers";
import { AI_PROVIDER, connectAI } from "../aiProvider";

test.describe.configure({ mode: "serial" });

const AI_TIMEOUT = 150_000;
let page: Page;
let aiRequests: Request[];
let overviewId = "";

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  aiRequests = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
  await createDemoCanvas(page);
  overviewId = (await blockByTitle(page, "Checkout revamp — overview")).id;
});

test.afterAll(async () => {
  await page?.context().close();
});

async function send(text: string) {
  const surface = askAISurface(page);
  const replies = surface.locator(".acute-ask-ai__reply");
  const before = await replies.count();
  aiRequests.length = 0;
  const box = surface.getByRole("textbox", { name: /Ask a (question|follow-up)/ });
  await box.fill(text);
  await box.press("Enter");
  await expect(replies).toHaveCount(before + 1, { timeout: AI_TIMEOUT });
  const sent = aiRequests.filter((r) => r.method() === "POST").at(-1)!;
  return { prompt: promptOf(sent), task: aiTaskOf(sent), reply: (await replies.last().locator(".acute-ask-ai__result").innerText()).trim() };
}

test("a typed question starts a conversation titled by the question", async () => {
  await openAskAI(page, overviewId);
  const { prompt, task, reply } = await send("What is the main goal of this project?");
  expect(task).toBe("chat");
  expect(prompt).toContain("Checkout drops");
  expect(prompt).toContain("User: What is the main goal of this project?");
  expect(reply.length).toBeGreaterThan(10);
  expect(reply.toLowerCase()).toMatch(/0\.5|failed payments|retr/);

  const surface = askAISurface(page);
  await expect(surface.locator(".acute-ask-ai__title")).toContainText("What is the main goal of this project?");
  await expect(surface.getByText("Saved on this device")).toBeVisible();
});

test("a follow-up sends the conversation so far", async () => {
  const { prompt, task, reply } = await send("And what is explicitly out of scope?");
  expect(task).toBe("chat");
  expect(prompt).toContain("Conversation so far:");
  expect(prompt).toContain("User: What is the main goal of this project?");
  expect(prompt).toContain("Assistant: ");
  expect(prompt).toContain("User: And what is explicitly out of scope?");
  expect(reply.toLowerCase()).toMatch(/provider|mobile/);
  await expect(askAISurface(page).locator(".acute-ask-ai__reply")).toHaveCount(2);
});

test("after a reload the conversation is listed on the block, reopens intact, and continues with its stored history", async () => {
  await page.reload();
  await waitForCanvas(page);
  await expect.poll(async () => (await blockByTitle(page, "Checkout revamp — overview").catch(() => null))?.id).toBe(overviewId);

  const surface = await openHistory(page, overviewId);
  await surface.getByRole("button", { name: /What is the main goal/ }).click();
  await expect(surface.locator(".acute-ask-ai__reply")).toHaveCount(2);
  await expect(surface.locator(".acute-ask-ai__you").first()).toContainText("What is the main goal of this project?");

  const { prompt } = await send("Summarize our discussion in one sentence.");
  expect(prompt).toContain("User: What is the main goal of this project?");
  expect(prompt).toContain("User: And what is explicitly out of scope?");
  await expect(surface.locator(".acute-ask-ai__reply")).toHaveCount(3);
});

test("History lists the conversation, and a reply can still be inserted", async () => {
  const panel = await openHistory(page, overviewId);
  await expect(panel).toContainText("What is the main goal of this project?");
  await expect(panel).toContainText("3 replies");

  await panel.getByRole("button", { name: /What is the main goal/ }).click();
  const surface = askAISurface(page);
  await surface.locator(".acute-ask-ai__reply").last().getByRole("button", { name: "Insert on canvas" }).click();
  await acceptProposal(page);
  const inserted = await page.evaluate(() => {
    const dev = (window as unknown as { __acuteDev: { api: { getAppState(): { selectedElementIds: Record<string, true> }; getSceneElements(): { id: string; customData?: { acute?: { documentId?: string } } }[] }; store: { get(id: string): { metadata?: { ai?: { task?: string } } } | null } } }).__acuteDev;
    const id = Object.keys(dev.api.getAppState().selectedElementIds)[0];
    const el = dev.api.getSceneElements().find((e) => e.id === id);
    return el?.customData?.acute?.documentId ? dev.store.get(el.customData.acute.documentId)?.metadata?.ai : null;
  });
  expect(inserted).toMatchObject({ createdBy: "ai", task: "chat", provider: AI_PROVIDER });
});
