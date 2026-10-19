/**
 * F19: AI change sets are reviewed before anything reaches the canvas —
 * without calling AI. Change sets are proposed through the dev hook (as an
 * AI action or Visualize would) or from a saved conversation's Insert, on the
 * AI test canvas: ghost preview only, Reject, Accept as one undo step, Undo
 * from the review bar, editing (and deleting) while a set is pending, and a
 * large Visualize-sized set.
 */
import { expect, test, type Page } from "@playwright/test";
import {
  askAISurface,
  blockByTitle,
  createDemoCanvas,
  documentOf,
  elements,
  openApp,
  openHistory,
  seedConversation,
  select,
  shapeByLabel,
  undo,
  type ElementInfo,
} from "../helpers";

test.describe.configure({ mode: "serial" });

let page: Page;
let overviewId = "";
let apiShape: ElementInfo;

const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const notice = (p: Page) => p.getByRole("status", { name: "AI changes" });
const ghosts = (p: Page) => p.locator(".acute-review-ghosts .acute-review-ghost");

let seq = 0;
function propose(p: Page, changes: unknown[], title = "Visualize"): Promise<void> {
  const set = { operationId: `op_e2e_${++seq}`, title, metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "mock" }, changes };
  return p.evaluate((s) => void (window as unknown as { __acuteDev: { proposeChanges(s: unknown): unknown } }).__acuteDev.proposeChanges(s), set);
}

const note = (key: string, x: number, y: number, text = key) => ({
  kind: "create_block",
  key,
  blockType: "text",
  content: [{ type: "heading", props: { level: 3 }, content: text }, { type: "paragraph", content: `About ${text}.` }],
  box: { x, y, width: 280, height: 160 },
});

/** A mixed set: two notes, a shape, three connections (one to an existing block), one move. */
function mixedSet() {
  return [
    note("a", 2400, 0, "Retry policy"),
    note("b", 2400, 300, "Idempotency keys"),
    { kind: "create_shape", key: "s", shape: "diamond", label: "Gateway", box: { x: 2800, y: 150, width: 200, height: 120 } },
    { kind: "connect", key: "ab", from: { created: "a" }, to: { created: "b" }, relation: "depends_on" },
    { kind: "connect", key: "bs", from: { created: "b" }, to: { created: "s" }, label: "calls" },
    { kind: "connect", key: "oa", from: { existing: overviewId }, to: { created: "a" } },
    { kind: "move", target: apiShape.id, to: { x: apiShape.x + 40, y: apiShape.y + 400 } },
  ];
}

const live = async (p: Page) => (await elements(p)).length;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
  await createDemoCanvas(page);
  overviewId = (await blockByTitle(page, "Checkout revamp — overview")).id;
  apiShape = await shapeByLabel(page, "Checkout API");
});

test.afterAll(async () => {
  await page?.context().close();
});

test("a proposal is only a preview: ghosts and a review bar, nothing in the scene; Reject leaves no trace", async () => {
  const before = await live(page);
  await propose(page, mixedSet());

  const bar = reviewBar(page);
  await expect(bar).toContainText("Visualize · 3 objects · 3 connections · 1 move");
  await expect(ghosts(page)).toHaveCount(7);
  await expect(page.locator(".acute-review-ghosts")).toContainText("Retry policy");
  expect(await live(page)).toBe(before);

  await bar.getByRole("button", { name: "Review" }).click();
  const list = bar.getByRole("list", { name: "Proposed changes" });
  await expect(list.getByRole("listitem")).toHaveCount(7);
  await expect(list).toContainText("Connect “Idempotency keys” → “Gateway” (calls)");
  await expect(list).toContainText("Connect existing object → “Retry policy”");

  await bar.getByRole("button", { name: "Reject" }).click();
  await expect(bar).toBeHidden();
  await expect(ghosts(page)).toHaveCount(0);
  expect(await live(page)).toBe(before);
  expect((await shapeByLabel(page, "Checkout API")).y).toBe(apiShape.y);
});

test("Accept all writes everything as one undo step, with provenance and bound connections", async () => {
  const before = await elements(page);
  await propose(page, mixedSet());
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();

  await expect(reviewBar(page)).toBeHidden();
  await expect(notice(page)).toContainText("Added 3 objects · 3 connections · 1 move.");
  const after = await elements(page);
  const known = new Set(before.map((e) => e.id));
  const added = after.filter((e) => !known.has(e.id));
  // 2 blocks + shape (+ its label) + 3 arrows (+ one label).
  expect(added.map((e) => e.type).sort()).toEqual(["arrow", "arrow", "arrow", "diamond", "embeddable", "embeddable", "text", "text"]);
  expect(added.find((e) => e.type === "arrow" && e.relation)?.relation).toBe("depends_on");
  expect((await shapeByLabel(page, "Checkout API")).y).toBe(apiShape.y + 400);

  const provenance = await page.evaluate((ids) => {
    type El = { id: string; customData?: { acuteMeta?: { ai?: { operationId?: string } } }; startBinding?: unknown; endBinding?: unknown };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api;
    return api
      .getSceneElements()
      .filter((e) => ids.includes(e.id))
      .map((e) => ({ id: e.id, op: e.customData?.acuteMeta?.ai?.operationId, bound: !!e.startBinding && !!e.endBinding }));
  }, added.map((e) => e.id));
  const op = `op_e2e_${seq}`;
  for (const block of added.filter((e) => e.acute?.kind === "rich-block")) {
    expect((await documentOf(page, block.acute!.documentId!))?.metadata?.ai).toMatchObject({ createdBy: "ai", task: "generate_visual_plan", operationId: op });
  }
  const arrows = provenance.filter((p) => added.find((e) => e.id === p.id)?.type === "arrow");
  expect(arrows.every((a) => a.bound && a.op === op)).toBe(true);

  // The bar's Undo reverts the whole operation in one step.
  await notice(page).getByRole("button", { name: "Undo" }).click();
  await expect(notice(page)).toBeHidden();
  expect((await elements(page)).map((e) => e.id).sort()).toEqual(before.map((e) => e.id).sort());
  expect((await shapeByLabel(page, "Checkout API")).y).toBe(apiShape.y);
});

test("the canvas stays editable during review; a change whose object was deleted is skipped, the rest applies", async () => {
  const todo = await blockByTitle(page, "Launch checklist");
  await propose(page, [
    note("n", 2400, 700, "Rollout"),
    { kind: "connect", key: "tn", from: { existing: todo.id }, to: { created: "n" } },
    { kind: "connect", key: "on", from: { existing: overviewId }, to: { created: "n" } },
  ]);
  await expect(reviewBar(page)).toContainText("1 block · 2 connections");

  // Delete the todo block while the set is pending.
  await select(page, todo.id);
  await page.locator(".excalidraw").focus();
  await page.keyboard.press("Delete");
  await expect(reviewBar(page)).toContainText("1 change was skipped: an object it refers to was deleted.");
  await expect(reviewBar(page)).toContainText("1 block · 1 connection");

  const before = new Set((await elements(page)).map((e) => e.id));
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(notice(page)).toContainText("Added 1 block · 1 connection. 1 change was skipped");
  const added = (await elements(page)).filter((e) => !before.has(e.id));
  expect(added.map((e) => e.type).sort()).toEqual(["arrow", "embeddable"]);

  // Undo: first the AI operation, then (separately) the user's own deletion.
  await undo(page);
  expect((await elements(page)).filter((e) => !before.has(e.id))).toEqual([]);
  await undo(page);
  expect((await elements(page)).some((e) => e.id === todo.id)).toBe(true);
});

test("a Visualize-sized set (40 objects, 39 connections) previews without committing and undoes in one step", async () => {
  const before = await live(page);
  const changes = [
    ...Array.from({ length: 40 }, (_, i) => ({
      kind: "create_shape",
      key: `s${i}`,
      shape: "rectangle",
      label: `Step ${i + 1}`,
      box: { x: 2400 + (i % 8) * 260, y: 1200 + Math.floor(i / 8) * 200, width: 200, height: 100 },
    })),
    ...Array.from({ length: 39 }, (_, i) => ({ kind: "connect", key: `c${i}`, from: { created: `s${i}` }, to: { created: `s${i + 1}` } })),
  ];
  await propose(page, changes);
  await expect(ghosts(page)).toHaveCount(79);
  expect(await live(page)).toBe(before);

  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(notice(page)).toContainText("Added 40 objects · 39 connections.");
  expect(await live(page)).toBe(before + 40 * 2 + 39);
  await undo(page);
  expect(await live(page)).toBe(before);
});

test("Insert from an AI reply proposes the block for review instead of writing it", async () => {
  await seedConversation(page, { anchorIds: [overviewId], anchorLabel: "Checkout revamp — overview", question: "Summarize", action: "summarize", reply: "Retries fix **4%** of failed payments." });
  const panel = await openHistory(page, overviewId);
  await panel.getByRole("button", { name: /Summarize/ }).click();
  const surface = askAISurface(page);
  const before = await live(page);
  await surface.locator(".acute-ask-ai__reply").last().getByRole("button", { name: "Insert on canvas" }).click();

  await expect(reviewBar(page)).toContainText("Summary · 1 block");
  await expect(page.locator(".acute-review-ghosts")).toContainText("Retries fix 4% of failed payments.");
  expect(await live(page)).toBe(before);

  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(notice(page)).toContainText("Added 1 block.");
  expect(await live(page)).toBe(before + 1);
  const overview = (await elements(page)).find((e) => e.id === overviewId)!;
  const inserted = (await elements(page)).at(-1)!;
  expect(inserted.x).toBeGreaterThan(overview.x + overview.width);
  expect((await documentOf(page, inserted.acute!.documentId!))?.metadata?.ai).toMatchObject({ createdBy: "ai", task: "chat", operationId: "op_test" });
  await undo(page);
  expect(await live(page)).toBe(before);
});

test("an invalid change set is refused before review", async () => {
  const error = await page.evaluate(() => {
    try {
      (window as unknown as { __acuteDev: { proposeChanges(s: unknown): unknown } }).__acuteDev.proposeChanges({
        operationId: "op_bad",
        title: "Bad",
        metadata: { createdBy: "ai" },
        changes: [{ kind: "delete", target: "x" }],
      });
      return null;
    } catch (err) {
      return (err as Error).name;
    }
  });
  expect(error).toBe("InvalidChangeSetError");
  await expect(reviewBar(page)).toBeHidden();
});

test("the review bar reports layout issues of the proposal as it will be drawn (Wave 1b item 4)", async () => {
  // Two linked notes in a row: a straight, clean link.
  await propose(page, [note("left", 2400, 4000, "Left end"), note("right", 3400, 4000, "Right end"), { kind: "connect", key: "lr", from: { created: "left" }, to: { created: "right" } }]);
  const bar = reviewBar(page);
  await expect(bar).toBeVisible();
  await expect(bar.locator(".acute-review__layout")).toHaveCount(0);
  await bar.getByRole("button", { name: "Accept all" }).click();
  await expect(bar).toBeHidden();

  // A new note right on that link: flagged before anything is written.
  await propose(page, [note("onTop", 2860, 4000, "In the way")]);
  await expect(bar.locator(".acute-review__layout")).toContainText("1 link crosses a card");
  await bar.getByRole("button", { name: "Reject" }).click();
  await expect(bar).toBeHidden();
});
