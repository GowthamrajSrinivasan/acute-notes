/**
 * Acute Lens Phase 4, Agent Sync (plan §8), over the real MCP bridge: an agent's changed section shows in Lens as
 * proposed state (ghosts) beside the current graph, Accept from Lens's Changes drawer re-renders it — a rename by the
 * same key updated in place — and the canvas chip's Δ clears once seen; Pause holds the view still and counts what
 * arrives; `get_map_status` marks the stale card and rings its ancestor. No AI: the SDK's own client is the agent.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { expect, test, type Page } from "@playwright/test";
import { canvasHome, openApp, waitForCanvas } from "../helpers";

const ENDPOINT = "http://localhost:3000/api/mcp";

async function connectAgent(page: Page) {
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
  return { client, tool };
}

const overview = (payments: string, extra: Record<string, unknown>[] = []) => ({
  commit: "c1",
  section: { key: "mod:overview", label: "Overview", arrangement: "grid", level: 1 },
  nodes: [
    { key: "mod:payments", type: "shape", shape: "rectangle", label: payments, kind: "backend", source: { path: "src/payments/index.ts" } },
    { key: "mod:orders", type: "shape", shape: "rectangle", label: "Orders", kind: "backend" },
    ...extra,
  ],
  relationships: [{ from: "mod:orders", to: "mod:payments", type: "calls" }],
});

test("Agent Sync: ghosts in Lens, Accept from the drawer, Δ cleared once seen, Pause holds updates, stale and affected marks", async ({ page }) => {
  await openApp(page);
  const { client, tool } = await connectAgent(page);
  const begun = await tool("begin_repo_map", { repo: `acme/sync-${Date.now()}`, commit: "c1" });
  await expect.poll(() => canvasHome(page).canvasId).toBe(begun.canvasId);
  await waitForCanvas(page);
  const mapId = begun.mapId as string;

  // The first map, accepted on the canvas as usual.
  await tool("upsert_map_section", { mapId, ...overview("Payments") });
  await tool("upsert_map_section", {
    mapId,
    commit: "c1",
    section: { key: "mod:payments:ops", label: "Payment operations", arrangement: "grid", parent: "mod:payments", level: 4 },
    nodes: [{ key: "sym:charge", type: "shape", shape: "rectangle", label: "charge()", kind: "function", source: { path: "src/payments/charge.ts", lines: [10, 24] } }],
    relationships: [],
  });
  const review = page.getByRole("region", { name: "AI changes to review" });
  await review.getByRole("button", { name: /^Accept all/ }).click();
  await expect(review).toBeHidden();

  // The canvas chip: the agent is writing here (●), and an accepted change Lens hasn't shown yet (Δ).
  const chip = page.getByRole("button", { name: "Open Overview in Lens" });
  await expect(chip).toHaveText("✨ L1 ● Δ");
  await chip.dispatchEvent("click");
  const lens = page.getByRole("complementary", { name: /^Lens:/ });
  await expect(lens.getByRole("group", { name: "Agent Sync" })).toContainText(/● Agent Sync · updated/);
  await expect(chip).toHaveText("✨ L1 ●"); // seen in Lens
  const node = (label: string) => lens.locator(`g.acute-lens-node[aria-label="${label}"]`);
  await expect(node("Payments")).toBeVisible();
  const paymentsId = await page.evaluate(() => {
    const t = (window as unknown as { __acuteDev: { api: { getSceneElements(): { type: string; text?: string; containerId?: string }[] } } }).__acuteDev.api
      .getSceneElements()
      .find((e) => e.type === "text" && e.text === "Payments");
    return t?.containerId;
  });

  // The agent renames Payments (same key) and adds a card: proposed state, drawn apart from the current graph.
  await tool("upsert_map_section", { mapId, ...overview("Payments API", [{ key: "mod:fraud", type: "shape", shape: "rectangle", label: "Fraud check", kind: "backend" }]) });
  await expect(lens.locator('g.acute-lens-ghost[aria-label="Proposed: Fraud check (new)"]')).toBeVisible();
  await expect(node("Payments")).toHaveAttribute("data-pending", "changed");
  await expect(node("Payments")).toContainText("~ changed: label");
  await expect(node("Fraud check")).toHaveCount(0); // a ghost, not a node
  await expect(chip).toHaveText(/✨ L1 ● \dΔ/); // pending on this frame

  // Accept from Lens's Changes drawer (the review bar's own accept): re-rendered, renamed in place, nothing pending.
  await lens.getByRole("tab", { name: /^Changes \(\d+Δ\)$/ }).click();
  const drawer = lens.getByRole("tabpanel", { name: "Changes" });
  await drawer.getByRole("listitem", { name: /^Pending:/ }).getByRole("button", { name: "Accept" }).click();
  await expect(node("Payments API")).toBeVisible();
  await expect(node("Payments")).toHaveCount(0);
  await expect(node("Fraud check")).toBeVisible();
  await expect(lens.locator("g.acute-lens-ghost")).toHaveCount(0);
  expect(
    await page.evaluate(
      (id) => (window as unknown as { __acuteDev: { api: { getSceneElements(): { type: string; text?: string; containerId?: string }[] } } }).__acuteDev.api.getSceneElements().find((e) => e.type === "text" && e.containerId === id)?.text,
      paymentsId,
    ),
  ).toBe("Payments API"); // the same element, relabelled
  await expect(chip).toHaveText("✨ L1 ●"); // accepted while shown in Lens: nothing unseen
  await expect(drawer).toContainText("This session");

  // Pause: the view holds still while the agent keeps sending; Resume shows what arrived.
  await lens.getByRole("button", { name: "Pause" }).click();
  await tool("upsert_map_section", { mapId, ...overview("Payments API", [{ key: "mod:fraud", type: "shape", shape: "rectangle", label: "Fraud check", kind: "backend" }, { key: "mod:ledger", type: "shape", shape: "rectangle", label: "Ledger", kind: "database" }]) });
  await expect(lens.getByRole("button", { name: "Resume · 1Δ" })).toBeVisible();
  await expect(review).toBeVisible(); // the review bar isn't paused
  await expect(lens.locator("g.acute-lens-ghost")).toHaveCount(0);
  await lens.getByRole("button", { name: /^Resume/ }).click();
  await expect(lens.locator('g.acute-lens-ghost[aria-label="Proposed: Ledger (new)"]')).toBeVisible();
  // Rejected from the drawer, with a reason: the ghost goes and nothing is written.
  await drawer.getByLabel(/^Reason for rejecting/).fill("Not yet");
  await drawer.getByRole("button", { name: "Reject" }).click();
  await expect(lens.locator("g.acute-lens-ghost")).toHaveCount(0);
  await expect(node("Ledger")).toHaveCount(0);

  // A source change: the citing card goes stale (on its own level) and its ancestor gets the "may be affected" ring.
  const status = await tool("get_map_status", { mapId, changedPaths: ["src/payments/charge.ts"] });
  expect(status.stale).toEqual(["sym:charge"]);
  expect(status.affectedAncestors).toEqual(["mod:payments"]);
  await expect(node("Payments API")).toHaveAttribute("data-affected", "");
  await node("Payments API").click();
  await lens.getByRole("button", { name: "✨ Zoom in ▸" }).click();
  await expect(node("charge()")).toHaveAttribute("data-stale", "");

  // Impact over what changed here, worded as reach, not blast radius.
  await lens.getByRole("tab", { name: "Impact" }).click();
  const impact = lens.getByRole("tabpanel", { name: "Impact" });
  await expect(impact).toContainText("not a blast radius");
  await expect(impact).toContainText("charge()");

  await client.close();
});
