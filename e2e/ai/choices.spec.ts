/**
 * A contradiction from merged content, against a real model: content merged into notes the model outlined says the
 * opposite of the notes on two points. Since U1 (intelligent-update-engine-plan §17.6, 2026-11-22) a merge never writes a
 * new "Needs your call" box: the newer statement replaces the notes' own where it stands, and the old value stays in the
 * source's history. (Before U1 this spec checked the choice box and "Use this option"; that UI is still covered, without
 * AI, by `e2e/local/choices.local.spec.ts`.) Run it with:
 *
 *   npm run test:e2e:ai -- --yes --provider=aicredits --trace off --output <dir> e2e/ai/choices.spec.ts
 *
 * Whether the model reports the contradiction is its judgement (soft). That no choice box is written is the app's (hard).
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, openApp, promptOf, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { caption, look, reviewBar } from "../aiReview";

const AI_TIMEOUT = 360_000;

const NOTES = `# Canvas Notes: project decisions

## Storage

Every workspace is stored in IndexedDB on the user's device. Firestore is planned for cloud backup later, but nothing is synced in the first version.

## AI access

Users bring their own AI: a GitHub Copilot subscription or their own API key. The app never ships a model key of its own.
`;

/** Says the opposite of Storage on TWO points in one paragraph (where it's stored, and the Firestore backup), plus one new detail. */
const CONTRADICTION = `## Storage decision

Every workspace is stored in SQLite on the user's device, not in IndexedDB. The Firestore cloud backup is dropped from the plan entirely. Backups are compressed before upload.
`;

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });

type Dev = {
  contentSource(id: string): Promise<{ version: { text: string } } | null>;
  reconciliation(id: string): Promise<{ link: { contentSourceId: string; stableNodeKey: string } | null } | null>;
  api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean; containerId?: string | null }[] };
  store: { get(id: string): unknown };
};
/** Every live object linked to a content source: its id, stable key, source and content. */
/** This run has the typed decision model (Jev) configured (`ACUTE_AI_DECISION_KIND=typed` on this run's connection). */
const TYPED = process.env.ACUTE_AI_DECISION_KIND === "typed";
type MergeDiag = { answeredBy: { providerId: string; role: string; model: string } | null; conflictsPicked: number; choicesShown: number; ms: number } | null;
/** The last merge's diagnostics: who answered, conflicts picked, choices shown. */
const lastMerge = (p: Page) => p.evaluate(() => (window as unknown as { __acuteDev: { lastMerge(): Promise<unknown> } }).__acuteDev.lastMerge()) as Promise<MergeDiag>;

const linked = (p: Page) =>
  p.evaluate(async () => {
    const d = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const out: { id: string; key: string; source: string; text: string }[] = [];
    for (const el of d.api.getSceneElements()) {
      if (el.isDeleted || (el.type === "text" && el.containerId)) continue;
      const link = (await d.reconciliation(el.id))?.link;
      if (!link) continue;
      const acute = (el as { customData?: { acute?: { documentId?: string; pageId?: string } } }).customData?.acute;
      const docId = acute?.documentId ?? acute?.pageId;
      out.push({ id: el.id, key: link.stableNodeKey, source: link.contentSourceId, text: docId ? JSON.stringify(d.store.get(docId)) : JSON.stringify(el) });
    }
    return out;
  });
const sourceText = (p: Page, id: string) => p.evaluate(async (i) => (await (window as unknown as { __acuteDev: Dev }).__acuteDev.contentSource(i))?.version.text ?? "", id);

/**
 * When the page is stuck (no review after `ms`), pauses its JavaScript through the Chrome debugger and attaches the call stack — the
 * function a hang is looping in — then resumes. Does nothing when the review shows up in time.
 */
async function stackIfStuck(p: Page, label: string, requests: Request[], ms = 150_000) {
  const shown = await reviewBar(p)
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
  if (shown) return;
  const { writeFileSync } = await import("node:fs");
  // Every AI exchange so far, to replay the step offline with no model.
  const exchanges = await Promise.all(
    requests
      .filter((q) => q.method() === "POST")
      .map(async (q) => ({ url: q.url(), request: q.postDataJSON() as unknown, response: await (await q.response())?.text().catch(() => null) })),
  );
  writeFileSync(test.info().outputPath(`${label}.exchanges.json`), JSON.stringify(exchanges));
  // Several samples of the page's stack, with async callers: a loop shows the same frames; an idle wait shows whatever ran.
  const cdp = await p.context().newCDPSession(p);
  const urls = new Map<string, string>();
  cdp.on("Debugger.scriptParsed", (e: { scriptId: string; url: string }) => urls.set(e.scriptId, e.url));
  await cdp.send("Debugger.enable");
  await cdp.send("Debugger.setAsyncCallStackDepth", { maxDepth: 32 });
  type Frame = { functionName: string; location?: { scriptId: string; lineNumber: number; columnNumber?: number }; scriptId?: string; lineNumber?: number; url?: string };
  const fmt = (f: Frame) => {
    const id = f.location?.scriptId ?? f.scriptId ?? "";
    const line = (f.location?.lineNumber ?? f.lineNumber ?? 0) + 1;
    return `${f.functionName || "(anonymous)"}  ${(f.url || urls.get(id) || id).split("/").slice(-2).join("/")}:${line}`;
  };
  const samples: string[] = [];
  for (let i = 0; i < 4; i++) {
    const paused = new Promise<{ callFrames: Frame[]; asyncStackTrace?: { description?: string; callFrames: Frame[]; parent?: unknown } }>((resolve) => cdp.once("Debugger.paused", (e) => resolve(e as never)));
    await cdp.send("Debugger.pause");
    const e = await paused;
    const asyncPart = e.asyncStackTrace ? `\n  -- async (${e.asyncStackTrace.description ?? ""}) --\n${e.asyncStackTrace.callFrames.map((f) => `  ${fmt(f)}`).join("\n")}` : "";
    samples.push(`sample ${i + 1}:\n${e.callFrames.map((f) => `  ${fmt(f)}`).join("\n")}${asyncPart}`);
    await cdp.send("Debugger.resume");
    await new Promise((r) => setTimeout(r, 1_000));
  }
  await cdp.detach();
  const body = samples.join("\n\n");
  writeFileSync(test.info().outputPath(`${label}.stack.txt`), body);
  console.log(`[stuck: ${label}]\n${body}`);
}

/** The canvas and the source as a step starts (scene, the documents its objects point to, the source's latest version), for an offline replay. */
async function dumpState(p: Page, label: string, sourceId: string) {
  const state = await p.evaluate(async (id) => {
    type El = { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type D = { api: { getSceneElements(): El[] }; store: { get(id: string): unknown }; contentSource(id: string): Promise<unknown> };
    const d = (window as unknown as { __acuteDev: D }).__acuteDev;
    const elements = d.api.getSceneElements().filter((e) => !e.isDeleted);
    const ids = [...new Set(elements.flatMap((e) => [e.customData?.acute?.documentId, e.customData?.acute?.pageId].filter((x): x is string => !!x)))];
    return { sourceId: id, elements, documents: Object.fromEntries(ids.map((i) => [i, d.store.get(i)])), latest: await d.contentSource(id) };
  }, sourceId);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(test.info().outputPath(`${label}.state.json`), JSON.stringify(state));
}

async function attachAI(requests: Request[], label: string) {
  for (const [i, r] of requests.filter((q) => q.method() === "POST" && aiTaskOf(q)).entries()) {
    const body = await (await r.response())?.text().catch(() => "(no body)");
    await test.info().attach(`${label} — ${aiTaskOf(r)} ${i + 1}`, { body: `PROMPT:\n${promptOf(r)}\n\nREPLY:\n${body ?? ""}`, contentType: "text/plain" });
  }
}

test("a contradiction from merged content replaces the notes' statement in place; no 'Needs your call' box (U1)", async ({ browser }) => {
  test.setTimeout(1_200_000);
  const page = await browser.newPage();
  const requests: Request[] = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
  let sourceId = "";

  await test.step("first run (Auto): the notes are outlined by the model", async () => {
    await caption(page, "first run: the notes are outlined", "Storage · AI access");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(NOTES);
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
    sourceId = (await linked(page))[0]!.source;
  });

  await test.step("merged content that says the opposite: the notes' statement is replaced in place, no choice box", async () => {
    await caption(page, "merged content that says the opposite", "“stored in SQLite, not in IndexedDB”");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(CONTRADICTION);
    await expect(visualizeDialog(page).getByRole("radio", { name: /Merge into existing notes/ })).toBeChecked();
    await dumpState(page, "merge", sourceId);
    requests.length = 0;
    await visualizeDialog(page).getByRole("button", { name: "Merge", exact: true }).click();
    await stackIfStuck(page, "merge", requests);
    await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
    await attachAI(requests, "merge");
    // Who answered (development diagnostics). With the typed decision model configured, Jev must have answered the
    // contradictions itself — round two included — and every conflict it picked must reach the review.
    const d = await lastMerge(page);
    test.info().annotations.push({ type: "merge — who answered", description: JSON.stringify(d) });
    if (TYPED) {
      expect(d?.answeredBy?.role, "Jev (the typed decision model) answered, not the chat fallback").toBe("decision");
      expect(d?.conflictsPicked ?? 0, "Jev picked the contradictions").toBeGreaterThanOrEqual(1);
    }
    expect(d?.choicesShown ?? 0, "U1: a merge shows no new choice").toBe(0);
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
    await look(page);
    const text = await sourceText(page, sourceId);
    test.info().annotations.push({ type: "source after merge", description: text });
    // The app's guarantees (hard): no choice box is written, in the source or on the canvas.
    expect(text, "no 'Needs your call' box in the notes").not.toContain("> [!choice]");
    const keys = (await linked(page)).map((o) => o.key);
    expect(keys.some((k) => /§ choice:/.test(k)), "no 'Needs your call' box on the canvas").toBe(false);
    // The model's judgement (soft): it reports both contradictions, so the newer statements replace the old ones where they stand.
    expect.soft(text, "the notes now say SQLite").toMatch(/stored in SQLite/);
    expect.soft(text, "the IndexedDB statement is replaced, not kept beside it").not.toMatch(/stored in IndexedDB on the user's device/);
    expect.soft(text, "the dropped Firestore backup replaces the planned one").not.toMatch(/Firestore is planned for cloud backup/);
    expect.soft(text, "the new detail is filed").toContain("compressed before upload");
    await page.screenshot({ path: test.info().outputPath("replaced-in-place.png") });
  });

  await test.step("with Jev: a part too long for Jev's round two (41 statements) falls back to the chat task, and its conflict still reaches the review", async () => {
    // Only with the typed decision model configured (returning, not test.skip, so the steps before still count).
    if (!TYPED) return;
    await caption(page, "the chat fallback", "41 statements, one of them contradicting AI access");
    const facts = Array.from({ length: 40 }, (_, i) => `Integration note ${i + 1} lists connector number ${i + 1}.`).join(" ");
    const text = `## AI connectors\n\n${facts} The app ships its own model key for trial users.\n`;
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(text);
    await expect(visualizeDialog(page).getByRole("radio", { name: /Merge into existing notes/ })).toBeChecked();
    await visualizeDialog(page).getByRole("button", { name: "Merge", exact: true }).click();
    await stackIfStuck(page, "fallback", requests);
    await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
    const d = await lastMerge(page);
    test.info().annotations.push({ type: "fallback merge — who answered", description: JSON.stringify(d) });
    expect(d?.answeredBy?.role, "the chat task answered: the part is over Jev's round-two limit").not.toBe("decision");
    expect.soft(d?.conflictsPicked ?? 0, "the chat task found the contradiction (ships its own model key)").toBeGreaterThanOrEqual(1);
    expect(d?.choicesShown ?? 0, "U1: no new choice — the conflict is applied in place").toBe(0);
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
  });
});
