/**
 * F18 — ✨ Ask AI on the AI test canvas against real GitHub Copilot: every
 * AI action on every kind of content, relationships and scopes reaching the
 * model, streaming, working on the canvas mid-request, cancel paths, and undo.
 *
 * AI replies vary, so reply checks are loose (non-empty, on topic). What the
 * app *sends* is checked exactly, from the AI host request bodies.
 * Run only through `npm run test:e2e:ai` (asks before running).
 */
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import {
  acceptProposal,
  action,
  aiTaskOf,
  blockByTitle,
  blocks,
  chooseScope,
  createDemoCanvas,
  documentOf,
  elements,
  openApp,
  openAskAI,
  promptOf,
  recordAIRequests,
  select,
  shapeByLabel,
  undo,
} from "../helpers";
import { AI_PROVIDER, AI_PROVIDER_NAME, connectAI } from "../aiProvider";

test.describe.configure({ mode: "serial" });

const AI_TIMEOUT = 150_000;

let page: Page;
let aiRequests: Request[];

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

test.afterEach(async () => {
  const surface = page.getByRole("dialog", { name: "Ask AI" });
  if (await surface.isVisible()) await surface.getByRole("button", { name: "Close" }).click();
});

/** Runs an action and waits for its result; returns the prompt the app sent. */
async function runToResult(surface: Locator, label: string, resultButton: string): Promise<{ prompt: string; task?: string }> {
  aiRequests.length = 0;
  await (await action(surface, label)).click();
  await expect(surface.getByRole("button", { name: resultButton })).toBeVisible({ timeout: AI_TIMEOUT });
  const sent = aiRequests.filter((r) => r.method() === "POST");
  expect(sent.length, "one AI host request").toBeGreaterThan(0);
  return { prompt: promptOf(sent.at(-1)!), task: aiTaskOf(sent.at(-1)!) };
}

async function resultText(surface: Locator): Promise<string> {
  const text = (await surface.locator(".acute-ask-ai__result").innerText()).trim();
  expect(text.length, "non-empty AI reply").toBeGreaterThan(20);
  return text;
}

test("Explain on a shape sends its connected objects and relationship types, not just the selection", async () => {
  const shape = await shapeByLabel(page, "Checkout API");
  const surface = await openAskAI(page, shape.id);
  const { prompt, task } = await runToResult(surface, "Explain", "Insert on canvas");

  expect(task).toBe("generate_note");
  expect(prompt).toContain("## Selected objects");
  expect(prompt).toContain("Checkout API");
  expect(prompt).toContain("## Related to the selection"); // F22: objects linked by an arrow, labelled with how
  for (const connected of ["Web client", "Payment gateway", "Orders DB", "chargeWithRetry"]) expect(prompt).toContain(connected);
  for (const how of ["depends on", '"HTTPS"', '"writes orders"', "implements"]) expect(prompt).toContain(how);
  // Selection scope stays small: unrelated objects are not sent.
  expect(prompt).not.toContain("Team offsite");
  expect(prompt).not.toContain("Launch checklist");

  const reply = (await resultText(surface)).toLowerCase();
  expect(reply).toMatch(/checkout|payment|gateway/);
});

test("Explain on a table reads the table content", async () => {
  const surface = await openAskAI(page, (await blockByTitle(page, "Endpoints")).id);
  const { prompt } = await runToResult(surface, "Explain", "Insert on canvas");
  expect(prompt).toContain("| /checkout | POST | Payments | 480 ms |");
  expect((await resultText(surface)).toLowerCase()).toMatch(/endpoint|checkout|latency/);
});

test("Create test cases on the code block → Insert places it beside the code, and one undo removes it", async () => {
  const code = await blockByTitle(page, "chargeWithRetry");
  const codeEl = (await elements(page)).find((el) => el.id === code.id)!;
  const surface = await openAskAI(page, code.id);
  const { prompt, task } = await runToResult(surface, "Create test cases", "Insert on canvas");
  expect(task).toBe("generate_note");
  expect(prompt).toContain("chargeWithRetry");
  expect((await resultText(surface)).toLowerCase()).toMatch(/retry|attempt|idempoten/);

  const before = await blocks(page);
  await surface.getByRole("button", { name: "Insert on canvas" }).click();
  await acceptProposal(page);
  const after = await blocks(page);
  const added = after.filter((b) => !before.some((x) => x.id === b.id));
  expect(added).toHaveLength(1);

  const addedEl = (await elements(page)).find((el) => el.id === added[0]!.id)!;
  expect(addedEl.x).toBeGreaterThanOrEqual(codeEl.x + codeEl.width);
  const rec = await documentOf(page, added[0]!.documentId);
  expect(JSON.stringify(rec?.snapshot[0])).toContain("Test cases");
  expect(rec?.metadata?.ai).toMatchObject({ createdBy: "ai", task: "generate_note", provider: AI_PROVIDER });

  await undo(page);
  await expect.poll(async () => (await blocks(page)).length).toBe(before.length);
});

test("Create plan streams formatted into the preview; the canvas stays usable; the result still lands beside the original", async () => {
  const design = await blockByTitle(page, "Design doc: payment retries");
  const designEl = (await elements(page)).find((el) => el.id === design.id)!;
  const surface = await openAskAI(page, design.id);
  aiRequests.length = 0;
  await (await action(surface, "Create plan")).click();
  await expect(surface.getByRole("status")).toContainText("Planning…");

  // Streaming: partial text shows while the request is still running.
  const stream = surface.locator(".acute-ask-ai__stream");
  await expect(stream).not.toBeEmpty({ timeout: AI_TIMEOUT });
  await expect(surface.getByRole("status")).toBeVisible();
  expect(new URL(aiRequests.at(-1)!.url()).pathname).toBe("/api/ai/stream");
  // …and it renders formatted (headings/lists), not raw Markdown.
  await expect(surface.locator(".acute-ask-ai__stream--formatted .acute-preview")).toBeVisible();

  // Mid-request: pan with real input and select something else.
  const scrollBefore = await page.evaluate(() => (window as unknown as { __acuteDev: { api: { getAppState(): { scrollY: number } } } }).__acuteDev.api.getAppState().scrollY);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 300);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __acuteDev: { api: { getAppState(): { scrollY: number } } } }).__acuteDev.api.getAppState().scrollY))
    .not.toBe(scrollBefore);
  await select(page, (await blockByTitle(page, "Team offsite")).id);

  const insert = surface.getByRole("button", { name: "Insert on canvas" });
  await expect(insert).toBeVisible({ timeout: AI_TIMEOUT });
  await resultText(surface);
  const before = await blocks(page);
  await insert.click();
  await acceptProposal(page);
  const added = (await blocks(page)).filter((b) => !before.some((x) => x.id === b.id));
  expect(added).toHaveLength(1);
  const addedEl = (await elements(page)).find((el) => el.id === added[0]!.id)!;
  expect(addedEl.x).toBeGreaterThanOrEqual(designEl.x + designEl.width);
});

test("Turn into tasks on a page card uses the page's content", async () => {
  const surface = await openAskAI(page, (await blockByTitle(page, "Incident postmortem: double charges")).id);
  const { prompt, task } = await runToResult(surface, "Turn into tasks", "Insert as todo list");
  expect(task).toBe("transform_note");
  expect(prompt).toContain("212 customers");

  const before = await blocks(page);
  await surface.getByRole("button", { name: "Insert as todo list" }).click();
  await acceptProposal(page);
  const added = (await blocks(page)).filter((b) => !before.some((x) => x.id === b.id));
  expect(added[0]?.blockType).toBe("todo");
  const rec = await documentOf(page, added[0]!.documentId);
  expect(rec!.snapshot.filter((b) => b.type === "checkListItem").length).toBeGreaterThan(0);
});

test("Summarize with This canvas scope sends the whole canvas", async () => {
  const surface = await openAskAI(page, (await blockByTitle(page, "Checkout revamp — overview")).id);
  await chooseScope(surface, "This canvas");
  await expect(surface.getByRole("button", { name: new RegExp(`^Model: ${AI_PROVIDER_NAME[AI_PROVIDER]}`) })).toBeVisible();
  const { prompt, task } = await runToResult(surface, "Summarize", "Insert on canvas");
  expect(task).toBe("summarize");
  expect(prompt).toContain("Scope: the whole current canvas.");
  for (const everywhere of ["Team offsite", "Launch checklist", "Orders DB", "Sticky: ask finance"]) expect(prompt).toContain(everywhere);
  // The selection leads (F22): its own section, before everything else on the canvas.
  const selected = prompt.split("## Selected objects")[1]?.split(/\n## /)[0] ?? "";
  expect(selected).toContain("Checkout revamp — overview");
  await resultText(surface);
});

test("Esc and × cancel a running request; after a cancel, only the next request's result shows", async () => {
  const overview = (await blockByTitle(page, "Checkout revamp — overview")).id;
  const before = (await blocks(page)).length;

  let surface = await openAskAI(page, overview);
  await (await action(surface, "Explain")).click();
  await expect(surface.getByRole("status")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(surface).toBeHidden();

  surface = await openAskAI(page, overview);
  await (await action(surface, "Summarize")).click();
  await expect(surface.getByRole("status")).toBeVisible();
  await surface.getByRole("button", { name: "Close" }).click();
  await expect(surface).toBeHidden();

  await page.waitForTimeout(5_000);
  expect(await blocks(page)).toHaveLength(before);

  surface = await openAskAI(page, overview);
  await (await action(surface, "Explain")).click();
  await surface.getByRole("button", { name: "Cancel" }).click();
  await (await action(surface, "Summarize")).click();
  await expect(surface.getByRole("button", { name: "Insert on canvas" })).toBeVisible({ timeout: AI_TIMEOUT });
  await expect(surface.locator(".acute-ask-ai__subtitle")).toContainText("Summary");
  await page.waitForTimeout(3_000);
  await expect(surface.locator(".acute-ask-ai__subtitle")).toContainText("Summary");
});

test("Summarize with This workspace scope includes content from other canvases", async () => {
  await createDemoCanvas(page); // this canvas's twin now lives "elsewhere" in the workspace
  const surface = await openAskAI(page, (await blockByTitle(page, "Checkout revamp — overview")).id);
  await chooseScope(surface, "This workspace");
  await expect(surface.getByRole("button", { name: new RegExp(`^Model: ${AI_PROVIDER_NAME[AI_PROVIDER]}`) })).toBeVisible();
  const { prompt } = await runToResult(surface, "Summarize", "Insert on canvas");
  expect(prompt).toContain("Scope: the current canvas and the rest of the workspace.");
  expect(prompt).toContain("(on another canvas)");
  await resultText(surface);
});
