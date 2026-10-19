/**
 * F20/F21 over the real bridge: turning on MCP access in the app lets an MCP
 * client (the SDK's own Streamable HTTP client, standing in for Claude Code)
 * connect to /api/mcp with the token shown, and read this workspace — served
 * by the open tab. Without the token, or with access off, it can't.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";
import { canvasHome, documentOf, elements, openApp, pasteText } from "../helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const ENDPOINT = "http://localhost:3000/api/mcp";

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

test("MCP access: a client connects with the shown token and reads the open workspace", async ({ page }) => {
  await openApp(page);
  const { workspaceId } = canvasHome(page);

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("button", { name: "Show" }).click();
  const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
  expect(token).toMatch(/^[0-9a-f]{64}$/);

  // Wrong token: refused.
  const bad = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer nope" }, body: "{}" });
  expect(bad.status).toBe(401);

  const client = await connect(token);
  const { resources } = await client.listResources();
  expect(resources.some((r) => r.uri === `acute://workspace/${workspaceId}`)).toBe(true);
  const read = await client.readResource({ uri: `acute://workspace/${workspaceId}` });
  const payload = JSON.parse((read.contents[0] as { text: string }).text) as { kind: string; id?: string };
  expect(payload.kind).toBe("workspace");

  // A write is only a proposal: it waits in the review bar, and a second one is refused meanwhile.
  await dialog.getByRole("button", { name: "Done" }).click();
  const tools = (await client.listTools()).tools.map((t) => t.name);
  expect(tools).toEqual(expect.arrayContaining(["search_workspace", "get_canvas", "create_todo", "render_visual_plan"]));
  const before = (await elements(page)).length;
  const proposed = await client.callTool({ name: "create_todo", arguments: { title: "From MCP", items: [{ text: "Review the proposal" }] } });
  expect(proposed.isError).toBeFalsy();
  expect(proposed.structuredContent).toMatchObject({ status: "proposed" });
  const review = page.getByRole("region", { name: "AI changes to review" });
  await expect(review).toBeVisible();
  expect((await elements(page)).length).toBe(before); // nothing applied yet
  const second = await client.callTool({ name: "create_todo", arguments: { items: [{ text: "Another" }] } });
  expect(second.isError).toBe(true);
  await expect(review).toContainText("e2e"); // the review names the client that proposed it
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect.poll(async () => (await elements(page)).length).toBeGreaterThan(before);

  // An MCP edit of the user's own block changes its content only: it stays the user's.
  const mine = await pasteText(page, "My own note", { x: 300, y: 650 });
  const docOf = () =>
    page.evaluate(
      (id) => (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string; customData?: { acute?: { documentId?: string } } }[] } } }).__acuteDev.api.getSceneElements().find((e) => e.id === id)?.customData?.acute?.documentId,
      mine,
    );
  const originalDoc = await docOf();
  const edit = await client.callTool({ name: "update_block", arguments: { objectId: mine, markdown: "My own note, tidied by MCP" } });
  expect(edit.isError).toBeFalsy();
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect.poll(docOf).not.toBe(originalDoc);
  const edited = await documentOf(page, (await docOf())!);
  expect(JSON.stringify(edited!.snapshot)).toContain("tidied by MCP");
  expect(edited!.metadata?.ai).toEqual({ createdBy: "user" }); // provenance kept, not "created by MCP"

  // Read only: clients can still read, but writes are refused with a pointer to the setting.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  await dialog.getByRole("radio", { name: "Read only" }).click();
  const refused = await client.callTool({ name: "create_todo", arguments: { items: [{ text: "Nope" }] } });
  expect(refused.isError).toBe(true);
  expect(JSON.stringify(refused.content)).toContain("read-only");
  expect((await client.callTool({ name: "get_canvas", arguments: {} })).isError).toBeFalsy();
  await client.close();

  // Access off: the tab stops serving, and clients are told how to fix it.
  await dialog.getByRole("radio", { name: "Off" }).click();
  await expect(dialog.getByRole("status")).toHaveCount(0);
  await expect.poll(async () => (await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: "{}" })).status).toBe(503);
});

test("an MCP edit of a Visualize block keeps its reconciliation link, so it counts as the user's edit", async ({ page }) => {
  await openApp(page);
  const before = new Set((await elements(page)).map((e) => e.id));
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Visualize content…" }).click();
  const visualize = page.getByRole("dialog", { name: "Visualize" });
  await visualize.getByRole("textbox").fill("# Launch plan\n\n- [ ] Ship the flag\n- [ ] Notify support\n");
  await visualize.getByRole("button", { name: "Visualize", exact: true }).click();
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: "Accept all" }).click();
  const recon = (id: string) =>
    page.evaluate((i) => (window as unknown as { __acuteDev: { reconciliation(i: string): Promise<{ link: { contentSourceId: string; contentFingerprint: string } | null; current: string | null } | null> } }).__acuteDev.reconciliation(i), id);
  let target: string | null = null;
  for (const e of (await elements(page)).filter((x) => !before.has(x.id) && x.acute?.kind === "rich-block")) {
    if ((await recon(e.id))?.link) target = e.id;
  }
  expect(target).not.toBeNull();
  const link = (await recon(target!))!.link!;

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("button", { name: "Show" }).click();
  const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
  await dialog.getByRole("button", { name: "Done" }).click();

  const client = await connect(token);
  expect((await client.callTool({ name: "update_block", arguments: { objectId: target!, markdown: "- [ ] Ship the flag on Monday" } })).isError).toBeFalsy();
  await review.getByRole("button", { name: "Accept all" }).click();
  await expect.poll(async () => (await recon(target!))?.current).not.toBe(link.contentFingerprint);
  const after = (await recon(target!))!;
  expect(after.link).toMatchObject({ contentSourceId: link.contentSourceId, contentFingerprint: link.contentFingerprint }); // same source, same baseline
  expect(after.current).not.toBe(after.link!.contentFingerprint); // so "Update from new content" treats it as edited by the user
  await client.close();
});
