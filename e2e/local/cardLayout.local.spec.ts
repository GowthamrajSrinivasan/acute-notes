/**
 * Stored card layouts and the canvas mode in the Cards view (`.ai/docs/openui/note-taking-modes-plan-2026-11-23.md`
 * Step 3), in the real app with no AI and no network. A layout is written with the dev hook `setCardLayout` (the MCP
 * tools of Step 5 will write the same field after review).
 *
 * Checks: a hand-made text block stays Compact on a manual canvas and draws as a card on an AI-managed one, without its
 * document changing; a stored layout draws in manual mode and survives a reload; editing the text makes it stale (drawn
 * from the new text, with "Layout out of date"); "Remove layout" clears only the layout. No console errors.
 *
 * Needs `NEXT_PUBLIC_OPENUI_CANVAS=on` (`.env.development`). Screenshots go to `test-results/card-layout/`.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { blocks, documentOf, openApp, pasteText, waitForCanvas } from "../helpers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHOTS = join(ROOT, "test-results", "card-layout");
const STORED = `root = IdeaCard("Stored layout title", "Drawn from the stored layout.")`;

const moreMenu = (p: Page) => p.getByRole("menu", { name: "More" });
const cardOf = (p: Page, elementId: string) => p.locator(`.acute-block[data-element-id="${elementId}"] [data-testid=acute-openui-card]`);
const staleChip = (p: Page, elementId: string) => p.locator(`.acute-block[data-element-id="${elementId}"] [data-testid=acute-layout-stale]`);

async function setMode(page: Page, label: "Manual notes" | "AI-managed notes") {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await moreMenu(page).getByRole("menuitem", { name: new RegExp(`^(✓ )?${label}`) }).click();
  await expect(moreMenu(page)).toBeHidden();
}

type Dev = {
  store: { get(id: string): unknown; updateSnapshot(id: string, s: unknown, t?: string): void; flush(): Promise<void> };
  setCardLayout(id: string, lang: string | null): Promise<boolean>;
};

test.describe("Stored card layouts and modes in the Cards view (no AI)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let page: Page;
  const consoleErrors: string[] = [];
  let el = "";
  let doc = "";
  let plainEl = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await openApp(page);
    await expect(page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
    // A framed card (Properties → Frame → Card): what AI-managed canvases draw as cards.
    el = await pasteText(page, "Retry policy\nRetries happen five times before the job gives up.", { x: 600, y: 300 });
    doc = (await blocks(page)).find((b) => b.id === el)!.documentId;
    await page.locator('label[title="Card"]').click();
    await page.keyboard.press("Escape");
    // Plain frameless text: writing on the whiteboard, never drawn as a card from its text.
    plainEl = await pasteText(page, "A plain note written on the board.", { x: 600, y: 600 });
    await page.keyboard.press("Escape");
  });
  test.afterAll(async () => page?.close());

  test("manual canvas: a hand-made, uncited block stays Compact (D5)", async () => {
    await expect(page.locator(`.acute-block[data-element-id="${el}"]`)).toBeVisible();
    await expect(cardOf(page, el)).toHaveCount(0);
  });

  test("AI-managed canvas: the framed block draws as a card from its text, plain text stays plain; no document changes", async () => {
    await expect(page.locator(`.acute-block[data-element-id="${el}"]`)).toHaveAttribute("data-frame", "card");
    const before = JSON.stringify(await documentOf(page, doc));
    await setMode(page, "AI-managed notes");
    await expect(cardOf(page, el)).toBeVisible();
    await expect(cardOf(page, el)).toHaveAttribute("data-layout", "derived");
    await expect(cardOf(page, el)).toContainText("Retry policy");
    await expect(cardOf(page, plainEl)).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, "1-ai-mode-derived.png") });
    expect(JSON.stringify(await documentOf(page, doc))).toBe(before);

    await setMode(page, "Manual notes");
    await expect(cardOf(page, el)).toHaveCount(0);
    expect(JSON.stringify(await documentOf(page, doc))).toBe(before);
  });

  test("a stored layout draws in manual mode and survives a reload", async () => {
    expect(await page.evaluate(([id, lang]) => (window as unknown as { __acuteDev: Dev }).__acuteDev.setCardLayout(id!, lang!), [doc, STORED])).toBe(true);
    await expect(cardOf(page, el)).toHaveAttribute("data-layout", "stored");
    await expect(cardOf(page, el)).toContainText("Stored layout title");
    await expect(staleChip(page, el)).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, "2-stored-layout.png") });

    await page.evaluate(() => (window as unknown as { __acuteDev: Dev }).__acuteDev.store.flush());
    await page.reload();
    await waitForCanvas(page);
    await expect(cardOf(page, el)).toHaveAttribute("data-layout", "stored");
  });

  test("editing the text makes the layout stale: drawn from the new text with the chip; Remove layout clears only the layout", async () => {
    await page.evaluate((id) => {
      const store = (window as unknown as { __acuteDev: Dev }).__acuteDev.store;
      store.updateSnapshot(id, [
        { type: "paragraph", content: "Retry policy" },
        { type: "paragraph", content: "Retries happen three times before the job gives up." },
      ]);
    }, doc);
    await expect(cardOf(page, el)).toHaveAttribute("data-layout", "derived");
    await expect(cardOf(page, el)).toContainText("three times");
    await expect(staleChip(page, el)).toContainText("Layout out of date");
    await page.screenshot({ path: join(SHOTS, "3-stale.png") });

    const text = (await documentOf(page, doc))!.snapshot;
    await staleChip(page, el).getByRole("button", { name: "Remove layout" }).click();
    await expect.poll(async () => "layout" in ((await documentOf(page, doc)) as object)).toBe(false);
    expect((await documentOf(page, doc))!.snapshot).toEqual(text);
    // Manual canvas, no citations, no layout: Compact again.
    await expect(cardOf(page, el)).toHaveCount(0);
  });

  test("no console errors", () => {
    expect(consoleErrors.filter((e) => !/Download the React DevTools|favicon/.test(e))).toEqual([]);
  });
});
