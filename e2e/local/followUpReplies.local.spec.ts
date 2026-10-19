/**
 * F38b in the real app, no AI: the follow-up-replies workflow. A user pastes
 * one chat reply as a structured note (title, "Rollout Steps" checklist,
 * "Risks" and "Owners" paragraphs), then pastes follow-up replies over it
 * with Ask AI → Update from new content:
 *
 *   reply 2 corrects the Risks sentence and adds a rollback-mitigation paragraph;
 *   reply 3 corrects only Owners.
 *
 * Test 1 — only what changed is touched; Test 2 — the new detail is its own
 * block, Risks is updated in place; Test 3 — that block is linked to Risks;
 * Test 4 — a third paste still proposes only its one change.
 */
import { expect, test, type Page } from "@playwright/test";
import { action, elements, openApp, openAskAI } from "../helpers";

const REPLY_1 = `# Database migration plan

## Rollout Steps

- [ ] Take a backup
- [ ] Run the migration
- [ ] Verify the users table

## Risks

The database migration may lock the users table during off-peak hours.

## Owners

The platform team owns the migration; the on-call DBA approves it.
`;
const REPLY_2 = REPLY_1.replace(
  "The database migration may lock the users table during off-peak hours.",
  "The database migration may lock the users table for about 90 seconds during off-peak hours.\n\n" +
    "Mitigation: if the lock lasts longer than two minutes, roll back with the prepared down-migration and retry in the next maintenance window.",
);
const REPLY_3 = REPLY_2.replace("the on-call DBA approves it.", "the on-call DBA and the security lead both approve it.");

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const proposed = (p: Page) => reviewBar(p).getByRole("list", { name: "Proposed changes" }).getByRole("listitem");

/** Live blocks whose document mentions `needle`, with their box and document text. */
function blocksMentioning(p: Page, needle: string): Promise<{ id: string; x: number; y: number; width: number; height: number; text: string }[]> {
  return p.evaluate((n) => {
    type El = { id: string; x: number; y: number; width: number; height: number; customData?: { acute?: { documentId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return dev.api.getSceneElements().flatMap((el) => {
      const docId = el.customData?.acute?.documentId;
      const text = docId ? JSON.stringify(dev.store.get(docId)?.snapshot ?? "") : "";
      return text.includes(n) ? [{ id: el.id, x: el.x, y: el.y, width: el.width, height: el.height, text }] : [];
    });
  }, needle);
}

async function one(p: Page, needle: string) {
  await expect.poll(async () => (await blocksMentioning(p, needle)).length, `exactly one block mentions “${needle}”`).toBe(1);
  return (await blocksMentioning(p, needle))[0]!;
}

/** Arrows bound between two elements, with their relation type. */
function arrowsBetween(p: Page, from: string, to: string): Promise<{ id: string; relation?: string }[]> {
  return p.evaluate(
    ({ from, to }) => {
      type El = { id: string; type: string; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null; customData?: { acuteRelation?: string } };
      const els = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api.getSceneElements();
      return els.filter((e) => e.type === "arrow" && e.startBinding?.elementId === from && e.endBinding?.elementId === to).map((e) => ({ id: e.id, relation: e.customData?.acuteRelation }));
    },
    { from, to },
  );
}

async function pasteFollowUp(p: Page, objectId: string, text: string) {
  const surface = await openAskAI(p, objectId);
  await (await action(surface, "Update from new content")).click();
  await updateDialog(p).getByRole("textbox").fill(text);
  await updateDialog(p).getByRole("button", { name: "Update", exact: true }).click();
  await expect(reviewBar(p)).toBeVisible();
  await reviewBar(p).getByRole("button", { name: "Review" }).click();
}

test.describe.configure({ mode: "serial" });
let page: Page;
let risksId: string;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
});
test.afterAll(async () => {
  await page?.context().close();
});

test("reply 1 becomes one structured note: title, Rollout Steps checklist, Risks and Owners paragraphs", async () => {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(REPLY_1);
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  const note = (await elements(page)).filter((e) => e.acute?.kind === "rich-block");
  expect(note.some((e) => e.acute?.blockType === "todo")).toBe(true);
  risksId = (await one(page, "lock the users table")).id;
  await one(page, "on-call DBA");
});

test("Test 1 — reply 2 touches only what changed: one update, of Risks; no title, checklist or Owners rebuilt", async () => {
  const before = await elements(page);
  await pasteFollowUp(page, risksId, REPLY_2);
  await expect(reviewBar(page)).toContainText("~1 updated");
  await expect(reviewBar(page)).not.toContainText("removed");
  await expect(reviewBar(page)).not.toContainText("needs your input");
  const items = await proposed(page).allInnerTexts();
  expect(items.filter((t) => t.startsWith("Update")), "exactly one update").toHaveLength(1);
  // The Risks card (its heading is the section's title since F42, so the row shows the card's new text).
  expect(items.filter((t) => t.startsWith("Update"))[0]).toContain("for about 90 seconds");
  expect(await elements(page)).toEqual(before); // still only a proposal
});

test("Test 2 — the mitigation becomes its own block below Risks; Risks is updated in place, not duplicated or merged", async () => {
  await expect(reviewBar(page)).toContainText("+1 new");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  const risks = await one(page, "about 90 seconds");
  expect(risks.id, "Risks updated in place").toBe(risksId);
  expect(risks.text, "no merged wall of text").not.toContain("Mitigation");
  expect(await blocksMentioning(page, "during off-peak hours.")).toHaveLength(1); // not duplicated
  const mitigation = await one(page, "prepared down-migration");
  expect(mitigation.id).not.toBe(risksId);
  // Next to Risks: directly below it (F41 makes room: what was below moves down), or beside it, top-aligned, when moving it costs more.
  const below = mitigation.x === risks.x && mitigation.y > risks.y + risks.height;
  const beside = mitigation.y === risks.y && mitigation.x > risks.x + risks.width;
  expect(below || beside, `mitigation at ${mitigation.x},${mitigation.y}; Risks at ${risks.x},${risks.y} ${risks.width}×${risks.height}`).toBe(true);
  // Either way it overlaps nothing: Owners, if it was in the way, was moved clear of it.
  const owners = await one(page, "on-call DBA");
  const overlap = (a: typeof owners, b: typeof owners) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  expect(overlap(owners, mitigation), `Owners at ${owners.x},${owners.y}`).toBe(false);
});

test("Test 3 — the mitigation block is attached to Risks by a visible explained_by connection", async () => {
  const mitigation = await one(page, "prepared down-migration");
  await expect.poll(() => arrowsBetween(page, risksId, mitigation.id)).toEqual([expect.objectContaining({ relation: "explained_by" })]);
});

test("Test 4 — reply 3 still proposes only its one change (Owners); Risks, the mitigation and the link are left alone", async () => {
  const mitigation = await one(page, "prepared down-migration");
  const link = (await arrowsBetween(page, risksId, mitigation.id))[0]!;
  await pasteFollowUp(page, risksId, REPLY_3);
  await expect(reviewBar(page)).toContainText("~1 updated");
  await expect(reviewBar(page)).not.toContainText(/\+\d+ new/);
  await expect(reviewBar(page)).not.toContainText("removed");
  await expect(reviewBar(page)).not.toContainText(/links? changed/);
  await expect(proposed(page)).toHaveCount(1);
  await expect(proposed(page).first()).toContainText("the security lead"); // the Owners card (titled by its section since F42)
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  expect((await one(page, "security lead")).text).toContain("on-call DBA");
  expect((await one(page, "about 90 seconds")).id).toBe(risksId);
  expect((await one(page, "prepared down-migration")).id).toBe(mitigation.id);
  expect(await arrowsBetween(page, risksId, mitigation.id)).toEqual([link]);
});
