/**
 * G3.3 against a real model: a pasted document that changes its mind twice. The later statement wins: the canvas shows it, and the
 * earlier one is only on its section's "Changed over time" page. Run with:
 *
 *   npm run test:e2e:ai -- --yes --provider=aicredits --trace off --output <dir> e2e/ai/revisions.spec.ts
 *
 * Finding a revision is the model's judgement (soft). What the app does with each one it finds is hard: the earlier wording isn't
 * drawn outside the trail, the trail holds it, the version stores it, and the user's text is kept as pasted.
 */
import { expect, test, type Page } from "@playwright/test";
import { aiTaskOf, openApp, promptOf, recordAIRequests } from "../helpers";
import { connectAI } from "../aiProvider";
import { caption, look, reviewBar } from "../aiReview";

const AI_TIMEOUT = 360_000;
const DOC = `# Launch notes

## Storage

We'll store every workspace in Firestore. Attachments stay as blobs in the browser. Actually, scratch that: we switched to Postgres for workspaces.

## Launch

Version 2 ships in March. The team is four people, focused on the canvas editor. Update: the launch moved to April.

## Support

Pro subscribers get email support within one business day.
`;

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
type Dev = {
  contentSource(id: string): Promise<{ version: { text: string; revisions?: { unit: string; earlier: string; later: string }[] } } | null>;
  reconciliation(id: string): Promise<{ link: { contentSourceId: string; stableNodeKey: string } | null } | null>;
  api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean; containerId?: string | null; text?: string; customData?: { acute?: { documentId?: string; pageId?: string } } }[] };
  store: { get(id: string): unknown };
};
/** Every live object linked to a source: its key and its content. */
const linked = (p: Page) =>
  p.evaluate(async () => {
    const d = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const out: { key: string; source: string; text: string }[] = [];
    for (const el of d.api.getSceneElements()) {
      if (el.isDeleted || (el.type === "text" && el.containerId)) continue;
      const link = (await d.reconciliation(el.id))?.link;
      if (!link) continue;
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      const labels = d.api.getSceneElements().filter((t) => t.containerId === el.id).map((t) => t.text ?? "");
      out.push({ key: link.stableNodeKey, source: link.contentSourceId, text: docId ? JSON.stringify(d.store.get(docId)) : labels.join(" ") });
    }
    return out;
  });
const version = (p: Page, id: string) => p.evaluate(async (i) => (await (window as unknown as { __acuteDev: Dev }).__acuteDev.contentSource(i))?.version ?? null, id);

test("a document that changes its mind: the later statement is drawn, the earlier one is kept in 'Changed over time'", async ({ browser }) => {
  test.setTimeout(900_000);
  const page = await browser.newPage();
  const requests = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
  await caption(page, "a document that changes its mind twice", "Firestore → Postgres · March → April");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(DOC);
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
  await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(reviewBar(page)).toBeHidden();
  await look(page);

  // Every AI exchange of the run (the revision check's prompt and reply above all), for the report.
  for (const r of requests.filter((q) => q.method() === "POST" && aiTaskOf(q))) {
    const body = await (await r.response())?.text().catch(() => "(no body)");
    test.info().annotations.push({ type: `ai: ${aiTaskOf(r)}`, description: aiTaskOf(r) === "find_revisions" ? `PROMPT:
${promptOf(r)}

REPLY:
${body}` : (body ?? "").slice(0, 300) });
  }
  const objects = await linked(page);
  const v = (await version(page, objects[0]!.source))!;
  test.info().annotations.push({ type: "revisions found", description: JSON.stringify(v.revisions ?? []) });
  expect(v.text, "the user's text is kept as pasted").toBe(DOC);
  const revisions = v.revisions ?? [];
  expect.soft(revisions.length, "both changes of mind found (Firestore → Postgres, March → April)").toBe(2);

  const trail = objects.filter((o) => o.key.endsWith("§ trail"));
  const drawn = objects.filter((o) => !o.key.endsWith("§ trail"));
  for (const r of revisions) {
    const gist = r.earlier.replace(/[.!?]$/, "").slice(0, 40);
    expect(drawn.some((o) => o.text.includes(gist)), `the replaced statement isn't drawn: “${r.earlier}”`).toBe(false);
    expect(trail.some((o) => o.text.includes(gist)), `the 'Changed over time' page keeps it: “${r.earlier}”`).toBe(true);
  }
  if (revisions.length) {
    expect(drawn.some((o) => /Postgres|April/.test(o.text)), "what the text says now is drawn").toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath("revisions.png") });
});
