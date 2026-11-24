/**
 * Flow cards in the real app (note-taking-modes plan Step 6), with every AI call answered locally by this spec (no AI
 * cost, no network) and MCP access left off: on an AI-managed canvas, Visualize draws a flow section as ONE FlowDiagram
 * card — steps in order, their detail on click — built in code from the card's text. "Update from new content" changes
 * that card in place and it is still drawn as a flow (rebuilt from its new text, no "out of date" chip). No console errors.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AIRequest } from "../../src/ai/types";
import { action, openAISettings, openApp, openAskAI } from "../helpers";

const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const moreMenu = (p: Page) => p.getByRole("menu", { name: "More" });
const viewToggle = (p: Page) => p.getByRole("radiogroup", { name: "View" });

const filler = (topic: string) => `${topic} is described here in enough words to make this a realistic, long answer pasted from a chat assistant. `.repeat(3);
const doc = (tests: number) => `# Release process

## Pipeline

We build, then QA signs off, then we deploy. CI runs ${tests} tests on every build.
${filler("The pipeline")}

## Notes

${filler("The notes")}
`;

const OUTLINE = {
  summary: "How a release ships",
  sections: [
    { id: "s1", label: "Pipeline", kind: "flow", prominence: "primary", parts: ["u1"] },
    { id: "s2", label: "Notes", kind: "notes", prominence: "supporting", parts: ["u2"] },
  ],
  links: [],
};

function reply(req: AIRequest): string {
  if (req.task === "outline_document") return JSON.stringify(OUTLINE);
  if (req.task === "match_statements") return JSON.stringify({ matches: [] });
  if (req.task !== "generate_visual_plan") return "{}";
  const label = /This is one section, "([^"]+)"/.exec(req.prompt)?.[1] ?? "?";
  const analysis = { id: "an1", type: "text", origin: "analysis", title: "Status", content: { markdown: `What ${label} means.` } };
  const metadata = { takeaway: `${label} at a glance` };
  if (label !== "Pipeline") {
    const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
    return JSON.stringify({ version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: body.slice(0, 200) } }, analysis], relationships: [], metadata });
  }
  const tests = /CI runs (\d+) tests/.exec(req.prompt)?.[1] ?? "?";
  const shape = (id: string, l: string) => ({ id, type: "shape", content: { shape: "rectangle", label: l } });
  return JSON.stringify({
    version: 1,
    template: "sectioned",
    nodes: [shape("build", "Build"), shape("qa", "QA sign-off"), shape("deploy", "Deploy"), { id: "t1", type: "text", content: { markdown: `CI runs ${tests} tests.` } }, analysis],
    relationships: [
      { from: "build", to: "qa", type: "flows_to" },
      { from: "qa", to: "deploy", type: "flows_to" },
      { from: "build", to: "t1", type: "explained_by" },
    ],
    metadata,
  });
}

async function answerLocally(page: Page): Promise<string[]> {
  const tasks: string[] = [];
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: AIRequest };
    const req = { ...(body.request ?? {}), task: body.request?.task ?? "", prompt: body.request?.prompt ?? "" } as AIRequest;
    tasks.push(req.task);
    return route.fulfill({ status: 200, json: { text: reply(req), model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
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

/** The element whose block has a FlowDiagram layout, with its layout and live box. */
const flowCard = (p: Page) =>
  p.evaluate(() => {
    type Dev = {
      api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[] };
      store: { get(id: string): { layout?: { lang: string } } | null };
    };
    const d = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const live = d.api.getSceneElements().filter((e) => !e.isDeleted);
    const cards = live.flatMap((e) => {
      const doc = e.customData?.acute?.documentId;
      const lang = doc ? d.store.get(doc)?.layout?.lang : undefined;
      return lang?.startsWith("root = FlowDiagram(") ? [{ id: e.id, lang }] : [];
    });
    const labels = live.filter((e) => e.type === "text").map((e) => (e as unknown as { text: string }).text);
    return { cards, shapeLabels: labels.filter((t) => /Build|QA sign-off|Deploy/.test(t)) };
  });

/** Deselects, then centres the canvas on `id` (the properties panel would otherwise cover it). */
async function showElement(page: Page, id: string) {
  await page.keyboard.press("Escape");
  await page.evaluate((x) => {
    type Api = { getSceneElements(): { id: string }[]; scrollToContent(e?: unknown, o?: unknown): void; updateScene(s: unknown): void };
    const api = (window as unknown as { __acuteDev: { api: Api } }).__acuteDev.api;
    api.updateScene({ appState: { selectedElementIds: {} } });
    api.scrollToContent(api.getSceneElements().find((e) => e.id === x), { animate: false });
  }, id);
  await page.waitForTimeout(300);
}

const cardOf = (p: Page, id: string) => p.locator(`.acute-block[data-element-id="${id}"] [data-testid=acute-openui-card]`);

test.describe("Flow cards on an AI-managed canvas (local AI answers)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let page: Page;
  let tasks: string[];
  let card = "";
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await openApp(page);
    tasks = await answerLocally(page);
    await connectFakeKey(page);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await moreMenu(page).getByRole("menuitem", { name: /^AI-managed notes/ }).click();
    await expect(viewToggle(page).getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
  });
  test.afterAll(async () => page?.context().close());

  test("Visualize: the flow section is one FlowDiagram card, steps in order, detail on click", async () => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(doc(1200));
    const distil = visualizeDialog(page).getByRole("checkbox", { name: /Distil into key ideas/ });
    if ((await distil.count()) && (await distil.isChecked())) await distil.uncheck();
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
    expect(tasks[0]).toBe("outline_document");
    // The new flow card is listed for its layout preview before Accept.
    await reviewBar(page).getByRole("button", { name: "Preview layout" }).click();
    await expect(reviewBar(page).getByTestId("acute-layout-preview").locator(".openui-flow__node")).toHaveCount(3);
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();

    const found = await flowCard(page);
    expect(found.cards).toHaveLength(1);
    expect(found.shapeLabels).toEqual([]);
    card = found.cards[0]!.id;
    const drawn = cardOf(page, card);
    await expect(drawn).toHaveAttribute("data-layout", "stored");
    await expect(drawn.locator(".openui-flow__node")).toHaveText([/1\s*Build/, /2\s*QA sign-off/, /3\s*Deploy/]);
    await showElement(page, card);
    await drawn.locator(".openui-flow__node", { hasText: "Build" }).click();
    await expect(drawn.locator(".openui-flow__detail")).toContainText("CI runs 1200 tests.");
    await page.screenshot({ path: "test-results/flow-cards/1-visualized.png" });
  });

  test("Update from new content: the card changes in place and is still drawn as a flow (no stale chip)", async () => {
    const surface = await openAskAI(page, card);
    await (await action(surface, "Update from new content")).click();
    const update = page.getByRole("dialog", { name: "Update from new content" });
    await update.getByRole("textbox").fill(doc(1500));
    await update.getByRole("button", { name: "Update", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
    await page.keyboard.press("Escape");

    const found = await flowCard(page);
    expect(found.cards.map((c) => c.id)).toEqual([card]);
    expect(found.shapeLabels).toEqual([]);
    const drawn = cardOf(page, card);
    await expect(drawn.locator(".openui-flow")).toBeVisible();
    await expect(page.locator(`.acute-block[data-element-id="${card}"] [data-testid=acute-layout-stale]`)).toHaveCount(0);
    await showElement(page, card);
    await drawn.locator(".openui-flow__node", { hasText: "Build" }).click();
    await expect(drawn.locator(".openui-flow__detail")).toContainText("CI runs 1500 tests.");
    await page.screenshot({ path: "test-results/flow-cards/2-updated.png" });
  });

  test("no console errors", () => {
    expect(consoleErrors.filter((e) => !/Download the React DevTools|favicon/.test(e))).toEqual([]);
  });
});
