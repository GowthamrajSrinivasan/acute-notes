/**
 * Updating notes from ChatGPT chats, from the AI chat panel (✨ Ask AI), in the real app with no AI connection and no AI request: the panel offers
 * "Update from ChatGPT chats" for notes made by Visualize; it opens the Visualize dialog on "Merge into existing notes" with those notes chosen and the
 * "From shared chats" panel already open; pasting a share link and merging adds the chat's new passage to the topic it is about, keeps the notes'
 * own text once, and leaves a repeated passage out. (The import route is answered by the test; the decision model's conflict handling is covered
 * by `src/ai/ingest/chatUpdate.test.ts`.)
 */
import { expect, test, type Page } from "@playwright/test";
import { action, openApp, openAskAI, setAIMode } from "../helpers";

const CHAT_ID = "6ac75678-3333-4333-8333-333333333333";
const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

const turn = (id: string, index: number, role: "user" | "assistant", markdown: string) => ({ id, index, role, markdown, hash: `h-${id}-${markdown.length}` });
const TRANSCRIPT = {
  provider: "chatgpt",
  url: `https://chatgpt.com/share/${CHAT_ID}`,
  shareId: CHAT_ID,
  conversationId: "conv-e2e",
  title: "Launch chat",
  turns: [
    turn("m1", 0, "user", "What can go wrong with the launch?"),
    // About a topic the notes already have ("Risks"), with one sentence the notes already say and one they do not.
    turn("m2", 1, "assistant", "## Risks\n\nThe gateway may time out under load.\n\nRetries back off exponentially."),
  ],
};

const NOTES = "# Launch plan\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway may time out under load.\n\n## Rollback\n\nFlip the flag off and drain the queue.\n";

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

test("Update from ChatGPT chats, from Ask AI: the dialog opens on those notes with the chats panel open, and the merge keeps the notes and adds the new passage once", async ({ page }) => {
  await page.route("**/api/import/chat-share", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ transcript: TRANSCRIPT }) });
  });
  await openApp(page);
  await setAIMode(page, "On");

  // Notes made by Visualize (no AI connection: the local tier), accepted.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").first().fill(NOTES);
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  await expect.poll(async () => (await blocksMentioning(page, "gateway")).length).toBe(1);
  const notesBlock = (await blocksMentioning(page, "gateway"))[0]!;
  const sourceId = (await link(page, notesBlock))!.contentSourceId;

  // The AI chat panel offers the update for those notes.
  const surface = await openAskAI(page, notesBlock);
  await (await action(surface, "Update from ChatGPT chats")).click();

  // The dialog is on "Merge into existing notes", with the notes chosen and the shared chats panel open.
  const dialog = visualizeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Merge into existing notes/ })).toBeChecked();
  await expect(dialog.getByText("Launch plan")).toBeVisible();
  await expect(dialog.locator("details.acute-shared-chats")).toHaveJSProperty("open", true);

  await dialog.getByRole("textbox", { name: "Share links" }).fill(`https://chatgpt.com/share/${CHAT_ID}`);
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByText("2 of 2 turns will be analysed")).toBeVisible();
  await dialog.getByRole("button", { name: "Use this chat" }).click();
  await dialog.getByRole("button", { name: "Merge", exact: true }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  // The notes' own text is still there once, the chat's new passage joined its topic, and the passage the notes already had was left out.
  await expect.poll(async () => (await blocksMentioning(page, "Retries back off")).length).toBe(1);
  expect(await blocksMentioning(page, "gateway")).toHaveLength(1);
  const text = (await sourceText(page, sourceId))!;
  expect(text.split("The gateway may time out under load.").length - 1).toBe(1);
  expect(text.split("Retries back off exponentially.").length - 1).toBe(1);
  expect(text).toContain("Flip the flag off and drain the queue.");
  expect(await link(page, (await blocksMentioning(page, "Retries back off"))[0]!)).toMatchObject({ contentSourceId: sourceId });
});
