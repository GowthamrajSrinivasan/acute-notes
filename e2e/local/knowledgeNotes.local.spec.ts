/**
 * Knowledge Notes in the real app with a mock AI (knowledge-notes-plan §10.1, U1–U8; checkpoints C1b/C2). Every AI call
 * is answered locally by the scripted distiller (`src/ai/fidelity/__fixtures__/knowledge/mockDistiller.ts`): no AI cost,
 * no network. Distil is a developer setting until R1, switched on per page with `__acuteDev.setNoteModel("distil")`.
 *
 * What each test checks is the plan's promise, end to end in the UI: a card's source chip opens the Source tab on its
 * passages at its version (U1); omitted passages show their reason and Include adds a card (U2); "Review N" steps through
 * what needs review and resolutions survive a reload (U3); a 200k-character source stays usable (U4); a passage outlines
 * its cards (U5); a canvas without its source says so (U6); an export with sources keeps notes checkable (U7); a flagged
 * card stays amber and in the queue, whatever the model check says (U8; the check runs on every card since OD5b).
 */
import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AIRequest } from "../../src/ai/types";
import { distiller, labelledUnits, outlineReply, type DistillerOptions } from "../../src/ai/fidelity/__fixtures__/knowledge/mockDistiller";
import { action, openAISettings, openApp, openAskAI, select, waitForCanvas } from "../helpers";

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const sourceTab = (p: Page) => p.getByTestId("acute-source-tab");
const sourcePanel = (p: Page) => p.getByRole("region", { name: "Source" }).or(p.locator("section.acute-source"));
const knowledgeBar = (p: Page) => p.getByTestId("acute-kn-reviewbar");
const chips = (p: Page) => p.locator(".acute-kn-chip");
/** "Review N": on the "Added …" notice right after an Accept, else on its own bar (one bottom bar at a time). */
const reviewButton = (p: Page) => p.getByRole("button", { name: /^Review \d+( ›)?$/ });

const DOC = `# Caching notes

## Retries

Retries can improve reliability when the cache holds a valid result. They must stop after 3 attempts, however short the outage.

## Limits

The cache keeps at most 500 entries per tenant. Entries expire after 30 minutes. Thanks for reading.
`;

/** Answers the AI host with `respond` (the scripted distiller by default); returns the tasks asked, in order. */
async function answerLocally(page: Page, respond: (req: AIRequest) => string = (r) => distiller()(r).text): Promise<string[]> {
  const tasks: string[] = [];
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: AIRequest };
    const req = { ...(body.request ?? {}), task: body.request?.task ?? "", prompt: body.request?.prompt ?? "" } as AIRequest;
    tasks.push(req.task);
    return route.fulfill({ status: 200, json: { text: respond(req), model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
  });
  return tasks;
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

const setNoteModel = (p: Page, model: "preserve" | "distil") =>
  p.evaluate((m) => (window as unknown as { __acuteDev: { setNoteModel(m: string): Promise<string> } }).__acuteDev.setNoteModel(m), model);

/** Visualize `text` through the dialog and accept the proposal. */
async function visualize(page: Page, text: string): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(text);
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
}

async function accept(page: Page): Promise<void> {
  await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(reviewBar(page)).toBeHidden();
}

type Obj = { id: string; key: string; sourceId: string; version: number; units: string[]; noteModel?: string; review?: { reasons: string[]; resolved?: string }; text: string };
/** Every object linked to a content source, with its knowledge fields (`__acuteDev.reconciliation`). */
function objects(p: Page): Promise<Obj[]> {
  return p.evaluate(async () => {
    type El = { id: string; type: string; isDeleted?: boolean; containerId?: string | null; text?: string; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Link = { contentSourceId: string; contentSourceVersion: number; stableNodeKey: string; sourceUnits?: string[]; noteModel?: string; review?: { reasons: string[]; resolved?: string } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): unknown }; reconciliation(id: string): Promise<{ link: Link | null } | null> };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const out: Obj[] = [];
    for (const el of dev.api.getSceneElements()) {
      if (el.isDeleted || (el.type === "text" && el.containerId)) continue;
      const link = (await dev.reconciliation(el.id))?.link;
      if (!link) continue;
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      const text = docId ? JSON.stringify(dev.store.get(docId)) : (el.text ?? "");
      out.push({ id: el.id, key: link.stableNodeKey, sourceId: link.contentSourceId, version: link.contentSourceVersion, units: link.sourceUnits ?? [], ...(link.noteModel ? { noteModel: link.noteModel } : {}), ...(link.review ? { review: link.review } : {}), text });
    }
    return out;
  });
}

/** The chip on `objectId`'s corner. */
const chipOf = (p: Page, objectId: string) => p.locator(`.acute-kn-chip-slot[data-element-id="${objectId}"] .acute-kn-chip`);

/** A fresh canvas with a distil Visualize of `text` accepted. Returns the tasks the mock was asked. */
async function distilCanvas(page: Page, text = DOC, respond?: (req: AIRequest) => string): Promise<string[]> {
  await openApp(page);
  const tasks = await answerLocally(page, respond);
  await connectFakeKey(page);
  expect(await setNoteModel(page, "distil")).toBe("distil");
  await visualize(page, text);
  return tasks;
}

/** A reload once the debounced document writes are in (as the app's own pagehide flush would get them). */
const reload = async (page: Page) => {
  await page.evaluate(() => (window as unknown as { __acuteDev: { store: { flush(): Promise<void> } } }).__acuteDev.store.flush());
  await page.reload();
  await waitForCanvas(page);
};

test.describe("Knowledge Notes with a mock AI (C1b, C2)", () => {
  test.describe.configure({ mode: "serial" });
  let page: Page;
  let tasks: string[];
  // A card cites nothing on every attempt (Needs review on the card), and a critical sentence is left out on every
  // attempt (a passage no card carries: Needs review in the queue).
  const PLANTED: DistillerOptions = { uncitedIn: /expire after/, omitCritical: /must stop/, persistent: true };

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    tasks = await distilCanvas(page, DOC, (r) => distiller(PLANTED)(r).text);
  });
  test.afterAll(async () => {
    await page?.context().close();
  });

  test("distil Visualize end to end: labelled prompts, outcome words in review, cards citing their units", async () => {
    expect(tasks[0]).toBe("outline_document");
    expect(tasks.filter((t) => t === "generate_visual_plan").length).toBeGreaterThanOrEqual(2);
    // The model check runs on every citing card in distil mode (OD5b): one batched call per section.
    expect(tasks.filter((t) => t === "check_card_meaning").length).toBeGreaterThanOrEqual(2);
    // In review: sections and totals in outcome words, never "AI placed N%".
    await expect(reviewBar(page)).toContainText("represented");
    await expect(page.locator(".acute-section-chips")).toContainText("represented");
    await expect(reviewBar(page)).not.toContainText("AI placed");
    await accept(page);
    const objs = await objects(page);
    expect(objs.length).toBeGreaterThan(3);
    expect(objs.every((o) => o.noteModel === "distil")).toBe(true);
    const citing = objs.filter((o) => o.units.length);
    expect(citing.length).toBeGreaterThanOrEqual(3);
    // The dev hook the golden recorder reads.
    const run = await page.evaluate((id) => (window as unknown as { __acuteDev: { knowledgeRun(id: string): Promise<{ units: { units: unknown[] } } | null> } }).__acuteDev.knowledgeRun(id), objs[0]!.sourceId);
    expect(run?.units.units.length).toBeGreaterThan(3);
  });

  test("U8: a flagged card is amber and in Review N after Accept (the model check runs on every card, OD5b; it never clears a deterministic flag)", async () => {
    const flagged = (await objects(page)).find((o) => o.review?.reasons.length && !o.review.resolved);
    expect(flagged, "a card with an open review").toBeDefined();
    await expect(chipOf(page, flagged!.id)).toHaveClass(/acute-kn-chip--review/);
    await expect(knowledgeBar(page)).toBeVisible();
    await expect(reviewButton(page)).toBeVisible();
  });

  test("U1: a card's chip opens the Source tab on its cited passage, highlighted, at the card's version", async () => {
    const card = (await objects(page)).find((o) => o.units.length && /3 attempts|valid result/.test(o.text))!;
    await chipOf(page, card.id).click();
    await expect(sourceTab(page)).toBeVisible();
    await expect(sourceTab(page).getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true");
    const panel = sourceTab(page).locator("section.acute-source");
    await expect(panel.locator(".acute-source__meta")).toContainText("Version 1");
    await expect(panel.locator(".is-selected").first()).toBeVisible();
    await expect(panel.locator(`[data-unit="${card.units[0]}"]`)).toHaveClass(/is-selected/);
    // Properties comes back with one click.
    await sourceTab(page).getByRole("tab", { name: "Properties" }).click();
    await expect(panel).toBeHidden();
  });

  test("U5: selecting a passage outlines the cards citing it; with reduced motion the camera jumps", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const card = (await objects(page)).find((o) => o.units.length)!;
    await chipOf(page, card.id).click();
    const panel = sourceTab(page).locator("section.acute-source");
    await panel.locator(`[data-unit="${card.units[0]}"]`).click();
    await expect(page.locator(`.acute-kn-outline[data-element-id="${card.id}"]`)).toBeVisible();
    // A jump: the view is where it ends up right away (no animation frames in between).
    const scroll = () => page.evaluate(() => {
      const s = (window as unknown as { __acuteDev: { api: { getAppState(): { scrollX: number; scrollY: number } } } }).__acuteDev.api.getAppState();
      return `${Math.round(s.scrollX)},${Math.round(s.scrollY)}`;
    });
    const first = await scroll();
    await page.waitForTimeout(400);
    expect(await scroll()).toBe(first);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  test("U2: the Omitted filter shows each left-out passage with its reason; Include adds a card citing it", async () => {
    const card = (await objects(page)).find((o) => o.units.length)!;
    await chipOf(page, card.id).click();
    const panel = sourceTab(page).locator("section.acute-source");
    await panel.getByRole("group", { name: "Show passages" }).getByRole("button", { name: /^Omitted/ }).click();
    const reason = panel.locator(".acute-source__item .acute-source__reason").first();
    await expect(reason).toContainText(/left out as filler|Intentionally omitted/);
    const before = (await objects(page)).length;
    await panel.locator(".acute-source__item").first().getByRole("button", { name: "Include" }).click();
    await expect.poll(async () => (await objects(page)).length).toBe(before + 1);
    const added = (await objects(page)).find((o) => o.key.startsWith("passage § "))!;
    expect(added.units).toHaveLength(1);
    expect(added.noteModel).toBe("distil");
  });

  test("U8 (after a reload): a flagged card not yet resolved stays amber and in Review N", async () => {
    const before = (await reviewButton(page).textContent())!.replace(" ›", "");
    await reload(page);
    const open = (await objects(page)).filter((o) => o.review?.reasons.length && !o.review.resolved);
    expect(open.length).toBeGreaterThan(0);
    for (const o of open) await expect(chipOf(page, o.id)).toHaveClass(/acute-kn-chip--review/);
    await expect(knowledgeBar(page).getByRole("button", { name: before! })).toBeVisible({ timeout: 20_000 });
  });

  test("U3: Review N steps through every item; each action resolves it; resolved items stay resolved after a reload", async () => {
    const open = reviewButton(page);
    const n = Number((await open.textContent())!.replace(/\D/g, ""));
    expect(n).toBeGreaterThanOrEqual(2);
    await open.click();
    const queue = knowledgeBar(page).getByRole("region", { name: "Needs review" });
    await expect(queue).toContainText(`Needs review 1 of ${n}`);
    // Resolve the first item with its first action (Keep for a card, Include for a passage), then Dismiss a passage if one is left.
    const firstIsCard = (await queue.textContent())!.includes("· card");
    await queue.getByRole("button", { name: firstIsCard ? "Keep" : "Include" }).click();
    await expect(queue.or(open)).toContainText(new RegExp(`of ${n - 1}\\b|Review ${n - 1}\\b`));
    const dismiss = queue.getByRole("button", { name: "Dismiss" });
    let resolved = 1;
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click();
      resolved = 2;
    } else if (await queue.getByRole("button", { name: "Keep" }).isVisible().catch(() => false)) {
      await queue.getByRole("button", { name: "Keep" }).click();
      resolved = 2;
    }
    const left = n - resolved;
    await reload(page);
    if (left > 0) await expect(knowledgeBar(page).getByRole("button", { name: `Review ${left}` })).toBeVisible({ timeout: 20_000 });
    else await expect(knowledgeBar(page)).toBeHidden();
  });

  test("U1 (newer version): a card made before an update shows “Source updated since this card”", async () => {
    const before = await objects(page);
    const card = before.find((o) => o.units.length && /3 attempts|valid result/.test(o.text))!;
    // An update that changes only the other section, through the app's own action (Ask AI → Update from new content):
    // this card keeps version 1.
    const surface = await openAskAI(page, card.id);
    await (await action(surface, "Update from new content")).click();
    const update = page.getByRole("dialog", { name: "Update from new content" });
    await update.getByRole("textbox").fill(DOC.replace("30 minutes", "45 minutes"));
    await update.getByRole("button", { name: "Update", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
    await accept(page);
    const still = (await objects(page)).find((o) => o.id === card.id)!;
    expect(still.version).toBe(1);
    await chipOf(page, card.id).click();
    const panel = sourceTab(page).locator("section.acute-source");
    await expect(panel.getByRole("status").filter({ hasText: "Source updated since this card" })).toBeVisible();
    await panel.getByRole("button", { name: "View latest" }).click();
    await expect(panel.locator(".acute-source__meta")).toContainText("Version 2");
  });
});

test("U6: a canvas whose source isn't on this device says so, with grey chips and no broken links", async ({ page }) => {
  await distilCanvas(page);
  await accept(page);
  const card = (await objects(page)).find((o) => o.units.length)!;
  await page.evaluate((id) => (window as unknown as { __acuteDev: { deleteContentSource(id: string): Promise<void> } }).__acuteDev.deleteContentSource(id), card.sourceId);
  await reload(page);
  await expect(chipOf(page, card.id)).toHaveClass(/acute-kn-chip--unavailable/);
  await chipOf(page, card.id).click();
  await expect(sourceTab(page)).toContainText("Source not on this device");
  await expect(knowledgeBar(page)).toBeHidden();
});

test("U7: an export with “Include sources” keeps notes checkable; unticking it warns", async ({ page }) => {
  await distilCanvas(page);
  await accept(page);
  const dialog = page.getByRole("dialog", { name: "Export canvas" });
  const openExport = async () => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Export canvas…" }).click();
    await expect(dialog).toBeVisible();
  };
  await openExport();
  const sources = dialog.getByRole("checkbox", { name: /^Sources/ });
  await expect(sources).toBeChecked();
  await sources.uncheck();
  await expect(dialog).toContainText("This file won't include the original sources");
  await sources.check();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const file = await download;
  const path = test.info().outputPath("distil.acute.json");
  await writeFile(path, await (await import("node:fs/promises")).readFile((await file.path())!));
  if (await page.getByRole("button", { name: "Show workspaces" }).isVisible()) await page.getByRole("button", { name: "Show workspaces" }).click();
  await page.locator('input[type="file"][accept*=".acute.json"]').setInputFiles(path);
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Import canvas" }).click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("(imported)");
  await waitForCanvas(page);
  const imported = await expect.poll(async () => (await objects(page)).filter((o) => o.units.length).length, { timeout: 20_000 }).toBeGreaterThan(0).then(() => objects(page));
  const card = imported.find((o) => o.units.length)!;
  await chipOf(page, card.id).click();
  const panel = sourceTab(page).locator("section.acute-source");
  await expect(panel.locator(`[data-unit="${card.units[0]}"]`)).toHaveClass(/is-selected/);
});

test("U4: a 200k-character source: the panel opens within 300 ms, highlights within 100 ms, outline jump and “1 of 3” stepping work", async ({ page }) => {
  test.setTimeout(300_000);
  // A long document: many sections of plain sentences, each made unique by a word spelled from its index (no digits, so
  // nothing is a protected number). Each section's card cites three passages far apart; the rest is left out as filler
  // (few cards, so the canvas stays light while the source is 200k characters).
  const WORDS = "the service cache index tenant query result write node request response budget latency queue worker shard replica region client token".split(" ");
  const tag = (i: number) => {
    let s = "";
    for (let n = i + 26 * 26; n > 0; n = Math.floor(n / 26)) s = String.fromCharCode(97 + (n % 26)) + s;
    return s;
  };
  const sentence = (i: number) => {
    const words = Array.from({ length: 10 + (i % 7) }, (_, w) => WORDS[(i * 31 + w * 17) % WORDS.length]!);
    return `${words.join(" ").replace(/^./, (c) => c.toUpperCase())} ${tag(i)}.`;
  };
  const parts: string[] = ["# Long source"];
  let i = 0;
  // Up to Visualize's limit (200,000 characters).
  for (let s = 1; ; s++) {
    const section = [`## Part ${s}`, ...Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => sentence(++i)).join(" "))];
    if ([...parts, ...section].join("\n\n").length > 200_000) break;
    parts.push(...section);
  }
  const text = parts.join("\n\n");
  expect(text.length).toBeGreaterThanOrEqual(195_000);
  const respond = (req: AIRequest): string => {
    if (req.task === "outline_document") return outlineReply(req.prompt);
    if (req.task !== "generate_visual_plan") return distiller()(req).text;
    const { units } = labelledUnits(req.prompt);
    const cite = units.length >= 3 ? [units[0]!, units[Math.floor(units.length / 2)]!, units[units.length - 1]!] : units.slice(0, 1);
    const omitted = units.filter((u) => !cite.includes(u)).map((u) => ({ unit: u.label, reason: "filler" }));
    const nodes = [{ id: "n1", type: "text", title: "Three passages", content: { markdown: cite.map((u) => u.text).join(" ") }, cites: cite.map((u) => u.label) }];
    return JSON.stringify({ version: 1, template: "sectioned", nodes, relationships: [], metadata: { takeaway: "The part in short", omitted } });
  };
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await distilCanvas(page, text, respond).catch((err: unknown) => {
    throw new Error(`${String(err)}\nPage errors: ${errors.join("\n")}`);
  });
  await accept(page);
  const card = (await objects(page)).find((o) => o.units.length === 3)!;
  expect(card, "a card citing three passages").toBeDefined();
  // The budget is the panel's on a settled canvas: the Accept's own writes (the 200k version and its units) done first.
  await page.evaluate((id) => (window as unknown as { __acuteDev: { contentSource(id: string): Promise<unknown> } }).__acuteDev.contentSource(id), card.sourceId);
  await page.evaluate(() => (window as unknown as { __acuteDev: { store: { flush(): Promise<void> } } }).__acuteDev.store.flush());
  await page.waitForTimeout(1_000);

  // Open: from the chip's click to the panel showing the first cited passage, measured in the page.
  const ms = await page.evaluate(async (id) => {
    const chip = document.querySelector<HTMLButtonElement>(`.acute-kn-chip-slot[data-element-id="${id}"] .acute-kn-chip`)!;
    const t0 = performance.now();
    chip.click();
    await new Promise<void>((resolve) => {
      const done = () => document.querySelector(".acute-source .is-current") && (observer.disconnect(), resolve());
      const observer = new MutationObserver(done);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      done();
    });
    return performance.now() - t0;
  }, card.id);
  test.info().annotations.push({ type: "U4 open ms", description: ms.toFixed(0) });
  expect(ms, "panel open (§5.2 budget: 300 ms)").toBeLessThanOrEqual(300);

  const panel = sourceTab(page).locator("section.acute-source");
  await expect(panel.getByRole("group", { name: "Cited passages" })).toContainText("Passage 1 of 3");
  // Highlight: stepping to the next passage, measured in the page.
  const step = await page.evaluate(async () => {
    const next = document.querySelector<HTMLButtonElement>('.acute-source__stepper [aria-label="Next passage"]')!;
    const before = document.querySelector(".acute-source .is-current")?.getAttribute("data-passage") ?? document.querySelector(".acute-source .is-current")?.getAttribute("data-unit");
    const t0 = performance.now();
    next.click();
    await new Promise<void>((resolve) => {
      const cur = () => document.querySelector(".acute-source .is-current");
      const id = () => cur()?.getAttribute("data-passage") ?? cur()?.getAttribute("data-unit");
      const done = () => id() && id() !== before && (observer.disconnect(), resolve());
      const observer = new MutationObserver(done);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      done();
    });
    return performance.now() - t0;
  });
  test.info().annotations.push({ type: "U4 highlight ms", description: step.toFixed(0) });
  console.log(`U4 budgets: open ${ms.toFixed(0)} ms (≤ 300), highlight ${step.toFixed(0)} ms (≤ 100), source ${text.length} characters`);
  expect(step, "highlight (§5.2 budget: 100 ms)").toBeLessThanOrEqual(100);
  await expect(panel.getByRole("group", { name: "Cited passages" })).toContainText("Passage 2 of 3");
  await panel.getByRole("button", { name: "Next passage" }).click();
  await expect(panel.getByRole("group", { name: "Cited passages" })).toContainText("Passage 3 of 3");

  // Outline jump: a late section's heading comes into view.
  const outline = panel.locator(".acute-source__outline");
  if (!(await outline.getAttribute("open"))) await outline.locator("summary").click();
  const last = outline.getByRole("button").last();
  const heading = (await last.locator(".acute-source__heading-text").textContent())!.trim();
  await last.click();
  await expect(panel.locator(".acute-source__body").getByText(heading, { exact: true })).toBeInViewport();
});

test("U3 (Edit) and Pin quote: Edit resolves a card once the user saves a change; Pin quote puts the passage on the card, word for word", async ({ page }) => {
  await distilCanvas(page, DOC, (r) => distiller({ uncitedIn: /expire after/, persistent: true })(r).text);
  await accept(page);
  const flagged = (await objects(page)).find((o) => o.review?.reasons.length && !o.review.resolved)!;
  await reviewButton(page).click();
  const queue = knowledgeBar(page).getByRole("region", { name: "Needs review" });
  await queue.getByRole("button", { name: "Edit" }).click();
  // The user's edit (as the block editor saves it), then leaving the card: its review is resolved as "edited".
  await page.evaluate((id) => {
    type Dev = { api: { getSceneElements(): { id: string; customData?: { acute?: { documentId?: string } } }[]; updateScene(s: { appState: Record<string, unknown> }): void }; store: { get(id: string): { snapshot: unknown[] } | null; updateSnapshot(id: string, s: unknown[]): void } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const docId = dev.api.getSceneElements().find((e) => e.id === id)!.customData!.acute!.documentId!;
    dev.store.updateSnapshot(docId, [...dev.store.get(docId)!.snapshot, { type: "paragraph", content: "Entries expire after 30 minutes unless renewed." }]);
    dev.api.updateScene({ appState: { activeEmbeddable: null, selectedElementIds: {} } });
  }, flagged.id);
  await expect.poll(async () => (await objects(page)).find((o) => o.id === flagged.id)!.review?.resolved).toBe("edited");

  // Pin quote from the Source tab on a citing card: the passage appended word for word.
  await queue.getByRole("button", { name: "Done" }).click();
  const card = (await objects(page)).find((o) => o.units.length && /valid result/.test(o.text))!;
  // (Its chip may be outside the view the edit left: clicked where it is, as a chip in view would be.)
  await chipOf(page, card.id).dispatchEvent("click");
  const panel = sourceTab(page).locator("section.acute-source");
  await panel.locator(`[data-unit="${card.units[0]}"]`).click();
  await panel.locator(".acute-source__active").getByRole("button", { name: "Pin quote" }).click();
  await expect.poll(async () => (await objects(page)).find((o) => o.id === card.id)!.text).toContain('"type":"quote"');
});

test("Re-arrange (organisation-layout plan §3.4.3): cards I placed stay put by default; “Also move cards I placed” re-plans them too", async ({ page }) => {
  await distilCanvas(page);
  await accept(page);
  // Two cards of one section frame: the user drags the first onto the second.
  const pair = await page.evaluate(async () => {
    type El = { id: string; type: string; isDeleted?: boolean; frameId?: string | null; x: number; y: number; width: number; height: number; version: number; versionNonce: number };
    type Dev = { api: { getSceneElements(): El[]; updateScene(s: { elements: El[] }): void }; reconciliation(id: string): Promise<{ link: { sourceUnits?: string[] } | null } | null> };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const cards: El[] = [];
    for (const el of dev.api.getSceneElements()) if (!el.isDeleted && el.frameId && (await dev.reconciliation(el.id))?.link?.sourceUnits?.length) cards.push(el);
    const byFrame = new Map<string, El[]>();
    for (const c of cards) byFrame.set(c.frameId!, [...(byFrame.get(c.frameId!) ?? []), c]);
    const [a, b] = [...byFrame.values()].find((list) => list.length >= 2)!;
    dev.api.updateScene({ elements: dev.api.getSceneElements().map((e) => (e.id === a!.id ? { ...e, x: b!.x + 10, y: b!.y + 10, version: e.version + 1, versionNonce: e.versionNonce + 1 } : e)) });
    return { moved: a!.id, other: b!.id };
  });
  const surface = await openAskAI(page, pair.other);
  await (await action(surface, "Re-arrange layout")).click();
  const check = reviewBar(page).getByLabel("Re-arrange check");
  await expect(check).toContainText("1 card you placed was left where it is.");
  const option = check.getByRole("checkbox", { name: "Also move cards I placed" });
  await expect(option).not.toBeChecked();
  await option.check();
  await expect(reviewBar(page).getByLabel("Re-arrange check")).toContainText("1 card you placed moves too.");
  await expect(reviewBar(page).getByLabel("Re-arrange check").getByRole("checkbox", { name: "Also move cards I placed" })).toBeChecked();
});

test("preserve canvases look exactly as before: no chips, no Source tab, no Review N", async ({ page }) => {
  await openApp(page);
  await answerLocally(page);
  await connectFakeKey(page);
  expect(await setNoteModel(page, "preserve")).toBe("preserve");
  await visualize(page, DOC);
  await expect(reviewBar(page)).not.toContainText("represented ·");
  await accept(page);
  const objs = await objects(page);
  expect(objs.length).toBeGreaterThan(0);
  expect(objs.some((o) => o.noteModel === "distil" || o.units.length)).toBe(false);
  await expect(chips(page)).toHaveCount(0);
  await select(page, objs[0]!.id);
  await expect(sourceTab(page)).toHaveCount(0);
  await expect(knowledgeBar(page)).toBeHidden();
  void sourcePanel;
});
