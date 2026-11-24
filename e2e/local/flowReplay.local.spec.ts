/**
 * Replay of the 2026-11-24 live run (`.ai/docs/openui/live-runs/2026-11-24-layout-modes/run2`): the model's saved replies
 * are served back to the real app (no AI cost, no network), first Visualize and then "Update from new content", on an
 * AI-managed canvas (flow card) and on a Manual one (native shapes). Records every change each update proposes, with
 * stable keys, and screenshots — to tell whether the update's extra additions/removals come from the flow card.
 *
 * Diagnostic: it asserts only that both runs complete; the findings are in `test-results/flow-replay/*.json`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { AIRequest } from "../../src/ai/types";
import { action, openAISettings, openApp, openAskAI } from "../helpers";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RUN = join(ROOT, ".ai/docs/openui/live-runs/2026-11-24-layout-modes/run2");
const OUT = join(ROOT, "test-results/flow-replay");
type Saved = { task: string; prompt: string; reply: string };
const load = (f: string) => JSON.parse(readFileSync(join(RUN, f), "utf8")) as Saved[];
const SAVED = [...load("A1-visualize-replies.json"), ...load("A2-update-replies.json")];

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

const sectionOf = (prompt: string) => /^This is one section, "([^"]+)"/.exec(prompt)?.[1] ?? "";

/** Answers each AI call with the saved reply for the same task and prompt; else the next unused one for the task (and section). */
async function replay(page: Page, log: { task: string; matched: "exact" | "fallback" | "none" }[]) {
  const used = new Set<number>();
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: AIRequest };
    const task = body.request?.task ?? "";
    const prompt = body.request?.prompt ?? "";
    let i = SAVED.findIndex((s, n) => !used.has(n) && s.task === task && s.prompt === prompt);
    let matched: "exact" | "fallback" | "none" = "exact";
    if (i < 0) {
      matched = "fallback";
      i = SAVED.findIndex((s, n) => !used.has(n) && s.task === task && sectionOf(s.prompt) === sectionOf(prompt));
    }
    if (i < 0) matched = "none";
    else used.add(i);
    log.push({ task, matched });
    const text = i >= 0 ? SAVED[i]!.reply : task === "match_statements" ? JSON.stringify({ matches: [] }) : "{}";
    return route.fulfill({ status: 200, json: { text, model: "replay", finishReason: "stop", usage: { provider: "openai", model: "replay" } } });
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

const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

type Dev = {
  api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean; text?: string; containerId?: string | null; customData?: { acute?: { documentId?: string } } }[]; scrollToContent(e?: unknown, o?: unknown): void };
  store: { get(id: string): { snapshot: unknown; layout?: { lang: string } } | null };
  pending(): { title: string; changes: Record<string, unknown>[] } | null;
  reconciliation(id: string): Promise<{ link: { stableNodeKey: string } | null } | null>;
};
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T | Promise<T>, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

/** The set under review, one line per change: kind, key / target (with the target's stable key) and a text snippet. */
const pendingSummary = (p: Page) =>
  dev(p, async (d) => {
    const set = d.pending();
    if (!set) return null;
    const keyOf = async (id: string) => (await d.reconciliation(id))?.link?.stableNodeKey ?? null;
    const lines: string[] = [];
    for (const c of set.changes) {
      const kind = String(c.kind);
      const snippet = JSON.stringify(c.content ?? c.label ?? c.title ?? "").slice(0, 90);
      if (kind === "remove" || kind.startsWith("update")) lines.push(`${kind} ${String(c.target)} [${await keyOf(String(c.target))}] ${snippet}`);
      else if (kind === "move" || kind === "connect" || kind === "disconnect") lines.push(kind);
      else lines.push(`${kind} ${String(c.key)} [${String(c.stableNodeKey ?? "")}] ${snippet}`);
    }
    return { title: set.title, lines };
  });

for (const mode of ["ai", "manual"] as const) {
  test.describe(`Replay of live run 2: ${mode === "ai" ? "AI-managed" : "Manual"} canvas`, () => {
    test.describe.configure({ mode: "serial", timeout: 180_000 });
    let page: Page;
    const log: { task: string; matched: "exact" | "fallback" | "none" }[] = [];
    const out: Record<string, unknown> = { mode };

    test.beforeAll(async ({ browser }) => {
      mkdirSync(OUT, { recursive: true });
      page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      await openApp(page);
      await replay(page, log);
      await connectFakeKey(page);
      if (mode === "ai") {
        await page.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: /^AI-managed notes/ }).click();
      }
    });
    test.afterAll(async () => {
      writeFileSync(join(OUT, `${mode}.json`), `${JSON.stringify({ ...out, calls: log }, null, 2)}\n`);
      await page?.context().close();
    });

    test("Visualize, then Update from new content (saved replies)", async () => {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("menuitem", { name: "Visualize content…" }).click();
      const dialog = page.getByRole("dialog", { name: "Visualize" });
      await dialog.getByRole("textbox").fill(doc("two", 30));
      const distil = dialog.getByRole("checkbox", { name: /Distil into key ideas/ });
      out.distil = (await distil.count()) ? await distil.isChecked() : null;
      await dialog.getByRole("button", { name: "Visualize", exact: true }).click();
      await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
      out.visualize = await pendingSummary(page);
      await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
      await expect(reviewBar(page)).toBeHidden();
      await dev(page, (d) => d.api.scrollToContent(undefined, { fitToContent: true }));
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `${mode}-1-visualized.png`) });

      // Open Ask AI on an object of the Release process section: its flow card, else its first step shape.
      const target = await dev(page, (d) => {
        const els = d.api.getSceneElements().filter((e) => !e.isDeleted);
        const card = els.find((e) => {
          const doc = e.customData?.acute?.documentId;
          return doc && d.store.get(doc)?.layout?.lang.startsWith("root = FlowDiagram(");
        });
        if (card) return card.id;
        const label = els.find((e) => e.type === "text" && e.containerId && /Freeze/.test(e.text ?? ""));
        return label?.containerId ?? null;
      });
      expect(target).toBeTruthy();
      const surface = await openAskAI(page, target!);
      await (await action(surface, "Update from new content")).click();
      const update = page.getByRole("dialog", { name: "Update from new content" });
      await update.getByRole("textbox").fill(doc("three", 45));
      await update.getByRole("button", { name: "Update", exact: true }).click();
      await expect(reviewBar(page)).toBeVisible({ timeout: 60_000 });
      out.updateReview = await reviewBar(page).locator(".acute-review__summary, [class*=summary]").first().innerText().catch(async () => (await reviewBar(page).innerText()).split("\n")[0]);
      out.update = await pendingSummary(page);
      await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
      await expect(reviewBar(page)).toBeHidden();
      await page.keyboard.press("Escape");
      await dev(page, (d) => d.api.scrollToContent(undefined, { fitToContent: true }));
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(OUT, `${mode}-2-updated.png`) });
      // Where the Release process section's objects are: each one's box and frame, and each frame's bounds.
      out.placement = await dev(page, async (d) => {
        type E = { id: string; type: string; isDeleted?: boolean; x: number; y: number; width: number; height: number; frameId?: string | null; name?: string | null };
        const els = (d.api.getSceneElements() as unknown as E[]).filter((e) => !e.isDeleted);
        const frames = els.filter((e) => e.type === "frame").map((f) => ({ id: f.id, name: f.name, box: [f.x, f.y, f.x + f.width, f.y + f.height].map(Math.round) }));
        const objects: { key: string; frame: string | null; box: number[]; inside: boolean | null }[] = [];
        for (const e of els) {
          const key = (await d.reconciliation(e.id))?.link?.stableNodeKey;
          if (!key || !key.includes("Release process")) continue;
          const f = frames.find((x) => x.id === e.frameId);
          const box = [e.x, e.y, e.x + e.width, e.y + e.height].map(Math.round);
          objects.push({ key, frame: f?.name ?? null, box, inside: f ? box[0]! >= f.box[0]! && box[1]! >= f.box[1]! && box[2]! <= f.box[2]! && box[3]! <= f.box[3]! : null });
        }
        return { frames, objects };
      });
      // The update placement fix (2026-11-24): the section's new objects stay in its frame, and no frame grows over another.
      const placement = out.placement as { frames: { name: string; box: number[] }[]; objects: { key: string; frame: string | null; inside: boolean | null }[] };
      expect(placement.objects.filter((o) => o.frame !== "1 · Flow" || !o.inside).map((o) => o.key)).toEqual([]);
      const fs = placement.frames;
      const overlapping = fs.flatMap((a, i) => fs.slice(i + 1).flatMap((b) => (a.box[0]! < b.box[2]! && a.box[2]! > b.box[0]! && a.box[1]! < b.box[3]! && a.box[3]! > b.box[1]! ? [`${a.name} × ${b.name}`] : [])));
      expect(overlapping).toEqual([]);
    });
  });
}
