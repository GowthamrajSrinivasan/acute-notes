/**
 * OpenUI Notes view, live (`.ai/docs/openui-integration-plan.md` Phases 1–2): for each golden source, with a real model,
 *
 *   A. today's path — Visualize in distil mode, accepted (this also stores the source and its units);
 *   B. the OpenUI path — Notes → "Generate from source" (`generate_openui_notes`), cards streamed into the view;
 *   C. promotion — "Pin to canvas" on the first generated card: one new card, linked to the source, one undo step.
 *
 * A vs B is the Phase 1 cost benchmark (provider-reported tokens per call, from the app's call log): same source, same
 * model, measured per card produced. It is not the same work — A also lays out the canvas and checks fidelity — so the
 * report gives each path's calls by task, not only totals.
 *
 * Costs money: REFUSES to run unless `OPENUI_NOTES_APPROVED_BY` says who approved it, and only under
 * `npm run test:e2e:ai`. Stops before the next paid step once the estimated spend passes `RUN_CAP_USD` (default 0.30)
 * at `PRICE_IN` / `PRICE_OUT` USD per million tokens (default google/gemini-2.5-flash list prices, 0.30 / 2.50).
 *
 *   OPENUI_NOTES_APPROVED_BY="<name>" OPENUI_NOTES_OUT=<dir> ACUTE_TEST_OPENROUTER_MODEL=google/gemini-2.5-flash \
 *     npm run test:e2e:ai -- --yes --provider=openrouter --trace off --output <dir> e2e/ai/openuiNotes.spec.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, openApp, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { AI_TIMEOUT, reviewBar, visualizeDialog } from "../aiReview";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CASES = (process.env.OPENUI_NOTES_CASES ?? "kn-01-idempotency-keys,kn-02-edge-cache-invalidation").split(",").map((s) => s.trim()).filter(Boolean);
const APPROVED_BY = (process.env.OPENUI_NOTES_APPROVED_BY ?? "").trim();
const OUT = process.env.OPENUI_NOTES_OUT ?? join(ROOT, "test-results", "openui-notes");
const CAP = Number(process.env.RUN_CAP_USD ?? 0.3);
const PRICE_IN = Number(process.env.PRICE_IN ?? 0.3);
const PRICE_OUT = Number(process.env.PRICE_OUT ?? 2.5);

function refusal(): string {
  if (!APPROVED_BY) return "OPENUI_NOTES_APPROVED_BY is not set: this run costs money and needs the user's approval";
  if (process.env.ACUTE_AI_E2E !== "1") return "run it through `npm run test:e2e:ai`, which asks before spending";
  return "";
}

interface CallRecord {
  task: string;
  model: string;
  outcome: string;
  note?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
  ms: number;
}
type Dev = {
  api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[]; updateScene(s: { elements: unknown[] }): void };
  reconciliation(id: string): Promise<{ link: { contentSourceId: string; sourceUnits?: string[]; excludeFromReconciliation?: boolean } | null } | null>;
  contentSource(id: string): Promise<{ version: { version: number } } | null>;
  callStats(clear?: boolean): Promise<{ records: CallRecord[] }>;
  setNoteModel?: (model: "preserve" | "distil") => Promise<string>;
};
const dev = <T, A = string>(p: Page, fn: (d: Dev, arg: A) => Promise<T> | T, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

const cost = (rs: readonly CallRecord[]) => rs.reduce((s, r) => s + ((r.promptTokens ?? 0) * PRICE_IN + (r.completionTokens ?? 0) * PRICE_OUT) / 1e6, 0);
function summary(rs: readonly CallRecord[]) {
  const byTask: Record<string, { calls: number; promptTokens: number; completionTokens: number; reasoningTokens: number; ms: number }> = {};
  for (const r of rs) {
    const t = (byTask[r.task] ??= { calls: 0, promptTokens: 0, completionTokens: 0, reasoningTokens: 0, ms: 0 });
    t.calls++;
    t.promptTokens += r.promptTokens ?? 0;
    t.completionTokens += r.completionTokens ?? 0;
    t.reasoningTokens += r.reasoningTokens ?? 0;
    t.ms += r.ms;
  }
  const sum = (k: "promptTokens" | "completionTokens") => rs.reduce((s, r) => s + (r[k] ?? 0), 0);
  return { calls: rs.length, failed: rs.filter((r) => r.outcome !== "ok").length, promptTokens: sum("promptTokens"), completionTokens: sum("completionTokens"), usd: Number(cost(rs).toFixed(5)), models: [...new Set(rs.map((r) => r.model))], byTask };
}

/** Live distil cards on the canvas (rich blocks with a source link and cited units). */
const cardCount = (p: Page) =>
  dev(p, async (d) => {
    let n = 0;
    for (const el of d.api.getSceneElements()) {
      if (el.isDeleted || !el.customData?.acute?.documentId) continue;
      if ((await d.reconciliation(el.id))?.link?.sourceUnits?.length) n++;
    }
    return n;
  });
const liveIds = (p: Page) => dev(p, (d) => d.api.getSceneElements().filter((e) => !e.isDeleted).map((e) => e.id));

/** Characters sent and received per AI call, from the browser's own requests (streamed replies are NDJSON deltas). */
interface CallChars {
  task?: string;
  inChars: number;
  outChars: number;
}
async function saveReplies(requests: Request[], path: string): Promise<CallChars[]> {
  const calls = await Promise.all(
    requests.filter((r) => r.method() === "POST").map(async (r) => {
      const req = (r.postDataJSON() as { request?: { systemPrompt?: string; prompt?: string } } | null)?.request ?? {};
      const body = (await (await r.response())?.text().catch(() => "")) ?? "";
      let out = "";
      try {
        out = (JSON.parse(body) as { text?: string }).text ?? "";
      } catch {
        for (const line of body.split("\n")) {
          try {
            out += (JSON.parse(line) as { delta?: string }).delta ?? "";
          } catch {
            /* not a delta line */
          }
        }
      }
      return { task: aiTaskOf(r), inChars: (req.systemPrompt ?? "").length + (req.prompt ?? "").length, outChars: out.length, reply: out };
    }),
  );
  writeFileSync(path, `${JSON.stringify(calls, null, 2)}\n`);
  return calls.map(({ task, inChars, outChars }) => ({ task, inChars, outChars }));
}
const chars = (cs: CallChars[]) => ({ inChars: cs.reduce((s, c) => s + c.inChars, 0), outChars: cs.reduce((s, c) => s + c.outChars, 0) });

test.describe("OpenUI Notes view (live)", () => {
  test.describe.configure({ mode: "serial", timeout: 900_000 });
  const why = refusal();
  test.skip(!!why, `openui notes run refused: ${why}`);

  let page: Page;
  let aiRequests: Request[];
  let spent = 0;
  const report: Record<string, unknown> = { approvedBy: APPROVED_BY, at: new Date().toISOString(), priceInPerM: PRICE_IN, priceOutPerM: PRICE_OUT, cap: CAP, cases: {} };
  const writeReport = () => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ ...report, spentUsdEstimate: Number(spent.toFixed(5)) }, null, 2)}\n`);
  };

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    aiRequests = recordAIRequests(page);
    await openApp(page);
    await connectAI(page);
    const model = await dev(page, (d) => (d.setNoteModel ? d.setNoteModel("distil") : null));
    if (model !== "distil") throw new Error(`the app didn't switch to the distil note model (got ${String(model)})`);
    await expect(page.getByTestId("toolbar-acute-notes")).toBeVisible();
  });

  test.afterAll(async () => {
    writeReport();
    await page?.context().close();
  });

  for (const caseId of CASES) {
    test(caseId, async () => {
      const sourcePath = join(ROOT, "evaluation", "knowledge-notes", "cases", caseId, "source.md");
      expect(existsSync(sourcePath), sourcePath).toBe(true);
      const source = readFileSync(sourcePath, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
      const dir = join(OUT, caseId);
      mkdirSync(dir, { recursive: true });
      const entry: Record<string, unknown> = { sourceChars: source.length };
      (report.cases as Record<string, unknown>)[caseId] = entry;
      expect(spent, `spend cap ${CAP} reached before ${caseId}`).toBeLessThan(CAP);

      await dev(page, (d) => d.api.updateScene({ elements: [] }));
      await dev(page, (d) => d.callStats(true));
      aiRequests.length = 0;

      // A. Today's path: Visualize (distil), accepted.
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Visualize content…" }).click();
      await visualizeDialog(page).getByRole("textbox").fill(source);
      await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
      await expect(reviewBar(page).or(visualizeDialog(page).getByRole("alert"))).toBeVisible({ timeout: AI_TIMEOUT * 3 });
      const aChars = await saveReplies(aiRequests, join(dir, "replies-visualize.json"));
      const a = (await dev(page, (d) => d.callStats(true))).records;
      spent += cost(a);
      expect(await reviewBar(page).isVisible(), "Visualize failed").toBe(true);
      await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
      await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added");
      await expect.poll(() => cardCount(page), { timeout: 15_000 }).toBeGreaterThan(0);
      const visualizeCards = await cardCount(page);
      entry.visualize = { ...summary(a), ...chars(aChars), cards: visualizeCards };
      writeReport();
      expect(spent, `spend cap ${CAP} reached after Visualize`).toBeLessThan(CAP);

      // B. The OpenUI path: Notes → Generate from source, streamed.
      await page.getByTestId("toolbar-acute-notes").click();
      const view = page.getByTestId("acute-notes-view");
      await expect(view).toBeVisible();
      entry.notesViewCanvasNotes = await view.locator(".acute-notes__note").count();
      const generate = view.getByRole("button", { name: "Generate from source" });
      await expect(generate).toBeEnabled({ timeout: 15_000 });
      aiRequests.length = 0;
      await generate.click();
      const generated = view.locator(".acute-notes__generated");
      // Streaming: the section is busy while blocks arrive; sample how many cards were visible mid-stream.
      const samples: number[] = [];
      const started = Date.now();
      let status: string | null = null;
      while (Date.now() - started < AI_TIMEOUT) {
        status = await generated.getAttribute("data-status", { timeout: 1_000 }).catch(() => null);
        samples.push(await generated.locator(".acute-notes__note").count().catch(() => 0));
        if (status === "done" || status === "error") break;
        await page.waitForTimeout(400);
      }
      entry.generatedHtmlHead = await generated.evaluate((e) => e.outerHTML.slice(0, 300)).catch((err: unknown) => `not found: ${String(err).slice(0, 200)}`);
      writeReport();
      const bChars = await saveReplies(aiRequests, join(dir, "replies-openui.json"));
      const b = (await dev(page, (d) => d.callStats(true))).records;
      // A streamed call reports no usage (runtime.ts): estimate it at path A's provider-reported chars-per-token ratio.
      const ratioIn = (entry.visualize as { promptTokens: number }).promptTokens ? chars(aChars).inChars / (entry.visualize as { promptTokens: number }).promptTokens : 4;
      const ratioOut = (entry.visualize as { completionTokens: number }).completionTokens ? chars(aChars).outChars / (entry.visualize as { completionTokens: number }).completionTokens : 4;
      const bc = chars(bChars);
      const est = { promptTokens: Math.round(bc.inChars / ratioIn), completionTokens: Math.round(bc.outChars / ratioOut) };
      const bUsd = (est.promptTokens * PRICE_IN + est.completionTokens * PRICE_OUT) / 1e6;
      spent += cost(b) || bUsd;
      entry.openui = { ...summary(b), ...bc, estimated: { ...est, usd: Number(bUsd.toFixed(5)), charsPerTokenIn: Number(ratioIn.toFixed(2)), charsPerTokenOut: Number(ratioOut.toFixed(2)) }, streamSamples: samples };
      writeReport();
      const alert = (await generated.getByRole("alert").count()) ? await generated.getByRole("alert").first().textContent({ timeout: 1_000 }) : null;
      expect(alert, "Generate from source failed").toBeNull();
      expect(status, "generation did not finish").toBe("done");
      const genCards = await generated.locator(".openui-idea-card").count();
      const pinnable = generated.getByRole("button", { name: /^Pin (to canvas|\(needs review\))$/ });
      entry.openui = { ...(entry.openui as object), blocks: await generated.locator(".acute-notes__note").count(), ideaCards: genCards, pinnable: await pinnable.count(), streamSamples: samples, sawPartial: samples.some((n) => n > 0 && n < Math.max(...samples)) };
      // The free source check (notesCheck.ts): its summary, and how many cards it flags.
      const check = generated.getByTestId("acute-notes-check");
      entry.check = { summary: (await check.count()) ? ((await check.textContent()) ?? "").trim() : null, flaggedCards: await generated.getByTestId("acute-notes-card-review").count() };
      await generated.screenshot({ path: join(dir, "generated.png") });
      writeReport();

      // C. Promotion: pin the first generated card.
      expect(await pinnable.count(), "no pinnable card").toBeGreaterThan(0);
      const before = new Set(await liveIds(page));
      await pinnable.first().click();
      await expect(generated.getByRole("button", { name: "Show on canvas" }).first()).toBeVisible({ timeout: 15_000 });
      const added = (await liveIds(page)).filter((id) => !before.has(id));
      const links = await Promise.all(added.map((id) => dev(page, (d, x) => d.reconciliation(x).then((r) => r?.link ?? null), id)));
      const card = links.find((l) => l?.sourceUnits?.length);
      entry.pin = { newElements: added.length, link: card ?? links.find(Boolean) ?? null };
      expect(added.length).toBeGreaterThan(0);
      // Back to the canvas: the pinned card is there; one undo removes the whole pin.
      await page.getByRole("button", { name: "Show on canvas" }).first().click();
      await expect(view).toBeHidden();
      await page.screenshot({ path: join(dir, "pinned-on-canvas.png") });
      await page.keyboard.press("Control+z");
      await expect.poll(async () => (await liveIds(page)).filter((id) => !before.has(id)).length).toBe(0);
      (entry.pin as Record<string, unknown>).undoRemovesIt = true;
      writeReport();
    });
  }
});
