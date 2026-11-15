/**
 * Stage 1–1e against a real AI connection (intelligent-update-engine-plan): a small note on MCP servers — one paragraph
 * and a few points — is visualized, then updated with new content and with changed facts. Checks that new content is
 * added, changed facts update the existing cards (claim-level where the model keeps the wording), an identical re-run
 * makes no AI call, an edited card keeps the user's words (merged, or a conflict card — never a silent overwrite), and a
 * locked card is left alone and reported. Run only through `npm run test:e2e:ai` (asks before running).
 */
import { expect, test, type Page, type Request } from "@playwright/test";
import { action, aiTaskOf, elements, openApp, openAskAI, recordAIRequests, select } from "../helpers";
import { connectAI } from "../aiProvider";

test.describe.configure({ mode: "serial" });

const AI_TIMEOUT = 240_000;
let page: Page;
let aiRequests: Request[];
let anyCard: string;

const V1 = [
  "# MCP servers",
  "",
  "## Overview",
  "",
  "An MCP server exposes tools and resources to an AI client over a standard protocol. A client can connect to five servers at once.",
  "",
  "## Key points",
  "",
  "- Servers declare their tools when the client connects.",
  "- Every tool call needs the user's approval.",
  "- Transports are stdio and streamable HTTP.",
  "",
].join("\n");
// Existing content changed (five → three) and new content added (a point, and a whole section).
const V2 = V1.replace("five servers", "three servers")
  .replace("- Transports are stdio and streamable HTTP.\n", "- Transports are stdio and streamable HTTP.\n- Servers can send notifications to the client.\n")
  .concat("\n## Security\n\nEach server gets its own scoped access token.\n");

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const conflicts = (p: Page) => reviewBar(p).getByRole("list", { name: "Changes that need your input" });
const origin = (p: Page) => p.getByRole("group", { name: "Origin" });
const nothingChanged = (p: Page) => p.getByText("Nothing changed — the canvas already matches this content.");
const posts = () => aiRequests.filter((r) => r.method() === "POST");
const log = (label: string, value: unknown) => console.log(`[mcp-check] ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);

/** Every live block, page and labelled shape as { id, text, kind } (its plain text, lower-cased). */
function cards(p: Page): Promise<{ id: string; text: string; kind: "doc" | "shape" }[]> {
  return p.evaluate(() => {
    type El = { id: string; type: string; containerId?: string | null; text?: string; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown; title?: string } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    const words = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(words).join(" ") : v && typeof v === "object" ? Object.entries(v).filter(([k]) => k === "text" || k === "content" || k === "children").map(([, x]) => words(x)).join(" ") : "");
    const scene = dev.api.getSceneElements();
    const labels = new Map(scene.filter((e) => e.type === "text" && e.containerId).map((e) => [e.containerId!, e.text ?? ""] as const));
    const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();
    return scene.flatMap((el): { id: string; text: string; kind: "doc" | "shape" }[] => {
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      const doc = docId ? dev.store.get(docId) : null;
      if (doc) return [{ id: el.id, text: norm(`${doc.title ?? ""} ${words(doc.snapshot)}`), kind: "doc" as const }];
      const label = el.type !== "arrow" && el.type !== "text" ? labels.get(el.id) : undefined;
      return label ? [{ id: el.id, text: norm(label), kind: "shape" as const }] : [];
    });
  });
}
const mentioning = async (p: Page, ...needles: RegExp[]) => (await cards(p)).filter((c) => needles.some((n) => n.test(c.text)));

/** Replaces a text in a block's stored document, as a user edit would. */
function editBlock(p: Page, id: string, from: RegExp, to: string): Promise<boolean> {
  return p.evaluate(
    ({ id, source, flags, to }) => {
      type El = { id: string; customData?: { acute?: { documentId?: string } } };
      type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown }; update(id: string, patch: unknown): void } };
      const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
      const docId = dev.api.getSceneElements().find((e) => e.id === id)?.customData?.acute?.documentId;
      if (!docId) return false;
      const before = JSON.stringify(dev.store.get(docId).snapshot);
      const after = before.replace(new RegExp(source, flags), to);
      if (after === before) return false;
      dev.store.update(docId, { snapshot: JSON.parse(after) });
      return true;
    },
    { id, source: from.source, flags: from.flags, to },
  );
}

async function updateFrom(p: Page, text: string) {
  const surface = await openAskAI(p, anyCard);
  await (await action(surface, "Update from new content")).click();
  await updateDialog(p).getByRole("textbox").fill(text);
  await updateDialog(p).getByRole("button", { name: "Update", exact: true }).click();
}

/** Waits for the update's outcome: the review bar, "Nothing changed", or a notice (a toast). Returns which. */
async function outcome(p: Page): Promise<"review" | "nothing" | "notice"> {
  const notice = p.getByText(/locked cards? not updated/);
  await expect(reviewBar(p).or(nothingChanged(p)).or(notice)).toBeVisible({ timeout: AI_TIMEOUT });
  if (await reviewBar(p).isVisible()) return "review";
  return (await nothingChanged(p).isVisible()) ? "nothing" : "notice";
}

/** The review's item labels (opens the list). */
async function reviewItems(p: Page): Promise<string> {
  const review = reviewBar(p).getByRole("button", { name: "Review", exact: true });
  if (await review.isVisible()) await review.click();
  return (await reviewBar(p).innerText()).replace(/\s+/g, " ");
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
  aiRequests = recordAIRequests(page);
  await openApp(page);
  await connectAI(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

test("1. the MCP servers note is visualized with AI and accepted", async () => {
  test.setTimeout(AI_TIMEOUT * 2);
  const before = new Set((await elements(page)).map((e) => e.id));
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(page).getByRole("textbox").fill(V1);
  await visualizeDialog(page).getByRole("radiogroup", { name: "Template" }).locator(`input[value="concept_map"]`).check();
  await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
  await expect(reviewBar(page)).toBeVisible({ timeout: AI_TIMEOUT });
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  const added = (await elements(page)).filter((e) => !before.has(e.id) && e.type !== "arrow" && !(e.type === "text" && e.containerId));
  expect(added.length).toBeGreaterThan(1);
  const all = await cards(page);
  anyCard = all.find((c) => c.kind === "doc")!.id;
  log("v1 cards", all.map((c) => c.text));
  expect(await mentioning(page, /\bfive\b|\b5\b/)).not.toHaveLength(0);
  expect(await mentioning(page, /approv/)).not.toHaveLength(0);
});

test("2. new content is added and changed facts update existing cards; an identical re-run calls no AI", async () => {
  test.setTimeout(AI_TIMEOUT * 2);
  const countBefore = (await cards(page)).length;
  await updateFrom(page, V2);
  expect(await outcome(page)).toBe("review");
  log("v2 review", await reviewItems(page));
  await expect(conflicts(page)).toHaveCount(0); // nothing was edited by the user: no decisions needed
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();

  const after = await cards(page);
  log("v2 cards", after.map((c) => c.text));
  expect(after.length).toBeGreaterThan(countBefore); // the new point and/or section became cards
  expect(await mentioning(page, /\bthree\b|\b3\b/)).not.toHaveLength(0); // the changed fact
  expect(await mentioning(page, /five servers|\b5 servers/)).toHaveLength(0); // the old fact is gone
  expect(await mentioning(page, /notification/)).not.toHaveLength(0); // the new point
  expect(await mentioning(page, /token/)).not.toHaveLength(0); // the new section

  aiRequests.length = 0;
  await updateFrom(page, V2);
  expect(await outcome(page)).toBe("nothing");
  expect(posts().filter((r) => aiTaskOf(r))).toHaveLength(0);
});

test("3. a card the user edited keeps the user's words when its fact changes again (merged, or a decision — never overwritten)", async () => {
  test.setTimeout(AI_TIMEOUT * 2);
  await expect(nothingChanged(page)).toBeHidden({ timeout: 10_000 });
  const target = (await mentioning(page, /\bthree\b|\b3\b/)).find((c) => c.kind === "doc")!;
  expect(await editBlock(page, target.id, /\b(three|3)\b/, "$1 (my note: check the client's limit)")).toBe(true);
  await updateFrom(page, V2.replace("three servers", "four servers"));
  const result = await outcome(page);
  expect(result).toBe("review");
  const items = await reviewItems(page);
  log("v3 review", items);
  const conflictCount = await conflicts(page).getByRole("listitem").count();
  log("v3 path", conflictCount ? "conflict card (the edit couldn't be placed exactly)" : "merged into the edited card");
  if (conflictCount) {
    // Fallback: a decision, with the user's version shown — then Keep mine.
    await expect(conflicts(page).getByRole("listitem").first().getByLabel("Your version")).toContainText("my note");
    await conflicts(page).getByRole("listitem").first().getByRole("button", { name: "Keep mine" }).click();
    await reviewBar(page).getByRole("button", { name: /Accept all/ }).click();
    expect((await cards(page)).find((c) => c.id === target.id)!.text).toContain("my note");
  } else {
    expect(items).toContain("Updates your edited card");
    await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
    const merged = (await cards(page)).find((c) => c.id === target.id)!.text;
    log("v3 merged card", merged);
    expect(merged).toContain("my note"); // the user's words stay
    expect(merged).toMatch(/\bfour\b|\b4\b/); // the new fact went in
  }
  await expect(reviewBar(page)).toBeHidden();
});

test("4. a locked card is left alone and the update reports it", async () => {
  test.setTimeout(AI_TIMEOUT * 2);
  const locked = (await mentioning(page, /approv/))[0]!;
  await select(page, locked.id);
  await origin(page).getByRole("button", { name: "🔒 Lock" }).click();
  await expect(page.locator(`.acute-lock-marker[data-element-id="${locked.id}"]`)).toBeVisible();
  const before = (await cards(page)).find((c) => c.id === locked.id)!.text;

  // A change of meaning (not a rewording the change check may treat as the same): only write tools need approval now.
  const v4 = V2.replace("three servers", "four servers").replace("Every tool call needs the user's approval.", "Only tools that write data need the user's approval.");
  aiRequests.length = 0;
  await updateFrom(page, v4);
  const result = await outcome(page);
  log("v4 outcome", result);
  log("v4 AI tasks", posts().map((r) => aiTaskOf(r)).filter(Boolean));
  // The skip is reported: in the review bar when other cards changed, else as the update's notice.
  await expect(page.getByText(/locked cards? not updated/).first()).toBeVisible();
  if (result === "review") {
    const items = await reviewItems(page);
    log("v4 review", items);
    const touched = await reviewBar(page).locator(`[data-element-id="${locked.id}"]`).count();
    expect(touched).toBe(0);
    await reviewBar(page).getByRole("button", { name: /^Accept all/ }).click();
  }
  expect((await cards(page)).find((c) => c.id === locked.id)!.text).toBe(before);
});
