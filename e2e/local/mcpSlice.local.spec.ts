/**
 * The MCP-first vertical slice in the browser (plan §10.2, Phase 7B): two MCP clients over the real bridge, the
 * user's Accept in the review bar, the Project profile in Lens, and the Agent log. A coding agent bootstraps,
 * records a constraint on an architecture node, syncs its session; a second agent sees the warning and where the
 * first left off; the first's sync is reverted. No AI: the SDK's own client stands in for Claude Code and Codex.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, test, type Page } from "@playwright/test";
import { elements, openApp, select } from "../helpers";

const ENDPOINT = "http://localhost:3000/api/mcp";

async function enableMcp(page: Page): Promise<string> {
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

async function agent(token: string, name: string) {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const ok = async <T = Record<string, unknown>>(tool: string, args: Record<string, unknown> = {}): Promise<T> => {
    const res = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
    expect(res.isError, `${tool}: ${(res.content as { text: string }[])[0]?.text}`).toBeFalsy();
    return res.structuredContent as T;
  };
  return { client, ok };
}

/** Every live label's own text (`originalText`: a long label is wrapped into its box in `text`). */
function liveLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as unknown as { __acuteDev: { api: { getSceneElements(): { type: string; originalText?: string; text?: string }[] } } }).__acuteDev.api
      .getSceneElements()
      .filter((e) => e.type === "text")
      .map((e) => e.originalText ?? e.text ?? ""),
  );
}

async function acceptReview(page: Page, title: RegExp | string) {
  const review = page.getByRole("region", { name: "AI changes to review" });
  await expect(review).toContainText(title);
  await review.getByRole("button", { name: /^Accept all/ }).click();
  await expect(review).toBeHidden();
}

test("an agent records a constraint and syncs; a second agent sees the warning and the next step; the sync is reverted", async ({ page }) => {
  test.setTimeout(240_000);
  await openApp(page);
  // An architecture frame with a Webhook node, as a user would draw it.
  await page.evaluate(() =>
    (window as unknown as { __acuteDev: { renderPlan(p: unknown, m: unknown): Promise<unknown> } }).__acuteDev.renderPlan(
      { version: 1, template: "architecture", metadata: { title: "Payments" }, nodes: [{ id: "w", type: "shape", content: { shape: "rectangle", label: "Webhook", kind: "backend" } }], relationships: [] },
      { operationId: "op_arch", title: "Architecture", metadata: { createdBy: "import" } },
    ),
  );
  await page.getByRole("region", { name: "AI changes to review" }).getByRole("button", { name: "Accept all" }).click();
  const webhookId = (await elements(page)).find((e) => e.text === "Webhook")!.containerId!;

  const token = await enableMcp(page);
  const claude = await agent(token, "Claude Code");

  // Bootstrap with no project: it says so (never invents one). The user asks for a project.
  expect(await claude.ok<{ project: { missing: string } }>("get_session_context", { task: "Set up the project" })).toMatchObject({ project: { missing: expect.stringMatching(/no project yet/) } });
  const created = await claude.ok<{ keys: string[] }>("create_project", { name: "Acme API", style: "service", reason: "The user asked for a project" });
  await acceptReview(page, "Claude Code: Create project");
  expect(await claude.ok("get_project")).toMatchObject({ project: { key: created.keys[0], label: "Acme API", style: "service" } });

  // A constraint on the Webhook (by its id: it has no key yet), accepted by the user.
  const recorded = await claude.ok<{ keys: string[] }>("record_decision", { statement: "Never retry card_declined", kind: "constraint", reason: "Fraud rules", refs: [webhookId] });
  await acceptReview(page, "Claude Code: Record decision");

  // MC7: the Project profile in Lens shows it in the Decisions lane.
  const stateFrame = (await elements(page)).find((e) => e.type === "frame" && e.text?.includes("Project state"));
  const frameId = stateFrame?.id ?? (await page.evaluate(() => (window as unknown as { __acuteDev: { api: { getSceneElements(): { id: string; type: string; name?: string }[] } } }).__acuteDev.api.getSceneElements().find((e) => e.type === "frame" && e.name?.includes("Project state"))!.id));
  await select(page, frameId);
  await page.getByRole("button", { name: "✨ Open in Lens" }).click();
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(lens.getByRole("group", { name: "Decisions lane" })).toContainText("Decisions · 1");
  await expect(lens).toContainText("Never retry card_declined");
  await page.getByRole("button", { name: "Close Lens" }).click();

  // MC6: one sync_session; the user accepts the proposal; summary and next are stored on the session.
  const synced = await claude.ok<{ status: string; stored: boolean }>("sync_session", {
    summary: "Webhook hardening started",
    findings: [{ kind: "open_question", statement: "Who owns refunds?", refs: [webhookId] }],
    next: ["Add idempotency keys to the webhook"],
  });
  expect(synced).toMatchObject({ status: "proposed", stored: true });
  await acceptReview(page, "Claude Code: Sync");

  // MC10: a second, independent agent sees the warning on the Webhook and where the first one left off.
  const codex = await agent(token, "Codex");
  const ctx = await codex.ok<{ warnings: { items: { key: string; statement: string }[] }; project: { lastNext?: string[] }; openQuestions: { items: { label: string }[] } }>("get_session_context", { keys: [webhookId] });
  expect(ctx.warnings.items).toEqual([expect.objectContaining({ key: recorded.keys[0], statement: "Never retry card_declined" })]);
  expect(ctx.project.lastNext).toEqual(["Add idempotency keys to the webhook"]);
  expect(ctx.openQuestions.items.map((q) => q.label)).toContain("Who owns refunds?");

  // MC8/MC9: the history lists the sync; reverting it removes the question once the user accepts.
  const recent = await codex.ok<{ changes: { id: string; title: string; agent?: string }[] }>("get_recent_changes");
  const sync = recent.changes.find((c) => c.title.startsWith("Claude Code: Sync"))!;
  expect(sync.agent).toBe("Claude Code");
  const reverted = await codex.ok<{ changes: Record<string, number> }>("revert_agent_changes", { changeIds: [sync.id], reason: "The user wants it discussed first" });
  // Exactly what the sync added: the question and its label.
  expect(reverted.changes).toEqual({ remove: 2 });
  await acceptReview(page, "Codex: Revert");
  await expect.poll(() => liveLabels(page)).not.toContain("Who owns refunds?");
  expect(await liveLabels(page)).toContain("Never retry card_declined"); // the earlier constraint is untouched

  // The Agent log shows both agents' sessions, the reported names marked as such.
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Agent log" }).click();
  const log = page.getByRole("tabpanel", { name: "Agent log" });
  await expect(log.getByRole("region", { name: /^Session · Claude Code \(as reported by the client\)/ })).toBeVisible();
  await expect(log.getByRole("region", { name: /^Session · Codex/ })).toBeVisible();
  await log.getByRole("region", { name: /^Session · Claude Code/ }).getByRole("button", { name: "Session review" }).click();
  await expect(log.getByRole("region", { name: "Session review" })).toContainText("Webhook hardening started");

  await claude.client.close();
  await codex.client.close();
});
