/**
 * Content fidelity (content fidelity plan) against a real AI connection: the two sample documents are visualized,
 * accepted, screenshotted (whole canvas + each section), and scored — how much of the source survives on the
 * canvas (`e2e/fidelityScore.ts`: units covered, key terms kept, words kept; every skipped unit listed).
 *
 * Wave F1: the same document and model vary run to run (seen live: 72% AI-placed in one run, 31% in another), so
 * each case runs `RUNS` times and reports the median and range — median is the headline, not a single sample.
 *
 * Output: `.ai/docs/fidelity-runs/<date>/<case>/run-N/` — overview.png, frame-NN.png, report.md, report.json; plus
 * `<case>/summary.md` and `summary.json` with the median/range across all `RUNS`.
 *
 * Run only through `npm run test:e2e:ai -- e2e/ai/fidelity.spec.ts` (asks before running); `--demo` to watch it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, openApp, recordAIRequests, recordAIUsage, type RecordedUsage } from "../helpers";
import { AI_PROVIDER, AI_PROVIDER_NAME, connectAI } from "../aiProvider";
import { AI_TIMEOUT, caption, look, reviewBar, visualizeDialog } from "../aiReview";
import { fidelityScore, median, multiRunSummaryMarkdown, reportMarkdown, type FidelityRun } from "../fidelityScore";

// 3x the work per case (Wave F1) — each case's own per-test timeout needs the same headroom.
test.describe.configure({ mode: "serial", timeout: 2_700_000 });

/** `ACUTE_FIDELITY_RUNS=1` for a single look at one case (with `-g`), e.g. while checking a fix by eye. */
const RUNS = Math.max(1, Number(process.env.ACUTE_FIDELITY_RUNS) || 3);

/**
 * INR per 1M tokens, manually checked against the provider's own pricing page on the date noted — there's no
 * pricing API to read this from live, so it's a point-in-time snapshot, not a guarantee. Keyed by model only:
 * every BYOK connection's `usage.provider` comes back as the literal string "copilot" (the Copilot SDK session
 * event, `CopilotHostRuntime.ts`'s `toAIUsage`), never the app's own connection id — the model string is the
 * only thing that actually identifies which vendor/pricing applies. Unlisted models just get no cost line (token
 * totals are still reported).
 */
const PRICING_INR_PER_M: Record<string, { input: number; output: number; checked: string }> = {
  "meta-llama/llama-4-scout": { input: 11.13, output: 34.41, checked: "2026-10-03, aicredits.in/models" },
};

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURES = join(ROOT, "src", "ai", "fidelity", "__fixtures__");
const RUN_DIR = join(ROOT, ".ai", "docs", "fidelity-runs", new Date().toISOString().slice(0, 10));

const CASES = [
  { id: "cmg-verify-cheatsheet", file: "cmg-verify-cheatsheet.txt", title: "Example 1 — cmg-verify cheat sheet (tables, 8 sections)" },
  { id: "handoff-status", file: "handoff-status.md", title: "Example 2 — hand-off status note (bold-line sections)" },
  // Wave A: a pasted chat reply with a tab-separated decision table (reconstructed from the user's screenshot) —
  // the local tier used to keep it without calling AI at all.
  { id: "decision-table-reply", file: "decision-table-reply.txt", title: "Example 3 — chat reply with a decision table (Wave A)" },
  // A status reply whose "Units" section once came out as a table flattened to one cell per line, and a
  // "Source details" page cut into one bullet per sentence (2026-10-07, from the user's screenshot).
  { id: "unit-checks-reply", file: "unit-checks-reply.md", title: "Example 4 — unit and wording checks status reply" },
];

let page: Page;
let aiRequests: Request[];
let aiUsages: RecordedUsage[];
/** The app's own diagnostics ("[acute-notes] …" console warnings), per case: why a section fell back, what validation lost. */
let appWarnings: string[] = [];
/** Every usage record across the whole spec run (every case, every repeat) — for the final token/cost summary. */
const allUsages: RecordedUsage[] = [];

interface CanvasText {
  visible: string[];
  pages: string[];
  frames: { id: string; name: string }[];
}

/** Every piece of text on the canvas: labels and text elements, block documents (visible), page documents (pages). */
function canvasText(p: Page): Promise<CanvasText> {
  return p.evaluate(() => {
    type El = { id: string; type: string; text?: string; name?: string | null; isDeleted?: boolean; customData?: { acute?: { kind?: string; documentId?: string; pageId?: string } } };
    const dev = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] }; store: { get(id: string): unknown } } }).__acuteDev;
    // Every string in a block's document except styling and ids (table cells can be plain strings or inline runs).
    // A link's target is kept content too: a source "[units.ts](.pi/…/units.ts)" keeps its path only there.
    const SKIP = new Set(["id", "type", "textColor", "backgroundColor", "textAlignment", "level", "styles", "language"]);
    const deep = (v: unknown, out: string[], key = "") => {
      if (typeof v === "string") {
        if (!SKIP.has(key)) out.push(v);
      } else if (Array.isArray(v)) v.forEach((x) => deep(x, out, key));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) deep(x, out, k);
    };
    const visible: string[] = [];
    const pages: string[] = [];
    const frames: { id: string; name: string }[] = [];
    for (const el of dev.api.getSceneElements()) {
      if (el.isDeleted) continue;
      if (el.type === "frame") frames.push({ id: el.id, name: el.name ?? "" });
      if (typeof el.text === "string") visible.push(el.text);
      const a = el.customData?.acute;
      const id = a?.documentId ?? a?.pageId;
      if (!id) continue;
      const doc = dev.store.get(id) as { title?: string; snapshot?: unknown } | null;
      if (!doc) continue;
      const bucket = a?.kind === "page-preview" ? pages : visible;
      if (doc.title) bucket.push(doc.title);
      deep(doc.snapshot, bucket);
    }
    return { visible, pages, frames };
  });
}

async function fitAll(p: Page): Promise<void> {
  await p.keyboard.press("Escape");
  await p.locator(".excalidraw").click({ position: { x: 5, y: 300 } });
  await p.keyboard.press("Shift+1");
  await p.waitForTimeout(600);
}

async function showFrame(p: Page, id: string): Promise<void> {
  await p.evaluate((frameId) => {
    type El = { id: string };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[]; scrollToContent(t: El, o: object): void } } }).__acuteDev.api;
    const el = api.getSceneElements().find((e) => e.id === frameId);
    if (el) api.scrollToContent(el, { fitToContent: true, animate: false });
  }, id);
  await p.waitForTimeout(700);
}

async function clearCanvas(p: Page): Promise<void> {
  await p.evaluate(() => (window as unknown as { __acuteDev: { api: { updateScene(s: { elements: unknown[] }): void } } }).__acuteDev.api.updateScene({ elements: [] }));
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  aiRequests = recordAIRequests(page);
  aiUsages = recordAIUsage(page);
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  page.on("console", (m) => {
    if (m.text().startsWith("[acute-notes]")) appWarnings.push(m.text());
  });
  await openApp(page);
  await connectAI(page);
});

test.afterAll(async () => {
  await page?.context().close();

  const promptTokens = allUsages.reduce((n, u) => n + (u.promptTokens ?? 0), 0);
  const completionTokens = allUsages.reduce((n, u) => n + (u.completionTokens ?? 0), 0);
  const byModel = new Map<string, number>();
  for (const u of allUsages) byModel.set(u.model, (byModel.get(u.model) ?? 0) + 1);
  const models = [...byModel.entries()].map(([m, n]) => `${m} (${n} calls)`).join(", ") || "(none)";

  const lines = [
    `# Token usage & cost — whole suite (${AI_PROVIDER_NAME[AI_PROVIDER]})`,
    "",
    `Calls with reported usage: ${allUsages.length}`,
    `Models: ${models}`,
    `Prompt tokens: ${promptTokens.toLocaleString()}`,
    `Completion tokens: ${completionTokens.toLocaleString()}`,
    `Total tokens: ${(promptTokens + completionTokens).toLocaleString()}`,
    "",
  ];
  for (const [model, calls] of byModel) {
    const price = PRICING_INR_PER_M[model];
    const modelPrompt = allUsages.filter((u) => u.model === model).reduce((n, u) => n + (u.promptTokens ?? 0), 0);
    const modelCompletion = allUsages.filter((u) => u.model === model).reduce((n, u) => n + (u.completionTokens ?? 0), 0);
    if (!price) {
      lines.push(`- **${model}** (${calls} calls): no pricing on file — reporting tokens only.`);
      continue;
    }
    const cost = (modelPrompt / 1_000_000) * price.input + (modelCompletion / 1_000_000) * price.output;
    lines.push(`- **${model}** (${calls} calls): ₹${cost.toFixed(4)} (₹${price.input}/1M in, ₹${price.output}/1M out — checked ${price.checked})`);
  }
  console.log(`\n${lines.join("\n")}\n`);
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(join(RUN_DIR, "token-usage-cost.md"), lines.join("\n"));
});

for (const c of CASES) {
  test(c.title, async () => {
    const source = readFileSync(join(FIXTURES, c.file), "utf8");
    const runs: FidelityRun[] = [];
    for (let run = 1; run <= RUNS; run++) {
      runs.push(await runOnce(c, run, source));
    }
    const caseDir = join(RUN_DIR, c.id);
    writeFileSync(join(caseDir, "summary.md"), multiRunSummaryMarkdown(c.title, runs));
    writeFileSync(join(caseDir, "summary.json"), JSON.stringify({ case: c.id, runs }, null, 2));
    await caption(page, `${c.title} — ${RUNS} runs`, `AI placed median ${median(runs.map((r) => r.aiPlacedPct))}% · visible score median ${median(runs.map((r) => r.visibleScore))}`);
    await look(page);
    // The coverage guard (content fidelity §1 invariant 2: validation never decreases information) — the safety
    // net should keep this near 100 regardless of how the model itself does.
    expect(median(runs.map((r) => r.visibleScore)), "visible fidelity score (median)").toBeGreaterThanOrEqual(95);
    test.info().annotations.push({
      type: "fidelity-f1",
      description: `AI placed median ${median(runs.map((r) => r.aiPlacedPct))}% (target ≥ 85), visible score median ${median(runs.map((r) => r.visibleScore))}/100`,
    });
  });
}

async function runOnce(c: (typeof CASES)[number], run: number, source: string): Promise<FidelityRun> {
    const dir = join(RUN_DIR, c.id, `run-${run}`);
    mkdirSync(dir, { recursive: true });
    await clearCanvas(page);
    await caption(page, c.title, `Visualize with ${AI_PROVIDER_NAME[AI_PROVIDER]}: outline, then one call per section`);

    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(source);
    aiRequests.length = 0;
    aiUsages.length = 0;
    appWarnings = [];
    const started = Date.now();
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page).or(visualizeDialog(page).getByRole("alert"))).toBeVisible({ timeout: AI_TIMEOUT * 3 });
    if (!(await reviewBar(page).isVisible())) {
      const error = (await visualizeDialog(page).getByRole("alert").first().textContent()) ?? "";
      await page.screenshot({ path: join(dir, "error.png") });
      throw new Error(`Visualize failed: ${error}`);
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    const tasks = aiRequests.filter((r) => r.method() === "POST").map(aiTaskOf);
    const reviewText = ((await reviewBar(page).textContent()) ?? "").replace(/\s+/g, " ").trim();
    // Wave A: whether any of it is only the content's own structure (not AI analysis), and why.
    const analysisRow = reviewBar(page).getByLabel("AI analysis");
    const analysisText = (await analysisRow.isVisible()) ? ((await analysisRow.textContent()) ?? "").replace(/\s+/g, " ").trim() : "";
    await look(page);

    // The coverage row: collapsed, then its per-section details; then "Regenerate" when it is offered.
    const coverage = reviewBar(page).getByLabel("Content coverage");
    let coverageText = "";
    let sectionChips: string[] = [];
    let regenerated = "";
    if (await coverage.isVisible()) {
      coverageText = ((await coverage.textContent()) ?? "").replace(/\s+/g, " ").trim();
      await reviewBar(page).screenshot({ path: join(dir, "coverage-row.png") });
      // Each section's details are on its frame (Wave C): the chips, recorded and shown on the canvas.
      sectionChips = await page.getByRole("note", { name: /^Section / }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
      await caption(page, `${c.title} — coverage`, "Each section says, at the section, what the AI placed and what was added from the source");
      await page.screenshot({ path: join(dir, "coverage-details.png") });
      await look(page);
      const regenerate = coverage.getByRole("button", { name: /^Regenerate/ });
      if (await regenerate.isVisible()) {
        const label = (await regenerate.textContent()) ?? "";
        await caption(page, `${c.title} — ${label}`, "Only the sections that fell short, each told what it left out");
        await regenerate.click();
        await expect(coverage.getByRole("button", { name: /^Regenerating/ })).toBeHidden({ timeout: AI_TIMEOUT * 2 });
        regenerated = `${label} → ${((await reviewBar(page).getByLabel("Content coverage").textContent()) ?? "").replace(/\s+/g, " ").trim()}`;
        await reviewBar(page).screenshot({ path: join(dir, "coverage-after-regenerate.png") });
        await look(page);
      }
    }
    await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
    await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added");

    await fitAll(page);
    await page.screenshot({ path: join(dir, "overview.png") });
    const text = await canvasText(page);
    for (const [i, f] of text.frames.entries()) {
      await showFrame(page, f.id);
      await page.screenshot({ path: join(dir, `frame-${String(i + 1).padStart(2, "0")}.png`) });
    }
    await fitAll(page);

    // Snapshot now: every `/api/ai/run` response for this run has long since resolved (the UI already reflects
    // the finished result above), so there's no race with the async response listener.
    const usageSnapshot = [...aiUsages];
    allUsages.push(...usageSnapshot);
    const promptTokens = usageSnapshot.reduce((n, u) => n + (u.promptTokens ?? 0), 0);
    const completionTokens = usageSnapshot.reduce((n, u) => n + (u.completionTokens ?? 0), 0);

    const all = fidelityScore(source, [...text.visible, ...text.pages]);
    const visibleOnly = fidelityScore(source, text.visible);
    const extra = [
      `- Provider: ${AI_PROVIDER_NAME[AI_PROVIDER]} · ${seconds}s · AI calls: ${tasks.join(", ")}`,
      `- Tokens: ${promptTokens.toLocaleString()} prompt + ${completionTokens.toLocaleString()} completion = ${(promptTokens + completionTokens).toLocaleString()} total (${usageSnapshot.length}/${tasks.length} calls reported usage)`,
      `- Review bar: ${reviewText}`,
      `- Coverage row: ${coverageText || "(not shown)"}`,
      `- Structure-only row: ${analysisText || "(none: all AI analysis)"}`,
      `- App warnings: ${appWarnings.length ? appWarnings.join(" / ") : "(none)"}`,
      `- Section chips: ${sectionChips.length ? sectionChips.join(" / ") : "(none)"}`,
      ...(regenerated ? [`- Regenerate: ${regenerated}`] : []),
      `- Frames (${text.frames.length}): ${text.frames.map((f) => f.name).join(" · ")}`,
    ];
    // Each AI call's own reply, so what reached the canvas can be checked against what the model actually sent.
    const replies = await Promise.all(
      aiRequests.filter((r) => r.method() === "POST").map(async (r) => ({
        task: aiTaskOf(r),
        // The prompt too, so `e2e/local/replayVisualize.local.spec.ts` can answer each call with exactly its reply.
        prompt: (r.postDataJSON() as { request?: { prompt?: string } } | null)?.request?.prompt ?? "",
        reply: (await (await r.response())?.text().catch(() => "")) ?? "",
      })),
    );
    writeFileSync(join(dir, "ai-replies.json"), JSON.stringify(replies, null, 2));
    writeFileSync(join(dir, "report.md"), reportMarkdown(`${c.title} — run ${run}/${RUNS}`, all, visibleOnly, extra));
    writeFileSync(
      join(dir, "report.json"),
      JSON.stringify({ case: c.id, run, seconds, tasks, reviewText, coverageText, analysisText, appWarnings, sectionChips, regenerated, frames: text.frames, all, visibleOnly, promptTokens, completionTokens, usage: usageSnapshot }, null, 2),
    );
    await caption(page, `${c.title} — run ${run}/${RUNS}, fidelity ${all.score}/100`, `${all.units.covered}/${all.units.total} units · ${all.keyTerms.kept}/${all.keyTerms.total} key terms · ${all.skipped.length} skipped`);
    await look(page);
    test.info().annotations.push({ type: "fidelity", description: `run ${run}/${RUNS}: ${all.score}/100 (visible ${visibleOnly.score})` });

    const aiPlacedMatch = /AI placed (\d+)%/.exec(coverageText);
    if (!aiPlacedMatch) throw new Error(`run ${run}/${RUNS}: no "AI placed N%" in the coverage row (${coverageText || "coverage row not shown"})`);
    return { aiPlacedPct: Number(aiPlacedMatch[1]), visibleScore: visibleOnly.score, allScore: all.score, seconds, promptTokens, completionTokens };
}
