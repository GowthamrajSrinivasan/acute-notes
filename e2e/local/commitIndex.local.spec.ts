/**
 * Stage 4a–4b in the real app, local tier only (no AI connection, AI mode on so the live index runs):
 * - an accepted set is one committed revision with one check job (awaiting the checker, Stage 4d), and the index holds
 *   it, verified; a double-clicked Accept commits once;
 * - a rejected proposal never reaches the index;
 * - a manual edit, a deletion, undo and redo keep the index in sync, verified each time;
 * - a simulated index failure shows the stale state; repeated failures end in "couldn't be rebuilt" with Retry, and
 *   Retry recovers — the accepted content is untouched throughout.
 */
import { expect, test, type Page } from "@playwright/test";
import { openApp, undo } from "../helpers";

const NOTES = ["# Gateway", "", "## Limits", "", "Retries happen five times.", "", "## Owners", "", "The payments team owns the gateway.", ""].join("\n");

type Dev = {
  api: { getSceneElements(): { id: string; customData?: { acute?: { documentId?: string } } }[]; getSceneElementsIncludingDeleted(): { id: string; isDeleted?: boolean }[]; updateScene(s: unknown): void };
  store: { get(id: string): { snapshot: unknown } | null; update(id: string, patch: unknown): void };
  history: { undo(): void; redo(): void };
  failIndex(n?: number): void;
  indexState(): { state: string; reason?: string };
  indexTexts(): string[] | null;
  verifyIndex(): { state: string };
  commits(): { id: string; operationId: string; touched: string[]; check: { id: string; status: string; attempts?: number } }[];
};
const dev = <T,>(p: Page, fn: (d: Dev, arg: string) => T, arg = "") => p.evaluate(({ src, arg }) => new Function("d", "arg", `return (${src})(d, arg)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, arg) as T, { src: fn.toString(), arg });

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const badge = (p: Page) => p.getByRole("status", { name: "Search index status" });
const indexed = (p: Page) => dev(p, (d) => (d.indexTexts() ?? []).join("\n"));

/** The block element whose document mentions `needle`. */
const blockWith = (p: Page, needle: string) =>
  dev(p, (d, n) => d.api.getSceneElements().find((el) => JSON.stringify(d.store.get(el.customData?.acute?.documentId ?? "")?.snapshot ?? "").includes(n))?.id ?? null, needle);
/** A manual edit: replaces text in the block's document, as typing would. */
const editBlock = (p: Page, id: string, from: string, to: string) =>
  dev(
    p,
    (d, arg) => {
      const [id, from, to] = JSON.parse(arg) as [string, string, string];
      const docId = d.api.getSceneElements().find((e) => e.id === id)!.customData!.acute!.documentId!;
      d.store.update(docId, { snapshot: JSON.parse(JSON.stringify(d.store.get(docId)!.snapshot).split(from).join(to)) });
    },
    JSON.stringify([id, from, to]),
  );

async function proposeNotes(p: Page, text: string) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(p).getByRole("textbox").first().fill(text);
  const asNew = visualizeDialog(p).getByRole("radio", { name: "Add as new notes" });
  if (await asNew.isVisible()) await asNew.check();
  await visualizeDialog(p).getByRole("button", { name: "Visualize", exact: true }).click();
  // No AI connection here: take the local structure when asked.
  const local = p.getByRole("button", { name: "Use local structure instead" });
  await expect(reviewBar(p).or(local)).toBeVisible();
  if (await local.isVisible()) await local.click();
  await expect(reviewBar(p)).toBeVisible();
}

test.describe.configure({ mode: "serial" });
let page: Page;

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  await openApp(page);
});
test.afterAll(async () => {
  await page?.context().close();
});

test("1. an accepted set is one revision with one check job, indexed and verified; a double-clicked Accept commits once", async () => {
  await proposeNotes(page, NOTES);
  // Before accepting: the proposal is not in the index.
  expect(await indexed(page)).not.toContain("Retries happen five times.");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).dblclick();
  await expect(reviewBar(page)).toBeHidden();
  await page.keyboard.press("Escape"); // the second click lands on the canvas once the bar is gone
  const commits = await dev(page, (d) => d.commits());
  expect(commits).toHaveLength(1);
  // One job, on its revision; the consistency check (Stage 4e) runs it to done once the index is fresh.
  expect(commits[0]!.check.id).toBe(`check:${commits[0]!.id}`);
  await expect.poll(() => dev(page, (d) => d.commits()[0]!.check.status)).toBe("done");
  expect(commits[0]!.touched.length).toBeGreaterThan(0);
  expect(await dev(page, (d) => d.indexState().state)).toBe("fresh");
  expect(await indexed(page)).toContain("Retries happen five times.");
  expect(await dev(page, (d) => d.verifyIndex().state)).toBe("fresh");
});

test("2. a rejected proposal never reaches the index, and commits nothing", async () => {
  await proposeNotes(page, "# Rollout\n\nOne region goes first.\n");
  expect(await indexed(page)).not.toContain("One region goes first.");
  await reviewBar(page).getByRole("button", { name: "Reject" }).click();
  await expect(reviewBar(page)).toBeHidden();
  expect(await dev(page, (d) => d.verifyIndex().state)).toBe("fresh");
  expect(await indexed(page)).not.toContain("One region goes first.");
  expect(await dev(page, (d) => d.commits().length)).toBe(1);
});

test("3. a manual edit, a deletion, undo and redo keep the index in sync", async () => {
  const id = (await blockWith(page, "Retries happen five times."))!;
  await editBlock(page, id, "five times", "three times");
  await expect.poll(() => indexed(page)).toContain("Retries happen three times.");
  expect(await dev(page, (d) => d.verifyIndex().state)).toBe("fresh");

  await dev(
    page,
    (d, id) => d.api.updateScene({ elements: d.api.getSceneElementsIncludingDeleted().map((e) => (e.id === id ? { ...e, isDeleted: true, version: ((e as { version?: number }).version ?? 1) + 1 } : e)) }),
    id,
  );
  await expect.poll(() => indexed(page)).not.toContain("Retries happen three times.");
  expect(await dev(page, (d) => d.verifyIndex().state)).toBe("fresh");

  await undo(page);
  await expect.poll(() => indexed(page)).toContain("Retries happen");
  expect(await dev(page, (d) => d.verifyIndex().state)).toBe("fresh");
  await dev(page, (d) => d.history.redo());
  expect(await dev(page, (d) => d.verifyIndex().state)).toBe("fresh");
  await undo(page);
  expect(await dev(page, (d) => d.verifyIndex().state)).toBe("fresh");
});

test("4. a simulated index failure: visible stale state, failed after retries, Retry recovers; content untouched", async ({}, info) => {
  const id = (await blockWith(page, "The payments team owns the gateway."))!;
  // Every work unit fails for now: the edit can't be indexed, the rebuilds fail too.
  await dev(page, (d) => d.failIndex(100));
  await editBlock(page, id, "payments team", "platform team");
  await expect(badge(page)).toBeVisible();
  await page.screenshot({ path: info.outputPath("index-stale.png") });
  await expect(badge(page)).toContainText("couldn't be rebuilt", { timeout: 20_000 });
  await expect(badge(page).getByRole("button", { name: "Retry" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("index-failed.png") });
  // The content itself is as the user left it.
  expect(await blockWith(page, "The platform team owns the gateway.")).toBe(id);

  await dev(page, (d) => d.failIndex(0));
  await badge(page).getByRole("button", { name: "Retry" }).click();
  await expect(badge(page)).toBeHidden();
  expect(await dev(page, (d) => d.indexState().state)).toBe("fresh");
  expect(await indexed(page)).toContain("The platform team owns the gateway.");
});
