/**
 * Topic merge G2.2 in the real app, local tier only (no AI connection): Visualize on a canvas that already has notes
 * suggests "Merge into existing notes". Content about an existing topic joins it (one copy, same source, next
 * version); content the notes already hold changes nothing and says so; "Add as new notes" is the old Visualize.
 * Needs `NEXT_PUBLIC_TOPIC_MERGE=on` (set in `.env.development`).
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../helpers";

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

type Link = { contentSourceId: string; contentSourceVersion: number } | null;
const link = (p: Page, id: string) =>
  p.evaluate(async (i) => (await (window as unknown as { __acuteDev: { reconciliation(i: string): Promise<{ link: Link } | null> } }).__acuteDev.reconciliation(i))?.link ?? null, id);
const sourceText = (p: Page, id: string) =>
  p.evaluate(async (i) => (await (window as unknown as { __acuteDev: { contentSource(i: string): Promise<{ version: { text: string } } | null> } }).__acuteDev.contentSource(i))?.version.text ?? null, id);

/** Ids of live blocks whose document mentions `needle`. */
function blocksMentioning(p: Page, needle: string): Promise<string[]> {
  return p.evaluate((n) => {
    type El = { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return dev.api.getSceneElements().flatMap((el) => {
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      return !el.isDeleted && docId && JSON.stringify(dev.store.get(docId)?.snapshot ?? "").includes(n) ? [el.id] : [];
    });
  }, needle);
}

async function openVisualize(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(p).getByRole("textbox").fill(text);
}

const NOTES = "# Launch plan\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway may time out under load.\n\n## Rollback\n\nFlip the flag off and drain the queue.\n";

/** Structured enough for the local tier on its own, and repeating "Rollback" from the notes. */
const SUPPORT = "# Support plan\n\n- [ ] Staff the queue\n- [ ] Write the macro\n\n## Escalation\n\nPage the on-call engineer.\n\n## Rollback\n\nFlip the flag off and drain the queue.\n";

test.describe.configure({ mode: "serial" });
let page: Page;
let sourceId: string;

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await openApp(page);
  await openVisualize(page, NOTES);
  // An empty canvas has nothing to merge into: plain Visualize.
  await expect(visualizeDialog(page).getByRole("radio", { name: /Merge into existing notes/ })).toHaveCount(0);
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  await expect.poll(async () => (await blocksMentioning(page, "gateway")).length).toBe(1);
  sourceId = (await link(page, (await blocksMentioning(page, "gateway"))[0]!))!.contentSourceId;
});

test("with notes on the canvas, merge is suggested and named after those notes", async () => {
  await openVisualize(page, "## Risks\n\nRetries back off exponentially.\n");
  const merge = visualizeDialog(page).getByRole("radio", { name: /Merge into existing notes/ });
  await expect(merge).toBeChecked();
  await expect(visualizeDialog(page).getByText("Launch plan")).toBeVisible();
  // A merge keeps the notes' own layout: no template to choose.
  await expect(visualizeDialog(page).getByRole("radiogroup", { name: "Template" })).toHaveCount(0);
  await visualizeDialog(page).getByRole("button", { name: "Merge", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  // One copy of the existing content, the new passage added, all in the same source's next version.
  await expect.poll(async () => (await blocksMentioning(page, "Retries back off")).length).toBe(1);
  expect(await blocksMentioning(page, "gateway")).toHaveLength(1);
  const added = (await blocksMentioning(page, "Retries back off"))[0]!;
  expect(await link(page, added)).toMatchObject({ contentSourceId: sourceId, contentSourceVersion: 2 });
  expect(await sourceText(page, sourceId)).toContain("The gateway may time out under load.\n\nRetries back off exponentially.");
});

test("content the notes already hold changes nothing, and says so", async () => {
  await openVisualize(page, "## Rollback\n\nFlip the flag off and drain the queue.\n");
  await visualizeDialog(page).getByRole("button", { name: "Merge", exact: true }).click();
  await expect(page.getByText("Everything in this content is already in your notes.")).toBeVisible();
  await expect(reviewBar(page)).toBeHidden();
  expect(await blocksMentioning(page, "drain the queue")).toHaveLength(1);
});

test("'Add as new notes' is the Visualize it always was: a second copy, a new source", async () => {
  await openVisualize(page, SUPPORT);
  await visualizeDialog(page).getByRole("radio", { name: "Add as new notes" }).check();
  await expect(visualizeDialog(page).getByRole("radiogroup", { name: "Template" })).toBeVisible();
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect.poll(async () => (await blocksMentioning(page, "drain the queue")).length).toBe(2);
  const sources = new Set(await Promise.all((await blocksMentioning(page, "drain the queue")).map(async (id) => (await link(page, id))?.contentSourceId)));
  expect(sources.size).toBe(2);
});
