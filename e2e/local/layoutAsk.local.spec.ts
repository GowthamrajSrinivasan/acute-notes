/**
 * Opening a layout card (note-taking-modes plan Step 7) in the real app, with every AI call answered by this spec (no AI
 * cost, no network) and MCP access left off:
 * - AI-managed canvas: double-click asks first — "Ask AI to change…" / "Switch to editable" / Cancel; no editor opens
 *   until "Switch to editable".
 * - "Ask AI to change…": the instruction box says it uses the user's AI; one request per click; a reply that passes the
 *   check is proposed for review (nothing changes before Accept), one that doesn't is refused with the problem.
 * - Manual canvas: double-click opens the editor with a warning.
 * - A card whose text changed: "Ask AI to refresh" asks first, then proposes; Accept makes the layout current again.
 * No console errors.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AIRequest } from "../../src/ai/types";
import { openAISettings, openApp, undo } from "../helpers";

const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const moreMenu = (p: Page) => p.getByRole("menu", { name: "More" });
const viewToggle = (p: Page) => p.getByRole("radiogroup", { name: "View" });
const block = (p: Page, id: string) => p.locator(`.acute-block[data-element-id="${id}"]`);
const guard = (p: Page, id: string) => block(p, id).getByTestId("acute-layout-guard");
const askPanel = (p: Page, id: string) => block(p, id).getByTestId("acute-layout-ask");

const TEXT = "Jobs retry 5 times, then give up after 30 seconds.";
const LANG = `root = IdeaCard("Retry policy (layout)", "Jobs retry 5 times, then give up.", "high")`;
const CALLOUT = `root = Callout("warning", "Jobs retry 5 times, then give up after 30 seconds.")`;
const REFRESHED = `root = IdeaCard("Retry policy", "Jobs retry 3 times, then give up after 30 seconds.", "high")`;

/** What the next compose_card_layout request is answered with. */
let nextReply = "";
const replyWith = (markdown: string, lang: string) => {
  nextReply = `<markdown>\n${markdown}\n</markdown>\n<layout>\n${lang}\n</layout>`;
};

async function answerLocally(page: Page): Promise<string[]> {
  const tasks: string[] = [];
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: AIRequest };
    const task = body.request?.task ?? "";
    tasks.push(task);
    return route.fulfill({ status: 200, json: { text: task === "compose_card_layout" ? nextReply : "{}", model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
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

async function setMode(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await moreMenu(page).getByRole("menuitem", { name }).click();
}

type Dev = {
  api: {
    getSceneElements(): { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[];
    updateScene(s: { appState: Record<string, unknown>; captureUpdate?: string }): void;
    scrollToContent(els: unknown[], opts: Record<string, unknown>): void;
  };
  store: { get(id: string): { layout?: { lang: string; contentHash: string } } | null };
  proposeChanges(set: unknown): void;
};
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T | Promise<T>, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;
const liveIds = (p: Page) => dev(p, (d) => d.api.getSceneElements().filter((e) => !e.isDeleted).map((e) => e.id));
const layoutOf = (p: Page, id: string) =>
  dev(p, (d, x) => {
    const doc = d.api.getSceneElements().find((e) => e.id === x)?.customData?.acute?.documentId;
    return doc ? (d.store.get(doc)?.layout?.lang ?? null) : null;
  }, id);
const propose = (p: Page, task: string, changes: unknown[]) =>
  dev(p, (d, a) => d.proposeChanges({ operationId: `op_${Math.random().toString(36).slice(2)}`, title: "Test", metadata: { createdBy: "mcp", task: a.task, provider: "Test Client" }, changes: a.changes }), { task, changes });
const leave = (p: Page) => dev(p, (d) => d.api.updateScene({ appState: { activeEmbeddable: null, selectedElementIds: {} } }));

/** Centres the card, then double-clicks its body as a user would. */
async function open(page: Page, id: string) {
  await dev(page, (d, x) => {
    d.api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} }, captureUpdate: "NEVER" });
    const el = d.api.getSceneElements().find((e) => e.id === x);
    if (el) d.api.scrollToContent([el], { fitToViewport: true, viewportZoomFactor: 0.5, animate: false });
  }, id);
  await page.waitForTimeout(300);
  const box = (await block(page, id).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 3);
  await expect(block(page, id)).toHaveAttribute("data-active", "true");
}

async function accept(page: Page) {
  await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(reviewBar(page)).toBeHidden();
}

test.describe("Opening a layout card: ask first (local AI answers)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let page: Page;
  let tasks: string[];
  let card = "";
  const consoleErrors: string[] = [];
  const composeCalls = () => tasks.filter((t) => t === "compose_card_layout").length;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await openApp(page);
    tasks = await answerLocally(page);
    await connectFakeKey(page);
    await setMode(page, /^AI-managed notes/);
    await expect(viewToggle(page).getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
    const before = await liveIds(page);
    await propose(page, "create_layout_card", [
      { kind: "create_block", key: "card", blockType: "text", content: [{ type: "paragraph", content: "Retry policy" }, { type: "paragraph", content: TEXT }], box: { x: 200, y: 200, width: 380, height: 240 }, layout: { lang: LANG } },
    ]);
    await accept(page);
    card = (await liveIds(page)).filter((id) => !before.includes(id))[0]!;
    await expect(block(page, card).getByTestId("acute-openui-card")).toHaveAttribute("data-layout", "stored");
  });
  test.afterAll(async () => page?.context().close());

  test("AI-managed: double-click asks first; Cancel leaves the card as it was, with no editor opened", async () => {
    await open(page, card);
    await expect(guard(page, card)).toBeVisible();
    await expect(guard(page, card).getByRole("button", { name: "Ask AI to change…" })).toBeVisible();
    await expect(guard(page, card).getByRole("button", { name: "Switch to editable" })).toBeVisible();
    await expect(guard(page, card)).toContainText("visual structure is lost");
    await expect(block(page, card).locator(".bn-editor")).toHaveCount(0);
    await page.screenshot({ path: "test-results/layout-ask/1-choose.png" });
    await guard(page, card).getByRole("button", { name: "Cancel" }).click();
    await expect(block(page, card)).not.toHaveAttribute("data-active", "true");
    await expect(block(page, card).getByTestId("acute-openui-card")).toHaveAttribute("data-layout", "stored");
    expect(composeCalls()).toBe(0);
  });

  test("Switch to editable opens the editor; leaving it without an edit keeps the layout", async () => {
    await open(page, card);
    await guard(page, card).getByRole("button", { name: "Switch to editable" }).click();
    await expect(block(page, card).locator(".bn-editor")).toBeVisible({ timeout: 15_000 });
    await expect(guard(page, card)).toHaveCount(0);
    await leave(page);
    await expect(block(page, card).getByTestId("acute-openui-card")).toHaveAttribute("data-layout", "stored");
    expect(await layoutOf(page, card)).toBe(LANG);
  });

  test("Ask AI to change: a reply that doesn't match the card is refused with the problem; nothing is proposed", async () => {
    replyWith(`Retry policy\n\n${TEXT}`, `root = Callout("warning", "Jobs retry 7 times.")`);
    await open(page, card);
    await guard(page, card).getByRole("button", { name: "Ask AI to change…" }).click();
    await expect(askPanel(page, card)).toContainText("Uses your AI provider (one request)");
    await expect(askPanel(page, card).getByRole("checkbox", { name: "Layout only — keep the card's text" })).toBeChecked();
    await expect(askPanel(page, card).getByRole("button", { name: "Ask AI" })).toBeDisabled();
    await askPanel(page, card).getByRole("textbox").fill("Make it a warning callout");
    await askPanel(page, card).getByRole("button", { name: "Ask AI" }).click();
    await expect(askPanel(page, card).getByRole("alert")).toContainText("Not proposed");
    await expect(askPanel(page, card).getByRole("alert")).toContainText("7");
    expect(composeCalls()).toBe(1);
    await expect(reviewBar(page)).toBeHidden();
    await askPanel(page, card).getByRole("button", { name: "Cancel" }).click();
    expect(await layoutOf(page, card)).toBe(LANG);
  });

  test("Ask AI to change: a passing reply is proposed (unchanged until Accept); Accept draws it; undo restores the old layout", async () => {
    replyWith(`Retry policy\n\n${TEXT}`, CALLOUT);
    await open(page, card);
    await guard(page, card).getByRole("button", { name: "Ask AI to change…" }).click();
    await askPanel(page, card).getByRole("textbox").fill("Make it a warning callout");
    await askPanel(page, card).getByRole("button", { name: "Ask AI" }).click();
    await expect(askPanel(page, card)).toContainText("Proposed — review it in the bar below");
    expect(composeCalls()).toBe(2);
    await expect(reviewBar(page)).toBeVisible();
    expect(await layoutOf(page, card)).toBe(LANG);
    // The review says the layout changes and previews it, now and as proposed, before Accept.
    await expect(reviewBar(page)).toContainText("changes its layout");
    await reviewBar(page).getByRole("button", { name: "Preview layout" }).click();
    const preview = reviewBar(page).getByTestId("acute-layout-preview");
    await expect(preview.locator("[data-pane=now] .openui-idea-card")).toContainText("Retry policy (layout)");
    await expect(preview.locator("[data-pane=proposed] .openui-callout")).toContainText("give up after 30 seconds");
    await expect(preview).toContainText("checked this layout's structure, not its meaning");
    await page.screenshot({ path: "test-results/layout-ask/2-proposed.png" });
    await askPanel(page, card).getByRole("button", { name: "Close" }).click();
    await accept(page);
    expect(await layoutOf(page, card)).toBe(CALLOUT);
    await expect(block(page, card).locator(".openui-callout")).toContainText("give up after 30 seconds");
    await undo(page);
    await expect.poll(() => layoutOf(page, card)).toBe(LANG);
  });

  test("Layout only (the default): a reply that rewrites the text proposes only the layout, and says so; unticked, the text change is proposed", async () => {
    replyWith(`Retry policy\n\nMigrate first.\n\n${TEXT}`, CALLOUT);
    await open(page, card);
    await guard(page, card).getByRole("button", { name: "Ask AI to change…" }).click();
    await askPanel(page, card).getByRole("textbox").fill("Make it a warning callout under a summary");
    await askPanel(page, card).getByRole("button", { name: "Ask AI" }).click();
    await expect(askPanel(page, card).getByRole("list", { name: "Flagged for your review" })).toContainText("that was left out (layout only)");
    await expect(reviewBar(page)).toContainText("no visible text change; changes its layout");
    await askPanel(page, card).getByRole("button", { name: "Close" }).click();
    await reviewBar(page).getByRole("button", { name: "Reject" }).click();
    await expect(reviewBar(page)).toBeHidden();

    await open(page, card);
    await guard(page, card).getByRole("button", { name: "Ask AI to change…" }).click();
    await askPanel(page, card).getByRole("checkbox", { name: "Layout only — keep the card's text" }).uncheck();
    await askPanel(page, card).getByRole("textbox").fill("Make it a warning callout under a summary");
    await askPanel(page, card).getByRole("button", { name: "Ask AI" }).click();
    await expect(askPanel(page, card)).toContainText("Proposed — review it in the bar below");
    await expect(reviewBar(page)).toContainText("Ask AI: change card and layout");
    await expect(reviewBar(page)).toContainText(/\+\d+ −0 lines; changes its layout/);
    await askPanel(page, card).getByRole("button", { name: "Close" }).click();
    await reviewBar(page).getByRole("button", { name: "Reject" }).click();
    await expect(reviewBar(page)).toBeHidden();
    expect(await layoutOf(page, card)).toBe(LANG);
    expect(composeCalls()).toBe(4);
  });

  test("Manual canvas: double-click opens the editor, with a warning and 'Ask AI to change instead'", async () => {
    await setMode(page, /^Manual notes/);
    await open(page, card);
    await expect(block(page, card).getByTestId("acute-layout-warning")).toContainText("leaves this card's layout out of date");
    await expect(block(page, card).getByRole("button", { name: "Ask AI to change instead" })).toBeVisible();
    await expect(block(page, card).locator(".bn-editor")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "test-results/layout-ask/3-manual-warning.png" });
    await leave(page);
    await setMode(page, /^AI-managed notes/);
  });

  test("text changed: 'Ask AI to refresh' asks first, proposes, and Accept makes the layout current again", async () => {
    const next = [{ type: "paragraph", content: "Retry policy" }, { type: "paragraph", content: "Jobs retry 3 times, then give up after 30 seconds." }];
    await propose(page, "update_layout_card", [{ kind: "update_block", target: card, content: next }]);
    await accept(page);
    const chip = block(page, card).getByTestId("acute-layout-stale");
    await expect(chip).toContainText("Layout out of date");
    await chip.getByRole("button", { name: "Ask AI to refresh" }).click();
    await expect(chip).toContainText("Refresh with AI? One request; you review it first.");
    expect(composeCalls()).toBe(4);
    replyWith("Retry policy\n\nJobs retry 3 times, then give up after 30 seconds.", REFRESHED);
    await chip.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(chip).toContainText("Refresh proposed");
    expect(composeCalls()).toBe(5);
    await accept(page);
    await expect(block(page, card).getByTestId("acute-layout-stale")).toHaveCount(0);
    await expect(block(page, card).getByTestId("acute-openui-card")).toHaveAttribute("data-layout", "stored");
    expect(await layoutOf(page, card)).toBe(REFRESHED);
  });

  test("no console errors", () => {
    expect(consoleErrors.filter((e) => !/Download the React DevTools|favicon/.test(e))).toEqual([]);
  });
});
