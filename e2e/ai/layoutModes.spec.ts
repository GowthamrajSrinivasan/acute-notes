/**
 * Note-taking modes, live (`.ai/docs/openui/note-taking-modes-plan-2026-11-23.md` Steps 6–7), with a real model:
 *
 *   A. Step 6 — on an AI-managed canvas, Visualize a document whose middle section is a sequence told in prose; does the
 *      model's outline make it a `flow` section, and does it become ONE FlowDiagram card? Then "Update from new content"
 *      with two changed details: is the card changed in place (no shapes, no removal)?
 *   B. Step 7 — "Ask AI to change…" on three layout cards (timeline, warning callout, comparison table) and "Ask AI to
 *      refresh" on one whose text changed: one request each; is the reply proposed (passes the canvas's check) or refused,
 *      and does an accepted layout draw? Every reply is saved for a human read of faithfulness (the check is structural).
 *
 * Costs money: REFUSES to run unless `LAYOUT_MODES_APPROVED_BY` says who approved it, and only under
 * `npm run test:e2e:ai`. Stops before the next paid step once the estimated spend passes `RUN_CAP_USD` (default 0.30) at
 * `PRICE_IN` / `PRICE_OUT` USD per million tokens (defaults 0.15 / 0.60; the provider's own bill is the real figure).
 *
 *   LAYOUT_MODES_APPROVED_BY="<name>" LAYOUT_MODES_OUT=<dir> \
 *     npm run test:e2e:ai -- --yes --provider=aicredits --trace off --output <dir> e2e/ai/layoutModes.spec.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Request } from "@playwright/test";
import { action, aiTaskOf, openApp, openAskAI, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { AI_TIMEOUT, reviewBar, visualizeDialog } from "../aiReview";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APPROVED_BY = (process.env.LAYOUT_MODES_APPROVED_BY ?? "").trim();
const OUT = process.env.LAYOUT_MODES_OUT ?? join(ROOT, "test-results", "layout-modes");
const CAP = Number(process.env.RUN_CAP_USD ?? 0.3);
const PRICE_IN = Number(process.env.PRICE_IN ?? 0.15);
const PRICE_OUT = Number(process.env.PRICE_OUT ?? 0.6);

function refusal(): string {
  if (!APPROVED_BY) return "LAYOUT_MODES_APPROVED_BY is not set: this run costs money and needs the user's approval";
  if (process.env.ACUTE_AI_E2E !== "1") return "run it through `npm run test:e2e:ai`, which asks before spending";
  return "";
}

const doc = (reviewers: string, minutes: number) => `# Shipping a release

## Why we have a process

Releases used to go out whenever a change was ready, and two bad weeks in the spring showed that this did not scale: a
deploy on a Friday evening took the payments page down for an hour, and nobody knew who could roll it back. The team
agreed on one way to ship, written down here so that new engineers can follow it without asking.

## Release process

Every release goes through the same steps, in the same order. First, the release manager freezes the main branch at 10:00
on Tuesday. Then CI builds the release candidate and runs the full test suite, about 4,000 tests. After that, ${reviewers}
reviewers approve the release candidate. Once it is approved, the on-call engineer deploys it to production in three
waves. Finally, the team watches error rates for ${minutes} minutes before closing the release.

## Who to ask

Questions about a release go to the release manager. Incidents go to the on-call engineer, who can roll back any wave.
`;

interface CallRecord {
  task: string;
  model: string;
  outcome: string;
  promptTokens?: number;
  completionTokens?: number;
  ms: number;
}
type El = { id: string; type: string; isDeleted?: boolean; text?: string; containerId?: string | null; customData?: { acute?: { documentId?: string } } };
type Dev = {
  api: { getSceneElements(): El[]; updateScene(s: Record<string, unknown>): void; scrollToContent(els: unknown[], o: Record<string, unknown>): void };
  store: { get(id: string): { snapshot: unknown; layout?: { lang: string; contentHash: string } } | null };
  callStats(clear?: boolean): Promise<{ records: CallRecord[] }>;
  proposeChanges(set: unknown): void;
};
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T | Promise<T>, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

const cost = (rs: readonly CallRecord[]) => rs.reduce((s, r) => s + ((r.promptTokens ?? 0) * PRICE_IN + (r.completionTokens ?? 0) * PRICE_OUT) / 1e6, 0);
function summary(rs: readonly CallRecord[]) {
  const byTask: Record<string, { calls: number; promptTokens: number; completionTokens: number; ms: number }> = {};
  for (const r of rs) {
    const t = (byTask[r.task] ??= { calls: 0, promptTokens: 0, completionTokens: 0, ms: 0 });
    t.calls++;
    t.promptTokens += r.promptTokens ?? 0;
    t.completionTokens += r.completionTokens ?? 0;
    t.ms += r.ms;
  }
  return { calls: rs.length, failed: rs.filter((r) => r.outcome !== "ok").length, usd: Number(cost(rs).toFixed(5)), models: [...new Set(rs.map((r) => r.model))], byTask };
}

async function saveReplies(requests: Request[], path: string) {
  const calls = await Promise.all(
    requests.filter((r) => r.method() === "POST").map(async (r) => {
      const req = (r.postDataJSON() as { request?: { prompt?: string } } | null)?.request ?? {};
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
      return { task: aiTaskOf(r), prompt: req.prompt ?? "", reply: out };
    }),
  );
  writeFileSync(path, `${JSON.stringify(calls, null, 2)}\n`);
  return calls;
}

/** Every live element whose block has a stored layout: its id, Lang, and whether the layout is a FlowDiagram. */
const layoutCards = (p: Page) =>
  dev(p, (d) =>
    d.api.getSceneElements().flatMap((e) => {
      const doc = !e.isDeleted ? e.customData?.acute?.documentId : undefined;
      const layout = doc ? d.store.get(doc)?.layout : undefined;
      return layout ? [{ id: e.id, lang: layout.lang }] : [];
    }),
  );
/** Bound text of native shapes (a flow drawn natively would show its steps here). */
const shapeTexts = (p: Page) => dev(p, (d) => d.api.getSceneElements().filter((e) => !e.isDeleted && e.type === "text" && e.containerId).map((e) => e.text ?? ""));

const block = (p: Page, id: string) => p.locator(`.acute-block[data-element-id="${id}"]`);
/** Centres the canvas on the card (Excalidraw only renders blocks in view). */
async function show(page: Page, id: string) {
  await dev(page, (d, x) => {
    d.api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} }, captureUpdate: "NEVER" });
    const el = d.api.getSceneElements().find((e) => e.id === x);
    if (el) d.api.scrollToContent([el], { fitToViewport: true, viewportZoomFactor: 0.5, animate: false });
  }, id);
  await page.waitForTimeout(300);
}
async function openCard(page: Page, id: string) {
  await show(page, id);
  const box = (await block(page, id).boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 3);
  await expect(block(page, id)).toHaveAttribute("data-active", "true");
}
/** A card's stored text (its document snapshot), for "was the text kept?". */
const textOf = (p: Page, id: string) =>
  dev(p, (d, x) => {
    const doc = d.api.getSceneElements().find((e) => e.id === x)?.customData?.acute?.documentId;
    return doc ? JSON.stringify(d.store.get(doc)?.snapshot ?? null) : null;
  }, id);
const leave = (p: Page) => dev(p, (d) => d.api.updateScene({ appState: { activeEmbeddable: null, selectedElementIds: {} } }));

// Shared by both groups. Each group has its own page, so a finding in one (Step 6) never stops the other (Step 7); the
// report is merged into the file on disk, which survives Playwright restarting the worker after a failed test.
let page: Page;
let aiRequests: Request[];
let spent = 0;
const report: Record<string, unknown> = {};
const writeReport = () => {
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, "report.json");
  const before = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>) : {};
  const total = Number(before.spentUsdEstimate ?? 0) - Number(before[`spent.${GROUP}`] ?? 0) + spent;
  const merged = { ...before, ...report, approvedBy: APPROVED_BY, priceInPerM: PRICE_IN, priceOutPerM: PRICE_OUT, cap: CAP, [`spent.${GROUP}`]: Number(spent.toFixed(5)), spentUsdEstimate: Number(total.toFixed(5)) };
  writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`);
};
let GROUP = "A";
const paid = async (label: string) => {
  const rs = (await dev(page, (d) => d.callStats(true))).records;
  spent += cost(rs);
  report[`${label}.calls`] = summary(rs);
  writeReport();
  return rs;
};

async function setUp(browser: import("@playwright/test").Browser, group: string) {
  GROUP = group;
  spent = 0;
  mkdirSync(OUT, { recursive: true });
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  aiRequests = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: /^AI-managed notes/ }).click();
  await expect(page.getByRole("radiogroup", { name: "View" }).getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
}

test.describe("A. Step 6 live: flow section → FlowDiagram card", () => {
  test.describe.configure({ mode: "serial", timeout: 900_000 });
  const why = refusal();
  test.skip(!!why, `layout modes run refused: ${why}`);
  test.beforeAll(async ({ browser }) => setUp(browser, "A"));
  test.afterAll(async () => {
    writeReport();
    await page?.context().close();
  });

  let flowCard: string | null = null;

  test("A1. Visualize on an AI-managed canvas: the sequence section becomes one FlowDiagram card", async () => {
    await dev(page, (d) => d.callStats(true));
    aiRequests.length = 0;
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(doc("two", 30));
    const distil = visualizeDialog(page).getByRole("checkbox", { name: /Distil into key ideas/ });
    report.distil = (await distil.count()) ? await distil.isChecked() : null;
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page).or(visualizeDialog(page).getByRole("alert"))).toBeVisible({ timeout: AI_TIMEOUT * 3 });
    await saveReplies(aiRequests, join(OUT, "A1-visualize-replies.json"));
    await paid("A1");
    expect(await reviewBar(page).isVisible(), "Visualize failed").toBe(true);
    const listed = await reviewBar(page).locator("[aria-label^='New layout card']").count();
    report["A1.newLayoutCardsInReview"] = listed;
    if (listed) {
      await reviewBar(page).getByRole("button", { name: "Preview layout" }).first().click();
        await expect(reviewBar(page).getByTestId("acute-layout-preview").first()).toBeVisible({ timeout: 15_000 });
      await expect(reviewBar(page).getByTestId("acute-layout-preview")).toBeVisible();
      await page.screenshot({ path: join(OUT, "A1-review-preview.png") });
    }
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden({ timeout: 30_000 });
    const cards = await layoutCards(page);
    const flows = cards.filter((c) => c.lang.startsWith("root = FlowDiagram("));
    report["A1.flowCards"] = flows.map((c) => c.lang);
    report["A1.nativeShapeTexts"] = await shapeTexts(page);
    writeReport();
    expect.soft(flows, "the model's outline made the sequence a plain flow section").toHaveLength(1);
    flowCard = flows[0]?.id ?? null;
    if (flowCard) await expect(block(page, flowCard).locator(".openui-flow")).toBeVisible();
    await page.screenshot({ path: join(OUT, "A1-canvas.png") });
  });

  test("A2. Update from new content: the flow card is changed in place", async () => {
    test.skip(!flowCard, "no flow card to update (see A1)");
    expect(spent, `spend cap ${CAP} reached before A2`).toBeLessThan(CAP);
    aiRequests.length = 0;
    const surface = await openAskAI(page, flowCard!);
    await (await action(surface, "Update from new content")).click();
    const update = page.getByRole("dialog", { name: "Update from new content" });
    await update.getByRole("textbox").fill(doc("three", 45));
    await update.getByRole("button", { name: "Update", exact: true }).click();
    await expect(reviewBar(page).or(update.getByRole("alert"))).toBeVisible({ timeout: AI_TIMEOUT * 3 });
    await saveReplies(aiRequests, join(OUT, "A2-update-replies.json"));
    await paid("A2");
    report["A2.reviewText"] = await reviewBar(page).innerText().catch(() => "");
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    const flows = (await layoutCards(page)).filter((c) => c.lang.startsWith("root = FlowDiagram("));
    report["A2.flowCardIds"] = flows.map((c) => c.id);
    report["A2.cardStillThere"] = flows.some((c) => c.id === flowCard);
    report["A2.nativeShapeTexts"] = await shapeTexts(page);
    const text = await dev(page, (d, x) => {
      const doc = d.api.getSceneElements().find((e) => e.id === x)?.customData?.acute?.documentId;
      return doc ? JSON.stringify(d.store.get(doc)?.snapshot ?? null) : null;
    }, flowCard!);
    report["A2.cardText"] = text;
    writeReport();
    await page.screenshot({ path: join(OUT, "A2-canvas.png") });
    expect.soft(report["A2.cardStillThere"], "the same card was updated in place").toBe(true);
    expect.soft(text ?? "", "the card shows the new detail").toMatch(/three|45/);
  });

});

test.describe("B. Step 7 live: Ask AI to change / refresh a layout card", () => {
  test.describe.configure({ mode: "serial", timeout: 900_000 });
  const why = refusal();
  test.skip(!!why, `layout modes run refused: ${why}`);
  test.beforeAll(async ({ browser }) => setUp(browser, "B"));
  test.afterAll(async () => {
    writeReport();
    await page?.context().close();
  });

  const CASES = [
    { key: "B1-timeline", title: "Onboarding a new engineer", body: "On day one they get a laptop and accounts. In week one they pair with a mentor on a small bug. By the end of month one they own a feature.", instruction: "Show this as a timeline." },
    { key: "B2-callout", title: "Database migration", body: "The migration must finish before 18 March. It locks the users table for about 5 minutes, so run it after 22:00.", instruction: "Put the deadline and the lock warning in a warning callout under a one-sentence summary." },
    { key: "B3-table", title: "Plans", body: "The Free plan has 5 GB of storage and costs $0. The Team plan has 200 GB of storage and costs $10 per user per month.", instruction: "Show the two plans as a comparison table." },
  ];
  const cardIds = new Map<string, string>();

  test("B0. three layout cards (no AI): created and accepted", async () => {
    const before = new Set((await dev(page, (d) => d.api.getSceneElements().map((e) => e.id))));
    await dev(page, (d, cases) =>
      d.proposeChanges({
        operationId: "op_live_cards",
        title: "Test cards",
        metadata: { createdBy: "mcp", task: "create_layout_card", provider: "Test Client" },
        changes: cases.map((c, i) => ({
          kind: "create_block",
          key: c.key,
          blockType: "text",
          content: [{ type: "paragraph", content: c.title }, { type: "paragraph", content: c.body }],
          box: { x: 3000 + i * 460, y: 3000, width: 420, height: 260 },
          layout: { lang: `root = IdeaCard(${JSON.stringify(c.title)}, ${JSON.stringify(c.body)})` },
        })),
      }),
      CASES,
    );
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
    const added = (await layoutCards(page)).filter((c) => !before.has(c.id));
    expect(added).toHaveLength(3);
    for (const c of CASES) cardIds.set(c.key, added.find((a) => a.lang.includes(JSON.stringify(c.title)))!.id);
  });

  for (const c of CASES) {
    test(`${c.key}: "${c.instruction}"`, async () => {
      expect(spent, `spend cap ${CAP} reached before ${c.key}`).toBeLessThan(CAP);
      const id = cardIds.get(c.key)!;
      const textBefore = await textOf(page, id);
      aiRequests.length = 0;
      await openCard(page, id);
      await block(page, id).getByRole("button", { name: "Ask AI to change…" }).click();
      const panel = block(page, id).getByTestId("acute-layout-ask");
      const layoutOnly = await panel.getByRole("checkbox", { name: /Layout only/ }).isChecked();
      await panel.getByRole("textbox").fill(c.instruction);
      await panel.getByRole("button", { name: "Ask AI" }).click();
      await expect(panel.getByText(/^Proposed — review it/).or(panel.getByRole("alert"))).toBeVisible({ timeout: AI_TIMEOUT });
      const replies = await saveReplies(aiRequests, join(OUT, `${c.key}-replies.json`));
      const rs = await paid(c.key);
      const proposed = await panel.getByText(/^Proposed — review it/).isVisible();
      const entry: Record<string, unknown> = { layoutOnly, requests: replies.filter((r) => r.task === "compose_card_layout").length, outcome: proposed ? "proposed" : "refused", reply: replies.at(-1)?.reply ?? "" };
      if (!proposed) entry.problems = await panel.getByRole("alert").innerText();
      else {
        const notes = panel.getByRole("list", { name: "Flagged for your review" });
        entry.flagged = (await notes.count()) ? await notes.innerText() : "";
        await panel.getByRole("button", { name: "Close" }).click();
        await reviewBar(page).getByRole("button", { name: "Preview layout" }).first().click();
        await expect(reviewBar(page).getByTestId("acute-layout-preview").first()).toBeVisible({ timeout: 15_000 });
        await page.screenshot({ path: join(OUT, `${c.key}-review.png`) });
        await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
        await expect(reviewBar(page)).toBeHidden();
        entry.stored = (await layoutCards(page)).find((x) => x.id === id)?.lang ?? null;
        entry.drawsStored = (await block(page, id).getByTestId("acute-openui-card").getAttribute("data-layout")) === "stored";
        entry.textKept = (await textOf(page, id)) === textBefore;
        await page.screenshot({ path: join(OUT, `${c.key}-accepted.png`) });
      }
      if (!proposed) await panel.getByRole("button", { name: "Cancel" }).click();
      await leave(page);
      report[c.key] = entry;
      writeReport();
      expect(entry.requests, "one request per click").toBe(1);
      expect(rs.length, "one model call").toBe(1);
    });
  }

  test("B4-refresh: the onboarding card's text changes; Ask AI to refresh", async () => {
    expect(spent, `spend cap ${CAP} reached before B4`).toBeLessThan(CAP);
    const id = cardIds.get("B1-timeline")!;
    await dev(page, (d, x) =>
      d.proposeChanges({
        operationId: "op_live_edit",
        title: "Edit",
        metadata: { createdBy: "mcp", task: "update_layout_card", provider: "Test Client" },
        changes: [{ kind: "update_block", target: x, content: [{ type: "paragraph", content: "Onboarding a new engineer" }, { type: "paragraph", content: "On day one they get a laptop and accounts. In week one they pair with a mentor on a small bug. By the end of month two they own a feature, and in month three they join the on-call rota." }] }],
      }),
      id,
    );
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
    await show(page, id);
    const chip = block(page, id).getByTestId("acute-layout-stale");
    await expect(chip).toContainText("Layout out of date");
    aiRequests.length = 0;
    await chip.getByRole("button", { name: "Ask AI to refresh" }).click();
    await chip.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(chip).toContainText(/Refresh proposed|Not proposed|failed|AI/, { timeout: AI_TIMEOUT });
    const replies = await saveReplies(aiRequests, join(OUT, "B4-refresh-replies.json"));
    const rs = await paid("B4-refresh");
    const entry: Record<string, unknown> = { requests: replies.filter((r) => r.task === "compose_card_layout").length, chip: await chip.innerText(), reply: replies.at(-1)?.reply ?? "" };
    if (await reviewBar(page).isVisible()) {
      await reviewBar(page).getByRole("button", { name: "Preview layout" }).first().click();
        await expect(reviewBar(page).getByTestId("acute-layout-preview").first()).toBeVisible({ timeout: 15_000 });
      await page.screenshot({ path: join(OUT, "B4-review.png") });
      await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
      await expect(reviewBar(page)).toBeHidden();
      entry.stored = (await layoutCards(page)).find((x) => x.id === id)?.lang ?? null;
      entry.staleAfter = await block(page, id).getByTestId("acute-layout-stale").count();
    }
    report["B4-refresh"] = entry;
    writeReport();
    expect(rs.length, "one model call").toBe(1);
  });
});
