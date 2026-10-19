/**
 * F42 against a real AI connection: long answers become framed sections.
 *
 * - A long ChatGPT answer (the Acute pricing discussion) is outlined once
 *   (`outline_document`), and each semantic section is generated with its
 *   kind's rules: plans scattered across the answer become one comparison
 *   table, the ASCII business-model tree becomes shapes, and so on. Every
 *   section is a frame labelled "<position> · <kind>", with its name as an XL
 *   title inside it.
 * - A short structured note never calls AI: the local tier frames it.
 * - "Update from new content" on the outlined answer regenerates only the
 *   section that changed — no new outline, no other section.
 *
 * Run only through `npm run test:e2e:ai` (asks before running); `--demo` to watch it.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, openApp, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { AI_TIMEOUT, caption, look, nothingChanged, reviewBar, updateDialog, visualizeDialog } from "../aiReview";
import { action, openAskAI } from "../helpers";

// An outline call plus one call per section: slower than one generation, so a longer budget than the suite default.
test.describe.configure({ mode: "serial", timeout: 420_000 });

const PRICING = readFileSync(new URL("./fixtures/pricingAnswer.md", import.meta.url), "utf8");
const NOTE = `# Database migration plan

## Rollout Steps

1. Take a backup
2. Run the migration
3. Verify the users table

## Risks

The database migration may lock the users table during off-peak hours.

## Owners

The platform team owns the migration; the on-call DBA approves it.
`;

let page: Page;
let aiRequests: Request[];
/** A block the long answer's Visualize created — the anchor for its "Update from new content". */
let pricingBlock = "";

const sceneIds = (p: Page) =>
  p.evaluate(() => (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string }[] } } }).__acuteDev.api.getSceneElements().map((e) => e.id));

const posts = () => aiRequests.filter((r) => r.method() === "POST").map(aiTaskOf);

type Frame = { id: string; name: string; x: number; y: number; width: number; height: number; members: number };

/** Frames on the canvas, each with its label and how many objects it holds. */
function frames(p: Page): Promise<Frame[]> {
  return p.evaluate(() => {
    type El = { id: string; type: string; name?: string | null; frameId?: string | null; x: number; y: number; width: number; height: number; isDeleted?: boolean };
    const els = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api.getSceneElements();
    return els
      .filter((e) => e.type === "frame")
      .map((f) => ({ id: f.id, name: f.name ?? "", x: f.x, y: f.y, width: f.width, height: f.height, members: els.filter((e) => e.frameId === f.id && e.type !== "text").length }));
  });
}

/** Zooms the canvas to fit everything (Shift+1), so a demo shows the whole result. */
async function fitAll(p: Page): Promise<void> {
  await p.keyboard.press("Escape");
  await p.locator(".excalidraw").click({ position: { x: 5, y: 300 } });
  await p.keyboard.press("Shift+1");
}

async function visualize(p: Page, text: string): Promise<void> {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(p).getByRole("textbox").fill(text);
  aiRequests.length = 0;
  await visualizeDialog(p).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(reviewBar(p)).toBeVisible({ timeout: AI_TIMEOUT });
}

async function accept(p: Page): Promise<void> {
  await reviewBar(p).getByRole("button", { name: "Accept all" }).click();
  await expect(p.getByRole("status", { name: "AI changes" })).toContainText("Added");
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  aiRequests = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test("a short structured note stays local: framed sections, steps as a flow, no AI call", async () => {
  await caption(page, "Case 1 — a short structured note", "No AI call: the local tier frames each section; numbered steps become a flow");
  await visualize(page, NOTE);
  expect(posts()).toEqual([]);
  await look(page);
  await accept(page);
  await fitAll(page);
  const fs = await frames(page);
  expect(fs.map((f) => f.name)).toEqual(["1 · Section", "2 · Section", "3 · Section"]);
  for (const f of fs) expect(f.members, f.name).toBeGreaterThan(1); // its XL title + content
  await look(page);
  // Clear the canvas for the next case, so the demo shows one result at a time.
  await page.evaluate(() => (window as unknown as { __acuteDev: { api: { updateScene(s: { elements: unknown[] }): void } } }).__acuteDev.api.updateScene({ elements: [] }));
  await expect.poll(() => sceneIds(page)).toEqual([]);
});

test("a long ChatGPT answer is outlined once, then built section by section", async () => {
  await caption(page, "Case 2 — a long ChatGPT answer (Acute pricing)", "Outline the whole answer, then generate each section with its kind's rules");
  const before = new Set(await sceneIds(page));
  await visualize(page, PRICING);
  const tasks = posts();
  expect(tasks[0]).toBe("outline_document");
  expect(tasks).not.toContain("select_template");
  expect(tasks.filter((t) => t === "generate_visual_plan").length).toBeGreaterThanOrEqual(2);
  await expect(reviewBar(page)).toContainText(/\d+ sections/);
  await look(page);
  await accept(page);
  await fitAll(page);
  pricingBlock = await page.evaluate((known) => {
    type El = { id: string; customData?: { acute?: { kind?: string } } };
    const els = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api.getSceneElements();
    return els.find((e) => !known.includes(e.id) && e.customData?.acute?.kind === "rich-block")?.id ?? "";
  }, [...before]);
  expect(pricingBlock).not.toBe("");

  const fs = await frames(page);
  test.info().annotations.push({ type: "frames", description: fs.map((f) => `${f.name} (${f.members})`).join(", ") });
  expect(fs.length).toBeGreaterThanOrEqual(3);
  // Labels say position and kind; never the section's own title.
  for (const [i, f] of fs.entries()) expect(f.name).toMatch(new RegExp(`^${i + 1} · (Comparison|Structure|Flow|Overview|Decision|Metrics|Supporting detail|Notes)$`));
  // Plans described in several places end up in one comparison: a table block exists.
  const tables = await page.evaluate(() => {
    type El = { customData?: { acute?: { blockType?: string } } };
    return (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api.getSceneElements().filter((e) => e.customData?.acute?.blockType === "table").length;
  });
  expect(tables).toBeGreaterThanOrEqual(1);
  await caption(page, "Case 2 — result", fs.map((f) => f.name).join("   ·   "));
  await look(page);
  await look(page);
});

test("Update from new content regenerates only the section that changed", async () => {
  await caption(page, "Case 3 — edit one section and update", "Only that section is re-analysed: no new outline, no other section");
  const surface = await openAskAI(page, pricingBlock);
  await (await action(surface, "Update from new content")).click();
  await updateDialog(page).getByRole("textbox").fill(PRICING.replace("median, P90 and P95 cost per user", "median, P90, P95 and P99 cost per user"));
  aiRequests.length = 0;
  await updateDialog(page).getByRole("button", { name: "Update", exact: true }).click();
  await expect(reviewBar(page).or(nothingChanged(page))).toBeVisible({ timeout: AI_TIMEOUT });
  const tasks = posts();
  test.info().annotations.push({ type: "update calls", description: tasks.join(", ") });
  expect(tasks).not.toContain("outline_document");
  expect(tasks.filter((t) => t === "generate_visual_plan")).toHaveLength(1);
  await look(page);
  if (await reviewBar(page).isVisible()) {
    await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
    await expect(reviewBar(page)).toBeHidden();
  }
  await look(page);
});
