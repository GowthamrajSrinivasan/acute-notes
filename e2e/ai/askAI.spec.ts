/**
 * F18 — ✨ Ask AI core flows against real GitHub Copilot, on a pasted note:
 * Summarize → Insert (with provenance), Cancel, Turn into tasks.
 * Run only through `npm run test:e2e:ai` (asks before running).
 */
import { expect, test, type Page } from "@playwright/test";
import { acceptProposal, action, blocks, documentOf, openApp, openAskAI, pasteText, recordAIRequests } from "../helpers";
import { AI_PROVIDER, AI_PROVIDER_NAME, connectAI } from "../aiProvider";

test.describe.configure({ mode: "serial" });

const SOURCE_MARKDOWN = [
  "# Password reset",
  "- A user requests a reset link by entering their email address",
  "- The emailed reset link expires after 30 minutes",
  "- The new password must differ from the last 3 passwords",
  "- After a successful reset, all other sessions are signed out",
].join("\n");

let page: Page;
let aiRequests: ReturnType<typeof recordAIRequests>;
let sourceId = "";

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
  aiRequests = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
  sourceId = await pasteText(page, SOURCE_MARKDOWN, { x: 500, y: 300 });
});

test.afterAll(async () => {
  await page?.context().close();
});

test("Summarize runs on Copilot, and Insert adds an editable block with AI provenance", async () => {
  aiRequests.length = 0;
  const surface = await openAskAI(page, sourceId);
  await expect(surface.getByRole("button", { name: /^Sharing “/ })).toBeVisible();
  await expect(surface.getByRole("button", { name: new RegExp(`^Model: ${AI_PROVIDER_NAME[AI_PROVIDER]}`) })).toBeVisible();
  await (await action(surface, "Summarize")).click();
  await expect(surface.getByRole("status")).toContainText("Summarizing…");

  const insert = surface.getByRole("button", { name: "Insert on canvas" });
  await expect(insert).toBeVisible({ timeout: 150_000 });
  await expect(surface.locator(".acute-ask-ai__result")).not.toBeEmpty();
  expect(aiRequests.length).toBeGreaterThan(0);

  const before = new Set((await blocks(page)).map((b) => b.id));
  await insert.click();
  await acceptProposal(page);
  const added = (await blocks(page)).filter((b) => !before.has(b.id));
  expect(added).toHaveLength(1);
  expect(added[0]!.blockType).toBe("text");

  const rec = await documentOf(page, added[0]!.documentId);
  expect(rec?.snapshot[0]).toMatchObject({ type: "heading" });
  expect(JSON.stringify(rec?.snapshot[0])).toContain("Summary");
  expect(rec?.snapshot.length).toBeGreaterThan(1);
  expect(rec?.metadata?.ai).toMatchObject({ createdBy: "ai", task: "summarize", provider: AI_PROVIDER });
  expect(rec?.metadata?.ai?.operationId).toMatch(/^op_/);
  expect((await blocks(page)).some((b) => b.id === sourceId)).toBe(true);
});

test("Cancel stops a running request and nothing is added to the canvas", async () => {
  const before = (await blocks(page)).length;
  const surface = await openAskAI(page, sourceId);
  await (await action(surface, "Explain")).click();
  await expect(surface.getByRole("status")).toContainText("Explaining…");
  await surface.getByRole("button", { name: "Cancel" }).click();

  await expect((await action(surface, "Summarize"))).toBeVisible();
  await page.waitForTimeout(5_000);
  await expect(surface.getByRole("button", { name: "Insert on canvas" })).toHaveCount(0);
  expect(await blocks(page)).toHaveLength(before);
  await surface.getByRole("button", { name: "Close" }).click();
});

test("Turn into tasks inserts a todo list of checklist items", async () => {
  const surface = await openAskAI(page, sourceId);
  await (await action(surface, "Turn into tasks")).click();
  const insert = surface.getByRole("button", { name: "Insert as todo list" });
  await expect(insert).toBeVisible({ timeout: 150_000 });

  const before = new Set((await blocks(page)).map((b) => b.id));
  await insert.click();
  await acceptProposal(page);
  const added = (await blocks(page)).filter((b) => !before.has(b.id));
  expect(added).toHaveLength(1);
  expect(added[0]!.blockType).toBe("todo");

  const rec = await documentOf(page, added[0]!.documentId);
  expect(rec!.snapshot.filter((b) => b.type === "checkListItem").length).toBeGreaterThan(0);
  expect(rec?.metadata?.ai).toMatchObject({ createdBy: "ai", task: "transform_note", provider: AI_PROVIDER });
});
