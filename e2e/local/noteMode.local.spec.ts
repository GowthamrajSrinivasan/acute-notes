/**
 * Note-taking mode per canvas (`.ai/docs/openui/note-taking-modes-plan-2026-11-23.md` Step 2), in the real app with no AI
 * and no network (a fake key turns AI features on; every AI route is answered locally and nothing is run).
 *
 * Checks: a canvas from before the field reads as Manual; the View defaults to Cards (development, D1); switching the mode
 * survives a reload and changes no scene element, block or undo step; a new canvas gets the last-picked mode; Visualize
 * starts with "Distil into key ideas" ticked, and it can be unticked (a default, never a restriction). No console errors.
 *
 * Needs `NEXT_PUBLIC_OPENUI_CANVAS=on` (`.env.development`). Screenshots go to `test-results/note-mode/`.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { openAISettings, openApp, pasteText, waitForCanvas } from "../helpers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHOTS = join(ROOT, "test-results", "note-mode");

const moreMenu = (p: Page) => p.getByRole("menu", { name: "More" });
const viewToggle = (p: Page) => p.getByRole("radiogroup", { name: "View" });

async function openMore(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(moreMenu(page)).toBeVisible();
}

/** The mode the ⋮ menu marks as current. */
async function currentMode(page: Page): Promise<string> {
  await openMore(page);
  const marked = await moreMenu(page).getByRole("menuitem", { name: /^✓ / }).innerText();
  await page.keyboard.press("Escape");
  await expect(moreMenu(page)).toBeHidden();
  return marked.replace(/^✓\s*/, "").split("\n")[0]!.trim();
}

/** Every live element's id, type and box, every rich block's stored content, and the next undo step. */
const canvasState = (p: Page) =>
  p.evaluate(() => {
    type Dev = {
      api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean; x: number; y: number; width: number; height: number; version: number; customData?: { acute?: { kind?: string; documentId?: string } } }[] };
      store: { get(id: string): { title: string; snapshot: unknown } | null | undefined };
      history: { lastStepId: number | null };
    };
    const d = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const els = d.api.getSceneElements().filter((e) => !e.isDeleted);
    const docs = els.flatMap((e) => (e.customData?.acute?.kind === "rich-block" && e.customData.acute.documentId ? [JSON.stringify(d.store.get(e.customData.acute.documentId) ?? null)] : []));
    return { elements: els.map((e) => [e.id, e.type, e.x, e.y, e.width, e.height, e.version].join("|")).sort(), docs, lastStep: d.history.lastStepId };
  });

async function connectFakeKey(page: Page) {
  await page.route("**/api/ai/**", (route) => route.fulfill({ status: 200, json: [] }));
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

test.describe("Note-taking mode per canvas (no AI)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let page: Page;
  const consoleErrors: string[] = [];
  let firstCanvasUrl = "";

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await openApp(page);
    firstCanvasUrl = page.url();
  });
  test.afterAll(async () => page?.close());

  test("a canvas without a mode reads as Manual, and the View defaults to Cards", async () => {
    expect(await currentMode(page)).toBe("Manual notes");
    await expect(viewToggle(page).getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
    await openMore(page);
    await expect(moreMenu(page).getByText("Note-taking mode (default only)")).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "1-menu-manual.png") });
    await page.keyboard.press("Escape");
  });

  test("switching to AI-managed changes no element, block or undo step, and survives a reload", async () => {
    await pasteText(page, "Hand-written note: retries happen five times.", { x: 500, y: 400 });
    const before = await canvasState(page);
    expect(before.elements.length).toBeGreaterThan(0);

    await openMore(page);
    await moreMenu(page).getByRole("menuitem", { name: /^AI-managed notes/ }).click();
    await expect.poll(() => currentMode(page)).toBe("AI-managed notes");
    expect(await canvasState(page)).toEqual(before);

    // As other specs do: let the debounced writes in first (the app's own pagehide flush would).
    await page.evaluate(() => (window as unknown as { __acuteDev: { store: { flush(): Promise<void> } } }).__acuteDev.store.flush());
    await page.reload();
    await waitForCanvas(page);
    expect(await currentMode(page)).toBe("AI-managed notes");
    // After a reload a frameless block re-measures itself (auto-size), which bumps its version even at the same size, and
    // whether that happened before this read is timing. So compare id, type, position and size here; the exact versions
    // were compared above, in-session, where only the mode switch happened.
    const withoutVersion = (els: string[]) => els.map((e) => e.split("|").slice(0, 6).join("|"));
    expect(withoutVersion((await canvasState(page)).elements)).toEqual(withoutVersion(before.elements));
    await page.screenshot({ path: join(SHOTS, "2-ai-after-reload.png") });
  });

  test("manual editing still works in AI-managed mode (P1)", async () => {
    const before = (await canvasState(page)).elements.length;
    await pasteText(page, "Typed by hand on an AI-managed canvas.", { x: 500, y: 600 });
    await expect.poll(async () => (await canvasState(page)).elements.length).toBeGreaterThan(before);
  });

  test("a new canvas gets the last-picked mode; the picker offers the other one", async () => {
    await page.getByRole("button", { name: "Show workspaces" }).click();
    // The row's actions button shows on hover.
    const tree = page.getByRole("tree", { name: "Workspaces and canvases" });
    await tree.getByRole("button", { name: "My workspace", exact: true }).hover();
    await tree.getByRole("button", { name: "My workspace actions" }).click();
    const menu = page.getByRole("menu").last();
    await expect(menu.getByRole("menuitem", { name: /^New canvas.*AI-managed notes/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "New canvas: Manual notes" })).toBeVisible();
    await page.screenshot({ path: join(SHOTS, "3-new-canvas-picker.png") });
    await menu.getByRole("menuitem", { name: /^New canvas.*AI-managed notes/ }).click();
    await expect.poll(() => page.url()).not.toBe(firstCanvasUrl);
    await waitForCanvas(page);
    await page.keyboard.press("Escape"); // leave the title rename the new canvas opens with
    expect(await currentMode(page)).toBe("AI-managed notes");

    // Back to manual here; the first canvas keeps its own mode.
    await openMore(page);
    await moreMenu(page).getByRole("menuitem", { name: /^Manual notes/ }).click();
    await expect.poll(() => currentMode(page)).toBe("Manual notes");
    await page.goto(firstCanvasUrl);
    await waitForCanvas(page);
    expect(await currentMode(page)).toBe("AI-managed notes");
  });

  test("Visualize starts with distil ticked in development, and it can be unticked", async () => {
    await connectFakeKey(page);
    await openMore(page);
    await moreMenu(page).getByRole("menuitem", { name: "Visualize content…" }).click();
    const dialog = page.getByRole("dialog", { name: "Visualize" });
    const distil = dialog.getByRole("checkbox", { name: /Distil into key ideas/ });
    await expect(distil).toBeChecked();
    await page.screenshot({ path: join(SHOTS, "4-visualize-distil-ticked.png") });
    await distil.uncheck();
    await expect(distil).not.toBeChecked();
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("no console errors", () => {
    expect(consoleErrors.filter((e) => !/Download the React DevTools|favicon/.test(e))).toEqual([]);
  });
});
