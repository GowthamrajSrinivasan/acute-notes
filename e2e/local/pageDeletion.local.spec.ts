/**
 * Deleting a page's last preview from the canvas deletes the page too, after
 * a confirmation; Cancel keeps both.
 */
import { expect, test, type Page } from "@playwright/test";
import { blocks, documentOf, openApp, select } from "../helpers";

async function newPagePreview(page: Page): Promise<{ elementId: string; pageId: string }> {
  const before = new Set((await blocks(page)).map((b) => b.id));
  await page.keyboard.press("b");
  await page.getByRole("menuitem", { name: "Page" }).click();
  await expect.poll(async () => (await blocks(page)).filter((b) => b.kind === "page-preview" && !before.has(b.id)).length).toBe(1);
  const created = (await blocks(page)).find((b) => b.kind === "page-preview" && !before.has(b.id))!;
  // Leave the page panel so keys go to the canvas (Excalidraw handles keys with focus in its container).
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector<HTMLElement>(".excalidraw")?.focus());
  await select(page, created.id);
  return { elementId: created.id, pageId: created.documentId };
}

const onCanvas = async (page: Page, elementId: string) => (await blocks(page)).some((b) => b.id === elementId);

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("Cancel keeps the preview and the page", async ({ page }) => {
  const { elementId, pageId } = await newPagePreview(page);
  let message = "";
  page.once("dialog", (d) => {
    message = d.message();
    void d.dismiss();
  });
  await page.keyboard.press("Delete");
  await expect.poll(() => message).toContain("Delete the page");
  expect(await onCanvas(page, elementId)).toBe(true);
  expect(await documentOf(page, pageId)).not.toBeNull();
});

test("Delete key deletes the preview and the page", async ({ page }) => {
  const { elementId, pageId } = await newPagePreview(page);
  page.once("dialog", (d) => void d.accept());
  await page.keyboard.press("Delete");
  await expect.poll(() => onCanvas(page, elementId)).toBe(false);
  await expect.poll(() => documentOf(page, pageId)).toBeNull();
});

test("the context menu's Delete deletes the page", async ({ page }) => {
  const { elementId, pageId } = await newPagePreview(page);
  const box = (await page.evaluate((id) => {
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string; x: number; y: number }[]; getAppState(): { scrollX: number; scrollY: number; zoom: { value: number }; offsetLeft: number; offsetTop: number } } } }).__acuteDev.api;
    const el = api.getSceneElements().find((e) => e.id === id)!;
    const s = api.getAppState();
    return { x: (el.x + s.scrollX) * s.zoom.value + s.offsetLeft, y: (el.y + s.scrollY) * s.zoom.value + s.offsetTop };
  }, elementId))!;
  await page.mouse.click(box.x + 4, box.y + 4, { button: "right" });
  page.once("dialog", (d) => void d.accept());
  await page.locator('[data-testid="deleteSelectedElements"]').click();
  await expect.poll(() => onCanvas(page, elementId)).toBe(false);
  await expect.poll(() => documentOf(page, pageId)).toBeNull();
});

test("the trash button deletes the page", async ({ page }) => {
  const { elementId, pageId } = await newPagePreview(page);
  page.once("dialog", (d) => void d.accept());
  await page.locator('.excalidraw button.ToolIcon_type_button[aria-label="Delete"]:visible').first().click();
  await expect.poll(() => onCanvas(page, elementId)).toBe(false);
  await expect.poll(() => documentOf(page, pageId)).toBeNull();
});
