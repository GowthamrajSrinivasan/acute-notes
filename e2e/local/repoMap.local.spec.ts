/**
 * F43 Repo Map over MCP, against the running app: the SDK's own Streamable
 * HTTP client (standing in for Claude Code / Copilot) drives the repo-map
 * tools through the real relay and the open tab.
 *
 * 1. begin → two sections (the first with a link to a key of the second, pending until it arrives) → per-section
 *    Accept in the review bar → frames on the canvas; a changed re-send updates a card in place; get_map_status
 *    reports staleness from changedPaths and the stale marker shows; remove_map_nodes proposes a removal.
 * 2. The transport checks of the tracker's real-client item that can be automated: 405 on GET, DELETE ends the
 *    session, re-initialize after another tab takes over and after this tab takes back over, 401 (-32001) for a wrong token, and 503 (-32001)
 *    when no tab serves MCP.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, test, type Page } from "@playwright/test";
import { canvasHome, documentOf, elements, openApp, waitForCanvas } from "../helpers";

const ENDPOINT = "http://localhost:3000/api/mcp";

async function turnOnMcp(page: Page): Promise<string> {
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("button", { name: "Show" }).click();
  const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
  await dialog.getByRole("button", { name: "Done" }).click();
  return token;
}

async function connect(token: string, name = "e2e-agent"): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(ENDPOINT), { requestInit: { headers: { authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  return { client, transport };
}

// Tool payloads are asserted field by field; typing each one would only restate the tools.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function tool<T = Record<string, any>>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
  expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
  return res.structuredContent as T;
}

const COMMIT = "e2e0001";
const section = (mod: string, cards: { name: string; text: string }[], rels: unknown[] = []) => ({
  commit: COMMIT,
  section: { key: `mod:${mod}`, label: `Module ${mod}`, arrangement: "grid" },
  nodes: cards.map((c, i) => ({ key: `file:${mod}/${c.name}`, type: "text", title: c.name, markdown: c.text, source: { path: `${mod}/${c.name}`, lines: [1, 10 + i] } })),
  relationships: rels,
});

const reviewBar = (p: Page) => p.getByRole("region", { name: "AI changes to review" });
const frames = async (p: Page) => (await elements(p)).filter((e) => e.type === "frame");

/** The card showing a map key (its document's reconciliation key), via the dev hook. */
function cardOf(page: Page, key: string) {
  return page.evaluate(async (k) => {
    const dev = (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string; isDeleted?: boolean }[] }; reconciliation(id: string): Promise<{ link: { stableNodeKey: string } | null } | null> } }).__acuteDev;
    for (const el of dev.api.getSceneElements()) {
      const r = await dev.reconciliation(el.id);
      if (r?.link?.stableNodeKey === k) return el.id;
    }
    return null;
  }, key);
}

test("a repo map over MCP: staged sections, per-section accept, in-place update, staleness, removal", async ({ page }) => {
  await openApp(page);
  const token = await turnOnMcp(page);
  const { client } = await connect(token);
  const repo = `org/e2e-${Date.now()}`;

  const tools = (await client.listTools()).tools.map((t) => t.name);
  expect(tools).toEqual(expect.arrayContaining(["begin_repo_map", "upsert_map_section", "link_map_nodes", "get_map_status", "remove_map_nodes"]));
  expect((await client.listPrompts()).prompts.map((p) => p.name)).toContain("map_repo");

  // begin: the map canvas is created and opened in the tab (without a reload: the same client keeps working).
  const begun = await tool(client, "begin_repo_map", { repo, commit: COMMIT });
  expect(begun).toMatchObject({ created: true, open: true });
  await expect.poll(() => canvasHome(page).canvasId).toBe(begun.canvasId);
  await waitForCanvas(page);
  const mapId = begun.mapId as string;

  // Section A links to a key of B, which isn't sent yet: pending.
  const a = await tool(client, "upsert_map_section", {
    mapId,
    ...section("a", [{ name: "runtime.ts", text: "Single entry point for all AI tasks." }, { name: "tasks.ts", text: "Tasks declare schema and prompt." }], [
      { from: "file:a/runtime.ts", to: "file:a/tasks.ts", type: "depends_on" },
      { from: "file:a/runtime.ts", to: "file:b/api.ts", type: "references" },
    ]),
  });
  expect(a.status).toBe("staged");
  expect(a.pendingEdges).toEqual([{ from: "file:a/runtime.ts", to: "file:b/api.ts", type: "references" }]);
  await expect(reviewBar(page)).toContainText("1 section");

  // B arrives: the pending edge resolves, and the review grows (one pending set).
  const b = await tool(client, "upsert_map_section", { mapId, ...section("b", [{ name: "api.ts", text: "HTTP routes." }, { name: "auth.ts", text: "Checks the session." }]) });
  expect(b.pendingEdges).toEqual([]);
  await expect(reviewBar(page)).toContainText("2 sections");
  expect(await frames(page)).toHaveLength(0); // staged only

  // Per-section Accept: B first, then A; the cross link is drawn once both exist.
  await reviewBar(page).getByRole("button", { name: "Review" }).click();
  await reviewBar(page).getByRole("listitem", { name: "Section: Module b" }).getByRole("button", { name: "Accept section" }).click();
  await expect.poll(async () => (await frames(page)).length).toBe(1);
  await expect(reviewBar(page)).toContainText("1 section");
  await reviewBar(page).getByRole("listitem", { name: "Section: Module a" }).getByRole("button", { name: "Accept section" }).click();
  await expect(reviewBar(page)).toBeHidden();
  const fs = await frames(page);
  expect(fs).toHaveLength(2);
  const [f1, f2] = fs;
  expect(f1!.x + f1!.width <= f2!.x || f2!.x + f2!.width <= f1!.x || f1!.y + f1!.height <= f2!.y || f2!.y + f2!.height <= f1!.y).toBe(true);
  const runtime = await cardOf(page, "file:a/runtime.ts");
  const api = await cardOf(page, "file:b/api.ts");
  expect(runtime && api).toBeTruthy();
  const arrows = (await elements(page)).filter((e) => e.type === "arrow");
  expect(arrows.length).toBe(2);
  expect(arrows.some((e) => e.relation === "references")).toBe(true);

  // Provenance: the repo path at the commit.
  const runtimeDoc = (await elements(page)).find((e) => e.id === runtime)!.acute!.documentId!;
  expect((await documentOf(page, runtimeDoc))?.metadata?.ai).toMatchObject({ createdBy: "mcp", provider: "e2e-agent", sourceRefs: [{ provider: "repo", externalId: `a/runtime.ts#L1-10@${COMMIT}` }] });

  // An identical re-send: unchanged, nothing to review.
  const same = await tool(client, "upsert_map_section", { mapId, ...section("b", [{ name: "api.ts", text: "HTTP routes." }, { name: "auth.ts", text: "Checks the session." }]) });
  expect(same.status).toBe("unchanged");
  await expect(reviewBar(page)).toBeHidden();

  // A changed card: one update, in place (same object).
  const changed = await tool(client, "upsert_map_section", { mapId, ...section("b", [{ name: "api.ts", text: "HTTP routes, now versioned." }, { name: "auth.ts", text: "Checks the session." }]) });
  expect(changed.outcomes.find((o: { key: string }) => o.key === "file:b/api.ts")).toMatchObject({ outcome: "updated" });
  await expect(reviewBar(page)).toContainText("~1 updated");
  await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
  await expect(reviewBar(page)).toBeHidden();
  expect(await cardOf(page, "file:b/api.ts")).toBe(api);
  const apiDoc = (await elements(page)).find((e) => e.id === api)!.acute!.documentId!;
  await expect.poll(async () => JSON.stringify((await documentOf(page, apiDoc))?.snapshot)).toContain("now versioned");

  // Staleness from the agent's own git diff, with the quiet marker on the card.
  const status = await tool(client, "get_map_status", { mapId, changedPaths: ["a/tasks.ts"] });
  expect(status.stale).toEqual(["file:a/tasks.ts"]);
  const tasks = await cardOf(page, "file:a/tasks.ts");
  await expect(page.locator(`.acute-stale-marker[data-element-id="${tasks}"]`)).toBeVisible();
  await expect(page.locator(".acute-stale-marker")).toHaveCount(1);

  // Removal: proposed for review, never applied by itself.
  const removal = await tool(client, "remove_map_nodes", { mapId, keys: ["file:b/auth.ts"] });
  expect(removal.status).toBe("staged");
  await expect(reviewBar(page)).toContainText("−1 removed");
  expect(await cardOf(page, "file:b/auth.ts")).not.toBeNull();
  await reviewBar(page).getByRole("button", { name: "Reject" }).click();
  await expect(reviewBar(page)).toBeHidden();
  expect(await cardOf(page, "file:b/auth.ts")).not.toBeNull();

  await client.close();
});

test("transport: 405 on GET, DELETE ends a session, re-initialize after takeover, 401 for a wrong token or no tab", async ({ page, context }) => {
  await openApp(page);
  const token = await turnOnMcp(page);
  const auth = { authorization: `Bearer ${token}` };

  // No server → client stream: a plain 405, which the SDK client accepts without retrying.
  const get = await fetch(ENDPOINT, { headers: { ...auth, accept: "text/event-stream" } });
  expect(get.status).toBe(405);
  expect(get.headers.get("allow")).toBe("POST, DELETE");

  // Wrong token.
  const bad = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  expect(bad.status).toBe(401);
  expect(((await bad.json()) as { error: { code: number } }).error.code).toBe(-32001);

  // A session, then DELETE: it ends, and a request on it is refused until the client initializes again.
  const first = await connect(token);
  expect((await first.client.listTools()).tools.length).toBeGreaterThan(5);
  const sessionId = first.transport.sessionId!;
  expect(sessionId).toBeTruthy();
  await first.transport.terminateSession();
  const stale = await fetch(ENDPOINT, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": sessionId },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });
  expect(stale.status).toBe(404);
  await first.client.close();

  // Another tab takes over: sessions of the first end; a client re-initializes and is served by the new tab.
  const second = await connect(token);
  const other = await context.newPage();
  await openApp(other);
  await expect.poll(async () => (await second.client.listTools().then(() => "ok", () => "dropped"))).toBe("dropped");
  const again = await connect(token);
  expect((await again.client.listTools()).tools.length).toBeGreaterThan(5);
  await again.client.close();

  // That tab goes away and this one is focused again: it takes back over; clients re-initialize.
  await other.close();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(async () => connect(token).then(async (c) => (await c.client.close(), "ok"), () => "down"), { timeout: 20_000 }).toBe("ok");

  // No tab serving MCP at all: 503 (not a 401 that reads like a wrong token), with the same code and a pointer to the app.
  await page.close();
  await expect
    .poll(async () => (await fetch(ENDPOINT, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: {} }) })).status, { timeout: 20_000 })
    .toBe(503);
  const none = await fetch(ENDPOINT, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" }) });
  const body = (await none.json()) as { error: { code: number; message: string } };
  expect(body.error.code).toBe(-32001);
  expect(body.error.message).toContain("MCP access");
});
