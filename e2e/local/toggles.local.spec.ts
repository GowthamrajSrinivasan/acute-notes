/**
 * Content fidelity Wave D (progressive disclosure): a canvas block can hold collapsible detail — its slash menu
 * offers the toggle list and toggle headings, as a page's does.
 */
import { expect, test } from "@playwright/test";
import { createDemoCanvas, elements, openApp } from "../helpers";

test("a canvas block's slash menu offers the toggle list and toggle headings", async ({ page }) => {
  await openApp(page);
  await createDemoCanvas(page);
  const block = (await elements(page)).find((e) => e.acute?.blockType === "text")!;
  const host = page.locator(`.acute-block[data-element-id="${block.id}"]`);
  await host.scrollIntoViewIfNeeded();
  const box = (await host.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(host.locator("[contenteditable=true]")).toBeVisible();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/toggle");
  const menu = page.locator(".bn-suggestion-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText(/^Toggle List$/i)).toBeVisible();
  await expect(menu.getByText(/^Toggle Heading/i).first()).toBeVisible();
  await page.keyboard.press("Escape");
});
