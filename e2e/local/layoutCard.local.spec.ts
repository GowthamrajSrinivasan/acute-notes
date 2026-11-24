/**
 * Layout cards end to end in the real app (note-taking-modes plan Step 5), with no AI and MCP access left off: the exact
 * change sets `create_layout_card` / `update_layout_card` propose, put up through the app's own proposal path (as
 * `mcpConflict.local.spec.ts`'s in-app path does). The MCP tools themselves are covered over a real MCP client in
 * `src/mcp/tools/layoutTools.test.ts`.
 *
 * Checks: the proposal waits for review; Accept writes one card that draws from its stored layout (manual canvas) and
 * keeps its box when the view changes; undo removes it. An update that removes the layout, then undo, brings the layout
 * back (copy-on-write documents). A text-only update shows "Layout out of date". No console errors.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp, undo } from "../helpers";

const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const viewToggle = (p: Page) => p.getByRole("radiogroup", { name: "View" });
const cardOf = (p: Page, id: string) => p.locator(`.acute-block[data-element-id="${id}"] [data-testid=acute-openui-card]`);

const LANG = `root = IdeaCard("Retry policy (layout)", "Jobs retry 5 times, then give up.", "high")`;
const TEXT = [
  { type: "paragraph", content: "Retry policy" },
  { type: "paragraph", content: "Jobs retry 5 times, then give up after 30 seconds." },
];

type Dev = {
  api: { getSceneElements(): { id: string; isDeleted?: boolean; height: number; customData?: { acute?: { documentId?: string } } }[] };
  store: { get(id: string): { layout?: { lang: string } } | null };
  proposeChanges(set: unknown): void;
};
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T | Promise<T>, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;
const liveIds = (p: Page) => dev(p, (d) => d.api.getSceneElements().filter((e) => !e.isDeleted).map((e) => e.id));
const layoutOf = (p: Page, id: string) =>
  dev(p, (d, x) => {
    const doc = d.api.getSceneElements().find((e) => e.id === x)?.customData?.acute?.documentId;
    return doc ? d.store.get(doc)?.layout?.lang ?? null : null;
  }, id);
const heightOf = (p: Page, id: string) => dev(p, (d, x) => d.api.getSceneElements().find((e) => e.id === x)!.height, id);
const propose = (p: Page, set: Record<string, unknown>) => dev(p, (d, s) => d.proposeChanges(s), set);
const mcpSet = (operationId: string, task: string, title: string, changes: unknown[]) => ({
  operationId,
  title: `Test Client: ${title}`,
  metadata: { createdBy: "mcp", task, provider: "Test Client" },
  session: "mcp_layout",
  agent: "Test Client",
  changes,
});

test.describe("Layout cards: review, Accept, draw, undo (no AI)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let page: Page;
  const consoleErrors: string[] = [];
  let card = "";

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await openApp(page);
    await expect(viewToggle(page).getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
  });
  test.afterAll(async () => page?.close());

  test("create: waits for review; Accept writes one card drawn from its stored layout; it keeps its box across views", async () => {
    const before = await liveIds(page);
    await propose(page, mcpSet("op_layout_create", "create_layout_card", "Add layout card", [{ kind: "create_block", key: "card", blockType: "text", content: TEXT, box: { x: 200, y: 200, width: 360, height: 220 }, layout: { lang: LANG } }]));
    await expect(review(page)).toBeVisible();
    expect(await liveIds(page)).toEqual(before);
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    const added = (await liveIds(page)).filter((id) => !before.includes(id));
    expect(added).toHaveLength(1);
    card = added[0]!;
    expect(await layoutOf(page, card)).toBe(LANG);
    await expect(cardOf(page, card)).toHaveAttribute("data-layout", "stored");
    await expect(cardOf(page, card)).toContainText("Retry policy (layout)");
    await page.screenshot({ path: "test-results/layout-card/1-accepted.png" });

    // A layout card keeps the box it was given: Compact doesn't fit it to its text, so Cards never clips it.
    const height = await heightOf(page, card);
    await viewToggle(page).getByRole("radio", { name: "Compact" }).click();
    await page.waitForTimeout(400);
    expect(await heightOf(page, card)).toBe(height);
    await viewToggle(page).getByRole("radio", { name: "Cards" }).click();
    await expect(cardOf(page, card)).toHaveAttribute("data-layout", "stored");
  });

  test("undo removes the card; proposing again brings it back", async () => {
    await undo(page);
    await expect.poll(async () => (await liveIds(page)).includes(card)).toBe(false);
    const before = await liveIds(page);
    await propose(page, mcpSet("op_layout_create_2", "create_layout_card", "Add layout card", [{ kind: "create_block", key: "card", blockType: "text", content: TEXT, box: { x: 200, y: 200, width: 360, height: 220 }, layout: { lang: LANG } }]));
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    card = (await liveIds(page)).filter((id) => !before.includes(id))[0]!;
    await expect(cardOf(page, card)).toHaveAttribute("data-layout", "stored");
  });

  test("remove the layout, then undo: the layout comes back with the old document", async () => {
    await propose(page, mcpSet("op_layout_remove", "update_layout_card", "Remove card layout", [{ kind: "update_block", target: card, content: TEXT, layout: null }]));
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    expect(await layoutOf(page, card)).toBeNull();
    // Manual canvas, no citations, no layout: Compact.
    await expect(cardOf(page, card)).toHaveCount(0);

    await undo(page);
    await expect.poll(() => layoutOf(page, card)).toBe(LANG);
    await expect(cardOf(page, card)).toHaveAttribute("data-layout", "stored");
  });

  test("a text-only update keeps the layout, now out of date: drawn from the new text with the chip", async () => {
    const next = [TEXT[0], { type: "paragraph", content: "Jobs retry 3 times, then give up after 30 seconds." }];
    await propose(page, mcpSet("op_layout_text", "update_layout_card", "Update card", [{ kind: "update_block", target: card, content: next }]));
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    expect(await layoutOf(page, card)).toBe(LANG);
    await expect(cardOf(page, card)).toHaveAttribute("data-layout", "derived");
    await expect(cardOf(page, card)).toContainText("3 times");
    await expect(page.locator(`.acute-block[data-element-id="${card}"] [data-testid=acute-layout-stale]`)).toContainText("Layout out of date");
    await page.screenshot({ path: "test-results/layout-card/2-stale.png" });
  });

  test("no console errors", () => {
    expect(consoleErrors.filter((e) => !/Download the React DevTools|favicon/.test(e))).toEqual([]);
  });
});
