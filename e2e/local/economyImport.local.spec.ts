/**
 * "Add new text as plain cards, no AI" (economy import) in the real app, local tier (no AI connection). The checkbox is off for every
 * new open and only shown when merging; when chosen, the flag reaches the merge (diagnostics.economy), no plan/analysis/outline call is
 * made, the new text is kept word for word, nothing is removed, and importing the same text again changes nothing.
 * Needs `NEXT_PUBLIC_TOPIC_MERGE=on` (set in `.env.development`).
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../helpers";

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const economyBox = (p: Page) => visualizeDialog(p).getByRole("checkbox", { name: "Add new text as plain cards, no AI" });

type Diag = { economy: unknown[]; removals: unknown[]; calls: { byTask: Record<string, number> } } | null;
const lastMerge = (p: Page) => p.evaluate(() => (window as unknown as { __acuteDev: { lastMerge(): Promise<Diag> } }).__acuteDev.lastMerge());
const sourceText = (p: Page, id: string) =>
  p.evaluate(async (i) => (await (window as unknown as { __acuteDev: { contentSource(i: string): Promise<{ version: { text: string } } | null> } }).__acuteDev.contentSource(i))?.version.text ?? null, id);
const liveSourceId = (p: Page, needle: string) =>
  p.evaluate(async (n) => {
    type El = { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null }; reconciliation(i: string): Promise<{ link: { contentSourceId: string } | null } | null> };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    for (const el of dev.api.getSceneElements()) {
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      if (!el.isDeleted && docId && JSON.stringify(dev.store.get(docId)?.snapshot ?? "").includes(n)) return (await dev.reconciliation(el.id))?.link?.contentSourceId ?? null;
    }
    return null;
  }, needle);
const countMentioning = (p: Page, needle: string) =>
  p.evaluate((n) => {
    type El = { isDeleted?: boolean; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return dev.api.getSceneElements().filter((el) => {
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      return !el.isDeleted && docId && JSON.stringify(dev.store.get(docId)?.snapshot ?? "").includes(n);
    }).length;
  }, needle);

async function openVisualize(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(p).getByRole("textbox").fill(text);
}

const NOTES = "# Launch plan\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway may time out under load.\n\n## Rollback\n\nFlip the flag off and drain the queue.\n";
const NEW_TEXT = "## Risks\n\nRetries back off exponentially.\n";
const ECONOMY_NOTICE = /kept word for word as plain cards\. AI does not organise or link it/;

test.describe.configure({ mode: "serial" });
let page: Page;
let sourceId: string;

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await openApp(page);
  await openVisualize(page, NOTES);
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  await expect.poll(() => countMentioning(page, "gateway")).toBe(1);
  sourceId = (await liveSourceId(page, "gateway"))!;
});

test("the option is off by default, offered only when merging, and its notice says the text is not AI-organised", async () => {
  await openVisualize(page, NEW_TEXT);
  await expect(visualizeDialog(page).getByRole("radio", { name: /Merge into existing notes/ })).toBeChecked();
  await expect(economyBox(page)).not.toBeChecked();
  await expect(visualizeDialog(page).getByText(ECONOMY_NOTICE)).toHaveCount(0);
  await economyBox(page).check();
  await expect(visualizeDialog(page).getByText(ECONOMY_NOTICE)).toBeVisible();
  await expect(visualizeDialog(page).getByText(/New topics are still organised by AI/)).toBeVisible();
  // Not merging: the option is gone.
  await visualizeDialog(page).getByRole("radio", { name: "Add as new notes" }).check();
  await expect(economyBox(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(visualizeDialog(page)).toBeHidden();
  // A new open starts unchecked again.
  await openVisualize(page, NEW_TEXT);
  await expect(economyBox(page)).not.toBeChecked();
  await page.keyboard.press("Escape");
});

test("without the option the merge does not use economy mode", async () => {
  await openVisualize(page, NEW_TEXT);
  await visualizeDialog(page).getByRole("button", { name: "Merge", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  const diag = await lastMerge(page);
  expect(diag?.economy).toEqual([]);
  await expect.poll(() => countMentioning(page, "Retries back off")).toBe(1);
});

test("with the option: no AI call, text kept verbatim, nothing removed, and a repeat adds nothing", async () => {
  const more = "## Rollback\n\nPage the on-call engineer before draining.\n";
  await openVisualize(page, more);
  await economyBox(page).check();
  await visualizeDialog(page).getByRole("button", { name: "Merge", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  const diag = await lastMerge(page);
  expect(diag?.removals).toEqual([]);
  for (const task of ["generate_visual_plan", "generate_section_analysis", "outline_document"]) expect(diag?.calls.byTask[task] ?? 0).toBe(0);
  await expect.poll(() => countMentioning(page, "Page the on-call engineer before draining.")).toBe(1);
  expect(await sourceText(page, sourceId)).toContain("Page the on-call engineer before draining.");
  expect(await countMentioning(page, "gateway")).toBe(1);

  // The same text again, economy on: already there, nothing proposed, nothing duplicated.
  await openVisualize(page, more);
  await economyBox(page).check();
  await visualizeDialog(page).getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByText("Everything in this content is already in your notes.")).toBeVisible();
  await expect(reviewBar(page)).toBeHidden();
  expect(await countMentioning(page, "Page the on-call engineer before draining.")).toBe(1);
});
