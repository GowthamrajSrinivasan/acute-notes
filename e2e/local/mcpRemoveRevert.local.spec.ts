/**
 * Full-gate regression spec (2026-11-15): the revert/delete behaviour unrestricted remote MCP (`MCP_REMOTE_PROFILE=full`)
 * needs before it may open. Source: `.ai/docs/mcp-write-surface-audit-2026-11-15.md` §4 gaps 1 and 2 (A2, A3, A4) and
 * gap 9 (an emptied Acute section frame deleted without being listed). Required by `scripts/chatgpt-mcp-session.ps1`
 * for `-Profile full`.
 *
 * Every test is marked `test.fail(...)` with the deferred defect it documents: the normal local suite stays green, and
 * the launch gate's mark check keeps the FULL gate closed while any mark remains (intended). When a fix lands, its test
 * starts passing, Playwright reports "expected to fail, but passed", and the mark must be removed. Never weaken an
 * assertion to get there. Unit half: `src/ai/changes/removeRevertBaseline.test.ts`.
 *
 * Required behaviour (the `update_block` model, `src/ai/changes/staleTarget.ts`):
 * - `delete_object` / `delete_connection`: a target the user edited after the proposal is not deleted at Accept; the
 *   review asks (Keep mine / Delete anyway). Keep mine writes nothing; Delete anyway deletes as one undo step.
 * - `revert_agent_changes`: a block whose CONTENT the user edited after the agent's change (a document-store edit, which
 *   never bumps the element version) comes back as a conflict, whether the edit came before the revert was proposed or
 *   between proposal and Accept. Keep current leaves the content exactly as the user left it.
 * - A section frame Acute drew, emptied by a delete, is listed in the review before Accept, never removed silently.
 *
 * These drive the real tools over the MCP endpoint with a LOCAL bearer session (unfiltered: the remote profile filter
 * does not apply), so they switch MCP access on and run in the isolated `-Verify` run. No AI.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp, undo } from "../helpers";

/** The deferred defects (audit 2026-11-15). Remove a test's mark when its fix lands. */
const DELETE_DEFECT = "deferred defect: delete_object/delete_connection `remove` has no baseline and no Accept re-check, so an edit made during review is deleted without asking (audit gap 2, A2/A3) — remove when the fix lands";
const REVERT_PLAN_DEFECT = "deferred defect: revert_agent_changes detects edits by element version only and block content edits never bump it, so the user's text is reset without asking (audit gap 1b, A4) — remove when the fix lands";
const REVERT_ACCEPT_DEFECT = "deferred defect: a revert's restore/remove is not re-checked at Accept, so an edit made after the revert was proposed is overwritten (audit gap 1a, A4) — remove when the fix lands";
const FRAME_DEFECT = "deferred defect: an Acute section frame emptied by a delete is removed at Accept without being listed in the review (audit gap 9, A2 note) — remove when the fix lands";

/** The decision's buttons. Adjust to the shipped wording if it differs (an equivalent pair is fine). */
const KEEP = /^(Keep mine|Keep current)$/;
const DELETE_ANYWAY = /^Delete anyway$/;

const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const decision = (p: Page) => review(p).getByRole("listitem", { name: /^Conflict: / });

type SceneEl = { id: string; type: string; version: number; versionNonce: number; isDeleted?: boolean; containerId?: string | null; frameId?: string | null; name?: string | null; text?: string; originalText?: string; customData?: { acute?: { documentId?: string } } };
type Dev = {
  api: { getSceneElements(): SceneEl[]; updateScene(s: { elements: SceneEl[]; captureUpdate?: string }): void };
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
      { operationId: "op_remove_revert_setup", title: "Setup", metadata: { createdBy: "import" } },
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
    const doc = d.api.getSceneElements().find((e) => e.id === x && !e.isDeleted)?.customData?.acute?.documentId;
    return JSON.stringify(doc ? d.store.get(doc)?.snapshot : null);
  }, id);

const isLive = (page: Page, id: string) => dev(page, (d, x) => d.api.getSceneElements().some((e) => e.id === x && !e.isDeleted), id);
const versionOf = (page: Page, id: string) => dev(page, (d, x) => d.api.getSceneElements().find((e) => e.id === x)?.version ?? null, id);
const lastStep = (page: Page) => dev(page, (d) => d.history.lastStepId);
/** Two animation frames: lets any layout reaction to an edit (block auto-height) land before reading versions. */
const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** The user's edit in the block's editor: the document store only (the element's version does not move). */
const userEdit = (page: Page, id: string, text: string) =>
  dev(page, (d, a) => {
    const doc = d.api.getSceneElements().find((e) => e.id === a.id)!.customData!.acute!.documentId!;
    d.store.updateSnapshot(doc, [{ type: "paragraph", content: [{ type: "text", text: a.text, styles: {} }], children: [] }]);
  }, { id, text });

/** An MCP session over the local bearer token (MCP access switched on in the app). */
async function mcpClient(page: Page) {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("button", { name: "Show" }).first().click();
  const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
  await dialog.getByRole("button", { name: "Done" }).click();
  const client = new Client({ name: "remove-revert", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const ok = async <T = Record<string, unknown>>(tool: string, args: Record<string, unknown> = {}): Promise<T> => {
    const res = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
    expect(res.isError, `${tool}: ${JSON.stringify(res.content)}`).toBeFalsy();
    return res.structuredContent as T;
  };
  return { client, ok };
}

type Mcp = Awaited<ReturnType<typeof mcpClient>>;

/** The agent's accepted `update_block` ("Retry limit: 5" → "3"), and its change record id (what revert_agent_changes takes). */
async function agentUpdated(page: Page, mcp: Mcp, block: string): Promise<string> {
  await mcp.ok("update_block", { objectId: block, markdown: "Retry limit: 3" });
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  expect(await textOf(page, block)).toContain("Retry limit: 3");
  let id: string | undefined;
  await expect
    .poll(async () => {
      const recent = await mcp.ok<{ changes: { id: string; tool: string }[] }>("get_recent_changes");
      id = recent.changes.find((c) => c.tool === "update_block")?.id;
      return id;
    })
    .toBeTruthy();
  return id!;
}

test.describe("full MCP gate: delete_object / delete_connection never delete an edit made during review", () => {
  test("delete_object, block content edited before Accept: the review asks; Delete anyway deletes as one undo step", async ({ page }) => {
    test.fail(true, DELETE_DEFECT);
    await openApp(page);
    const block = await oneBlock(page);
    const mcp = await mcpClient(page);
    await mcp.ok("delete_object", { objectIds: [block] });
    await expect(review(page)).toBeVisible();
    await userEdit(page, block, "Retry limit: 4");
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    // Today: the block is deleted with the user's edit, and no decision is shown.
    await expect(decision(page)).toBeVisible({ timeout: 5_000 });
    await expect(decision(page).getByRole("button", { name: KEEP })).toBeVisible();
    await expect(decision(page).getByRole("button", { name: DELETE_ANYWAY })).toBeVisible();
    expect(await isLive(page, block)).toBe(true);
    expect(await textOf(page, block)).toContain("Retry limit: 4");
    // Delete anyway: deleted, as one undo step that brings the block back with the user's edit.
    await decision(page).getByRole("button", { name: DELETE_ANYWAY }).click();
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    expect(await isLive(page, block)).toBe(false);
    await undo(page);
    await expect.poll(() => isLive(page, block)).toBe(true);
    expect(await textOf(page, block)).toContain("Retry limit: 4");
    await mcp.client.close();
  });

  test("delete_object, block content edited before Accept: Keep mine keeps the block and the edit, and writes nothing", async ({ page }) => {
    test.fail(true, DELETE_DEFECT);
    await openApp(page);
    const block = await oneBlock(page);
    const mcp = await mcpClient(page);
    await mcp.ok("delete_object", { objectIds: [block] });
    await expect(review(page)).toBeVisible();
    await userEdit(page, block, "Retry limit: 4");
    const step = await lastStep(page);
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(decision(page)).toBeVisible({ timeout: 5_000 });
    await decision(page).getByRole("button", { name: KEEP }).click();
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    expect(await isLive(page, block)).toBe(true);
    expect(await textOf(page, block)).toContain("Retry limit: 4");
    expect(await lastStep(page)).toBe(step);
    await mcp.client.close();
  });

  test("delete_connection, label edited before Accept: the review asks, and Keep mine keeps the connection and its label", async ({ page }) => {
    test.fail(true, DELETE_DEFECT);
    await openApp(page);
    const before = await dev(page, (d) => d.api.getSceneElements().map((e) => e.id));
    await dev(page, (d) =>
      d.proposeChanges({
        operationId: "op_remove_revert_link",
        title: "Setup",
        metadata: { createdBy: "import" },
        changes: [
          { kind: "create_shape", key: "a", shape: "rectangle", label: "Checkout", box: { x: 0, y: 0, width: 160, height: 80 } },
          { kind: "create_shape", key: "b", shape: "rectangle", label: "Payments", box: { x: 400, y: 0, width: 160, height: 80 } },
          { kind: "connect", key: "l", from: { created: "a" }, to: { created: "b" }, label: "calls" },
        ],
      }),
    );
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    const arrow = await dev(page, (d, old) => d.api.getSceneElements().find((e) => !e.isDeleted && e.type === "arrow" && !old.includes(e.id))!.id, before);
    const labelOf = () => dev(page, (d, x) => d.api.getSceneElements().find((e) => !e.isDeleted && e.type === "text" && e.containerId === x)?.originalText ?? null, arrow);
    expect(await labelOf()).toBe("calls");

    const mcp = await mcpClient(page);
    await mcp.ok("delete_connection", { connectionIds: [arrow] });
    await expect(review(page)).toBeVisible();
    // The user retypes the label (its bound text, as Excalidraw's text editor writes it).
    await dev(page, (d, x) =>
      d.api.updateScene({
        elements: d.api.getSceneElements().map((e) => (!e.isDeleted && e.type === "text" && e.containerId === x ? { ...e, text: "calls (retried)", originalText: "calls (retried)", version: e.version + 1, versionNonce: e.versionNonce + 1 } : e)),
        captureUpdate: "IMMEDIATELY",
      }),
    arrow);
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    // Today: the arrow and the edited label are deleted, and no decision is shown.
    await expect(decision(page)).toBeVisible({ timeout: 5_000 });
    expect(await isLive(page, arrow)).toBe(true);
    await decision(page).getByRole("button", { name: KEEP }).click();
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    expect(await isLive(page, arrow)).toBe(true);
    expect(await labelOf()).toBe("calls (retried)");
    await mcp.client.close();
  });

  test("delete_object that empties an Acute section frame: the frame's removal is listed in the review before Accept", async ({ page }) => {
    test.fail(true, FRAME_DEFECT);
    await openApp(page);
    await dev(page, (d) =>
      d.proposeChanges({
        operationId: "op_remove_revert_frame",
        title: "Setup",
        metadata: { createdBy: "import" },
        changes: [
          { kind: "create_frame", key: "f", title: "Retry policy", box: { x: 0, y: 0, width: 400, height: 300 }, children: ["s"] },
          { kind: "create_shape", key: "s", shape: "rectangle", label: "Retry limit", box: { x: 40, y: 80, width: 160, height: 80 } },
        ],
      }),
    );
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    const shape = (await elements(page)).find((e) => e.text === "Retry limit")!.containerId!;
    const frame = await dev(page, (d, x) => d.api.getSceneElements().find((e) => e.id === x)!.frameId!, shape);
    // Precondition: the shape (and its label) are the frame's only members, so deleting it empties the frame.
    expect(await dev(page, (d, f) => d.api.getSceneElements().filter((e) => !e.isDeleted && e.frameId === f && e.type !== "text").map((e) => e.id), frame)).toEqual([shape]);

    const mcp = await mcpClient(page);
    await mcp.ok("delete_object", { objectIds: [shape] });
    await expect(review(page)).toBeVisible();
    await review(page).getByRole("button", { name: /^Review/ }).click();
    const list = review(page).getByRole("list", { name: "Proposed changes" });
    await expect(list).toBeVisible();
    // Today the list shows only "Delete an object (asked by the agent)"; the frame goes at Accept without being listed.
    await expect(list.getByRole("listitem").filter({ hasText: /section|frame/i })).toHaveCount(1, { timeout: 5_000 });
    await mcp.client.close();
  });
});

test.describe("full MCP gate: revert_agent_changes never resets a block's content edited since without asking", () => {
  test("content edited after the agent's update, before the revert was proposed: the revert asks; Keep current leaves the content exactly", async ({ page }) => {
    test.fail(true, REVERT_PLAN_DEFECT);
    await openApp(page);
    const block = await oneBlock(page);
    const mcp = await mcpClient(page);
    const change = await agentUpdated(page, mcp, block);
    const version = await versionOf(page, block);
    await userEdit(page, block, "Retry limit: 4");
    await settle(page);
    // Precondition: a content edit leaves the element's version alone (that is why version-based detection misses it).
    expect(await versionOf(page, block)).toBe(version);
    const edited = await textOf(page, block);
    expect(edited).toContain("Retry limit: 4");

    await mcp.ok("revert_agent_changes", { changeIds: [change], reason: "Regression spec: revert after a content edit" });
    await expect(review(page)).toBeVisible();
    // Today: a clean restore, no decision; accepting it puts back "Retry limit: 5" over the user's text.
    await expect(decision(page)).toBeVisible({ timeout: 5_000 });
    await decision(page).getByRole("button", { name: KEEP }).click();
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    expect(await textOf(page, block)).toBe(edited);
    await mcp.client.close();
  });

  test("content edited after the revert was proposed, before Accept: Accept asks instead of resetting it", async ({ page }) => {
    test.fail(true, REVERT_ACCEPT_DEFECT);
    await openApp(page);
    const block = await oneBlock(page);
    const mcp = await mcpClient(page);
    const change = await agentUpdated(page, mcp, block);
    await mcp.ok("revert_agent_changes", { changeIds: [change], reason: "Regression spec: edit during the revert's review" });
    await expect(review(page)).toBeVisible();
    await userEdit(page, block, "Retry limit: 4");
    const edited = await textOf(page, block);
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    // Today: the restore is written at Accept and the block reads "Retry limit: 5" again.
    await expect(decision(page)).toBeVisible({ timeout: 5_000 });
    expect(await textOf(page, block)).toBe(edited);
    await decision(page).getByRole("button", { name: KEEP }).click();
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    expect(await textOf(page, block)).toBe(edited);
    await mcp.client.close();
  });
});
