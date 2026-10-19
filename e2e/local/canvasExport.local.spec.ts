/**
 * Export canvas (⋮ → Export canvas…): a dialog to pick the format and, for
 * JSON, which details to include (all on by default), then a real download.
 */
import { readFile, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { createDemoCanvas, openApp } from "../helpers";

const dialog = (p: Page) => p.getByRole("dialog", { name: "Export canvas" });

async function openExport(p: Page) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Export canvas…" }).click();
  await expect(dialog(p)).toBeVisible();
}

async function exportFile(p: Page): Promise<{ name: string; text: string }> {
  const download = p.waitForEvent("download");
  await dialog(p).getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  await expect(dialog(p)).toBeHidden();
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, "utf8") };
}

test.describe.configure({ mode: "serial" });
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
  await createDemoCanvas(page);
});
test.afterAll(async () => {
  await page?.context().close();
});

test("the dialog opens with JSON and every detail checked; Escape closes it without exporting", async () => {
  await openExport(page);
  await expect(dialog(page).getByRole("radio", { name: "JSON" })).toBeChecked();
  const boxes = dialog(page).getByRole("checkbox");
  await expect(boxes).toHaveCount(6);
  for (const box of await boxes.all()) await expect(box).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
});

test("JSON with everything: a one-canvas bundle carrying origin, styles, relation types and view settings", async () => {
  await openExport(page);
  const { name, text } = await exportFile(page);
  expect(name).toMatch(/\.acute\.json$/);
  const bundle = JSON.parse(text);
  expect(bundle).toMatchObject({ format: "acute-notes", scope: "canvas" });
  expect(bundle.canvases).toHaveLength(1);
  const custom = bundle.canvases[0].elements.map((e: { customData?: Record<string, unknown> }) => e.customData ?? {});
  expect(custom.some((c: Record<string, unknown>) => (c.acute as { style?: unknown } | undefined)?.style)).toBe(true);
  expect(custom.some((c: Record<string, unknown>) => c.acuteRelation)).toBe(true);
  expect(bundle.relations.length).toBeGreaterThan(0);
});

test("unchecking details leaves them out of the file", async () => {
  await openExport(page);
  for (const label of ["Block styles", "Connection types", "Origin"]) await dialog(page).getByRole("checkbox", { name: label }).uncheck();
  const bundle = JSON.parse((await exportFile(page)).text);
  const custom = bundle.canvases[0].elements.map((e: { customData?: Record<string, unknown> }) => e.customData ?? {});
  expect(custom.some((c: Record<string, unknown>) => (c.acute as { style?: unknown } | undefined)?.style)).toBe(false);
  expect(custom.some((c: Record<string, unknown>) => c.acuteRelation || c.acuteMeta)).toBe(false);
  expect(bundle.relations).toEqual([]);
  expect(bundle.documents.some((d: { metadata?: unknown }) => d.metadata)).toBe(false);
});

test("Markdown: the canvas's text with a connections list, as a .md file", async () => {
  await openExport(page);
  await dialog(page).getByText("Markdown", { exact: true }).click();
  await expect(dialog(page).getByRole("checkbox")).toHaveCount(5);
  for (const box of await dialog(page).getByRole("checkbox").all()) await expect(box).toBeChecked();
  const { name, text } = await exportFile(page);
  expect(name).toMatch(/\.md$/);
  expect(text).toMatch(/^# /);
  expect(text).toContain("## Connections");
});

test("Markdown with Connections unchecked leaves the list out", async () => {
  await openExport(page);
  await dialog(page).getByText("Markdown", { exact: true }).click();
  await dialog(page).getByRole("checkbox", { name: /^Connections / }).uncheck();
  const { text } = await exportFile(page);
  expect(text).toMatch(/^# /);
  expect(text).not.toContain("## Connections");
});

test("a canvas export imports back into the workspace as a copy, opened and titled '(imported)'", async () => {
  await openExport(page);
  const { text } = await exportFile(page);
  const file = test.info().outputPath("canvas.acute.json");
  await writeFile(file, text);
  const before = page.url();

  if (await page.getByRole("button", { name: "Show workspaces" }).isVisible()) await page.getByRole("button", { name: "Show workspaces" }).click();
  await page.locator('input[type="file"][accept*=".acute.json"]').setInputFiles(file);
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Import canvas");
  await expect(confirm).toContainText("Nothing already here is changed");
  await confirm.getByRole("button", { name: "Import canvas" }).click();

  await expect(page).not.toHaveURL(before);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("(imported)");
  await page.locator(".excalidraw").waitFor();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __acuteDev: { api: { getSceneElements(): unknown[] } } }).__acuteDev.api.getSceneElements().length)).toBeGreaterThan(0);
});
