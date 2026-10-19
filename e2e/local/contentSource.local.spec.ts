/**
 * F37 in the real app: a Visualize run records a content source only when
 * accepted, every created object carries its reconciliation link and a
 * baseline fingerprint straight after Accept, and that baseline survives the
 * editor actually opening and re-saving the block (no false "user edited").
 */
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp, waitForCanvas } from "../helpers";

type Link = { contentSourceId: string; contentSourceVersion: number; stableNodeKey: string; contentFingerprint: string } | null;
type Recon = { link: Link; current: string | null } | null;

const dialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const recon = (p: Page, id: string) => p.evaluate((i) => (window as unknown as { __acuteDev: { reconciliation(i: string): Promise<Recon> } }).__acuteDev.reconciliation(i), id);
const source = (p: Page, id: string) =>
  p.evaluate((i) => (window as unknown as { __acuteDev: { contentSource(i: string): Promise<{ source: { latestVersion: number; tier: string }; version: { text: string } } | null> } }).__acuteDev.contentSource(i), id);

const TEXT = "# Launch plan\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway may time out under load.\n";

async function visualize(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await dialog(p).getByRole("textbox").fill(text);
  await dialog(p).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(reviewBar(p)).toBeVisible();
}

test.describe.configure({ mode: "serial" });
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
});
test.afterAll(async () => {
  await page?.context().close();
});

test("a rejected run leaves no content source; an accepted one links every object to one, with a baseline at once", async () => {
  const before = new Set((await elements(page)).map((e) => e.id));
  await visualize(page, TEXT);
  await reviewBar(page).getByRole("button", { name: "Reject" }).click();

  await visualize(page, TEXT);
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  // Section frames (F42) carry the set's provenance only, never a content-source link; bound labels have none either.
  const added = (await elements(page)).filter((e) => !before.has(e.id) && !(e.type === "text" && e.containerId) && e.type !== "frame");
  expect(added.length).toBeGreaterThan(2);

  const links = await Promise.all(added.map((e) => recon(page, e.id)));
  const sourceIds = new Set(links.map((r) => r?.link?.contentSourceId));
  expect(sourceIds.size).toBe(1); // one source for the whole run
  for (const r of links) {
    expect(r?.link?.contentSourceVersion).toBe(1);
    expect(r?.link?.stableNodeKey).toBeTruthy();
    expect(r?.link?.contentFingerprint).toBe(r?.current); // untouched: current content == baseline
  }
  const id = [...sourceIds][0]!;
  await expect.poll(async () => (await source(page, id))?.version.text).toBe(TEXT);
  expect((await source(page, id))?.source).toMatchObject({ latestVersion: 1, tier: "local" });
});

test("the baseline survives the editor opening and re-saving a block, and a reload; a real edit changes the current fingerprint", async () => {
  const blocks = (await elements(page)).filter((e) => e.acute?.blockType === "todo");
  const todo = blocks.at(-1)!;
  const baseline = (await recon(page, todo.id))!.link!.contentFingerprint;

  // Open the block in the editor and leave without typing: BlockNote re-saves its snapshot in its own shape.
  const host = page.locator(`.acute-block[data-element-id="${todo.id}"]`); // not the AI change marker (F42), which carries the id too
  await host.scrollIntoViewIfNeeded();
  const box = (await host.boundingBox())!;
  expect(box).not.toBeNull();
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(host.locator("[contenteditable=true]")).toBeVisible(); // the real editor is open
  // Type a character and delete it: no net change, but BlockNote now writes the snapshot in its own shape.
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(800);
  await page.keyboard.press("Escape");
  await expect(host.locator("[contenteditable=true]")).toHaveCount(0);
  // BlockNote re-saved the snapshot in its own shape (block ids) — and the fingerprint didn't move.
  await expect
    .poll(() =>
      page.evaluate((id) => {
        type Dev = { api: { getSceneElements(): { id: string; customData?: { acute?: { documentId?: string } } }[] }; store: { get(id: string): { snapshot: { id?: string }[] } } };
        const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
        const docId = dev.api.getSceneElements().find((e) => e.id === id)!.customData!.acute!.documentId!;
        return dev.store.get(docId).snapshot.every((b) => typeof b.id === "string");
      }, todo.id),
    )
    .toBe(true);
  expect((await recon(page, todo.id))!.current).toBe(baseline);

  await page.reload();
  await waitForCanvas(page);
  await expect.poll(async () => (await recon(page, todo.id))?.current).toBe(baseline);

  // A real edit: check the first item through the stored document.
  await page.evaluate((id) => {
    type Dev = { api: { getSceneElements(): { id: string; customData?: { acute?: { documentId?: string } } }[] }; store: { get(id: string): { snapshot: { type: string; props?: Record<string, unknown> }[] }; update(id: string, patch: unknown): void } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const docId = dev.api.getSceneElements().find((e) => e.id === id)!.customData!.acute!.documentId!;
    const snapshot = structuredClone(dev.store.get(docId).snapshot);
    const item = snapshot.find((b) => b.type === "checkListItem")!;
    item.props = { ...item.props, checked: true };
    dev.store.update(docId, { snapshot });
  }, todo.id);
  const after = (await recon(page, todo.id))!;
  expect(after.current).not.toBe(baseline);
  expect(after.link!.contentFingerprint).toBe(baseline); // the baseline itself is untouched by a user edit
});
