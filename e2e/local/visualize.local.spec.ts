/**
 * F31 in the real app, without AI: the local tier alone (structured content
 * needs no provider at all — the acceptance criterion this whole suite is
 * built around), the dialog's own mechanics, all three entry points, the
 * large-paste hint, and the error states that don't need a real AI call
 * (no provider configured, content too large).
 */
import { expect, test, type Page } from "@playwright/test";
import { action, blockByTitle, createDemoCanvas, elements, openApp, openAskAI, pasteText, setAIMode, undo } from "../helpers";

const dialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const hint = (p: Page) => p.getByRole("status").filter({ hasText: "Visualize this?" });
const running = (p: Page) => p.getByRole("status", { name: "Visualize" });

async function openGlobalMenu(p: Page) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await expect(dialog(p)).toBeVisible();
}

test.describe.configure({ mode: "serial" });

let page: Page;

test.beforeAll(async ({ browser }) => {
  // The paste-hint tests use the clipboard (`pasteText`), which Chromium only allows scripted access to once granted.
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  page = await context.newPage();
  await openApp(page);
  await createDemoCanvas(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test.afterEach(async () => {
  if (await dialog(page).isVisible()) await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  if (await hint(page).isVisible()) await hint(page).getByRole("button", { name: "Dismiss" }).click();
});

test("the global ⋮ menu opens Visualize empty; Escape and the backdrop both close it", async () => {
  await openGlobalMenu(page);
  await expect(dialog(page).getByRole("textbox")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();

  await openGlobalMenu(page);
  await page.mouse.click(20, 20); // the backdrop, not the dialog card
  await expect(dialog(page)).toBeHidden();
});

test("explicit structure visualizes via the local tier alone — no AI connection needed", async () => {
  await openGlobalMenu(page);
  await dialog(page).getByRole("textbox").fill("# Launch\n\n- [ ] Ship the flag\n- [ ] Notify support\n");
  const before = new Set((await elements(page)).map((e) => e.id));

  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  const bar = page.getByRole("region", { name: "AI changes to review" });
  await expect(bar).toContainText("Visualize");
  await expect(bar).toContainText("blocks");
  expect((await elements(page)).length).toBe(before.size); // still only a preview

  await bar.getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added");
  expect((await elements(page)).length).toBeGreaterThan(before.size);
  await undo(page);
  expect((await elements(page)).length).toBe(before.size);
});

test("unstructured prose with no AI connection offers local structure instead of failing outright", async () => {
  await openGlobalMenu(page);
  await dialog(page)
    .getByRole("textbox")
    .fill("The gateway times out under load, customers retry, and some get charged twice. We suspect the queue design.");
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();

  await expect(running(page)).toContainText("No AI connection is configured.");
  await expect(running(page).getByRole("button", { name: "AI Settings" })).toBeVisible();
  const before = new Set((await elements(page)).map((e) => e.id));
  await running(page).getByRole("button", { name: "Use local structure instead" }).click();

  const bar = page.getByRole("region", { name: "AI changes to review" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Reject" }).click();
  expect((await elements(page)).length).toBe(before.size);
});

test("forcing a template always goes through AI, even for content the local tier would already handle", async () => {
  await openGlobalMenu(page);
  await dialog(page).getByRole("textbox").fill("# Launch\n\n- [ ] Ship the flag\n");
  await dialog(page).getByRole("radiogroup", { name: "Template" }).locator(`input[value="architecture"]`).check();
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  // The override is honoured: even though this content is locally sufficient, forcing a template requires AI.
  await expect(running(page)).toContainText("No AI connection is configured.");
  await expect(running(page).getByRole("button", { name: "Use local structure instead" })).toBeVisible();
  await running(page).getByRole("button", { name: "Dismiss" }).click();
});

test("content over the size limit is refused with a specific message, no local/settings offer", async () => {
  await openGlobalMenu(page);
  await page.evaluate(() => {
    const el = document.querySelector(".acute-visualize-dialog__text") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(el, "x".repeat(200_001));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(running(page)).toContainText("the limit is 200,000");
  await expect(running(page).getByRole("button", { name: "Use local structure instead" })).toHaveCount(0);
  await expect(running(page).getByRole("button", { name: "AI Settings" })).toHaveCount(0);
  await running(page).getByRole("button", { name: "Dismiss" }).click();
});

test("Ask AI → Visualize on a selected block pre-fills its content and labels the result", async () => {
  const todo = await blockByTitle(page, "Launch checklist");
  const surface = await openAskAI(page, todo.id);
  await (await action(surface, "Visualize")).click();

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("textbox")).toContainText("Write the retry RFC");
  const before = new Set((await elements(page)).map((e) => e.id));
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  const bar = page.getByRole("region", { name: "AI changes to review" });
  await expect(bar).toContainText("Visualize: Launch checklist");
  await bar.getByRole("button", { name: "Reject" }).click();
  expect((await elements(page)).length).toBe(before.size);
});

test("the template picker is a card per template, Auto first; choosing one checks only it", async () => {
  await openGlobalMenu(page);
  const picker = dialog(page).getByRole("radiogroup", { name: "Template" });
  // Auto, then one card per unit template (every template but "sectioned"; nine since Wave E added causal_map).
  await expect(picker.getByRole("radio")).toHaveCount(10);
  await expect(picker.locator('input[value="auto"]')).toBeChecked();
  await picker.getByRole("radio", { name: /^Timeline/ }).click();
  await expect(picker.locator('input[value="timeline"]')).toBeChecked();
  await expect(picker.locator('input[value="auto"]')).not.toBeChecked();
  if (process.env.ACUTE_SHOT) await dialog(page).screenshot({ path: process.env.ACUTE_SHOT });
});

test("Ask AI → Visualize with part of a block's text selected visualizes only that part", async () => {
  const id = await pasteText(page, "Alpha paragraph about the gateway.\n\nBeta paragraph about the retry queue.\n\nGamma paragraph about billing.", { x: 900, y: 600 });
  if (await hint(page).isVisible()) await hint(page).getByRole("button", { name: "Dismiss" }).click();
  const host = page.locator(`.acute-block[data-element-id="${id}"]`);
  const box = (await host.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(host.locator("[contenteditable=true]")).toBeVisible();
  await host.getByText("Beta paragraph", { exact: false }).click({ clickCount: 3 });

  await page.getByRole("button", { name: "Ask AI" }).first().click();
  const surface = page.getByRole("complementary", { name: "Ask AI" });
  await (await action(surface, "Visualize")).click();
  await expect(dialog(page)).toBeVisible();
  const text = dialog(page).getByRole("textbox");
  await expect(text).toHaveValue(/Beta paragraph about the retry queue/);
  await expect(text).not.toHaveValue(/Alpha|Gamma/);
});

test("a large paste offers the hint; opening it pre-fills Visualize, and it can be dismissed instead", async () => {
  const large = Array.from({ length: 8 }, (_, i) => `## Section ${i}\n\nSome prose that goes on a fair bit to pad this out nicely.`).join("\n\n");
  await pasteText(page, large, { x: 500, y: 300 });
  await expect(hint(page)).toBeVisible();

  await hint(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(hint(page)).toBeHidden();

  await pasteText(page, large, { x: 500, y: 550 });
  await expect(hint(page)).toBeVisible();
  await hint(page).getByRole("button", { name: /Visualize this\?/ }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("textbox")).toContainText("Section 0");
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
});

test("a short, unstructured paste shows no hint", async () => {
  await pasteText(page, "just a quick note", { x: 900, y: 700 });
  await page.waitForTimeout(300); // the hint check is async; give it a moment to (not) appear
  await expect(hint(page)).toBeHidden();
});

test("with AI mode Off, neither the paste hint nor the ⋮ menu entry appears", async () => {
  await setAIMode(page, "Off");
  const large = Array.from({ length: 8 }, (_, i) => `## Part ${i}\n\nMore prose here to make this paste count as large.`).join("\n\n");
  await pasteText(page, large, { x: 700, y: 400 });
  await page.waitForTimeout(300);
  await expect(hint(page)).toBeHidden();
  await page.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Visualize content…" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await setAIMode(page, "On");
});
