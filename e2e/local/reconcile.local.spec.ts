/**
 * F38/F39 in the real app, local tier only (no AI connection): "Update from
 * new content" on a Visualize result. Identical content changes nothing; an
 * untouched block updates cleanly in one undo step; a block the user edited
 * becomes a conflict card (Keep mine / Apply update / View diff) and is never
 * overwritten without a decision; Reject leaves everything as it was; a
 * removed section is proposed for removal; the opt-out holds; and "Update
 * source from this edit" writes an edit back into the content source.
 */
import { expect, test, type Page } from "@playwright/test";
import { action, elements, openApp, openAskAI, pasteText, select, undo } from "../helpers";

type Link = { contentSourceId: string; contentSourceVersion: number; stableNodeKey: string; contentFingerprint: string; excludeFromReconciliation: boolean } | null;

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const acceptedBar = (p: Page) => p.getByRole("status", { name: "AI changes" });
const conflicts = (p: Page) => reviewBar(p).getByRole("list", { name: "Changes that need your input" });
const origin = (p: Page) => p.getByRole("group", { name: "Origin" });
const nothingChanged = (p: Page) => p.getByText("Nothing changed — the canvas already matches this content.");

const link = (p: Page, id: string) =>
  p.evaluate(async (i) => (await (window as unknown as { __acuteDev: { reconciliation(i: string): Promise<{ link: Link } | null> } }).__acuteDev.reconciliation(i))?.link ?? null, id);
const sourceText = (p: Page, id: string) =>
  p.evaluate(async (i) => (await (window as unknown as { __acuteDev: { contentSource(i: string): Promise<{ version: { text: string } } | null> } }).__acuteDev.contentSource(i))?.version.text ?? null, id);

/** Every live block whose document mentions `needle`, as { id, text }. */
function blocksMentioning(p: Page, needle: string): Promise<{ id: string; text: string }[]> {
  return p.evaluate((n) => {
    type El = { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return dev.api.getSceneElements().flatMap((el) => {
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      const text = docId ? JSON.stringify(dev.store.get(docId)?.snapshot ?? "") : "";
      return text.includes(n) ? [{ id: el.id, text }] : [];
    });
  }, needle);
}

async function oneBlock(p: Page, needle: string): Promise<{ id: string; text: string }> {
  await expect.poll(async () => (await blocksMentioning(p, needle)).length).toBe(1);
  return (await blocksMentioning(p, needle))[0]!;
}

/** Replaces a text in a block's stored document, as a user edit would. */
function editBlock(p: Page, id: string, from: string, to: string): Promise<void> {
  return p.evaluate(
    ({ id, from, to }) => {
      type El = { id: string; customData?: { acute?: { documentId?: string } } };
      type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown }; update(id: string, patch: unknown): void } };
      const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
      const docId = dev.api.getSceneElements().find((e) => e.id === id)!.customData!.acute!.documentId!;
      dev.store.update(docId, { snapshot: JSON.parse(JSON.stringify(dev.store.get(docId).snapshot).split(from).join(to)) });
    },
    { id, from, to },
  );
}

const v1 = "# Launch plan\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway may time out under load.\n\n## Rollback\n\nFlip the flag off and drain the queue.\n";
const v2 = v1.replace("time out under load", "time out under heavy load");

/** Select an object of the source, then Ask AI → Update from new content; fills the new text and runs it. */
async function updateFrom(p: Page, objectId: string, text: string) {
  const surface = await openAskAI(p, objectId);
  await (await action(surface, "Update from new content")).click();
  await expect(updateDialog(p)).toBeVisible();
  await updateDialog(p).getByRole("textbox").fill(text);
  await updateDialog(p).getByRole("button", { name: "Update", exact: true }).click();
  await expect(updateDialog(p)).toBeHidden();
}

test.describe.configure({ mode: "serial" });
let page: Page;
let sourceId: string;

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
  await openApp(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(v1);
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  const risks = await oneBlock(page, "gateway");
  sourceId = (await link(page, risks.id))!.contentSourceId;
});
test.afterAll(async () => {
  await page?.context().close();
});

test("the action is offered only for objects made from a content source, pre-filled with its latest text", async () => {
  const manual = await pasteText(page, "a note of my own", { x: 300, y: 700 });
  const surface = await openAskAI(page, manual);
  await expect(await action(surface, "Update from new content")).toHaveCount(0);
  await page.keyboard.press("Escape");

  const risks = await oneBlock(page, "gateway");
  const s2 = await openAskAI(page, risks.id);
  await (await action(s2, "Update from new content")).click();
  await expect(updateDialog(page).getByRole("textbox")).toHaveValue(v1);
  await expect(updateDialog(page).getByRole("radiogroup", { name: "Template" })).toBeHidden();
  await updateDialog(page).getByRole("button", { name: "Cancel" }).click();
});

test("identical content: nothing to review, the canvas already matches", async () => {
  const before = await elements(page);
  await updateFrom(page, (await oneBlock(page, "gateway")).id, v1);
  await expect(nothingChanged(page)).toBeVisible();
  await expect(reviewBar(page)).toBeHidden();
  expect(await elements(page)).toEqual(before);
});

test("an untouched block updates cleanly as one undo step; after Undo, re-running proposes it again", async () => {
  const risks = await oneBlock(page, "gateway");
  const count = (await elements(page)).length;
  await updateFrom(page, risks.id, v2);
  await expect(reviewBar(page)).toContainText("~1 updated");
  await expect(conflicts(page)).toHaveCount(0);
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");

  const updated = await oneBlock(page, "gateway");
  expect(updated.id).toBe(risks.id); // updated in place: same object, same position
  expect(updated.text).toContain("heavy load");
  expect((await elements(page)).length).toBe(count);
  await expect.poll(() => sourceText(page, sourceId)).toBe(v2);

  await undo(page);
  expect((await oneBlock(page, "gateway")).text).not.toContain("heavy load");
  await updateFrom(page, risks.id, v2);
  await expect(reviewBar(page)).toContainText("~1 updated");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  expect((await oneBlock(page, "gateway")).text).toContain("heavy load");
});

test("a block the user edited becomes a conflict; Keep mine leaves it and it doesn't come back", async () => {
  const risks = await oneBlock(page, "gateway");
  await editBlock(page, risks.id, "heavy load", "heavy load (my note: add retries)");
  const v3 = v2.replace("heavy load", "peak load");
  await updateFrom(page, risks.id, v3);

  await expect(reviewBar(page)).toContainText("⚠ 1 needs your input");
  const card = conflicts(page).getByRole("listitem");
  await expect(card.getByLabel("Your version")).toContainText("my note: add retries");
  await expect(card.getByLabel("Proposed version")).toContainText("peak load");
  const accept = reviewBar(page).getByRole("button", { name: "Accept all clean changes" });
  await expect(accept).toBeDisabled(); // nothing clean, nothing decided

  await card.getByRole("button", { name: "View diff" }).click();
  await expect(card.getByLabel("Differences")).toContainText("+ ");
  await card.getByRole("button", { name: "Keep mine" }).click();
  await expect(accept).toBeEnabled();
  await accept.click();
  await expect(acceptedBar(page)).toContainText("Kept your edit.");
  expect((await oneBlock(page, "gateway")).text).toContain("my note: add retries");

  await updateFrom(page, risks.id, v3);
  await expect(nothingChanged(page)).toBeVisible();
});

test("Apply update on a conflict replaces the user's edit, and only then", async () => {
  const risks = await oneBlock(page, "gateway");
  await editBlock(page, risks.id, "add retries", "add retries and alerts");
  const v4 = v1.replace("time out under load", "time out at peak");
  await updateFrom(page, risks.id, v4);
  const card = conflicts(page).getByRole("listitem");
  await card.getByRole("button", { name: "Apply update" }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all clean changes" }).click();
  const after = await oneBlock(page, "gateway");
  expect(after.text).toContain("time out at peak");
  expect(after.text).not.toContain("alerts");
  await expect.poll(() => sourceText(page, sourceId)).toBe(v4);
});

test("a section gone from the content is proposed for removal; Reject leaves the canvas exactly as it was", async () => {
  const v4 = v1.replace("time out under load", "time out at peak");
  const withoutRollback = v4.replace("\n## Rollback\n\nFlip the flag off and drain the queue.\n", "");
  const rollback = await oneBlock(page, "drain the queue");
  const before = await elements(page);

  await updateFrom(page, rollback.id, withoutRollback);
  await expect(reviewBar(page)).toContainText("removed");
  await reviewBar(page).getByRole("button", { name: "Reject" }).click();
  expect(await elements(page)).toEqual(before);

  await updateFrom(page, rollback.id, withoutRollback);
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect.poll(async () => (await blocksMentioning(page, "drain the queue")).length).toBe(0);
});

test("“Don't update this from AI” keeps an object out of updates until allowed again", async () => {
  const risks = await oneBlock(page, "gateway");
  await select(page, risks.id);
  await origin(page).getByRole("button", { name: "Don't update this from AI" }).click();
  await expect(origin(page).getByRole("button", { name: "Allow AI updates" })).toBeVisible();
  expect((await link(page, risks.id))!.excludeFromReconciliation).toBe(true);

  const latest = (await sourceText(page, sourceId))!;
  const changed = latest.replace("time out at peak", "time out at night");
  await updateFrom(page, risks.id, changed);
  await expect(nothingChanged(page)).toBeVisible();
  expect((await oneBlock(page, "gateway")).text).toContain("at peak");

  await select(page, risks.id);
  await origin(page).getByRole("button", { name: "Allow AI updates" }).click();
  await updateFrom(page, risks.id, changed);
  await expect(reviewBar(page)).toContainText("~1 updated");
  await reviewBar(page).getByRole("button", { name: "Reject" }).click();
});

test("“Update source from this edit” writes the edit back as a new source version, and it becomes the baseline", async () => {
  const risks = await oneBlock(page, "gateway");
  await editBlock(page, risks.id, "time out at peak", "time out at peak traffic");
  await select(page, risks.id);
  await origin(page).getByRole("button", { name: "Update source from this edit" }).click();
  await expect(page.getByText("Updated the content source from this edit.")).toBeVisible();
  await expect.poll(() => sourceText(page, sourceId)).toContain("The gateway may time out at peak traffic.");

  // The source now says what the block says: re-running it changes nothing.
  await updateFrom(page, risks.id, (await sourceText(page, sourceId))!);
  await expect(nothingChanged(page)).toBeVisible();
});
