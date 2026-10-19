/**
 * One text system: free text pasted from Excalidraw's clipboard becomes Acute
 * text items (formattable per word) as it arrives, keeping its style, group and
 * arrow bindings; shape labels stay native. The paste and its conversion are
 * one undo step.
 */
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp } from "../helpers";

const base = {
  angle: 0,
  strokeColor: "#e03131",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  updated: 1,
  link: null,
  locked: false,
  frameId: null,
  roundness: null,
};
const text = { type: "text", fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top", lineHeight: 1.25, autoResize: true, containerId: null };

const CLIPBOARD = {
  type: "excalidraw/clipboard",
  files: {},
  elements: [
    { ...base, ...text, id: "t1", x: 0, y: 0, width: 200, height: 25, text: "hello pasted world", originalText: "hello pasted world", groupIds: ["g1"], boundElements: [{ id: "a1", type: "arrow" }] },
    { ...base, ...text, id: "t2", x: 0, y: 60, width: 200, height: 50, text: "line one\nline two", originalText: "line one\nline two", groupIds: ["g1"], boundElements: null },
    { ...base, id: "r1", type: "rectangle", x: 300, y: 0, width: 160, height: 80, groupIds: [], boundElements: [{ id: "l1", type: "text" }, { id: "a1", type: "arrow" }] },
    { ...base, ...text, id: "l1", x: 320, y: 25, width: 120, height: 25, text: "label", originalText: "label", textAlign: "center", verticalAlign: "middle", containerId: "r1", groupIds: [], boundElements: null },
    {
      ...base,
      id: "a1",
      type: "arrow",
      x: 200,
      y: 12,
      width: 100,
      height: 0,
      points: [[0, 0], [100, 0]],
      groupIds: [],
      boundElements: null,
      startBinding: { elementId: "t1", focus: 0, gap: 4 },
      endBinding: { elementId: "r1", focus: 0, gap: 4 },
      startArrowhead: null,
      endArrowhead: "arrow",
      elbowed: false,
    },
  ],
};

function pasteExcalidrawClipboard(page: Page): Promise<void> {
  return page.evaluate((payload) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", JSON.stringify(payload));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, CLIPBOARD);
}

test("free text pasted from Excalidraw becomes Acute text; labels stay native", async ({ page }) => {
  await openApp(page);
  await page.mouse.click(700, 450);
  const before = (await elements(page)).length;
  await pasteExcalidrawClipboard(page);

  await expect.poll(async () => (await elements(page)).filter((e) => e.acute?.frame === "none").length).toBe(2);
  const els = await elements(page);
  expect(els.filter((e) => e.type === "text" && !e.containerId)).toEqual([]);
  expect(els.filter((e) => e.type === "text" && e.containerId).map((e) => e.text)).toEqual(["label"]);

  const detail = await page.evaluate(() => {
    type El = { id: string; type: string; groupIds: string[]; startBinding?: { elementId: string } | null; customData?: { acute?: { documentId: string; style: { textColor?: string } } } };
    const dev = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: { content: string }[] } | null } } }).__acuteDev;
    const scene = dev.api.getSceneElements();
    const items = scene.filter((e) => e.customData?.acute);
    const arrow = scene.find((e) => e.type === "arrow");
    return {
      texts: items.map((e) => dev.store.get(e.customData!.acute!.documentId)?.snapshot.map((b) => b.content)),
      colors: items.map((e) => e.customData!.acute!.style.textColor),
      sameGroup: items.every((e) => e.groupIds.length === 1 && e.groupIds[0] === items[0]!.groupIds[0]),
      arrowStartIsItem: items.some((e) => e.id === arrow?.startBinding?.elementId),
    };
  });
  expect(detail.texts).toEqual([["hello pasted world"], ["line one", "line two"]]);
  expect(detail.colors).toEqual(["#e03131", "#e03131"]);
  expect(detail.sameGroup).toBe(true);
  expect(detail.arrowStartIsItem).toBe(true);

  // Paste + conversion are one step: one undo removes everything pasted.
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await elements(page)).length).toBe(before);
});

test("⋮ → Convert all text to rich text converts an older canvas's free text in one undo step", async ({ page }) => {
  await openApp(page);
  // Seeded native text stays native (as on a canvas made before the intake existed).
  await page.evaluate(() => (window as unknown as { __acuteDev: { addNativeText(n: number): Promise<number> } }).__acuteDev.addNativeText(3));
  const nativeFree = async () => (await elements(page)).filter((e) => e.type === "text" && !e.containerId).length;
  const textItems = async () => (await elements(page)).filter((e) => e.acute?.frame === "none").length;
  expect(await nativeFree()).toBe(3);

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Convert all text to rich text" }).click();
  await expect.poll(nativeFree).toBe(0);
  expect(await textItems()).toBe(3);
  await expect(page.getByText("Converted 3 text items to rich text")).toBeVisible();

  await page.waitForTimeout(300);
  await page.keyboard.press("Control+z");
  await expect.poll(nativeFree).toBe(3);
  expect(await textItems()).toBe(0);
});
