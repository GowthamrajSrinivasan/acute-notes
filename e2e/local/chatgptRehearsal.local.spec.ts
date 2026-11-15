/**
 * Rehearsal of the real-ChatGPT MCP test (`.ai/docs/chatgpt-mcp-architecture-and-test-plan.md` §7.5), with the official
 * MCP SDK client standing in for ChatGPT over the **same route ChatGPT's "No authentication" mode uses**: the secret URL
 * (`/api/mcp/s/<token>`). No AI and no tunnel: everything is local. What it can't tell us — how ChatGPT itself connects,
 * authorizes, confirms writes and shows errors — stays for the manual run (S1–S9).
 *
 * The acceptance condition (user, 2026-11-13): the client reads the right Acute context and produces an intended,
 * reviewable result **without corrupting existing notes**. Scenarios: read a known source's notes, propose a grounded
 * study question, proposal survives a reload, the user accepts it; a failed write; a second write while one is under
 * review; a stale target (the user edits the block an update was proposed for: asserted since the P0 fix — Accept asks
 * Keep mine / Use proposed and never overwrites); the tab unavailable; reconnect; revoke.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp } from "../helpers";

const ORIGIN = "http://localhost:3000";
const SOURCE = readFileSync(new URL("../../evaluation/knowledge-notes/cases/kn-01-idempotency-keys/source.md", import.meta.url), "utf8").replace(/\r\n?/g, "\n");

const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
type Dev = { api: { getSceneElements(): { id: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[] }; store: { get(id: string): { snapshot?: unknown[] } | null; updateSnapshot(id: string, s: unknown[]): void } };
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T, arg?: A) => p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

/** Every live block's document text, by object id: what "existing notes" means for the no-corruption checks. */
const notes = (p: Page) =>
  dev(p, (d) => {
    const out: Record<string, string> = {};
    for (const el of d.api.getSceneElements()) {
      const doc = el.customData?.acute?.documentId;
      if (!el.isDeleted && doc) out[el.id] = JSON.stringify(d.store.get(doc)?.snapshot ?? null);
    }
    return out;
  });

/** MCP access on, and a secret URL (the dialog shows it once a public address is set; any https address will do locally). */
async function secretUrl(page: Page): Promise<string> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("textbox", { name: "Public address" }).fill("https://rehearsal.example");
  await dialog.getByRole("textbox", { name: "Public address" }).blur();
  const create = dialog.getByRole("button", { name: "Create secret URL" });
  if (await create.isVisible()) await create.click();
  const group = dialog.getByRole("group", { name: /secret URL/ });
  await group.getByRole("button", { name: "Show" }).click();
  const link = (await group.locator("code").textContent())!.trim();
  await dialog.getByRole("button", { name: "Done" }).click();
  const token = link.split("/api/mcp/s/")[1]!;
  expect(token, "secret URL token").toMatch(/\S{16,}/);
  return `${ORIGIN}/api/mcp/s/${token}`;
}

/** Connects, retrying while the tab's bridge isn't (re)registered yet; returns the client and how long that took. */
async function connectWhenReady(url: string, timeoutMs = 20_000) {
  const start = Date.now();
  for (;;) {
    try {
      const c = await connect(url);
      await c.client.listTools();
      return { ...c, waitedMs: Date.now() - start };
    } catch (e) {
      if (Date.now() - start > timeoutMs) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

async function connect(url: string) {
  const client = new Client({ name: "chatgpt-rehearsal", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = (r: CallToolResult) => (r.content as { text?: string }[]).map((c) => c.text ?? "").join("\n");
  return { client, call, text };
}

test("ChatGPT rehearsal over the secret URL: read, propose, review, failures, reconnect", async ({ page }) => {
  test.setTimeout(240_000);
  const findings: Record<string, unknown> = {};
  await openApp(page);

  // A known source on the canvas, by the local tier (no AI): kn-01, idempotency keys.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const visualize = page.getByRole("dialog", { name: "Visualize" });
  await visualize.getByRole("textbox").fill(SOURCE);
  await visualize.getByRole("button", { name: "Visualize", exact: true }).click();
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  const before = await notes(page);
  expect(Object.keys(before).length, "the source made blocks").toBeGreaterThan(0);

  const url = await secretUrl(page);
  let gpt = await connect(url);

  // 1. What a remote client is offered: reads and proposing writes; repo-map tools withheld.
  const tools = (await gpt.client.listTools()).tools.map((t) => t.name);
  findings.tools = tools.length;
  expect(tools).toEqual(expect.arrayContaining(["search_workspace", "get_canvas", "get_block", "create_block", "update_block"]));
  expect(tools.filter((t) => /repo_map|map_section|begin_repo_map/.test(t))).toEqual([]);

  // 2. Read the right context: find the source's note on key expiry and read it in full.
  const found = await gpt.call("search_workspace", { query: "24 hours" });
  expect(found.isError, gpt.text(found)).toBeFalsy();
  const hit = (found.structuredContent as { hits: { id: string; kind: string }[] }).hits.find((h) => h.kind === "text");
  expect(hit, "a block mentions the 24-hour window").toBeTruthy();
  const block = await gpt.call("get_block", { id: hit!.id });
  expect(gpt.text(block) + JSON.stringify(block.structuredContent)).toContain("24 hours");

  // 3. Propose a grounded study question: proposed, nothing written yet.
  const question = "**Study question:** A client retries a payment 25 hours after the first attempt, with the same idempotency key. What happens, and why?\n\n_Answer:_ it is treated as a new payment: stored results expire after 24 hours.";
  const proposed = await gpt.call("create_block", { title: "Study question", markdown: question });
  expect(proposed.isError, gpt.text(proposed)).toBeFalsy();
  expect(proposed.structuredContent).toMatchObject({ status: "proposed" });
  expect(await notes(page)).toEqual(before);

  // 4. A second write while one is under review is refused, not queued silently.
  const second = await gpt.call("create_block", { markdown: "Another note" });
  findings.secondWhilePending = second.isError ? gpt.text(second).slice(0, 160) : "accepted (not refused)";
  expect(second.isError).toBe(true);

  // 5. The proposal survives a reload; the user accepts it; existing notes are untouched.
  await page.reload();
  await expect(review(page)).toContainText(/Study question|Add text block/);
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  const afterAccept = await notes(page);
  const added = Object.keys(afterAccept).filter((id) => !(id in before));
  expect(added).toHaveLength(1);
  expect(afterAccept[added[0]!]).toContain("25 hours");
  for (const [id, content] of Object.entries(before)) expect(afterAccept[id], `note ${id} unchanged`).toBe(content);

  // The reload ended the tab's MCP sessions (they live in the tab). A spec-following client (ChatGPT) re-initializes
  // when the server answers its old session id with HTTP 404 (MCP Streamable HTTP, session management).
  const oldSession = (gpt.client.transport as StreamableHTTPClientTransport | undefined)?.sessionId;
  const stale = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(oldSession ? { "mcp-session-id": oldSession } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }),
  });
  findings.staleSession = { status: stale.status, body: (await stale.text()).slice(0, 160) };
  test.info().annotations.push({ type: "stale-session", description: JSON.stringify(findings.staleSession) });
  await gpt.client.close().catch(() => undefined);
  const re = await connectWhenReady(url);
  findings.reconnectAfterReloadMs = re.waitedMs;
  gpt = re;

  // 6. A failed write: an id that doesn't exist. A clear error, nothing proposed, nothing changed.
  const bad = await gpt.call("update_block", { objectId: "obj_does_not_exist", markdown: "x" });
  expect(bad.isError).toBe(true);
  findings.failedWrite = gpt.text(bad).slice(0, 160);
  await expect(review(page)).toBeHidden();
  expect(await notes(page)).toEqual(afterAccept);

  // 7. A stale target: an update is proposed, then the user edits that block before reviewing it.
  const target = hit!.id;
  const upd = await gpt.call("update_block", { objectId: target, markdown: "Rewritten by the remote client." });
  expect(upd.isError, gpt.text(upd)).toBeFalsy();
  await dev(page, (d, id) => {
    const el = d.api.getSceneElements().find((e) => e.id === id)!;
    const doc = el.customData!.acute!.documentId!;
    const snap = d.store.get(doc)!.snapshot!;
    d.store.updateSnapshot(doc, [...snap, { type: "paragraph", content: [{ type: "text", text: "USER EDIT WHILE PENDING", styles: {} }], children: [] }]);
  }, target);
  await expect(review(page)).toBeVisible();
  const reviewText = (await review(page).textContent()) ?? "";
  await review(page).getByRole("button", { name: /^Accept all/ }).click().catch(() => undefined);
  const afterStale = (await notes(page))[target] ?? "";
  findings.staleTarget = {
    reviewSaid: reviewText.replace(/\s+/g, " ").slice(0, 200),
    userEditKept: afterStale.includes("USER EDIT WHILE PENDING"),
    remoteTextApplied: afterStale.includes("Rewritten by the remote client."),
  };
  test.info().annotations.push({ type: "stale-target", description: JSON.stringify(findings.staleTarget) });
  // Stale-target protection (P0 fix, 2026-11-15): Accept never overwrites the user's edit — it asks Keep mine / Use proposed.
  expect(findings.staleTarget, "the user's edit survives Accept").toMatchObject({ userEditKept: true, remoteTextApplied: false });
  const decision = review(page).getByRole("listitem", { name: /^Conflict: / });
  await expect(decision).toContainText(/Edited since this update was proposed/);
  await decision.getByRole("button", { name: "Keep mine" }).click();
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  expect((await notes(page))[target], "Keep mine wrote nothing").toBe(afterStale);

  // 8. The tab unavailable: the client gets the intelligible "not connected" message.
  const context = page.context();
  await page.close();
  const offline = await gpt.call("get_canvas").catch((e: unknown) => ({ isError: true, content: [{ type: "text", text: String(e) }] }) as CallToolResult);
  findings.tabClosed = gpt.text(offline).slice(0, 200);
  expect(offline.isError).toBe(true);
  expect(gpt.text(offline)).toMatch(/isn't connected|not connected|503/i);

  // 9. Reconnect: a new tab on the same workspace; the same secret URL works again with a new session.
  // A new tab on the same device (same browser context and storage: the owner secret is per device).
  const page2 = await context.newPage();
  await openApp(page2);
  const tryAgain = () => connectWhenReady(url, 10_000).then((c) => ({ ok: true as const, c }), (e: unknown) => ({ ok: false as const, e: String(e).slice(0, 160) }));
  let attempt = await tryAgain();
  findings.newTabWithoutDialog = attempt.ok ? `ok after ${attempt.c.waitedMs} ms` : attempt.e;
  if (!attempt.ok) {
    // Does opening the MCP access dialog in the new tab bring the bridge up?
    await page2.getByRole("button", { name: "More", exact: true }).click();
    await page2.getByRole("menuitem", { name: "MCP access" }).click();
    const d = page2.getByRole("dialog", { name: "MCP access" });
    findings.newTabDialog = ((await d.getByRole("status").textContent({ timeout: 3_000 }).catch(() => null)) ?? "no status").trim();
    findings.newTabAccessOn = await d.getByRole("radio", { name: "On" }).isChecked({ timeout: 3_000 }).catch(() => null);
    await d.getByRole("button", { name: "Done" }).click();
    attempt = await tryAgain();
    findings.newTabAfterDialog = attempt.ok ? `ok after ${attempt.c.waitedMs} ms` : attempt.e;
  }
  test.info().annotations.push({ type: "new-tab", description: JSON.stringify({ a: findings.newTabWithoutDialog, dialog: findings.newTabDialog, on: findings.newTabAccessOn, b: findings.newTabAfterDialog }) });
  expect(attempt.ok, "a new tab serves the same secret URL").toBe(true);
  const again = (attempt as { ok: true; c: Awaited<ReturnType<typeof connectWhenReady>> }).c;
  const canvas = await again.call("get_canvas").catch((e: unknown) => ({ isError: true, content: [{ type: "text", text: String(e) }] }) as CallToolResult);
  findings.reconnect = canvas.isError ? `failed: ${again.text(canvas).slice(0, 160)}` : "ok";

  // 10. Revoke: the URL stops working.
  await page2.getByRole("button", { name: "More", exact: true }).click();
  await page2.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page2.getByRole("dialog", { name: "MCP access" });
  const revoke = dialog.getByRole("button", { name: "Revoke" });
  if (await revoke.isVisible()) {
    await revoke.click();
    const status = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }).then((r) => r.status);
    findings.afterRevoke = status;
    expect(status).toBe(401);
  } else findings.afterRevoke = "no Revoke button after reconnect";

  test.info().annotations.push({ type: "findings", description: JSON.stringify(findings) });
  await gpt.client.close().catch(() => undefined);
  await again.client.close().catch(() => undefined);
  void elements;
});
