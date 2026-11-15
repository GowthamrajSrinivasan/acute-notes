/**
 * The OpenUI Notes flow a person checks by hand (`.ai/docs/openui-integration-plan.md` Phases 1–3), rehearsed in the real
 * app with no AI and no network: the paid `e2e/ai/openuiNotes.spec.ts` steps, with every `/api/ai/**` call answered here.
 *
 * - Visualize (distil) is answered by the scripted distiller (`mockDistiller.ts`), as `notesStudy.local.spec.ts` does.
 * - `generate_openui_notes` is answered with the recorded live reply for kn-02
 *   (`src/ai/openui/__fixtures__/kn-02-edge-cache-invalidation.openui.txt`), streamed as NDJSON deltas when the runtime
 *   streams it (`/api/ai/stream`), or in one piece (`/api/ai/run`).
 *
 * The Notes view needs `NEXT_PUBLIC_OPENUI_NOTES=on` (`.env.development`). Screenshots go to `test-results/openui-flow/`.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AIRequest } from "../../src/ai/types";
import { distiller } from "../../src/ai/fidelity/__fixtures__/knowledge/mockDistiller";
import { action, openAISettings, openApp, openAskAI, pasteText, select, waitForCanvas } from "../helpers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SHOTS = join(ROOT, "test-results", "openui-flow");
const SOURCE = readFileSync(join(ROOT, "evaluation", "knowledge-notes", "cases", "kn-02-edge-cache-invalidation", "source.md"), "utf8")
  .replace(/^﻿/, "")
  .replace(/\r\n?/g, "\n");
const LANG = readFileSync(join(ROOT, "src", "ai", "openui", "__fixtures__", "kn-02-edge-cache-invalidation.openui.txt"), "utf8").replace(/\r\n?/g, "\n");
const FIXTURE_CARDS = LANG.split(/^[ \t]*---[ \t]*$/m).filter((b) => b.trim()).length;

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const notes = (p: Page) => p.getByTestId("acute-notes-view");
const toolbarNotes = (p: Page) => p.getByTestId("toolbar-acute-notes");
const generated = (p: Page) => notes(p).locator(".acute-notes__generated");
const generateButton = (p: Page) => notes(p).getByRole("button", { name: /^(Generate from source|Generating…)$/ });
const sourceTab = (p: Page) => p.getByTestId("acute-source-tab");
const generatedCard = (p: Page, key: string) => generated(p).locator(`[data-note-anchor="${key}"]`);

type Dev = {
  api: {
    getSceneElements(): { id: string; type: string; isDeleted?: boolean; x: number; y: number; width: number; height: number }[];
    getAppState(): { selectedElementIds: Record<string, boolean>; scrollX: number; scrollY: number; zoom: { value: number }; width: number; height: number };
  };
  reconciliation(id: string): Promise<{ link: { contentSourceId: string; contentSourceVersion?: number; sourceUnits?: string[]; excludeFromReconciliation?: boolean } | null } | null>;
  store: { flush(): Promise<void> };
  setNoteModel(m: string): Promise<string>;
};
const dev = <T, A = string>(p: Page, fn: (d: Dev, arg: A) => Promise<T> | T, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;
const liveIds = (p: Page) => dev(p, (d) => d.api.getSceneElements().filter((e) => !e.isDeleted).map((e) => e.id));

/** What the flow asked the AI host for, by path and task. */
const calls: { path: string; task: string }[] = [];

async function answerLocally(page: Page): Promise<void> {
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const body = (route.request().postDataJSON() ?? {}) as { request?: AIRequest };
    const task = body.request?.task ?? "";
    calls.push({ path, task });
    if (task === "generate_openui_notes") {
      if (path.endsWith("/stream")) {
        // NDJSON deltas in a few pieces, then done (the stream route's wire format).
        const pieces = LANG.match(/[\s\S]{1,400}/g) ?? [LANG];
        const ndjson = [...pieces.map((delta) => JSON.stringify({ delta })), JSON.stringify({ done: true })].join("\n") + "\n";
        return route.fulfill({ status: 200, contentType: "application/x-ndjson", body: ndjson });
      }
      return route.fulfill({ status: 200, json: { text: LANG, model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
    }
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const req = { ...(body.request ?? {}), task, prompt: body.request?.prompt ?? "" } as AIRequest;
    return route.fulfill({ status: 200, json: { text: distiller()(req).text, model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
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

async function openNotes(page: Page) {
  if (!(await notes(page).isVisible())) await toolbarNotes(page).click();
  await expect(notes(page)).toBeVisible();
}

const shot = (page: Page, name: string) => page.screenshot({ path: join(SHOTS, name) });

test.describe("OpenUI Notes flow (Phases 1–3, no AI)", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  let page: Page;
  const consoleErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    mkdirSync(SHOTS, { recursive: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await openApp(page);
    await answerLocally(page);
    await connectFakeKey(page);
    expect(await dev(page, (d) => d.setNoteModel("distil"))).toBe("distil");
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("2a. on a canvas with no stored source, Generate from source is disabled and says why", async () => {
    await openNotes(page);
    await expect(notes(page)).toContainText("This canvas has no text cards yet");
    await expect(generateButton(page)).toBeDisabled();
    await expect(generateButton(page)).toHaveAttribute("title", "No stored source with passages on this canvas");
    await notes(page).getByRole("button", { name: "Canvas", exact: true }).click();
    await expect(notes(page)).toBeHidden();
  });

  test("1. Visualize a known source, then Notes: sections, index, filter, reading order; Escape and Canvas return", async () => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(SOURCE);
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();

    await expect(toolbarNotes(page)).toHaveText("Notes");
    await toolbarNotes(page).click();
    await expect(notes(page)).toBeVisible();

    const sections = notes(page).locator("section.acute-notes__section:not(.acute-notes__generated)");
    const sectionCount = await sections.count();
    expect(sectionCount, "sections from frames").toBeGreaterThan(1);
    const count = await notes(page).locator(".acute-notes__count").textContent();
    const total = await notes(page).locator(".acute-notes__note").count();
    expect(count).toContain(`${total} notes · ${sectionCount} sections`);

    // The index lists every section with its note count; a click scrolls to it.
    const toc = notes(page).getByRole("navigation", { name: "Sections" });
    await expect(toc.getByRole("button")).toHaveCount(sectionCount);
    const titles = await sections.locator(".acute-notes__section-title").allTextContents();
    const tocTitles = await toc.locator("button > span:first-child").allTextContents();
    expect(tocTitles).toEqual(titles);
    const last = sections.last();
    await toc.getByRole("button").last().click();
    await expect(last.locator(".acute-notes__note").first()).toBeInViewport();
    await shot(page, "01-notes-read.png");

    // Reading order: the first cited unit of each note, in document order, follows the source (u1, u2, …).
    const firstUnits = await notes(page)
      .locator(".acute-notes__note")
      .evaluateAll((els) => els.map((e) => e.querySelector(".openui-citation-chip")?.getAttribute("data-unit")).filter((u): u is string => !!u).map((u) => Number(u.slice(1))));
    expect(firstUnits.length).toBeGreaterThan(5);
    const inversions = firstUnits.filter((u, i) => i > 0 && u < firstUnits[i - 1]!).length;
    expect(inversions, `notes out of source order: ${firstUnits.join(",")}`).toBe(0);

    // Filter: narrows notes and the count, the index follows, clearing restores.
    const filter = notes(page).getByRole("searchbox", { name: "Filter notes" });
    await filter.fill("surrogate");
    const shown = await notes(page).locator(".acute-notes__note").count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
    await expect(notes(page).locator(".acute-notes__count")).toContainText(`${shown} of ${total}`);
    for (const t of await notes(page).locator(".openui-idea-card").allTextContents()) expect(t.toLowerCase()).toContain("surrogate");
    // Escape in a non-empty filter does not close the view (it clears the search box, as the browser does).
    await filter.press("Escape");
    await expect(notes(page)).toBeVisible();
    await filter.fill("");
    await expect(notes(page).locator(".acute-notes__note")).toHaveCount(total);

    // Escape returns to the canvas; the toggle says Notes again.
    await page.locator(".acute-notes__heading h2").click();
    await page.keyboard.press("Escape");
    await expect(notes(page)).toBeHidden();
    await expect(toolbarNotes(page)).toHaveText("Notes");
    // The header's Canvas button. (The view covers the canvas toolbar, so its own "Canvas" state can't be clicked.)
    await toolbarNotes(page).click();
    await expect(notes(page)).toBeVisible();
    await notes(page).getByRole("button", { name: "Canvas", exact: true }).click();
    await expect(notes(page)).toBeHidden();
  });

  test("2b. Generate from source: enabled with a stored source; cards stream in, long cards behind More", async () => {
    await openNotes(page);
    await expect(generateButton(page)).toBeEnabled({ timeout: 15_000 });
    await expect(generateButton(page)).toHaveAttribute("title", /Distil this canvas's latest source/);
    calls.length = 0;
    await generateButton(page).click();
    await expect(generated(page)).toHaveAttribute("data-status", "done", { timeout: 30_000 });
    const genCalls = calls.filter((c) => c.task === "generate_openui_notes");
    expect(genCalls, "exactly one generate call").toHaveLength(1);
    test.info().annotations.push({ type: "generate path", description: genCalls[0]!.path });
    await expect(generated(page).getByRole("alert")).toHaveCount(0);
    await expect(generated(page).locator(".openui-idea-card")).toHaveCount(FIXTURE_CARDS);
    await expect(generated(page).locator(".acute-notes__section-title")).toContainText("preview — not on the canvas until pinned");
    await expect(generated(page).getByTestId("acute-notes-check")).toBeVisible();
    await expect(generateButton(page)).toHaveText("Generate from source");
    await expect(generateButton(page)).toBeEnabled();

    // "More" on a card with detail (g2: TTL expiry) shows it; "Less" hides it again.
    const g2 = generatedCard(page, "g2");
    await expect(g2.locator(".openui-idea-card__detail")).toHaveCount(0);
    await g2.getByRole("button", { name: "More" }).click();
    await expect(g2.locator(".openui-idea-card__detail")).toContainText("revalidate with an ETag");
    await g2.getByRole("button", { name: "Less" }).click();
    await expect(g2.locator(".openui-idea-card__detail")).toHaveCount(0);

    const pinnable = generated(page).getByRole("button", { name: /^Pin (to canvas|\(needs review\))$/ });
    expect(await pinnable.count()).toBe(FIXTURE_CARDS);
    await generated(page).screenshot({ path: join(SHOTS, "02-generated.png") });
  });

  test("3. a citation chip expands its passage inline; Open in source opens the Source tab on those passages", async () => {
    await openNotes(page);
    // Generated card: the chip toggles the passage (text of the stored unit).
    const g2 = generatedCard(page, "g2");
    const chip = g2.locator(".openui-citation-chip").first();
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    const unit = await chip.getAttribute("data-unit");
    await expect(g2.locator(`.openui-idea-card__passage[data-unit="${unit}"]`)).not.toBeEmpty();
    await chip.click();
    await expect(g2.locator(".openui-idea-card__passage")).toHaveCount(0);

    // Canvas note: the same, then Open in source.
    const note = notes(page).locator("section.acute-notes__section:not(.acute-notes__generated) .acute-notes__note").filter({ has: page.locator(".openui-citation-chip") }).first();
    await note.scrollIntoViewIfNeeded();
    const noteChip = note.locator(".openui-citation-chip").first();
    const noteUnit = (await noteChip.getAttribute("data-unit"))!;
    await noteChip.click();
    await expect(note.locator(`.openui-idea-card__passage[data-unit="${noteUnit}"]`)).not.toBeEmpty();
    await shot(page, "03-citation-expanded.png");
    const units = await note.locator(".openui-citation-chip").evaluateAll((els) => els.map((e) => e.getAttribute("data-unit")!));
    await note.getByRole("button", { name: "Open in source" }).click();
    await expect(notes(page)).toBeHidden();
    await expect(sourceTab(page)).toBeVisible();
    await expect(sourceTab(page).getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
    const panel = sourceTab(page).locator("section.acute-source");
    for (const u of units) await expect(panel.locator(`[data-unit="${u}"]`)).toHaveClass(/is-selected/);
    await shot(page, "04-open-in-source.png");
  });

  test("3b. generated cards offer Open in source too (citations of a stored source)", async () => {
    await openNotes(page);
    const g2 = generatedCard(page, "g2");
    // Fixed 2026-11-15: a generated card opens the Source tab on its own units, through a canvas card of the same source.
    const units = await g2.locator(".openui-citation-chip").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-unit")!))]);
    expect(units.length, "g2 cites units").toBeGreaterThan(0);
    await g2.getByRole("button", { name: "Open in source" }).click();
    await expect(notes(page)).toBeHidden();
    await expect(sourceTab(page).getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
    const panel = sourceTab(page).locator("section.acute-source");
    for (const u of units) await expect(panel.locator(`[data-unit="${u}"]`)).toHaveClass(/is-selected/);
  });

  test("4. Pin to canvas: one linked card citing its units, opted out of updates; Show on canvas focuses it; one Undo removes it", async () => {
    await openNotes(page);
    const g2 = generatedCard(page, "g2");
    const cites = await g2.locator(".openui-citation-chip").evaluateAll((els) => els.map((e) => e.getAttribute("data-unit")!));
    const before = new Set(await liveIds(page));
    await g2.getByRole("button", { name: /^Pin (to canvas|\(needs review\))$/ }).click();
    // No review step: the pin is written directly (plan: one create_block, one undoable step).
    await expect(g2.getByRole("button", { name: "Show on canvas" })).toBeVisible({ timeout: 15_000 });
    await expect(reviewBar(page)).toBeHidden();
    const added = (await liveIds(page)).filter((id) => !before.has(id));
    expect(added.length, "new elements").toBeGreaterThan(0);
    const links = await Promise.all(added.map((id) => dev(page, (d, x) => d.reconciliation(x).then((r) => r?.link ?? null), id)));
    const link = links.find((l) => l?.sourceUnits?.length);
    expect(link, "the pinned card is linked to the source").toBeTruthy();
    expect([...link!.sourceUnits!].sort()).toEqual([...cites].sort());
    expect(link!.excludeFromReconciliation).toBe(true);
    const cardId = added[links.indexOf(link!)]!;

    // The pinned card also appears among the canvas notes (Notes reads the canvas).
    await expect(notes(page).locator(`[data-note-anchor="${cardId}"]`)).toHaveCount(1);
    await generated(page).screenshot({ path: join(SHOTS, "05-pinned-show-on-canvas.png") });

    await g2.getByRole("button", { name: "Show on canvas" }).click();
    await expect(notes(page)).toBeHidden();
    await expect.poll(() => dev(page, (d, id) => !!d.api.getAppState().selectedElementIds[id], cardId)).toBe(true);
    // In view: the card's box intersects the viewport (after the scroll animation).
    await expect
      .poll(() =>
        dev(
          page,
          (d, id) => {
            const el = d.api.getSceneElements().find((e) => e.id === id)!;
            const s = d.api.getAppState();
            const z = s.zoom.value;
            const x = (el.x + s.scrollX) * z;
            const y = (el.y + s.scrollY) * z;
            return x < s.width && y < s.height && x + el.width * z > 0 && y + el.height * z > 0;
          },
          cardId,
        ),
      )
      .toBe(true);
    await shot(page, "06-pinned-on-canvas.png");
    // Recorded for the report: where the pin landed (overlapping a frame or card?) and the zoom Show on canvas leaves.
    const placement = await dev(
      page,
      (d, id) => {
        const all = d.api.getSceneElements().filter((e) => !e.isDeleted) as { id: string; type: string; x: number; y: number; width: number; height: number; frameId?: string | null }[];
        const el = all.find((e) => e.id === id)!;
        const hit = (o: (typeof all)[number]) => o.id !== id && o.type !== "arrow" && el.x < o.x + o.width && o.x < el.x + el.width && el.y < o.y + o.height && o.y < el.y + el.height;
        return { zoom: Math.round(d.api.getAppState().zoom.value * 100), frameId: el.frameId ?? null, overlapsFrames: all.filter((o) => o.type === "frame" && hit(o)).length, overlapsCards: all.filter((o) => o.type === "embeddable" && hit(o)).length };
      },
      cardId,
    );
    test.info().annotations.push({ type: "pin placement", description: JSON.stringify(placement) });

    // One Undo (Ctrl+Z on the canvas) removes the whole pin.
    await page.keyboard.press("Escape"); // leave any editing state; selection stays
    await page.locator(".excalidraw").focus().catch(() => undefined);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await liveIds(page)).filter((id) => !before.has(id)).length).toBe(0);

    // After the undo, the generated card should offer Pin again, not a Show on canvas for a card that's gone.
    await openNotes(page);
    const label = (await g2.locator(".openui-idea-card__action[data-primary]").textContent())?.trim();
    test.info().annotations.push({ type: "label after undo", description: label ?? "" });
    // Fixed 2026-11-15: a pin whose card is gone offers Pin again.
    expect(label).toMatch(/^Pin (to canvas|\(needs review\))$/);
  });

  test("4b. a pinned card: unique key, Lock but never Allow AI updates, and the next update leaves it in place (promotion P0)", async () => {
    await openNotes(page);
    const g3 = generatedCard(page, "g3");
    const before = new Set(await liveIds(page));
    await g3.getByRole("button", { name: /^Pin (to canvas|\(needs review\))$/ }).click();
    await expect(g3.getByRole("button", { name: "Show on canvas" })).toBeVisible({ timeout: 15_000 });
    const added = (await liveIds(page)).filter((id) => !before.has(id));
    const links = await Promise.all(added.map((id) => dev(page, (d, x) => d.reconciliation(x).then((r) => (r?.link ?? null) as { stableNodeKey?: string; excludeFromReconciliation?: boolean } | null), id)));
    const at = links.findIndex((l) => !!l?.stableNodeKey);
    expect(at, "the pinned card is linked").toBeGreaterThanOrEqual(0);
    const cardId = added[at]!;
    // R3: the key carries the generation run, so two runs' "g3" never share one (was `openui § g3`).
    expect(links[at]!.stableNodeKey).toMatch(/^promoted § gen_[0-9A-Za-z]{20} § g3$/);
    expect(links[at]!.excludeFromReconciliation).toBe(true);
    const fingerprint = () => dev(page, (d, x) => d.reconciliation(x).then((r) => (r as { current?: string | null } | null)?.current ?? null), cardId);
    const pinnedContent = await fingerprint();
    expect(pinnedContent).toBeTruthy();
    await notes(page).getByRole("button", { name: "Canvas", exact: true }).click();
    await expect(notes(page)).toBeHidden();

    // N1: the Origin section offers Lock, never "Allow AI updates"; Lock then Unlock keeps the card's own opt-out.
    const origin = page.getByRole("group", { name: "Origin" });
    await select(page, cardId);
    // The Source tab (opened by step 3) covers the properties; the Origin section is on the Properties tab.
    const propertiesTab = sourceTab(page).getByRole("tab", { name: "Properties" });
    if (await propertiesTab.isVisible()) await propertiesTab.click();
    await expect(origin.getByRole("button", { name: "🔒 Lock" })).toBeVisible();
    await expect(origin.getByRole("button", { name: "Allow AI updates" })).toHaveCount(0);
    await origin.getByRole("button", { name: "🔒 Lock" }).click();
    await origin.getByRole("button", { name: "🔓 Unlock" }).click();
    await expect(origin.getByRole("button", { name: "🔒 Lock" })).toBeVisible();
    await expect(origin.getByRole("button", { name: "Allow AI updates" })).toHaveCount(0);
    expect((await dev(page, (d, x) => d.reconciliation(x).then((r) => r?.link ?? null), cardId))!.excludeFromReconciliation).toBe(true);

    // The next "Update from new content" of the same source proposes nothing for it: accepted whole, the card is still there, unchanged.
    const other = (
      await Promise.all(
        (await liveIds(page)).filter((id) => id !== cardId).map(async (id) => ({ id, link: await dev(page, (d, x) => d.reconciliation(x).then((r) => (r?.link ?? null) as { stableNodeKey?: string } | null), id) })),
      )
    ).find((o) => o.link?.stableNodeKey && !o.link.stableNodeKey.startsWith("promoted § "))!;
    expect(other, "a Visualize card of the same source").toBeTruthy();
    const surface = await openAskAI(page, other.id);
    await (await action(surface, "Update from new content")).click();
    const update = page.getByRole("dialog", { name: "Update from new content" });
    await update.getByRole("textbox").fill(SOURCE.replace("as the running example throughout.", "as the running example throughout this article."));
    await update.getByRole("button", { name: "Update", exact: true }).click();
    await expect(update).toBeHidden({ timeout: 60_000 });
    const reviewed = await reviewBar(page)
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    test.info().annotations.push({ type: "update after pin", description: reviewed ? ((await reviewBar(page).textContent()) ?? "").slice(0, 200) : "nothing to review" });
    if (reviewed) {
      // Nothing is proposed for removal (were the pin managed, its key — in no plan — would be).
      await expect(reviewBar(page)).not.toContainText("removed");
      const conflicts = reviewBar(page).getByRole("list", { name: "Changes that need your input" }).getByRole("button", { name: "Keep mine", pressed: false });
      while ((await conflicts.count()) > 0) await conflicts.first().click();
      await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
      await expect(reviewBar(page)).toBeHidden();
    }
    expect(await liveIds(page)).toContain(cardId);
    const after = await dev(page, (d, x) => d.reconciliation(x).then((r) => (r?.link ?? null) as { stableNodeKey?: string; excludeFromReconciliation?: boolean } | null), cardId);
    expect(after?.stableNodeKey).toBe(links[at]!.stableNodeKey);
    expect(after?.excludeFromReconciliation).toBe(true);
    expect(await fingerprint()).toBe(pinnedContent);
  });

  test("5. generated cards survive leaving and re-entering Notes; a reload clears them (plan: kept until the next run or a reload)", async () => {
    await openNotes(page);
    await expect(generated(page).locator(".openui-idea-card")).toHaveCount(FIXTURE_CARDS);
    await page.keyboard.press("Escape");
    await expect(notes(page)).toBeHidden();
    await openNotes(page);
    await expect(generated(page)).toHaveAttribute("data-status", "done");
    await expect(generated(page).locator(".openui-idea-card")).toHaveCount(FIXTURE_CARDS);

    await page.evaluate(() => (window as unknown as { __acuteDev: Dev }).__acuteDev.store.flush());
    await page.reload();
    await waitForCanvas(page);
    await openNotes(page);
    const after = await generated(page).count();
    test.info().annotations.push({ type: "generated cards after reload", description: after ? "kept" : "cleared" });
    expect(after, "generationStore.ts: preview cards stay until the next run or a reload").toBe(0);
    // Generate is still available after the reload (the stored source survives).
    await expect(generateButton(page)).toBeEnabled({ timeout: 15_000 });
  });

  test("6. Study: flashcards flip, quiz choices answer; a title-only note gets no flashcard (light check)", async () => {
    // A title-only card (one pasted line): Study must not make a flashcard whose front and back are both the title.
    if (await notes(page).isVisible()) await notes(page).getByRole("button", { name: "Canvas", exact: true }).click();
    await expect(notes(page)).toBeHidden();
    await pasteText(page, "A title-only note", { x: 1380, y: 860 });
    await openNotes(page);
    const canvasNotes = notes(page).locator("section.acute-notes__section:not(.acute-notes__generated) .acute-notes__note");
    const total = await canvasNotes.count();
    const titleOnly = await canvasNotes.filter({ hasNot: page.locator(".openui-idea-card__body") }).count();
    expect(titleOnly, "the pasted title-only note is in Notes").toBeGreaterThanOrEqual(1);
    await notes(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Study" }).click();
    const cards = notes(page).locator(".acute-notes__study-grid > .acute-notes__note");
    await expect(cards.first()).toBeVisible();
    const flash = cards.first();
    await expect(flash.locator(".openui-flashcard")).toBeVisible();
    await flash.locator(".openui-flashcard__face").click();
    await expect(flash.getByRole("button", { name: "Got it" })).toBeVisible();
    // One flashcard per note with a body: title-only notes are skipped (study.ts flashcardLang).
    await expect(notes(page).locator(".openui-flashcard")).toHaveCount(total - titleOnly);
    await expect(cards.filter({ hasText: "A title-only note" })).toHaveCount(0);
    await shot(page, "07-study-flashcards.png");

    await notes(page).getByRole("group", { name: "Study mode" }).getByRole("button", { name: "Quiz" }).click();
    const quiz = cards.filter({ has: page.locator(".openui-quiz") }).first();
    await expect(quiz).toBeVisible();
    await quiz.locator(".openui-quiz__choice").first().click();
    await expect(quiz.locator(".openui-quiz")).toHaveAttribute("data-state", /^(correct|incorrect)$/);
    await shot(page, "08-study-quiz.png");
    await notes(page).getByRole("group", { name: "Mode" }).getByRole("button", { name: "Read" }).click();
    await page.keyboard.press("Escape");
    await expect(notes(page)).toBeHidden();
  });

  test("7. no console errors or page errors during the flow", async () => {
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });
});
