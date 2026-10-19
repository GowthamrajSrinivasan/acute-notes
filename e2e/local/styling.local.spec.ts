/**
 * Response styling for AI-generated objects (AI settings), table paste and
 * cell alignment, and the toolbar's architecture arrow.
 */
import { expect, test, type Page } from "@playwright/test";
import { acceptProposal, blocks, documentOf, elements, openAISettings, openApp, select } from "../helpers";

type El = {
  id: string;
  type: string;
  backgroundColor: string;
  elbowed?: boolean;
  startBinding: { elementId: string } | null;
  endBinding: { elementId: string } | null;
  customData?: { acuteRouted?: boolean; acute?: { documentId?: string } };
};

function scene(page: Page): Promise<El[]> {
  return page.evaluate(() => (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api.getSceneElements());
}

let seq = 0;
function propose(page: Page, changes: unknown[]): Promise<void> {
  const set = { operationId: `op_style_${++seq}`, title: "Visualize", metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "mock" }, changes };
  return page.evaluate((s) => void (window as unknown as { __acuteDev: { proposeChanges(s: unknown): unknown } }).__acuteDev.proposeChanges(s), set);
}

const note = (key: string, x: number, text: string) => ({
  kind: "create_block",
  key,
  blockType: "text",
  content: [{ type: "heading", props: { level: 3 }, content: text }, { type: "paragraph", content: `About ${text}.` }],
  box: { x, y: 3000, width: 280, height: 160 },
});

async function proposeAndAccept(page: Page): Promise<{ cards: El[]; arrow: El }> {
  const before = new Set((await scene(page)).map((e) => e.id));
  await propose(page, [note("a", 3000, "Retry policy"), note("b", 3500, "Idempotency"), { kind: "connect", key: "ab", from: { created: "a" }, to: { created: "b" } }]);
  await acceptProposal(page);
  const added = (await scene(page)).filter((e) => !before.has(e.id));
  return { cards: added.filter((e) => e.type === "embeddable"), arrow: added.find((e) => e.type === "arrow")! };
}

async function titleProps(page: Page, card: El): Promise<Record<string, unknown> | undefined> {
  const doc = await documentOf(page, card.customData!.acute!.documentId!);
  return doc?.snapshot[0]?.props;
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("AI titles get an orange background by default, with right-angle connectors", async ({ page }) => {
  const { cards, arrow } = await proposeAndAccept(page);
  expect(cards).toHaveLength(2);
  expect(await titleProps(page, cards[0]!)).toMatchObject({ level: 3, backgroundColor: "orange" });
  expect(cards[0]!.backgroundColor).toBe("#ffffff");
  expect(arrow).toMatchObject({ elbowed: true, customData: { acuteRouted: true } });
});

test("Response styling in AI settings changes what new AI results look like", async ({ page }) => {
  const settings = await openAISettings(page);
  await settings.getByRole("radiogroup", { name: "Title background" }).getByLabel("Blue").check({ force: true });
  await settings.getByRole("radiogroup", { name: "Title text" }).getByLabel("Red").check({ force: true });
  await settings.getByRole("radiogroup", { name: "Card background" }).getByLabel("Green").check({ force: true });
  await settings.getByRole("radiogroup", { name: "Connectors" }).getByText("Straight").click();
  await settings.getByRole("button", { name: "Close" }).click();

  const { cards, arrow } = await proposeAndAccept(page);
  expect(await titleProps(page, cards[0]!)).toMatchObject({ backgroundColor: "blue", textColor: "red" });
  expect(cards[0]!.backgroundColor).toBe("#ebfbee");
  expect(arrow.elbowed).toBe(false);
  expect(arrow.customData?.acuteRouted).toBeUndefined();
  expect(arrow.startBinding?.elementId).toBe(cards[0]!.id);
  expect(arrow.endBinding?.elementId).toBe(cards[1]!.id);

  // Reset returns to the defaults.
  const again = await openAISettings(page);
  await again.getByRole("button", { name: "Reset to defaults" }).click();
  await expect(again.getByRole("button", { name: "Reset to defaults" })).toHaveCount(0);
});

test("a title font chosen from Other joins the shown fonts and styles new AI titles", async ({ page }) => {
  const settings = await openAISettings(page);
  const fonts = settings.getByRole("radiogroup", { name: "Title font" });
  await expect(fonts.getByText("Virgil")).toHaveCount(0);
  await settings.getByRole("button", { name: "Other" }).click();
  await settings.getByRole("menu", { name: "Other fonts" }).getByRole("menuitem", { name: "Virgil" }).click();
  // Shown now (in the last place), and what it replaced moved to Other.
  await expect(fonts.locator("label.active")).toHaveText("Virgil");
  await expect(fonts.getByText("Excalifont")).toHaveCount(0);
  await settings.getByRole("button", { name: "Other" }).click();
  await expect(settings.getByRole("menuitem", { name: "Excalifont" })).toBeVisible();
  await expect(settings.getByRole("menuitem", { name: "Virgil" })).toHaveCount(0);
  // Escape closes the menu, not the dialog.
  await page.keyboard.press("Escape");
  await expect(settings.getByRole("menu", { name: "Other fonts" })).toHaveCount(0);
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: "Close" }).click();

  const { cards } = await proposeAndAccept(page);
  const doc = await documentOf(page, cards[0]!.customData!.acute!.documentId!);
  expect(doc!.snapshot[0]!.content).toEqual([{ type: "text", text: "Retry policy", styles: { fontFamily: "virgil" } }]);
  // Only the title: the body keeps the card's font.
  expect(JSON.stringify(doc!.snapshot[1]!.content)).not.toContain("fontFamily");
});

async function newTable(page: Page): Promise<{ elementId: string; documentId: string }> {
  const before = new Set((await blocks(page)).map((b) => b.id));
  await page.evaluate(() => document.querySelector<HTMLElement>(".excalidraw")?.focus());
  await page.keyboard.press("b");
  await page.getByRole("menuitem", { name: "Table" }).click();
  await expect.poll(async () => (await blocks(page)).filter((b) => !before.has(b.id)).length).toBe(1);
  const b = (await blocks(page)).find((x) => !before.has(x.id))!;
  await page.locator(".acute-block .ProseMirror td, .acute-block .ProseMirror th").first().waitFor();
  return { elementId: b.id, documentId: b.documentId };
}

type Table = { content: { rows: { cells: ({ content?: { text: string }[]; props?: { textAlignment?: string } } | string)[] }[] } };
const cellText = (c: Table["content"]["rows"][number]["cells"][number]) => (typeof c === "string" ? c : (c.content ?? []).map((n) => n.text).join(""));
async function tableOf(page: Page, documentId: string): Promise<Table["content"]> {
  return ((await documentOf(page, documentId))!.snapshot[0] as unknown as Table).content;
}

test("pasting tab-separated rows into a table fills cells and grows the table", async ({ page }) => {
  const { documentId } = await newTable(page);
  await page.locator(".acute-block .ProseMirror th, .acute-block .ProseMirror td").nth(4).click(); // row 2, column 2
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "a\tb\tc\n1\t2\t3\n4\t5\t6\n");
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await tableOf(page, documentId)).rows.map((r) => r.cells.map(cellText))).toEqual([
    ["Column 1", "Column 2", "Column 3", ""],
    ["", "a", "b", "c"],
    ["", "1", "2", "3"],
    ["", "4", "5", "6"],
  ]);
});

test("aligning text inside a table cell aligns that cell", async ({ page }) => {
  const { elementId, documentId } = await newTable(page);
  await page.locator(".acute-block .ProseMirror td").first().click();
  await page.keyboard.type("hello");
  await page.keyboard.press("Shift+Home");
  await page.locator('label[title="Center"]').first().click();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await tableOf(page, documentId)).rows[1]!.cells.map((c) => (typeof c === "string" ? "left" : (c.props?.textAlignment ?? "left")))).toEqual(["center", "left", "left"]);
  // The canvas view (not editing) shows it too.
  await select(page, elementId);
  const align = await page.evaluate(() => {
    const td = document.querySelector(".acute-block .acute-preview__table tr:nth-child(2) td");
    return td ? getComputedStyle(td).textAlign : null;
  });
  expect(align).toBe("center");
});

async function drawRect(page: Page, x: number, y: number): Promise<void> {
  await page.keyboard.press("r");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 120, y + 80, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

async function drawArrow(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<El> {
  const before = new Set((await scene(page)).map((e) => e.id));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await scene(page)).filter((e) => e.type === "arrow" && !before.has(e.id)).length).toBe(1);
  await page.waitForTimeout(300);
  return (await scene(page)).find((e) => e.type === "arrow" && !before.has(e.id))!;
}

test("the arrow dropdown switches between Excalidraw's arrow and the architecture arrow", async ({ page }) => {
  await page.evaluate(() => document.querySelector<HTMLElement>(".excalidraw")?.focus());
  await drawRect(page, 300, 250);
  await drawRect(page, 700, 450);
  const rects = (await elements(page)).filter((e) => e.type === "rectangle");
  expect(rects).toHaveLength(2);

  await page.getByTestId("toolbar-acute-arrow-mode").click();
  await page.getByRole("menuitemradio", { name: /Architecture arrow/ }).click();
  const routed = await drawArrow(page, { x: 360, y: 290 }, { x: 760, y: 490 });
  expect(routed).toMatchObject({ elbowed: true, customData: { acuteRouted: true } });
  expect(new Set([routed.startBinding?.elementId, routed.endBinding?.elementId])).toEqual(new Set(rects.map((r) => r.id)));

  await page.getByTestId("toolbar-acute-arrow-mode").click();
  await page.getByRole("menuitemradio", { name: /^Arrow/ }).click();
  const plain = await drawArrow(page, { x: 380, y: 300 }, { x: 740, y: 480 });
  expect(plain.elbowed).toBeFalsy();
  expect(plain.customData?.acuteRouted).toBeUndefined();
});
