/**
 * Replays a recorded real-AI Visualize run through the real app, with no AI call and no cost: the browser's calls to
 * the AI host are answered from a run's `ai-replies.json` (written by `e2e/ai/fidelity.spec.ts`). So a layout or
 * routing change can be checked on the exact output a model gave, run after run.
 *
 * Each section call gets the recorded reply that matches it: by its prompt when the recording has prompts, else the
 * unused reply sharing the most words with the section's text (the calls run in parallel, so order can't be relied on).
 *
 *   ACUTE_REPLAY_DIR=.ai/docs/fidelity-runs/<date>/<case>/run-1 ACUTE_REPLAY_SOURCE=src/ai/fidelity/__fixtures__/<file> \
 *     npx playwright test --project=local e2e/local/replayVisualize.local.spec.ts --headed
 *
 * Skipped unless `ACUTE_REPLAY_DIR` is set. Screenshots go to `<ACUTE_REPLAY_DIR>/replay/`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { createDemoCanvas, openAISettings, openApp } from "../helpers";

const DIR = process.env.ACUTE_REPLAY_DIR ?? "";
const SOURCE = process.env.ACUTE_REPLAY_SOURCE ?? "";

type Recorded = { task: string; reply: string; prompt?: string };

const words = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []));

/** The section's own text inside a generation prompt (whatever follows its "Content" marker), or the whole prompt. */
const sectionTextOf = (prompt: string) => prompt.split(/\n(?:Content|Section text)[^\n]*:\n/i).at(-1) ?? prompt;

async function replay(page: Page, recorded: readonly Recorded[]): Promise<void> {
  const outline = recorded.find((r) => r.task === "outline_document");
  const sections = recorded.filter((r) => r.task === "generate_visual_plan");
  const used = new Set<Recorded>();
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: { task?: string; prompt?: string } };
    const prompt = body.request?.prompt ?? "";
    if (body.request?.task === "outline_document" && outline) return route.fulfill({ status: 200, contentType: "application/json", body: outline.reply });
    const exact = sections.find((r) => !used.has(r) && r.prompt === prompt);
    const want = words(sectionTextOf(prompt));
    const score = (r: Recorded) => {
      const have = words(JSON.parse(r.reply).text ?? r.reply);
      let n = 0;
      for (const w of want) if (have.has(w)) n += 1;
      return n / Math.max(1, want.size);
    };
    const pick = exact ?? [...sections].filter((r) => !used.has(r)).sort((a, b) => score(b) - score(a))[0] ?? sections[0]!;
    used.add(pick);
    return route.fulfill({ status: 200, contentType: "application/json", body: pick.reply });
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

test.skip(!DIR || !existsSync(join(DIR, "ai-replies.json")), "set ACUTE_REPLAY_DIR to a fidelity run with ai-replies.json");

test("replays a recorded Visualize run: layout, links and frames as the app draws them today", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const out = join(DIR, "replay");
  mkdirSync(out, { recursive: true });
  await replay(page, JSON.parse(readFileSync(join(DIR, "ai-replies.json"), "utf8")) as Recorded[]);
  await openApp(page);
  await createDemoCanvas(page);
  await page.evaluate(() => (window as unknown as { __acuteDev: { api: { updateScene(s: object): void } } }).__acuteDev.api.updateScene({ elements: [] }));
  await connectFakeKey(page);

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const dialog = page.getByRole("dialog", { name: "Visualize" });
  await dialog.getByRole("textbox").fill(readFileSync(SOURCE, "utf8"));
  await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
  const review = page.getByRole("region", { name: "AI changes to review" });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await review.getByRole("button", { name: "Accept all" }).click();
  // Cards fit their content after they mount, and their frames grow (and make room) with them.
  await page.waitForTimeout(2500);

  type El = { id: string; type: string; name?: string | null; isDeleted?: boolean; x: number; y: number; width: number; height: number };
  const frames = await page.evaluate(() => {
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string; type: string; name?: string | null; isDeleted?: boolean; x: number; y: number; width: number; height: number }[] } } }).__acuteDev.api;
    return api.getSceneElements().filter((e) => e.type === "frame" && !e.isDeleted).map((e) => ({ id: e.id, name: e.name ?? "", x: e.x, y: e.y, width: e.width, height: e.height }));
  });
  // No two sections overlap once everything has settled.
  const overlaps = (a: El, b: El) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const overlapping = frames.flatMap((a, i) => frames.slice(i + 1).filter((b) => overlaps(a as El, b as El)).map((b) => `${a.name} × ${b.name}`));
  expect(overlapping, "overlapping sections").toEqual([]);

  // The links between sections as drawn, for checking their routes against the frames' names.
  const links = await page.evaluate(() => {
    type A = { id: string; type: string; isDeleted?: boolean; x: number; y: number; points?: [number, number][]; startBinding?: { elementId: string } | null; endBinding?: { elementId: string } | null; customData?: Record<string, unknown>; elbowed?: boolean; boundElements?: { id: string; type: string }[] | null; text?: string; name?: string | null };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): A[] } } }).__acuteDev.api;
    const els = api.getSceneElements();
    const byId = new Map(els.map((e) => [e.id, e]));
    return els
      .filter((e) => e.type === "arrow" && !e.isDeleted && byId.get(e.startBinding?.elementId ?? "")?.type === "frame")
      .map((e) => ({
        from: byId.get(e.startBinding!.elementId)?.name,
        to: byId.get(e.endBinding?.elementId ?? "")?.name,
        routed: !!e.customData?.acuteRouted,
        elbowed: !!e.elbowed,
        label: e.boundElements?.map((b) => byId.get(b.id)?.text).filter(Boolean).join(" "),
        points: (e.points ?? []).map(([x, y]) => [Math.round(e.x + x), Math.round(e.y + y)]),
      }));
  });
  writeFileSync(join(out, "section-links.json"), JSON.stringify({ frames, links }, null, 2));

  // Nothing selected (the accepted set stays selected otherwise), then the whole canvas in view.
  await page.evaluate(() => (window as unknown as { __acuteDev: { api: { updateScene(s: object): void } } }).__acuteDev.api.updateScene({ appState: { selectedElementIds: {} } }));
  await page.keyboard.press("Shift+1");
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, "overview.png") });
  // Close up on the links between sections (the gutters they run in, with the frames' names around them).
  await page.evaluate(() => {
    type E = { id: string; type: string; isDeleted?: boolean; startBinding?: { elementId: string } | null };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): E[]; scrollToContent(t: object, o: object): void } } }).__acuteDev.api;
    const els = api.getSceneElements();
    const frameIds = new Set(els.filter((e) => e.type === "frame").map((e) => e.id));
    const links = els.filter((e) => e.type === "arrow" && !e.isDeleted && frameIds.has(e.startBinding?.elementId ?? ""));
    if (links.length) api.scrollToContent(links, { fitToContent: true, animate: false });
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, "section-links.png") });
  for (const [i, f] of frames.entries()) {
    await page.evaluate((id) => {
      const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string }[]; scrollToContent(t: object, o: object): void } } }).__acuteDev.api;
      const el = api.getSceneElements().find((e) => e.id === id);
      if (el) api.scrollToContent(el, { fitToContent: true, animate: false });
    }, f.id);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(out, `frame-${String(i + 1).padStart(2, "0")}.png`) });
  }
  await page.context().close();
});
