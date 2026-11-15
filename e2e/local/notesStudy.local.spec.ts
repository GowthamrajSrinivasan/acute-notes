/**
 * Study Mode Phase 3 in the real app (`.ai/docs/study-mode-implementation-plan.md` §9, issues A and B): study answers
 * survive a reload, a card that needs review keeps its mark in the quiz after a reload, and a flashcard flip alone
 * records nothing. No AI and no network: the canvas is a distil Visualize answered locally by the scripted distiller
 * (`src/ai/fidelity/__fixtures__/knowledge/mockDistiller.ts`, as `knowledgeNotes.local.spec.ts` does), with one card
 * planted to cite nothing so it opens a review. The Notes view needs `NEXT_PUBLIC_OPENUI_NOTES=on` (`.env.development`).
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AIRequest } from "../../src/ai/types";
import { distiller, type DistillerOptions } from "../../src/ai/fidelity/__fixtures__/knowledge/mockDistiller";
import { action, openAISettings, openApp, openAskAI, waitForCanvas } from "../helpers";

const DOC = `# Caching notes

## Retries

Retries can improve reliability when the cache holds a valid result. They must stop after 3 attempts, however short the outage.

## Limits

The cache keeps at most 500 entries per tenant. Entries expire after 30 minutes. Thanks for reading.
`;
const PLANTED: DistillerOptions = { uncitedIn: /expire after/, persistent: true };

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const notes = (p: Page) => p.getByTestId("acute-notes-view");
const studyCards = (p: Page) => notes(p).locator(".acute-notes__study-grid > .acute-notes__note");

async function answerLocally(page: Page): Promise<void> {
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: AIRequest };
    const req = { ...(body.request ?? {}), task: body.request?.task ?? "", prompt: body.request?.prompt ?? "" } as AIRequest;
    return route.fulfill({ status: 200, json: { text: distiller(PLANTED)(req).text, model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
  });
}

async function connectFakeKey(page: Page) {
  const settings = await openAISettings(page);
  const row = settings.locator(".acute-ai-row").filter({ has: page.locator(".acute-ai-row__title", { hasText: /^OpenAI$/ }) });
  await row.getByRole("button", { name: "Connect key" }).click();
  const connect = page.getByRole("dialog", { name: "Connect OpenAI" });
  await connect.locator("#acute-connect-key").fill("sk-test-not-a-real-key");
  await connect.locator("#acute-connect-model").fill("test-model");
  await connect.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(connect).toBeHidden();
  await settings.getByRole("button", { name: "Close" }).click();
}

const reload = async (page: Page) => {
  await page.evaluate(() => (window as unknown as { __acuteDev: { store: { flush(): Promise<void> } } }).__acuteDev.store.flush());
  await page.reload();
  await waitForCanvas(page);
};

/**
 * Ask AI → Update from new content on `cardId` with `text`, accepted (conflicts: "Keep mine"); then a reload. Returns
 * the review bar's summary line (what the update changed).
 */
async function updateSource(page: Page, cardId: string, text: string): Promise<string> {
  await reload(page); // the Notes view covers the canvas; a reload opens on the canvas (answers are stored by now)
  await expect(notes(page)).toBeHidden();
  const surface = await openAskAI(page, cardId);
  await (await action(surface, "Update from new content")).click();
  const update = page.getByRole("dialog", { name: "Update from new content" });
  await update.getByRole("textbox").fill(text);
  await update.getByRole("button", { name: "Update", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
  const summary = (await reviewBar(page).textContent()) ?? "";
  // A change the app can't apply on its own (the mock distiller pairs cards loosely) waits for the user: keep ours.
  const conflicts = reviewBar(page).getByRole("list", { name: "Changes that need your input" }).getByRole("button", { name: "Keep mine", pressed: false });
  while ((await conflicts.count()) > 0) await conflicts.first().click();
  await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(reviewBar(page)).toBeHidden();
  await reload(page);
  return summary;
}

async function openStudy(page: Page, kind?: "Quiz" | "Weak" | "Flashcards") {
  if (!(await notes(page).isVisible())) await page.getByTestId("toolbar-acute-notes").click();
  await expect(notes(page)).toBeVisible();
  await notes(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Study" }).click();
  if (kind) await notes(page).getByRole("group", { name: "Study mode" }).getByRole("button", { name: kind }).click();
}

test.describe("Study history in the Notes view (Phase 3, no AI)", () => {
  test.describe.configure({ mode: "serial" });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await openApp(page);
    await answerLocally(page);
    await connectFakeKey(page);
    expect(await page.evaluate(() => (window as unknown as { __acuteDev: { setNoteModel(m: string): Promise<string> } }).__acuteDev.setNoteModel("distil"))).toBe("distil");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(DOC);
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("a flashcard flip records nothing, even across a reload (issue B)", async () => {
    await openStudy(page, "Flashcards");
    const first = studyCards(page).first();
    for (let i = 0; i < 3; i++) await first.locator(".openui-flashcard__face").click();
    await expect(first.getByRole("button", { name: "Got it" })).toBeVisible(); // revealed, offered, not pressed
    await reload(page);
    await openStudy(page, "Weak");
    await expect(notes(page).getByTestId("acute-notes-weak")).toContainText("Nothing weak yet");
    await expect(notes(page).getByTestId("acute-notes-study-badges")).toHaveCount(0);
  });

  test("answer a quiz card wrong, reload: the concept is still weak", async () => {
    await openStudy(page, "Quiz");
    // Cards without a review mark; pick each one's first choice until one is wrong (choice order is deterministic, and
    // only the first pick per card counts, so a right first pick can't be turned into a miss).
    const cards = studyCards(page).filter({ hasNot: page.getByTestId("acute-notes-study-review") }).filter({ has: page.locator(".openui-quiz") });
    const n = await cards.count();
    let anchor: string | null = null;
    for (let i = 0; i < n && !anchor; i++) {
      const card = cards.nth(i);
      await card.locator(".openui-quiz__choice").first().click();
      if ((await card.locator(".openui-quiz").getAttribute("data-state")) === "incorrect") anchor = await card.getAttribute("data-note-anchor");
    }
    expect(anchor, "some unflagged card's first choice is a wrong one").not.toBeNull();
    await expect(notes(page).locator(`[data-note-anchor="${anchor}"]`).getByTestId("acute-notes-study-badges")).toHaveText("Weak");

    await reload(page);
    await openStudy(page, "Quiz");
    await expect(notes(page).locator(`[data-note-anchor="${anchor}"]`).getByTestId("acute-notes-study-badges")).toHaveText("Weak");
    await notes(page).getByRole("group", { name: "Study mode" }).getByRole("button", { name: "Weak" }).click();
    await expect(notes(page).getByTestId("acute-notes-weak-row")).toHaveCount(1);
  });

  test("a card that needs review: its quiz card shows the mark after a reload (issue A)", async () => {
    await openStudy(page, "Quiz");
    const flagged = studyCards(page).filter({ has: page.getByTestId("acute-notes-study-review") }).filter({ has: page.locator(".openui-quiz") });
    await expect(flagged.first()).toBeVisible();
    const anchor = await flagged.first().getAttribute("data-note-anchor");
    await reload(page);
    await openStudy(page, "Quiz");
    const again = notes(page).locator(`[data-note-anchor="${anchor}"]`);
    await expect(again.locator(".openui-quiz")).toBeVisible();
    await expect(again.getByTestId("acute-notes-study-review")).toContainText("Needs review");
  });

  test("regenerate a section through an update: a studied card in it keeps its history (plan §9 Phase 3)", async () => {
    // Miss the "500 entries" card by self-grade (deterministic, unlike a quiz's first choice).
    await openStudy(page, "Flashcards");
    const target = studyCards(page).filter({ hasText: /at most 500/ }).first();
    await expect(target).toBeVisible();
    await target.locator(".openui-flashcard__face").click();
    await target.getByRole("button", { name: "Missed it" }).click();
    await expect(target.getByTestId("acute-notes-study-badges")).toHaveText("Weak");
    const anchor = (await target.getAttribute("data-note-anchor"))!;

    // Another sentence of the same section changes ("30 minutes"), so the Limits section is regenerated (its other cards
    // are replaced); this card's own passage doesn't change.
    const summary = await updateSource(page, anchor, DOC.replace("30 minutes", "45 minutes"));
    expect(summary, "the update changed the section's cards").toMatch(/added|removed|changed|needs your input/);
    await openStudy(page, "Flashcards");
    // Whether the card is kept at v1 or re-linked to v2 is the update engine's choice; either way its passage didn't
    // change, so its concept and history are the same and still count.
    const after = studyCards(page).filter({ hasText: /at most 500/ }).first();
    await expect(after.getByTestId("acute-notes-study-badges")).toHaveText("Weak");
    await notes(page).getByRole("group", { name: "Study mode" }).getByRole("button", { name: "Weak" }).click();
    await expect(notes(page).getByTestId("acute-notes-weak-row").filter({ hasText: /at most 500/ })).toHaveCount(1);
  });

  test("Clear study history: confirmed, it empties the Weak list, and it stays empty after a reload", async () => {
    await openStudy(page, "Weak");
    await expect(notes(page).getByTestId("acute-notes-weak-row").first()).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await notes(page).getByTestId("acute-notes-clear-study").click();
    await expect(notes(page).getByTestId("acute-notes-weak")).toContainText("Nothing weak yet");
    await reload(page);
    await openStudy(page, "Weak");
    await expect(notes(page).getByTestId("acute-notes-weak")).toContainText("Nothing weak yet");
    await expect(notes(page).getByTestId("acute-notes-clear-study")).toHaveCount(0);
  });
});
