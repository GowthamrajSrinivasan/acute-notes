/**
 * Chat-share import C1 in the real app, no AI: the "From shared chats" panel in Visualize. The import route is
 * answered by the test (the server-side fetch of chatgpt.com is covered by `route.test.ts`), so this checks the dialog:
 * links are listed, a branch's shared turns are skipped by default, the toggle brings them back, and "Use these chats"
 * fills the paste box.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../helpers";

const PARENT_ID = "6ac75678-1111-4111-8111-111111111111";
const BRANCH_ID = "6ac75691-2222-4222-8222-222222222222";

const turn = (id: string, index: number, role: "user" | "assistant", markdown: string) => ({ id, index, role, markdown, hash: `h-${id}-${markdown.length}` });
const SHARED = [
  turn("m1", 0, "user", "Which database should the AI app builder use for version one?"),
  turn("m2", 1, "assistant", "Firestore is a good fit for v1 because it has realtime sync and simple rules."),
];
const TRANSCRIPTS: Record<string, unknown> = {
  [PARENT_ID]: { provider: "chatgpt", url: `https://chatgpt.com/share/${PARENT_ID}`, shareId: PARENT_ID, conversationId: "conv-parent", title: "AI App Builder Ecosystem", turns: SHARED },
  [BRANCH_ID]: {
    provider: "chatgpt",
    url: `https://chatgpt.com/share/${BRANCH_ID}`,
    shareId: BRANCH_ID,
    conversationId: "conv-branch",
    title: "Branch · AI App Builder Ecosystem",
    branchedFrom: { conversationId: "conv-parent", title: "AI App Builder Ecosystem", atTurnId: "m2" },
    turns: [...SHARED, turn("b3", 2, "user", "Compare Postgres on Supabase against Firestore.")],
  },
};

async function mockImportRoute(p: Page) {
  await p.route("**/api/import/chat-share", async (route) => {
    const { url } = route.request().postDataJSON() as { url: string };
    const transcript = Object.entries(TRANSCRIPTS).find(([id]) => url.includes(id))?.[1];
    await route.fulfill(
      transcript
        ? { status: 200, contentType: "application/json", body: JSON.stringify({ transcript }) }
        : { status: 404, contentType: "application/json", body: JSON.stringify({ error: "That share link doesn't exist or is no longer shared.", code: "not_found" }) },
    );
  });
}

test("shared chats: branch overlap is skipped by default, and the result fills the paste box", async ({ page }) => {
  await mockImportRoute(page);
  await openApp(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = page.getByRole("dialog", { name: "Visualize" });

  await dialog.getByText("From shared chats").click();
  await dialog.getByRole("textbox", { name: "Share links" }).fill(
    `https://chatgpt.com/share/${PARENT_ID}\nhttps://chat.openai.com/share/${PARENT_ID}\nhttps://chatgpt.com/share/${BRANCH_ID}\nhttps://chatgpt.com/share/00000000-0000-4000-8000-000000000000`,
  );
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  await expect(dialog.getByText("1 duplicate link ignored")).toBeVisible();
  await expect(dialog.getByText("2 of 2 turns will be analysed")).toBeVisible();
  await expect(dialog.getByText('1 of 3 turns will be analysed · 2 of 3 turns already in "AI App Builder Ecosystem" — skipped')).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("no longer shared");

  await dialog.getByRole("button", { name: "Use these 2 chats" }).click();
  const box = dialog.locator("textarea.acute-visualize-dialog__text").first();
  await expect(box).toHaveValue(/# AI App Builder Ecosystem[\s\S]*# Branch · AI App Builder Ecosystem[\s\S]*Compare Postgres/);
  expect((await box.inputValue()).split("Firestore is a good fit").length - 1).toBe(1);

  // With the toggle off the branch is analysed whole.
  await dialog.getByRole("checkbox", { name: "Skip content shared between branched chats" }).uncheck();
  await expect(dialog.getByText("3 of 3 turns will be analysed")).toBeVisible();
});
