/**
 * Acute Lens Phase 2 in the browser: a repo map sent over the real MCP bridge becomes Lens levels. The overview
 * section (level 1) and a child section (level 4, parent = an overview card) are accepted; the overview opens in Lens
 * from its frame chip, its cards are nodes named by the agent's kinds, the parent card zooms into its section, a
 * function card zooms into its source (L5) with the map's code card shown and "Open in VS Code" built from the
 * repoRoot the agent gave. No AI: the SDK's own client stands in for an IDE agent.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, test } from "@playwright/test";
import { canvasHome, openApp, waitForCanvas } from "../helpers";

const ENDPOINT = "http://localhost:3000/api/mcp";

test("a repo map's sections are Lens levels, down to the source and its code", async ({ page }) => {
  await openApp(page);
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "MCP access" }).click();
  const dialog = page.getByRole("dialog", { name: "MCP access" });
  await dialog.getByRole("radio", { name: "On" }).click();
  await expect(dialog.getByRole("status")).toContainText("Ready");
  await dialog.getByRole("button", { name: "Show" }).click();
  const token = (await dialog.getByLabel("Token", { exact: true }).textContent())!.trim();
  await dialog.getByRole("button", { name: "Done" }).click();

  const client = new Client({ name: "e2e-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    return res.structuredContent as Record<string, unknown>;
  };

  const begun = await tool("begin_repo_map", { repo: `acme/shop-${Date.now()}`, commit: "c1", repoRoot: "C:/src/shop" });
  await expect.poll(() => canvasHome(page).canvasId).toBe(begun.canvasId);
  await waitForCanvas(page);
  const mapId = begun.mapId as string;

  await tool("upsert_map_section", {
    mapId,
    commit: "c1",
    section: { key: "mod:overview", label: "Overview", arrangement: "grid", level: 1 },
    nodes: [
      { key: "mod:payments", type: "shape", shape: "rectangle", label: "Payments", kind: "backend", source: { path: "src/payments/index.ts" } },
      { key: "mod:orders", type: "shape", shape: "rectangle", label: "Orders", kind: "backend" },
    ],
    relationships: [{ from: "mod:orders", to: "mod:payments", type: "calls" }],
  });
  await tool("upsert_map_section", {
    mapId,
    commit: "c1",
    section: { key: "mod:payments:ops", label: "Payment operations", arrangement: "grid", parent: "mod:payments", level: 4 },
    nodes: [
      { key: "sym:charge", type: "shape", shape: "rectangle", label: "charge()", kind: "function", source: { path: "src/payments/charge.ts", lines: [10, 24] } },
      { key: "code:charge", type: "code", title: "charge", code: "export function charge(card) {\n  return gateway.capture(card);\n}", language: "ts", source: { path: "src/payments/charge.ts", lines: [10, 24] } },
    ],
    relationships: [],
  });
  const review = page.getByRole("region", { name: "AI changes to review" });
  await expect(review).toContainText("2 sections");
  await review.getByRole("button", { name: /^Accept all/ }).click();
  await expect(review).toBeHidden();

  // The overview's frame chip says its level and opens Lens there (● and Δ: an agent wrote it, not yet seen in Lens).
  const chip = page.getByRole("button", { name: "Open Overview in Lens" });
  await expect(chip).toHaveText("✨ L1 ● Δ");
  // The chip sits above the frame's top edge, under the app header while the frame is at the top of the view.
  await chip.dispatchEvent("click");
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(lens).toContainText("L1 Architecture");
  const payments = lens.locator('g.acute-lens-node[aria-label="Payments"]');
  await expect(payments).toBeVisible();
  await expect(payments).toContainText("Backend");
  await expect(lens).toContainText("calls");

  // The parent card drills into its section (L4), and the function card into its source (L5) with the map's code.
  await payments.click();
  await lens.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens.locator(".acute-lens-panel__crumb-current")).toHaveText("Payment operations");
  await expect(lens).toContainText("L4 Operation");
  await lens.locator('g.acute-lens-node[aria-label="charge()"]').click();
  await lens.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(lens.locator(".acute-lens-panel__level")).toHaveText("L5 Source");
  const card = lens.getByRole("article", { name: "Source of charge()" });
  await expect(card).toContainText("src/payments/charge.ts");
  await expect(card).toContainText("from your IDE agent");
  await expect(card.getByRole("region", { name: "Code" })).toContainText("gateway.capture(card)");
  await expect(card.getByRole("link", { name: "Open in VS Code" }).first()).toHaveAttribute("href", "vscode://file/C:/src/shop/src/payments/charge.ts:10");

  await client.close();
});
