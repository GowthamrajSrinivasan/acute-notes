/**
 * Keep mine / Use proposed on an MCP `update_block` whose block the user edited after it was proposed (stale-target
 * protection, `src/ai/changes/staleTarget.ts`; launch gate: chatgpt-mcp-architecture-and-test-plan.md §7.8–7.9).
 *
 * Two paths, the same decision:
 * - **MCP tool** — the real `update_block` tool over the MCP endpoint (its baseline is captured by the tool itself). These
 *   turn MCP access on, so they run only in the isolated `scripts/chatgpt-mcp-session.ps1 -Verify` run.
 * - **in-app path** — the same change and session an MCP tool emits, put up through the app's own `proposeChanges` (its
 *   baseline is stamped by the pending store). These need nothing enabled.
 *
 * Each checks: Accept withholds the edited block and shows the decision; Keep mine writes nothing; Use proposed writes the
 * proposal as one undo step, and undo brings the user's edit back.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test, type Page } from "@playwright/test";
import { openApp, undo } from "../helpers";

const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const decision = (p: Page) => review(p).getByRole("listitem", { name: /^Conflict: / });

type Dev = {
  api: { getSceneElements(): { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[] };
  store: { get(id: string): { snapshot?: unknown[] } | null; updateSnapshot(id: string, s: unknown[]): void };
  renderPlan(p: unknown, m: unknown): Promise<unknown>;
  proposeChanges(set: unknown): void;
  history: { lastStepId: number | null };
};
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T | Promise<T>, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

/** One accepted block, "Retry limit: 5". Returns its object id. */
async function oneBlock(page: Page): Promise<string> {
  const before = await dev(page, (d) => d.api.getSceneElements().map((e) => e.id));
  await dev(page, (d) =>
    d.renderPlan(
      { version: 1, template: "sectioned", nodes: [{ id: "a", type: "text", title: "Retry limit", content: { markdown: "Retry limit: 5" } }], relationships: [] },
      { operationId: "op_conflict_setup", title: "Setup", metadata: { createdBy: "import" } },
    ),
  );
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  const ids = await dev(page, (d, old) => d.api.getSceneElements().filter((e) => !e.isDeleted && e.customData?.acute?.documentId && !old.includes(e.id)).map((e) => e.id), before);
  expect(ids).toHaveLength(1);
  return ids[0]!;
}

const textOf = (page: Page, id: string) =>
  dev(page, (d, x) => {
    const doc = d.api.getSceneElements().find((e) => e.id === x)?.customData?.acute?.documentId;
    return JSON.stringify(doc ? d.store.get(doc)?.snapshot : null);
  }, id);

/** The user's edit in the block's editor (the document store). */
const userEdit = (page: Page, id: string, text: string) =>
  dev(page, (d, a) => {
    const doc = d.api.getSceneElements().find((e) => e.id === a.id)!.customData!.acute!.documentId!;
    d.store.updateSnapshot(doc, [{ type: "paragraph", content: [{ type: "text", text: a.text, styles: {} }], children: [] }]);
  }, { id, text });

/** What the MCP `update_block` tool proposes, through the app's own proposal path (in-app path). */
const proposeInApp = (page: Page, id: string, text: string) =>
  dev(page, (d, a) =>
    d.proposeChanges({
      operationId: "op_mcp_conflict",
      title: "ChatGPT: Update block",
      metadata: { createdBy: "mcp", task: "update_block", provider: "ChatGPT" },
      session: "mcp_conflict",
      agent: "ChatGPT",
      changes: [{ kind: "update_block", target: a.id, content: [{ type: "paragraph", content: a.text }] }],
    }),
  { id, text });

/** The real tool over the MCP endpoint (turns MCP access on: isolated `-Verify` run only). */
async function proposeViaMcp(page: Page, id: string, text: string): Promise<void> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("button", { name: "Show" }).first().click();
  const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
  await dialog.getByRole("button", { name: "Done" }).click();
  const client = new Client({ name: "mcp-conflict", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const res = await client.callTool({ name: "update_block", arguments: { objectId: id, markdown: text } });
  expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
  await client.close();
}

/** Proposed, then edited by the user, then Accept: the edit stays and the decision is shown. */
async function conflictAfterEdit(page: Page, propose: (page: Page, id: string, text: string) => Promise<unknown>): Promise<string> {
  await openApp(page);
  const block = await oneBlock(page);
  await propose(page, block, "Retry limit: 3");
  await expect(review(page)).toBeVisible();
  await userEdit(page, block, "Retry limit: 4");
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(decision(page)).toBeVisible();
  await expect(decision(page)).toContainText(/Edited since this update was proposed/);
  await expect(decision(page).getByRole("button", { name: "Keep mine" })).toBeVisible();
  await expect(decision(page).getByRole("button", { name: "Use proposed" })).toBeVisible();
  // Nothing written yet: the decision comes first.
  expect(await textOf(page, block)).toContain("Retry limit: 4");
  expect(await textOf(page, block)).not.toContain("Retry limit: 3");
  return block;
}

async function keepMine(page: Page, block: string) {
  const step = await dev(page, (d) => d.history.lastStepId);
  await decision(page).getByRole("button", { name: "Keep mine" }).click();
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  expect(await textOf(page, block)).toContain("Retry limit: 4");
  expect(await textOf(page, block)).not.toContain("Retry limit: 3");
  // Keep mine wrote nothing: no undo step for it.
  expect(await dev(page, (d) => d.history.lastStepId)).toBe(step);
}

async function useProposed(page: Page, block: string) {
  await decision(page).getByRole("button", { name: "Use proposed" }).click();
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  expect(await textOf(page, block)).toContain("Retry limit: 3");
  // One undo step: undo brings back the user's edit (not the original).
  await undo(page);
  expect(await textOf(page, block)).toContain("Retry limit: 4");
}

test.describe("Keep mine / Use proposed on an MCP update_block", () => {
  test("in-app path: Keep mine keeps the user's edit and writes nothing", async ({ page }) => {
    await keepMine(page, await conflictAfterEdit(page, proposeInApp));
  });

  test("in-app path: Use proposed writes the proposal as one undo step", async ({ page }) => {
    await useProposed(page, await conflictAfterEdit(page, proposeInApp));
  });

  test("MCP tool: Keep mine keeps the user's edit and writes nothing", async ({ page }) => {
    await keepMine(page, await conflictAfterEdit(page, proposeViaMcp));
  });

  test("MCP tool: Use proposed writes the proposal as one undo step", async ({ page }) => {
    await useProposed(page, await conflictAfterEdit(page, proposeViaMcp));
  });
});
