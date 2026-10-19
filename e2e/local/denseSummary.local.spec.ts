/**
 * Content fidelity Wave D (indicator budget): a dense block is pointed out by a quiet dot, and all of them by one
 * "N dense blocks · Review · Dismiss all" chip — not an orange pill per block. No AI: the local tier visualizes a
 * table whose cell is too long to read in place.
 */
import { expect, test } from "@playwright/test";
import { createDemoCanvas, openApp } from "../helpers";

const long = "This cell carries a whole paragraph of explanation, far more than a table cell can show well. ".repeat(5);
const TABLE = `# Checks\n\n| Check | What it does |\n|---|---|\n| Scope | ${long} |\n| Window | Short. |\n`;

test("a dense block gets a dot and one summary chip; Dismiss all clears them", async ({ page }) => {
  await openApp(page);
  await createDemoCanvas(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = page.getByRole("dialog", { name: "Visualize" });
  await dialog.getByRole("textbox").fill(TABLE);
  await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
  const bar = page.getByRole("region", { name: "AI changes to review" });
  await bar.getByRole("button", { name: "Accept all" }).click();

  const summary = page.getByRole("status", { name: "Dense blocks summary" });
  await expect(summary).toContainText("1 dense block");
  const dot = page.locator(".acute-dense-marker");
  await expect(dot).toHaveCount(1);
  await expect(dot).toHaveAttribute("aria-label", /^Dense: /);
  // A dot, not a labelled pill.
  await expect(dot).toHaveText("");
  // One AI marker per object: the dense block shows its dense dot, not also the green "added" one; the other added
  // objects keep theirs.
  const denseId = await dot.getAttribute("data-element-id");
  await expect(page.locator(`.acute-ai-marker[data-element-id="${denseId}"]`)).toHaveCount(0);
  await expect(page.locator(".acute-ai-marker").first()).toBeVisible();
  if (process.env.ACUTE_SHOT) await page.screenshot({ path: process.env.ACUTE_SHOT });

  // Review walks through it; the chip gives way to the walk-through bar. With reduced motion asked for, the camera
  // jumps to the block instead of gliding (Wave D): where it is right after the click is where it stays.
  await page.emulateMedia({ reducedMotion: "reduce" });
  const scroll = () => page.evaluate(() => {
    const s = (window as unknown as { __acuteDev: { api: { getAppState(): { scrollX: number; scrollY: number; zoom: { value: number } } } } }).__acuteDev.api.getAppState();
    return [s.scrollX, s.scrollY, s.zoom.value].map((v) => Math.round(v));
  });
  await page.evaluate(() => (window as unknown as { __acuteDev: { api: { updateScene(s: object): void } } }).__acuteDev.api.updateScene({ appState: { scrollX: 4000, scrollY: 4000 } }));
  // Click, then sample the camera every 25 ms for half a second, in the page: a glide passes through positions
  // between the start and the end; a jump shows only the two.
  const positions = await page.evaluate(async () => {
    const api = (window as unknown as { __acuteDev: { api: { getAppState(): { scrollX: number; scrollY: number } } } }).__acuteDev.api;
    const button = [...document.querySelectorAll('[aria-label="Dense blocks summary"] button')].find((b) => b.textContent === "Review") as HTMLButtonElement;
    const seen = new Set<string>();
    button.click();
    for (let i = 0; i < 20; i++) {
      const s = api.getAppState();
      seen.add(`${Math.round(s.scrollX)},${Math.round(s.scrollY)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
    return [...seen];
  });
  await expect(page.getByRole("status", { name: "Dense blocks", exact: true })).toContainText("Dense block 1 of 1");
  expect(positions.length).toBeLessThanOrEqual(2);
  expect(await scroll()).not.toEqual([4000, 4000, expect.any(Number)]); // it did move to the block
  await expect(summary).toHaveCount(0);
  await page.getByRole("status", { name: "Dense blocks", exact: true }).getByRole("button", { name: "Done" }).click();

  await summary.getByRole("button", { name: "Dismiss all" }).click();
  await expect(summary).toHaveCount(0);
  await expect(dot).toHaveCount(0);
});
