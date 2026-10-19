/**
 * Topic merge (G2) against a real model: Visualize (Auto, so the document is outlined) on a canvas that already has
 * notes, with "Merge into existing notes". Run it with:
 *
 *   npm run test:e2e:ai -- --yes --provider=aicredits e2e/ai/topicMerge.spec.ts
 *
 * One test, one step per scenario, so every step reports even when the model misjudges an earlier one. The app's
 * guarantees are hard assertions: the merge stays one source; repeats are left out with no model call; a new topic
 * outlines only the new part. The model's judgement (which topic a part belongs to, a rewording changes nothing) is
 * soft. Each review summary, toast and model reply is attached to the report.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, openApp, promptOf, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { caption, look, reviewBar, SHOW_MS } from "../aiReview";

/** Per AI step: an outlined run with an analysis retry on a slow provider can pass the shared 150 s. */
const AI_TIMEOUT = 360_000;

const NOTES = `# Canvas Notes: project decisions

## Storage

Every workspace is stored in IndexedDB on the user's device. Firestore is planned for cloud backup later, but nothing is synced in the first version. Images and attachments are kept as blobs next to the documents that use them.

## AI access

Users bring their own AI: a GitHub Copilot subscription or their own API key. The app never ships a model key of its own. Every request goes through a local AI host with all built-in tools disabled, so the model can't touch files.

## Open questions

Should exports include AI provenance by default? How long should stale markers stay on the canvas before they expire?
`;

/** About storage, under a heading the notes don't have. */
const STORAGE_DETAIL = `## Where the data lives

Attachments are compressed before they're written, and a whole workspace can be exported as one .acute.json file for backup or moving to another device.
`;
/** About AI access, with a near-copy of what Storage already says riding along. */
const CROSS_TOPIC = `## Model choice

The model is chosen per workspace, from the AI connections the user has set up.

Each workspace is stored in IndexedDB on the user's own device. Firestore is planned for cloud backup later, but nothing is synced in the first version.
`;
/** Word for word what the notes already say. */
const REPEAT = `## AI access

Users bring their own AI: a GitHub Copilot subscription or their own API key. The app never ships a model key of its own. Every request goes through a local AI host with all built-in tools disabled, so the model can't touch files.
`;
/** The same meaning as "AI access", in other words. */
const REWORDED = `## Bring your own model

People connect the Copilot plan or the API key they already have; we never include a model key ourselves. Requests run through a local host whose built-in tools are switched off, so files are out of the model's reach.
`;
/** A subject the notes don't cover. */
const PRICING = `## Pricing

A free tier with a monthly allowance of AI actions, and a Pro plan that adds unlimited canvases, cloud backup and priority support for a monthly fee.
`;

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const already = (p: Page) => p.getByText("Everything in this content is already in your notes.");

type Dev = {
  contentSource(id: string): Promise<{ source: { tier: string; template: string; latestVersion: number }; version: { text: string } } | null>;
  reconciliation(id: string): Promise<{ link: { contentSourceId: string } | null } | null>;
  api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean }[] };
};
const dev = <T,>(p: Page, fn: (d: Dev, arg: string) => Promise<T> | T, arg = "") => p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;
const source = (p: Page, id: string) => dev(p, (d, i) => d.contentSource(i), id);
const frameCount = (p: Page) => dev(p, (d) => d.api.getSceneElements().filter((e) => e.type === "frame" && !e.isDeleted).length);
/** The content source of the first object on the canvas that has one. */
const firstSourceId = (p: Page) =>
  dev(p, async (d) => {
    for (const el of d.api.getSceneElements()) {
      const link = (await d.reconciliation(el.id))?.link;
      if (link) return link.contentSourceId;
    }
    return null;
  });

/**
 * The canvas and the notes' source as a merge starts — the scene, the documents its objects point to, and the source's
 * latest version — written to the test's output folder, so a step can be replayed offline with no model.
 */
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
  writeFileSync(test.info().outputPath(`${label.replace(/\W+/g, "-")}.state.json`), JSON.stringify(state));
}

/** ⋮ → Visualize content…, merge suggested; returns the review summary (expanded), or null when nothing changed. */
async function mergeStep(p: Page, requests: Request[], text: string, label: string, sourceId: string, timeout = AI_TIMEOUT): Promise<string | null> {
  await dumpState(p, label, sourceId);
  await expect(already(p)).toBeHidden({ timeout: 15_000 });
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(p).getByRole("textbox").fill(text);
  await expect(visualizeDialog(p).getByRole("radio", { name: /Merge into existing notes/ })).toBeChecked();
  requests.length = 0;
  await visualizeDialog(p).getByRole("button", { name: "Merge", exact: true }).click();
  await expect(reviewBar(p).or(already(p)).first()).toBeVisible({ timeout });
  for (const [i, r] of requests.filter((q) => q.method() === "POST" && aiTaskOf(q)).entries()) {
    const body = await (await r.response())?.text().catch(() => "(no body)");
    await test.info().attach(`${label} — ${aiTaskOf(r)} ${i + 1}`, { body: `PROMPT:\n${promptOf(r)}\n\nREPLY:\n${body ?? ""}`, contentType: "text/plain" });
  }
  const toast = await p.locator(".excalidraw .Toast").innerText().catch(() => "");
  if (toast) test.info().annotations.push({ type: `${label} toast`, description: toast });
  if (!(await reviewBar(p).isVisible())) {
    test.info().annotations.push({ type: `${label} review`, description: "Nothing changed" });
    return null;
  }
  await reviewBar(p).getByRole("button", { name: "Review" }).click();
  const summary = (await reviewBar(p).innerText()).replace(/\s+/g, " ");
  test.info().annotations.push({ type: `${label} review`, description: summary });
  if (SHOW_MS) await p.waitForTimeout(SHOW_MS);
  return summary;
}

async function accept(p: Page) {
  await reviewBar(p).getByRole("button", { name: /^Accept all/ }).click();
  await expect(reviewBar(p)).toBeHidden();
  await look(p);
}

const tasks = (requests: Request[]) => requests.filter((r) => r.method() === "POST").map(aiTaskOf).filter(Boolean);

test("merging new content into notes a model outlined: filed by topic, repeats left out, new topics on their own", async ({ browser }) => {
  test.setTimeout(1_200_000);
  const page = await browser.newPage();
  const requests: Request[] = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
  let sourceId = "";

  await test.step("first run (Auto): the notes are outlined by the model", async () => {
    await caption(page, "first run (Auto): the notes are outlined by the model", "Storage · AI access · Open questions");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").fill(NOTES);
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
    await accept(page);
    sourceId = (await firstSourceId(page))!;
    expect(sourceId).toBeTruthy();
    const s = await source(page, sourceId);
    expect(s?.source, "the notes went through the model's outline").toMatchObject({ tier: "ai", template: "sectioned" });
  });

  await test.step("storage detail under a new heading joins the Storage topic", async () => {
    await caption(page, "storage detail under a new heading joins the Storage topic", "“Where the data lives”: compression and .acute.json export");
    const frames = await frameCount(page);
    const summary = await mergeStep(page, requests, STORAGE_DETAIL, "storage detail", sourceId);
    expect(tasks(requests), "the model is asked where the part belongs").toContain("assign_to_topics");
    expect(summary, "new detail is something to add").not.toBeNull();
    expect.soft(tasks(requests), "filed under an existing topic: nothing to outline").not.toContain("outline_document");
    expect.soft(summary ?? "", "nothing is removed by a merge").not.toMatch(/removed/);
    await accept(page);
    expect.soft(await frameCount(page), "no new frame for an existing topic").toBe(frames);
    const s = (await source(page, sourceId))!;
    expect(s.source.latestVersion, "the same source's next version").toBe(2);
    expect(s.version.text.match(/compressed/g), "the passage is in the notes once").toHaveLength(1);
    expect.soft(s.version.text.indexOf("compressed"), "filed under Storage").toBeLessThan(s.version.text.indexOf("## AI access"));
  });

  await test.step("a passage another topic already says is left out; the new sentence beside it is filed", async () => {
    await caption(page, "a passage another topic already says is left out", "“Model choice”: one new sentence, plus a near-copy of Storage");
    const summary = await mergeStep(page, requests, CROSS_TOPIC, "cross-topic", sourceId);
    expect(summary, "the new sentence is something to add").not.toBeNull();
    expect.soft(tasks(requests), "filed under AI access, not a new topic").not.toContain("outline_document");
    expect.soft(summary ?? "", "nothing is removed by a merge").not.toMatch(/removed/);
    await accept(page);
    // Whatever topic the model filed it under, the notes say each thing once.
    const s = (await source(page, sourceId))!;
    expect(s.version.text.match(/stored in IndexedDB/g), "the Storage passage is in the notes once").toHaveLength(1);
    expect(s.version.text.match(/chosen per workspace/g), "the new sentence is in the notes once").toHaveLength(1);
    expect.soft(s.version.text.indexOf("chosen per workspace"), "filed under AI access").toBeGreaterThan(s.version.text.indexOf("## AI access"));
  });

  await test.step("content the notes already hold: nothing to review, and no model call at all", async () => {
    await caption(page, "content the notes already hold: nothing to review, and no model call", "The AI access paragraph, word for word");
    const summary = await mergeStep(page, requests, REPEAT, "repeat", sourceId, 30_000);
    expect(summary).toBeNull();
    await expect(already(page)).toBeVisible();
    expect(tasks(requests), "no model call for content already there").toEqual([]);
  });

  await test.step("the same meaning in other words changes nothing (or very little)", async () => {
    await caption(page, "the same meaning in other words changes nothing", "“Bring your own model”: AI access, reworded");
    const frames = await frameCount(page);
    const summary = await mergeStep(page, requests, REWORDED, "reworded", sourceId);
    expect.soft(tasks(requests), "filed under AI access, not a new topic").not.toContain("outline_document");
    expect.soft(summary, "a rewording should add nothing").toBeNull();
    expect.soft(summary ?? "", "a rewording never removes anything").not.toMatch(/removed/);
    if (summary) await accept(page);
    expect.soft(await frameCount(page), "no new frame for a rewording").toBe(frames);
  });

  await test.step("a subject the notes don't cover becomes a new section, outlined on its own", async () => {
    await caption(page, "a subject the notes don't cover becomes a new section", "“Pricing”: free tier and Pro");
    const frames = await frameCount(page);
    const summary = await mergeStep(page, requests, PRICING, "pricing", sourceId);
    expect(summary, "a new topic is something to add").not.toBeNull();
    const outline = requests.find((r) => r.method() === "POST" && aiTaskOf(r) === "outline_document");
    expect.soft(outline, "the model calls Pricing a new topic").toBeDefined();
    // G2.3, whatever the model decided: an outline is only ever of the new part.
    if (outline) expect(promptOf(outline), "only the new part is outlined").not.toContain("IndexedDB");
    expect.soft(summary ?? "", "nothing is removed by a merge").not.toMatch(/removed/);
    await accept(page);
    expect.soft(await frameCount(page), "one new frame").toBe(frames + 1);
    const s = (await source(page, sourceId))!;
    expect(s.version.text, "the new topic ends the notes").toMatch(/## Pricing[\s\S]*priority support[^\n]*\n?$/);
  });
});
