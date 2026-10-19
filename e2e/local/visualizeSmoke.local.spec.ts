/**
 * Content fidelity Wave A1: Visualize through the real app with AI, without AI cost. The browser's calls to the AI
 * host are answered here (a canned outline and section plan) and a fake key is typed into Connect, so this catches
 * what unit tests can't — the browser build losing the Visualize tasks, or a pasted table never reaching AI — and
 * checks the review says so when a section falls back to its own structure, with a working Retry.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { createDemoCanvas, openAISettings, openApp } from "../helpers";

const dialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const analysisRow = (p: Page) => review(p).getByLabel("AI analysis");

/** A pasted chat reply: an intro, a decision table copied with its empty corner cell, a closing line. */
const REPLY = [
  "I've updated the plan with everything in the engineer's package, and the tracker is corrected. Nothing is committed.",
  "",
  "\tDecision\tMy proposal",
  "D1\tDraft 03's checklist\tReplace it with the submit_answer gate",
  "D2\tChanging the skill means rerunning the full test set\tCall the merge v3 and keep Draft 03 frozen.",
  "D3\tAnswer headings\tRename the headings in render.ts to the four answer classes",
  "",
  "Until the files arrive, the replay fixtures get rebuilt on our BASE/WATER pair.",
].join("\n");

const PLAN = {
  version: 1,
  template: "sectioned",
  nodes: [
    { id: "n1", type: "shape", content: { shape: "rectangle", label: "Recommendation: merge v3, keep Draft 03 frozen" } },
    // Placed by reference (Wave B1): the app inserts the whole table, word for word.
    { id: "n2", type: "source", ref: "T1" },
    { id: "a1", type: "text", origin: "analysis", title: "Status", content: { markdown: "- D1: proposed\n- D2: needs the engineer's agreement\n- D3: proposed" } },
  ],
  relationships: [{ from: "n1", to: "n2", type: "explained_by" }],
  metadata: { takeaway: "Merge v3 now; D2 waits on the engineer" },
};

type Task = "outline_document" | "generate_visual_plan";

/** Answers the AI host locally; `sectionReply` decides each section's reply text. Returns the tasks seen. */
async function answerLocally(page: Page, sectionReply: () => string, delay: () => number = () => 0): Promise<Task[]> {
  const tasks: Task[] = [];
  await page.route("**/api/ai/**", async (route: Route) => {
    const wait = delay();
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const path = new URL(route.request().url()).pathname;
    if (!path.endsWith("/run")) return route.fulfill({ status: 200, json: [] });
    const body = route.request().postDataJSON() as { request?: { task?: Task; prompt?: string } };
    const task = body.request?.task;
    if (task) tasks.push(task);
    const prompt = body.request?.prompt ?? "";
    const parts = [...new Set([...prompt.matchAll(/^\[(u\d+)\]/gm)].map((m) => m[1]!))];
    const text =
      task === "outline_document"
        ? JSON.stringify({ sections: [{ id: "s1", label: "Decisions", kind: "decision", parts: parts.length ? parts : ["u1"] }] })
        : sectionReply();
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

async function visualize(page: Page, text: string) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole("textbox").fill(text);
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(review(page)).toBeVisible({ timeout: 30_000 });
}

test("a pasted reply with a decision table is analysed by AI: outline and section calls happen, no fallback notice", async ({ page }) => {
  const tasks = await answerLocally(page, () => JSON.stringify(PLAN));
  await openApp(page);
  await createDemoCanvas(page);
  await connectFakeKey(page);
  await visualize(page, REPLY);
  expect(tasks).toEqual(["outline_document", "generate_visual_plan"]);
  await expect(analysisRow(page)).toHaveCount(0);
  // Wave C: the section's review reason sits at the section, not only in the bar.
  const chip = page.getByRole("note", { name: /^Section Decisions:/ });
  await expect(chip).toContainText("AI placed");
  if (process.env.ACUTE_SHOT) await page.screenshot({ path: process.env.ACUTE_SHOT.replace(/\.png$/, "-chip.png") });
  // Wave B: once accepted, the section's takeaway is on the canvas, and the model's analysis is tagged as such.
  await review(page).getByRole("button", { name: "Accept all" }).click();
  await expect(page.getByText("Merge v3 now; D2 waits on the engineer")).toBeVisible();
  await expect(page.getByText("Analysis · Status")).toBeVisible();
  // The table went in by reference: every column, including what each decision is about.
  await expect(page.getByText("Draft 03's checklist")).toBeVisible();

  // Wave C: the "explained by" link is drawn as a dotted link ending in a dot, not the plain arrow of a sequence.
  const arrows = await page.evaluate(() => {
    type El = { type: string; strokeStyle: string; endArrowhead: string | null; isDeleted?: boolean };
    const api = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] } } }).__acuteDev.api;
    return api.getSceneElements().filter((e) => e.type === "arrow" && !e.isDeleted).map((e) => ({ strokeStyle: e.strokeStyle, endArrowhead: e.endArrowhead }));
  });
  expect(arrows).toContainEqual({ strokeStyle: "dotted", endArrowhead: "dot" });

  // Wave D: zoomed out, the section reads as its title and takeaway; zoomed back in, the detail is back.
  const zoom = (value: number) =>
    page.evaluate((v) => (window as unknown as { __acuteDev: { api: { updateScene(s: object): void } } }).__acuteDev.api.updateScene({ appState: { zoom: { value: v } } }), value);
  await zoom(0.2);
  const card = page.locator(".acute-overview__card");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Merge v3 now; D2 waits on the engineer");
  if (process.env.ACUTE_SHOT) await page.screenshot({ path: process.env.ACUTE_SHOT });
  await zoom(1);
  await expect(card).toHaveCount(0);
});

test("a section AI can't produce says so in the review, and Retry replaces it once AI answers", async ({ page }) => {
  let broken = true;
  const tasks = await answerLocally(page, () => (broken ? "not a plan" : JSON.stringify(PLAN)));
  await openApp(page);
  await createDemoCanvas(page);
  await connectFakeKey(page);
  await visualize(page, REPLY);
  await expect(analysisRow(page)).toContainText('AI couldn\'t analyse the section "Decisions"');
  // …and at the section itself, with its Retry.
  const chip = page.getByRole("note", { name: /^Section Decisions:/ });
  await expect(chip).toContainText("Structure only: AI couldn't analyse it");
  await expect(chip.getByRole("button", { name: "Retry" })).toBeVisible();
  await analysisRow(page).getByText("Why").click();
  await expect(analysisRow(page)).toContainText("invalid_output");

  broken = false;
  const before = tasks.length;
  await analysisRow(page).getByRole("button", { name: "Retry 1 section" }).click();
  await expect(analysisRow(page)).toHaveCount(0, { timeout: 30_000 });
  expect(tasks.slice(before)).toEqual(["generate_visual_plan"]);
});

test("one bottom bar at a time: a Visualize in progress hides the review bar, which comes back after it", async ({ page }) => {
  let slow = 0;
  await answerLocally(page, () => JSON.stringify(PLAN), () => slow);
  await openApp(page);
  await createDemoCanvas(page);
  await connectFakeKey(page);
  await visualize(page, REPLY);
  // A second Visualize while the first proposal is under review: only its progress shows at the bottom.
  slow = 3000;
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await dialog(page).getByRole("textbox").fill(REPLY);
  await dialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  const progress = page.getByRole("status", { name: "Visualize" });
  await expect(progress).toBeVisible();
  await expect(review(page)).toBeHidden();
  await expect(progress).toBeHidden({ timeout: 30_000 });
  await expect(review(page)).toBeVisible();
});
