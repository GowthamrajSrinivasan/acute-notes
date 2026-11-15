/**
 * Stale-target protection: the acceptance tests for the fix (P0, release blocker before the real ChatGPT run;
 * owner: the `ai/changes` owner, integrator/update-engine lane; see knowledge-notes-lanes.md "Requests" and
 * chatgpt-mcp-architecture-and-test-plan.md §7.8).
 *
 * The defect (found 2026-11-13 by `chatgptRehearsal.local.spec.ts`): an `update_block` proposed for a block, accepted
 * after the user edited that block, overwrites the user's edit without a warning.
 *
 * Fixed 2026-11-15 (`src/ai/changes/staleTarget.ts`): the expected-failure marks are gone because these pass. The review
 * shows a changed target as a conflict ("Edited since this update was proposed", Keep mine / Use proposed). The
 * reload test enables MCP access, so it runs only in the isolated `-Verify` run; the others propose in-app.
 *
 * Required behaviour (user, 2026-11-13):
 * - Every proposal producer (MCP, Visualize, Ask AI, update engine) gets the same protection; these tests propose
 *   through the app's own `proposeChanges`, the path all of them share.
 * - The baseline captured at proposal time is compared with the live target **at Accept**.
 * - Multi-block proposals detect conflicts per target: other targets still apply.
 * - The conflict is shown before any affected edit is committed: Keep mine / Use proposed.
 * - Undo restores the previous canvas state. Accept and resolution act on the latest state in one transaction.
 * - Covered: an edit after proposal, after a reload, and immediately before Accept.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test, type Page } from "@playwright/test";
import { openApp, undo } from "../helpers";

/** What the review shows for a target that changed since the proposal. Adjust to the shipped wording. */
const CONFLICT = /changed since|edited since|conflict|keep mine/i;
const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });

type Dev = {
  api: { getSceneElements(): { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[] };
  store: { get(id: string): { snapshot?: unknown[] } | null; updateSnapshot(id: string, s: unknown[]): void };
  renderPlan(p: unknown, m: unknown): Promise<unknown>;
  proposeChanges(set: unknown): void;
};
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T | Promise<T>, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

/** Two blocks, "Retry limit: 5" and "Timeout: 30 s", accepted. Returns their object ids. */
async function twoBlocks(page: Page): Promise<[string, string]> {
  const before = await dev(page, (d) => d.api.getSceneElements().map((e) => e.id));
  await dev(page, (d) =>
    d.renderPlan(
      { version: 1, template: "sectioned", nodes: [{ id: "a", type: "text", title: "Retry limit", content: { markdown: "Retry limit: 5" } }, { id: "b", type: "text", title: "Timeout", content: { markdown: "Timeout: 30 s" } }], relationships: [] },
      { operationId: "op_stale_setup", title: "Setup", metadata: { createdBy: "import" } },
    ),
  );
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  const ids = await dev(page, (d, old) => d.api.getSceneElements().filter((e) => !e.isDeleted && e.customData?.acute?.documentId && !old.includes(e.id)).map((e) => e.id), before);
  const text = await Promise.all(ids.map((id) => textOf(page, id)));
  return [ids[text.findIndex((t) => t.includes("Retry limit: 5"))]!, ids[text.findIndex((t) => t.includes("Timeout: 30"))]!];
}

const textOf = (page: Page, id: string) =>
  dev(page, (d, x) => {
    const doc = d.api.getSceneElements().find((e) => e.id === x)?.customData?.acute?.documentId;
    return JSON.stringify(doc ? d.store.get(doc)?.snapshot : null);
  }, id);

/** The user's edit of a block, as the editor makes it (the document store). */
const userEdit = (page: Page, id: string, text: string) =>
  dev(page, (d, a) => {
    const doc = d.api.getSceneElements().find((e) => e.id === a.id)!.customData!.acute!.documentId!;
    d.store.updateSnapshot(doc, [{ type: "paragraph", content: [{ type: "text", text: a.text, styles: {} }], children: [] }]);
  }, { id, text });

/** An AI/MCP proposal updating `targets`, through the path every producer shares. */
const propose = (page: Page, targets: { id: string; text: string }[], operationId = "op_stale") =>
  dev(page, (d, a) =>
    d.proposeChanges({
      operationId: a.operationId,
      title: "Remote client: Update blocks",
      metadata: { createdBy: "mcp" },
      changes: a.targets.map((t) => ({ kind: "update_block", target: t.id, content: [{ type: "paragraph", content: t.text }] })),
    }),
  { targets, operationId });

/** An MCP session (the producer ChatGPT uses): only agent-session proposals persist across a reload. */
async function mcpClient(page: Page): Promise<Client> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("button", { name: "Show" }).first().click();
  const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
  await dialog.getByRole("button", { name: "Done" }).click();
  const client = new Client({ name: "stale-target", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

test.describe("stale-target protection", () => {
  test("an edit after the proposal: Accept shows a conflict and keeps the user's edit", async ({ page }) => {
    await openApp(page);
    const [retry] = await twoBlocks(page);
    await propose(page, [{ id: retry, text: "Retry limit: 3" }]);
    await expect(review(page)).toBeVisible();
    await userEdit(page, retry, "Retry limit: 4");
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(page.getByText(CONFLICT).first()).toBeVisible({ timeout: 5_000 });
    expect(await textOf(page, retry)).toContain("Retry limit: 4");
  });

  test("an edit after a reload: the stored proposal is still checked against the live block", async ({ page }) => {
    await openApp(page);
    const [retry] = await twoBlocks(page);
    const client = await mcpClient(page);
    const res = await client.callTool({ name: "update_block", arguments: { objectId: retry, markdown: "Retry limit: 3" } });
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    await client.close();
    await page.reload();
    await expect(review(page)).toBeVisible();
    // The canvas dev hook is installed asynchronously after a reload: wait for it before editing (flaky 5/6, 2026-11-15).
    await page.waitForFunction(() => Boolean((window as unknown as { __acuteDev?: { api?: unknown } }).__acuteDev?.api));
    await userEdit(page, retry, "Retry limit: 4");
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(page.getByText(CONFLICT).first()).toBeVisible({ timeout: 5_000 });
    expect(await textOf(page, retry)).toContain("Retry limit: 4");
  });

  test("an edit immediately before Accept (same task): still caught", async ({ page }) => {
    await openApp(page);
    const [retry] = await twoBlocks(page);
    await propose(page, [{ id: retry, text: "Retry limit: 3" }]);
    await expect(review(page)).toBeVisible();
    // Edit and click Accept in one task: no render in between.
    await page.evaluate((id) => {
      const d = (window as unknown as { __acuteDev: Dev }).__acuteDev;
      const doc = d.api.getSceneElements().find((e) => e.id === id)!.customData!.acute!.documentId!;
      d.store.updateSnapshot(doc, [{ type: "paragraph", content: [{ type: "text", text: "Retry limit: 4", styles: {} }], children: [] }]);
      const accept = [...document.querySelectorAll<HTMLButtonElement>('[role="region"][aria-label="AI changes to review"] button')].find((b) => /^Accept all/.test(b.textContent ?? ""));
      accept?.click();
    }, retry);
    await expect(page.getByText(CONFLICT).first()).toBeVisible({ timeout: 5_000 });
    expect(await textOf(page, retry)).toContain("Retry limit: 4");
  });

  test("a multi-block proposal: the edited target conflicts, the untouched one applies, and undo restores both", async ({ page }) => {
    await openApp(page);
    const [retry, timeout] = await twoBlocks(page);
    const before = { retry: await textOf(page, retry), timeout: await textOf(page, timeout) };
    await propose(page, [
      { id: retry, text: "Retry limit: 3" },
      { id: timeout, text: "Timeout: 10 s" },
    ]);
    await expect(review(page)).toBeVisible();
    await userEdit(page, retry, "Retry limit: 4");
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(page.getByText(CONFLICT).first()).toBeVisible({ timeout: 5_000 });
    expect(await textOf(page, retry)).toContain("Retry limit: 4");
    expect(await textOf(page, timeout)).toContain("Timeout: 10 s");
    // Undo restores the state before the accepted part (the user's own edit stays theirs).
    await undo(page);
    expect(await textOf(page, timeout)).toBe(before.timeout);
    expect(await textOf(page, retry)).toContain("Retry limit: 4");
  });
});

// update_shape (2026-11-15): the same protection for a shape's label. Proposed in-app (no MCP access needed).
type SceneEl = { id: string; type: string; isDeleted?: boolean; containerId?: string | null; text?: string; originalText?: string; version: number; versionNonce: number };
type ShapeDev = { api: { getSceneElements(): SceneEl[]; updateScene(s: { elements: SceneEl[]; captureUpdate?: string }): void } };
const shapeDev = <T, A = undefined>(p: Page, fn: (d: ShapeDev, a: A) => T | Promise<T>, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: ShapeDev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

/** A shape labelled "Orders", accepted. Returns its id. */
async function oneShape(page: Page): Promise<string> {
  const before = await shapeDev(page, (d) => d.api.getSceneElements().map((e) => e.id));
  await dev(page, (d) =>
    d.renderPlan({ version: 1, template: "flow", nodes: [{ id: "n", type: "shape", content: { shape: "rectangle", label: "Orders" } }], relationships: [] }, { operationId: "op_stale_shape_setup", title: "Setup", metadata: { createdBy: "import" } }),
  );
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  return shapeDev(page, (d, old) => d.api.getSceneElements().find((e) => !e.isDeleted && e.type === "rectangle" && !old.includes(e.id))!.id, before);
}

const labelOf = (page: Page, id: string) => shapeDev(page, (d, x) => d.api.getSceneElements().find((e) => !e.isDeleted && e.type === "text" && e.containerId === x)?.text ?? null, id);

/** The user retypes the shape's label on the canvas (its bound text, as Excalidraw's text editor writes it). */
const editLabel = (page: Page, id: string, text: string) =>
  shapeDev(page, (d, a) => {
    const els = d.api.getSceneElements();
    d.api.updateScene({
      elements: els.map((e) => (!e.isDeleted && e.type === "text" && e.containerId === a.id ? { ...e, text: a.text, originalText: a.text, version: e.version + 1, versionNonce: e.versionNonce + 1 } : e)),
      captureUpdate: "IMMEDIATELY",
    });
  }, { id, text });

test.describe("stale-target protection: update_shape", () => {
  test("a label edited after the relabel was proposed: Accept keeps it and asks; Use proposed writes the label as one undo step", async ({ page }) => {
    await openApp(page);
    const shape = await oneShape(page);
    await dev(page, (d, id) => d.proposeChanges({ operationId: "op_stale_shape", title: "Remote client: Relabel", metadata: { createdBy: "mcp" }, changes: [{ kind: "update_shape", target: id, label: "Order intake", stableNodeKey: "k:orders" }] }), shape);
    await expect(review(page)).toBeVisible();
    await editLabel(page, shape, "Orders (mine)");
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(page.getByText(CONFLICT).first()).toBeVisible({ timeout: 5_000 });
    expect(await labelOf(page, shape)).toBe("Orders (mine)");
    await review(page).getByRole("button", { name: "Use proposed" }).click();
    await review(page).getByRole("button", { name: /^Accept all/ }).click();
    await expect(review(page)).toBeHidden();
    expect(await labelOf(page, shape)).toBe("Order intake");
    await undo(page);
    expect(await labelOf(page, shape)).toBe("Orders (mine)");
  });
});
