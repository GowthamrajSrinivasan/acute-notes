/**
 * Choices (G3) in the real app, with AI answered locally (no AI cost): a `[!choice]` callout in an AI-tier source is
 * drawn as a "Needs your call" box with one card per option and dotted links; selecting an option card and choosing
 * "Use this option" applies it as a reviewed update — the box becomes the choice, the other cards go, and the
 * section gets a "Changed over time" page.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { action, openAISettings, openApp, openAskAI, select } from "../helpers";

const dialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const origin = (p: Page) => p.getByRole("group", { name: "Origin" });

/** Long enough prose for AI analysis (not the local tier). */
const NOTES = [
  "We are planning the replay work for the next release, and the decisions so far are written down here for the team.",
  "",
  "Until the files arrive, the replay fixtures get rebuilt on our BASE/WATER pair.",
  "",
  "The checklist from Draft 03 is replaced by the submit_answer gate, and the answer headings are renamed to the four answer classes.",
].join("\n");
const CALLOUT = [
  "> [!choice] Which pair the fixtures use",
  "> - Until the files arrive, the replay fixtures get rebuilt on our BASE/WATER pair. _(in your notes)_",
  "> - The replay fixtures are rebuilt on the engineer's own pair. _(from “Engineer's package”, 2026-10-09)_",
].join("\n");

/** Answers the AI host locally: one section, and a one-card plan quoting the section's first line. */
async function answerLocally(page: Page): Promise<string[]> {
  const tasks: string[] = [];
  await page.route("**/api/ai/**", async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: { task?: string; prompt?: string } };
    const task = body.request?.task ?? "";
    tasks.push(task);
    const prompt = body.request?.prompt ?? "";
    const parts = [...new Set([...prompt.matchAll(/^\[(u\d+)\]/gm)].map((m) => m[1]!))];
    const pair = /engineer's own pair/.test(prompt) ? "Fixtures: the engineer's own pair" : "Fixtures: BASE/WATER until the files arrive";
    const plan = { version: 1, template: "sectioned", nodes: [{ id: "n1", type: "text", content: { markdown: `${pair}. The checklist becomes the submit_answer gate.` } }], relationships: [], metadata: { takeaway: "Replay decisions" } };
    const text = task === "outline_document" ? JSON.stringify({ sections: [{ id: "s1", label: "Replay decisions", kind: "notes", parts: parts.length ? parts : ["u1"] }] }) : JSON.stringify(plan);
    return route.fulfill({ status: 200, json: { text, model: "test-model", finishReason: "stop", usage: { provider: "openai", model: "test-model" } } });
  });
  return tasks;
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

type Linked = { id: string; key: string; text: string };
/** Every live object linked to a content source: its id, stable key and text. */
function linked(p: Page): Promise<Linked[]> {
  return p.evaluate(async () => {
    type El = { id: string; type: string; isDeleted?: boolean; containerId?: string | null; text?: string; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Dev = {
      api: { getSceneElements(): El[] };
      store: { get(id: string): { snapshot?: unknown; title?: string } | null };
      reconciliation(id: string): Promise<{ link: { stableNodeKey: string } | null } | null>;
    };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const out: Linked[] = [];
    for (const el of dev.api.getSceneElements()) {
      if (el.isDeleted || (el.type === "text" && el.containerId)) continue;
      const link = (await dev.reconciliation(el.id))?.link;
      if (!link) continue;
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      const doc = docId ? dev.store.get(docId) : null;
      out.push({ id: el.id, key: link.stableNodeKey, text: doc ? JSON.stringify(doc) : (el.text ?? "") });
    }
    return out;
  });
}
const choiceObjects = async (p: Page) => (await linked(p)).filter((o) => /§ (choice:|trail$)/.test(o.key));
const arrows = (p: Page) =>
  p.evaluate(() => {
    type El = { type: string; isDeleted?: boolean; strokeStyle?: string; customData?: { acuteRelation?: { type?: string } } };
    const dev = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev;
    return dev.api.getSceneElements().filter((e) => e.type === "arrow" && !e.isDeleted).map((e) => ({ strokeStyle: e.strokeStyle }));
  });

test("a choice: drawn as a box with dotted links to its options; 'Use this option' makes the choice", async ({ page }) => {
  test.setTimeout(180_000);
  await openApp(page);
  const tasks = await answerLocally(page);
  await connectFakeKey(page);

  // First run: the notes, analysed by (local stand-ins for) AI.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await dialog(page).getByRole("textbox").fill(NOTES);
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await review(page).getByRole("button", { name: "Accept all" }).click({ timeout: 30_000 });
  await expect(review(page)).toBeHidden();
  expect(tasks).toContain("outline_document");
  const card = (await linked(page))[0]!;

  // The callout arrives through "Update from new content": a box, two option cards, dotted links.
  const arrowsBefore = (await arrows(page)).length;
  const surface = await openAskAI(page, card.id);
  await (await action(surface, "Update from new content")).click();
  await updateDialog(page).getByRole("textbox").fill(`${NOTES}\n\n${CALLOUT}\n`);
  tasks.length = 0;
  await updateDialog(page).getByRole("button", { name: "Update", exact: true }).click();
  await review(page).getByRole("button", { name: "Accept all" }).click({ timeout: 30_000 });
  await expect(review(page)).toBeHidden();
  expect(tasks.filter((t) => t === "generate_visual_plan"), "the section's own text didn't change: no model call").toEqual([]);
  await expect.poll(async () => (await choiceObjects(page)).map((o) => o.key.replace(/^.* § /, "")).sort()).toEqual(["choice:which-pair-the-fixtures-use", "choice:which-pair-the-fixtures-use:option0", "choice:which-pair-the-fixtures-use:option1"]);
  const box = (await choiceObjects(page)).find((o) => o.key.endsWith("choice:which-pair-the-fixtures-use"))!;
  expect(box.text).toContain("Needs your call");
  const added = (await arrows(page)).slice(arrowsBefore);
  expect(added.length).toBe(2);
  expect(added.every((a) => a.strokeStyle === "dotted")).toBe(true);
  await page.screenshot({ path: "test-results/choice-open.png" });

  // "Use this option" on the second option: reviewed, then the box becomes the choice.
  const option = (await choiceObjects(page)).find((o) => o.key.endsWith(":option1"))!;
  await select(page, option.id);
  await origin(page).getByRole("button", { name: "Use this option" }).click();
  await expect(review(page)).toBeVisible({ timeout: 30_000 });
  await expect(review(page)).toContainText("Use this option");
  await review(page).getByRole("button", { name: "Accept all" }).click();
  await expect(review(page)).toBeHidden();
  await expect.poll(async () => (await choiceObjects(page)).map((o) => o.key.replace(/^.* § /, "")).sort()).toEqual(["choice:which-pair-the-fixtures-use", "trail"]);
  const chosen = (await choiceObjects(page)).find((o) => o.key.endsWith("choice:which-pair-the-fixtures-use"))!;
  expect(chosen.text).toContain("engineer's own pair");
  expect(chosen.text).not.toContain("Needs your call");
  const trail = (await choiceObjects(page)).find((o) => o.key.endsWith("trail"))!;
  expect(trail.text).toContain("Changed over time");
  // The notes' own wording now says the chosen option.
  expect((await linked(page)).some((o) => !/§ (choice:|trail$)/.test(o.key) && o.text.includes("engineer's own pair"))).toBe(true);
  await page.screenshot({ path: "test-results/choice-made.png" });
});
