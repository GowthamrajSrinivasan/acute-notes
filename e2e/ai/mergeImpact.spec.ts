/**
 * U7 against a real model (intelligent-update-engine-plan §19.7): "Merge into existing notes" offers a changed fact on
 * other cards, as "Update from new content" does — here with the notes outlined by the model and the merge answered by
 * it, so the changed card text is the model's, not the input's. Run it with:
 *
 *   npm run test:e2e:ai -- --yes --provider=aicredits --trace off --output <dir> e2e/ai/mergeImpact.spec.ts
 *
 * The user's own cards are pasted, so their words are known: one repeats the fact (offered the same edit), one says it in
 * other words (listed, not edited), one is about the gateway's timeouts (must not be offered anything: a model rewording
 * of the "Timeouts" sentence would show up here as a false offer). Impact discovery itself adds no model call.
 *
 * Hard: the merge replaces the statement in the notes (the precondition, the model's answer), the repeating card is
 * offered the same edit, "Update this too" edits that card in place, the other cards are never edited. Soft: the related
 * listing and that nothing else is offered. Every model call, the review summary and the source's text are attached.
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { aiTaskOf, openApp, pasteText, promptOf, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { reviewBar, visualizeDialog } from "../aiReview";

const AI_TIMEOUT = 360_000;

/** Enough prose (≥ 200 characters to analyse) that "Auto" sends it to the model, as real notes are: short, explicit notes stay local. */
const GATEWAY = [
  "# Gateway",
  "",
  "## Limits",
  "",
  "The gateway protects the payment providers from bursts of traffic. Retries happen five times. Timeouts last ten seconds, after which the request is reported to the caller as failed.",
  "",
  "## Owners",
  "",
  "The payments team owns the gateway and is on call for it during business hours. The platform team covers nights and weekends.",
  "",
].join("\n");
const REVISION = ["# Gateway", "", "## Limits", "", "Retries happen three times.", ""].join("\n");

const SAME = "Our worker retries five times before giving up.";
const OTHER_WORDS = "Retries happen up to 5 times per job.";
const TIMEOUTS = "Gateway timeouts last ten seconds.";

type Dev = {
  api: { getSceneElements(): { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[] };
  store: { get(id: string): { snapshot: unknown } | null };
  reconciliation(id: string): Promise<{ link: { contentSourceId: string } | null } | null>;
  contentSource(id: string): Promise<{ source: { tier: string; template: string }; version: { text: string } } | null>;
};

/** Plain text of a block's document. */
const textOf = (p: Page, id: string) =>
  p.evaluate((i) => {
    const d = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const el = d.api.getSceneElements().find((e) => e.id === i && !e.isDeleted);
    const doc = el?.customData?.acute?.documentId;
    const words: string[] = [];
    const walk = (n: unknown): void => {
      if (typeof n === "string") return void words.push(n);
      if (Array.isArray(n)) return n.forEach(walk);
      if (n && typeof n === "object") {
        const o = n as Record<string, unknown>;
        if (typeof o.text === "string") words.push(o.text);
        if ("content" in o) walk(o.content);
        if ("children" in o) walk(o.children);
      }
    };
    walk(doc ? d.store.get(doc)?.snapshot : null);
    return words.join("");
  }, id);

/** The notes' content source (the first block linked to one). */
const notesSource = (p: Page) =>
  p.evaluate(async () => {
    const d = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    for (const el of d.api.getSceneElements()) {
      const link = (await d.reconciliation(el.id))?.link;
      if (link) return link.contentSourceId;
    }
    return null;
  });
const sourceText = (p: Page, id: string) => p.evaluate(async (i) => (await (window as unknown as { __acuteDev: Dev }).__acuteDev.contentSource(i))?.version.text ?? "", id);

async function attachCalls(requests: Request[], label: string) {
  for (const [i, r] of requests.filter((q) => q.method() === "POST" && aiTaskOf(q)).entries()) {
    const body = await (await r.response())?.text().catch(() => "(no body)");
    await test.info().attach(`${label} — ${aiTaskOf(r)} ${i + 1}`, { body: `PROMPT:\n${promptOf(r)}\n\nREPLY:\n${body ?? ""}`, contentType: "text/plain" });
  }
}

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a model-answered merge offers the changed fact on the user's card that repeats it, and nothing else", async ({ page }, info) => {
  test.setTimeout(1_200_000);
  const requests: Request[] = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);

  // The user's own cards, in known words, before any notes exist (so they are nobody's source).
  const same = await pasteText(page, SAME, { x: 260, y: 640 });
  const otherWords = await pasteText(page, OTHER_WORDS, { x: 700, y: 640 });
  const timeouts = await pasteText(page, TIMEOUTS, { x: 1140, y: 640 });

  await test.step("the notes, outlined by the model", async () => {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").first().fill(GATEWAY);
    await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(reviewBar(page)).toBeHidden();
  });
  const sourceId = (await notesSource(page))!;
  expect(sourceId, "the notes have a content source").toBeTruthy();
  const notes = await page.evaluate(async (i) => (await (window as unknown as { __acuteDev: Dev }).__acuteDev.contentSource(i))?.source ?? null, sourceId);
  info.annotations.push({ type: "notes source", description: JSON.stringify(notes) });
  console.log(`[u7-live] notes source: ${JSON.stringify(notes)}; visualize calls: ${requests.filter((q) => q.method() === "POST").map(aiTaskOf).filter(Boolean).join(", ") || "(none recorded)"}`);
  // The point of this run: the cards (and so the merge's changed text) are the model's words.
  expect(notes?.tier, "the notes went through the model (else this run tests nothing the local spec doesn't)").toBe("ai");
  for (const [i, r] of requests.filter((q) => q.method() === "POST" && aiTaskOf(q)).entries()) info.annotations.push({ type: `visualize call ${i + 1}`, description: aiTaskOf(r) ?? "" });

  let summary = "";
  await test.step("merge a revised fact into the notes", async () => {
    requests.length = 0;
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Visualize content…" }).click();
    await visualizeDialog(page).getByRole("textbox").first().fill(REVISION);
    await expect(visualizeDialog(page).getByRole("radio", { name: /Merge into existing notes/ })).toBeChecked();
    await visualizeDialog(page).getByRole("button", { name: "Merge", exact: true }).click();
    await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
    await attachCalls(requests, "merge");
    const tasks = requests.filter((r) => r.method() === "POST").map(aiTaskOf).filter(Boolean);
    info.annotations.push({ type: "merge model calls", description: tasks.join(", ") || "(none)" });
    await reviewBar(page).getByRole("button", { name: "Review", exact: true }).click();
    summary = (await reviewBar(page).innerText()).replace(/\s+/g, " ");
    info.annotations.push({ type: "merge review", description: summary });
    await page.screenshot({ path: info.outputPath("merge-review.png") });
    console.log(`[u7-live] model calls: ${tasks.join(", ")}`);
    console.log(`[u7-live] review: ${summary}`);
  });

  const bar = reviewBar(page);
  const offers = bar.getByRole("list", { name: "Changes that need your input" });
  const offer = offers.getByRole("listitem", { name: /^Elsewhere: Our worker retries five times/ });

  await test.step("the merge replaced the statement (the model's answer), so the repeating card is offered the same edit", async () => {
    expect.soft(summary, "precondition (the model's answer): the merge updates the notes' card in place").toMatch(/updated/);
    await expect(offer, `U7: the user's card that repeats the fact is offered the change (review: ${summary})`).toBeVisible();
    await expect(offer.getByLabel("Proposed version")).toContainText("Our worker retries three times before giving up.");
    expect.soft(await offers.getByRole("listitem", { name: /^Elsewhere:/ }).count(), "nothing else is offered (a model rewording would show here)").toBe(1);
    expect.soft(await offers.innerText(), "the timeouts card is not offered anything").not.toContain(TIMEOUTS);
    const related = bar.getByRole("list", { name: "Related cards, not changed" });
    const relatedText = await related.innerText().catch(() => "");
    expect.soft(relatedText, "the card in other words is listed, not edited").toContain(OTHER_WORDS);
    // Model-written notes can be "annotated" (markers ¹ ² after phrases, a "Notes" card): the review quotes the fact, never a marker or a title.
    const note = await offer.locator(".acute-review__note").innerText();
    expect.soft(note, "the offer quotes the changed fact, not the card's title").toMatch(/^Says the same as “[^”]*five[^”]*”/);
    expect.soft(`${note}\n${relatedText}`, "no note marker in what the review quotes").not.toMatch(/[¹²³⁰⁴-⁹]/);
  });

  await test.step("Update this too edits the card in place; Accept all leaves the other cards alone", async () => {
    await offer.getByRole("button", { name: "Update this too" }).click();
    await bar.getByRole("button", { name: "Accept all clean changes" }).click();
    await expect(bar).toBeHidden();
    await expect.poll(() => textOf(page, same)).toBe("Our worker retries three times before giving up.");
    expect(await textOf(page, otherWords)).toBe(OTHER_WORDS);
    expect(await textOf(page, timeouts)).toBe(TIMEOUTS);
    const text = await sourceText(page, sourceId);
    await info.attach("notes after the merge", { body: text, contentType: "text/plain" });
    console.log(`[u7-live] notes after the merge: ${text.replace(/\s+/g, " ")}`);
    expect.soft(text, "the notes say the new value").toContain("three times");
    await page.screenshot({ path: info.outputPath("after-accept.png") });
  });
});
