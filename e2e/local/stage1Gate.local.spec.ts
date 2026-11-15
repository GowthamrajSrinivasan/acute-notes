/**
 * Intelligent Update Engine — Stage 1 gate, driven through the real app on the local tier (no AI connection, no
 * MCP). Each test is one of the five reviewer acceptance scenarios (`.ai/docs/intelligent-update-engine-plan.md`
 * "Stage 1 gate"), run through Visualize → "Update from new content" → review → Accept, and each asserts the change
 * was planned as a claim-level patch (`patch_block`: the review lists "Edit …: replaces “a” → “b”", never a
 * whole-card "Update: …"), then checks the stored card document itself.
 *
 * Gate 4 covers `patch_block` only: the whole-card `update_block` stale-target case is a separate known bug.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { action, openAskAI, recordAIRequests, undo } from "../helpers";

type Link = { contentSourceId: string } | null;

const visualizeDialog = (p: Page) => p.getByRole("dialog", { name: "Visualize" });
const updateDialog = (p: Page) => p.getByRole("dialog", { name: "Update from new content" });
const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const acceptedBar = (p: Page) => p.getByRole("status", { name: "AI changes" });
const proposed = (p: Page) => reviewBar(p).getByRole("list", { name: "Proposed changes" });
const conflicts = (p: Page) => reviewBar(p).getByRole("list", { name: "Changes that need your input" });

const link = (p: Page, id: string) =>
  p.evaluate(async (i) => (await (window as unknown as { __acuteDev: { reconciliation(i: string): Promise<{ link: Link } | null> } }).__acuteDev.reconciliation(i))?.link ?? null, id);
const sourceText = (p: Page, id: string) =>
  p.evaluate(async (i) => (await (window as unknown as { __acuteDev: { contentSource(i: string): Promise<{ version: { text: string } } | null> } }).__acuteDev.contentSource(i))?.version.text ?? null, id);

/** Every live block whose stored document mentions `needle`, as { id, text } (text = the stored snapshot as JSON). */
function blocksMentioning(p: Page, needle: string): Promise<{ id: string; text: string }[]> {
  return p.evaluate((n) => {
    type El = { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return dev.api.getSceneElements().flatMap((el) => {
      const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
      const text = docId ? JSON.stringify(dev.store.get(docId)?.snapshot ?? "") : "";
      return text.includes(n) ? [{ id: el.id, text }] : [];
    });
  }, needle);
}

async function oneBlock(p: Page, needle: string): Promise<{ id: string; text: string }> {
  await expect.poll(async () => (await blocksMentioning(p, needle)).length).toBe(1);
  return (await blocksMentioning(p, needle))[0]!;
}

/** Replaces a text in a block's stored document, as a user edit would. */
function editBlock(p: Page, id: string, from: string, to: string): Promise<void> {
  return p.evaluate(
    ({ id, from, to }) => {
      type El = { id: string; customData?: { acute?: { documentId?: string } } };
      type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown }; update(id: string, patch: unknown): void } };
      const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
      const docId = dev.api.getSceneElements().find((e) => e.id === id)!.customData!.acute!.documentId!;
      dev.store.update(docId, { snapshot: JSON.parse(JSON.stringify(dev.store.get(docId).snapshot).split(from).join(to)) });
    },
    { id, from, to },
  );
}

/** Every card's stored document, by element id — to prove the cards an update doesn't touch stay byte-for-byte. */
function allDocs(p: Page): Promise<Record<string, string>> {
  return p.evaluate(() => {
    type El = { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string; pageId?: string } } };
    type Dev = { api: { getSceneElements(): El[] }; store: { get(id: string): { snapshot: unknown } | null } };
    const dev = (window as unknown as { __acuteDev: Dev }).__acuteDev;
    return Object.fromEntries(
      dev.api.getSceneElements().flatMap((el) => {
        const docId = el.customData?.acute?.documentId ?? el.customData?.acute?.pageId;
        return docId ? [[el.id, JSON.stringify(dev.store.get(docId)?.snapshot ?? "")]] : [];
      }),
    );
  });
}

const v1 = [
  "# Gateway notes",
  "",
  "## Limits",
  "",
  "A client can connect to five servers at once. Each request **times out** after 10 seconds. See the [limits page](https://example.com/limits) for *details*.",
  "",
  "## Retries",
  "",
  "Retries happen three times with a fixed delay.",
  "",
  "## Security",
  "",
  "The gateway is reachable from the public internet.",
  "",
  "## Regions",
  "",
  "The service runs in two regions.",
  "",
].join("\n");

async function updateFrom(p: Page, objectId: string, text: string) {
  const surface = await openAskAI(p, objectId);
  await (await action(surface, "Update from new content")).click();
  await expect(updateDialog(p)).toBeVisible();
  await updateDialog(p).getByRole("textbox").fill(text);
  await updateDialog(p).getByRole("button", { name: "Update", exact: true }).click();
  await expect(updateDialog(p)).toBeHidden();
}

/** Opens the review list and returns its items' labels. */
async function reviewItems(p: Page): Promise<string[]> {
  // Wait for the bar first: checking the toggle once, before the bar renders, skipped the click (flaky gate 1, 2026-11-15).
  await expect(reviewBar(p)).toBeVisible();
  const toggle = reviewBar(p).getByRole("button", { name: "Review", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await expect(proposed(p)).toBeVisible();
  return (await proposed(p).getByRole("listitem").allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());
}

test.describe.configure({ mode: "serial" });
let page: Page;
let sourceId: string;
let latest = v1;
let aiRequests: ReturnType<typeof recordAIRequests>;
let gate5Requests: ReturnType<typeof recordAIRequests> = [];

/** A fresh canvas (its own browser context, so its own storage) with `text` visualized and accepted, recording AI requests. */
async function freshCanvas(browser: Browser, text: string): Promise<{ page: Page; requests: ReturnType<typeof recordAIRequests> }> {
  const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const p = await context.newPage();
  const requests = recordAIRequests(p);
  await p.goto("/");
  await p.locator(".excalidraw").waitFor();
  await p.waitForFunction(() => Boolean((window as unknown as { __acuteDev?: unknown }).__acuteDev));
  await p.getByRole("button", { name: "More", exact: true }).click();
  await p.getByRole("menuitem", { name: "Visualize content…" }).click();
  await visualizeDialog(p).getByRole("textbox").fill(text);
  await visualizeDialog(p).getByRole("button", { name: "Visualize", exact: true }).click();
  await reviewBar(p).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(p)).toBeHidden();
  return { page: p, requests };
}

test.beforeAll(async ({ browser }) => {
  ({ page, requests: aiRequests } = await freshCanvas(browser, v1));
  const limits = await oneBlock(page, "five servers");
  sourceId = (await link(page, limits.id))!.contentSourceId;
});
test.afterAll(async () => {
  await page?.context().close();
});

/** Proposes `next` as the source's new text (from the card mentioning `on`), returning the review's item labels. */
async function propose(p: Page, on: string, next: string): Promise<string[]> {
  await updateFrom(p, (await oneBlock(p, on)).id, next);
  return reviewItems(p);
}

/** A claim-level patch's review label (`patch_block`); a whole-card `update_block` reads "Update: …". */
const PATCH = /^(Edit|Updates your edited card) .*: /;

test("gate 1 — single claim: one fact changes as a claim-level patch, the rest of the card and canvas untouched", async () => {
  const card = await oneBlock(page, "five servers");
  const before = await allDocs(page);
  latest = v1.replace("five servers", "three servers");
  const items = await propose(page, "five servers", latest);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatch(PATCH);
  expect(items[0]).toContain("replaces “five” → “three”");
  expect(items.join("\n")).not.toContain("Update:");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");

  const after = await allDocs(page);
  // Same object; its stored document is byte-for-byte the old one with one word swapped (block id, props, bold run,
  // link, italic run all identical).
  expect(after[card.id]).toBe(before[card.id]!.replace("five servers", "three servers"));
  for (const id of Object.keys(before)) if (id !== card.id) expect(after[id], `card ${id} untouched`).toBe(before[id]);
  await expect.poll(() => sourceText(page, sourceId)).toBe(latest);
});

test("gate 2 — multiple claims in one block: both facts in one patch, applied and undone as one step", async () => {
  const card = await oneBlock(page, "three servers");
  const before = await allDocs(page);
  latest = latest.replace("three servers", "four servers").replace("after 10 seconds", "after 30 seconds");
  const items = await propose(page, "three servers", latest);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatch(PATCH);
  expect(items[0]).toContain("replaces “three” → “four”");
  expect(items[0]).toContain("replaces “10” → “30”");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");
  const expected = before[card.id]!.replace("three servers", "four servers").replace(" after 10 seconds", " after 30 seconds");
  expect((await allDocs(page))[card.id]).toBe(expected);

  // Atomic: one Undo takes both facts back together; re-running applies both again.
  await undo(page);
  await expect.poll(async () => (await allDocs(page))[card.id]).toBe(before[card.id]);
  await propose(page, "three servers", latest);
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect.poll(async () => (await allDocs(page))[card.id]).toBe(expected);
});

test("gate 3 — rich formatting: source marks and a user-added mark outside the edit survive the patch", async () => {
  const card = await oneBlock(page, "four servers");
  // Source formatting (bold run, link, italic run) is already proven byte-identical by gates 1–2. Now the user adds
  // their own: "connect" underlined, splitting the first text run, as the editor stores it.
  await editBlock(
    page,
    card.id,
    '{"type":"text","text":"A client can connect to four servers at once. Each request ","styles":{}}',
    '{"type":"text","text":"A client can ","styles":{}},{"type":"text","text":"connect","styles":{"underline":true}},{"type":"text","text":" to four servers at once. Each request ","styles":{}}',
  );
  const before = (await allDocs(page))[card.id]!;
  expect(before).toContain('"underline":true');
  latest = latest.replace("after 30 seconds", "after 45 seconds");
  const items = await propose(page, "four servers", latest);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatch(PATCH);
  expect(items[0]).toContain("“30” → “45”");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");
  const after = (await allDocs(page))[card.id]!;
  expect(after).toBe(before.replace(" after 30 seconds", " after 45 seconds"));
  for (const mark of ['"underline":true', '"bold":true', '"italic":true', '"href":"https://example.com/limits"']) expect(after).toContain(mark);
});

test("gate 4 — concurrent modification: a patch whose card changed after planning is skipped, the rest applies", async () => {
  const retries = await oneBlock(page, "three times");
  const limits = await oneBlock(page, "four servers");
  latest = latest.replace("four servers", "six servers").replace("three times", "five times");
  const items = await propose(page, "three times", latest);
  expect(items).toHaveLength(2);
  for (const item of items) expect(item).toMatch(PATCH);
  expect(items.join("\n")).toContain("“three” → “five”");
  expect(items.join("\n")).toContain("“four” → “six”");

  // Between proposal and Accept, the user edits the Retries card.
  await editBlock(page, retries.id, "with a fixed delay.", "with a fixed delay (my note: per region).");
  const edited = (await allDocs(page))[retries.id]!;
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");
  await expect(acceptedBar(page)).toContainText("1 precise edit was skipped: its card changed since the update was planned.");
  const after = await allDocs(page);
  expect(after[retries.id]).toBe(edited); // the stale patch wrote nothing: the user's edit and the old fact kept
  expect(after[retries.id]).toContain("three times");
  expect(after[limits.id]).toContain("six servers"); // the other card's patch still applied
});

const NOTHING_CHANGED = "Nothing changed — the canvas already matches this content.";

/** Updates from `text` and says what the user was shown: the review bar, or the "Nothing changed" toast. */
async function rerun(p: Page, objectId: string, text: string): Promise<"review" | "nothing-changed"> {
  const nothing = p.getByText(NOTHING_CHANGED);
  await expect(nothing).toBeHidden(); // an earlier run's toast is gone
  await updateFrom(p, objectId, text);
  await expect(nothing.or(reviewBar(p))).toBeVisible();
  return (await nothing.isVisible()) ? "nothing-changed" : "review";
}

test("gate 4 follow-up — “Update again to redo it”: re-running the same content offers exactly the skipped fact, then nothing", async () => {
  // Fixed 2026-11-15 (found 2026-11-14): the accept that skipped the stale patch recorded the new content version as
  // proposed, so the re-run said "Nothing changed" and the fact was lost. The version now keeps the skipped card's node
  // as it was (`recordPartlyAppliedSource`): the applied fact is recorded, the skipped one is not.
  const retries = await oneBlock(page, "three times");
  const recorded = latest.replace("five times", "three times");
  await expect.poll(() => sourceText(page, sourceId)).toBe(recorded);
  test.info().annotations.push({ type: "source after gate 4", description: String(await sourceText(page, sourceId)) });
  const outcome = await rerun(page, retries.id, latest);
  test.info().annotations.push({ type: "re-run outcome", description: outcome });
  expect(outcome).toBe("review");
  // Retry: exactly the skipped fact, merged into the user's edit — the applied “four” → “six” is not proposed again.
  const items = await reviewItems(page);
  test.info().annotations.push({ type: "retry items", description: items.join(" | ") });
  expect(items).toHaveLength(1);
  expect(items[0]).toMatch(PATCH);
  expect(items[0]).toContain("“three” → “five”");
  expect(items.join("\n")).not.toContain("six");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");
  const after = (await allDocs(page))[retries.id]!;
  expect(after).toContain("five times");
  expect(after).toContain("(my note: per region)");
  await expect.poll(() => sourceText(page, sourceId)).toBe(latest);

  // Subsequent reconciliation: the same content again changes nothing.
  expect(await rerun(page, retries.id, latest)).toBe("nothing-changed");
});

test("gate 4b — concurrent modification, the stale patch the only change: nothing is written", async () => {
  const regions = await oneBlock(page, "two regions");
  const next = latest.replace("two regions", "three regions");
  const items = await propose(page, "two regions", next);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatch(PATCH);
  expect(items[0]).toContain("“two” → “three”");
  await editBlock(page, regions.id, "The service runs", "The service currently runs");
  const edited = (await allDocs(page))[regions.id]!;
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  // Record what the user is told, for the reviewer.
  const toast = page.locator(".Toast");
  await expect(toast).toBeVisible();
  test.info().annotations.push({ type: "toast", description: (await toast.innerText()).trim() });
  // A card changed since planning is not a deleted object.
  await expect(toast).toContainText("Nothing was applied: the card changed since this update was planned. Update again to redo it.");
  await expect(toast).not.toContainText("deleted");
  expect((await allDocs(page))[regions.id]).toBe(edited);
  // Nothing was applied, so no version was recorded: the source is as before, and the same content offers the fact again.
  expect(await sourceText(page, sourceId)).toBe(latest);
  expect(await rerun(page, regions.id, next)).toBe("review");
  expect((await reviewItems(page)).join(" | ")).toContain("“two” → “three”");
  await reviewBar(page).getByRole("button", { name: "Reject" }).click();
  await expect(reviewBar(page)).toBeHidden();
});

test("gate 4c — a skipped fact survives a page reload before “Update again”", async () => {
  const limits = await oneBlock(page, "six servers");
  const retries = await oneBlock(page, "five times");
  const next = latest.replace("six servers", "seven servers").replace("five times", "four times");
  const items = await propose(page, "six servers", next);
  expect(items).toHaveLength(2);
  await editBlock(page, retries.id, "(my note: per region)", "(my note: per region, checked)");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");
  await expect(acceptedBar(page)).toContainText("1 precise edit was skipped");
  expect((await allDocs(page))[limits.id]).toContain("seven servers");
  // The version on record has the applied fact and not the skipped one (and is written before the reload).
  await expect.poll(() => sourceText(page, sourceId)).toBe(next.replace("four times", "five times"));

  await page.reload();
  await page.locator(".excalidraw").waitFor();
  await page.waitForFunction(() => Boolean((window as unknown as { __acuteDev?: unknown }).__acuteDev));
  const edited = await oneBlock(page, "per region, checked");
  expect(edited.id).toBe(retries.id);

  // Retry after the reload: just the skipped fact.
  expect(await rerun(page, retries.id, next)).toBe("review");
  const retry = await reviewItems(page);
  test.info().annotations.push({ type: "retry items after reload", description: retry.join(" | ") });
  expect(retry).toHaveLength(1);
  expect(retry[0]).toMatch(PATCH);
  expect(retry[0]).toContain("“five” → “four”");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");
  const after = await allDocs(page);
  expect(after[retries.id]).toContain("four times");
  expect(after[retries.id]).toContain("(my note: per region, checked)");
  expect(after[limits.id]).toContain("seven servers");
  await expect.poll(() => sourceText(page, sourceId)).toBe(next);
  latest = next;

  // And then nothing changed.
  expect(await rerun(page, retries.id, latest)).toBe("nothing-changed");
});

test("gate 5 — EXTENDS adds, SUPERSEDES replaces, CONTRADICTS escalates for a decision", async ({ browser }) => {
  // On a canvas of its own, seeded with the content as the earlier gates left it: the shared canvas now holds a card in the
  // user's wording (the Retries card after the 4 follow-up and 4c merges), which draws an unrelated conflict once the
  // source moves on twice without it — a separate, pre-existing gap (see "known gap" below), not what this gate checks.
  const shared = latest; // the shared canvas's content, restored for the tests after this one
  const own = await freshCanvas(browser, latest);
  gate5Requests = own.requests;
  const page = own.page;
  const security = await oneBlock(page, "public internet");

  // EXTENDS: the claim keeps every word and gains more → an insertion that keeps the old words.
  let next = latest.replace("from the public internet.", "from the public internet through the edge proxy.");
  let items = await propose(page, "public internet", next);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatch(PATCH);
  expect(items[0]).toContain("adds “through the edge proxy”");
  expect(items[0]).not.toContain("replaces");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");
  expect((await allDocs(page))[security.id]).toContain("from the public internet through the edge proxy.");
  latest = next;

  // SUPERSEDES: the same claim with a term replaced → a replacement of just that term.
  next = latest.replace("the public internet", "the corporate internet");
  items = await propose(page, "public internet", next);
  expect(items).toHaveLength(1);
  expect(items[0]).toMatch(PATCH);
  expect(items[0]).toContain("replaces “public” → “corporate”");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");
  expect((await allDocs(page))[security.id]).toContain("from the corporate internet through the edge proxy.");
  latest = next;

  // CONTRADICTS: a negation flip is never applied on its own — it becomes a decision.
  const before = (await allDocs(page))[security.id]!;
  next = latest.replace("The gateway is reachable", "The gateway is not reachable");
  await updateFrom(page, security.id, next);
  await expect(reviewBar(page)).toContainText("⚠ 1 needs your input");
  const card = conflicts(page).getByRole("listitem");
  await expect(card).toContainText("The new content contradicts this card");
  await expect(reviewBar(page).getByRole("button", { name: "Accept all clean changes" })).toBeDisabled();
  expect((await allDocs(page))[security.id]).toBe(before);
  await card.getByRole("button", { name: "Keep mine" }).click();
  await reviewBar(page).getByRole("button", { name: "Accept all clean changes" }).click();
  expect((await allDocs(page))[security.id]).toBe(before);
  await page.context().close();
  latest = shared;
});

test("known gap — a card in the user's wording gets a conflict once the source moves on twice without it", async () => {
  // Found 2026-11-15 while fixing gate 4 (pre-existing, `reconcile/classify.ts` rule 2): a card whose content is the user's
  // wording (a merge onto an edited card, or Keep mine) and that the source has said nothing new about is "silent" only
  // while it is at the previous version; once two updates elsewhere are accepted it falls through to a "You edited this;
  // the new content changes it too" conflict offering the AI wording. Engine-lane decision (it can't be told apart from
  // an undone merge from the object alone). Remove `test.fail` once fixed.
  test.fail(true, "a user-worded card behind the source gets a spurious conflict");
  const retries = await oneBlock(page, "per region, checked");
  let next = latest.replace("from the public internet", "from the public network");
  expect(await propose(page, "public internet", next)).toHaveLength(1);
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(acceptedBar(page)).toContainText("Applied 1 update");
  latest = next;
  next = latest.replace("from the public network", "from the private network");
  await updateFrom(page, (await oneBlock(page, "public network")).id, next);
  await expect(reviewBar(page)).toBeVisible();
  const conflicted = await conflicts(page).getByRole("listitem").allInnerTexts().catch(() => [] as string[]);
  test.info().annotations.push({ type: "conflicts", description: conflicted.join(" | ") });
  expect(conflicted.join(" | ")).not.toContain("Retries");
  expect((await allDocs(page))[retries.id]).toContain("per region, checked");
});

test("no AI request was made", async () => {
  expect(aiRequests.map((r) => r.url())).toEqual([]);
  expect(gate5Requests.map((r) => r.url())).toEqual([]);
});
