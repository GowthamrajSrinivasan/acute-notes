/**
 * Chat-share import (C1) against real ChatGPT share links and a real model. The three links are a chat, a branch of it,
 * and a branch of that branch (memory `chatgpt-test-share-links`). Run with the typed decision model (Jev) on OpenRouter:
 *
 *   ACUTE_AI_DECISION_KIND=typed ACUTE_AI_DECISION_CONNECTION=openrouter ACUTE_AI_DECISION_MODEL=typesafe/jev-1.13 \
 *   ACUTE_TEST_OPENROUTER_MODEL=openai/gpt-oss-120b \
 *   npm run test:e2e:ai -- --yes --provider=openrouter --trace off --output <scratch dir> e2e/ai/chatShare.spec.ts
 *
 * Steps: (1) the real import route reads all three links and the branch-skip layer keeps each turn once (no AI);
 * (2) the first chat alone is visualized as notes; (3) all three links are imported again and merged into those notes
 * (the first chat's turns are repeats and are left out before any model call; the branches' new turns are filed by the
 * model, with Jev answering the typed questions). Guarantees are hard assertions; model judgement is soft. Prompts,
 * replies and decision-model traffic are attached to the report.
 */
import { appendFileSync } from "node:fs";
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, openApp, promptOf, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { reviewBar } from "../aiReview";

const AI_TIMEOUT = 900_000;
const LINKS = [
  "https://chatgpt.com/share/6ac75678-829c-83ee-aaf4-badd93c19df4",
  "https://chatgpt.com/share/6ac75691-b3c8-83e8-a831-880f86f446c8",
  "https://chatgpt.com/share/6ac756a0-6a40-83ee-85f7-30bc59bbe977",
];

/** An annotation on the report, and (STATS_FILE) a line of evidence, since the report truncates long values. */
const note = (type: string, description: string) => {
  test.info().annotations.push({ type, description });
  if (process.env.STATS_FILE) appendFileSync(process.env.STATS_FILE, `${JSON.stringify({ note: type, description })}
`);
};

/**
 * The OpenRouter account's balance and usage (read-only, costs nothing): billing is the primary cost evidence; token
 * estimates only say where it went. Usage by anything else on the account in the same window is included, so the
 * start and end are recorded and the window is short.
 */
async function credits(label: string): Promise<number | null> {
  const key = process.env.ACUTE_TEST_OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/credits", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    const { data } = (await res.json()) as { data: { total_credits: number; total_usage: number } };
    note(`credits ${label}`, JSON.stringify({ at: new Date().toISOString(), totalCredits: data.total_credits, totalUsage: data.total_usage }));
    return data.total_usage;
  } catch {
    return null;
  }
}

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const mainBox = (p: Page) => visualizeDialog(p).locator("textarea.acute-visualize-dialog__text").first();
const already = (p: Page) => p.getByText("Everything in this content is already in your notes.");

type Dev = {
  contentSource(id: string): Promise<{ source: { tier: string; template: string; latestVersion: number }; version: { text: string } } | null>;
  reconciliation(id: string): Promise<{ link: { contentSourceId: string } | null } | null>;
  api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean }[] };
};
const dev = <T,>(p: Page, fn: (d: Dev, arg: string) => Promise<T> | T, arg = "") =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;
const source = (p: Page, id: string) => dev(p, (d, i) => d.contentSource(i), id);
const frameCount = (p: Page) => dev(p, (d) => d.api.getSceneElements().filter((e) => e.type === "frame" && !e.isDeleted).length);
const firstSourceId = (p: Page) =>
  dev(p, async (d) => {
    for (const el of d.api.getSceneElements()) {
      const link = (await d.reconciliation(el.id))?.link;
      if (link) return link.contentSourceId;
    }
    return null;
  });

async function openVisualize(p: Page) {
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await expect(visualizeDialog(p)).toBeVisible();
}

/** Adds links through the real import route and waits until each has either loaded or failed. */
async function importLinks(p: Page, links: string[]) {
  const dialog = visualizeDialog(p);
  const panel = dialog.locator("details.acute-shared-chats");
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) await panel.locator("summary").click();
  await dialog.getByRole("textbox", { name: "Share links" }).fill(links.join("\n"));
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect(dialog.getByText("Loading…")).toHaveCount(0, { timeout: 90_000 });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
}

/** Attaches every model and decision-model call of a step. */
/** The provider-reported token counts in a host reply body, when it has them. */
function usageOf(body: string | undefined): { promptTokens?: number; completionTokens?: number } {
  try {
    const u = (JSON.parse(body ?? "{}") as { usage?: { promptTokens?: number; completionTokens?: number } }).usage;
    return { ...(u?.promptTokens != null ? { promptTokens: u.promptTokens } : {}), ...(u?.completionTokens != null ? { completionTokens: u.completionTokens } : {}) };
  } catch {
    return {};
  }
}

async function attachTraffic(label: string, requests: Request[]) {
  let decide = 0;
  for (const [i, r] of requests.filter((q) => q.method() === "POST").entries()) {
    const path = new URL(r.url()).pathname;
    const res = await r.response();
    const body = await res?.text().catch(() => "(no body)");
    // Per-call evidence (the report truncates attachments): STATS_FILE gets one JSON line per call.
    if (process.env.STATS_FILE) {
      const t = r.timing();
      const prompt = path === "/api/ai/decide" ? (r.postData() ?? "") : promptOf(r);
      appendFileSync(process.env.STATS_FILE, JSON.stringify({ step: label, path, task: aiTaskOf(r) ?? (path === "/api/ai/decide" ? "decide" : undefined), status: res?.status(), ms: t.responseEnd > 0 ? Math.round(t.responseEnd) : null, promptChars: prompt.length, replyChars: (body ?? "").length, ...usageOf(body) }) + "\n");
    }
    if (path === "/api/ai/decide") {
      decide++;
      await test.info().attach(`${label} — decide ${decide} (${res?.status()})`, { body: `REQUEST:\n${r.postData() ?? ""}\n\nREPLY:\n${body ?? ""}`, contentType: "text/plain" });
    } else if (aiTaskOf(r)) {
      await test.info().attach(`${label} — ${aiTaskOf(r)} ${i + 1}`, { body: `PROMPT:\n${promptOf(r)}\n\nREPLY:\n${body ?? ""}`, contentType: "text/plain" });
    }
  }
  const tasks = requests.filter((r) => r.method() === "POST").map((r) => (new URL(r.url()).pathname === "/api/ai/decide" ? "DECIDE (typed)" : aiTaskOf(r)));
  note(`${label} calls`, tasks.join(", ") || "none");
  return { decide, tasks };
}

test("ChatGPT share links: branch-skip on real chats, visualize, then merge the branches into the notes", async ({ browser }) => {
  test.setTimeout(3_600_000);
  const page = await browser.newPage();
  const requests: Request[] = recordAIRequests(page);
  // Live evidence (STATS_FILE): every AI call's start and end as it happens, so a hang still leaves a trail.
  const clock = Date.now();
  const startedAt = new Map<Request, number>();
  const live = (r: Request, event: string, extra: Record<string, unknown> = {}) => {
    if (!process.env.STATS_FILE || !new URL(r.url()).pathname.startsWith("/api/ai/")) return;
    const path = new URL(r.url()).pathname;
    const task = path === "/api/ai/decide" ? "decide" : aiTaskOf(r);
    appendFileSync(process.env.STATS_FILE, `${JSON.stringify({ live: event, at: Math.round((Date.now() - clock) / 1000), path, task, took: startedAt.has(r) ? Date.now() - startedAt.get(r)! : undefined, ...extra })}
`);
  };
  page.on("request", (r) => {
    startedAt.set(r, Date.now());
    live(r, "start");
  });
  // Cost control that does not depend on the credits balance (which lags by minutes). Prices are USD per million tokens:
  // CHAT_PRICE_IN / CHAT_PRICE_OUT (default gemini-2.5-flash) and JEV_PRICE_IN. Each call's cost is the provider-reported tokens when the
  // host's reply carries them (output tokens then include a model's hidden reasoning) and otherwise a CONSERVATIVE estimate from the
  // characters sent and received (3 per token, visible output times 1.5 for reasoning), marked costSource "estimated".
  // Before a call goes out, if the money spent plus what is in flight plus its predicted cost would pass RUN_CAP_USD, it is aborted, so
  // the run stops BEFORE the next request instead of after it (the app then fails that step: an incomplete benchmark, never a second try).
  const PRICE = { chatIn: Number(process.env.CHAT_PRICE_IN ?? 0.3) / 1e6, chatOut: Number(process.env.CHAT_PRICE_OUT ?? 2.5) / 1e6, jevIn: Number(process.env.JEV_PRICE_IN ?? 0.042) / 1e6 };
  const CAP_USD = Number(process.env.RUN_CAP_USD ?? 0.45);
  /** Billed cost over provider-reported tokens at list prices: 0.786 measured on the benchmark of 2026-10-10 ($0.3837 billed, $0.4882 by tokens). */
  const COST_SCALE = Number(process.env.COST_SCALE ?? 0.8);
  /** Output tokens assumed for a chat call before it returns (the median reply was about 1k visible tokens; times 1.5 for reasoning). */
  const ASSUMED_OUT_TOKENS = 2000;
  let reportedUsd = 0;
  let capped = false;
  const inflight = new Map<Request, number>();
  const projected = () => reportedUsd + [...inflight.values()].reduce((a, b) => a + b, 0);
  const predictedCost = (r: Request) => {
    const inTokens = Math.ceil((r.postData() ?? "").length / 3);
    return new URL(r.url()).pathname === "/api/ai/decide" ? inTokens * PRICE.jevIn : inTokens * PRICE.chatIn + ASSUMED_OUT_TOKENS * PRICE.chatOut;
  };
  await page.route("**/api/ai/**", async (route) => {
    const r = route.request();
    const path = new URL(r.url()).pathname;
    if (r.method() !== "POST" || !(path === "/api/ai/run" || path === "/api/ai/stream" || path === "/api/ai/decide")) return route.continue();
    const predicted = predictedCost(r);
    if (projected() + predicted > CAP_USD) {
      if (!capped) {
        capped = true;
        note("cap reached", `spent ${reportedUsd.toFixed(3)} + in flight and the next call would pass ${CAP_USD}: this and every later AI call is refused; the benchmark is INCOMPLETE`);
      }
      return route.abort();
    }
    inflight.set(r, predicted);
    return route.continue();
  });
  page.on(
    "requestfinished",
    (r) =>
      void (async () => {
        const path = new URL(r.url()).pathname;
        if (!path.startsWith("/api/ai/")) return;
        const res = await r.response();
        const text = (await res?.text().catch(() => "")) ?? "";
        let usage: { promptTokens?: number; completionTokens?: number } | undefined;
        try {
          usage = (JSON.parse(text) as { usage?: typeof usage })?.usage;
        } catch {
          /* a reply that isn't JSON has no usage */
        }
        const reported = usage?.promptTokens != null;
        const promptTokens = usage?.promptTokens ?? Math.ceil((path === "/api/ai/decide" ? (r.postData() ?? "") : promptOf(r)).length / 3);
        const completionTokens = usage?.completionTokens ?? Math.ceil((text.length / 3) * 1.5);
        const costUsd = (path === "/api/ai/decide" ? promptTokens * PRICE.jevIn : promptTokens * PRICE.chatIn + completionTokens * PRICE.chatOut) * COST_SCALE;
        inflight.delete(r);
        reportedUsd += costUsd;
        live(r, "end", { status: res?.status(), promptTokens, completionTokens, costSource: reported ? "reported" : "estimated", costUsd: Number(costUsd.toFixed(6)), runningUsd: Number(reportedUsd.toFixed(4)) });
      })(),
  );
  page.on("requestfailed", (r) => {
    inflight.delete(r);
    live(r, "failed", { error: r.failure()?.errorText });
  });
  await openApp(page);
  await connectAI(page);
  const usageStart = await credits("start");
  let usageAfterFirst: number | null = null;
  let sourceId = "";
  let firstTurn = "";
  let branchOnly = "";

  await test.step("1. the real import route reads three links; every turn is kept once (no AI)", async () => {
    await openVisualize(page);
    await importLinks(page, [...LINKS, LINKS[0]!]);
    const dialog = visualizeDialog(page);
    await expect(dialog.getByText("1 duplicate link ignored")).toBeVisible();
    await expect(dialog.getByText("4 of 4 turns will be analysed")).toBeVisible();
    await expect(dialog.getByText(/4 of 8 turns will be analysed · 4 of 8 turns already in "AI App Builder Ecosystem" — skipped/)).toBeVisible();
    await expect(dialog.getByText(/10 of 18 turns will be analysed · 8 of 18 turns already in "Branch · AI App Builder Ecosystem" — skipped/)).toBeVisible();
    await dialog.getByRole("button", { name: "Use these 3 chats" }).click();
    const text = await mainBox(page).inputValue();
    // The user's turns are block quotes (layout D), so a turn's opening is the text after "> ".
    firstTurn = text.match(/\n> (.{60})/)?.[1] ?? "";
    expect(firstTurn.length).toBe(60);
    expect(text.split(firstTurn), "the opening question is in the text once, not once per chat").toHaveLength(2);
    // a turn only the last branch has
    branchOnly = [...text.matchAll(/\n> (.{50})/g)].map((m) => m[1]!).at(-1)!;
    note("import size", `${text.length.toLocaleString("en-US")} characters kept of 172,000 across the three chats`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  await test.step("2. the first chat alone becomes notes (real model, Auto)", async () => {
    await openVisualize(page);
    await importLinks(page, [LINKS[0]!]);
    await visualizeDialog(page).getByRole("button", { name: "Use this chat" }).click();
    requests.length = 0;
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click({ timeout: 30_000 });
    await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
    await attachTraffic("first chat", requests);
    note("first chat review", (await reviewBar(page).innerText()).replace(/\s+/g, " "));
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
    sourceId = (await firstSourceId(page))!;
    expect(sourceId).toBeTruthy();
    const s = await source(page, sourceId);
    expect.soft(s?.source.tier, "the chat went through the model's outline").toBe("ai");
    expect(s?.version.text).toContain(firstTurn);
    note("frames after first chat", String(await frameCount(page)));
    usageAfterFirst = await credits("after first chat");
    if (usageStart != null && usageAfterFirst != null) note("cost first chat (billed USD)", (usageAfterFirst - usageStart).toFixed(4));
  });

  await test.step("3. all three links merged into those notes: repeats left out, the branches' new turns filed", async () => {
    await openVisualize(page);
    await importLinks(page, LINKS);
    await visualizeDialog(page).getByRole("button", { name: "Use these 3 chats" }).click();
    await expect(visualizeDialog(page).getByRole("radio", { name: /Merge into existing notes/ })).toBeChecked();
    requests.length = 0;
    if (process.env.ECONOMY === "1") await visualizeDialog(page).getByRole("checkbox", { name: "Add new text as plain cards, no AI" }).check();
    await visualizeDialog(page).getByRole("button", { name: "Merge", exact: true }).click({ timeout: 30_000 });
    // Attach the traffic even when the merge fails, so a timeout can be traced to the call that caused it.
    const finished = await expect(reviewBar(page).or(already(page)).first()).toBeVisible({ timeout: 600_000 }).then(() => null, (e: Error) => e);
    const toastNow = await page.locator(".excalidraw .Toast, [role=status]").allInnerTexts().catch(() => []);
    note("merge messages", toastNow.join(" | "));
    // The merge's own counters (batches, who answered, and the regeneration counts once they exist), as the app recorded them.
    const diagnostics = await page.evaluate(() => (window as unknown as { __acuteDev: { lastMerge?: () => Promise<unknown> } }).__acuteDev.lastMerge?.()).catch(() => null);
    note("merge diagnostics", JSON.stringify(diagnostics ?? null));
    const { decide, tasks } = await attachTraffic("merge", requests);
    if (finished) throw finished;
    // Assignment is answered by the chat task or, with the typed model on, by Jev batches ("DECIDE (typed)").
    expect.soft(tasks.includes("assign_to_topics") || tasks.includes("DECIDE (typed)"), "the branches' new content is assigned to topics").toBe(true);
    expect.soft(decide, "the typed decision model (Jev) answered at least once").toBeGreaterThan(0);
    const toast = await page.locator(".excalidraw .Toast").innerText().catch(() => "");
    if (toast) note("merge toast", toast);
    await expect(reviewBar(page), "the branches add something").toBeVisible();
    await reviewBar(page).getByRole("button", { name: "Review" }).click();
    const summary = (await reviewBar(page).innerText()).replace(/\s+/g, " ");
    note("merge review", summary);
    expect.soft(summary, "a merge never removes").not.toMatch(/removed/);
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
    const s = (await source(page, sourceId))!;
    expect(s.source.latestVersion, "the same source's next version").toBe(2);
    expect(s.version.text.split(firstTurn), "the first chat's opening is still in the notes once").toHaveLength(2);
    expect(s.version.text, "the last branch's own turn arrived").toContain(branchOnly);
    note("frames after merge", String(await frameCount(page)));
    const usageEnd = await credits("after merge");
    if (usageStart != null && usageEnd != null) note("cost whole run (billed USD)", (usageEnd - usageStart).toFixed(4));
    if (usageAfterFirst != null && usageEnd != null) note("cost merge step (billed USD)", (usageEnd - usageAfterFirst).toFixed(4));
  });
});
