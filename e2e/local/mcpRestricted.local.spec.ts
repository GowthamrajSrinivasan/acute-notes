/**
 * The `restricted` remote MCP profile (2026-11-15, `.ai/docs/mcp-remote-profile-2026-11-15.md`) over the secret URL —
 * the route ChatGPT's "No authentication" mode uses — with the official MCP SDK client standing in for ChatGPT. No AI,
 * no tunnel: loopback only.
 *
 * - `tools/list` is exactly the restricted allowlist.
 * - `delete_object`, `revert_agent_changes` and `delete_connection` fail when called directly by name, and nothing is
 *   proposed or changed.
 * - An allowed `update_block` still proposes through the review, and Accept applies it.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { openApp } from "../helpers";

const ORIGIN = "http://localhost:3000";
const SOURCE = readFileSync(new URL("../../evaluation/knowledge-notes/cases/kn-01-idempotency-keys/source.md", import.meta.url), "utf8").replace(/\r\n?/g, "\n");

/** The exact restricted inventory (sorted); kept in step with `src/mcp/tools/remoteProfile.ts` and its unit snapshot. */
const RESTRICTED = [
  "annotate",
  "create_block",
  "create_connection",
  "create_page",
  "create_project",
  "create_table",
  "create_todo",
  "focus_lens",
  "get_block",
  "get_canvas",
  "get_consistency",
  "get_decisions",
  "get_implementation_plan",
  "get_lens",
  "get_lens_impact",
  "get_open_questions",
  "get_page",
  "get_project",
  "get_recent_changes",
  "get_related_objects",
  "get_selected_content",
  "get_session_context",
  "get_session_history",
  "get_session_review",
  "group_blocks",
  "list_blocks",
  "list_projects",
  "log_finding",
  "move_object",
  "render_visual_plan",
  "search_workspace",
  "suggest_placement",
  "trace_lens_path",
  "update_block",
];

const review = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
type Dev = { api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string } } }[] }; store: { get(id: string): { snapshot?: unknown[] } | null } };
const dev = <T, A = undefined>(p: Page, fn: (d: Dev, a: A) => T, arg?: A) => p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

/** Every live object (id → type), and every live block's document text: what "nothing changed" means here. */
const snapshot = (p: Page) =>
  dev(p, (d) => {
    const objects: Record<string, string> = {};
    const notes: Record<string, string> = {};
    for (const el of d.api.getSceneElements()) {
      if (el.isDeleted) continue;
      objects[el.id] = el.type;
      const doc = el.customData?.acute?.documentId;
      if (doc) notes[el.id] = JSON.stringify(d.store.get(doc)?.snapshot ?? null);
    }
    return { objects, notes };
  });

async function secretUrl(page: Page): Promise<string> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("textbox", { name: "Public address" }).fill("https://restricted.example");
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

/** A call that must fail: a JSON-RPC error (the relay's refusal) or an `isError` result (the tab's "not found"). */
async function refused(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  try {
    const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
    expect(res.isError, `${name} must fail`).toBe(true);
    return (res.content as { text?: string }[]).map((c) => c.text ?? "").join(" ");
  } catch (e) {
    return String(e);
  }
}

test("restricted remote profile over the secret URL: exact tool list, destructive tools refused, update_block still reviewed", async ({ page }) => {
  test.setTimeout(180_000);
  const findings: Record<string, unknown> = {};
  await openApp(page);

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const visualize = page.getByRole("dialog", { name: "Visualize" });
  await visualize.getByRole("textbox").fill(SOURCE);
  await visualize.getByRole("button", { name: "Visualize", exact: true }).click();
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  const before = await snapshot(page);
  const blockId = Object.keys(before.notes)[0]!;
  expect(blockId, "the source made blocks").toBeTruthy();
  const arrowId = Object.entries(before.objects).find(([, t]) => t === "arrow")?.[0] ?? "arrow_missing";

  const client = new Client({ name: "chatgpt-restricted", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(await secretUrl(page))));

  // 1. Discovery: exactly the allowlist.
  const listed = (await client.listTools()).tools;
  expect(listed.map((t) => t.name).sort()).toEqual(RESTRICTED);
  expect(listed.filter((t) => t.annotations?.destructiveHint).map((t) => t.name)).toEqual(["update_block"]);

  // 2. Invocation by name: refused, nothing proposed, nothing changed.
  findings.refusals = {
    delete_object: await refused(client, "delete_object", { ids: [blockId] }),
    revert_agent_changes: await refused(client, "revert_agent_changes", { session: "any", reason: "undo" }),
    delete_connection: await refused(client, "delete_connection", { connectionIds: [arrowId] }),
    // Read-only, but local-only until verified through the remote path (user condition, 2026-11-15).
    get_weak_concepts: await refused(client, "get_weak_concepts", {}),
    // Excluded write tools (no baseline / no review), and a name no profile lists.
    sync_session: await refused(client, "sync_session", { summary: "x" }),
    update_knowledge: await refused(client, "update_knowledge", { nodeId: blockId }),
    no_such_tool: await refused(client, "no_such_tool", {}),
  };
  // The server-side relay must refuse (not only the tab): proves enforcement is active on the running server.
  for (const [name, message] of Object.entries(findings.refusals as Record<string, string>)) expect(message, name).toMatch(new RegExp(`Tool ${name} is not available to remote MCP sessions`));
  await expect(review(page)).toBeHidden();
  expect(await snapshot(page)).toEqual(before);

  // 3. An allowed update_block still goes through the review; Accept applies it.
  const upd = (await client.callTool({ name: "update_block", arguments: { objectId: blockId, markdown: "Rewritten under the restricted profile." } })) as CallToolResult;
  expect(upd.isError, JSON.stringify(upd.content)).toBeFalsy();
  expect(upd.structuredContent).toMatchObject({ status: "proposed" });
  expect((await snapshot(page)).notes[blockId], "nothing written before Accept").toBe(before.notes[blockId]);
  await expect(review(page)).toBeVisible();
  await review(page).getByRole("button", { name: /^Accept all/ }).click();
  await expect(review(page)).toBeHidden();
  const after = await snapshot(page);
  expect(after.notes[blockId]).toContain("Rewritten under the restricted profile.");
  for (const [id, content] of Object.entries(before.notes)) if (id !== blockId) expect(after.notes[id], `note ${id} unchanged`).toBe(content);

  test.info().annotations.push({ type: "findings", description: JSON.stringify(findings) });
  await client.close().catch(() => undefined);

  // Leave nothing usable behind: revoke the secret URL.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  const revoke = dialog.getByRole("button", { name: "Revoke" });
  if (await revoke.isVisible()) await revoke.click();
});
