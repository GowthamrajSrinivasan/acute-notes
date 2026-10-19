/**
 * F42 Phase 3 in the real app: "Update from new content" keeps sections framed.
 * A new paragraph in an existing section joins that section's frame (which
 * grows to fit it); a new section arrives in a frame of its own, with its XL
 * title — never as loose objects beside the source.
 */
import { expect, test, type Page } from "@playwright/test";
import { action, elements, openApp, openAskAI, type ElementInfo } from "../helpers";

const NOTE = `# Database migration plan

## Rollout Steps

- [ ] Take a backup
- [ ] Run the migration

## Risks

The database migration may lock the users table during off-peak hours.

## Owners

The platform team owns the migration.
`;

const UPDATED = NOTE.replace(
  "The database migration may lock the users table during off-peak hours.",
  "The database migration may lock the users table during off-peak hours.\n\nMitigation: roll back with the prepared down-migration.",
).concat("\n## Timeline\n\nThe migration runs on Saturday night.\n");

const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
type Frame = { id: string; x: number; y: number; width: number; height: number; name: string };

async function frames(p: Page): Promise<Frame[]> {
  return p.evaluate(() =>
    (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string; type: string; x: number; y: number; width: number; height: number; name?: string }[] } } }).__acuteDev.api
      .getSceneElements()
      .filter((e) => e.type === "frame")
      .map((e) => ({ id: e.id, x: e.x, y: e.y, width: e.width, height: e.height, name: e.name ?? "" })),
  );
}

async function frameIdOf(p: Page, id: string): Promise<string | null> {
  return p.evaluate(
    (i) => (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string; frameId?: string | null }[] } } }).__acuteDev.api.getSceneElements().find((e) => e.id === i)?.frameId ?? null,
    id,
  );
}

/** The live block whose document mentions `needle`. */
async function blockMentioning(p: Page, needle: string): Promise<ElementInfo> {
  for (const el of (await elements(p)).filter((e) => e.acute?.kind === "rich-block")) {
    const text = await p.evaluate(
      (docId) => JSON.stringify((window as unknown as { __acuteDev: { store: { get(id: string): { snapshot: unknown } | null } } }).__acuteDev.store.get(docId)?.snapshot ?? ""),
      el.acute!.documentId!,
    );
    if (text.includes(needle)) return el;
  }
  throw new Error(`no block mentions "${needle}"`);
}

const inside = (f: Frame, b: { x: number; y: number; width: number; height: number }) => b.x >= f.x && b.y >= f.y && b.x + b.width <= f.x + f.width && b.y + b.height <= f.y + f.height;
const overlap = (a: Frame, b: Frame) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test("Update from new content: new paragraphs join their section's frame; a new section gets its own", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = page.getByRole("dialog", { name: "Visualize" });
  await dialog.getByRole("textbox").fill(NOTE);
  await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  const before = await frames(page);
  expect(before.length).toBeGreaterThanOrEqual(3);
  const risks = await blockMentioning(page, "lock the users table");
  const risksFrameId = await frameIdOf(page, risks.id);
  expect(risksFrameId).toBeTruthy();

  const surface = await openAskAI(page, risks.id);
  await (await action(surface, "Update from new content")).click();
  const update = page.getByRole("dialog", { name: "Update from new content" });
  await update.getByRole("textbox").fill(UPDATED);
  await update.getByRole("button", { name: "Update", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible();
  await reviewBar(page).getByRole("button", { name: "Review" }).click();
  await expect(reviewBar(page)).toContainText("in the section");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  // The mitigation is a member of the Risks frame, and the frame grew to hold it.
  const mitigation = await blockMentioning(page, "prepared down-migration");
  expect(await frameIdOf(page, mitigation.id)).toBe(risksFrameId);
  const after = await frames(page);
  const risksFrame = after.find((f) => f.id === risksFrameId)!;
  expect(inside(risksFrame, mitigation), `mitigation ${JSON.stringify(mitigation)} in ${JSON.stringify(risksFrame)}`).toBe(true);

  // The new section: its own frame, holding its title and its text.
  expect(after).toHaveLength(before.length + 1);
  const timeline = await blockMentioning(page, "Saturday night");
  const timelineFrameId = await frameIdOf(page, timeline.id);
  expect(timelineFrameId).toBeTruthy();
  expect(before.some((f) => f.id === timelineFrameId)).toBe(false);
  const title = await blockMentioning(page, "Timeline");
  expect(await frameIdOf(page, title.id)).toBe(timelineFrameId);
  expect(after.find((f) => f.id === timelineFrameId)!.name).toMatch(new RegExp(`^${before.length + 1} · `));

  if (process.env.ACUTE_SHOT) {
    await page.evaluate(() => (window as unknown as { __acuteDev: { api: { scrollToContent(e?: unknown, o?: unknown): void } } }).__acuteDev.api.scrollToContent(undefined, { fitToViewport: true }));
    await page.screenshot({ path: process.env.ACUTE_SHOT });
  }

  // Sections never overlap each other.
  for (const a of after) for (const b of after) if (a.id < b.id) expect(overlap(a, b), `${a.name} / ${b.name}`).toBe(false);
});

test("a section removed from the content takes its frame with it", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = page.getByRole("dialog", { name: "Visualize" });
  await dialog.getByRole("textbox").fill(NOTE);
  await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  const owners = await blockMentioning(page, "platform team owns");
  const ownersFrameId = await frameIdOf(page, owners.id);
  expect(ownersFrameId).toBeTruthy();
  const count = (await frames(page)).length;

  const risks = await blockMentioning(page, "lock the users table");
  const surface = await openAskAI(page, risks.id);
  await (await action(surface, "Update from new content")).click();
  const update = page.getByRole("dialog", { name: "Update from new content" });
  await update.getByRole("textbox").fill(NOTE.replace("## Owners\n\nThe platform team owns the migration.\n", ""));
  await update.getByRole("button", { name: "Update", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  const after = await frames(page);
  expect(after).toHaveLength(count - 1);
  expect(after.some((f) => f.id === ownersFrameId)).toBe(false);
});

test("an ASCII tree in a section is drawn as linked shapes inside its frame, with no AI", async ({ page }) => {
  await openApp(page);
  const before = new Set((await elements(page)).map((e) => e.id));
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = page.getByRole("dialog", { name: "Visualize" });
  await dialog.getByRole("textbox").fill("# Business model\n\n## Plans\n\n```\nACUTE\n ├── FREE\n └── PAID\n      ├── PRO\n      └── LIFETIME\n```\n\n## Notes\n\nPrices are monthly.\n");
  await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  const added = (await elements(page)).filter((e) => !before.has(e.id));
  const labels = added.filter((e) => e.type === "text" && e.containerId).map((e) => e.text);
  expect(labels.sort()).toEqual(["ACUTE", "FREE", "LIFETIME", "PAID", "PRO"]);
  const shapes = added.filter((e) => e.type === "rectangle");
  expect(shapes).toHaveLength(5);
  expect(added.filter((e) => e.type === "arrow")).toHaveLength(4);
  const frameIds = new Set(await Promise.all(shapes.map((s) => frameIdOf(page, s.id))));
  expect(frameIds.size).toBe(1); // all in the Plans frame
  expect([...frameIds][0]).toBeTruthy();
  // Top-down: the root above its children.
  const top = (label: string) => shapes.find((s) => added.some((t) => t.containerId === s.id && t.text === label))!.y;
  expect(top("ACUTE")).toBeLessThan(top("FREE"));
  expect(top("PAID")).toBeLessThan(top("PRO"));
});
