/**
 * Images: unreadable files never stay on the canvas as broken images, and
 * pages take pasted images (stored in the asset store, shown after reload).
 */
import { expect, test, type Page } from "@playwright/test";
import { blocks, documentOf, openApp } from "../helpers";

/** A 2×2 red PNG. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==";
/** Not an image at all, though named and typed like one. */
const JUNK = Buffer.from("this is not a picture".repeat(20)).toString("base64");

function images(page: Page): Promise<{ id: string; status: string }[]> {
  return page.evaluate(() => {
    type El = { id: string; type: string; status?: string };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api;
    return api
      .getSceneElements()
      .filter((e) => e.type === "image")
      .map((e) => ({ id: e.id, status: e.status ?? "" }));
  });
}

async function insertCanvasImage(page: Page, name: string, base64: string): Promise<void> {
  await page.evaluate(() => document.querySelector<HTMLElement>(".excalidraw")?.focus());
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("i");
  await (await chooser).setFiles({ name, mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") });
  await page.mouse.click(640, 420);
}

/** Pastes a file into the open page editor, as a screenshot paste would. */
function pasteFile(page: Page, name: string, type: string, base64: string): Promise<void> {
  return page.evaluate(
    ({ name, type, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], name, { type }));
      const editor = document.querySelector<HTMLElement>(".acute-page-editor .ProseMirror")!;
      editor.focus();
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
    },
    { name, type, base64 },
  );
}

async function openNewPage(page: Page): Promise<string> {
  const before = new Set((await blocks(page)).map((b) => b.id));
  await page.evaluate(() => document.querySelector<HTMLElement>(".excalidraw")?.focus());
  await page.keyboard.press("b");
  await page.getByRole("menuitem", { name: "Page" }).click();
  await expect.poll(async () => (await blocks(page)).filter((b) => b.kind === "page-preview" && !before.has(b.id)).length).toBe(1);
  const pageId = (await blocks(page)).find((b) => b.kind === "page-preview" && !before.has(b.id))!.documentId;
  await page.locator(".acute-page-editor .ProseMirror").waitFor();
  return pageId;
}

type Snapshot = Array<{ type: string; props?: Record<string, unknown> }>;
const imageBlocks = async (page: Page, pageId: string) =>
  (((await documentOf(page, pageId))?.snapshot ?? []) as Snapshot).filter((b) => b.type === "image");

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("an unreadable image is removed from the canvas with a message", async ({ page }) => {
  const before = (await images(page)).length;
  await insertCanvasImage(page, "photo.jpg", JUNK);
  await expect(page.getByText("This image can't be read")).toBeVisible();
  await expect.poll(async () => (await images(page)).length).toBe(before);
});

test("a readable image stays on the canvas", async ({ page }) => {
  const before = (await images(page)).length;
  await insertCanvasImage(page, "red.jpg", PNG);
  await expect.poll(async () => (await images(page)).length).toBe(before + 1);
  await page.waitForTimeout(500);
  expect((await images(page)).length).toBe(before + 1);
  await expect(page.getByText("This image can't be read")).toHaveCount(0);
});

test("an image pasted into a page is stored and shown again after reload", async ({ page }) => {
  const pageId = await openNewPage(page);
  await pasteFile(page, "red.png", "image/png", PNG);

  const img = page.locator(".acute-page-editor img.bn-visual-media");
  await expect(img).toHaveAttribute("src", /^blob:/);
  await expect.poll(async () => (await imageBlocks(page, pageId))[0]?.props?.url).toMatch(/^acute-asset:\/\/[0-9a-f]{40}$/);
  const url = (await imageBlocks(page, pageId))[0]!.props!.url as string;
  const stored = await page.evaluate(
    (id) =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open("acute-notes");
        open.onsuccess = () => {
          const get = open.result.transaction("assets").objectStore("assets").get(id);
          get.onsuccess = () => resolve((get.result as { mimeType: string } | undefined)?.mimeType ?? null);
        };
      }),
    url.slice("acute-asset://".length),
  );
  expect(stored).toBe("image/png");

  await page.reload();
  await page.waitForFunction(() => Boolean((window as unknown as { __acuteDev?: unknown }).__acuteDev));
  // Activating the preview opens the page in the side panel.
  const preview = (await blocks(page)).find((b) => b.documentId === pageId)!;
  await page.evaluate((id) => {
    const api = (window as unknown as { __acuteDev: { api: { updateScene(s: unknown): void } } }).__acuteDev.api;
    api.updateScene({ appState: { selectedElementIds: { [id]: true }, activeEmbeddable: { element: { id }, state: "active" } } });
  }, preview.id);
  await expect(page.locator(".acute-page-editor img.bn-visual-media")).toHaveAttribute("src", /^blob:/);
});

test("an unreadable file pasted into a page leaves no image block and explains why", async ({ page }) => {
  const pageId = await openNewPage(page);
  await pasteFile(page, "photo.jpg", "image/jpeg", JUNK);
  await expect(page.getByText("This image can't be read")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await imageBlocks(page, pageId)).toEqual([]);
  await expect(page.locator(".acute-page-editor .bn-file-block-content-wrapper")).toHaveCount(0);
});
